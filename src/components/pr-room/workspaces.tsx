"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Clipboard,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  WandSparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Btn, Field, FINISH, R, Segmented } from "@/components/ui/primitives";
import { api } from "@/components/brief/types";
import {
  buildPressRelease,
  type PressAnswers,
  type PressRelease,
  type PrMention,
  type ExcludedMentionRule,
} from "@/lib/pr-room/model";

interface Room {
  id: string;
  collectEveryDays: number;
  lastCollectedAt: string | null;
  keywords: unknown;
  referenceUrls: unknown;
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
const nextCollection = (value: string | null, days: number) =>
  value ? dateTime(new Date(new Date(value).getTime() + days * 86_400_000).toISOString()) : "첫 조사 후 계산";

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
async function save(projectId: string, body: Record<string, unknown>) {
  return api<Loaded>("/api/pr-room", {
    method: "PATCH",
    body: JSON.stringify({ projectId, ...body }),
  });
}

export function MentionWorkspace({ projectId }: { projectId: string }) {
  const { data, setData, error, load } = useRoom(projectId);
  const [tab, setTab] = useState<
    "mentions" | "response" | "report" | "settings"
  >("mentions");
  const [running, setRunning] = useState(false);
  const [runSummary, setRunSummary] = useState("");
  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading />;
  const mentions = (
    Array.isArray(data.room.mentions) ? data.room.mentions : []
  ).map(x=>{const row=x as PrMention;return{...row,title:readable(row.title),excerpt:readable(row.excerpt)}}) as PrMention[];
  const patchMention = async (id: string, patch: Partial<PrMention>) => {
    const next = mentions.map((x) => (x.id === id ? { ...x, ...patch } : x));
    setData(await save(projectId, { mentions: next }));
  };
  const excludeMention = async (mention:PrMention) => {
    if(!window.confirm("이 결과를 제거하고 다음 조사에서도 제외할까요?")) return;
    const excluded=Array.isArray(data.room.excludedMentionUrls)?data.room.excludedMentionUrls.filter((x):x is string=>typeof x==="string"):[];
    const rules=Array.isArray(data.room.excludedMentionRules)?data.room.excludedMentionRules as ExcludedMentionRule[]:[];
    const rule:ExcludedMentionRule={title:mention.title,excerpt:mention.excerpt,source:mention.source,channel:mention.channel};
    setData(await save(projectId,{mentions:mentions.filter(x=>x.id!==mention.id),excludedMentionUrls:[...new Set([...excluded,mention.url])],excludedMentionRules:[rule,...rules]}));
    toast.success("비슷한 조사 결과도 함께 제외하도록 기억했어요");
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
        body: JSON.stringify({ projectId }),
      });
      await load();
      const checked = Object.entries(r.counts)
        .map(([k, v]) => `${k} ${v}건`)
        .join(" · ");
      setRunSummary(
        `${checked} 확인 · 새 언급 ${r.added}건 저장${r.errors.length ? ` · 실패 ${r.errors.length}곳` : ""}`,
      );
      toast.success(`새 언급 ${r.added}건을 저장했어요`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };
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
        <Btn tone="key" disabled={!data.canWrite || running} onClick={collect}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          새 언급 업데이트
        </Btn>
      </div>
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
      <Segmented
        value={tab}
        onChange={setTab}
        label="언급 조사 메뉴"
        options={[
          { value: "mentions", label: "수집 결과" },
          { value: "response", label: "이슈 대응" },
          { value: "report", label: "분석 리포트" },
          { value: "settings", label: "조사 설정" },
        ]}
      />
      {tab === "mentions" ? (
        <MentionList
          mentions={mentions}
          canWrite={data.canWrite}
          patch={patchMention}
          exclude={excludeMention}
        />
      ) : tab === "response" ? (
        <ResponseList
          mentions={mentions}
          canWrite={data.canWrite}
          patch={patchMention}
        />
      ) : tab === "report" ? (
        <MentionReport mentions={mentions} lastCollectedAt={data.room.lastCollectedAt} />
      ) : (
        <MentionSettings projectId={projectId} data={data} setData={setData} />
      )}
    </div>
  );
}

function MentionList({
  mentions,
  canWrite,
  patch,
  exclude,
}: {
  mentions: PrMention[];
  canWrite: boolean;
  patch: (id: string, p: Partial<PrMention>) => Promise<void>;
  exclude: (mention:PrMention) => Promise<void>;
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
                  {x.channel === "press" ? "뉴스·보도" : "SNS"} · {x.source}
                  {x.author ? ` · ${x.channel === "press" ? "기자 " : "@"}${x.author.replace(/^@/, "")}` : ""}
                  {` · ${x.publishedAt ? "게시" : "수집"} ${new Date(x.publishedAt ?? x.collectedAt).toLocaleDateString("ko-KR")}`}
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
                  <Btn tone="ghost" onClick={()=>exclude(x)} aria-label="이 조사 결과 제외"><Trash2 className="h-4 w-4"/>제외</Btn>
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
            {x.source} · {x.publishedAt ? "게시" : "수집"} {new Date(x.publishedAt ?? x.collectedAt).toLocaleDateString("ko-KR")}
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
}: {
  projectId: string;
  data: Loaded;
  setData: (d: Loaded) => void;
}) {
  const words = Array.isArray(data.room.keywords)
    ? data.room.keywords
        .filter((x): x is string => typeof x === "string")
        .join(", ")
    : "";
  const [keywords, setKeywords] = useState(words);
  return (
    <section
      className={`${R.panel} ${FINISH.s1} max-w-2xl space-y-5 bg-card p-5`}
    >
      <label className="block text-sm font-medium">
        조사 주기
        <select
          disabled={!data.canWrite}
          className={`${control} mt-2 block w-full`}
          value={data.room.collectEveryDays}
          onChange={async (e) =>
            setData(
              await save(projectId, {
                collectEveryDays: Number(e.target.value),
              }),
            )
          }
        >
          {[1, 2, 3, 5, 7, 14, 30].map((n) => (
            <option key={n} value={n}>
              {n}일에 한 번
            </option>
          ))}
        </select>
      </label>
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
      <Btn
        tone="key"
        disabled={!data.canWrite}
        onClick={async () => {
          setData(
            await save(projectId, {
              keywords: keywords
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            }),
          );
          toast.success("조사 설정을 저장했어요");
        }}
      >
        설정 저장
      </Btn>
      <p className="text-xs text-muted-foreground">
        최근 조사 · {dateTime(data.room.lastCollectedAt)}<br/>
        다음 자동 조사 예정 · {nextCollection(data.room.lastCollectedAt,data.room.collectEveryDays)}
      </p>
    </section>
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
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(
    null,
  );
  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading />;
  const releases = (
    Array.isArray(data.room.pressReleases) ? data.room.pressReleases : []
  ) as PressRelease[];
  const generate = () => {
    if (
      !answers.eventName.trim() ||
      !answers.datePlace.trim() ||
      !answers.organizers.trim() ||
      !answers.purpose.trim()
    )
      return toast.error("필수 질문 4개에 먼저 답해주세요");
    setDraft(buildPressRelease(type, answers));
  };
  const saveRelease = async () => {
    if (!draft) return;
    const release: PressRelease = {
      id: crypto.randomUUID(),
      type,
      ...draft,
      updatedAt: new Date().toISOString(),
    };
    setData(await save(projectId, { pressReleases: [release, ...releases] }));
    toast.success("완성 원고를 저장했어요");
  };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">보도자료 작성</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          확인된 사실만 질문에 답하면 배포 가능한 전체 원고로 정리합니다.
        </p>
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
          <Btn tone="key" onClick={generate}>
            <WandSparkles className="h-4 w-4" />
            전체 원고 작성
          </Btn>
        </section>
        <section className={`${R.panel} ${FINISH.s1} bg-card p-6`}>
          {draft ? (
            <>
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold">작성된 보도자료</h3>
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
              />
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                className={`mt-3 min-h-[34rem] w-full bg-background p-4 text-sm leading-7 ${R.control}`}
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
              왼쪽 질문에 답하고
              <br />
              ‘전체 원고 작성’을 눌러주세요.
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
                setDraft({ title: x.title, body: x.body });
              }}
              className={`${R.surface} block w-full bg-card p-3 text-left shadow-sm`}
            >
              <span className="block truncate text-sm font-medium">
                {x.title}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {new Date(x.updatedAt).toLocaleDateString("ko-KR")}
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
