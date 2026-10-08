"use client";

/**
 * 프로젝트 대시보드 — 지금 진행 중인 사전등록·광고·대회·웨비나·상세페이지를 한 장에.
 *
 * 읽는 화면이다(AGENTS §1 Calm Hierarchy): 메뉴마다 "오늘 무슨 일이 있나" 숫자 하나를 크게,
 * 나머지는 작게. 자세한 건 카드를 눌러 그 메뉴로 간다 — 사전등록 통계는 각 폼의 "현황" 탭,
 * 광고는 폴더, 대회는 대회 화면. 끝난 것은 첫 화면에서 내리고 "지난 n개" 로만 남긴다.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  BarChart3, ChevronRight, Database, FileText, LayoutDashboard, Loader2, RefreshCw, Share2, Trophy, Video,
  type LucideIcon,
} from "lucide-react";
import { useWorkspace } from "@/contexts/workspace";
import { InlineError } from "@/components/ui/inline-error";
import { FINISH, R } from "@/components/ui/primitives";
import { formatKstDateTime } from "@/lib/datetime";
import { COMPETITION_PHASE_META } from "@/lib/competition-status";
import { WEBINAR_STATUS_META } from "@/lib/webinar-status";
import type { ProjectOverview } from "@/lib/project-overview";
import Sparkline from "./Sparkline";
import { DashboardShareModal } from "./DashboardShareModal";

const AUTO_REFRESH_MS = 180_000;
const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

const num = (value: number) => value.toLocaleString("ko-KR");
function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 2 }).format(value);
  } catch {
    return num(Math.round(value));
  }
}
/** 오늘(KST)에서 그날까지 남은 날 — 0 이면 오늘 마감. */
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const kst = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const diff = (Date.parse(kst(new Date(iso))) - Date.parse(kst(new Date()))) / 86_400_000;
  return Number.isFinite(diff) ? Math.round(diff) : null;
}
const dday = (iso: string | null) => {
  const d = daysLeft(iso);
  if (d === null) return null;
  return d > 0 ? `마감 D-${d}` : d === 0 ? "오늘 마감" : null;
};

export default function DashboardClient() {
  const { workspace, currentProject, isLoading: wsLoading } = useWorkspace();
  const [data, setData] = useState<ProjectOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const fetchOverview = useCallback(async () => {
    if (!workspace || !currentProject) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/project-overview?workspaceId=${workspace.id}&projectId=${currentProject.id}`);
      if (!res.ok) { setError(true); return; }
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [workspace, currentProject]);

  useEffect(() => { void Promise.resolve().then(fetchOverview); }, [fetchOverview]);
  useEffect(() => {
    // 보이는 동안만 3분마다 — 숨긴 탭에서 계속 부르지 않는다(egress·DB 절감).
    const id = setInterval(() => { if (!document.hidden) void fetchOverview(); }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchOverview]);

  if (wsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!currentProject) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <LayoutDashboard className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">프로젝트를 먼저 선택해주세요</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">대시보드</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {currentProject.name} · 지금 진행 중인 것만 모아 봐요
            {data && <span className="ml-1.5 text-xs">({formatKstDateTime(data.generatedAt).slice(5, 16)} 기준)</span>}
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          transition={spring}
          onClick={() => void fetchOverview()}
          className="self-start rounded-xl border border-border p-1.5 text-muted-foreground transition-colors hover:bg-secondary sm:self-auto"
          title="새로고침"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </motion.button>
      </div>

      {error && !data ? (
        <InlineError message="대시보드를 불러오지 못했어요" onRetry={fetchOverview} />
      ) : !data ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <OverviewSections data={data} onShare={() => setShareOpen(true)} />
      )}

      <DashboardShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        projectId={currentProject.id}
        projectName={currentProject.name}
      />
    </div>
  );
}

/** 대시보드 본문 — 데이터만 받아 그린다(개발 하니스가 같은 화면을 로그인 없이 확인한다). */
export function OverviewSections({ data, onShare }: { data: ProjectOverview; onShare: () => void }) {
  const todayTotal = data.collect.active.reduce((sum, s) => sum + s.today, 0);
  return (
    <>
      {/* ── 사전등록 ── 첫 화면의 주인공: 오늘 들어온 등록 */}
      <Section
        icon={Database}
        title="사전등록"
        headline={data.collect.active.length > 0 ? `오늘 ${num(todayTotal)}명` : null}
        otherCount={data.collect.otherCount}
        otherHref="/collect"
        emptyText="진행 중인 사전등록이 없어요"
        action={
          <button
            onClick={onShare}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="사전등록 보고서 공유 링크"
          >
            <Share2 className="h-3 w-3" />
            보고서 공유
          </button>
        }
      >
        {data.collect.active.map((s) => {
          const due = dday(s.closesAt);
          return (
            <CardLink key={s.id} href={`/collect/${s.id}?tab=overview`}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{s.name}</span>
                {s.registration === "before" ? (
                  <Badge tone="bg-amber-500/10 text-amber-600 dark:text-amber-400">오픈 전</Badge>
                ) : s.registration === "closed" ? (
                  <Badge tone="bg-secondary text-muted-foreground">마감</Badge>
                ) : due ? (
                  <Badge tone="bg-violet-500/10 text-violet-600 dark:text-violet-400">{due}</Badge>
                ) : null}
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <div className="text-2xl font-semibold tabular-nums">{num(s.today)}</div>
                  <div className="text-[11px] text-muted-foreground">오늘 · 어제 {num(s.yesterday)}</div>
                </div>
                <div className="h-10 w-28 shrink-0"><Sparkline points={s.last7} /></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                <span>누적 <b className="text-foreground tabular-nums">{num(s.total)}</b></span>
                {s.checkedIn !== null && <span>현장 입장 <b className="text-foreground tabular-nums">{num(s.checkedIn)}</b></span>}
              </div>
            </CardLink>
          );
        })}
      </Section>

      {/* ── 광고 성과 ── */}
      <Section
        icon={BarChart3}
        title="광고 성과"
        otherCount={data.ads.otherCount}
        otherHref="/analytics"
        emptyText="기간 중인 광고 폴더가 없어요"
      >
        {data.ads.active.map((f) => {
          const cpa = f.conversions > 0 ? f.cost / f.conversions : null;
          const ctr = f.impressions > 0 ? (f.clicks / f.impressions) * 100 : null;
          return (
            <CardLink key={f.id} href={`/analytics/${f.id}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{f.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{f.platforms.join(" · ")}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Metric label="비용" value={money(f.cost, f.currency)} />
                <Metric label="결과" value={num(f.conversions)} helper={cpa !== null ? `결과당 ${money(cpa, f.currency)}` : undefined} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                <span>노출 <b className="text-foreground tabular-nums">{num(f.impressions)}</b></span>
                <span>클릭 <b className="text-foreground tabular-nums">{num(f.clicks)}</b>{ctr !== null && ` (${ctr.toFixed(2)}%)`}</span>
                {f.lastSyncedAt && <span>동기화 {formatKstDateTime(f.lastSyncedAt).slice(5, 16)}</span>}
              </div>
            </CardLink>
          );
        })}
      </Section>

      {/* ── 대회 ── */}
      <Section
        icon={Trophy}
        title="대회"
        otherCount={data.competitions.otherCount}
        otherHref="/competition"
        emptyText="진행 중인 대회가 없어요"
      >
        {data.competitions.active.map((c) => {
          const meta = COMPETITION_PHASE_META[c.phase];
          const due = c.phase === "recruiting" || c.phase === "upcoming" ? dday(c.recruitCloseAt) : null;
          return (
            <CardLink key={c.id} href={`/competition/${c.slug}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{c.name}</span>
                <div className="flex shrink-0 gap-1">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  {due && <Badge tone="bg-violet-500/10 text-violet-600 dark:text-violet-400">{due}</Badge>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Metric label="참가작" value={num(c.entries)} helper={`승인 ${num(c.approved)} · 노출 ${num(c.published)}`} />
                <Metric label="투표" value={num(c.votes)} helper={c.advanced > 0 ? `본선 ${num(c.advanced)}팀` : undefined} />
              </div>
            </CardLink>
          );
        })}
      </Section>

      {/* ── 웨비나 · 상세페이지 ── 수가 적어 한 줄 목록으로 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          icon={Video}
          title="웨비나"
          otherCount={data.webinars.otherCount}
          otherHref="/webinar"
          emptyText="예정·진행 중인 웨비나가 없어요"
          list
        >
          {data.webinars.active.map((w) => {
            const meta = WEBINAR_STATUS_META[w.status];
            return (
              <RowLink key={w.id} href={`/webinar/${w.slug}`}>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {formatKstDateTime(w.liveStartAt).slice(5, 16)} · 등록 {num(w.registrations)}
                </span>
              </RowLink>
            );
          })}
        </Section>
        <Section
          icon={FileText}
          title="상세페이지"
          otherCount={data.detailPages.otherCount}
          otherHref="/detail-page"
          otherLabel="비공개"
          emptyText="공개 중인 상세페이지가 없어요"
          list
        >
          {data.detailPages.published.map((p) => (
            <RowLink key={p.id} href={`/detail-page/${p.id}`}>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <Badge tone="bg-emerald-500/10 text-emerald-600">공개</Badge>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                수정 {formatKstDateTime(p.updatedAt).slice(5, 10)}
              </span>
            </RowLink>
          ))}
        </Section>
      </div>
    </>
  );
}

function Section({
  icon: Icon,
  title,
  headline,
  action,
  otherCount,
  otherHref,
  otherLabel = "지난",
  emptyText,
  list,
  children,
}: {
  icon: LucideIcon;
  title: string;
  headline?: string | null;
  action?: React.ReactNode;
  otherCount: number;
  otherHref: string;
  otherLabel?: string;
  emptyText: string;
  list?: boolean;
  children: React.ReactNode[];
}) {
  const empty = children.length === 0;
  return (
    <section className="min-w-0 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{title}</h2>
          {headline && <span className="text-sm font-semibold text-violet-600 dark:text-violet-400">{headline}</span>}
        </div>
        <div className="flex items-center gap-1">
          {action}
          {otherCount > 0 && (
            <Link href={otherHref} className="rounded-lg px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              {otherLabel} {otherCount}개 보기
            </Link>
          )}
        </div>
      </div>
      {empty ? (
        <div className={`border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground ${R.panel}`}>{emptyText}</div>
      ) : list ? (
        <div className={`divide-y divide-border overflow-hidden bg-background ${R.panel} ${FINISH.s1}`}>{children}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
      )}
    </section>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={`group block min-w-0 bg-background p-4 transition-transform hover:-translate-y-0.5 ${R.panel} ${FINISH.s1}`}>
      {children}
      <div className="mt-2 flex items-center justify-end text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
        자세히 <ChevronRight className="h-3 w-3" />
      </div>
    </Link>
  );
}

function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-3 text-sm transition-colors hover:bg-secondary/40">
      {children}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function Metric({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
      {helper && <div className="truncate text-[11px] text-muted-foreground">{helper}</div>}
    </div>
  );
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>{children}</span>;
}
