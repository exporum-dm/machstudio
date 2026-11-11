"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  WandSparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Btn, Field, FINISH, R } from "@/components/ui/primitives";
import { api } from "@/components/brief/types";
import { PageTabs } from "@/components/ui/page-layout";
import { useQueryTab } from "@/components/ui/use-query-tab";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  analyzeMention,
  buildResearchPrompt,
  RESEARCH_AGENT_LABEL,
  type ResearchAgent,
  buildPressReleasePrompt,
  isOwnChannel,
  parseClaudeResearch,
  releaseLabel,
  type PressAnswers,
  type PressRelease,
  type PrMention,
  type ExcludedMentionRule,
} from "@/lib/pr-room/model";
import { rangeContains, rangeLabel, type ResearchRange } from "@/lib/pr-room/range";
import { ResearchRangePicker, useResearchRange } from "./research-range";

interface Room {
  id: string;
  updatedAt: string;
  lastCollectedAt: string | null;
  project: { name: string };
  keywords: unknown;
  referenceUrls: unknown;
  ownChannelUrls: unknown;
  excludedMentionUrls: unknown;
  excludedMentionRules: unknown;
  mentions: unknown;
  pressReleases: unknown;
}
type Loaded = { room: Room; canWrite: boolean };
const control = `min-h-9 rounded-lg bg-background px-2 text-sm shadow-sm ${R.control}`;
const readable=(value:string)=>value.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(Number(x))).replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&amp;/g,"&").replace(/\s*새 창 열림\s*/g," ").trim();
const dateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "아직 조사 전";
// 수집 일자만 보이면 "오늘 조사했다"는 정보만 주지만, 실제로 언제 나간 기사·게시물인지(원문 일자)가
// 더 중요하다 — 알면 둘 다, 모르면 수집 일자만 보여준다.
function mentionDateLabel(mention: Pick<PrMention, "publishedAt" | "collectedAt">) {
  const collected = new Date(mention.collectedAt).toLocaleDateString("ko-KR");
  if (!mention.publishedAt) return `수집 ${collected}`;
  const published = new Date(mention.publishedAt).toLocaleDateString("ko-KR");
  return published === collected ? `원문 ${published}` : `원문 ${published} · 수집 ${collected}`;
}
function mentionSource(mention: PrMention) {
  try {
    const host = new URL(mention.url).hostname.replace(/^www\./, "");
    for (const [domain, name] of [["instagram.com", "Instagram"], ["facebook.com", "Facebook"], ["threads.net", "Threads"], ["threads.com", "Threads"], ["x.com", "X"], ["twitter.com", "X"], ["linkedin.com", "LinkedIn"], ["tiktok.com", "TikTok"], ["youtube.com", "YouTube"], ["youtu.be", "YouTube"]]) {
      if (host === domain || host.endsWith(`.${domain}`)) return name;
    }
    return /^(?:Google 뉴스|Google News|Google|구글 뉴스)$/i.test(mention.source.trim()) && host !== "news.google.com" ? host : mention.source;
  } catch { return mention.source; }
}

function useRoom(projectId: string) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setError("");
      setData(
        await api<Loaded>("/api/pr-room", {
          method: "POST",
          body: JSON.stringify({ projectId }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    let cancelled = false;
    api<Loaded>("/api/pr-room", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    })
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return { data, setData, error, load };
}
async function save(projectId: string, body: Record<string, unknown>, expectedUpdatedAt: string) {
  return api<Loaded>("/api/pr-room", {
    method: "PATCH",
    body: JSON.stringify({ projectId, ...body, expectedUpdatedAt }),
  });
}

export function MentionWorkspace({ projectId }: { projectId: string }) {
  const { data, setData, error, load } = useRoom(projectId);
  const confirm = useConfirm();
  const [tab, setTab] = useQueryTab(["mentions", "ai", "response", "report", "settings"] as const, "mentions", "monitorTab");
  const [running, setRunning] = useState(false);
  const [fillingDates, setFillingDates] = useState(false);
  const [runSummary, setRunSummary] = useState("");
  const [range, setRange] = useResearchRange(projectId);
  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading />;
  const mentions = (
    Array.isArray(data.room.mentions) ? data.room.mentions : []
  ).map(x=>{const row=x as PrMention;return{...row,title:readable(row.title),excerpt:readable(row.excerpt)}}) as PrMention[];
  const patchMention = async (id: string, patch: Partial<PrMention>) => {
    try {
    const next = mentions.map((x) => (x.id === id ? { ...x, ...patch } : x));
    setData(await save(projectId, { mentions: next }, data.room.updatedAt));
    } catch (error) { toast.error(error instanceof Error ? error.message : "저장하지 못했어요"); await load(); }
  };
  const excludeMention = async (mention:PrMention) => {
    if(!await confirm({ title: "무관한 내용인가요?", description: "목록에서 제거하고, 앞으로 비슷한 주제의 결과도 자동으로 걸러냅니다.", confirmLabel: "무관함 — 제외", tone: "danger" })) return;
    try {
    const excluded=Array.isArray(data.room.excludedMentionUrls)?data.room.excludedMentionUrls.filter((x):x is string=>typeof x==="string"):[];
    const rules=Array.isArray(data.room.excludedMentionRules)?data.room.excludedMentionRules as ExcludedMentionRule[]:[];
    const rule:ExcludedMentionRule={title:mention.title,excerpt:mention.excerpt,source:mention.source,channel:mention.channel};
    setData(await save(projectId,{mentions:mentions.filter(x=>x.id!==mention.id),excludedMentionUrls:[...new Set([...excluded,mention.url])],excludedMentionRules:[rule,...rules]}, data.room.updatedAt));
    toast.success("비슷한 조사 결과도 함께 제외하도록 기억했어요");
    } catch (error) { toast.error(error instanceof Error ? error.message : "제외하지 못했어요"); await load(); }
  };
  /**
   * 같은 글이 다른 URL로 중복 수집됐을 때 쓰는 경로 — exclude(무관함)와 분리한 이유:
   * 무관함 제외는 "제목·내용이 비슷한 결과도 앞으로 거른다"는 규칙을 학습한다. 중복은
   * 내용 자체는 우리 행사와 관련이 있으므로, 그 규칙까지 학습하면 나중에 들어오는
   * 진짜 관련 있는 새 언급까지 "비슷하다"는 이유로 조용히 걸러질 수 있다. 그래서 여기선
   * 이 URL만 다시 안 나오게 기억하고, 유사 규칙은 남기지 않는다.
   */
  const duplicateMention = async (mention: PrMention) => {
    if (!await confirm({ title: "중복된 결과를 삭제할까요?", description: "목록에서만 제거합니다 — 비슷한 다른 글까지 걸러내진 않아요.", confirmLabel: "중복 삭제", tone: "danger" })) return;
    try {
      const excluded = Array.isArray(data.room.excludedMentionUrls) ? data.room.excludedMentionUrls.filter((x): x is string => typeof x === "string") : [];
      setData(await save(projectId, { mentions: mentions.filter((x) => x.id !== mention.id), excludedMentionUrls: [...new Set([...excluded, mention.url])] }, data.room.updatedAt));
      toast.success("중복 결과를 삭제했어요");
    } catch (error) { toast.error(error instanceof Error ? error.message : "삭제하지 못했어요"); await load(); }
  };
  /**
   * 수집된 뉴스·보도 언급을 "보도자료" 탭의 아카이브(pressReleases)로 복사해 둔다.
   * 기사 본문은 못 읽어 오므로(excerpt 는 메타 설명 요약뿐) 제목·요약·출처 링크까지만
   * 옮긴다 — "어느 매체가 언제 다뤘는지" 레퍼런스로 쓰기엔 충분하고, 더 정확한 원문이
   * 필요하면 '원문 보기' 링크를 그대로 들고 있다.
   */
  const archiveMention = async (mention: PrMention) => {
    const existing = Array.isArray(data.room.pressReleases) ? (data.room.pressReleases as PressRelease[]) : [];
    if (existing.some((r) => r.sourceUrl === mention.url)) {
      toast.error("이미 아카이브에 저장된 언급이에요");
      return;
    }
    const release: PressRelease = {
      id: crypto.randomUUID(),
      type: "archived",
      title: mention.title,
      body: mention.excerpt || mention.title,
      updatedAt: new Date().toISOString(),
      sourceUrl: mention.url,
      sourceOutlet: mention.source,
      publishedAt: mention.publishedAt ?? undefined,
    };
    try {
      setData(await save(projectId, { pressReleases: [release, ...existing] }, data.room.updatedAt));
      toast.success("보도자료 아카이브에 저장했어요 — '보도자료' 탭에서 볼 수 있어요");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "아카이브에 저장하지 못했어요");
      await load();
    }
  };
  const collect = async () => {
    setRunning(true);
    try {
      const r = await api<{
        added: number;
        counts: Record<string, number>;
        errors: string[];
      }>("/api/pr-room/collect", {
        method: "POST",
        body: JSON.stringify({ projectId, range }),
      });
      await load();
      const checked = Object.entries(r.counts)
        .map(([k, v]) => `${k} ${v}건`)
        .join(" · ");
      setRunSummary(
        `${rangeLabel(range)} · ${checked} 확인 · 새 언급 ${r.added}건 저장${r.errors.length ? ` · 실패 ${r.errors.length}곳` : ""}`,
      );
      toast.success(`새 언급 ${r.added}건을 저장했어요`);
    } catch (e) {
      toast.error((e as Error).message);
      await load();
    } finally {
      setRunning(false);
    }
  };
  const fillDates = async () => {
    setFillingDates(true);
    try {
      const r = await api<{ checked: number; filled: number }>("/api/pr-room/fill-dates", {
        method: "POST",
        body: JSON.stringify({ projectId }),
      });
      await load();
      toast.success(r.checked ? `${r.checked}건 확인 · ${r.filled}건 원문 일자를 채웠어요` : "채울 게 없어요");
    } catch (e) {
      toast.error((e as Error).message);
      await load();
    } finally {
      setFillingDates(false);
    }
  };
  const missingDates = mentions.filter((x) => !x.publishedAt).length;
  const positive = mentions.filter((x) => x.sentiment === "positive").length,
    negative = mentions.filter((x) => x.sentiment === "negative").length,
    neutral = mentions.length - positive - negative;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">언급·반응 조사</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            네이버·Google 보도와 Instagram, X, LinkedIn, Threads, Facebook,
            TikTok의 공개 언급을 조사합니다.
          </p>
          <p className="mt-2 text-xs font-medium text-violet-700">
            조사 결과 기준 · {dateTime(data.room.lastCollectedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {missingDates > 0 && (
            <Btn tone="ghost" disabled={!data.canWrite || fillingDates} onClick={fillDates} aria-label="원문 일자 빠진 글 채우기">
              {fillingDates ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
              원문 일자 채우기({missingDates})
            </Btn>
          )}
          <Btn tone="ghost" disabled={!data.canWrite} onClick={() => setTab("ai")}>
            <WandSparkles className="h-4 w-4" />
            AI로 조사
          </Btn>
          <Btn tone="key" disabled={!data.canWrite || running} onClick={collect}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            무료 검색 업데이트
          </Btn>
        </div>
      </div>
      <ResearchRangePicker range={range} onChange={setRange} />
      {runSummary && (
        <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          {runSummary}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["전체 언급", mentions.length],
          ["긍정", positive],
          ["중립", neutral],
          ["부정", negative],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className={`${R.surface} bg-card px-4 py-3 shadow-sm`}
          >
            <span className="text-xs text-muted-foreground">{label}</span>
            <strong className="ml-2 text-lg">{value}</strong>
          </div>
        ))}
      </div>
      <PageTabs label="언급 조사 메뉴" value={tab} onChange={setTab} options={[
        { id: "mentions", label: "수집 결과" }, { id: "ai", label: "AI 웹 조사" },
        { id: "response", label: "이슈 대응" }, { id: "report", label: "분석 리포트" }, { id: "settings", label: "조사 설정" },
      ]} />
      {tab === "mentions" ? (
        <div className="space-y-4">
          <ManualMentionForm projectId={projectId} data={data} setData={setData} mentions={mentions} />
          <MentionList
            mentions={mentions}
            canWrite={data.canWrite}
            patch={patchMention}
            exclude={excludeMention}
            duplicate={duplicateMention}
            archive={archiveMention}
          />
        </div>
      ) : tab === "ai" ? (
        <AiResearchWorkspace projectId={projectId} data={data} setData={setData} mentions={mentions} reload={load} range={range} />
      ) : tab === "response" ? (
        <ResponseList
          mentions={mentions}
          canWrite={data.canWrite}
          patch={patchMention}
        />
      ) : tab === "report" ? (
        <MentionReport mentions={mentions} lastCollectedAt={data.room.lastCollectedAt} />
      ) : (
        <MentionSettings projectId={projectId} data={data} setData={setData} reload={load} />
      )}
    </div>
  );
}

function AiResearchWorkspace({
  projectId,
  data,
  setData,
  mentions,
  reload,
  range,
}: {
  projectId: string;
  data: Loaded;
  setData: (data: Loaded) => void;
  mentions: PrMention[];
  reload: () => Promise<void>;
  range: ResearchRange;
}) {
  const [value, setValue] = useState("");
  const [agent, setAgentState] = useState<ResearchAgent>("aside");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("pr-room:agent");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장소는 마운트 뒤에만 읽을 수 있다
      if (saved === "aside" || saved === "claude") setAgentState(saved);
    } catch { /* 저장소 차단 — 기본값 유지 */ }
  }, []);
  const setAgent = (next: ResearchAgent) => {
    setAgentState(next);
    try { window.localStorage.setItem("pr-room:agent", next); } catch { /* 무시 */ }
  };
  const agentName = RESEARCH_AGENT_LABEL[agent];
  const [saving, setSaving] = useState(false);
  const [importError, setImportError] = useState("");
  const keywords = Array.isArray(data.room.keywords)
    ? data.room.keywords.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    : [];
  const eventNames = keywords.length ? keywords : [data.room.project.name];
  const excludedUrls = new Set(Array.isArray(data.room.excludedMentionUrls) ? data.room.excludedMentionUrls.filter((x): x is string => typeof x === "string") : []);
  const excludedRules = Array.isArray(data.room.excludedMentionRules) ? data.room.excludedMentionRules as ExcludedMentionRule[] : [];
  const ownChannels = Array.isArray(data.room.ownChannelUrls) ? data.room.ownChannelUrls.filter((x): x is string => typeof x === "string") : [];
  const prompt = buildResearchPrompt({
    eventNames,
    agent,
    range,
    lastCollectedAt: data.room.lastCollectedAt,
    knownUrls: mentions.map((x) => x.url),
    excludedRules,
    ownChannels,
  });
  const start = () => {
    // Aside 는 설치형 브라우저라 여기서 열 수 없다 — 복사만 하고, 붙여 넣을 곳을 알려준다.
    if (agent === "claude") window.open("https://claude.ai/new", "_blank", "noopener,noreferrer");
    navigator.clipboard.writeText(prompt)
      .then(() => toast.success(agent === "claude" ? "조사문을 복사했어요. 열린 Claude에 붙여 넣으세요." : "조사문을 복사했어요. Aside 브라우저의 새 작업에 붙여 넣으세요."))
      .catch(() => toast.error("조사문을 복사하지 못했어요."));
  };
  const importResults = async () => {
    setSaving(true);
    setImportError("");
    try {
      const known = new Set(mentions.map((x) => x.url));
      const parsed = parseClaudeResearch(value);
      // 프롬프트에서 우리 채널은 빼 달라고 했지만, Claude 가 그래도 포함할 수 있어 한 번 더 거른다.
      const fresh = parsed.filter((x) => !known.has(x.url) && !excludedUrls.has(x.url) && !isOwnChannel(x.url, ownChannels));
      // 조사문에 기간을 적어 보내도 AI 가 기간 밖의 글을 섞을 수 있다 — 한 번 더 거른다. 날짜를 모르는 글은 남긴다.
      const rows = fresh.filter((x) => rangeContains(range, x.publishedAt) !== false);
      const outOfRange = fresh.length - rows.length;
      const undated = rows.filter((x) => !x.publishedAt).length;
      const skippedOwnChannel = parsed.length - parsed.filter((x) => !isOwnChannel(x.url, ownChannels)).length;
      if (!rows.length) {
        toast.info(outOfRange ? `조사 기간(${rangeLabel(range)}) 밖의 글 ${outOfRange}건을 빼고 나니 새로 가져올 글이 없어요.` : parsed.length ? "모두 이미 저장되었거나 제외한 URL이에요. AI에 기존 URL을 제외하고 추가 조사해 달라고 요청해 주세요." : "조사 결과가 비어 있어요. Claude에서 추가 조사한 결과를 붙여 넣어 주세요.");
        return;
      }
      const now = new Date().toISOString();
      const added: PrMention[] = rows.map((row) => ({
        id: crypto.randomUUID(),
        ...row,
        ...(!row.sentiment ? analyzeMention(`${row.title} ${row.excerpt}`) : { sentiment: row.sentiment, status: row.sentiment === "negative" ? "issue" : "new", riskLevel: row.sentiment === "negative" ? "attention" : "watch" }),
        responseNote: "",
        collectedAt: now,
        origin: agent,
      }));
      setData(await save(projectId, { mentions: [...added, ...mentions], lastCollectedAt: now }, data.room.updatedAt));
      setValue("");
      toast.success(`${agentName} 조사 결과 ${added.length}건을 가져왔어요.${outOfRange ? ` 기간 밖 ${outOfRange}건은 뺐어요.` : ""}${undated ? ` 게시일 모름 ${undated}건은 '원문 일자 채우기'로 확인해 보세요.` : ""}${parsed.length > fresh.length ? ` 기존·제외 URL ${parsed.length - fresh.length}건은 건너뛰었어요.` : ""}${skippedOwnChannel ? ` (우리 채널 ${skippedOwnChannel}건 포함)` : ""}`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "결과를 가져오지 못했어요.");
      await reload();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <section className={`${R.panel} ${FINISH.s1} bg-card p-5`}>
        <span className="text-xs font-medium text-violet-700">1단계</span>
        <h3 className="mt-1 font-semibold">AI에게 웹 조사 맡기기</h3>
        <div role="radiogroup" aria-label="조사를 맡길 AI" className="mt-3 grid grid-cols-2 gap-2">
          {([
            ["aside", "Aside", "로그인해 둔 SNS·카페 안까지 직접 찾아요 (권장)"],
            ["claude", "Claude", "공개 웹 검색으로 찾아요"],
          ] as const).map(([id, name, hint]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={agent === id}
              onClick={() => setAgent(id)}
              className={`rounded-xl p-3 text-left transition-colors ${agent === id ? "bg-violet-500/10 ring-1 ring-violet-500/40" : "bg-secondary/50 hover:bg-secondary"}`}
            >
              <span className="block text-sm font-medium">{name}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {eventNames.join(" · ")}을 기준으로 <strong className="font-medium text-foreground">{rangeLabel(range)}</strong>에 나온 뉴스와 SNS 언급을 조사합니다. 기존 결과와 제외 사례도 조사문에 함께 전달합니다.
          {agent === "aside" && " Aside에는 읽기만 하고 좋아요·팔로우·댓글은 하지 말라고 적어 보내요."}
        </p>
        <Btn className="mt-4" tone="key" onClick={start}>
          <WandSparkles className="h-4 w-4" />
          {agent === "claude" ? "조사문 복사하고 Claude 열기" : "조사문 복사"}
        </Btn>
        {agent === "aside" && (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Aside 브라우저에서 새 작업을 열고 붙여 넣으세요. 조사할 SNS·네이버 카페에 미리 로그인해 두면 더 많이 찾아요.
          </p>
        )}
        <details className="mt-4 rounded-xl bg-secondary/50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">{agentName}에 보낼 조사문 확인</summary>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{prompt}</pre>
        </details>
      </section>
      <section className={`${R.panel} ${FINISH.s1} bg-card p-5`}>
        <span className="text-xs font-medium text-violet-700">2단계</span>
        <h3 className="mt-1 font-semibold">조사 결과 가져오기</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{agentName}가 출력한 JSON 전체를 아래에 붙여 넣으세요. 기존 URL·제외한 URL·조사 기간 밖의 글은 자동으로 건너뜁니다.</p>
        <label htmlFor="claude-research-results" className="mt-3 block text-xs font-medium">조사 결과 JSON</label>
        <textarea
          id="claude-research-results"
          aria-invalid={Boolean(importError)}
          aria-describedby={importError ? "claude-research-error" : undefined}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`mt-3 min-h-64 w-full bg-background p-3 font-mono text-xs leading-5 ${R.control}`}
          placeholder='[{"title":"행사 관련 기사", "url":"https://...", ...}]'
        />
        {importError && <p id="claude-research-error" role="alert" className="mt-2 text-sm text-destructive">{importError}</p>}
        <Btn className="mt-3" tone="key" disabled={!data.canWrite || saving || !value.trim()} onClick={importResults}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          결과 가져오기
        </Btn>
      </section>
    </div>
  );
}

/**
 * 로그인 장벽 때문에 자동 조사·AI 조사 둘 다 못 찾는 글(비공개 Threads 댓글 등)을
 * 사람이 직접 보고 와서 URL 하나로 등록하는 경로. 제목·메모는 자동으로 채워보되
 * (로그인 필요한 페이지면 대부분 실패) 항상 직접 입력·수정할 수 있다.
 */
function ManualMentionForm({
  projectId,
  data,
  setData,
  mentions,
}: {
  projectId: string;
  data: Loaded;
  setData: (data: Loaded) => void;
  mentions: PrMention[];
}) {
  const [url, setUrl] = useState("");
  const [channel, setChannel] = useState<"press" | "sns">("sns");
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [extra, setExtra] = useState<{ source?: string; author?: string; metrics?: PrMention["metrics"]; comments?: PrMention["comments"] }>({});
  const [fetching, setFetching] = useState(false);
  const [adding, setAdding] = useState(false);

  const fetchPreview = async () => {
    setFetching(true);
    try {
      const r = await api<{ preview: { title: string; excerpt: string; source: string; channel: PrMention["channel"]; author?: string; metrics?: PrMention["metrics"]; comments?: PrMention["comments"] } | null }>(
        "/api/pr-room/preview-url",
        { method: "POST", body: JSON.stringify({ projectId, url: url.trim() }) },
      );
      if (!r.preview) {
        toast.info("자동으로 못 가져왔어요 — 로그인이 필요한 페이지일 수 있어요. 제목·메모를 직접 입력해주세요.");
        return;
      }
      setTitle(r.preview.title);
      setExcerpt(r.preview.excerpt);
      if (r.preview.channel === "press" || r.preview.channel === "sns") setChannel(r.preview.channel);
      setExtra({ source: r.preview.source, author: r.preview.author, metrics: r.preview.metrics, comments: r.preview.comments });
      toast.success("제목·메모를 채웠어요 — 필요하면 수정하세요.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFetching(false);
    }
  };

  const addMention = async () => {
    const trimmedUrl = url.trim();
    if (mentions.some((x) => x.url === trimmedUrl)) {
      toast.error("이미 추가된 URL이에요");
      return;
    }
    setAdding(true);
    try {
      const now = new Date().toISOString();
      const mention: PrMention = {
        id: crypto.randomUUID(),
        title: title.trim() || url.trim(),
        url: url.trim(),
        source: extra.source || (channel === "sns" ? "SNS" : new URL(url.trim()).hostname.replace(/^www\./, "")),
        channel,
        excerpt: excerpt.trim(),
        author: extra.author,
        metrics: extra.metrics,
        comments: extra.comments,
        origin: "manual",
        responseNote: "",
        publishedAt: null,
        collectedAt: now,
        ...analyzeMention(`${title} ${excerpt}`),
      };
      setData(await save(projectId, { mentions: [mention, ...mentions] }, data.room.updatedAt));
      setUrl(""); setTitle(""); setExcerpt(""); setExtra({});
      toast.success("언급을 추가했어요");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  if (!data.canWrite) return null;
  return (
    <section className={`${R.panel} ${FINISH.s1} bg-card p-4`}>
      <h3 className="text-sm font-semibold">언급 직접 추가</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        자동 조사·AI 조사가 못 찾는 글(로그인 뒤 Threads 댓글 등)을 직접 보고 왔을 때 URL로 등록하세요.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className={`${control} min-w-64 flex-1`}
          placeholder="https://www.threads.net/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <select className={control} value={channel} onChange={(e) => setChannel(e.target.value as "press" | "sns")}>
          <option value="sns">SNS</option>
          <option value="press">뉴스·보도</option>
        </select>
        <Btn tone="ghost" disabled={!/^https?:\/\//i.test(url.trim()) || fetching} onClick={fetchPreview}>
          {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          URL에서 가져오기
        </Btn>
      </div>
      <input
        className={`${control} mt-2 w-full`}
        placeholder="제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className={`mt-2 min-h-20 w-full bg-background p-2 text-sm leading-6 ${R.control}`}
        placeholder="메모 — 어떤 내용이었는지, 왜 부정적이었는지 등"
        value={excerpt}
        onChange={(e) => setExcerpt(e.target.value)}
      />
      <Btn
        className="mt-2"
        tone="key"
        disabled={!/^https?:\/\//i.test(url.trim()) || !title.trim() || adding}
        onClick={addMention}
      >
        {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        목록에 추가
      </Btn>
    </section>
  );
}

function MentionList({
  mentions,
  canWrite,
  patch,
  exclude,
  duplicate,
  archive,
}: {
  mentions: PrMention[];
  canWrite: boolean;
  patch: (id: string, p: Partial<PrMention>) => Promise<void>;
  exclude: (mention:PrMention) => Promise<void>;
  duplicate: (mention: PrMention) => Promise<void>;
  archive: (mention: PrMention) => Promise<void>;
}) {
  const [category, setCategory] = useState<"all" | "press" | "sns">("all");
  const shown = mentions
    .filter((x) => category === "all" || x.channel === category)
    .sort(
      (a, b) =>
        new Date(b.publishedAt ?? b.collectedAt).getTime() -
        new Date(a.publishedAt ?? a.collectedAt).getTime(),
    );
  const press = mentions.filter((x) => x.channel === "press").length,
    sns = mentions.filter((x) => x.channel === "sns").length;
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[
          ["all", `전체 ${mentions.length}`],
          ["press", `뉴스·보도 ${press}`],
          ["sns", `SNS ${sns}`],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setCategory(value as typeof category)}
            className={`rounded-full px-3 py-1.5 text-sm shadow-sm ${category === value ? "bg-violet-600 text-white" : "bg-card text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {shown.map((x) => (
          <article
            key={x.id}
            className={`${R.surface} ${FINISH.s1} bg-card p-4`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-xs text-muted-foreground">
                  {{ press: "뉴스·보도", sns: "SNS", comment: "댓글", community: "커뮤니티", web: "웹" }[x.channel]} · {mentionSource(x)}
                  {x.origin && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5">{x.origin === "claude" ? "Claude 가져오기" : x.origin === "aside" ? "Aside 가져오기" : x.origin === "reference" ? "참고 링크" : x.origin === "manual" ? "직접 추가" : "자동 수집"}</span>}
                  {x.author ? ` · ${x.channel === "press" ? "기자 " : "@"}${x.author.replace(/^@/, "")}` : ""}
                  {` · ${mentionDateLabel(x)}`}
                </span>
                <h3 className="mt-2 text-sm font-semibold leading-6">{x.title}</h3>
                {x.excerpt && x.excerpt !== x.title && <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground">{x.excerpt}</p>}
                {x.metrics && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {x.metrics.views !== undefined && (
                      <span>조회 {x.metrics.views.toLocaleString()}</span>
                    )}
                    {x.metrics.likes !== undefined && (
                      <span>좋아요 {x.metrics.likes.toLocaleString()}</span>
                    )}
                    {x.metrics.comments !== undefined && (
                      <span>댓글 {x.metrics.comments.toLocaleString()}</span>
                    )}
                    {x.metrics.shares !== undefined && (
                      <span>공유 {x.metrics.shares.toLocaleString()}</span>
                    )}
                    {x.metrics.saves !== undefined && (
                      <span>저장 {x.metrics.saves.toLocaleString()}</span>
                    )}
                  </div>
                )}
                {!!x.comments?.length && (
                  <details className="mt-3 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-medium">공개 댓글 {x.comments.length}개 보기</summary>
                    <div className="mt-2 divide-y divide-border/60">
                      {x.comments.map((comment,index)=><div key={`${comment.author}-${index}`} className="py-2"><p className="text-xs font-medium text-muted-foreground">{comment.author?`@${comment.author}`:"작성자 미확인"}{comment.likes!==undefined?` · 좋아요 ${comment.likes.toLocaleString()}`:""}</p><p className="mt-1 whitespace-pre-wrap leading-6">{comment.text}</p></div>)}
                    </div>
                  </details>
                )}
                <a
                  href={x.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-violet-600"
                >
                  원문 보기
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {canWrite && (
                <div className="flex gap-2">
                  <select
                    className={control}
                    value={x.sentiment}
                    onChange={(e) =>
                      patch(x.id, {
                        sentiment: e.target.value as PrMention["sentiment"],
                        status: "reviewed",
                      })
                    }
                  >
                    <option value="positive">긍정</option>
                    <option value="neutral">중립</option>
                    <option value="negative">부정</option>
                  </select>
                  <Btn
                    tone={x.status === "issue" ? "ghost" : "key"}
                    onClick={() =>
                      patch(x.id, {
                        status: x.status === "issue" ? "reviewed" : "issue",
                        riskLevel: x.status === "issue" ? "watch" : "attention",
                      })
                    }
                  >
                    <AlertTriangle className="h-4 w-4" />
                    {x.status === "issue" ? "해제" : "대응 필요"}
                  </Btn>
                  {x.channel === "press" && (
                    <Btn tone="ghost" onClick={() => archive(x)} aria-label="보도자료 아카이브에 저장">
                      <Archive className="h-4 w-4" />
                      아카이브에 저장
                    </Btn>
                  )}
                  <Btn tone="ghost" onClick={()=>duplicate(x)} aria-label="중복된 결과 삭제"><Copy className="h-4 w-4"/>중복 삭제</Btn>
                  <Btn tone="ghost" onClick={()=>exclude(x)} aria-label="무관한 결과 제외"><Trash2 className="h-4 w-4"/>무관함</Btn>
                </div>
              )}
            </div>
          </article>
        ))}
        {!shown.length && <Empty text="이 분류에 수집된 언급이 없습니다." />}
      </div>
    </div>
  );
}
function ResponseList({
  mentions,
  canWrite,
  patch,
}: {
  mentions: PrMention[];
  canWrite: boolean;
  patch: (id: string, p: Partial<PrMention>) => Promise<void>;
}) {
  const rows = mentions.filter(
    (x) => x.status === "issue" || x.sentiment === "negative",
  );
  return (
    <div className="space-y-3">
      {rows.map((x) => (
        <article key={x.id} className={`${R.panel} ${FINISH.s1} bg-card p-5`}>
          <h3 className="font-semibold">{x.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {x.source} · {mentionDateLabel(x)}
          </p>
          <div className="mt-3 flex gap-2">
            <select
              disabled={!canWrite}
              className={control}
              value={x.riskLevel}
              onChange={(e) =>
                patch(x.id, {
                  riskLevel: e.target.value as PrMention["riskLevel"],
                  status: "issue",
                })
              }
            >
              <option value="watch">관찰</option>
              <option value="attention">주의</option>
              <option value="urgent">긴급</option>
              <option value="crisis">위기</option>
            </select>
          </div>
          <textarea
            disabled={!canWrite}
            defaultValue={x.responseNote}
            onBlur={(e) =>
              e.target.value !== x.responseNote &&
              patch(x.id, { responseNote: e.target.value })
            }
            className={`mt-3 min-h-28 w-full bg-background p-3 text-sm ${R.control}`}
            placeholder="확인된 사실, 답변 방향, 담당자와 다음 조치"
          />
        </article>
      ))}
      {!rows.length && <Empty text="현재 대응할 이슈가 없습니다." />}
    </div>
  );
}
function MentionReport({ mentions, lastCollectedAt }: { mentions: PrMention[]; lastCollectedAt:string|null }) {
  const pos = mentions.filter((x) => x.sentiment === "positive").length,
    neg = mentions.filter((x) => x.sentiment === "negative").length,
    neutral = mentions.length - pos - neg,
    issues = mentions.filter((x) => x.status === "issue");
  const sources = Object.entries(
    mentions.reduce<Record<string, number>>(
      (a, x) => ({ ...a, [x.source]: (a[x.source] ?? 0) + 1 }),
      {},
    ),
  ).sort((a, b) => b[1] - a[1]);
  const text = [
    `전체 언급 ${mentions.length}건 · 긍정 ${pos}건 · 중립 ${neutral}건 · 부정 ${neg}건`,
    `채널별: ${sources.map(([k, v]) => `${k} ${v}건`).join(" · ")}`,
    issues.length
      ? `우선 확인: ${issues
          .slice(0, 5)
          .map((x) => x.title)
          .join(" / ")}`
      : "현재 긴급 대응 이슈 없음",
    neg
      ? "권고: 부정 반응의 반복 질문을 FAQ와 공식 안내에 반영하고, 영향력 있는 게시물은 24시간 안에 답변 방향을 정하세요."
      : "권고: 긍정 반응이 많은 채널과 메시지를 다음 콘텐츠에 확대하세요.",
  ].join("\n\n");
  return (
    <div className="max-w-5xl space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["전체 언급", mentions.length],
          ["긍정", pos],
          ["중립", neutral],
          ["부정", neg],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className={`${R.surface} bg-card p-4 shadow-sm`}
          >
            <span className="text-xs text-muted-foreground">{label}</span>
            <strong className="mt-2 block text-2xl">{value}</strong>
          </div>
        ))}
      </div>
      <section className={`${R.panel} ${FINISH.s1} bg-card p-6`}>
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <h3 className="font-semibold">언급·반응 분석</h3>
            <p className="mt-1 text-xs text-muted-foreground">
            {dateTime(lastCollectedAt)} 조사 결과 기준 · 대응 필요 {issues.length}건을 별도로 관리합니다.
            </p>
          </div>
          <Btn
            tone="ghost"
            onClick={() =>
              navigator.clipboard
                .writeText(text)
                .then(() => toast.success("복사했어요"))
            }
          >
            <Clipboard className="h-4 w-4" />
            복사
          </Btn>
        </div>
        <p className="mt-5 whitespace-pre-wrap rounded-xl bg-secondary/60 p-5 text-sm leading-7">
          {text}
        </p>
      </section>
    </div>
  );
}
function MentionSettings({
  projectId,
  data,
  setData,
  reload,
}: {
  projectId: string;
  data: Loaded;
  setData: (d: Loaded) => void;
  reload: () => Promise<void>;
}) {
  const words = Array.isArray(data.room.keywords)
    ? data.room.keywords
        .filter((x): x is string => typeof x === "string")
        .join(", ")
    : "";
  const [keywords, setKeywords] = useState(words);
  const channelText = Array.isArray(data.room.ownChannelUrls)
    ? data.room.ownChannelUrls.filter((x): x is string => typeof x === "string").join("\n")
    : "";
  const [ownChannels, setOwnChannels] = useState(channelText);
  const rules = Array.isArray(data.room.excludedMentionRules) ? data.room.excludedMentionRules as ExcludedMentionRule[] : [];
  const removeRule = async (index: number) => {
    try {
      setData(await save(projectId, { excludedMentionRules: rules.filter((_, i) => i !== index) }, data.room.updatedAt));
      toast.success("제외 규칙을 삭제했어요");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했어요");
      await reload();
    }
  };
  return (
    <div className="max-w-2xl space-y-5">
    <section
      className={`${R.panel} ${FINISH.s1} space-y-5 bg-card p-5`}
    >
      <label className="block text-sm font-medium">
        행사명·검색어
        <Field
          className="mt-2"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="코리아 엑스포 LA, Korea Expo LA, 코리아엑스포"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        공식 행사명, 영문명, 해시태그를 쉼표로 구분하세요. 입력한 검색어로 네이버·Google과 공개 SNS를 직접 조사합니다.
      </p>
      <label className="block text-sm font-medium">
        우리 채널(조사에서 제외)
        <textarea
          value={ownChannels}
          onChange={(e) => setOwnChannels(e.target.value)}
          className={`mt-2 min-h-24 w-full bg-background p-3 text-sm ${R.control}`}
          placeholder={"https://en.k-expo.org\nhttps://instagram.com/koreaexpo_official"}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        공식 홈페이지·공식 SNS 계정 URL을 한 줄에 하나씩 적으세요. 조사는 제3자 반응만 찾는 도구라, 여기 등록한 채널(그 하위 게시물 포함)은 수집·Claude 조사 결과에서 자동으로 빠집니다.
      </p>
      <Btn
        tone="key"
        disabled={!data.canWrite}
        onClick={async () => {
          try {
          setData(
            await save(projectId, {
              keywords: keywords
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              ownChannelUrls: ownChannels
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
            }, data.room.updatedAt),
          );
          toast.success("조사 설정을 저장했어요");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "저장하지 못했어요");
            await reload();
          }
        }}
      >
        설정 저장
      </Btn>
      <p className="text-xs text-muted-foreground">
        최근 조사 · {dateTime(data.room.lastCollectedAt)} · 자동 수집 없이 버튼을 눌렀을 때만 조사합니다.
      </p>
    </section>
    <section className={`${R.panel} ${FINISH.s1} space-y-3 bg-card p-5`}>
      <div>
        <h3 className="text-sm font-semibold">제외 규칙</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          ‘무관함 — 제외’로 걸러낸 사례예요. 앞으로 제목·내용이 비슷한 결과도 자동으로 숨깁니다 — ‘중복 삭제’는 여기 남지 않아요.
          관련 있는 내용이 잘못 걸러지고 있다면 여기서 지우세요.
        </p>
      </div>
      {rules.length ? (
        <ul className="space-y-2">
          {rules.map((rule, index) => (
            <li key={`${rule.title}-${index}`} className="flex items-start justify-between gap-3 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="inline-block rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  무관함 — 다른 행사·내용이라 제외
                </span>
                <p className="mt-1 truncate font-medium">{rule.title}</p>
                {rule.excerpt && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{rule.excerpt}</p>}
              </div>
              {data.canWrite && (
                <Btn tone="ghost" onClick={() => removeRule(index)} aria-label="이 제외 규칙 삭제">
                  <Trash2 className="h-4 w-4" />
                </Btn>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">아직 없어요.</p>
      )}
    </section>
    </div>
  );
}

const emptyAnswers: PressAnswers = {
  eventName: "",
  datePlace: "",
  organizers: "",
  purpose: "",
  highlights: "",
  audience: "",
  figures: "",
  quote: "",
  contact: "",
  nextStep: "",
};
const questionLabels: Record<
  keyof PressAnswers,
  { label: string; placeholder: string }
> = {
  eventName: {
    label: "행사 공식 명칭은 무엇인가요?",
    placeholder: "예: 2027 코리아 엑스포 LA",
  },
  datePlace: {
    label: "언제, 어디에서 열리나요?",
    placeholder: "예: 2027년 10월 22~24일, LA 매직박스",
  },
  organizers: {
    label: "주최·주관 기관은 어디인가요?",
    placeholder: "예: 엑스포럼·한국무역협회",
  },
  purpose: {
    label: "이번 자료에서 가장 강조할 메시지는 무엇인가요?",
    placeholder: "한 문장으로 적어주세요",
  },
  highlights: {
    label: "주요 프로그램이나 발표 내용은 무엇인가요?",
    placeholder: "전시, 무대, 상담회 등 확인된 내용",
  },
  audience: {
    label: "누구를 위한 행사인가요?",
    placeholder: "참가기업, 바이어, 현지 소비자 등",
  },
  figures: {
    label: "공개 가능한 수치와 성과가 있나요?",
    placeholder: "참가기업 수, 관람객, 상담 건수 등",
  },
  quote: {
    label: "인용할 관계자 발언은 무엇인가요?",
    placeholder: "직책·이름은 문장 안에 함께 적어주세요",
  },
  nextStep: {
    label: "앞으로의 계획은 무엇인가요?",
    placeholder: "후속 상담, 차기 행사, 지원 계획 등",
  },
  contact: {
    label: "언론 문의처를 적어주세요",
    placeholder: "부서, 담당자, 이메일 또는 전화",
  },
};

export function PressWorkspace({ projectId }: { projectId: string }) {
  const { data, setData, error, load } = useRoom(projectId);
  const [type, setType] = useState<PressRelease["type"]>("advance");
  const [answers, setAnswers] = useState<PressAnswers>(emptyAnswers);
  const [draft, setDraft] = useState<
    { title: string; body: string; sourceUrl?: string; sourceOutlet?: string; publishedAt?: string } | null
  >(null);
  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading />;
  const releases = (
    Array.isArray(data.room.pressReleases) ? data.room.pressReleases : []
  ) as PressRelease[];
  const references = releases.filter((r) => r.type === "archived");
  const prompt = buildPressReleasePrompt({ type, answers, references });
  // MACH 서버에는 LLM 호출이 없다(Resend 같은 외부 API만 연동) — "AI 웹 조사" 탭과 같은 패턴으로
  // 프롬프트만 만들어 Claude에 넘기고, 집필 결과는 사람이 직접 붙여넣는다.
  const copyPromptAndOpen = () => {
    if (
      !answers.eventName.trim() ||
      !answers.datePlace.trim() ||
      !answers.organizers.trim() ||
      !answers.purpose.trim()
    )
      return toast.error("필수 질문 4개에 먼저 답해주세요");
    window.open("https://claude.ai/new", "_blank", "noopener,noreferrer");
    navigator.clipboard
      .writeText(prompt)
      .then(() => toast.success("프롬프트를 복사했어요. Claude에 붙여넣고 받은 결과를 오른쪽 칸에 붙여넣으세요."))
      .catch(() => toast.error("프롬프트를 복사하지 못했어요."));
    setDraft({ title: "", body: "" });
  };
  // 이미 완성된 원고(워드에서 작성한 것 등)를 그대로 붙여넣어 아카이브에 저장하는 경로 —
  // 질문에 안 답해도 되고, 생성기를 거치지 않는다.
  const startBlank = () => {
    setType("archived");
    setDraft({ title: "", body: "" });
  };
  const saveRelease = async () => {
    if (!draft) return;
    try {
    const release: PressRelease = {
      id: crypto.randomUUID(),
      type,
      ...draft,
      updatedAt: new Date().toISOString(),
    };
    setData(await save(projectId, { pressReleases: [release, ...releases] }, data.room.updatedAt));
    toast.success("완성 원고를 저장했어요");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "원고를 저장하지 못했어요");
      await load();
    }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">보도자료 작성</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            질문에 답하면 Claude에 보낼 프롬프트를 만들어요. Claude가 쓴 결과를 오른쪽에 붙여넣어 저장하세요.
          </p>
        </div>
        {/* 이미 완성된 원고(워드에서 쓴 것 등)는 질문 없이 바로 붙여넣어 아카이브할 수 있다 —
            오른쪽 "저장한 보도자료" 목록에 같이 쌓인다. */}
        <Btn tone="ghost" onClick={startBlank}>
          <Archive className="h-4 w-4" />
          완성된 원고 붙여넣기(아카이브)
        </Btn>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)_280px]">
        <section className={`${R.panel} ${FINISH.s1} space-y-4 bg-card p-5`}>
          <label className="block text-sm font-medium">
            자료 종류
            <select
              className={`${control} mt-2 w-full`}
              value={type}
              onChange={(e) => {
                setType(e.target.value as PressRelease["type"]);
                setDraft(null);
              }}
            >
              <option value="advance">사전 보도자료</option>
              <option value="opening">개막 보도자료</option>
              <option value="closing">성료 보도자료</option>
              <option value="statement">공식 입장문</option>
              <option value="archived">아카이브(실제 배포본)</option>
            </select>
          </label>
          {(Object.keys(questionLabels) as (keyof PressAnswers)[]).map(
            (key, index) => (
              <label key={key} className="block text-sm font-medium">
                {questionLabels[key].label}
                {index < 4 && <span className="ml-1 text-rose-500">필수</span>}
                <textarea
                  value={answers[key]}
                  onChange={(e) => {
                    setAnswers((a) => ({ ...a, [key]: e.target.value }));
                    setDraft(null);
                  }}
                  className={`mt-1 min-h-20 w-full bg-background p-3 text-sm ${R.control}`}
                  placeholder={questionLabels[key].placeholder}
                />
              </label>
            ),
          )}
          <Btn tone="key" onClick={copyPromptAndOpen}>
            <WandSparkles className="h-4 w-4" />
            프롬프트 복사하고 Claude 열기
          </Btn>
          <details className="rounded-xl bg-secondary/50 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Claude에 보낼 프롬프트 확인</summary>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{prompt}</pre>
          </details>
        </section>
        <section className={`${R.panel} ${FINISH.s1} bg-card p-6`}>
          {draft ? (
            <>
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <h3 className="font-semibold">작성된 보도자료</h3>
                  {draft.publishedAt && (
                    <p className="mt-1 text-xs text-muted-foreground">원문 게재일 {new Date(draft.publishedAt).toLocaleDateString("ko-KR")}</p>
                  )}
                  {draft.sourceUrl && (
                    <a
                      href={draft.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-violet-600"
                    >
                      {draft.sourceOutlet ? `${draft.sourceOutlet} 원문 보기` : "원문 보기"}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <Btn
                  tone="ghost"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(draft.body)
                      .then(() => toast.success("복사했어요"))
                  }
                >
                  <Clipboard className="h-4 w-4" />
                  복사
                </Btn>
              </div>
              <Field
                className="mt-5"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="보도자료 제목"
              />
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                className={`mt-3 min-h-[34rem] w-full bg-background p-4 text-sm leading-7 ${R.control}`}
                placeholder="Claude가 쓴 결과를 그대로 붙여넣으세요(또는 워드에서 작성한 본문)"
              />
              <Btn
                className="mt-3"
                tone="key"
                disabled={!data.canWrite}
                onClick={saveRelease}
              >
                <FileText className="h-4 w-4" />
                완성 원고 저장
              </Btn>
            </>
          ) : (
            <div className="flex min-h-96 items-center justify-center text-center text-sm text-muted-foreground">
              왼쪽 질문에 답하고 ‘프롬프트 복사하고 Claude 열기’를 누르거나,
              <br />
              위 ‘완성된 원고 붙여넣기’로 이미 있는 글을 저장하세요.
            </div>
          )}
        </section>
        <aside className="space-y-2">
          <h3 className="text-sm font-semibold">저장한 보도자료</h3>
          {releases.map((x) => (
            <button
              key={x.id}
              onClick={() => {
                setType(x.type);
                setDraft({ title: x.title, body: x.body, sourceUrl: x.sourceUrl, sourceOutlet: x.sourceOutlet, publishedAt: x.publishedAt });
              }}
              className={`${R.surface} block w-full bg-card p-3 text-left shadow-sm`}
            >
              <span className="block truncate text-sm font-medium">
                {x.title}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {releaseLabel[x.type] ?? "아카이브"} · {x.publishedAt ? `원문 ${new Date(x.publishedAt).toLocaleDateString("ko-KR")} · ` : ""}저장 {new Date(x.updatedAt).toLocaleDateString("ko-KR")}
                {x.sourceOutlet ? ` · ${x.sourceOutlet}` : ""}
              </span>
            </button>
          ))}
          {!releases.length && (
            <p className="text-sm text-muted-foreground">
              아직 저장한 원고가 없습니다.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      불러오는 중…
    </div>
  );
}
function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className={`${R.panel} max-w-xl bg-card p-5`}>
      <p className="font-medium">불러오지 못했습니다.</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <Btn className="mt-4" tone="key" onClick={retry}>
        다시 시도
      </Btn>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="py-12 text-center text-sm text-muted-foreground">{text}</p>
  );
}
