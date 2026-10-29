"use client";

/**
 * "결과 분석" 탭 — 빌더형 등록 전용. 행사가 끝난 뒤 결과보고·내년 기획에 쓰는 **읽는 영역**이다.
 *
 * 위계: 헤드라인 숫자(방문객) → 인사이트 문장 → 등록→방문 전환 → 추이·패턴 → 누가 왔나(인구통계) → 용어·데이터 품질.
 * 숫자는 전부 /api/collect-sources/[id]/analysis(lib/registration-analysis.ts) 한 곳에서 온다 — 정의가 화면마다 갈리지 않게.
 *
 * 맨 위 전환: 전체 · 유형별(General·Buyer·Press …). 유형을 고르면 같은 화면이 그 유형만으로 다시 그려지고,
 * 분기 문항(바이어 전용 등)은 그 유형에서만 보인다. 전체에서는 유형 비교 카드가 추가된다.
 *
 * 동반 인원은 **방문자 수에만** 더한다(인구통계는 모른다). 색: 사전등록 = series-1, 현장등록 = series-2(고정 — 순위로 바꾸지 않는다).
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Info, Lightbulb, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Btn, FINISH, R, Segmented } from "@/components/ui/primitives";
import { useChartColors } from "@/components/ui/use-chart-colors";
import { checkinTimezoneLabel, csvDateTimeIn } from "@/lib/collect-checkin";
import type { AudienceRow, Insight, RegistrationAnalysis, Segment } from "@/lib/registration-analysis";

interface Payload {
  sourceName: string;
  generatedAt: string;
  fields: { companionKey: string | null; visitDateKey: string | null; regionKey: string | null; audienceKey: string | null };
  /** 행사 운영 시간(현지 시) — 시간대별 그래프 가로축 범위 */
  hours?: { open: number | null; close: number | null };
  analysis: RegistrationAnalysis;
  audiences: { value: string; analysis: RegistrationAnalysis }[];
  audienceRows: AudienceRow[];
  /** 연결된 만족도 조사가 있는지 — 있을 때만 "AI로 해석하기" 버튼을 보여준다. */
  hasSurvey: boolean;
  /** ANTHROPIC_API_KEY 가 설정돼 있는지 — 없으면 버튼을 비활성화하고 이유를 알린다. */
  surveyAiAvailable: boolean;
}

interface SurveyAiResult {
  summary: string;
  insights: Insight[];
}

const n = (x: number) => x.toLocaleString("ko-KR");
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`${R.panel} ${FINISH.s1} min-w-0 bg-card p-5 ${className}`}>{children}</section>;
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ChartTip({ active, payload, label, unit = "명" }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={`${R.control} ${FINISH.overlay} bg-popover px-3 py-2 text-xs`}>
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 tabular-nums">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span> {n(p.value)}{unit}
        </p>
      ))}
    </div>
  );
}

function InsightRow({ i }: { i: Insight }) {
  const Icon = i.tone === "good" ? CheckCircle2 : i.tone === "warn" ? AlertTriangle : Lightbulb;
  const color = i.tone === "good" ? "text-emerald-600 dark:text-emerald-400" : i.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-violet-600 dark:text-violet-300";
  return (
    <li className="flex gap-3 py-2.5">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug">{i.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{i.detail}</p>
      </div>
    </li>
  );
}

/** 가로 막대 한 줄 — 표 안에서 비율을 눈으로 읽게 */
function ShareBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div className="h-full rounded-full" style={{ width: `${max ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0}%`, background: color }} />
    </div>
  );
}

/** 전체 화면 전용 — 유형마다 등록·방문·방문율을 한 표로. 비중 막대는 같은 축(전체 대비)이다. */
function AudienceCompare({ rows, colors, onPick }: { rows: AudienceRow[]; colors: { pre: string; onsite: string; reg: string }; onPick: (v: string) => void }) {
  const totalRegs = rows.reduce((a, r) => a + r.regs, 0);
  const totalVis = rows.reduce((a, r) => a + r.visitors, 0);
  const maxShare = Math.max(...rows.flatMap((r) => [totalRegs ? r.regs / totalRegs : 0, totalVis ? r.visitors / totalVis : 0]), 0.0001);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">유형</th>
            <th className="w-[26%] py-1.5 pr-3 font-medium">등록 비중 / 방문자 비중</th>
            <th className="py-1.5 pr-3 text-right font-medium">등록 (사전 · 현장)</th>
            <th className="py-1.5 pr-3 text-right font-medium">순방문 (동반 포함)</th>
            <th className="w-[18%] py-1.5 pr-3 font-medium">방문율 — 사전 / 현장</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const regShare = totalRegs ? r.regs / totalRegs : 0;
            const visShare = totalVis ? r.visitors / totalVis : 0;
            return (
              <tr key={r.value}>
                <td className="py-2 pr-3">
                  <button type="button" onClick={() => onPick(r.value)} className="font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300">{r.value}</button>
                </td>
                <td className="py-2 pr-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2"><ShareBar value={regShare} max={maxShare} color={colors.reg} /><span className="w-11 shrink-0 text-right tabular-nums text-muted-foreground">{pct(regShare)}</span></div>
                    <div className="flex items-center gap-2"><ShareBar value={visShare} max={maxShare} color={colors.pre} /><span className="w-11 shrink-0 text-right font-medium tabular-nums">{pct(visShare)}</span></div>
                  </div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{n(r.regs)}<span className="block text-[11px] text-muted-foreground">{n(r.pre)} · {n(r.onsite)}</span></td>
                <td className="py-2 pr-3 text-right tabular-nums">{n(r.visitors)}<span className="block text-[11px] text-muted-foreground">{r.companions ? `+ 동반 ${n(r.companions)} = ${n(r.visitorsWithCompanions)}` : "동반 없음"}</span></td>
                <td className="py-2 pr-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2"><ShareBar value={r.showUpPre.rate} max={1} color={colors.pre} /><span className="w-11 shrink-0 text-right tabular-nums">{pct(r.showUpPre.rate)}</span></div>
                    <div className="flex items-center gap-2"><ShareBar value={r.showUpOnsite.rate} max={1} color={colors.onsite} /><span className="w-11 shrink-0 text-right tabular-nums">{r.onsite ? pct(r.showUpOnsite.rate) : "-"}</span></div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">유형 이름을 누르면 그 유형만의 분석으로 바뀌어요. 방문자 비중은 동반 제외 사람 기준이에요.</p>
    </div>
  );
}

type SegView = "visitors" | "prePost";

type QColors = { pre: string; onsite: string; reg: string; grid: string; axis: string };
const shortLabel = (v: string, max = 26) => (v.length > max ? `${v.slice(0, max - 1)}…` : v);

/** 질문 하나 = 카드 하나. 가로 막대(값마다 두 줄) + 표로 보기. 같은 축(0~최대 비중)이라 막대 길이를 바로 비교할 수 있다. */
function QuestionCard({ seg, view, colors }: { seg: Segment; view: SegView; colors: QColors }) {
  const visitorsPre = seg.rows.reduce((x, r) => x + r.preVisited, 0);
  const visitorsOnsite = seg.rows.reduce((x, r) => x + r.onsiteVisited, 0);
  const data = seg.rows.map((r) => {
    const reg = seg.answered ? r.regs / seg.answered : 0;
    const vis = seg.visitorsAnswered ? r.visited / seg.visitorsAnswered : 0;
    const pre = visitorsPre ? r.preVisited / visitorsPre : 0;
    const onsite = visitorsOnsite ? r.onsiteVisited / visitorsOnsite : 0;
    return {
      name: r.value,
      a: Math.round((view === "visitors" ? reg : pre) * 1000) / 10,
      b: Math.round((view === "visitors" ? vis : onsite) * 1000) / 10,
      row: r,
    };
  });
  const base = seg.answered ? seg.visitorsAnswered / seg.answered : 0;
  const top = [...seg.rows].filter((r) => r.regs >= 30).sort((x, y) => y.rate - x.rate)[0];
  const height = Math.max(120, data.length * 38 + 28);
  return (
    <Card>
      <div className="mb-2 min-w-0">
        <h4 className="line-clamp-2 text-sm font-medium leading-snug" title={seg.label}>{seg.label}</h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {seg.kind === "multi" ? "복수 선택 · " : ""}응답 {n(seg.answered)}명 · 방문 {n(seg.visitorsAnswered)}명 · 평균 방문율 {pct(base)}
          {top && view === "visitors" && <> · 방문율 최고 <b className="text-foreground">{shortLabel(top.value, 18)}</b> {pct(top.rate)}</>}
        </p>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} unit="%" />
            <YAxis type="category" dataKey="name" width={128} tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={false} tickFormatter={(v: string) => shortLabel(v, 20)} />
            <Tooltip
              cursor={{ fill: colors.grid, fillOpacity: 0.35 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return (
                  <div className={`max-w-[280px] ${R.control} ${FINISH.overlay} bg-popover px-3 py-2 text-xs`}>
                    <p className="mb-1 font-medium">{p.name}</p>
                    {view === "visitors" ? (
                      <>
                        <p className="tabular-nums">등록자 {n(p.row.regs)}명 ({p.a}%) → 방문 {n(p.row.visited)}명 ({p.b}%)</p>
                        <p className="tabular-nums text-muted-foreground">방문율 {pct(p.row.rate)} (평균 {pct(base)})</p>
                      </>
                    ) : (
                      <p className="tabular-nums">사전 방문 {n(p.row.preVisited)}명 ({p.a}%) · 현장 방문 {n(p.row.onsiteVisited)}명 ({p.b}%)</p>
                    )}
                  </div>
                );
              }}
            />
            <Bar dataKey="a" name={view === "visitors" ? "등록자 비중" : "사전등록 방문자"} fill={view === "visitors" ? colors.reg : colors.pre} radius={[0, 4, 4, 0]} maxBarSize={12} />
            <Bar dataKey="b" name={view === "visitors" ? "방문자 비중" : "현장등록 방문자"} fill={view === "visitors" ? colors.pre : colors.onsite} radius={[0, 4, 4, 0]} maxBarSize={12} label={{ position: "right", fontSize: 10, fill: colors.axis, formatter: (v: unknown) => `${v}%` }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">표로 보기 (인원·방문율)</summary>
        <div className="mt-2"><SegmentTable seg={seg} view={view} colors={colors} /></div>
      </details>
    </Card>
  );
}

/** 동반 자녀 수 — 방문자(사람)마다. 방문자 수에만 더하는 값이라 인구통계 카드와 따로 둔다. */
function CompanionCard({ dist, total, color, muted, grid, axis }: { dist: { bucket: string; visitors: number }[]; total: number; color: string; muted: string; grid: string; axis: string }) {
  const answered = dist.filter((d) => d.bucket !== "미응답").reduce((x, d) => x + d.visitors, 0);
  const withKids = dist.filter((d) => d.bucket !== "0" && d.bucket !== "미응답").reduce((x, d) => x + d.visitors, 0);
  return (
    <Card>
      <div className="mb-2">
        <h4 className="text-sm font-medium">동반 자녀 수 (방문자 기준)</h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          답한 방문자 {n(answered)}명 중 {n(withKids)}명({pct(answered ? withKids / answered : 0)})이 아이를 데려왔어요 · 동반 합계 {n(total)}명
        </p>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dist.map((d) => ({ ...d, label: d.bucket === "미응답" ? "미응답" : `${d.bucket}명` }))} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: axis }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: axis }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTip />} cursor={{ fill: grid, fillOpacity: 0.35 }} />
            <Bar dataKey="visitors" name="방문자" radius={[4, 4, 0, 0]} maxBarSize={40} label={{ position: "top", fontSize: 10, fill: axis }}
              shape={(props: unknown) => {
                const p = props as { x: number; y: number; width: number; height: number; payload: { bucket: string } };
                return <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={4} fill={p.payload.bucket === "미응답" ? muted : color} />;
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/** 주관식 — 많이 나온 답 순위. 막대는 등록자 수, 오른쪽에 방문 수·방문율. */
function TextTopCard({ t, color }: { t: RegistrationAnalysis["textTops"][number]; color: string }) {
  const max = Math.max(...t.rows.map((r) => r.regs), 1);
  return (
    <Card>
      <h4 className="line-clamp-2 text-sm font-medium leading-snug" title={t.label}>{t.label}</h4>
      <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">답한 사람 {n(t.answered)}명 · 방문 {n(t.visitorsAnswered)}명</p>
      <ol className="mt-3 space-y-1.5 text-xs">
        {t.rows.map((r, i) => (
          <li key={r.value} className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2">
            <span className="text-right tabular-nums text-muted-foreground">{i + 1}</span>
            <div className="min-w-0">
              <p className="truncate" title={r.value}>{r.value}</p>
              <ShareBar value={r.regs} max={max} color={color} />
            </div>
            <span className="text-right tabular-nums text-muted-foreground"><b className="text-foreground">{n(r.regs)}</b> · 방문 {n(r.visited)} ({pct(r.regs ? r.visited / r.regs : 0, 0)})</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function SegmentTable({ seg, view, colors }: { seg: Segment; view: SegView; colors: { pre: string; onsite: string; reg: string } }) {
  const visitorsPre = seg.rows.reduce((a, r) => a + r.preVisited, 0);
  const visitorsOnsite = seg.rows.reduce((a, r) => a + r.onsiteVisited, 0);
  const shares = seg.rows.map((r) => ({
    r,
    reg: seg.answered ? r.regs / seg.answered : 0,
    vis: seg.visitorsAnswered ? r.visited / seg.visitorsAnswered : 0,
    pre: visitorsPre ? r.preVisited / visitorsPre : 0,
    onsite: visitorsOnsite ? r.onsiteVisited / visitorsOnsite : 0,
  }));
  const max = Math.max(...shares.flatMap((s) => (view === "visitors" ? [s.reg, s.vis] : [s.pre, s.onsite])), 0.0001);
  const base = seg.answered ? seg.visitorsAnswered / seg.answered : 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">값</th>
            {view === "visitors" ? (
              <>
                <th className="w-[34%] py-1.5 pr-3 font-medium">등록자 비중 / 방문자 비중</th>
                <th className="py-1.5 pr-3 text-right font-medium">등록</th>
                <th className="py-1.5 pr-3 text-right font-medium">방문</th>
                <th className="py-1.5 text-right font-medium">방문율</th>
              </>
            ) : (
              <>
                <th className="w-[34%] py-1.5 pr-3 font-medium">방문자 중 비중 — 사전 / 현장</th>
                <th className="py-1.5 pr-3 text-right font-medium">사전 방문</th>
                <th className="py-1.5 text-right font-medium">현장 방문</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shares.map(({ r, reg, vis, pre, onsite }) => (
            <tr key={r.value}>
              <td className="max-w-[220px] py-2 pr-3 align-top"><span className="line-clamp-2 break-words">{r.value}</span></td>
              <td className="py-2 pr-3">
                {view === "visitors" ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2"><ShareBar value={reg} max={max} color={colors.reg} /><span className="w-11 shrink-0 text-right tabular-nums text-muted-foreground">{pct(reg)}</span></div>
                    <div className="flex items-center gap-2"><ShareBar value={vis} max={max} color={colors.pre} /><span className="w-11 shrink-0 text-right font-medium tabular-nums">{pct(vis)}</span></div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2"><ShareBar value={pre} max={max} color={colors.pre} /><span className="w-11 shrink-0 text-right tabular-nums">{pct(pre)}</span></div>
                    <div className="flex items-center gap-2"><ShareBar value={onsite} max={max} color={colors.onsite} /><span className="w-11 shrink-0 text-right tabular-nums">{pct(onsite)}</span></div>
                  </div>
                )}
              </td>
              {view === "visitors" ? (
                <>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{n(r.regs)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{n(r.visited)}</td>
                  <td className={`py-2 text-right font-medium tabular-nums ${r.regs >= 30 && r.rate >= base * 1.2 ? "text-emerald-700 dark:text-emerald-400" : r.regs >= 30 && r.rate <= base * 0.8 ? "text-amber-700 dark:text-amber-400" : ""}`}>{pct(r.rate)}</td>
                </>
              ) : (
                <>
                  <td className="py-2 pr-3 text-right tabular-nums">{n(r.preVisited)}</td>
                  <td className="py-2 text-right tabular-nums">{n(r.onsiteVisited)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {seg.kind === "multi" ? "복수 선택 문항이라 비중의 합이 100%를 넘어요. " : ""}
        응답자 {n(seg.answered)}명 · 방문자 {n(seg.visitorsAnswered)}명 · 이 문항 평균 방문율 {pct(base)}
        {view === "visitors" && " — 평균보다 20% 이상 높으면 초록, 낮으면 주황(표본 30명 이상)."}
      </p>
    </div>
  );
}

export default function AnalysisTab({ sourceId }: { sourceId: string }) {
  const colors = useChartColors();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [segView, setSegView] = useState<SegView>("visitors");
  // "" = 전체
  const [audience, setAudience] = useState("");
  const [aiResult, setAiResult] = useState<SurveyAiResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  const runSurveyAi = useCallback(async () => {
    setAiBusy(true);
    setAiError("");
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}/analysis/survey-ai`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "AI가 해석을 쓰지 못했어요");
      setAiResult(body as SurveyAiResult);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }, [sourceId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}/analysis`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "분석을 불러오지 못했어요");
      setData(body as Payload);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/collect-sources/${sourceId}/analysis`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "분석을 불러오지 못했어요");
        if (!cancelled) setData(body as Payload);
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [sourceId]);

  const a = audience ? data?.audiences.find((x) => x.value === audience)?.analysis ?? data?.analysis : data?.analysis;
  const seriesPre = colors.series[0];
  const seriesOnsite = colors.series[1];
  const dayColors = colors.series;

  // 시간대별(일자 = 선) — 한 행에 시(hour), 열에 날짜. 가로축은 행사 운영 시간(개장~마감)까지 늘린다 —
  // 데이터가 끝난 시각에서 축이 잘리면 "마감 전 한 시간은 아무도 안 왔다" 가 안 보인다.
  const hourly = useCallback((rows: { date: string; hour: number; n: number }[]) => {
    const dates = Array.from(new Set(rows.map((r) => r.date))).sort();
    const range = data?.hours ?? { open: null, close: null };
    const from = rows.length ? Math.min(...rows.map((r) => r.hour), range.open ?? 24) : 0;
    const to = rows.length ? Math.max(...rows.map((r) => r.hour), range.close ?? -1) : -1;
    const hours = Array.from({ length: Math.max(to - from + 1, 0) }, (_, i) => from + i);
    return {
      dates,
      data: hours.map((h) => ({ hour: `${h}시`, ...Object.fromEntries(dates.map((d) => [md(d), rows.find((r) => r.date === d && r.hour === h)?.n ?? 0])) })),
    };
  }, [data?.hours]);

  const exportXlsx = async () => {
    if (!a || !data) return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const k = a.kpi;
      const summary = [
        ["항목", "값", "설명"],
        ["범위", audience || "전체", audience ? "이 유형 등록자만" : "모든 유형"],
        ["누적 방문객 (연인원, 동반 포함)", k.visitors.visitorDaysWithCompanions, "날마다 온 사람을 각각 센 합 + 동반 자녀(온 날마다)"],
        ["누적 방문객 (연인원, 등록자만)", k.visitors.visitorDays, ""],
        ["순방문자 (동반 포함)", k.visitors.uniqueWithCompanions, "한 사람은 몇 번 와도 1 + 동반 자녀 1번"],
        ["순방문자 (등록자만)", k.visitors.unique, ""],
        ["동반 자녀 (순)", k.visitors.companionsUnique, "방문자 수에만 더함 — 인구통계 없음"],
        ["바코드 스캔", k.visitors.scans, "같은 날 재입장·중복 스캔 포함"],
        ["총 등록", k.registrations.total, ""],
        ["사전등록", k.registrations.pre, `현장등록 시작 전 등록 (${csvDateTimeIn(a.definitions.timezone, a.definitions.onsiteFrom)} 현지 이전)`],
        ["현장등록", k.registrations.onsite, "행사 기간 등록 — 스캔이 없으면 방문 아님"],
        ["사전등록 방문율", pct(k.showUp.pre.rate), `${n(k.showUp.pre.visited)} / ${n(k.showUp.pre.regs)}`],
        ["현장등록 방문율", pct(k.showUp.onsite.rate), `${n(k.showUp.onsite.visited)} / ${n(k.showUp.onsite.regs)}`],
        ["방문자 중 현장등록 비중", pct(k.visitors.unique ? k.visitorMix.onsite / k.visitors.unique : 0), ""],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "요약");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.visitsByDay.map((d) => ({ 날짜: d.date, 방문자: d.unique, 동반: d.companions, "방문자+동반": d.withCompanions, 스캔: d.scans, "사전등록 방문자": d.preVisitors, "현장등록 방문자": d.onsiteVisitors }))), "일자별 방문");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.daily.map((d) => ({ 날짜: d.date, 사전등록: d.pre, 현장등록: d.onsite, 누적: d.cumulative }))), "일자별 등록");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.leadTime.map((l) => ({ "등록 시점": l.bucket, 등록: l.regs, 방문: l.visited, 방문율: pct(l.rate) }))), "등록 시점별 방문율");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.arrivalsHourly.map((r) => ({ 날짜: r.date, 시: r.hour, "입장(그날 첫 스캔)": r.n }))), "시간대별 입장");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.onsiteHourly.map((r) => ({ 날짜: r.date, 시: r.hour, 현장등록: r.n }))), "시간대별 현장등록");
      const segRows = a.segments.flatMap((s) => s.rows.map((r) => ({ 문항: s.label, 값: r.value, 등록: r.regs, 방문: r.visited, 방문율: pct(r.rate), 사전등록: r.preRegs, 현장등록: r.onsiteRegs, "사전 방문": r.preVisited, "현장 방문": r.onsiteVisited })));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(segRows), "문항별");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.insights.map((i) => ({ 인사이트: i.title, 설명: i.detail }))), "인사이트");
      if (data.audienceRows.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.audienceRows.map((r) => ({
          유형: r.value, 등록: r.regs, 사전등록: r.pre, 현장등록: r.onsite, 순방문: r.visitors, 동반: r.companions, "순방문(동반 포함)": r.visitorsWithCompanions,
          "누적 방문객(연인원, 동반 포함)": r.visitorDaysWithCompanions, "사전등록 방문율": pct(r.showUpPre.rate), "현장등록 방문율": r.onsite ? pct(r.showUpOnsite.rate) : "-",
        }))), "유형별 비교");
      }
      XLSX.writeFile(wb, `${data.sourceName.replace(/[^a-zA-Z0-9가-힣_-]+/g, "_")}_결과분석${audience ? `_${audience.replace(/[^a-zA-Z0-9가-힣_-]+/g, "_")}` : ""}.xlsx`);
    } catch {
      toast.error("엑셀을 만들지 못했어요");
    }
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!a || !data) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 분석하는 중 — 등록자가 많으면 몇 초 걸려요</div>;

  const k = a.kpi;
  if (k.registrations.total === 0) return <p className="text-sm text-muted-foreground">아직 등록이 없어요.</p>;
  const tzLabel = checkinTimezoneLabel(a.definitions.timezone);
  const noVisits = k.visitors.unique === 0;
  const arrivals = hourly(a.arrivalsHourly);
  const onsiteRegs = hourly(a.onsiteHourly);
  const visitorMixOnsite = k.visitors.unique ? k.visitorMix.onsite / k.visitors.unique : 0;

  return (
    <div className="max-w-6xl space-y-5">
      {/* 머리 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">결과 분석</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            시간은 {tzLabel} 기준 · 현장등록 = {csvDateTimeIn(a.definitions.timezone, a.definitions.onsiteFrom).slice(0, 16)} 이후 등록 · 방문 = 입장 스캔 1번 이상
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Btn tone="ghost" className="px-2" onClick={() => void load()} disabled={loading} aria-label="다시 계산">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Btn>
          <Btn onClick={() => void exportXlsx()}><Download className="h-4 w-4" /> 결과보고용 엑셀</Btn>
        </div>
      </div>

      {data.audiences.length > 1 && (
        <Segmented<string>
          label="분석 범위"
          value={audience}
          onChange={setAudience}
          options={[
            { value: "", label: <span>전체 <span className="tabular-nums opacity-70">{n(data.analysis.kpi.registrations.total)}</span></span> },
            ...data.audiences.map((x) => ({ value: x.value, label: <span>{x.value} <span className="tabular-nums opacity-70">{n(x.analysis.kpi.registrations.total)}</span></span> })),
          ]}
        />
      )}
      {audience && <p className="-mt-2 text-xs text-muted-foreground"><b className="text-foreground">{audience}</b> 등록자만 계산했어요. 이 유형 전용 문항은 아래 &apos;누가 왔나&apos;에 함께 나와요.</p>}

      {/* 헤드라인 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="col-span-2 lg:col-span-1">
          <p className="text-xs text-muted-foreground">누적 방문객 (연인원)</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{n(k.visitors.visitorDaysWithCompanions)}<span className="ml-1 text-base font-medium text-muted-foreground">명</span></p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground tabular-nums">등록자 {n(k.visitors.visitorDays)} + 동반 {n(k.visitors.companionsDays)} · 날마다 각각 셈</p>
        </Card>
        <Card>
          <p className="text-xs text-muted-foreground">순방문자</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{n(k.visitors.uniqueWithCompanions)}<span className="ml-1 text-sm font-medium text-muted-foreground">명</span></p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground tabular-nums">등록자 {n(k.visitors.unique)} + 동반 {n(k.visitors.companionsUnique)} · 한 사람은 1번</p>
        </Card>
        <Card>
          <p className="text-xs text-muted-foreground">총 등록</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{n(k.registrations.total)}<span className="ml-1 text-sm font-medium text-muted-foreground">명</span></p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground tabular-nums">사전 {n(k.registrations.pre)} · 현장 {n(k.registrations.onsite)}</p>
        </Card>
        <Card className="col-span-2 lg:col-span-1">
          <p className="text-xs text-muted-foreground">사전등록 방문율</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{pct(k.showUp.pre.rate)}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground tabular-nums">현장등록 방문율 {pct(k.showUp.onsite.rate)} · 방문자 중 현장등록 {pct(visitorMixOnsite)}</p>
        </Card>
      </div>

      {noVisits && (
        <Card><p className="text-sm text-muted-foreground">아직 입장 기록이 없어요. 현장 체크인 탭에서 스캔하거나 오프라인 스캐너 파일을 올리면 방문 분석이 채워져요.</p></Card>
      )}

      {!audience && data.audienceRows.length > 1 && (
        <Card>
          <SectionTitle title="유형별 비교" hint="유형마다 등록·실제 방문·방문율. 전체 숫자는 위, 유형별 세부 분석은 위쪽 전환에서 골라 보세요." />
          <AudienceCompare rows={data.audienceRows} colors={{ pre: seriesPre, onsite: seriesOnsite, reg: colors.chat }} onPick={setAudience} />
        </Card>
      )}

      {/* 인사이트 */}
      {a.insights.length > 0 && (
        <Card>
          <SectionTitle title="내년에 써먹을 인사이트" hint="숫자에서 바로 읽히는 것만, 표본이 충분할 때만 뽑았어요(등록 분석은 100명·만족도 조사는 20명 이상)." />
          <ul className="divide-y divide-border">{a.insights.map((i, idx) => <InsightRow key={idx} i={i} />)}</ul>
        </Card>
      )}

      {/* 만족도 조사 AI 해석 — 문항별 숫자는 만족도 조사 탭에 있다. 여기서는 등록 데이터·주관식 답변까지
          같이 읽고 전체가 무엇을 뜻하는지 해석한다. 눌렀을 때만 돌고(비용) 저장하지 않는다. */}
      {data.hasSurvey && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">만족도 조사 해석</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                문항별 점수·분포는 만족도 조사 탭에 있어요. 여기서는 등록 데이터·주관식 답변까지 같이 읽고 이번 조사가 전체적으로 무엇을 뜻하는지 해석해요.
              </p>
            </div>
            <Btn
              tone="ghost"
              onClick={() => void runSurveyAi()}
              disabled={!data.surveyAiAvailable || aiBusy}
              title={data.surveyAiAvailable ? "등록 데이터와 교차해서 AI가 해석해요" : "Vercel 환경 변수 ANTHROPIC_API_KEY 를 넣으면 켜져요"}
              className="shrink-0 bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 dark:text-violet-400"
            >
              {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI로 해석하기
            </Btn>
          </div>
          {aiError && <p className="mt-3 text-sm text-destructive">{aiError}</p>}
          {aiResult && (
            <div className="mt-4 space-y-3">
              {aiResult.summary && (
                <p className="rounded-xl bg-violet-500/5 p-3 text-sm leading-relaxed">{aiResult.summary}</p>
              )}
              {aiResult.insights.length > 0 && (
                <ul className="divide-y divide-border">{aiResult.insights.map((i, idx) => <InsightRow key={idx} i={i} />)}</ul>
              )}
            </div>
          )}
        </Card>
      )}

      {/* 등록 → 방문 */}
      {!noVisits && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <SectionTitle title="등록 → 실제 방문" hint="현장등록도 온라인 폼이라, 입장 스캔이 없으면 방문으로 치지 않아요." />
            {[
              { label: "사전등록", r: k.showUp.pre, color: seriesPre },
              { label: "현장등록", r: k.showUp.onsite, color: seriesOnsite },
            ].map(({ label, r, color }) => (
              <div key={label} className="py-2">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}</span>
                  <span className="tabular-nums text-muted-foreground"><b className="text-foreground">{n(r.visited)}</b> / {n(r.regs)}명 · <b className="text-foreground">{pct(r.rate)}</b></span>
                </div>
                <div className="mt-1.5"><ShareBar value={r.rate} max={1} color={color} /></div>
              </div>
            ))}
            <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
              방문자 {n(k.visitors.unique)}명 = 사전등록 {n(k.visitorMix.pre)} + 현장등록 {n(k.visitorMix.onsite)} · 재방문 {k.repeat.filter((r) => r.days > 1).map((r) => `${r.days}일 ${n(r.people)}명`).join(", ") || "없음"}
            </p>
          </Card>

          <Card>
            <SectionTitle title="언제 등록한 사람이 실제로 왔나" hint="행사 첫날(현지 날짜) 기준 며칠 전에 등록했는지별 방문율이에요." />
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.leadTime.map((l) => ({ ...l, ratePct: Math.round(l.rate * 1000) / 10 }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: colors.axis }} interval={0} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} unit="%" />
                  <Tooltip
                    cursor={{ fill: colors.grid, fillOpacity: 0.4 }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className={`${R.control} ${FINISH.overlay} bg-popover px-3 py-2 text-xs`}>
                          <p className="font-medium">{label}</p>
                          <p className="tabular-nums">방문율 {(payload[0].payload as { ratePct: number }).ratePct}%</p>
                          <p className="tabular-nums text-muted-foreground">{n((payload[0].payload as { visited: number }).visited)} / {n((payload[0].payload as { regs: number }).regs)}명</p>
                        </div>
                      ) : null
                    }
                  />
                  <Bar dataKey="ratePct" name="방문율" fill={seriesPre} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* 등록 추이 */}
      <Card>
        <SectionTitle title="등록 추이" hint="날짜별 등록(현지 날짜). 막대 위에 마우스를 올리면 사전·현장 수가 나와요." />
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.daily.map((d) => ({ ...d, label: md(d.date) }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} minTickGap={12} />
              <YAxis tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: colors.grid, fillOpacity: 0.4 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="square" iconSize={8} />
              <Bar dataKey="pre" name="사전등록" stackId="r" fill={seriesPre} />
              <Bar dataKey="onsite" name="현장등록" stackId="r" fill={seriesOnsite} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 방문 패턴 */}
      {!noVisits && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <SectionTitle title="일자별 방문" hint="방문자는 그날 1명으로 셈(재입장 제외). 동반은 부모가 온 날마다 더해요." />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">날짜</th>
                    <th className="py-1.5 pr-3 text-right font-medium">방문자</th>
                    <th className="py-1.5 pr-3 text-right font-medium">동반</th>
                    <th className="py-1.5 pr-3 text-right font-medium">합계</th>
                    <th className="py-1.5 pr-3 text-right font-medium">사전 / 현장</th>
                    <th className="py-1.5 text-right font-medium">스캔</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {a.visitsByDay.map((d) => (
                    <tr key={d.date}>
                      <td className="py-2 pr-3">{d.date}</td>
                      <td className="py-2 pr-3 text-right">{n(d.unique)}</td>
                      <td className="py-2 pr-3 text-right text-muted-foreground">{n(d.companions)}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{n(d.withCompanions)}</td>
                      <td className="py-2 pr-3 text-right text-muted-foreground">{n(d.preVisitors)} / {n(d.onsiteVisitors)}</td>
                      <td className="py-2 text-right text-muted-foreground">{n(d.scans)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-2 pr-3">합계(연인원)</td>
                    <td className="py-2 pr-3 text-right">{n(k.visitors.visitorDays)}</td>
                    <td className="py-2 pr-3 text-right">{n(k.visitors.companionsDays)}</td>
                    <td className="py-2 pr-3 text-right">{n(k.visitors.visitorDaysWithCompanions)}</td>
                    <td className="py-2 pr-3 text-right" />
                    <td className="py-2 text-right">{n(k.visitors.scans)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {a.plannedVsActual && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs font-medium">방문 예정일 vs 실제 <span className="font-normal text-muted-foreground">— 예정일을 고른 방문자 {n(a.plannedVsActual.visitorsWithPlan)}명 중 {pct(a.plannedVsActual.matchRate)}가 고른 날에 왔어요</span></p>
                <ul className="mt-2 space-y-1 text-xs tabular-nums">
                  {a.plannedVsActual.rows.map((r) => (
                    <li key={r.date} className="flex flex-wrap justify-between gap-x-3">
                      <span>{md(r.date)}</span>
                      <span className="text-muted-foreground">예정 {n(r.planned)} → 그날 옴 {n(r.plannedCame)} ({pct(r.planned ? r.plannedCame / r.planned : 0)}) · 예정 없이 옴 {n(r.cameUnplanned)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle title="시간대별 입장" hint="사람마다 그날 첫 스캔 시각 — 입구 인력·대기 동선을 정할 때 써요." />
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={arrivals.data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} cursor={{ stroke: colors.axis, strokeOpacity: 0.25 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                  {arrivals.dates.slice(0, dayColors.length).map((d, i) => (
                    <Line key={d} type="monotone" dataKey={md(d)} name={md(d)} stroke={dayColors[i]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {a.onsiteHourly.length > 0 && (
              <>
                <p className="mt-4 text-xs font-medium">시간대별 현장등록</p>
                <div className="mt-1 h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={onsiteRegs.data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                      <XAxis dataKey="hour" tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: colors.axis }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTip />} cursor={{ stroke: colors.axis, strokeOpacity: 0.25 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                      {onsiteRegs.dates.slice(0, dayColors.length).map((d, i) => (
                        <Line key={d} type="monotone" dataKey={md(d)} name={md(d)} stroke={dayColors[i]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* 질문별 응답 — 물어본 항목마다 그래프 */}
      {!noVisits && a.segments.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">질문별 응답</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                등록 폼에서 물어본 항목마다 등록자와 실제 방문자의 분포를 비교해요. 동반 자녀는 응답이 없어 여기 들어가지 않아요.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Segmented<SegView>
                label="비교 방식"
                value={segView}
                onChange={setSegView}
                options={[{ value: "visitors", label: "등록자 vs 방문자" }, { value: "prePost", label: "방문자: 사전 vs 현장" }]}
              />
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                {segView === "visitors" ? (
                  <>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: colors.chat }} />등록자 비중</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: seriesPre }} />방문자 비중</span>
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: seriesPre }} />사전등록 방문자</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: seriesOnsite }} />현장등록 방문자</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {a.segments.filter((sg) => !sg.key.startsWith("__")).map((sg) => (
              <QuestionCard key={sg.key} seg={sg} view={segView} colors={{ pre: seriesPre, onsite: seriesOnsite, reg: colors.chat, grid: colors.grid, axis: colors.axis }} />
            ))}
            {a.companionDist.length > 0 && (
              <CompanionCard dist={a.companionDist} total={k.visitors.companionsUnique} color={seriesPre} muted={colors.chat} grid={colors.grid} axis={colors.axis} />
            )}
          </div>

          {a.textTops.length > 0 && (
            <>
              <div className="pt-2">
                <h3 className="text-sm font-semibold">주관식 — 많이 나온 답</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">같은 답(대소문자·띄어쓰기 차이는 묶음)이 2명 이상인 것만, 많은 순으로 10개. None·N/A 같은 빈 답은 뺐어요. 이름·연락처·링크는 보여 주지 않아요.</p>
              </div>
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                {a.textTops.map((t) => <TextTopCard key={t.key} t={t} color={seriesPre} />)}
              </div>
            </>
          )}

          {a.segments.some((sg) => sg.key.startsWith("__")) && (
            <>
              <div className="pt-2">
                <h3 className="text-sm font-semibold">유입 경로·지역</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">폼 질문은 아니지만 함께 보면 좋은 것 — UTM 최초 유입 소스와 주소에서 추정한 도시예요.</p>
              </div>
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                {a.segments.filter((sg) => sg.key.startsWith("__")).map((sg) => (
                  <QuestionCard key={sg.key} seg={sg} view={segView} colors={{ pre: seriesPre, onsite: seriesOnsite, reg: colors.chat, grid: colors.grid, axis: colors.axis }} />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* 용어·데이터 품질 */}
      <Card>
        <details>
          <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold"><Info className="h-4 w-4 text-muted-foreground" /> 용어와 데이터 품질</summary>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-xs leading-relaxed sm:grid-cols-[140px_1fr]">
            <dt className="font-medium">사전 / 현장등록</dt><dd className="text-muted-foreground">등록 시각이 현장등록 시작({csvDateTimeIn(a.definitions.timezone, a.definitions.onsiteFrom).slice(0, 16)}, {tzLabel}) 이전이면 사전등록. 둘 다 온라인 폼이라 구분은 시각으로만 해요.</dd>
            <dt className="font-medium">방문</dt><dd className="text-muted-foreground">입장 스캔이 1번 이상 있는 등록자. 현장등록을 했어도 스캔이 없으면 방문이 아니에요.</dd>
            <dt className="font-medium">순방문자 / 연인원</dt><dd className="text-muted-foreground">순방문자는 한 사람을 한 번만, 연인원(누적 방문객)은 날마다 각각 세요. 같은 날 다시 찍힌 스캔은 그날 1명이에요.</dd>
            <dt className="font-medium">동반 인원</dt><dd className="text-muted-foreground">
              등록자가 적은 동반 자녀 수{data.fields.companionKey ? ` (항목: ${data.fields.companionKey})` : " — 이 폼에는 해당 항목이 없어요"}. 방문자 수에만 더하고 인구통계에는 넣지 않아요.
              방문자 중 빈칸 {n(a.companions.blank)}명, 숫자가 아닌 글 {n(a.companions.textAsZero)}명은 0명으로 쳤어요.
            </dd>
            <dt className="font-medium">방문율</dt><dd className="text-muted-foreground">방문한 등록자 ÷ 등록자. 동반 자녀는 빼고 사람 단위로 계산해요.</dd>
          </dl>
          {a.companions.flagged.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs font-medium">확인이 필요한 동반 인원 값 {a.companions.flagged.length}건 <span className="font-normal text-muted-foreground">— 0명으로 쳤어요. 등록자 DB에서 등록번호로 찾아 고칠 수 있어요.</span></p>
              <ul className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
                {a.companions.flagged.map((f, i) => <li key={i} className="truncate tabular-nums">{f.registrationNo ?? "-"} · “{f.raw}”</li>)}
              </ul>
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">계산 시각 {new Date(data.generatedAt).toLocaleString("ko-KR")}</p>
        </details>
      </Card>
    </div>
  );
}
