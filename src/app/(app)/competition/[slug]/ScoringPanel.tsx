"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Award, Loader2, RefreshCw, Scale } from "lucide-react";
import { toast } from "sonner";
import { InlineError } from "@/components/ui/inline-error";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { formatKst } from "@/lib/datetime";
import type { AdvanceSnapshot, CombinedRow, JudgeCriterion } from "@/lib/competition-scoring";
import type { CompetitionDetail } from "./page";
import { secondaryTeamName } from "@/lib/competition-config";

interface ScoringResponse {
  round: { kind: string; name: string; publicWeight: number; judgeWeight: number; advanceCount: number | null };
  criteria: JudgeCriterion[];
  criteriaMax: number;
  judgeCount: number;
  submittedJudgeCount: number;
  rows: CombinedRow[];
  snapshot: AdvanceSnapshot | null;
}

export default function ScoringPanel({
  competition,
  kind,
}: {
  competition: CompetitionDetail;
  kind: "prelim" | "final";
}) {
  const confirm = useConfirm();
  const [data, setData] = useState<ScoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [advanceCount, setAdvanceCount] = useState(0);
  const [advancing, setAdvancing] = useState(false);

  const fetchScoring = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/scoring?round=${kind}`);
      if (!res.ok) { setLoadError(true); return; }
      const json: ScoringResponse = await res.json();
      setData(json);
      setAdvanceCount(json.round.advanceCount ?? Math.min(5, json.rows.length));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [competition.id, kind]);

  useEffect(() => { void Promise.resolve().then(fetchScoring); }, [fetchScoring]);

  const confirmAdvance = async () => {
    if (!data) return;
    const picked = data.rows.slice(0, advanceCount);
    const pending = data.judgeCount - data.submittedJudgeCount;
    const ok = await confirm({
      title: `상위 ${advanceCount}팀을 본선 진출로 확정할까요?`,
      description:
        `${picked.map((r) => `${r.rank}. ${r.title}`).join("\n")}` +
        (pending > 0 ? `\n\n아직 제출하지 않은 심사위원이 ${pending}명 있어요. 지금 확정하면 그 점수는 반영되지 않습니다.` : "") +
        "\n\n확정하면 지금 순위가 기록으로 남고, 본선 화면은 이 명단만 보여줍니다.",
      confirmLabel: "진출 확정",
      tone: pending > 0 ? "danger" : "default",
    });
    if (!ok) return;

    setAdvancing(true);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/scoring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round: kind, advanceCount }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? "확정 실패"); return; }
      toast.success(`${json.advanced}팀을 진출 확정했어요`);
      await fetchScoring();
    } finally {
      setAdvancing(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (loadError) return <InlineError message="종합 점수를 불러오지 못했어요" onRetry={fetchScoring} />;
  if (!data || data.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
        <Scale className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">합산할 참가작이 없어요</p>
        {kind === "final" && (
          <p className="mt-1 text-xs text-muted-foreground/70">본선은 예선에서 진출 확정한 참가작만 집계합니다</p>
        )}
      </div>
    );
  }

  const { round, criteriaMax, judgeCount, submittedJudgeCount, snapshot } = data;
  const pending = judgeCount - submittedJudgeCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className={`bg-secondary px-2 py-1 ${R.control}`}>
            대중 {round.publicWeight} : 심사 {round.judgeWeight}
          </span>
          <span className={`bg-secondary px-2 py-1 ${R.control}`}>
            심사 제출 {submittedJudgeCount}/{judgeCount}명
          </span>
          <span className={`bg-secondary px-2 py-1 ${R.control}`}>심사 만점 {criteriaMax}점</span>
        </div>
        <button
          onClick={fetchScoring}
          className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> 새로고침
        </button>
      </div>

      {criteriaMax === 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          심사 항목이 없어서 심사 점수가 전부 0이에요. <b>심사단</b> 탭에서 항목과 배점을 먼저 정하세요.
        </p>
      )}
      {pending > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          심사위원 {pending}명이 아직 제출하지 않았어요. <b>제출한 사람 점수만</b> 평균에 들어가므로 순위가 더 바뀔 수 있어요.
        </p>
      )}

      <div className="space-y-1.5">
        {data.rows.map((row, index) => {
          const isAdvancing = index < advanceCount;
          return (
            <div
              key={row.entryId}
              className={`bg-background p-3 ${R.surface} ${FINISH.s2} ${isAdvancing ? "ring-1 ring-violet-500/30" : ""}`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                    isAdvancing ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {row.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-[11px] text-muted-foreground">{row.entryNo}</span>
                    <span className="truncate text-sm font-medium">{row.title}</span>
                    {secondaryTeamName(row.title, row.teamName) && <span className="truncate text-[11px] text-muted-foreground">{row.teamName}</span>}
                    {row.tied && (
                      <span
                        className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                        title={
                          kind === "final"
                            ? "합산 점수가 같아요. 관람객 점수가 높은 팀을 앞에 뒀습니다."
                            : "합산 점수가 같아요. 먼저 신청한 팀을 앞에 뒀습니다."
                        }
                      >
                        동점
                      </span>
                    )}
                  </div>
                  {/* 계산 근거를 항상 같이 둔다 — 시상 결과에는 반드시 이의가 따라온다. */}
                  <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                    표 {row.votes.toLocaleString()} → {row.publicScore.toFixed(1)}
                    <span className="mx-1.5 opacity-40">|</span>
                    심사 {row.judgeAverage === null ? "—" : `${row.judgeAverage.toFixed(1)}/${criteriaMax}`}
                    <span className="opacity-60"> ({row.judgeCount}명)</span> → {row.judgeScore.toFixed(1)}
                  </p>
                  <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${row.publicScore * (round.publicWeight / 100)}%` }}
                      transition={{ type: "spring", stiffness: 300, damping: 32 }}
                      className="h-full bg-violet-500"
                      title="대중"
                    />
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${row.judgeScore * (round.judgeWeight / 100)}%` }}
                      transition={{ type: "spring", stiffness: 300, damping: 32 }}
                      className="h-full bg-sky-500"
                      title="심사"
                    />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">{row.combined.toFixed(1)}</p>
                  <p className="text-[10px] text-muted-foreground">종합</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-500 align-middle" />대중
        <span className="mx-1 ml-2 inline-block h-2 w-2 rounded-full bg-sky-500 align-middle" />심사 —
        각각 0~100으로 맞춘 뒤 비율만큼 더한 값이에요.{" "}
        {kind === "final"
          ? "동점이면 관람객 점수가 높은 팀이 앞섭니다."
            + " 그래도 같으면 참가 인원수·평균 나이 순으로 운영자가 정합니다(시스템은 판정하지 않아요)."
          : "동점이면 먼저 신청한 팀이 앞섭니다."}
      </p>

      {kind === "prelim" && (
        <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Award className="h-4 w-4 text-violet-500" /> 본선 진출 확정
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            상위 몇 팀을 올릴지 정하고 확정하세요. 확정하면 <b>본선 화면과 심사 대상이 이 명단으로 바뀝니다</b>.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={data.rows.length}
              value={advanceCount}
              onChange={(e) =>
                setAdvanceCount(Math.max(1, Math.min(data.rows.length, Number(e.target.value) || 1)))
              }
              className={`${FIELD_CLS} h-9 w-24`}
            />
            <span className="text-xs text-muted-foreground">팀 / 전체 {data.rows.length}팀</span>
            <button
              onClick={confirmAdvance}
              disabled={advancing}
              className={`ml-auto bg-violet-500 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50 ${R.control}`}
            >
              {advancing ? "확정 중..." : "진출 확정"}
            </button>
          </div>

          {snapshot && (
            <div className="mt-4 rounded-xl bg-secondary/40 p-3">
              <p className="text-[11px] font-medium">
                최근 확정: {formatKst(snapshot.decidedAt)} · 상위 {snapshot.advanceCount}팀
                <span className="ml-1.5 text-muted-foreground">
                  (대중 {snapshot.publicWeight} : 심사 {snapshot.judgeWeight})
                </span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {snapshot.rows.slice(0, snapshot.advanceCount).map((r) => `${r.rank}. ${r.title}`).join("  ·  ")}
              </p>
              <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                확정 시점의 점수를 그대로 남겨둔 기록이에요. 이후 표가 더 들어와도 이 값은 바뀌지 않습니다.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
