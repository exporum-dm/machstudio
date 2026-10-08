"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Filter, RefreshCw, X } from "lucide-react";
import { kstDateString } from "@/lib/datetime";
import DateRangePicker, { ALL_TIME_LABEL, DateRange } from "@/components/DateRangePicker";
import RealtimeReport, { type RealtimeReportData } from "@/app/(app)/dashboard/RealtimeReport";

const AUTO_REFRESH_MS = 180_000; // 3분 (egress 절감 — 과거 30초였음)
const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

/**
 * 사전등록 폼 상세의 "현황" 탭 — 이 폼 하나의 등록 흐름·유입·구성.
 *
 * 예전에는 프로젝트 대시보드(실시간 보고서)였다. 대시보드가 사전등록·광고·대회·웨비나를
 * 함께 요약하는 화면으로 바뀌면서(2026-10-08), 사전등록의 자세한 통계는 각 폼으로 옮겼다.
 * 리포트 본체(RealtimeReport·dashboard-report API)는 그대로 쓰고 소스만 이 폼으로 고정한다.
 */
interface DashboardFilters {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  attribution?: "last" | "first";
}

/**
 * 기본은 **전체 기간** — 최근 7일만 보면 "지금까지 몇 명 모였나" 가 안 읽힌다는 요청(2026-10-08).
 * from 을 epoch 로 보내면 서버가 그 폼의 운영 시작일로 잘라 준다(dashboard-report clampToOperationStart).
 */
function defaultRange(): DateRange {
  const ks = kstDateString(new Date());
  const today = new Date(ks + "T00:00:00+09:00");
  const to = new Date(today.getTime() + 86400_000 - 1);
  return { from: new Date(0), to, label: ALL_TIME_LABEL };
}

function getFilterCount(filters: DashboardFilters) {
  return [filters.utmSource, filters.utmMedium, filters.utmCampaign].filter(Boolean).length;
}

export default function SourceOverviewTab({
  workspaceId,
  projectId,
  sourceId,
}: {
  workspaceId: string;
  projectId: string;
  sourceId: string;
}) {
  const [range, setRange] = useState<DateRange>(defaultRange());
  const [filters, setFilters] = useState<DashboardFilters>({ attribution: "last" });
  const [showFilters, setShowFilters] = useState(false);
  const [reportData, setReportData] = useState<RealtimeReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const filterCount = useMemo(() => getFilterCount(filters), [filters]);
  const hasActiveFilter = filterCount > 0;

  const fetchReport = useCallback(async () => {

    setReportLoading(true);
    try {
      const res = await fetch("/api/dashboard-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          projectId,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          filters: { ...filters, sourceId },
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        setReportData(data);
      } else {
        console.error("[dashboard-report] failed", data);
      }
    } catch (error) {
      console.error("[dashboard-report] failed", error);
    } finally {
      setReportLoading(false);
    }
  }, [workspaceId, projectId, sourceId, range, filters]);

  useEffect(() => {
    void Promise.resolve().then(fetchReport);
  }, [fetchReport, refreshTick]);

  useEffect(() => {
    // egress 절감: 탭이 보일 때만 자동 새로고침, 백그라운드(숨김)면 중단.
    const id = setInterval(() => {
      if (!document.hidden) setRefreshTick((tick) => tick + 1);
    }, AUTO_REFRESH_MS);
    // 탭으로 돌아오면 1회 즉시 갱신
    const onVisible = () => { if (!document.hidden) setRefreshTick((tick) => tick + 1); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const updateFilter = <Key extends keyof DashboardFilters>(key: Key, value: DashboardFilters[Key] | "") => {
    setFilters((current) => ({
      ...current,
      [key]: value || undefined,
    }));
  };

  const clearFilters = () => {
    setFilters({ attribution: filters.attribution ?? "last" });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">이 폼의 등록 흐름·유입 경로·등록자 구성이에요.</p>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} allowAllTime />
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={() => setShowFilters((open) => !open)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
              showFilters || hasActiveFilter
                ? "border-violet-400 bg-violet-500/10 text-violet-600"
                : "border-border bg-background hover:bg-secondary"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            필터
            {filterCount > 0 && (
              <span className="rounded-full bg-violet-500 px-1.5 py-0.5 text-[10px] leading-none text-white">
                {filterCount}
              </span>
            )}
          </motion.button>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={() => setRefreshTick((tick) => tick + 1)}
            className="rounded-xl border border-border p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
            title="새로고침"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reportLoading ? "animate-spin" : ""}`} />
          </motion.button>
        </div>
      </div>

      <AnimatePresence initial={false}>
      {showFilters && (
        <motion.div
          initial={{ opacity: 0, y: -4, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={spring}
          className="overflow-hidden rounded-2xl border border-border bg-background p-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">보고서 필터</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">선택한 조건은 이 현황 전체에 적용됩니다.</p>
            </div>
            {hasActiveFilter && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96 }}
                transition={spring}
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3 w-3" />
                초기화
              </motion.button>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">UTM 소스</span>
              <input
                type="text"
                placeholder="예: google"
                value={filters.utmSource ?? ""}
                onChange={(event) => updateFilter("utmSource", event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-violet-400"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">UTM 매체</span>
              <input
                type="text"
                placeholder="예: banner"
                value={filters.utmMedium ?? ""}
                onChange={(event) => updateFilter("utmMedium", event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-violet-400"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">UTM 캠페인</span>
              <input
                type="text"
                placeholder="예: registration"
                value={filters.utmCampaign ?? ""}
                onChange={(event) => updateFilter("utmCampaign", event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-violet-400"
              />
            </label>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">기여 기준</span>
              <div className="relative grid h-10 grid-cols-2 rounded-xl border border-border bg-secondary/30 p-1">
                {(["last", "first"] as const).map((attribution) => {
                  const active = (filters.attribution ?? "last") === attribution;
                  return (
                    <button
                      key={attribution}
                      onClick={() => setFilters((current) => ({ ...current, attribution }))}
                      className={`relative z-10 rounded-lg text-xs font-medium transition-colors ${
                        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                      title={attribution === "last" ? "최종 유입 기준" : "최초 유입 기준"}
                    >
                      {active && (
                        <motion.span
                          layoutId="attribution-pill"
                          transition={spring}
                          className="absolute inset-0 -z-10 rounded-lg bg-background shadow-sm"
                        />
                      )}
                      {attribution === "last" ? "Last" : "First"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      <RealtimeReport
        data={reportData}
        loading={reportLoading}
        // 전체 기간이면 실제로 센 시작일(운영 시작)을 같이 적는다 — "전체" 만으로는 언제부터인지 모른다.
        rangeLabel={
          range.label === ALL_TIME_LABEL && reportData?.range?.from
            ? `${ALL_TIME_LABEL} (${kstDateString(new Date(reportData.range.from)).replace(/-/g, ".")}~)`
            : range.label
        }
      />
    </div>
  );
}
