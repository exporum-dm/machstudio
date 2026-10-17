"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Award, ChevronDown, ChevronUp, Copy, ExternalLink, Eye, EyeOff, Loader2, MonitorPlay, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { InlineError } from "@/components/ui/inline-error";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { btnCls, FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { PreviewFrame } from "@/components/ui/PreviewFrame";
import { formatKst } from "@/lib/datetime";
import { normalizeShowConfig, SHOW_MODES, type ShowConfig } from "@/lib/competition-show";
import type { CompetitionDetail } from "./page";
import { secondaryTeamName } from "@/lib/competition-config";

interface Candidate { id: string; entryNo: string; title: string; teamName: string | null }
interface AwardRow {
  id: string | null;
  name: string;
  description: string | null;
  entryId: string | null;
}

const spring = { type: "spring", stiffness: 420, damping: 32 } as const;

export default function AwardsTab({
  competition,
  patch,
}: {
  competition: CompetitionDetail;
  patch: (body: Record<string, unknown>, successMessage?: string) => Promise<boolean>;
}) {
  const [awards, setAwards] = useState<AwardRow[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchAwards = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/awards`);
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setAwards((data.awards ?? []).map((a: AwardRow) => ({
        id: a.id, name: a.name, description: a.description, entryId: a.entryId,
      })));
      setCandidates(data.candidates ?? []);
      setPublishedAt(data.resultPublishedAt ?? null);
      setDirty(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [competition.id]);

  useEffect(() => { void Promise.resolve().then(fetchAwards); }, [fetchAwards]);

  const update = (index: number, patch: Partial<AwardRow>) => {
    setAwards((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
    setDirty(true);
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= awards.length) return;
    const next = [...awards];
    [next[index], next[target]] = [next[target], next[index]];
    setAwards(next);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/awards`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ awards: awards.filter((a) => a.name.trim()) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "저장 실패"); return; }
      setAwards((data.awards ?? []).map((a: AwardRow) => ({
        id: a.id, name: a.name, description: a.description, entryId: a.entryId,
      })));
      setDirty(false);
      toast.success("시상 내역을 저장했어요");
    } finally {
      setSaving(false);
    }
  };

  const published = !!publishedAt;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="min-w-0 space-y-4">
      <ResultPublishCard
        competition={competition}
        publishedAt={publishedAt}
        dirty={dirty}
        assignedCount={awards.filter((a) => a.entryId).length}
        onChange={setPublishedAt}
      />

      <FinalOrderCard competition={competition} />

      <ShowCard competition={competition} patch={patch} />

      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">시상 내역</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              위에서부터 대상 → 하위상 순서예요. 배정은 비워 둬도 저장됩니다 — 발표 직전에 채우세요.
            </p>
          </div>
          <button onClick={save} disabled={saving || !dirty} className={btnCls("key", "text-xs disabled:opacity-40")}>
            {saving ? "저장 중..." : dirty ? "저장" : "저장됨"}
          </button>
        </div>

        {published && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            결과 페이지가 <b>공개 중</b>이에요. 지금 고친 내용은 저장하는 즉시 관람객 화면에 반영됩니다.
          </p>
        )}

        <div className="mt-4 space-y-2">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <InlineError message="시상 내역을 불러오지 못했어요" onRetry={fetchAwards} />
          ) : awards.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
              <Award className="mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">아직 만든 상이 없어요</p>
            </div>
          ) : (
            awards.map((award, index) => (
              <motion.div key={award.id ?? `new-${index}`} layout transition={spring} className={`bg-background p-3 ${R.surface} ${FINISH.s2}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-[11px] font-bold text-violet-600 dark:text-violet-400">
                    {index + 1}
                  </span>
                  <input
                    value={award.name}
                    onChange={(e) => update(index, { name: e.target.value })}
                    placeholder="상 이름 (예: 대상)"
                    className={`${FIELD_CLS} h-8 min-w-[8rem] flex-1`}
                  />
                  <select
                    value={award.entryId ?? ""}
                    onChange={(e) => update(index, { entryId: e.target.value || null })}
                    className={`${FIELD_CLS} h-8 min-w-[10rem] flex-1`}
                  >
                    <option value="">— 미배정 —</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.entryNo}. {c.title}{secondaryTeamName(c.title, c.teamName) ? ` (${c.teamName})` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25"
                      aria-label="위로"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === awards.length - 1}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25"
                      aria-label="아래로"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => { setAwards(awards.filter((_, i) => i !== index)); setDirty(true); }}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-red-500"
                      aria-label="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <input
                  value={award.description ?? ""}
                  onChange={(e) => update(index, { description: e.target.value || null })}
                  placeholder="부연 설명 (선택) — 결과 페이지에 함께 보여요"
                  className={`${FIELD_CLS} mt-1.5 h-8`}
                />
              </motion.div>
            ))
          )}
        </div>

        {!loading && !loadError && (
          <button
            onClick={() => { setAwards([...awards, { id: null, name: "", description: null, entryId: null }]); setDirty(true); }}
            className={`mt-2 flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
          >
            <Plus className="h-3 w-3" /> 상 추가
          </button>
        )}
      </section>
      </div>

      <div className="min-w-0 xl:sticky xl:top-6 xl:self-start">
        <AwardsPreviewPane competition={competition} publishedAt={publishedAt} />
      </div>
    </div>
  );
}

/**
 * 우측 고정 미리보기 — 결과 페이지와 발표 화면을 번갈아 본다.
 *
 * **발표 화면은 리허설(가짜 결과)로 띄운다.** 진짜 결과로 돌리면 어드민 옆칸에 수상자
 * 명단이 계속 떠 있게 된다 — 발표 전에 누가 지나가다 볼 수 있는 자리다.
 * 결과 페이지는 공개 전에도 운영자만 볼 수 있다(결과 API 가 previewToken 을 확인한다) —
 * 공개를 누른 뒤에야 처음 보면 오타를 고칠 자리가 없다.
 */
function AwardsPreviewPane({
  competition,
  publishedAt,
}: {
  competition: CompetitionDetail;
  publishedAt: string | null;
}) {
  const [view, setView] = useState<"result" | "show">("result");

  const chip = (active: boolean) =>
    `px-2 py-0.5 text-[11px] transition-colors ${R.control} ${
      active ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
    }`;

  const controls = (
    <div className="flex items-center gap-1">
      <button onClick={() => setView("result")} className={chip(view === "result")}>결과 페이지</button>
      <button onClick={() => setView("show")} className={chip(view === "show")} disabled={!competition.showToken}>
        발표 화면
      </button>
    </div>
  );

  if (view === "show") {
    if (!competition.showToken) {
      return <p className="text-xs text-muted-foreground">발표 링크가 아직 없어요. 왼쪽에서 발급하세요.</p>;
    }
    return (
      <PreviewFrame
        title="발표 화면"
        src={`/show/${competition.showToken}?rehearsal=1`}
        note="리허설(가짜 결과)로 연출만 확인해요"
        openLabel="발표 화면 열기"
        controls={controls}
      />
    );
  }

  if (!competition.previewToken) {
    return <p className="text-xs text-muted-foreground">미리보기 링크가 아직 없어요. 배포 탭에서 발급하세요.</p>;
  }
  return (
    <PreviewFrame
      title="결과 페이지"
      src={`/cp/${competition.previewToken}?view=result`}
      note={publishedAt ? "지금 관람객에게 보이는 화면" : "공개 전이라 운영자만 볼 수 있어요"}
      reloadKey={publishedAt ?? "none"}
      controls={controls}
    />
  );
}

function ResultPublishCard({
  competition, publishedAt, dirty, assignedCount, onChange,
}: {
  competition: CompetitionDetail;
  publishedAt: string | null;
  dirty: boolean;
  assignedCount: number;
  onChange: (value: string | null) => void;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const published = !!publishedAt;

  const toggle = async () => {
    const ok = await confirm(
      published
        ? {
            title: "결과 페이지를 다시 감출까요?",
            description: "이미 결과를 본 사람이 있을 수 있어요. 링크를 연 사람에게는 '준비 중'으로 바뀝니다.",
            confirmLabel: "감추기",
          }
        : {
            title: "결과를 공개할까요?",
            description: `배정된 수상작 ${assignedCount}팀이 결과 페이지에 바로 나타나요.\n발표 전에 누르면 명단이 미리 새어 나갑니다.`,
            confirmLabel: "공개",
            tone: "danger",
          },
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/awards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish: !published }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "실패"); return; }
      onChange(data.resultPublishedAt ?? null);
      toast.success(published ? "결과를 감췄어요" : "결과를 공개했어요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            {published ? <Eye className="h-4 w-4 text-violet-500" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
            결과 발표
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {published
              ? `${formatKst(publishedAt!)}에 공개했어요. 결과 페이지에서 수상작을 볼 수 있습니다.`
              : "아직 비공개예요. 결과 페이지는 '준비 중'만 보여줍니다."}
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={busy || (!published && assignedCount === 0)}
          className={btnCls(published ? "quiet" : "key", "text-xs disabled:opacity-40")}
        >
          {busy ? "처리 중..." : published ? "다시 감추기" : "결과 공개"}
        </button>
      </div>
      {!published && assignedCount === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">수상작을 한 팀 이상 배정해야 공개할 수 있어요.</p>
      )}
      {dirty && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          저장하지 않은 변경이 있어요. 공개 상태는 <b>저장된 내용</b>을 기준으로 보여집니다.
        </p>
      )}

    </section>
  );
}

function ShowCard({
  competition, patch,
}: {
  competition: CompetitionDetail;
  patch: (body: Record<string, unknown>, successMessage?: string) => Promise<boolean>;
}) {
  const confirm = useConfirm();
  const [config, setConfig] = useState<ShowConfig>(() => normalizeShowConfig(competition.showConfig));
  const [copied, setCopied] = useState(false);

  // 이번 승인 범위 밖인 결과 발표 공유 링크는 현재 host 동작을 유지한다.
  // eslint-disable-next-line no-restricted-syntax
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const showUrl = competition.showToken ? `${origin}/show/${competition.showToken}` : "";

  const save = async (next: ShowConfig) => {
    setConfig(next);
    await patch({ showConfig: next });
  };

  return (
    <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <MonitorPlay className="h-4 w-4 text-violet-500" /> 발표 화면
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            무대 스크린에 띄우는 전체화면이에요. <b>자동으로 넘어가지 않고</b> 스페이스바나 →로 직접 넘깁니다.
          </p>
        </div>
        <button
          onClick={async () => {
            const ok = await confirm({
              title: competition.showToken ? "발표 링크를 새로 만들까요?" : "발표 링크를 만들까요?",
              description: competition.showToken
                ? "지금까지 공유한 링크는 즉시 열리지 않게 돼요."
                : "이 링크를 아는 사람은 발표 전에도 결과를 볼 수 있어요. 무대 노트북에만 두세요.",
              confirmLabel: competition.showToken ? "새로 만들기" : "만들기",
            });
            if (!ok) return;
            await patch({ rotateShowToken: true }, "발표 링크를 발급했어요");
          }}
          className={`flex shrink-0 items-center gap-1 bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
        >
          <RefreshCw className="h-3 w-3" /> {competition.showToken ? "새로 만들기" : "링크 만들기"}
        </button>
      </div>

      <div className="mt-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {SHOW_MODES.map((m) => {
          const active = config.mode === m.value;
          return (
            <button
              key={m.value}
              onClick={() => void save(normalizeShowConfig({ ...config, mode: m.value }))}
              className={`p-3 text-left transition-colors ${R.surface} ${
                active ? "bg-violet-500/10 ring-1 ring-violet-500/40" : "bg-secondary/40 hover:bg-secondary"
              }`}
            >
              <span className={`text-xs font-semibold ${active ? "text-violet-600 dark:text-violet-400" : ""}`}>
                {m.label}
              </span>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{m.hint}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-2.5 border-t border-border pt-4">
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs">
            참가작 사진 함께 띄우기
            <span className="ml-1.5 text-[11px] text-muted-foreground">스크린이 작으면 끄는 게 읽기 좋아요</span>
          </span>
          <Switch checked={config.showMedia} onChange={(v) => void save({ ...config, showMedia: v })} label="사진 띄우기" />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs">
            점수 공개
            <span className="ml-1.5 text-[11px] text-muted-foreground">
              {config.mode === "bars" ? "바 레이스는 점수가 곧 연출이라 항상 켜져요" : "관객에게 종합 점수를 보여줍니다"}
            </span>
          </span>
          <Switch
            checked={config.showScores}
            onChange={(v) => void save({ ...config, showScores: v })}
            label="점수 공개"
            disabled={config.mode === "bars"}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">화면 하단 문구 (선택)</span>
          <input
            value={config.footnote}
            onChange={(e) => setConfig({ ...config, footnote: e.target.value })}
            onBlur={() => void save(config)}
            placeholder="예: 주최 코리아엑스포 · 후원 ○○"
            className={`${FIELD_CLS} h-9`}
          />
        </label>
      </div>

      {showUrl ? (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">발표 링크</span>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(showUrl);
                  setCopied(true);
                  toast.success("복사했어요");
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  toast.error("복사에 실패했어요");
                }
              }}
              className={`flex items-center gap-1 bg-secondary px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
            >
              {copied ? "복사됨" : <><Copy className="h-3 w-3" /> 복사</>}
            </button>
          </div>
          <pre className={`overflow-x-auto bg-secondary/40 p-3 text-[11px] ${R.control}`}><code>{showUrl}</code></pre>
          <div className="flex flex-wrap gap-1.5">
            <a
              href={showUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1 bg-violet-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-600 ${R.control}`}
            >
              <ExternalLink className="h-3 w-3" /> 발표 화면 열기
            </a>
            <a
              href={`${showUrl}?rehearsal=1`}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1 bg-secondary px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
            >
              리허설 (가짜 결과)
            </a>
          </div>
          <p className="text-[11px] text-muted-foreground">
            무대에서: <b>스페이스바/→</b> 다음, <b>←</b> 이전, <b>F</b> 전체화면, <b>S</b> 비상 결과판.
            한 번 열어 두면 네트워크가 끊겨도 연출은 계속 돌아가요.
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            리허설은 <b>가짜 결과</b>로 돕니다 — 연습 자리에 스태프만 있는 경우는 거의 없어서, 진짜 명단을 띄우면 그걸로 발표가 끝나요.
          </p>

        </div>
      ) : (
        <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
          발표 링크가 아직 없어요. 위 &quot;링크 만들기&quot;를 눌러 발급하세요.
        </p>
      )}
    </section>
  );
}

function FinalOrderCard({ competition }: { competition: CompetitionDetail }) {
  const [entries, setEntries] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/final-order`);
      if (!res.ok) return;
      const data = await res.json();
      setEntries(data.entries ?? []);
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, [competition.id]);

  useEffect(() => { void Promise.resolve().then(fetchOrder); }, [fetchOrder]);

  if (loading) return null;
  if (entries.length === 0) return null;

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    [next[index], next[target]] = [next[target], next[index]];
    setEntries(next);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/final-order`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: entries.map((e) => e.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "저장 실패"); return; }
      setEntries(data.entries ?? []);
      setDirty(false);
      toast.success("본선 순서를 저장했어요");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">본선 진행 순서</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            본선 투표·심사 화면이 이 순서대로 보여줘요. 예선 접수 순번과는 무관합니다.
          </p>
        </div>
        <button onClick={save} disabled={saving || !dirty} className={btnCls("key", "text-xs disabled:opacity-40")}>
          {saving ? "저장 중..." : dirty ? "저장" : "저장됨"}
        </button>
      </div>

      <div className="mt-3 space-y-1">
        {entries.map((entry, index) => (
          <motion.div
            key={entry.id}
            layout
            transition={spring}
            className={`flex items-center gap-2 bg-background px-3 py-2 ${R.surface} ${FINISH.s2}`}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-secondary text-[11px] font-bold tabular-nums">
              {index + 1}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">{entry.entryNo}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
            {secondaryTeamName(entry.title, entry.teamName) && <span className="truncate text-[11px] text-muted-foreground">{entry.teamName}</span>}
            <button
              onClick={() => move(index, -1)}
              disabled={index === 0}
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25"
              aria-label="위로"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => move(index, 1)}
              disabled={index === entries.length - 1}
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25"
              aria-label="아래로"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
