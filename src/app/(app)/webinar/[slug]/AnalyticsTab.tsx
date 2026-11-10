"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useChartColors } from "@/components/ui/use-chart-colors";
import { motion } from "framer-motion";
import { Download, Loader2, RefreshCw, BarChart3, MessageSquare, HelpCircle, Users, Trash2, RotateCcw, Share2, Target } from "lucide-react";
import { toast } from "sonner";
import { formatKst, formatKstDateTime } from "@/lib/datetime";
import { useUndoableDelete } from "@/components/ui/use-undoable-delete";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { InlineError } from "@/components/ui/inline-error";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

interface Funnel {
  visits: number;
  registered: number;
  attended: number;
  stay30: number;
  stay60: number;
  avgStayMinutes: number;
  maxStayMinutes: number;
  attendRate: number;
  stay30Rate: number;
  stay60Rate: number;
  regRate: number;
}

interface UtmRow {
  source: string;
  medium: string;
  visits: number;
  registered: number;
  entered: number;
  regRate: number;
  entryRate: number;
  /* 리드 품질 — 등록 수만 보면 meta 173명이 압도적이지만, 그 리드가 좋았는지는 평균 점수가 답한다.
     scoreReliable=false 면(표본 20명 미만) 평균을 흐리게 표시한다 — 13명 채널의 평균은 노이즈다. */
  avgScore?: number;
  hot?: number;
  hotRate?: number;
  scoreReliable?: boolean;
}

interface CampaignRow {
  campaign: string;
  registered: number;
  entered: number;
  attendRate: number;
  cost: number | null;
  cpr: number | null;
  cpa: number | null;
}

interface PollArchive {
  id: string;
  question: string;
  isActive: boolean;
  totalVotes: number;
  options: { label: string; voteCount: number }[];
}

interface Interactions {
  polls: PollArchive[];
  qa: {
    total: number;
    answered: number;
    pending: number;
    dismissed: number;
    answerRate: number;
    top: { question: string; voteCount: number; status: string; name: string | null }[];
  };
  chat: { messages: number; participants: number };
  cta: { clicks: number; clickers: number };
  reminders: number;
}

interface TopEngaged {
  name: string;
  company: string | null;
  score: number;
  segment: "hot" | "warm" | "cold";
  watchMinutes: number;
  chat: number;
  pollVotes: number;
  qaAsks: number;
  qaUpvotes: number;
  ctaClicks: number;
  agreeMarketing: boolean;
  breakdown: { attend: number; watch: number; interact: number; interactRaw: number; intent: number; evaluatedMinutes: number };
}

interface Scoring {
  total: number;
  liveMinutes: number;
  scheduledMinutes: number;
  /** before = 아직 방송 전. 이때 세그먼트는 전원 노쇼라 의미가 없어 리드 품질을 대신 보여준다 */
  phase: "before" | "live" | "ended";
  distribution: { hot: number; warm: number; cold: number; noShow: number };
  top: TopEngaged[];
  /** 노쇼지만 마케팅 동의 — 리타겟 대상 */
  retargetCount: number;
  leadQuality: { consented: number; withEmail: number; withPhone: number; withCompany: number };
}

/**
 * 성과 퍼널 — 등록 → 시청 → 설문 응답 → 상담 희망 → 그중 마케팅 동의.
 *
 * 마케팅 동의를 마지막 단계로 두지 않은 이유: 등록 시점에 체크하는 값이라 시청보다 먼저
 * 일어나고, 실측에서 `등록 257 → 시청 0 → 동의 142` 로 마지막이 앞 단계보다 커졌다.
 * 마지막은 "상담 희망 중 마케팅도 동의한 사람" = 바로 영업하고 마케팅도 보낼 수 있는 리드다.
 */
interface PerformanceFunnel {
  visits: number;
  registered: number;
  entered: number;
  surveyResponded: number;
  goalReached: number;
  goalWithMarketing: number;
  stay30: number;
  stay60: number;
  /** 설문에서 성과 선택지를 지정했나 — false 면 마지막 두 단계 대신 안내를 띄운다 */
  goalConfigured: boolean;
  goalQuestionTitles: string[];
  /** 마케팅 동의 전수(노쇼 포함) — 퍼널 축이 아니라 별도 숫자 */
  marketingConsented: number;
  /** 등록자와 연결되지 않아 퍼널에서 제외된 익명 설문 응답 */
  unlinkedSurveyResponses: number;
}

/** 세분화 축 한 줄 — 업종·직함·채널이 같은 모양을 쓴다(webinar-lead-facets.FacetRow). */
interface FacetRow {
  label: string;
  total: number;
  entered: number;
  avgScore: number;
  hot: number;
  /** false 면 평균을 흐리게 + "표본 부족" 으로 표시한다 */
  reliable: boolean;
}

/** 리드 분석 — 점수를 결정에 쓸 수 있는 축으로 쪼갠 결과. */
interface LeadAnalysis {
  histogram: { from: number; to: number; count: number }[];
  composition: { attend: number; watch: number; interact: number; intent: number; total: number };
  byIndustry: FacetRow[];
  byRole: FacetRow[];
  fieldLabels?: { industry?: string; jobTitle?: string };
  lift: { action: string; withCount: number; withAvg: number; withoutAvg: number; reliable: boolean }[];
  minReliableSample: number;
}

/** 입소문(추천 링크) — 공유 → 클릭 → 등록. 아무도 공유하지 않으면 섹션 자체를 숨긴다. */
interface WordOfMouth {
  /** 공유 버튼을 누른 사람 수 */
  sharers: number;
  /** 총 공유 횟수(한 사람이 여러 면에서 공유하면 각각) */
  shares: number;
  /** 추천 링크로 들어온 방문 */
  clicks: number;
  /** 추천 링크로 실제 등록한 사람 수 */
  registered: number;
  bySurface: { surface: string; count: number }[];
  top: { name: string; company: string | null; shares: number; clicks: number; registered: number }[];
}

interface AnalyticsData {
  funnel: Funnel;
  utmBreakdown: UtmRow[];
  campaignBreakdown: CampaignRow[];
  registrationTrend: { date: string; count: number }[];
  interactions: Interactions;
  scoring: Scoring;
  performanceFunnel?: PerformanceFunnel;
  leadAnalysis?: LeadAnalysis;
  wordOfMouth?: WordOfMouth;
  hasVisitData: boolean;
  /** 광고비 합산 기간 — 캠페인 표 캡션이 밝힌다(스키마상 웨비나 단위로 스코핑할 수 없어서). */
  costScope?: { from: string; to: string };
  /** 이름이 안 맞아 비용이 붙지 않은 광고 캠페인명 — 표 위에 안내로 띄운다. */
  unmatchedAdCampaigns?: string[];
}

interface CurvePoint { label: string; viewers: number; entered: number; chat: number }
interface CurveData {
  points: CurvePoint[];
  peak: number;
  avg: number;
  bucketMinutes?: number;
  fromMs?: number;
  bucketMs?: number;
  hasData: boolean;
}

interface ActivityItem { id: string; action: string; label: string; at: string; actor: string | null }

type Range = "all" | "60m" | "30m";

const n = (v: number) => v.toLocaleString();
const won = (v: number) => "₩" + v.toLocaleString();
const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

const SOURCE_LABEL: Record<string, string> = { "(direct)": "직접 유입", "(none)": "—" };
const RANGES: { k: Range; label: string }[] = [
  { k: "all", label: "전체" },
  { k: "60m", label: "60분" },
  { k: "30m", label: "30분" },
];

/* 운영 이벤트 마커로 삼을 활동 — 발행/송출 계열만 */
const EVENT_RE = /(poll|announcement|popup|tally_push)_(created|updated)/;

/* 차트 색상은 공용 훅으로 옮겼다 — use-chart-colors.ts (같은 문제를 겪는 화면이 셋이다) */

/* ── 테마 대응 커스텀 툴팁 ── */
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; dataKey?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-card">
      <p className="mb-1 font-semibold text-popover-foreground tabular-nums">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name} <b className="ml-auto pl-3 tabular-nums text-foreground">{n(Number(p.value ?? 0))}</b>
        </p>
      ))}
    </div>
  );
}

/* ── 카드 셸 (콘솔과 동일 마감) ── */
function SectionCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={`rounded-2xl border border-border bg-card shadow-card p-5 ${className}`}
    >
      {children}
    </motion.section>
  );
}

/* ── 설문 결과 — 자체 설문(WebinarSurvey)의 문항별 집계. 설문이 없으면 섹션 자체를 숨긴다. ── */
interface SurveyQuestionResult {
  id: string;
  type: "rating" | "single" | "multiple" | "text" | "nps";
  title: string;
  count: number;
  avg?: number | null;
  nps?: number | null;
  dist?: Record<number, number>;
  options?: Record<string, number>;
  texts?: string[];
}
interface SurveyResultData {
  survey: { id: string; title: string };
  totalResponses: number;
  linkedResponses: number;
  bySource: Record<string, number>;
  results: SurveyQuestionResult[];
}
const SOURCE_LABELS: Record<string, string> = { ended: "종료 화면", live: "라이브 푸시", link: "링크" };

function ResultBar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="relative overflow-hidden rounded-lg border border-border/60 px-3 py-1.5">
      <span className="absolute inset-y-0 left-0 bg-violet-500/15 transition-all" style={{ width: `${pct}%` }} />
      <span className="relative flex items-center justify-between gap-2 text-xs">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{count}표 · {pct}%</span>
      </span>
    </div>
  );
}

/* ── 설문 개별 응답 — 열었을 때만 로드(egress). 등록자 연결 응답은 이름·연락처 표시, CSV 내보내기 포함. ── */
interface SurveyResponseRow {
  id: string;
  submittedAt: string;
  source: string | null;
  answers: Record<string, number | string | string[]>;
  registrant: { id: string; name: string; email: string | null; phone: string | null; company: string | null } | null;
}
interface SurveyResponsesData {
  survey: { id: string; title: string };
  questions: { id: string; type: string; title: string; retired?: boolean }[];
  total: number;
  responses: SurveyResponseRow[];
}

// 보관된 문항(편집기에서 지웠지만 답변이 남아 있는 것)은 열 제목에 표시한다.
function questionLabel(q: { title: string; retired?: boolean }): string {
  const base = q.title || "(제목 없음)";
  return q.retired ? `${base} (보관)` : base;
}

function formatAnswer(type: string, v: number | string | string[] | undefined): string {
  if (v === undefined || v === null || v === "") return "";
  if (Array.isArray(v)) return v.join(", ");
  if (type === "rating") return `★${v}`;
  return String(v);
}

// KST 고정 — timeZone 없는 new Date().toLocaleString("ko-KR") 은 브라우저 타임존 기준이라
// 서버(Vercel, TZ=UTC)와 사용자(KST) 브라우저에서 같은 값이 다르게 보였다.
const fmtSubmittedAt = (iso: string) =>
  formatKst(iso, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function SurveyResponsesPanel({ webinarId, surveyId }: { webinarId: string; surveyId: string }) {
  const [data, setData] = useState<SurveyResponsesData | null>(null);
  const [failed, setFailed] = useState(false);
  // 삭제 대기 중인 응답 — 낙관적으로 목록에서 감춘다(실행취소하면 되돌아온다)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const { remove: undoableRemove } = useUndoableDelete();

  /**
   * 응답 삭제. 테스트 응답·중복 제출·본인 삭제 요청(개인정보 파기)을 처리할 방법이 없었다.
   * 되돌릴 수 없는 동작이라 5초 실행취소 창을 둔다(세션·공지 삭제와 같은 방식) — 확인 모달을
   * 한 번 더 띄우는 것보다 낫다: 실수는 즉시 되돌릴 수 있고, 의도한 삭제는 클릭 한 번으로 끝난다.
   */
  const deleteResponse = (r: SurveyResponseRow) => {
    const who = r.registrant ? r.registrant.name : "익명";
    undoableRemove({
      key: r.id,
      message: `${who} 응답을 삭제했어요`,
      onOptimistic: () => setHiddenIds((prev) => new Set(prev).add(r.id)),
      onUndo: () => setHiddenIds((prev) => { const n2 = new Set(prev); n2.delete(r.id); return n2; }),
      commit: async () => {
        const res = await fetch(`/api/webinars/${webinarId}/surveys/${surveyId}/responses/${r.id}`, { method: "DELETE" });
        if (!res.ok) {
          // 실패하면 목록에 되돌려 놓는다 — 지워진 척 남아 있으면 다시 지울 수도 없다
          setHiddenIds((prev) => { const n2 = new Set(prev); n2.delete(r.id); return n2; });
          toast.error("응답 삭제에 실패했어요");
          return;
        }
        // 총 개수도 같이 줄인다(집계 카드는 다음 새로고침에 맞춰진다)
        setData((prev) => (prev ? { ...prev, total: Math.max(0, prev.total - 1), responses: prev.responses.filter((x) => x.id !== r.id) } : prev));
      },
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/webinars/${webinarId}/surveys/${surveyId}/responses`);
        if (cancelled) return;
        if (!res.ok) { setFailed(true); return; }
        setData(await res.json());
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [webinarId, surveyId]);

  const downloadCsv = useCallback(() => {
    if (!data) return;
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ["제출시각", "이름", "이메일", "전화", "회사", "소스", ...data.questions.map(questionLabel)];
    const rows = data.responses.map((r) => [
      // CSV 는 화면 축약 표기 대신 formatKstDateTime 의 풀 자리수 표기(YYYY-MM-DD HH:mm:ss)를 쓴다 —
      // 엑셀에서 정렬·필터링하기 좋고, KST 고정이라 기기 타임존과 무관하다.
      formatKstDateTime(r.submittedAt),
      r.registrant?.name ?? "익명",
      r.registrant?.email ?? "",
      r.registrant?.phone ?? "",
      r.registrant?.company ?? "",
      SOURCE_LABELS[r.source ?? ""] ?? r.source ?? "",
      ...data.questions.map((q) => formatAnswer(q.type, r.answers[q.id])),
    ]);
    const csv = "﻿" + [headers, ...rows].map((row) => row.map(esc).join(",")).join("\r\n"); // BOM — 엑셀 한글
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `설문응답_${data.survey.title}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  if (failed) return <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">개별 응답을 불러오지 못했어요. 잠시 후 다시 열어주세요.</p>;
  if (!data) return <div className="mt-4 flex justify-center border-t border-border pt-6 pb-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>;

  // 삭제 대기 중인 응답은 목록·개수에서 즉시 빠진다
  const rows = data.responses.filter((r) => !hiddenIds.has(r.id));

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground tabular-nums">
          최근 {rows.length}건{data.total > rows.length && ` 표시 · 전체 ${n(Math.max(data.total - hiddenIds.size, rows.length))}건 (전체는 CSV 기준 최근 ${rows.length}건)`}
        </p>
        {rows.length > 0 && (
          <button type="button" onClick={downloadCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <Download className="h-3.5 w-3.5" />CSV
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">아직 응답이 없어요.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="whitespace-nowrap py-2 pr-4 font-medium">응답자</th>
                <th className="whitespace-nowrap py-2 pr-4 font-medium">소스</th>
                <th className="whitespace-nowrap py-2 pr-4 font-medium">제출</th>
                {data.questions.map((q) => (
                  <th key={q.id} className="max-w-[200px] truncate py-2 pr-4 font-medium" title={questionLabel(q)}>{questionLabel(q)}</th>
                ))}
                <th className="w-8 py-2 font-medium"><span className="sr-only">삭제</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50 align-top last:border-0">
                  <td className="whitespace-nowrap py-2 pr-4">
                    {r.registrant ? (
                      <>
                        <span className="font-medium">{r.registrant.name}</span>
                        {r.registrant.email && <span className="block text-[11px] text-muted-foreground">{r.registrant.email}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">익명</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">{SOURCE_LABELS[r.source ?? ""] ?? r.source ?? "—"}</td>
                  <td className="whitespace-nowrap py-2 pr-4 tabular-nums text-muted-foreground">{fmtSubmittedAt(r.submittedAt)}</td>
                  {data.questions.map((q) => (
                    <td key={q.id} className="max-w-[240px] py-2 pr-4">
                      <span className="line-clamp-3 whitespace-pre-wrap break-words">{formatAnswer(q.type, r.answers[q.id])}</span>
                    </td>
                  ))}
                  <td className="py-2 align-middle">
                    <button
                      type="button"
                      onClick={() => deleteResponse(r)}
                      aria-label={`${r.registrant ? r.registrant.name : "익명"} 응답 삭제`}
                      title="응답 삭제 (5초 안에 실행취소 가능)"
                      className="rounded-lg p-1.5 text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SurveyResultsSection({ webinarId }: { webinarId: string }) {
  const [data, setData] = useState<SurveyResultData[] | null>(null);
  const [openResponses, setOpenResponses] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/webinars/${webinarId}/surveys`);
        if (!res.ok) { if (!cancelled) setData([]); return; }
        const list = ((await res.json()).surveys ?? []) as { id: string }[];
        const all = await Promise.all(
          list.map(async (s) => {
            const r = await fetch(`/api/webinars/${webinarId}/surveys/${s.id}/results`);
            return r.ok ? ((await r.json()) as SurveyResultData) : null;
          }),
        );
        if (!cancelled) setData(all.filter((d): d is SurveyResultData => d !== null));
      } catch { if (!cancelled) setData([]); }
    })();
    return () => { cancelled = true; };
  }, [webinarId]);

  if (!data || data.length === 0) return null;

  return (
    <>
      {data.map((d) => (
        <SectionCard key={d.survey.id}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-violet-500" /> 설문 결과 — {d.survey.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                응답 {d.totalResponses}건 · 등록자 연결 {d.linkedResponses}건
                {Object.entries(d.bySource).length > 0 && (
                  <> · {Object.entries(d.bySource).map(([k, v]) => `${SOURCE_LABELS[k] ?? k} ${v}`).join(" / ")}</>
                )}
              </p>
            </div>
            {d.totalResponses > 0 && (
              <button
                type="button"
                onClick={() => setOpenResponses((prev) => ({ ...prev, [d.survey.id]: !prev[d.survey.id] }))}
                aria-expanded={!!openResponses[d.survey.id]}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${openResponses[d.survey.id] ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400" : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
              >
                <Users className="h-3.5 w-3.5" />개별 응답 {openResponses[d.survey.id] ? "접기" : "보기"}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {d.results.map((q) => (
              <div key={q.id} className="min-w-0">
                <p className="mb-2 text-[13px] font-medium leading-snug">{q.title} <span className="text-[11px] text-muted-foreground tabular-nums">({q.count}명)</span></p>

                {q.type === "rating" && (
                  <div className="flex items-center gap-3">
                    <p className="text-2xl font-semibold tabular-nums">{q.avg != null ? q.avg.toFixed(1) : "-"}<span className="ml-0.5 text-sm text-amber-500">★</span></p>
                    <div className="flex-1 space-y-1">
                      {[5, 4, 3, 2, 1].map((n) => (
                        <ResultBar key={n} label={`${n}점`} count={q.dist?.[n] ?? 0} total={q.count} />
                      ))}
                    </div>
                  </div>
                )}

                {q.type === "nps" && (
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 text-center">
                      <p className="text-2xl font-semibold tabular-nums">{q.nps ?? "-"}</p>
                      <p className="text-[10px] text-muted-foreground">NPS</p>
                    </div>
                    <div className="flex flex-1 items-end gap-0.5" aria-label="0~10 분포">
                      {Array.from({ length: 11 }, (_, n) => {
                        const c = q.dist?.[n] ?? 0;
                        const max = Math.max(1, ...Object.values(q.dist ?? {}));
                        return (
                          <div key={n} className="flex flex-1 flex-col items-center gap-0.5" title={`${n}점 · ${c}명`}>
                            <div className={`w-full rounded-sm ${n >= 9 ? "bg-green-500/70" : n <= 6 ? "bg-red-400/60" : "bg-secondary"}`} style={{ height: `${6 + (c / max) * 40}px` }} />
                            <span className="text-[9px] text-muted-foreground tabular-nums">{n}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(q.type === "single" || q.type === "multiple") && (
                  <div className="space-y-1">
                    {Object.entries(q.options ?? {}).map(([opt, c]) => (
                      <ResultBar key={opt} label={opt} count={c} total={q.count} />
                    ))}
                  </div>
                )}

                {q.type === "text" && (
                  <div className="space-y-1.5">
                    {(q.texts ?? []).slice(0, 5).map((t, i) => (
                      <p key={i} className="rounded-lg bg-secondary/50 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">{t}</p>
                    ))}
                    {(q.texts?.length ?? 0) > 5 && <p className="text-[11px] text-muted-foreground">외 {(q.texts?.length ?? 0) - 5}건</p>}
                    {(q.texts?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">아직 답변이 없어요.</p>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {openResponses[d.survey.id] && <SurveyResponsesPanel webinarId={webinarId} surveyId={d.survey.id} />}
        </SectionCard>
      ))}
    </>
  );
}

/* ── 요약 KPI 카드 ── */
function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-card p-4">
      <p className="text-[11.5px] font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-[-0.02em] ${tone === "green" ? "text-green-600 dark:text-green-400" : ""}`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

/* ── 퍼널 단계 막대 ── */
function FunnelStep({ label, value, base, color, delay = 0 }: { label: string; value: number; base: number; color: string; delay?: number }) {
  // 등록 > 방문이 될 수 있다: 방문 비콘이 붙기 전에 등록이 먼저 쌓인 기간이 있거나, 임베드가
  // 없는 외부 페이지에서 유입됐거나. 막대는 100% 로 잘라 넘치지 않게 하고,
  // 비율은 초과 사실을 숨기지 않고 그대로 표기한다.
  const width = base ? Math.min(100, Math.max(3, Math.round((value / base) * 100))) : 0;
  const rate = pct(value, base);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {n(value)}명 · {rate}%
          {rate > 100 && <span className="ml-1 text-amber-600" title="등록이 방문보다 많아요 — 방문 집계가 시작되기 전에 쌓인 등록이거나, 임베드가 붙지 않은 외부 페이지에서 유입된 등록이에요">*</span>}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.5, ease: "easeOut", delay }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/**
 * 성과 퍼널 한 단계.
 *
 * 두 비율을 함께 보여준다:
 *   · **직전 단계 대비**(굵게) — 어디서 사람이 빠졌는지. 사장님이 요청한 "넘어갈 때 전환율".
 *   · 전체(등록) 대비(작게) — 규모 감각. 막대 길이도 이 값이다.
 * 하나만 보여주면 "시청 56%" 가 등록 대비인지 방문 대비인지 매번 헷갈린다.
 */
function PerfStep({
  label, value, prev, base, color, hint, delay = 0, emphasis = false,
}: {
  label: string; value: number; prev: number | null; base: number;
  color: string; hint?: string; delay?: number; emphasis?: boolean;
}) {
  const width = base ? Math.min(100, Math.max(value > 0 ? 3 : 0, Math.round((value / base) * 100))) : 0;
  const stepRate = prev === null ? null : pct(value, prev);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className={emphasis ? "font-semibold" : "text-muted-foreground"} title={hint}>
          {label}
          {hint && <span className="ml-1 cursor-help text-muted-foreground/50">ⓘ</span>}
        </span>
        <span className="shrink-0 tabular-nums">
          <b className={emphasis ? "text-violet-600 dark:text-violet-400" : ""}>{n(value)}명</b>
          {stepRate !== null && (
            <span className="ml-1.5 text-muted-foreground" title="직전 단계 대비 전환율">
              <b className="text-foreground">{stepRate}%</b>
              <span className="text-muted-foreground/60">{` · 전체 ${pct(value, base)}%`}</span>
            </span>
          )}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.5, ease: "easeOut", delay }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/**
 * 성과 퍼널 본문 — 등록 → 시청 → 설문 응답 → 상담 희망 → 그중 마케팅 동의.
 *
 * 체류(30분↑·60분↑)는 단계가 아니라 **보조 줄**이다: 성과로 가는 경로가 아니라 시청의 질이고,
 * 단계로 넣으면 6줄이 되어 막대가 짧아진다.
 *
 * 성과 문항이 지정되지 않았으면 마지막 두 단계 대신 안내를 띄운다 — 0명 막대를 그리면
 * "아무도 상담을 원하지 않았다" 로 읽히는데, 실제로는 **세는 기준이 없는 것**이다.
 */
function PerformanceFunnelBody({ perf }: { perf: PerformanceFunnel }) {
  const base = Math.max(perf.registered, 1);
  const hasVisits = perf.visits > 0;
  return (
    <>
      <div className="mb-4">
        <h3 className="text-sm font-semibold">성과 퍼널</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {hasVisits ? "방문 → 등록 → 시청 → 설문 → 상담 희망" : "등록 → 시청 → 설문 → 상담 희망"} 단계별 전환 ·
          굵은 %는 <b>직전 단계 대비</b>예요.
        </p>
      </div>

      <div className="space-y-3.5">
        {hasVisits && (
          <PerfStep label="페이지 방문" value={perf.visits} prev={null} base={Math.max(perf.visits, base)} color="var(--chart-chat)" delay={0}
            hint="랜딩·라이브 면에 도달한 세션 수예요. 임베드가 붙지 않은 외부 페이지는 세지 않고, 아임웹 랜딩과 우리 라이브 페이지를 각각 방문하면 도메인이 달라 2회로 셀 수 있어요." />
        )}
        <PerfStep label="사전 등록" value={perf.registered} prev={hasVisits ? perf.visits : null} base={hasVisits ? Math.max(perf.visits, base) : base} color="var(--chart-viewers)" delay={0.06} />
        <PerfStep label="실제 시청" value={perf.entered} prev={perf.registered} base={base} color="var(--chart-viewers)" delay={0.12} />
        <PerfStep label="설문 응답" value={perf.surveyResponded} prev={perf.entered} base={base} color="var(--chart-entered)" delay={0.18}
          hint="여기서 크게 빠지면 설문 노출·유도 문제예요(상담 의사와는 다른 문제)" />
        {perf.goalConfigured ? (
          <>
            <PerfStep label="상담 희망" value={perf.goalReached} prev={perf.surveyResponded} base={base} color="#f59e0b" delay={0.24}
              hint={perf.goalQuestionTitles.length ? `성과로 지정된 문항: ${perf.goalQuestionTitles.join(" · ")}` : undefined} />
            <PerfStep label="상담 희망 + 마케팅 동의" value={perf.goalWithMarketing} prev={perf.goalReached} base={base} color="#8b5cf6" delay={0.3} emphasis
              hint="바로 연락하고 마케팅도 보낼 수 있는 리드 — 이 웨비나의 최종 성과예요" />
          </>
        ) : (
          /* 0명 막대를 그리면 "아무도 상담을 원하지 않았다" 로 읽힌다 — 실제로는 기준이 없는 것이다. */
          <div className="flex items-start gap-2.5 rounded-xl bg-secondary/60 p-3">
            <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
            <p className="text-[11px] leading-relaxed">
              <b>상담 희망 단계는 아직 셀 수 없어요.</b>{" "}
              <span className="text-muted-foreground">
                설문 탭에서 객관식 문항의 선택지를 <b>‘성과로 셀 선택지’</b>로 지정하면(예: “네, 상담을 희망합니다”)
                여기에 상담 희망 전환율과 최종 성과가 표시돼요.
              </span>
            </p>
          </div>
        )}
      </div>

      {/* 보조 줄 — 체류의 질과 퍼널에서 빠진 값들. 단계가 아니라 각주다. */}
      <div className="mt-4 space-y-1.5 border-t border-dashed border-border pt-3 text-[10.5px] leading-relaxed text-muted-foreground">
        <p className="tabular-nums">
          체류 30분↑ <b className="text-foreground">{n(perf.stay30)}명</b> · 60분↑ <b className="text-foreground">{n(perf.stay60)}명</b>
          {perf.entered > 0 && <span>{` (시청자의 ${pct(perf.stay30, perf.entered)}% · ${pct(perf.stay60, perf.entered)}%)`}</span>}
        </p>
        <p className="tabular-nums">
          마케팅 수신 동의 <b className="text-foreground">{n(perf.marketingConsented)}명</b>
          <span> — 등록 시점에 받는 값이라 퍼널 단계가 아니에요(노쇼도 포함).</span>
        </p>
        {perf.unlinkedSurveyResponses > 0 && (
          <p className="tabular-nums">
            익명 설문 응답 <b className="text-foreground">{n(perf.unlinkedSurveyResponses)}건</b>
            <span> — 등록자와 연결되지 않아 퍼널에서 제외했어요(공유 링크로 응답한 경우).</span>
          </p>
        )}
      </div>
    </>
  );
}

const QA_STATUS: Record<string, { label: string; cls: string }> = {
  answered: { label: "답변", cls: "bg-green-500/10 text-green-600 dark:text-green-400" },
  pending: { label: "대기", cls: "bg-secondary text-muted-foreground" },
  dismissed: { label: "숨김", cls: "bg-secondary text-muted-foreground" },
};

const SEG_BAR: { key: "hot" | "warm" | "cold" | "noShow"; label: string; color: string }[] = [
  { key: "hot", label: "핫", color: "var(--chart-entered)" },
  { key: "warm", label: "웜", color: "#f59e0b" },
  { key: "cold", label: "콜드", color: "var(--chart-chat)" },
  { key: "noShow", label: "노쇼", color: "color-mix(in srgb, var(--muted-foreground) 35%, transparent)" },
];
const SEG_BADGE: Record<"hot" | "warm" | "cold", string> = {
  hot: "bg-green-500/10 text-green-600 dark:text-green-400",
  warm: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cold: "bg-secondary text-muted-foreground",
};
/** 세그먼트 정의 — 라벨만 있으면 "핫이 뭔데?" 를 알 수 없었다. 카드 본문에도 경계를 적어둔다. */
const SEG_HINT: Record<"hot" | "warm" | "cold" | "noShow", string> = {
  hot: "65점 이상 — 끝까지 보면서 행동(투표·질문·CTA)이나 마케팅 동의가 있는 리드",
  warm: "30~64점 — 참석했지만 반응이 적거나 중간에 이탈",
  cold: "30점 미만 — 잠깐 들렀다 나간 경우",
  noShow: "등록했지만 입장하지 않음",
};

/** 점수 배지 title — 마우스를 올리면 네 덩어리 합이 보인다. */
function scoreBreakdownText(t: TopEngaged): string {
  const b = t.breakdown;
  const capped = b.interactRaw > b.interact ? ` (원점수 ${b.interactRaw}, 30점에서 멈춤)` : "";
  return `참석 ${b.attend} + 체류 ${b.watch} (${t.watchMinutes}/${b.evaluatedMinutes}분) + 행동 ${b.interact}${capped} + 인텐트 ${b.intent} = ${t.score}점`;
}

/** 점수 구성 네 덩어리의 색 — 세그먼트 색과 겹치지 않게 별도 계열을 쓴다. */
const COMPOSITION_PARTS = [
  { key: "attend" as const, label: "참석", color: "var(--chart-viewers)", hint: "입장하면 고정 25점" },
  { key: "watch" as const, label: "체류", color: "var(--chart-entered)", hint: "방송 경과 대비 시청 비율 · 최대 35점" },
  { key: "interact" as const, label: "행동", color: "#f59e0b", hint: "채팅·투표·질문·CTA·공유 · 최대 30점" },
  { key: "intent" as const, label: "인텐트", color: "#8b5cf6", hint: "마케팅 수신 동의 10점" },
];

/**
 * 세분화 표 한 덩어리 — 업종·직함이 같은 모양을 쓴다.
 *
 * 등록 수(막대)와 평균 점수를 한 줄에 붙인다: "많이 왔는가" 와 "잘 왔는가" 는 다른 질문이고,
 * 둘을 같이 봐야 다음 웨비나의 타깃을 정할 수 있다.
 * 방송 전에는 평균·핫이 전부 0 이라 구성(등록 수)만 보여준다.
 */
function FacetTable({ rows, showScore, minSample }: { rows: FacetRow[]; showScore: boolean; minSample: number }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">아직 집계할 값이 없어요.</p>;
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate" title={r.label}>{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {n(r.total)}명
              {showScore && (
                <>
                  {" · "}
                  <b
                    className={r.reliable ? "text-foreground" : "text-muted-foreground/60"}
                    title={r.reliable ? `입장 ${n(r.entered)}명의 평균` : `표본 ${n(r.total)}명 — ${n(minSample)}명 미만이라 평균을 믿기 어려워요`}
                  >
                    평균 {n(r.avgScore)}점
                  </b>
                  {r.hot > 0 && <span className="text-green-600 dark:text-green-400">{` · 핫 ${n(r.hot)}`}</span>}
                  {!r.reliable && <span className="text-muted-foreground/60">{" · 표본 부족"}</span>}
                </>
              )}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct(r.total, max)}%` }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="h-full rounded-full bg-violet-500"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 리드 분석 패널 — 세그먼트 4칸으로는 **다음 웨비나를 어떻게 바꿀지** 알 수 없다.
 *
 * 네 덩어리를 2열로 깐다:
 *   분포(경계가 맞나) | 점수 구성(무엇이 점수를 만들었나)
 *   업종별            | 직함별
 * 행동 리프트는 그 행동을 한 사람이 있을 때만 아래 전체 폭으로.
 *
 * 방송 전에는 점수가 전부 0 이므로 업종·직함 **구성**만 남긴다 —
 * "우리 리드가 어느 업종·직급으로 채워졌나" 는 그때도 쓸 수 있는 정보다.
 */
function LeadAnalysisSection({ la, showScore }: { la: LeadAnalysis; showScore: boolean }) {
  const comp = la.composition;
  const hist = la.histogram;
  const histMax = Math.max(...hist.map((b) => b.count), 1);
  const scored = hist.reduce((s, b) => s + b.count, 0);
  // 그 행동을 한 사람이 아무도 없는 줄은 뺀다 — 0 vs 0 비교는 화면만 채운다.
  const lift = la.lift.filter((l) => l.withCount > 0);

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {showScore && (
          <SectionCard>
            <div className="mb-4">
              <h3 className="text-sm font-semibold">점수 분포</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                입장자 {n(scored)}명의 10점 구간 분포 · 세그먼트 4칸으로는 안 보이는 쏠림을 확인해요.
              </p>
            </div>
            {scored === 0 ? (
              <p className="text-xs text-muted-foreground">입장한 참여자가 없어요.</p>
            ) : (
              <>
                <div className="flex h-28 items-end gap-1">
                  {hist.map((b) => (
                    <div key={b.from} className="flex flex-1 flex-col items-center gap-1" title={`${b.from}~${b.to}점 · ${n(b.count)}명`}>
                      <span className="text-[9px] tabular-nums text-muted-foreground">{b.count || ""}</span>
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(b.count ? 4 : 0, pct(b.count, histMax))}%` }}
                        transition={{ duration: 0.45, ease: "easeOut" }}
                        // 핫 경계(65점)를 넘는 칸은 초록 — 경계가 어디인지 막대에서 바로 읽히게
                        className={`w-full rounded-t ${b.from >= 60 ? "bg-green-500/70" : "bg-violet-500/60"}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-1 text-[9px] tabular-nums text-muted-foreground">
                  {hist.map((b) => (
                    <span key={b.from} className="flex-1 text-center">{b.from}</span>
                  ))}
                </div>
                <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
                  60~69 칸에 사람이 뭉쳐 있으면 <b>끝까지 봤지만 아무 행동도 하지 않은 시청자</b>가 많다는 뜻이에요 —
                  다음 웨비나에 투표·질문 유도를 넣을 근거가 돼요.
                </p>
              </>
            )}
          </SectionCard>
        )}

        {showScore && (
          <SectionCard>
            <div className="mb-4">
              <h3 className="text-sm font-semibold">점수 구성</h3>
              <p className="mt-1 text-xs text-muted-foreground">입장자 점수 총합이 어디서 왔는지 — 이번 웨비나의 성격이 한 줄로 보여요.</p>
            </div>
            {comp.total === 0 ? (
              <p className="text-xs text-muted-foreground">입장한 참여자가 없어요.</p>
            ) : (
              <>
                <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-secondary">
                  {COMPOSITION_PARTS.map((p) =>
                    comp[p.key] > 0 ? <div key={p.key} style={{ width: `${pct(comp[p.key], comp.total)}%`, background: p.color }} /> : null,
                  )}
                </div>
                <div className="space-y-1.5">
                  {COMPOSITION_PARTS.map((p) => (
                    <div key={p.key} className="flex items-baseline justify-between text-[11px]" title={p.hint}>
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                        {p.label}
                      </span>
                      <span className="tabular-nums">
                        <b>{pct(comp[p.key], comp.total)}%</b>
                        <span className="text-muted-foreground">{` · ${n(comp[p.key])}점`}</span>
                      </span>
                    </div>
                  ))}
                </div>
                {comp.interact === 0 && (
                  <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
                    <b>행동 기여도가 0</b> 이에요 — 아무도 채팅·투표·질문·CTA를 남기지 않았어요. 시청은 했지만 참여는 없던 웨비나예요.
                  </p>
                )}
              </>
            )}
          </SectionCard>
        )}

        <SectionCard>
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{la.fieldLabels?.industry ? `${la.fieldLabels.industry} 답변별 리드` : "업종별 리드"}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {la.fieldLabels?.industry
                ? "등록 폼에서 받은 답변 구성이에요."
                : showScore ? "어느 업종이 실제로 관심이 있었는지 — 다음 웨비나 주제·타깃의 근거예요." : "등록 폼의 업종 구성이에요. 방송이 끝나면 업종별 평균 점수도 함께 보여드려요."}
            </p>
          </div>
          <FacetTable rows={la.byIndustry} showScore={showScore} minSample={la.minReliableSample} />
        </SectionCard>

        <SectionCard>
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{la.fieldLabels?.jobTitle ? `${la.fieldLabels.jobTitle} 답변별 리드` : "직함별 리드"}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {showScore
                ? "결정권자가 실제로 끝까지 봤는지 — 영업 우선순위와 콘텐츠 난이도의 근거예요."
                : "직함을 결재선 기준으로 묶었어요(대표·대표이사·CEO가 갈리지 않게)."}
            </p>
          </div>
          <FacetTable rows={la.byRole} showScore={showScore} minSample={la.minReliableSample} />
        </SectionCard>
      </div>

      {showScore && lift.length > 0 && (
        <SectionCard>
          <div className="mb-4">
            <h3 className="text-sm font-semibold">행동한 사람은 원래 더 열심이었나</h3>
            {/* 이 카드의 정직성이 여기 달렸다 — 행동 가점을 포함하면 동어반복이 된다. */}
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              그 행동을 한 사람과 안 한 사람의 점수를 비교해요. <b>그 행동으로 받은 가점은 빼고</b> 비교합니다 —
              투표하면 4점이 붙으니, 그걸 포함하면 “투표한 사람이 점수가 높다”는 당연한 말이 되거든요.
              참석·체류·인텐트만으로 비교해야 “투표한 사람은 원래 더 오래 봤다”를 알 수 있어요.
            </p>
          </div>
          <div className="space-y-2">
            {lift.map((l) => {
              const diff = l.withAvg - l.withoutAvg;
              return (
                <div key={l.action} className="flex items-center gap-3 rounded-xl border border-border p-2.5 text-[11px]">
                  <span className="w-16 shrink-0 font-medium">{l.action}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{n(l.withCount)}명</span>
                  <span className="flex-1 tabular-nums">
                    <b className={l.reliable ? "" : "text-muted-foreground/60"}>{n(l.withAvg)}점</b>
                    <span className="text-muted-foreground">{` vs 안 한 사람 ${n(l.withoutAvg)}점`}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 font-semibold tabular-nums ${
                      diff > 0 ? "bg-green-500/10 text-green-600 dark:text-green-400" : diff < 0 ? "bg-secondary text-muted-foreground" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {diff > 0 ? `+${n(diff)}` : n(diff)}
                  </span>
                  {!l.reliable && <span className="shrink-0 text-muted-foreground/60">표본 부족</span>}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </>
  );
}

const SHARE_SURFACE_LABEL: Record<string, string> = {
  waiting: "대기 화면",
  live: "시청 화면",
  ended: "종료 화면",
  landing: "랜딩 페이지",
};

/**
 * 입소문 — 시청자가 자기 추천 링크로 퍼뜨린 결과.
 *
 * 세 숫자가 한 줄로 읽혀야 한다: 공유한 사람 → 그 링크로 들어온 방문 → 실제 등록.
 * 상위 추천인은 "누구에게 고맙다고 해야 하는가" 이자, 다음 웨비나에 먼저 알릴 명단이다.
 */
function WordOfMouthSection({ wom }: { wom: WordOfMouth }) {
  const steps = [
    { label: "공유한 사람", value: wom.sharers, sub: `공유 ${n(wom.shares)}회` },
    { label: "추천 링크 방문", value: wom.clicks, sub: wom.sharers ? `1명당 ${(wom.clicks / wom.sharers).toFixed(1)}명` : "" },
    { label: "추천으로 등록", value: wom.registered, sub: wom.clicks ? `전환 ${pct(wom.registered, wom.clicks)}%` : "" },
  ];
  return (
    <SectionCard>
      <div className="mb-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Share2 className="h-4 w-4 text-violet-500" /> 입소문</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          시청자가 공유 버튼으로 직접 퍼뜨린 결과예요. 공유 링크에는 각자의 추천 코드가 붙어 있어서 누가 몇 명을 데려왔는지 이어져요.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        {steps.map((s) => (
          <div key={s.label} className="rounded-xl bg-secondary/60 p-3">
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">{n(s.value)}</div>
            {s.sub && <div className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">{s.sub}</div>}
          </div>
        ))}
      </div>

      {wom.bySurface.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>어디서 공유했나</span>
          {wom.bySurface.map((s) => (
            <span key={s.surface}>
              {SHARE_SURFACE_LABEL[s.surface] ?? s.surface} <b className="tabular-nums text-foreground">{n(s.count)}</b>
            </span>
          ))}
        </div>
      )}

      {wom.top.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground">가장 많이 데려온 사람</p>
          <div className="space-y-1.5">
            {wom.top.map((t, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-sm font-bold tabular-nums text-violet-600 dark:text-violet-400">
                  {n(t.registered)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <span className="truncate">{t.name}</span>
                    {t.company && <span className="truncate text-muted-foreground">· {t.company}</span>}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">
                    공유 {n(t.shares)}회 · 링크 방문 {n(t.clicks)} · 등록 {n(t.registered)}명
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * 방송 전 화면 — 세그먼트 막대 대신 "지금 확보한 리드로 할 수 있는 일".
 * 이 자리에 세그먼트를 그리면 입장이 0 이라 **노쇼 100%** 가 되고, 아직 열리지도 않은
 * 웨비나가 실패한 것처럼 보인다(실측: 등록 254명 웨비나가 노쇼 254 · 100%).
 */
function LeadQualityBeforeLive({ total, q }: { total: number; q: Scoring["leadQuality"] }) {
  if (total === 0) return <p className="text-xs text-muted-foreground">아직 등록자가 없어요.</p>;
  const items = [
    { label: "마케팅 수신 동의", value: q.consented, hint: "다음 웨비나 초대·소식 발송이 가능한 리드" },
    { label: "이메일 확보", value: q.withEmail, hint: "리마인더 메일을 받을 수 있는 등록자" },
    { label: "연락처 확보", value: q.withPhone, hint: "문자·전화 팔로업이 가능한 등록자" },
    { label: "회사 기입", value: q.withCompany, hint: "B2B 리드 판별에 쓰는 값" },
  ];
  return (
    <div>
      <div className="mb-4 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">{n(total)}</span>
        <span className="text-xs text-muted-foreground">명 등록</span>
      </div>
      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.label} title={it.hint}>
            <div className="mb-1 flex items-baseline justify-between text-[11px]">
              <span className="text-muted-foreground">{it.label}</span>
              <span className="font-medium tabular-nums">{n(it.value)}명 · {pct(it.value, total)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct(it.value, total)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="h-full rounded-full bg-violet-500"
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[10.5px] leading-relaxed text-muted-foreground">
        방송이 시작되면 참석·체류·인터랙션을 합성한 참여 점수와 핫·웜·콜드 세그먼트가 여기 표시돼요.
      </p>
    </div>
  );
}

export default function AnalyticsTab({ webinarId }: { webinarId: string }) {
  const colors = useChartColors();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [curve, setCurve] = useState<CurveData | null>(null);
  // 전체 범위 곡선 — KPI 카드(피크·평균)는 타임라인 범위 토글과 무관하게 이 값을 쓴다.
  const [fullCurve, setFullCurve] = useState<CurveData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [range, setRange] = useState<Range>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [curveLoading, setCurveLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const fetchCore = useCallback(async (quiet = false) => {
    if (quiet) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(false);
    try {
      const [aRes, actRes] = await Promise.all([
        fetch(`/api/webinars/${webinarId}/analytics`),
        fetch(`/api/webinars/${webinarId}/activity`),
      ]);
      if (!aRes.ok) throw new Error("analytics load failed");
      setData(await aRes.json());
      setActivity(actRes.ok ? (await actRes.json()).items ?? [] : []);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [webinarId]);

  const fetchCurve = useCallback(async (r: Range) => {
    setCurveLoading(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/analytics/attendance-curve?range=${r}`);
      if (!res.ok) return;
      const next: CurveData = await res.json();
      setCurve(next);
      // KPI(피크·평균)는 방송 전체 기준이어야 한다 — 타임라인 범위(30분/60분)를 좁히면
      // 그 구간의 피크가 카드에 찍혀 실제보다 작은 숫자가 보인다.
      if (r === "all") setFullCurve(next);
    } finally {
      setCurveLoading(false);
    }
  }, [webinarId]);

  useEffect(() => { void fetchCore(); }, [fetchCore]);
  useEffect(() => { void fetchCurve(range); }, [range, fetchCurve]);

  // 좁은 범위를 보고 있어도 KPI 는 전체 기준이라 'all' 곡선도 함께 갱신한다.
  const refreshAll = () => { void fetchCore(true); void fetchCurve(range); if (range !== "all") void fetchCurve("all"); };

  /**
   * 등록자 명단 내보내기 — RegistrantsTab.tsx 의 downloadRegistrantsCsv 와 같은 방식으로 맞춘다.
   * 예전엔 window.open(url, "_blank") 을 썼는데, 이 라우트가 MEMBER 권한을 403 으로 막으면
   * 빈 새 탭에 원문 JSON 이 그대로 뜨고 이 화면엔 아무 피드백도 남지 않았다 — fetch 로 바꿔
   * 실패는 토스트로 알리고, 성공하면 blob 을 내려받는다. 헤더로 온 미연결 설문·문의 건수도
   * 명단에서 빠진 이유를 그 자리에서 안내한다.
   */
  const exportCsv = async () => {
    const res = await fetch(`/api/webinars/${webinarId}/registrations/export`);
    if (!res.ok) {
      const msg = await res.json().then((d) => d?.error).catch(() => null);
      toast.error(msg || "내보내기 실패");
      return;
    }
    const unlinkedSurveys = Number(res.headers.get("X-Mach-Unlinked-Surveys") ?? 0);
    const unlinkedQa = Number(res.headers.get("X-Mach-Unlinked-Qa") ?? 0);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `registrations-${webinarId}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    const unlinked = [
      unlinkedSurveys > 0 ? `설문 응답 ${unlinkedSurveys}건` : null,
      unlinkedQa > 0 ? `문의 ${unlinkedQa}건` : null,
    ].filter(Boolean);
    if (unlinked.length) {
      toast.info(`${unlinked.join(" · ")}은 등록자와 연결되지 않아 명단에 없어요`, {
        description: "공유 링크로 답하거나 미검증 상태로 남긴 것들이에요.",
      });
    }
  };

  // 운영 이벤트를 시청 곡선의 버킷에 스냅 (fromMs + i*bucketMs)
  const events = useMemo(() => {
    const pts = curve?.points ?? [];
    if (!pts.length || !curve?.fromMs || !curve?.bucketMs) return [] as { label: string; text: string }[];
    const seen = new Set<string>();
    const out: { label: string; text: string }[] = [];
    for (const a of activity) {
      if (!EVENT_RE.test(a.action)) continue;
      const idx = Math.round((new Date(a.at).getTime() - curve.fromMs) / curve.bucketMs);
      if (idx < 0 || idx >= pts.length) continue;
      const label = pts[idx].label;
      const key = `${label}|${a.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label, text: a.label });
      if (out.length >= 12) break;
    }
    return out;
  }, [activity, curve]);
  const eventLabels = useMemo(() => Array.from(new Set(events.map((e) => e.label))), [events]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <InlineError message="분석을 불러오지 못했어요" onRetry={() => void fetchCore()} />
      </div>
    );
  }

  const { funnel, interactions, scoring } = data;
  /* 성과 퍼널 — 서버가 안 내려주는 옛 응답(캐시된 탭 등)에서는 기존 참가 퍼널로 폴백한다. */
  const perf = data.performanceFunnel;
  const utm = data.utmBreakdown ?? [];
  const campaigns = data.campaignBreakdown ?? [];
  const trend = data.registrationTrend ?? [];
  const hasVisits = data.hasVisitData;
  const unmatchedAdCampaigns = data.unmatchedAdCampaigns ?? [];
  // 광고비 합산 기간 — 캠페인 표 캡션용. 스키마에 webinarId 가 없어 기간으로만 좁힐 수 있다.
  const costScope = data.costScope
    ? `${formatKst(data.costScope.from, { month: "numeric", day: "numeric" })}~${formatKst(data.costScope.to, { month: "numeric", day: "numeric" })}`
    : null;
  const funnelBase = hasVisits ? funnel.visits : funnel.registered;
  const peak = fullCurve?.peak ?? curve?.peak ?? 0;
  const avgConc = fullCurve?.avg ?? curve?.avg ?? 0;
  const chatParticipation = pct(interactions.chat.participants, funnel.attended);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">분석</h2>
          <p className="mt-1 text-sm text-muted-foreground">방송이 만든 참여와 성과를 한눈에 — 유입부터 시청·인터랙션까지.</p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} transition={spring} onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-secondary">
            <Download className="h-3.5 w-3.5" /> 등록자 명단 내보내기
          </motion.button>
          <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} transition={spring} onClick={refreshAll} disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-secondary disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} /> 새로고침
          </motion.button>
        </div>
      </div>

      {/* 요약 KPI — 방송 성적 한 줄 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="총 등록" value={n(funnel.registered)} sub={hasVisits ? `방문 ${n(funnel.visits)} · 등록률 ${funnel.regRate}%` : "사전 등록"} />
        <Stat label="실제 입장" value={n(funnel.attended)} sub={`입장률 ${funnel.attendRate}%`} />
        <Stat label="피크 동시 시청" value={n(peak)} sub={`평균 ${n(avgConc)}명`} />
        <Stat label="평균 시청" value={`${n(funnel.avgStayMinutes)}분`} sub={`최대 ${n(funnel.maxStayMinutes)}분`} />
        <Stat label="30분+ 체류" value={n(funnel.stay30)} sub={`입장 대비 ${funnel.stay30Rate}%`} tone="green" />
        <Stat label="Q&A" value={n(interactions.qa.total)} sub={`답변율 ${interactions.qa.answerRate}%`} />
        <Stat label="채팅" value={n(interactions.chat.messages)} sub={`참여자 ${n(interactions.chat.participants)}명`} />
        <Stat label="리마인더 옵트인" value={n(interactions.reminders)} sub="알림 받고 이어보기" />
      </div>

      {/* 통합 타임라인 — 시청·입장·채팅 + 운영 이벤트 */}
      <SectionCard>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-violet-500" /> 시청·참여 타임라인</h3>
            <p className="mt-1 text-xs text-muted-foreground">분당 동시 시청자와 누적 입장·채팅량을, 운영 이벤트(세로 점선)와 함께 봅니다.</p>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.k}
                onClick={() => setRange(r.k)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${range === r.k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* 범례 */}
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "var(--chart-viewers)" }} /> 동시 시청</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-full" style={{ background: "var(--chart-entered)" }} /> 누적 입장</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2 rounded-sm" style={{ background: "var(--chart-chat)" }} /> 채팅(우축)</span>
        </div>

        {!curve || !curve.hasData ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {curveLoading ? "불러오는 중…" : "아직 시청 기록이 없어요. 라이브가 진행되면 시간대별 곡선이 그려져요."}
          </p>
        ) : (
          <>
            <div
              className="h-64"
              style={{ opacity: curveLoading ? 0.5 : 1, transition: "opacity .2s" }}
              role="img"
              aria-label={`시청 곡선 — 피크 ${n(peak)}명, 평균 ${n(avgConc)}명. 아래 표와 지표 카드에 같은 수치가 있어요.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={curve.points} margin={{ top: 6, right: 4, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="viewersFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={colors.viewers} stopOpacity={0.24} />
                      <stop offset="95%" stopColor={colors.viewers} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={{ stroke: colors.grid }} minTickGap={26} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.axis, strokeOpacity: 0.25 }} />
                  {eventLabels.map((l) => (
                    <ReferenceLine key={l} yAxisId="left" x={l} stroke={colors.axis} strokeOpacity={0.45} strokeDasharray="2 3" />
                  ))}
                  <Bar yAxisId="right" dataKey="chat" name="채팅" fill={colors.chat} fillOpacity={0.45} barSize={9} radius={[2, 2, 0, 0]} />
                  <Area yAxisId="left" type="monotone" dataKey="viewers" name="동시 시청" stroke={colors.viewers} strokeWidth={2} fill="url(#viewersFill)" />
                  <Line yAxisId="left" type="monotone" dataKey="entered" name="누적 입장" stroke={colors.entered} strokeWidth={2} strokeDasharray="5 3" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {events.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
                {events.map((e, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-[10.5px] text-muted-foreground">
                    <span className="font-medium tabular-nums text-foreground/70">{e.label}</span> {e.text}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* 참여 성적표 — 투표 / Q&A 아카이브 */}
      <SectionCard>
        <div className="mb-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="h-4 w-4 text-violet-500" /> 참여 성적표</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            라이브 중 띄운 투표 결과와 Q&A 반응 · 채팅 참여율 {chatParticipation}% (입장 {n(funnel.attended)}명 중 {n(interactions.chat.participants)}명 발언) · CTA 클릭 {n(interactions.cta.clicks)}건 (클릭자 {n(interactions.cta.clickers)}명)
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {/* 투표 결과 */}
          <div>
            <p className="mb-2.5 text-xs font-semibold text-muted-foreground">투표 결과 <span className="tabular-nums">({interactions.polls.length})</span></p>
            {interactions.polls.length === 0 ? (
              <p className="text-xs text-muted-foreground">진행한 투표가 없어요.</p>
            ) : (
              <div className="space-y-3">
                {interactions.polls.map((poll) => {
                  const max = Math.max(...poll.options.map((o) => o.voteCount), 0);
                  return (
                    <div key={poll.id} className="rounded-xl border border-border p-3">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <p className="text-xs font-medium leading-snug">
                          {poll.isActive && <span className="mr-1.5 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400">ON</span>}
                          {poll.question}
                        </p>
                        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{n(poll.totalVotes)}표</span>
                      </div>
                      <div className="space-y-1.5">
                        {poll.options.map((o, oi) => {
                          const p = pct(o.voteCount, poll.totalVotes);
                          const win = o.voteCount === max && max > 0;
                          return (
                            <div key={oi} className="relative overflow-hidden rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px]">
                              <div className="absolute inset-y-0 left-0" style={{ width: `${p}%`, background: win ? "var(--chart-viewers)" : "var(--chart-chat)", opacity: win ? 0.18 : 0.12 }} />
                              <div className="relative flex items-center justify-between gap-2">
                                <span className="truncate">{o.label}</span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">{n(o.voteCount)} · {p}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Q&A */}
          <div>
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">Q&A</p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                <HelpCircle className="mr-1 inline h-3 w-3" />{n(interactions.qa.total)}건 · 답변율 {interactions.qa.answerRate}%
              </p>
            </div>
            {interactions.qa.top.length === 0 ? (
              <p className="text-xs text-muted-foreground">등록된 질문이 없어요.</p>
            ) : (
              <div className="space-y-2">
                {interactions.qa.top.map((q, i) => {
                  const st = QA_STATUS[q.status] ?? QA_STATUS.pending;
                  return (
                    <div key={i} className="flex items-start gap-2.5 rounded-xl border border-border p-2.5">
                      <span className="mt-0.5 flex h-6 min-w-8 items-center justify-center rounded-md bg-secondary px-1.5 text-[11px] font-semibold tabular-nums">▲{q.voteCount}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs leading-snug">{q.question}</p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.label}</span>
                          {q.name && <span className="truncate text-[10px] text-muted-foreground">{q.name}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* 설문 결과 — 자체 설문이 있을 때만 표시 */}
      <SurveyResultsSection webinarId={webinarId} />

      {/* 리드 요약 + 참가 퍼널 — 좌우 2열.
          둘 다 "몇 명이 어디까지 왔나" 를 읽는 카드라 나란히 둬야 한 화면에서 대조된다.
          예전엔 전체 폭 카드로 한 줄씩 쌓여서, 방송 전에는 막대 4개 + 막대 5개를 보려고
          두 번 스크롤해야 했다. 방송 후에는 상위 참여자 **명단**을 이 요약에서 떼어
          아래 전체 폭 카드로 내린다(요약 먼저, 디테일은 아래로 — 읽는 영역 원칙). */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <SectionCard>
          <div className="mb-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Users className="h-4 w-4 text-violet-500" /> {scoring.phase === "before" ? "확보한 리드" : "리드 스코어링"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {scoring.phase === "before"
                ? "아직 방송 전이라 참여 점수를 매길 수 없어요. 지금 확보한 리드로 할 수 있는 일을 보여드려요."
                : "참석·체류·인터랙션·마케팅 동의를 합성한 0~100 참여 점수 · 내보내기 CSV에 점수·세그먼트가 포함돼요."}
            </p>
          </div>

          {scoring.phase === "before" ? (
            <LeadQualityBeforeLive total={scoring.total} q={scoring.leadQuality} />
          ) : (
            <>
              <div className="mb-2">
                <div className="mb-2 flex h-2.5 overflow-hidden rounded-full bg-secondary">
                  {SEG_BAR.map((s) => {
                    const c = scoring.distribution[s.key];
                    return c > 0 ? <div key={s.key} style={{ width: `${pct(c, scoring.total)}%`, background: s.color }} /> : null;
                  })}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  {SEG_BAR.map((s) => (
                    <span key={s.key} className="inline-flex items-center gap-1.5 text-muted-foreground" title={SEG_HINT[s.key]}>
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.label} <b className="tabular-nums text-foreground">{n(scoring.distribution[s.key])}</b> · {pct(scoring.distribution[s.key], scoring.total)}%
                    </span>
                  ))}
                </div>
              </div>

              {/* 점수 기준을 화면에 밝힌다 — "핫이 뭔데?" 를 툴팁으로만 두면 아무도 안 본다.
                  방송 중이면 분모가 계속 자라므로 그 사실도 함께 알린다(같은 사람의 점수가 올라간다). */}
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                핫 65점↑ · 웜 30점↑ · 콜드 30점 미만.{" "}
                {scoring.phase === "live"
                  ? `방송이 진행 중이라 지금까지 흐른 ${n(scoring.liveMinutes)}분을 기준으로 계산해요 — 방송이 길어지면 점수도 함께 올라가요.`
                  : scoring.liveMinutes < scoring.scheduledMinutes
                    ? `실제 방송 ${n(scoring.liveMinutes)}분 기준(예정 ${n(scoring.scheduledMinutes)}분)으로 계산했어요.`
                    : `방송 ${n(scoring.liveMinutes)}분 기준으로 계산했어요.`}
              </p>

              {scoring.retargetCount > 0 && (
                /* 노쇼 + 마케팅 동의 — 5점 콜드라 상위 참여자에는 절대 안 나오는데, 웨비나 다음 액션에서
                   제일 큰 덩어리다. 여기서 숫자만 알리고 실제 명단은 등록자 탭 필터로 넘긴다. */
                <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-secondary/60 p-3">
                  <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
                  <p className="text-[11px] leading-relaxed">
                    <b className="tabular-nums">{n(scoring.retargetCount)}명</b>은 오지 않았지만 마케팅 정보 수신에 동의했어요 — 다시보기 안내나 다음 웨비나 초대를 보낼 수 있는 리드예요.
                    <span className="text-muted-foreground"> 등록자 탭에서 세그먼트를 ‘노쇼’로 걸러 명단을 확인하세요.</span>
                  </p>
                </div>
              )}
            </>
          )}
        </SectionCard>

        {/* 성과 퍼널 — '참가 퍼널' 을 대체한다. 시청까지가 아니라 **상담 희망까지** 가는 경로를 본다. */}
        <SectionCard>
          {perf ? <PerformanceFunnelBody perf={perf} /> : (
            <>
              <div className="mb-4">
                <h3 className="text-sm font-semibold">참가 퍼널</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {hasVisits ? "방문 → 등록 → 입장 → 체류 단계별 전환" : "등록 → 입장 → 체류 (방문 데이터는 아임웹 부착 후 집계돼요)"}
                </p>
              </div>
              <div className="space-y-3.5">
                {hasVisits && <FunnelStep label="페이지 방문" value={funnel.visits} base={funnelBase} color="var(--chart-chat)" delay={0} />}
                <FunnelStep label="사전 등록" value={funnel.registered} base={funnelBase} color="var(--chart-viewers)" delay={0.06} />
                <FunnelStep label="실제 입장" value={funnel.attended} base={funnelBase} color="var(--chart-viewers)" delay={0.12} />
                <FunnelStep label="30분 이상 체류" value={funnel.stay30} base={funnelBase} color="var(--chart-entered)" delay={0.18} />
                <FunnelStep label="60분 이상 체류" value={funnel.stay60} base={funnelBase} color="var(--chart-entered)" delay={0.24} />
              </div>
            </>
          )}
        </SectionCard>
      </div>

      {/* 상위 참여자 — 위 요약에서 떼어낸 디테일. 명단이라 전체 폭이 읽기 편하다. */}
      {scoring.phase !== "before" && (
        <SectionCard>
          <div className="mb-4">
            <h3 className="text-sm font-semibold">상위 참여자</h3>
            <p className="mt-1 text-xs text-muted-foreground">참여 점수가 높은 순 · 전체 명단과 세그먼트 필터는 등록자 탭에 있어요.</p>
          </div>
          {scoring.top.length === 0 ? (
            <p className="text-xs text-muted-foreground">입장한 참여자가 없어 점수를 매길 대상이 없어요.</p>
          ) : (
            <div className="grid gap-1.5 lg:grid-cols-2">
              {scoring.top.map((t, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular-nums ${SEG_BADGE[t.segment]}`}
                    title={scoreBreakdownText(t)}
                  >
                    {t.score}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-xs font-medium">
                      <span className="truncate">{t.name}</span>
                      {t.company && <span className="truncate text-muted-foreground">· {t.company}</span>}
                      {t.agreeMarketing && <span className="shrink-0 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-green-600 dark:text-green-400">동의</span>}
                    </p>
                    {/* 점수 근거를 한 줄로 — 숫자만 보고 CSV 와 대조해야 했던 자리 */}
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">
                      참석 {t.breakdown.attend} + 체류 {t.breakdown.watch} + 행동 {t.breakdown.interact}
                      {t.breakdown.interactRaw > t.breakdown.interact && <span title="인터랙션 점수는 30점에서 멈춰요">{` (원점수 ${t.breakdown.interactRaw})`}</span>}
                      {" "}+ 인텐트 {t.breakdown.intent}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">
                      체류 {n(t.watchMinutes)}/{n(t.breakdown.evaluatedMinutes)}분 · 채팅 {n(t.chat)} · 투표 {n(t.pollVotes)} · Q&A {n(t.qaAsks)}{t.qaUpvotes ? ` · 추천 ${n(t.qaUpvotes)}` : ""}{t.ctaClicks ? ` · CTA ${n(t.ctaClicks)}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* 리드 분석 — 점수를 결정에 쓸 수 있는 축(분포·구성·업종·직함·행동)으로 쪼갠다.
          방송 전에는 점수가 전부 0 이라 업종·직함 구성만 남긴다. */}
      {data.leadAnalysis && (
        <LeadAnalysisSection la={data.leadAnalysis} showScore={scoring.phase !== "before"} />
      )}

      {/* 입소문 — 시청자가 직접 퍼뜨린 결과. 아무도 공유하지 않았으면 섹션을 숨긴다
          (빈 껍데기를 보여주지 않는다 — 공개 면의 이중 게이트 원칙과 같다). */}
      {data.wordOfMouth && data.wordOfMouth.shares > 0 && (
        <WordOfMouthSection wom={data.wordOfMouth} />
      )}
      {/* 일자별 등록 추이 */}
      {trend.length > 0 && (
        <SectionCard>
          <h3 className="text-sm font-semibold">일자별 등록 추이</h3>
          <div className="mt-4 h-28">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={{ stroke: colors.grid }} tickFormatter={(d: string) => d.slice(5)} minTickGap={16} />
                <YAxis tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: colors.grid, fillOpacity: 0.4 }} />
                <Bar dataKey="count" name="등록" fill={colors.viewers} radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      )}

      {/* 유입 채널별 성과 */}
      <SectionCard>
        <h3 className="text-sm font-semibold">유입 채널별 성과</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          등록 광고·캠페인이 어디서 성과를 냈는지 소스·매체로 나눠 봅니다.
          {hasVisits && " 방문은 임베드·자체 랜딩·라이브 면에 도달한 세션이에요 — 등록이 방문보다 많으면 방문 집계 전에 쌓인 등록이에요."}
        </p>
        {utm.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">아직 유입 데이터가 없어요.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">소스</th>
                  <th className="py-2 pr-3 font-medium">매체</th>
                  {hasVisits && <th className="py-2 pr-3 text-right font-medium">방문</th>}
                  <th className="py-2 pr-3 text-right font-medium">등록</th>
                  {hasVisits && <th className="py-2 pr-3 text-right font-medium">등록률</th>}
                  <th className="py-2 pr-3 text-right font-medium">입장</th>
                  <th className="py-2 pr-3 text-right font-medium">입장률</th>
                  {/* 리드 품질 — 등록 수만으로는 "많이 왔다" 만 알 수 있다. 그 리드가 좋았는지는 여기서 답한다. */}
                  <th className="py-2 pr-3 text-right font-medium" title="입장자 평균 참여 점수">평균 점수</th>
                  <th className="py-2 text-right font-medium" title="입장자 중 핫(65점 이상) 비율">핫 비율</th>
                </tr>
              </thead>
              <tbody>
                {utm.map((row, i) => (
                  <motion.tr key={`${row.source}:${row.medium}:${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, delay: Math.min(i * 0.03, 0.3) }} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3 font-medium">{SOURCE_LABEL[row.source] ?? row.source}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{SOURCE_LABEL[row.medium] ?? row.medium}</td>
                    {hasVisits && <td className="py-2 pr-3 text-right tabular-nums">{n(row.visits)}</td>}
                    <td className="py-2 pr-3 text-right tabular-nums">{n(row.registered)}</td>
                    {/* 방문이 0인데 등록이 있으면 등록률은 0% 가 아니라 **알 수 없음**이다.
                        (예: 방문 집계가 붙지 않은 유입 경로) 0% 로 쓰면 "전환이 하나도 없는 채널" 로
                        오독되는데, 실제로는 가장 잘 전환된 채널일 수 있다. */}
                    {hasVisits && (
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {row.visits > 0 ? `${row.regRate}%` : <span className="text-muted-foreground/40" title="이 경로의 방문이 집계되지 않아 등록률을 낼 수 없어요 — 임베드가 붙은 면을 거치지 않은 유입이에요">—</span>}
                      </td>
                    )}
                    <td className="py-2 pr-3 text-right tabular-nums">{n(row.entered)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{row.entryRate}%</td>
                    {/* 표본이 작은 채널(13명 등)의 평균은 노이즈다 — 흐리게 + 사유를 title 로 밝힌다.
                        입장자가 없으면 평균이 0 이 아니라 **없음**이라 — 로 쓴다. */}
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.entered ? (
                        <span
                          className={row.scoreReliable ? "" : "text-muted-foreground/50"}
                          title={row.scoreReliable ? `입장 ${n(row.entered)}명의 평균` : `등록 ${n(row.registered)}명 — 표본이 작아 평균을 믿기 어려워요`}
                        >
                          {n(row.avgScore ?? 0)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40" title="입장자가 없어 평균을 낼 수 없어요">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {row.entered ? (
                        <span className={(row.hot ?? 0) > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
                          {row.hotRate ?? 0}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* 캠페인별 성과 · 광고비 */}
      <SectionCard>
        <h3 className="text-sm font-semibold">캠페인별 성과 · 광고비</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          등록을 캠페인으로 나누고, 광고 성과에 같은 캠페인명이 있으면 광고비를 붙여 등록당·참석당 비용을 냅니다.
          {" "}캠페인명은 대소문자·공백을 무시해 맞춥니다
          {costScope && <> · 광고비는 <b className="font-medium">{costScope}</b> 기간 합계</>}.
        </p>
        {/* 이름이 안 맞아 비용이 안 붙은 광고 캠페인을 밝힌다 — 이게 없으면 운영자는 '—' 를 보고
            "광고비 데이터가 없다" 고만 읽고, 실제 원인(이름 불일치)을 찾을 방법이 없다. */}
        {unmatchedAdCampaigns.length > 0 && (
          <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            광고 캠페인 {unmatchedAdCampaigns.length}개가 등록의 utm_campaign 과 맞지 않아 비용이 붙지 않았어요 —{" "}
            {unmatchedAdCampaigns.slice(0, 3).join(", ")}
            {unmatchedAdCampaigns.length > 3 && ` 외 ${unmatchedAdCampaigns.length - 3}개`}. 광고 리포트의 캠페인명과 링크의 utm_campaign 을 같게 맞춰주세요.
          </p>
        )}
        {campaigns.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">캠페인(utm_campaign) 태그가 붙은 등록이 아직 없어요.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">캠페인</th>
                  <th className="py-2 pr-3 text-right font-medium">등록</th>
                  <th className="py-2 pr-3 text-right font-medium">입장</th>
                  <th className="py-2 pr-3 text-right font-medium">입장률</th>
                  <th className="py-2 pr-3 text-right font-medium">광고비</th>
                  <th className="py-2 pr-3 text-right font-medium">등록당</th>
                  <th className="py-2 text-right font-medium">참석당</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => (
                  <motion.tr key={`${c.campaign}:${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, delay: Math.min(i * 0.03, 0.3) }} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3 font-medium">{c.campaign}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{n(c.registered)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{n(c.entered)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{c.attendRate}%</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.cost != null ? won(c.cost) : <span className="text-muted-foreground/40">—</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.cpr != null ? won(c.cpr) : <span className="text-muted-foreground/40">—</span>}</td>
                    <td className="py-2 text-right tabular-nums">{c.cpa != null ? won(c.cpa) : <span className="text-muted-foreground/40">—</span>}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
