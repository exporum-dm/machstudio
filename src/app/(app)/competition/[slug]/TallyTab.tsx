"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Loader2, RefreshCw, Users } from "lucide-react";
import { InlineError } from "@/components/ui/inline-error";
import { FINISH, R } from "@/components/ui/primitives";
import ScoringPanel from "./ScoringPanel";
import type { CompetitionDetail } from "./page";
import type { RoundDto } from "./VoteSettingsTab";
import { secondaryTeamName } from "@/lib/competition-config";

interface TallyRow {
  entryId: string;
  entryNo: string;
  title: string;
  teamName: string | null;
  votes: number;
  percentOfTop: number;
  percentOfTotal: number;
}

interface TallyResponse {
  round: { kind: string; name: string; maxVotesPerVoter: number; advanceCount: number | null };
  rows: TallyRow[];
  totalVotes: number;
  voterCount: number;
}

export default function TallyTab({ competition, rounds }: { competition: CompetitionDetail; rounds: RoundDto[] }) {
  const [kind, setKind] = useState<"prelim" | "final">("prelim");
  /** 득표는 "얼마나 받았나", 종합은 "그래서 누가 올라가나" — 보는 목적이 달라 화면을 나눈다. */
  const [view, setView] = useState<"votes" | "combined">("votes");
  const [data, setData] = useState<TallyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchTally = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/tally?round=${kind}`);
      if (!res.ok) { setLoadError(true); return; }
      setData(await res.json());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [competition.id, kind]);

  useEffect(() => { void Promise.resolve().then(fetchTally); }, [fetchTally]);

  const round = rounds.find((r) => r.kind === kind);
  const advanceCount = data?.round.advanceCount ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(["prelim", "final"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setKind(value)}
              className={`px-3 py-1.5 text-xs transition-colors ${R.control} ${
                kind === value ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {value === "prelim" ? "예선" : "본선"}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {([["votes", "득표"], ["combined", "종합 (대중+심사)"]] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setView(value)}
              className={`px-3 py-1.5 text-xs transition-colors ${R.control} ${
                view === value ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "combined" ? (
        <ScoringPanel competition={competition} kind={kind} />
      ) : loading && !data ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <InlineError message="집계를 불러오지 못했어요" onRetry={fetchTally} />
      ) : !data || data.rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
          <BarChart3 className="mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">집계할 참가작이 없어요</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            참가작 탭에서 <b>노출</b>을 켜야 투표 대상이 됩니다
          </p>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              onClick={fetchTally}
              className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              새로고침
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`bg-background px-4 py-3 ${R.surface} ${FINISH.s2}`}>
              <p className="text-[11px] text-muted-foreground">총 투표 수</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{data.totalVotes.toLocaleString()}</p>
            </div>
            <div className={`bg-background px-4 py-3 ${R.surface} ${FINISH.s2}`}>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Users className="h-3 w-3" /> 투표한 사람
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{data.voterCount.toLocaleString()}</p>
            </div>
            <div className={`bg-background px-4 py-3 ${R.surface} ${FINISH.s2}`}>
              <p className="text-[11px] text-muted-foreground">1인당 최대</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{data.round.maxVotesPerVoter}표</p>
            </div>
          </div>

          {round && !round.showLiveTally && (
            <p className="text-[11px] text-muted-foreground">
              참여자에게는 득표가 공개되지 않는 설정이에요. 이 화면은 운영자만 봅니다.
            </p>
          )}

          <div className="space-y-1.5">
            {data.rows.map((row, index) => {
              const isAdvancing = advanceCount !== null && index < advanceCount;
              return (
                <div key={row.entryId} className={`bg-background p-3 ${R.surface} ${FINISH.s2}`}>
                  <div className="flex items-center gap-3">
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                        index === 0
                          ? "bg-violet-500 text-white"
                          : isAdvancing
                            ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                            : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="font-mono text-[11px] text-muted-foreground">{row.entryNo}</span>
                        <span className="truncate text-sm font-medium">{row.title}</span>
                        {secondaryTeamName(row.title, row.teamName) && <span className="truncate text-[11px] text-muted-foreground">{row.teamName}</span>}
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${row.percentOfTop}%` }}
                          transition={{ type: "spring", stiffness: 300, damping: 32 }}
                          className="h-full rounded-full bg-violet-500"
                        />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">{row.votes.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {row.percentOfTotal.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">
            막대 길이는 1위 대비 비율이고, 오른쪽 %는 전체 표 중 비중이에요. 동점은 참가번호(접수 순서)가 빠른 쪽이 앞섭니다.
          </p>
        </>
      )}
    </div>
  );
}
