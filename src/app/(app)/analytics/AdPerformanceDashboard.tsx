"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type * as XLSXType from "xlsx";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Database,
  Download,
  FileSpreadsheet,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Share2,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { AnalyticsShareModal } from "./AnalyticsShareModal";
import DateRangePicker, { type DateRange, ALL_TIME_LABEL } from "@/components/DateRangePicker";
import { toast } from "sonner";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { useChartColors } from "@/components/ui/use-chart-colors";
import { useWorkspace } from "@/contexts/workspace";
import { AD_DETAIL_METRIC_COLUMNS, type AdDetailMetricColumn } from "@/lib/meta-result-metrics";
import {
  type AdColumnKey,
  AD_COLUMN_FIELDS,
  type ColumnMapping,
  type NormalizedAdRow,
  type ParsedPreview,
  type SheetAnalysis,
  type SourceChoice,
  type SourceType,
  analyzeSheetRows,
  parseMappedRows,
  summarizeRows,
} from "@/lib/ad-parse";

function workbookToRows(XLSX: typeof XLSXType, workbook: XLSXType.WorkBook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as unknown[][];
}

async function readSheetRows(file: File) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const isCsv = /\.csv$/i.test(file.name) || file.type.includes("csv");
  if (isCsv) {
    const bytes = new Uint8Array(buffer);
    let text: string;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = new TextDecoder("utf-16le").decode(buffer.slice(2));
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      text = new TextDecoder("utf-16be").decode(buffer.slice(2));
    } else {
      text = new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, "");
    }
    const workbook = XLSX.read(text, { type: "string", raw: false, cellDates: false });
    return workbookToRows(XLSX, workbook);
  }
  const workbook = XLSX.read(buffer, { type: "array", raw: false, cellDates: false });
  return workbookToRows(XLSX, workbook);
}

async function readCsvRows(csvText: string) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(csvText.replace(/^﻿/, ""), { type: "string", raw: false, cellDates: false });
  return workbookToRows(XLSX, workbook);
}

type SourceAddMode = "file" | "googleSheet";
type ChartMetric = "cost" | "cpm" | "cpc" | "ctr" | "cvr" | "conversions" | "costPerConversion";
type DetailGroupBy = "campaign" | "adGroup";
type DetailDateGranularity = "day" | "week" | "month";

interface MetricSummary {
  sourceType: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cvr: number;
  cpc: number;
  cpm: number;
  costPerConversion: number;
}

interface SummaryRow extends MetricSummary {
  campaignName: string;
  adGroupName?: string | null;
}

interface DetailRow {
  id: string;
  periodKey: string;
  sourceType: string;
  campaignName: string;
  adGroupName: string | null;
  reportDate: string | null;
  reportStart: string | null;
  cost: number;
  impressions: number;
  reach?: number;
  clicks: number;
  conversions: number;
  cpm: number;
  cpc: number;
  ctr: number;
  cvr: number;
  costPerConversion: number;
  conversionRate?: number | null;
}

interface PerformanceResponse {
  totals: {
    cost: number;
    impressions: number;
    reach: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cvr: number;
    cpc: number;
    cpm: number;
    costPerConversion: number;
  };
  sourceSummary: MetricSummary[];
  mediaSummary: MetricSummary[];
  campaignSummary: SummaryRow[];
  adGroupSummary: SummaryRow[];
  topCampaigns: SummaryRow[];
  topAdGroups: SummaryRow[];
  dailyTrend: Array<{
    date: string;
    cost: number;
    impressions: number;
    clicks: number;
    conversions: number;
  }>;
  dailyTrendBySource?: Array<{
    date: string;
    sources: Record<string, { cost: number; impressions: number; clicks: number; conversions: number }>;
  }>;
  detailRows: DetailRow[];
  detailPeriodOptions: Array<{
    value: string;
    rowCount: number;
  }>;
  detailPagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    groupBy: DetailGroupBy;
    dateGranularity: DetailDateGranularity;
    period: string | null;
  };
  recentRows?: DetailRow[];
  batches: Array<{
    id: string;
    sourceType: string;
    sourceName: string | null;
    fileName: string;
    rowCount: number;
    reportStart: string | null;
    reportEnd: string | null;
    createdAt: string;
    _count: { records: number };
  }>;
}

const SOURCE_LABELS: Record<string, string> = {
  ALL: "전체 매체",
  GOOGLE: "Google Ads",
  META: "Meta Ads",
  LINKEDIN: "LinkedIn Ads",
  MANUAL: "직접 입력",
};

const SOURCE_COLORS: Record<string, string> = {
  GOOGLE: "#f59e0b",
  META: "#ec4899",
  LINKEDIN: "#0a66c2",
  MANUAL: "#6b7280",
};

const MEDIA_FILTERS = [
  { value: "ALL", label: "전체" },
  { value: "GOOGLE", label: "Google" },
  { value: "META", label: "Meta" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "LINKEDIN", label: "LinkedIn" },
];

const CHART_METRICS: Array<{ value: ChartMetric; label: string }> = [
  { value: "cost", label: "지출" },
  { value: "cpm", label: "CPM" },
  { value: "cpc", label: "링크 CPC" },
  { value: "ctr", label: "링크 CTR" },
  { value: "cvr", label: "CVR" },
  { value: "conversions", label: "결과" },
  { value: "costPerConversion", label: "결과당 비용" },
];

const DETAIL_PAGE_SIZE = 20;

const DETAIL_GROUP_OPTIONS: Array<{ value: DetailGroupBy; label: string }> = [
  { value: "campaign", label: "캠페인" },
  { value: "adGroup", label: "광고세트" },
];

const DETAIL_DATE_OPTIONS: Array<{ value: DetailDateGranularity; label: string; header: string }> = [
  { value: "day", label: "일", header: "일자" },
  { value: "week", label: "주", header: "주 시작" },
  { value: "month", label: "월", header: "월" },
];

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

function todayInputValue(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const kst = new Date(date.getTime() + 9 * 60 * 60_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

// DB에는 UTC로 저장되지만 이 앱의 날짜는 KST 달력일 기준 — naive slice(0,10)은 자정 부근에 하루 밀린다.
function kstDateOnly(value: string) {
  const kst = new Date(new Date(value).getTime() + 9 * 60 * 60_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

function defaultRange(): DateRange {
  const today = new Date(todayInputValue(0) + "T00:00:00+09:00");
  const endOfToday = new Date(today.getTime() + 86_400_000 - 1);
  const from = new Date(today.getTime() - 30 * 86_400_000);
  return { from, to: endOfToday, label: "최근 30일" };
}

function folderDateRange(reportStart: string, reportEnd: string): DateRange {
  const from = new Date(`${kstDateOnly(reportStart)}T00:00:00+09:00`);
  const endDate = new Date(`${kstDateOnly(reportEnd)}T00:00:00+09:00`);
  const to = new Date(endDate.getTime() + 86_400_000 - 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return defaultRange();
  return { from, to, label: "폴더 기본 기간" };
}

function formatNumber(value: number | null | undefined) {
  return Math.round(value ?? 0).toLocaleString("ko-KR");
}

function formatKRW(value: number | null | undefined) {
  return `${Math.round(value ?? 0).toLocaleString("ko-KR")}원`;
}

function computeLogTrend(points: Array<{ cost: number; conversions: number }>) {
  const valid = points.filter((p) => p.cost > 0);
  if (valid.length < 3) return null;
  const xs = valid.map((p) => Math.log(p.cost));
  const ys = valid.map((p) => p.conversions);
  const n = valid.length;
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const a = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - a * sumX) / n;
  const minCost = Math.min(...valid.map((p) => p.cost));
  const maxCost = Math.max(...valid.map((p) => p.cost));
  if (maxCost === minCost) return null;
  const steps = 30;
  const trendPoints: Array<{ cost: number; predicted: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    const x = minCost + (maxCost - minCost) * ratio;
    const y = Math.max(0, a * Math.log(x) + b);
    trendPoints.push({ cost: x, predicted: y });
  }
  return trendPoints;
}

function formatPct(value: number | null | undefined) {
  return `${(value ?? 0).toFixed(2)}%`;
}

function calcCtr(clicks: number, impressions: number) {
  return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

function calcCpc(cost: number, clicks: number) {
  return clicks > 0 ? cost / clicks : 0;
}

function calcCostPerResult(cost: number, conversions: number) {
  return conversions > 0 ? cost / conversions : 0;
}

function calcCvr(conversions: number, clicks: number) {
  return clicks > 0 ? (conversions / clicks) * 100 : 0;
}

function getChartMetricValue(row: { cost: number; impressions: number; clicks: number; conversions: number }, metric: ChartMetric) {
  if (metric === "cost") return row.cost;
  if (metric === "cpm") return row.impressions > 0 ? (row.cost / row.impressions) * 1000 : 0;
  if (metric === "cpc") return calcCpc(row.cost, row.clicks);
  if (metric === "ctr") return calcCtr(row.clicks, row.impressions);
  if (metric === "cvr") return calcCvr(row.conversions, row.clicks);
  if (metric === "conversions") return row.conversions;
  return calcCostPerResult(row.cost, row.conversions);
}

function formatMetricValue(metric: ChartMetric, value: number | null | undefined) {
  if (metric === "ctr" || metric === "cvr") return formatPct(value);
  if (metric === "conversions") return formatNumber(value);
  return formatKRW(value);
}

function formatDetailPeriod(value: string | null | undefined, granularity: DetailDateGranularity) {
  if (!value) return "-";
  if (granularity === "month") return value;
  if (granularity === "week") return `${value} 주`;
  return value;
}
export default function AdPerformanceDashboard({
  folderId,
  folderProject,
  reportStart,
  reportEnd,
  detailColumns,
}: {
  folderId: string;
  folderProject: { id: string; name: string };
  reportStart?: string;
  reportEnd?: string;
  detailColumns: AdDetailMetricColumn[];
}) {
  // 차트 색을 토큰에서 읽는다 — 박아 둔 #8b5cf6 은 리브랜드로 팔레트에서 사라진 보라였고,
  // 그래서 이 페이지의 그래프만 앱의 나머지(네이비)와 다른 색으로 보였다.
  const chart = useChartColors();
  const { workspace, isLoading: wsLoading } = useWorkspace();
  const currentProject = folderProject;
  const hasLoadedRef = useRef(false);
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<DateRange>(() => reportStart && reportEnd ? folderDateRange(reportStart, reportEnd) : defaultRange());
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [selectedCampaignName, setSelectedCampaignName] = useState<string | null>(null);
  const [selectedAdGroupName, setSelectedAdGroupName] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("cost");
  const [dualMetricA, setDualMetricA] = useState<ChartMetric>("cost");
  const [dualMetricB, setDualMetricB] = useState<ChartMetric>("conversions");
  const [detailGroupBy, setDetailGroupBy] = useState<DetailGroupBy>("campaign");
  const [detailDateGranularity, setDetailDateGranularity] = useState<DetailDateGranularity>("day");
  const [detailPeriod, setDetailPeriod] = useState<string | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [detailSortCol, setDetailSortCol] = useState<string | null>(null);
  const [detailSortDir, setDetailSortDir] = useState<"asc" | "desc">("asc");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [previousTotals, setPreviousTotals] = useState<PerformanceResponse["totals"] | null>(null);
  const [previousChartRows, setPreviousChartRows] = useState<Array<{ date: string; cost: number; impressions: number; clicks: number; conversions: number }>>([]);
  const [campaignViewMode, setCampaignViewMode] = useState<"scroll" | "grid">("scroll");
  const [adGroupViewMode, setAdGroupViewMode] = useState<"scroll" | "grid">("scroll");
  const [showCampaigns, setShowCampaigns] = useState(false);
  const visibleDetailMetrics = AD_DETAIL_METRIC_COLUMNS.filter((column) => detailColumns.includes(column.key));

  const detailMetricValue = (row: DetailRow, key: AdDetailMetricColumn) => {
    const cost = row.cost ?? 0;
    const impressions = row.impressions ?? 0;
    const clicks = row.clicks ?? 0;
    const conversions = row.conversions ?? 0;
    if (key === "cost") return formatKRW(cost);
    if (key === "impressions") return formatNumber(impressions);
    if (key === "reach") return formatNumber(row.reach);
    if (key === "clicks") return formatNumber(clicks);
    if (key === "ctr") return formatPct(row.ctr ?? calcCtr(clicks, impressions));
    if (key === "cpm") return formatKRW(row.cpm ?? getChartMetricValue({ cost, impressions, clicks, conversions }, "cpm"));
    if (key === "cpc") return formatKRW(row.cpc ?? getChartMetricValue({ cost, impressions, clicks, conversions }, "cpc"));
    if (key === "conversions") return formatNumber(conversions);
    return formatKRW(row.costPerConversion ?? calcCostPerResult(cost, conversions));
  };

  const detailMetricCsvValue = (row: DetailRow, key: AdDetailMetricColumn) => detailMetricValue(row, key).replace(/원$/, "").replace(/,/g, "");
  const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

  useEffect(() => {
    if (reportStart && reportEnd) return;
    let active = true;
    void fetch(`/api/ad-performance/folders/${folderId}`)
      .then(response => response.ok ? response.json() : null)
      .then(result => {
        if (active && result?.folder?.reportStart && result?.folder?.reportEnd) {
          setRange(folderDateRange(result.folder.reportStart, result.folder.reportEnd));
        }
      });
    return () => { active = false; };
  }, [folderId, reportStart, reportEnd]);

  const selectSource = (nextSource: string) => {
    setSourceFilter(nextSource);
    setSelectedCampaignName(null);
    setSelectedAdGroupName(null);
    setDetailPeriod(null);
    setDetailPage(1);
  };

  const selectCampaign = (campaignName: string | null) => {
    setSelectedCampaignName(campaignName);
    setSelectedAdGroupName(null);
    setDetailPeriod(null);
    setDetailPage(1);
  };

  const selectAdGroup = (adGroupName: string | null) => {
    setSelectedAdGroupName(adGroupName);
    setDetailPeriod(null);
    setDetailPage(1);
  };

  const handleRangeChange = (next: DateRange) => {
    setRange(next);
    setDetailPeriod(null);
    setDetailPage(1);
  };

  const handleDetailSort = (col: string) => {
    if (detailSortCol === col) {
      setDetailSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setDetailSortCol(col);
      setDetailSortDir("asc");
    }
  };

  const changeDetailGroupBy = (nextGroupBy: DetailGroupBy) => {
    setDetailGroupBy(nextGroupBy);
    setDetailPage(1);
  };

  const changeDetailDateGranularity = (nextGranularity: DetailDateGranularity) => {
    setDetailDateGranularity(nextGranularity);
    setDetailPeriod(null);
    setDetailPage(1);
  };

  const changeDetailPeriod = (nextPeriod: string) => {
    setDetailPeriod(nextPeriod || null);
    setDetailPage(1);
  };

  const fetchData = useCallback(async () => {
    if (!workspace) return;
    const isInitialLoad = !hasLoadedRef.current;
    if (isInitialLoad) setLoading(true);
    else setRefreshing(true);

    try {
      const params = new URLSearchParams({
        workspaceId: workspace.id,
        projectId: folderProject.id,
        folderId,
        sourceType: sourceFilter,
        detailGroupBy,
        detailDateGranularity,
        detailPage: String(detailPage),
        detailPageSize: String(DETAIL_PAGE_SIZE),
      });

      const isAllTime = range.label === ALL_TIME_LABEL;
      if (!isAllTime) {
        params.set("from", range.from.toISOString());
        params.set("to", range.to.toISOString());
      }

      if (selectedCampaignName) params.set("campaignName", selectedCampaignName);
      if (selectedAdGroupName) params.set("adGroupName", selectedAdGroupName);
      if (detailPeriod) params.set("detailPeriod", detailPeriod);

      const res = await fetch(`/api/ad-performance?${params.toString()}`);
      const next = await res.json().catch(() => null);
      if (!res.ok) throw new Error(next?.error ?? "광고 성과를 불러오지 못했어요");
      setData(next);
      hasLoadedRef.current = true;

      // Fetch previous period for comparison (② and ⑭)
      if (!isAllTime) {
        const spanMs = range.to.getTime() - range.from.getTime();
        const prevTo = new Date(range.from.getTime() - 1);
        const prevFrom = new Date(prevTo.getTime() - spanMs);
        const prevParams = new URLSearchParams({
          workspaceId: workspace.id,
          projectId: folderProject.id,
          folderId,
          sourceType: sourceFilter,
          from: prevFrom.toISOString(),
          to: prevTo.toISOString(),
          detailGroupBy: "campaign",
          detailDateGranularity: "day",
          detailPage: "1",
          detailPageSize: "1",
        });
        try {
          const prevRes = await fetch(`/api/ad-performance?${prevParams.toString()}`);
          const prevData = await prevRes.json().catch(() => null);
          if (prevRes.ok && prevData?.totals) {
            setPreviousTotals(prevData.totals as PerformanceResponse["totals"]);
            setPreviousChartRows(prevData.dailyTrend ?? []);
          } else {
            setPreviousTotals(null);
            setPreviousChartRows([]);
          }
        } catch {
          setPreviousTotals(null);
          setPreviousChartRows([]);
        }
      } else {
        setPreviousTotals(null);
        setPreviousChartRows([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "광고 성과를 불러오지 못했어요");
      if (isInitialLoad) setData(null);
    } finally {
      if (isInitialLoad) setLoading(false);
      setRefreshing(false);
    }
  }, [
    workspace,
    folderId,
    folderProject,
    range,
    sourceFilter,
    selectedCampaignName,
    selectedAdGroupName,
    detailGroupBy,
    detailDateGranularity,
    detailPeriod,
    detailPage,
  ]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void fetchData();
    }, 0);
    return () => window.clearTimeout(id);
  }, [fetchData]);

  const totals = data?.totals;
  const currentSourceLabel = sourceFilter === "ALL" ? "전체 매체" : SOURCE_LABELS[sourceFilter] ?? sourceFilter;
  const currentScopeLabel = [
    currentSourceLabel,
    selectedCampaignName,
    selectedAdGroupName,
  ].filter(Boolean).join(" · ");
  const mediaSummaries = useMemo(() => {
    const sourceRows = data?.mediaSummary ?? data?.sourceSummary ?? [];
    const lookup = new Map(sourceRows.map((source) => [source.sourceType, source]));
    const fixed = (["GOOGLE", "META", "LINKEDIN"] as SourceType[]).map((sourceType) => {
      const row = lookup.get(sourceType);
      return {
        sourceType,
        cost: row?.cost ?? 0,
        impressions: row?.impressions ?? 0,
        clicks: row?.clicks ?? 0,
        conversions: row?.conversions ?? 0,
      };
    });
    const extras = sourceRows.filter((row) => !["GOOGLE", "META", "LINKEDIN"].includes(row.sourceType));
    return [...fixed, ...extras];
  }, [data]);
  const chartRows = useMemo(() => {
    const bySourceMap = new Map(
      (data?.dailyTrendBySource ?? []).map((r) => [r.date, r.sources])
    );
    return (data?.dailyTrend ?? []).map((row, idx) => {
      const sources = bySourceMap.get(row.date) ?? {};
      const sourceValues = Object.fromEntries(
        Object.entries(sources).map(([src, vals]) => [src, getChartMetricValue(vals, chartMetric)])
      );
      const prevRow = previousChartRows[idx];
      const prevValue = prevRow ? getChartMetricValue(prevRow, chartMetric) : null;
      return { ...row, value: getChartMetricValue(row, chartMetric), prevValue, ...sourceValues };
    });
  }, [data, chartMetric, previousChartRows]);
  const hasChartData = (data?.dailyTrend ?? []).some((row) => row.cost > 0 || row.impressions > 0 || row.clicks > 0 || row.conversions > 0);

  const dualChartRows = useMemo(() => {
    return (data?.dailyTrend ?? []).map((row) => ({
      ...row,
      valueA: getChartMetricValue(row, dualMetricA),
      valueB: getChartMetricValue(row, dualMetricB),
    }));
  }, [data, dualMetricA, dualMetricB]);

  const heatmapData = useMemo(() => {
    const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
    const byCellKey = new Map<string, { cost: number; impressions: number; clicks: number; conversions: number; count: number }>();
    (data?.dailyTrend ?? []).forEach((row) => {
      const d = new Date(row.date);
      if (isNaN(d.getTime())) return;
      const week = Math.floor((data!.dailyTrend.indexOf(row)) / 7);
      const dayIdx = d.getDay();
      const key = `${week}-${dayIdx}`;
      const existing = byCellKey.get(key) ?? { cost: 0, impressions: 0, clicks: 0, conversions: 0, count: 0 };
      byCellKey.set(key, {
        cost: existing.cost + (row.cost ?? 0),
        impressions: existing.impressions + (row.impressions ?? 0),
        clicks: existing.clicks + (row.clicks ?? 0),
        conversions: existing.conversions + (row.conversions ?? 0),
        count: existing.count + 1,
      });
    });
    const cells: Array<{ date: string; dayIdx: number; dayLabel: string; cost: number; impressions: number; clicks: number; conversions: number }> = [];
    (data?.dailyTrend ?? []).forEach((row) => {
      const d = new Date(row.date);
      if (isNaN(d.getTime())) return;
      cells.push({ date: row.date, dayIdx: d.getDay(), dayLabel: DAY_LABELS[d.getDay()], cost: row.cost ?? 0, impressions: row.impressions ?? 0, clicks: row.clicks ?? 0, conversions: row.conversions ?? 0 });
    });
    return cells;
  }, [data]);

  const activeSourceTypes = useMemo(() => {
    if (sourceFilter !== "ALL") return [];
    const set = new Set<string>();
    (data?.dailyTrendBySource ?? []).forEach((row) =>
      Object.keys(row.sources).forEach((src) => set.add(src))
    );
    return Array.from(set);
  }, [data, sourceFilter]);
  const chartMetricLabel = CHART_METRICS.find((metric) => metric.value === chartMetric)?.label ?? "지출";
  const rawDetailRows = data?.detailRows ?? data?.recentRows ?? [];
  const detailRows = useMemo(() => {
    if (!detailSortCol) return rawDetailRows;
    const sorted = [...rawDetailRows].sort((a, b) => {
      const col = detailSortCol as keyof DetailRow;
      const aVal = a[col] ?? "";
      const bVal = b[col] ?? "";
      if (typeof aVal === "number" && typeof bVal === "number") {
        return detailSortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return detailSortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return sorted;
  }, [rawDetailRows, detailSortCol, detailSortDir]);
  const detailPagination = data?.detailPagination ?? {
    page: detailPage,
    pageSize: DETAIL_PAGE_SIZE,
    total: detailRows.length,
    totalPages: Math.max(1, Math.ceil(detailRows.length / DETAIL_PAGE_SIZE)),
    groupBy: detailGroupBy,
    dateGranularity: detailDateGranularity,
    period: detailPeriod,
  };
  const detailPeriodOptions = data?.detailPeriodOptions ?? [];
  const selectedDetailPeriod = detailPagination.period ?? detailPeriod ?? detailPeriodOptions[0]?.value ?? "";
  const detailDateHeader = DETAIL_DATE_OPTIONS.find((option) => option.value === detailDateGranularity)?.header ?? "일자";
  const detailStartIndex = detailPagination.total === 0 ? 0 : (detailPagination.page - 1) * detailPagination.pageSize + 1;
  const detailEndIndex = Math.min(detailPagination.total, detailPagination.page * detailPagination.pageSize);

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
        <BarChart3 className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">프로젝트를 먼저 선택해주세요</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="space-y-5 p-4 sm:p-6 lg:p-8"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">광고 성과</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            매체별 성과 파일을 업로드하고 비용, 클릭, 전환 흐름을 한 곳에서 봅니다
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="grid h-10 grid-cols-4 rounded-xl border border-border bg-secondary/30 p-1">
            {MEDIA_FILTERS.map((filter) => (
              <motion.button
                key={filter.value}
                onClick={() => selectSource(filter.value)}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96 }}
                transition={spring}
                className={`relative rounded-lg px-3 text-xs font-medium transition-colors ${
                  sourceFilter === filter.value
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {sourceFilter === filter.value && (
                  <motion.div
                    layoutId="ad-media-filter-bg"
                    className="absolute inset-0 rounded-lg bg-background shadow-sm"
                    transition={spring}
                    style={{ zIndex: 0 }}
                  />
                )}
                <span className="relative z-10">{filter.label}</span>
              </motion.button>
            ))}
          </div>
          <DateRangePicker value={range} onChange={handleRangeChange} allowAllTime />
          <motion.button
            onClick={fetchData}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.94 }}
            transition={spring}
            className="rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary"
            aria-label="새로고침"
          >
            <RefreshCw className={`h-4 w-4 ${loading || refreshing ? "animate-spin" : ""}`} />
          </motion.button>
          <motion.button
            onClick={() => setShareOpen(true)}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={spring}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm transition-colors hover:bg-secondary"
          >
            <Share2 className="h-4 w-4" />
            공유
          </motion.button>
          <motion.button
            onClick={() => setHistoryOpen(true)}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={spring}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-violet-500 px-4 text-sm font-medium text-white transition-colors hover:bg-violet-600"
          >
            <Database className="h-4 w-4" />
            소스 관리
          </motion.button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-8">
        <MetricCard label="지출" value={formatKRW(totals?.cost)} sub={currentScopeLabel} currentRaw={totals?.cost} previousRaw={previousTotals?.cost ?? undefined} lowerIsBetter />
        <MetricCard label="CPM" value={formatKRW(totals?.cpm)} sub={`노출 ${formatNumber(totals?.impressions)}`} currentRaw={totals?.cpm} previousRaw={previousTotals?.cpm ?? undefined} lowerIsBetter />
        <MetricCard label="링크 CPC" value={formatKRW(totals?.cpc)} sub={`링크 클릭 ${formatNumber(totals?.clicks)}`} currentRaw={totals?.cpc} previousRaw={previousTotals?.cpc ?? undefined} lowerIsBetter />
        <MetricCard label="링크 CTR" value={formatPct(totals?.ctr)} currentRaw={totals?.ctr} previousRaw={previousTotals?.ctr ?? undefined} />
        <MetricCard label="CVR" value={formatPct(totals?.cvr)} sub={`결과 ${formatNumber(totals?.conversions)}`} currentRaw={totals?.cvr} previousRaw={previousTotals?.cvr ?? undefined} />
        <MetricCard label="도달" value={formatNumber(totals?.reach)} sub="누적 도달(중복 포함)" currentRaw={totals?.reach} />
        <MetricCard label="결과" value={formatNumber(totals?.conversions)} currentRaw={totals?.conversions} previousRaw={previousTotals?.conversions ?? undefined} />
        <MetricCard label="결과당 비용" value={formatKRW(totals?.costPerConversion)} currentRaw={totals?.costPerConversion} previousRaw={previousTotals?.costPerConversion ?? undefined} lowerIsBetter />
      </div>

      {loading ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex h-80 items-center justify-center rounded-2xl border border-border"
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </motion.div>
      ) : !data || data.batches.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="flex min-h-96 flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center"
        >
          <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
            <FileSpreadsheet className="mb-3 h-10 w-10 text-muted-foreground/30" />
          </motion.div>
          <p className="text-sm font-medium">아직 추가된 광고 소스가 없어요</p>
          <p className="mt-1 text-xs text-muted-foreground">CSV/엑셀 파일이나 Google Sheets를 연결하면 리포트가 생성됩니다.</p>
          <motion.button
            onClick={() => setUploadOpen(true)}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={spring}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600"
          >
            <Upload className="h-4 w-4" />
            첫 소스 추가
          </motion.button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="space-y-4"
        >
          <div className="space-y-4">
            <motion.section
              whileHover={{ borderColor: "rgba(139, 92, 246, 0.22)" }}
              transition={spring}
              className="rounded-2xl border border-border bg-background p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">성과 범위</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">매체, 캠페인, 광고세트를 순서대로 좁혀 봅니다.</p>
                </div>
                {(sourceFilter !== "ALL" || selectedCampaignName || selectedAdGroupName) && (
                  <motion.button
                    onClick={() => selectSource("ALL")}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    transition={spring}
                    className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    전체 보기
                  </motion.button>
                )}
              </div>

              <div className="flex gap-2 overflow-x-auto px-0.5 py-1.5">
                <MediaPerformanceCard
                  sourceType="ALL"
                  active={sourceFilter === "ALL"}
                  cost={mediaSummaries.reduce((sum, source) => sum + source.cost, 0)}
                  impressions={mediaSummaries.reduce((sum, source) => sum + source.impressions, 0)}
                  clicks={mediaSummaries.reduce((sum, source) => sum + source.clicks, 0)}
                  conversions={mediaSummaries.reduce((sum, source) => sum + source.conversions, 0)}
                  onClick={() => selectSource("ALL")}
                />
                {mediaSummaries.map((source) => (
                  <MediaPerformanceCard
                    key={source.sourceType}
                    sourceType={source.sourceType}
                    active={sourceFilter === source.sourceType}
                    cost={source.cost}
                    impressions={source.impressions}
                    clicks={source.clicks}
                    conversions={source.conversions}
                    onClick={() => selectSource(source.sourceType)}
                  />
                ))}
              </div>

              {/* ALL view: show drill-down toggle button */}
              {sourceFilter === "ALL" && (
                <div className="mt-2 flex justify-center">
                  <motion.button
                    onClick={() => setShowCampaigns((v) => !v)}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    transition={spring}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {showCampaigns ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
                    {showCampaigns ? "캠페인 접기" : "캠페인별로 보기 ▾"}
                  </motion.button>
                </div>
              )}

              <AnimatePresence>
                {(sourceFilter !== "ALL" || showCampaigns) && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={spring}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 border-t border-border pt-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          {sourceFilter === "ALL" ? "캠페인 드릴다운" : "광고 캠페인"}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">{data.campaignSummary.length.toLocaleString()}개</span>
                          {data.campaignSummary.length > 6 && (
                            <motion.button
                              onClick={() => setCampaignViewMode((m) => m === "scroll" ? "grid" : "scroll")}
                              whileHover={{ y: -1 }}
                              whileTap={{ scale: 0.96 }}
                              transition={spring}
                              className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                              {campaignViewMode === "scroll" ? <LayoutGrid className="inline h-3 w-3 mr-1" /> : <List className="inline h-3 w-3 mr-1" />}
                              {campaignViewMode === "scroll" ? "그리드 보기" : "스크롤 보기"}
                            </motion.button>
                          )}
                          {(selectedCampaignName || selectedAdGroupName) && (
                            <motion.button
                              onClick={() => selectCampaign(null)}
                              whileHover={{ y: -1 }}
                              whileTap={{ scale: 0.96 }}
                              transition={spring}
                              className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                              캠페인 해제
                            </motion.button>
                          )}
                        </div>
                      </div>
                      {campaignViewMode === "grid" && data.campaignSummary.length > 6 ? (
                        <div className="grid grid-cols-3 gap-2 px-0.5 py-1.5">
                          {data.campaignSummary.map((campaign) => (
                            <PerformancePickCard
                              key={`${campaign.sourceType}:${campaign.campaignName}`}
                              title={campaign.campaignName}
                              meta={`${SOURCE_LABELS[campaign.sourceType] ?? campaign.sourceType} · 지출 ${formatKRW(campaign.cost)} · 전환 ${formatNumber(campaign.conversions)}`}
                              active={selectedCampaignName === campaign.campaignName}
                              onClick={() => selectCampaign(selectedCampaignName === campaign.campaignName ? null : campaign.campaignName)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="flex gap-2 overflow-x-auto px-0.5 py-1.5">
                          {data.campaignSummary.map((campaign) => (
                            <PerformancePickCard
                              key={`${campaign.sourceType}:${campaign.campaignName}`}
                              title={campaign.campaignName}
                              meta={`${sourceFilter === "ALL" ? (SOURCE_LABELS[campaign.sourceType] ?? campaign.sourceType) + " · " : ""}지출 ${formatKRW(campaign.cost)} · 전환 ${formatNumber(campaign.conversions)}`}
                              active={selectedCampaignName === campaign.campaignName}
                              onClick={() => selectCampaign(selectedCampaignName === campaign.campaignName ? null : campaign.campaignName)}
                            />
                          ))}
                          {data.campaignSummary.length === 0 && (
                            <CompactEmpty label="선택한 매체에서 캠페인을 찾지 못했어요." />
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {(sourceFilter !== "ALL" || showCampaigns) && selectedCampaignName && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={spring}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 border-t border-border pt-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">광고세트 / 광고그룹</p>
                        <div className="flex items-center gap-2">
                          {data.adGroupSummary.length > 6 && (
                            <motion.button
                              onClick={() => setAdGroupViewMode((m) => m === "scroll" ? "grid" : "scroll")}
                              whileHover={{ y: -1 }}
                              whileTap={{ scale: 0.96 }}
                              transition={spring}
                              className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                              {adGroupViewMode === "scroll" ? <LayoutGrid className="inline h-3 w-3 mr-1" /> : <List className="inline h-3 w-3 mr-1" />}
                              {adGroupViewMode === "scroll" ? "그리드 보기" : "스크롤 보기"}
                            </motion.button>
                          )}
                          {selectedAdGroupName && (
                            <motion.button
                              onClick={() => selectAdGroup(null)}
                              whileHover={{ y: -1 }}
                              whileTap={{ scale: 0.96 }}
                              transition={spring}
                              className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                              광고세트 해제
                            </motion.button>
                          )}
                        </div>
                      </div>
                      {adGroupViewMode === "grid" && data.adGroupSummary.length > 6 ? (
                        <div className="grid grid-cols-3 gap-2 px-0.5 py-1.5">
                          {data.adGroupSummary.map((adGroup) => (
                            <PerformancePickCard
                              key={`${adGroup.sourceType}:${adGroup.campaignName}:${adGroup.adGroupName ?? ""}`}
                              title={adGroup.adGroupName || "광고세트/그룹 없음"}
                              meta={`지출 ${formatKRW(adGroup.cost)} · 전환 ${formatNumber(adGroup.conversions)}`}
                              active={selectedAdGroupName === adGroup.adGroupName}
                              onClick={() => selectAdGroup(selectedAdGroupName === adGroup.adGroupName ? null : adGroup.adGroupName ?? null)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="flex gap-2 overflow-x-auto px-0.5 py-1.5">
                          {data.adGroupSummary.map((adGroup) => (
                            <PerformancePickCard
                              key={`${adGroup.sourceType}:${adGroup.campaignName}:${adGroup.adGroupName ?? ""}`}
                              title={adGroup.adGroupName || "광고세트/그룹 없음"}
                              meta={`지출 ${formatKRW(adGroup.cost)} · 전환 ${formatNumber(adGroup.conversions)}`}
                              active={selectedAdGroupName === adGroup.adGroupName}
                              onClick={() => selectAdGroup(selectedAdGroupName === adGroup.adGroupName ? null : adGroup.adGroupName ?? null)}
                            />
                          ))}
                          {data.adGroupSummary.length === 0 && (
                            <CompactEmpty label="이 캠페인에서 광고세트/광고그룹 데이터를 찾지 못했어요." />
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.section>

            <motion.section
              whileHover={{ borderColor: "rgba(139, 92, 246, 0.18)" }}
              transition={spring}
              className="rounded-2xl border border-border bg-background p-5"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">{chartMetricLabel} 추이</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{currentScopeLabel} 기준으로 일자별 흐름을 확인합니다.</p>
                </div>
                <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-secondary/30 p-1">
                  {CHART_METRICS.map((metric) => (
                    <motion.button
                      key={metric.value}
                      onClick={() => setChartMetric(metric.value)}
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.96 }}
                      transition={spring}
                      className={`relative rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        chartMetric === metric.value
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {chartMetric === metric.value && (
                        <motion.div
                          layoutId="ad-chart-metric-bg"
                          className="absolute inset-0 rounded-lg bg-background shadow-sm"
                          transition={spring}
                          style={{ zIndex: 0 }}
                        />
                      )}
                      <span className="relative z-10">{metric.label}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
              <div className={`relative ${activeSourceTypes.length > 0 ? "h-72" : "h-64"}`}>
                {!hasChartData && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <BarChart3 className="h-8 w-8 opacity-25" />
                    <p className="text-sm">선택한 기간·매체에 데이터가 없어요</p>
                  </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartRows}>
                    <defs>
                      <linearGradient id="adSpendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chart.viewers} stopOpacity={activeSourceTypes.length > 0 ? 0.1 : 0.28} />
                        <stop offset="95%" stopColor={chart.viewers} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(date: string) => {
                        if (/^\d{4}-\d{2}$/.test(date)) return date.slice(2).replace("-", ".");
                        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                          const [, mm, dd] = date.split("-");
                          return `${Number(mm)}/${Number(dd)}`;
                        }
                        return date;
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(value) => formatMetricValue(chartMetric, Number(value))}
                      width={82}
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        formatMetricValue(chartMetric, Number(value ?? 0)),
                        name === "value" ? "전체" : name === "prevValue" ? "이전 기간" : (SOURCE_LABELS[String(name)] ?? String(name)),
                      ]}
                    />
                    {(activeSourceTypes.length > 0 || previousChartRows.length > 0) && (
                      <Legend
                        formatter={(value) => value === "prevValue" ? "이전 기간" : (SOURCE_LABELS[value] ?? value)}
                        wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={chart.viewers}
                      strokeWidth={activeSourceTypes.length > 0 ? 1 : 2}
                      strokeDasharray={activeSourceTypes.length > 0 ? "4 4" : undefined}
                      fill="url(#adSpendFill)"
                      name="value"
                      legendType="none"
                    />
                    {previousChartRows.length > 0 && (
                      <Line
                        type="monotone"
                        dataKey="prevValue"
                        stroke="#94a3b8"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        dot={false}
                        name="prevValue"
                        legendType="line"
                        connectNulls
                      />
                    )}
                    {activeSourceTypes.map((src) => (
                      <Line
                        key={src}
                        type="monotone"
                        dataKey={src}
                        stroke={SOURCE_COLORS[src] ?? "#888"}
                        strokeWidth={2}
                        dot={false}
                        name={src}
                        connectNulls
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </motion.section>

            {/* ⑬ Dual-metric overlay chart */}
            <motion.section
              whileHover={{ borderColor: "rgba(16, 185, 129, 0.18)" }}
              transition={spring}
              className="rounded-2xl border border-border bg-background p-5"
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">보조 지표 추이</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{currentScopeLabel} 기준 두 지표 동시 비교</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: chart.viewers }} />
                    <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-secondary/30 p-1">
                      {CHART_METRICS.map((metric) => (
                        <motion.button
                          key={metric.value}
                          onClick={() => setDualMetricA(metric.value)}
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.96 }}
                          transition={spring}
                          className={`relative rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                            dualMetricA === metric.value ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {dualMetricA === metric.value && (
                            <motion.div layoutId="ad-dual-a-bg" className="absolute inset-0 rounded-lg bg-background shadow-sm" transition={spring} style={{ zIndex: 0 }} />
                          )}
                          <span className="relative z-10">{metric.label}</span>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-[#10b981]" />
                    <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-secondary/30 p-1">
                      {CHART_METRICS.map((metric) => (
                        <motion.button
                          key={metric.value}
                          onClick={() => setDualMetricB(metric.value)}
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.96 }}
                          transition={spring}
                          className={`relative rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                            dualMetricB === metric.value ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {dualMetricB === metric.value && (
                            <motion.div layoutId="ad-dual-b-bg" className="absolute inset-0 rounded-lg bg-background shadow-sm" transition={spring} style={{ zIndex: 0 }} />
                          )}
                          <span className="relative z-10">{metric.label}</span>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="relative h-56">
                {dualChartRows.length === 0 && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <BarChart3 className="h-8 w-8 opacity-25" />
                    <p className="text-sm">선택한 기간·매체에 데이터가 없어요</p>
                  </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dualChartRows}>
                    <defs>
                      <linearGradient id="adDualFillA" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chart.viewers} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={chart.viewers} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(date: string) => {
                        if (/^\d{4}-\d{2}$/.test(date)) return date.slice(2).replace("-", ".");
                        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                          const [, mm, dd] = date.split("-");
                          return `${Number(mm)}/${Number(dd)}`;
                        }
                        return date;
                      }}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: chart.axis }}
                      tickFormatter={(value) => formatMetricValue(dualMetricA, Number(value))}
                      width={82}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: "#10b981" }}
                      tickFormatter={(value) => formatMetricValue(dualMetricB, Number(value))}
                      width={72}
                    />
                    <Tooltip
                      formatter={(value, name) => {
                        if (name === "valueA") return [formatMetricValue(dualMetricA, Number(value ?? 0)), CHART_METRICS.find((m) => m.value === dualMetricA)?.label ?? dualMetricA];
                        if (name === "valueB") return [formatMetricValue(dualMetricB, Number(value ?? 0)), CHART_METRICS.find((m) => m.value === dualMetricB)?.label ?? dualMetricB];
                        return [value, name];
                      }}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="valueA"
                      stroke={chart.viewers}
                      strokeWidth={2}
                      fill="url(#adDualFillA)"
                      name="valueA"
                      legendType="none"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="valueB"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                      name="valueB"
                      legendType="none"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </motion.section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* ③ 캠페인 효율 산포도 */}
            <motion.section
              whileHover={{ borderColor: "rgba(14, 165, 233, 0.18)" }}
              transition={spring}
              className="rounded-2xl border border-border bg-background p-5"
            >
              <div className="mb-4">
                <h2 className="text-sm font-semibold">캠페인 효율 산포도</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">지출(X) × 전환(Y) · 원 크기 = CTR · 초록 점선 = 수확체감 곡선</p>
              </div>
              {(() => {
                const scatterPoints = (data?.campaignSummary ?? []).map((c) => ({
                  cost: c.cost ?? 0,
                  conversions: c.conversions ?? 0,
                  ctr: c.ctr ?? 0,
                  name: c.campaignName,
                }));
                const trendPoints = computeLogTrend(scatterPoints);
                if (scatterPoints.length === 0) {
                  return (
                    <div className="flex h-52 flex-col items-center justify-center gap-2 text-muted-foreground">
                      <BarChart3 className="h-8 w-8 opacity-25" />
                      <p className="text-sm">캠페인 데이터가 없어요</p>
                    </div>
                  );
                }
                return (
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          type="number"
                          dataKey="cost"
                          name="지출"
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          tickFormatter={(v) => formatMetricValue("cost", Number(v))}
                          allowDuplicatedCategory={false}
                        />
                        <YAxis
                          type="number"
                          name="전환"
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          width={52}
                        />
                        <ZAxis type="number" dataKey="ctr" range={[40, 400]} name="CTR" />
                        <Tooltip
                          cursor={{ strokeDasharray: "3 3" }}
                          labelFormatter={(label, payload) => {
                            const point = payload?.[0]?.payload as { name?: string } | undefined;
                            if (point?.name) return point.name;
                            return formatMetricValue("cost", Number(label));
                          }}
                          formatter={(value, name) => {
                            if (name === "지출") return [formatMetricValue("cost", Number(value)), "지출"];
                            if (name === "CTR") return [`${Number(value).toFixed(2)}%`, "CTR"];
                            if (name === "전환수") return [formatNumber(Number(value)), "전환수"];
                            if (name === "예상 전환" || name === "predicted") return [`${Number(value).toFixed(1)}건`, "예상 전환 (트렌드)"];
                            return [value, name];
                          }}
                        />
                        {trendPoints && (
                          <Line
                            type="monotone"
                            data={trendPoints}
                            dataKey="predicted"
                            stroke="#10b981"
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            dot={false}
                            isAnimationActive={false}
                            name="예상 전환"
                            legendType="none"
                          />
                        )}
                        <Scatter
                          data={scatterPoints}
                          dataKey="conversions"
                          fill="#0ea5e9"
                          fillOpacity={0.7}
                          name="전환수"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}
            </motion.section>

            {/* ⑤ 요일별 성과 히트맵 */}
            <motion.section
              whileHover={{ borderColor: "rgba(16, 185, 129, 0.18)" }}
              transition={spring}
              className="rounded-2xl border border-border bg-background p-5"
            >
              <div className="mb-4">
                <h2 className="text-sm font-semibold">요일별 성과 히트맵</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">날짜별 클릭수 강도 시각화</p>
              </div>
              {heatmapData.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <BarChart3 className="h-8 w-8 opacity-25" />
                  <p className="text-sm">데이터가 없어요</p>
                </div>
              ) : (
                <div>
                  <div className="mb-1.5 grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
                    {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
                      <div key={d}>{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {(() => {
                      const maxClicks = Math.max(...heatmapData.map((c) => c.clicks), 1);
                      const firstDay = heatmapData[0] ? new Date(heatmapData[0].date).getDay() : 0;
                      const paddedCells = [
                        ...Array.from({ length: firstDay }, (_, i) => ({ date: `pad-${i}`, dayIdx: i, dayLabel: "", cost: 0, impressions: 0, clicks: 0, conversions: 0, isPad: true })),
                        ...heatmapData.map((c) => ({ ...c, isPad: false })),
                      ];
                      return paddedCells.map((cell, i) => {
                        if ((cell as { isPad?: boolean }).isPad) return <div key={cell.date} className="h-7 rounded-sm" />;
                        const intensity = maxClicks > 0 ? cell.clicks / maxClicks : 0;
                        const alpha = 0.08 + intensity * 0.85;
                        return (
                          <motion.div
                            key={cell.date}
                            title={`${cell.date}: ${cell.clicks.toLocaleString()} 클릭`}
                            whileHover={{ scale: 1.15 }}
                            transition={spring}
                            className="h-7 cursor-default rounded-sm"
                            style={{ backgroundColor: `rgba(16, 185, 129, ${alpha})` }}
                          />
                        );
                      });
                    })()}
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <span className="text-[10px] text-muted-foreground">적음</span>
                    <div className="flex gap-0.5">
                      {[0.08, 0.3, 0.5, 0.7, 0.93].map((a) => (
                        <div key={a} className="h-3 w-3 rounded-sm" style={{ backgroundColor: `rgba(16, 185, 129, ${a})` }} />
                      ))}
                    </div>
                    <span className="text-[10px] text-muted-foreground">많음</span>
                  </div>
                </div>
              )}
            </motion.section>
            </div>

            <motion.section
              whileHover={{ borderColor: "rgba(139, 92, 246, 0.18)" }}
              transition={spring}
              className="rounded-2xl border border-border bg-background"
            >
              <div className="border-b border-border p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">결과 상세</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      선택한 일/주/월 안에서 기준별 성과를 20개씩 확인합니다. 결과는 Meta 광고 관리자 기준입니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <motion.button
                      type="button"
                      onClick={() => {
                        const headers = ["일자", "매체", "캠페인", "광고세트/그룹", ...visibleDetailMetrics.map((column) => column.label)];
                        const rows = detailRows.map((row) => {
                          return [
                            formatDetailPeriod(row.periodKey ?? row.reportDate ?? row.reportStart, detailDateGranularity),
                            SOURCE_LABELS[row.sourceType] ?? row.sourceType,
                            row.campaignName,
                            row.adGroupName || "",
                            ...visibleDetailMetrics.map((column) => detailMetricCsvValue(row, column.key)),
                          ].map(csvCell).join(",");
                        });
                        const csvContent = "﻿" + [headers.map(csvCell).join(","), ...rows].join("\n");
                        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `ad-performance-${todayInputValue(0)}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.96 }}
                      transition={spring}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <Download className="h-3.5 w-3.5" />
                      CSV 내보내기
                    </motion.button>
                    <motion.div
                      whileHover={{ y: detailPeriodOptions.length ? -1 : 0 }}
                      transition={spring}
                      className="flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-2.5"
                      title="선택한 단위(일/주/월) 안의 특정 기간"
                    >
                      <span className="text-xs font-medium text-muted-foreground">일자 기준</span>
                      <select
                        value={selectedDetailPeriod}
                        onChange={(event) => changeDetailPeriod(event.target.value)}
                        disabled={detailPeriodOptions.length === 0}
                        className="h-7 min-w-32 bg-transparent text-xs font-medium outline-none disabled:cursor-not-allowed disabled:text-muted-foreground"
                      >
                        {detailPeriodOptions.length === 0 ? (
                          <option value="">데이터 없음</option>
                        ) : (
                          detailPeriodOptions.map((period) => (
                            <option key={period.value} value={period.value}>
                              {formatDetailPeriod(period.value, detailDateGranularity)} · {period.rowCount.toLocaleString()}개
                            </option>
                          ))
                        )}
                      </select>
                    </motion.div>
                    <div className="grid h-9 grid-cols-2 rounded-xl border border-border bg-secondary/30 p-1">
                      {DETAIL_GROUP_OPTIONS.map((option) => (
                        <motion.button
                          key={option.value}
                          type="button"
                          onClick={() => changeDetailGroupBy(option.value)}
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.96 }}
                          transition={spring}
                          className={`relative rounded-lg px-3 text-xs font-medium transition-colors ${
                            detailGroupBy === option.value
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {detailGroupBy === option.value && (
                            <motion.div
                              layoutId="ad-detail-group-bg"
                              className="absolute inset-0 rounded-lg bg-background shadow-sm"
                              transition={spring}
                              style={{ zIndex: 0 }}
                            />
                          )}
                          <span className="relative z-10">{option.label}</span>
                        </motion.button>
                      ))}
                    </div>
                    <div className="grid h-9 grid-cols-3 rounded-xl border border-border bg-secondary/30 p-1">
                      {DETAIL_DATE_OPTIONS.map((option) => (
                        <motion.button
                          key={option.value}
                          type="button"
                          onClick={() => changeDetailDateGranularity(option.value)}
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.96 }}
                          transition={spring}
                          className={`relative rounded-lg px-3 text-xs font-medium transition-colors ${
                            detailDateGranularity === option.value
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {detailDateGranularity === option.value && (
                            <motion.div
                              layoutId="ad-detail-date-bg"
                              className="absolute inset-0 rounded-lg bg-background shadow-sm"
                              transition={spring}
                              style={{ zIndex: 0 }}
                            />
                          )}
                          <span className="relative z-10">{option.label}</span>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1060px] text-sm">
                  <thead className="bg-secondary/40 text-xs text-muted-foreground">
                    <tr>
                      {(
                        [
                          { key: "periodKey", label: detailDateHeader, align: "left" },
                          { key: "sourceType", label: "매체", align: "left" },
                          { key: "campaignName", label: "캠페인", align: "left" },
                          { key: "adGroupName", label: "광고세트/그룹", align: "left" },
                          ...visibleDetailMetrics.map((column) => ({ key: column.key, label: column.label, align: "right" as const })),
                        ] as Array<{ key: string; label: string; align: "left" | "right" }>
                      ).map(({ key, label, align }) => (
                        <th
                          key={key}
                          onClick={() => handleDetailSort(key)}
                          className={`cursor-pointer select-none px-4 py-3 font-medium hover:text-foreground ${align === "right" ? "text-right" : "text-left"}`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {align === "right" && (
                              detailSortCol === key
                                ? detailSortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                                : <ArrowUpDown className="h-3 w-3 opacity-30" />
                            )}
                            {label}
                            {align === "left" && (
                              detailSortCol === key
                                ? detailSortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                                : <ArrowUpDown className="h-3 w-3 opacity-30" />
                            )}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((row) => {
                      return (
                      <motion.tr
                        key={row.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        whileHover={{ backgroundColor: "rgba(139, 92, 246, 0.045)" }}
                        className="border-t border-border"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {formatDetailPeriod(row.periodKey ?? row.reportDate ?? row.reportStart, detailDateGranularity)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{SOURCE_LABELS[row.sourceType] ?? row.sourceType}</td>
                        <td className="max-w-xs truncate px-4 py-3 font-medium">{row.campaignName}</td>
                        <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">{row.adGroupName || "-"}</td>
                        {visibleDetailMetrics.map((column) => <td key={column.key} className="px-4 py-3 text-right font-mono text-xs">{detailMetricValue(row, column.key)}</td>)}
                      </motion.tr>
                      );
                    })}
                    {detailRows.length === 0 && (
                      <tr>
                        <td colSpan={4 + visibleDetailMetrics.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                          표시할 성과 데이터가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
                <p className="text-xs text-muted-foreground">
                  전체 {detailPagination.total.toLocaleString()}개 중 {detailStartIndex.toLocaleString()}-{detailEndIndex.toLocaleString()}개 · {detailPagination.page} / {detailPagination.totalPages}
                </p>
                <div className="flex items-center gap-1.5">
                  <motion.button
                    type="button"
                    disabled={detailPagination.page <= 1}
                    onClick={() => setDetailPage(1)}
                    whileHover={detailPagination.page <= 1 ? undefined : { y: -1 }}
                    whileTap={detailPagination.page <= 1 ? undefined : { scale: 0.96 }}
                    transition={spring}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    처음
                  </motion.button>
                  <motion.button
                    type="button"
                    disabled={detailPagination.page <= 1}
                    onClick={() => setDetailPage(Math.max(1, detailPagination.page - 1))}
                    whileHover={detailPagination.page <= 1 ? undefined : { y: -1 }}
                    whileTap={detailPagination.page <= 1 ? undefined : { scale: 0.96 }}
                    transition={spring}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    이전
                  </motion.button>
                  <motion.button
                    type="button"
                    disabled={detailPagination.page >= detailPagination.totalPages}
                    onClick={() => setDetailPage(Math.min(detailPagination.totalPages, detailPagination.page + 1))}
                    whileHover={detailPagination.page >= detailPagination.totalPages ? undefined : { y: -1 }}
                    whileTap={detailPagination.page >= detailPagination.totalPages ? undefined : { scale: 0.96 }}
                    transition={spring}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    다음
                  </motion.button>
                  <motion.button
                    type="button"
                    disabled={detailPagination.page >= detailPagination.totalPages}
                    onClick={() => setDetailPage(detailPagination.totalPages)}
                    whileHover={detailPagination.page >= detailPagination.totalPages ? undefined : { y: -1 }}
                    whileTap={detailPagination.page >= detailPagination.totalPages ? undefined : { scale: 0.96 }}
                    transition={spring}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    마지막
                  </motion.button>
                </div>
              </div>
            </motion.section>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {uploadOpen && workspace && currentProject && (
          <UploadModal
            workspaceId={workspace.id}
            projectId={currentProject.id}
            folderId={folderId}
            existingBatches={data?.batches ?? []}
            onClose={() => setUploadOpen(false)}
            onImported={() => {
              setUploadOpen(false);
              setHistoryOpen(true);
              void fetchData();
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {historyOpen && data && (
          <ImportHistoryPanel
            batches={data.batches}
            onClose={() => setHistoryOpen(false)}
            onDelete={(id) => deleteBatchRequest(id, fetchData)}
            onAddSource={() => { setHistoryOpen(false); setUploadOpen(true); }}
          />
        )}
      </AnimatePresence>

      {currentProject && (
        <AnalyticsShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          projectId={currentProject.id}
          projectName={currentProject.name}
          currentRange={range}
        />
      )}
    </motion.div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  currentRaw,
  previousRaw,
  lowerIsBetter,
}: {
  label: string;
  value: string;
  sub?: string;
  currentRaw?: number;
  previousRaw?: number;
  lowerIsBetter?: boolean;
}) {
  const badge = useMemo(() => {
    if (currentRaw == null || previousRaw == null || previousRaw === 0) return null;
    const pct = ((currentRaw - previousRaw) / Math.abs(previousRaw)) * 100;
    if (Math.abs(pct) < 0.5) return null;
    const improved = lowerIsBetter ? pct < 0 : pct > 0;
    return { pct, improved };
  }, [currentRaw, previousRaw, lowerIsBetter]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, borderColor: "rgba(139, 92, 246, 0.35)" }}
      transition={spring}
      className="rounded-2xl border border-border bg-background p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {badge && (
          <motion.span
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={spring}
            className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
              badge.improved
                ? "bg-emerald-500/12 text-emerald-600"
                : "bg-red-500/12 text-red-500"
            }`}
          >
            {badge.improved ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {badge.pct > 0 ? "+" : ""}{badge.pct.toFixed(1)}%
          </motion.span>
        )}
      </div>
      <p className="mt-2 truncate text-xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </motion.div>
  );
}

function PerformancePickCard({
  title,
  meta,
  active,
  onClick,
}: {
  title: string;
  meta: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      layout
      whileHover={{ scale: 1.012, boxShadow: "0 8px 22px rgba(15, 23, 42, 0.08)" }}
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className={`min-w-[220px] max-w-[280px] rounded-xl border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-violet-400 bg-violet-500/10"
          : "border-border bg-background hover:border-violet-300/60 hover:bg-secondary/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          active ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground"
        }`}>
          {active ? "선택" : "보기"}
        </span>
      </div>
    </motion.button>
  );
}

function CompactEmpty({ label }: { label: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={spring}
      className="min-w-[260px] rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground"
    >
      {label}
    </motion.div>
  );
}

function MediaPerformanceCard({
  sourceType,
  active,
  cost,
  impressions,
  clicks,
  conversions,
  onClick,
}: {
  sourceType: string;
  active: boolean;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  onClick: () => void;
}) {
  const isEmpty = sourceType !== "ALL" && cost === 0 && impressions === 0 && clicks === 0 && conversions === 0;

  return (
    <motion.button
      type="button"
      onClick={isEmpty ? undefined : onClick}
      layout
      whileHover={isEmpty ? undefined : { scale: 1.012, boxShadow: "0 8px 22px rgba(15, 23, 42, 0.08)" }}
      whileTap={isEmpty ? undefined : { scale: 0.97 }}
      transition={spring}
      className={`min-w-[210px] rounded-xl border px-3 py-2.5 text-left transition-colors ${
        isEmpty
          ? "cursor-not-allowed opacity-40 border-border bg-background"
          : active
            ? "border-violet-400 bg-violet-500/10"
            : "border-border bg-background hover:border-violet-300/60 hover:bg-secondary/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{SOURCE_LABELS[sourceType] ?? sourceType}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {isEmpty ? "데이터 없음" : `지출 ${formatKRW(cost)}`}
          </p>
        </div>
        {!isEmpty && (
          <motion.span layout className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            active ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground"
          }`}>
            {active ? "선택" : "보기"}
          </motion.span>
        )}
      </div>
      {!isEmpty && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>전환 {formatNumber(conversions)}</span>
          <span>CTR {formatPct(calcCtr(clicks, impressions))}</span>
        </div>
      )}
    </motion.button>
  );
}

async function deleteBatchRequest(id: string, onDone: () => Promise<void>) {
  const res = await fetch(`/api/ad-performance/batches/${id}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast.error(data.error ?? "삭제하지 못했어요");
    throw new Error(data.error ?? "삭제하지 못했어요");
  }
  toast.success("소스 이력이 삭제됐어요");
  await onDone();
}

function ImportHistoryPanel({
  batches,
  onClose,
  onDelete,
  onAddSource,
}: {
  batches: PerformanceResponse["batches"];
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onAddSource: () => void;
}) {
  const [localBatches, setLocalBatches] = useState(batches);
  const [deleteBatchId, setDeleteBatchId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!deleteBatchId) return;
    // Optimistically remove from local list
    setLocalBatches((prev) => prev.filter((b) => b.id !== deleteBatchId));
    setDeleteBatchId(null);
    setDeleting(true);
    try {
      await onDelete(deleteBatchId);
    } catch {
      // Restore on failure
      setLocalBatches(batches);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: 32, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 32, opacity: 0 }}
        transition={spring}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-6">
          <div>
            <h2 className="text-lg font-semibold">소스 관리</h2>
            <p className="mt-1 text-sm text-muted-foreground">소스를 추가하거나 기존 소스를 관리합니다.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <motion.button
              onClick={onAddSource}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.95 }}
              transition={spring}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500 px-3 py-2 text-sm font-medium text-white hover:bg-violet-600 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              소스 추가
            </motion.button>
            <motion.button
              onClick={onClose}
              whileHover={{ rotate: 4, scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              transition={spring}
              className="rounded-xl p-2 text-muted-foreground hover:bg-secondary"
            >
              <X className="h-4 w-4" />
            </motion.button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {localBatches.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <Database className="mb-3 h-9 w-9 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">아직 추가된 소스 이력이 없어요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {localBatches.map((batch) => (
                <motion.div
                  key={batch.id}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  whileHover={{ x: -2, borderColor: "rgba(139, 92, 246, 0.28)" }}
                  transition={spring}
                  className="group rounded-2xl border border-border p-4"
                >
                  <div className="flex items-start gap-3">
                    <Database className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{batch.fileName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {SOURCE_LABELS[batch.sourceType] ?? batch.sourceType} · {batch._count.records.toLocaleString()}건
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {batch.reportStart && batch.reportEnd
                          ? `${kstDateOnly(batch.reportStart)} ~ ${kstDateOnly(batch.reportEnd)}`
                          : "파일 날짜 미인식"}
                      </p>
                    </div>
                    <motion.button
                      onClick={() => setDeleteBatchId(batch.id)}
                      whileHover={{ scale: 1.06 }}
                      whileTap={{ scale: 0.94 }}
                      transition={spring}
                      disabled={deleting}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
                      aria-label="소스 이력 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </motion.button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </motion.aside>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteBatchId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/50"
              onClick={() => setDeleteBatchId(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 8 }}
              transition={spring}
              className="fixed left-1/2 top-1/2 z-[70] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-2xl"
            >
              <div className="mb-1 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10">
                  <Trash2 className="h-4 w-4 text-red-500" />
                </div>
                <h3 className="text-base font-semibold">소스 이력 삭제</h3>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                이 소스 이력과 연결된 모든 성과 데이터가 삭제됩니다. 이 작업은 되돌릴 수 없어요.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <motion.button
                  onClick={() => setDeleteBatchId(null)}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary"
                >
                  취소
                </motion.button>
                <motion.button
                  onClick={confirmDelete}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
                >
                  삭제
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function hasDateOverlap(
  a: { start: string | null; end: string | null },
  b: { start: string | null; end: string | null },
) {
  if (!a.start || !a.end || !b.start || !b.end) return false;
  return a.start <= b.end && b.start <= a.end;
}

function UploadModal({
  workspaceId,
  projectId,
  folderId,
  existingBatches,
  onClose,
  onImported,
}: {
  workspaceId: string;
  projectId: string;
  folderId: string;
  existingBatches: PerformanceResponse["batches"];
  onClose: () => void;
  onImported: () => void;
}) {
  const [addMode, setAddMode] = useState<SourceAddMode>("file");
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>("AUTO");
  const [file, setFile] = useState<File | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [analysis, setAnalysis] = useState<SheetAnalysis | null>(null);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const previewTotals = useMemo(() => summarizeRows(preview?.rows ?? []), [preview]);

  const overlappingBatches = useMemo(() => {
    if (!preview?.reportStart || !preview?.reportEnd) return [];
    return existingBatches.filter(
      (batch) =>
        batch.sourceType === preview.sourceType &&
        hasDateOverlap(
          { start: preview.reportStart ?? null, end: preview.reportEnd ?? null },
          { start: batch.reportStart ? kstDateOnly(batch.reportStart) : null, end: batch.reportEnd ? kstDateOnly(batch.reportEnd) : null },
        ),
    );
  }, [preview, existingBatches]);
  const coreFields = useMemo(
    () => AD_COLUMN_FIELDS.filter((field) => ["campaignName", "adGroupName", "reportDate", "cost", "impressions", "clicks", "conversions"].includes(field.key)),
    []
  );
  const extraFields = useMemo(
    () => AD_COLUMN_FIELDS.filter((field) => !["campaignName", "adGroupName", "reportDate", "cost", "impressions", "clicks", "conversions"].includes(field.key)),
    []
  );

  const previewFromAnalysis = (nextAnalysis: SheetAnalysis, showEmptyToast = false) => {
    setAnalysis(nextAnalysis);
    try {
      const parsed = parseMappedRows(nextAnalysis);
      if (!parsed.rows.length) throw new Error("가져올 성과 row가 없어요");
      setPreview(parsed);
      return parsed;
    } catch (error) {
      setPreview(null);
      if (showEmptyToast) toast.error(error instanceof Error ? error.message : "컬럼 매핑을 확인해주세요");
      return null;
    }
  };

  const clearLoadedSource = () => {
    setFile(null);
    setSourceFileName(null);
    setAnalysis(null);
    setPreview(null);
  };

  const changeAddMode = (nextMode: SourceAddMode) => {
    if (addMode === nextMode) return;
    setAddMode(nextMode);
    clearLoadedSource();
  };

  const handleFile = async (nextFile: File | null) => {
    setFile(nextFile);
    setSourceFileName(nextFile?.name ?? null);
    setAnalysis(null);
    setPreview(null);
    if (!nextFile) return;

    setParsing(true);
    try {
      const rows = await readSheetRows(nextFile);
      const nextAnalysis = analyzeSheetRows(rows, sourceChoice);
      const parsed = previewFromAnalysis(nextAnalysis, true);
      if (parsed && sourceChoice === "AUTO") setSourceChoice(parsed.sourceType);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "파일을 읽지 못했어요");
      setPreview(null);
    } finally {
      setParsing(false);
    }
  };

  const loadGoogleSheet = async () => {
    const trimmedUrl = sheetUrl.trim();
    if (!trimmedUrl) {
      toast.error("Google Sheets URL을 입력해주세요");
      return;
    }

    clearLoadedSource();
    setSheetLoading(true);
    try {
      const res = await fetch("/api/ad-performance/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl, workspaceId, projectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Google Sheets를 불러오지 못했어요");

      const rows = await readCsvRows(String(data.csv ?? ""));
      const nextAnalysis = analyzeSheetRows(rows, sourceChoice);
      const parsed = previewFromAnalysis(nextAnalysis, true);
      setSourceFileName(String(data.fileName ?? "google-sheets.csv"));
      if (parsed && sourceChoice === "AUTO") setSourceChoice(parsed.sourceType);
      toast.success("Google Sheets를 분석했어요");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google Sheets를 불러오지 못했어요");
      setPreview(null);
    } finally {
      setSheetLoading(false);
    }
  };

  const reparse = async () => {
    if (analysis) {
      previewFromAnalysis(analysis, true);
      return;
    }
    if (!file) return;
    await handleFile(file);
  };

  const changeSourceChoice = (nextChoice: SourceChoice) => {
    setSourceChoice(nextChoice);
    setPreview(null);
    if (!analysis) return;
    const nextAnalysis = analyzeSheetRows(analysis.rows, nextChoice);
    previewFromAnalysis(nextAnalysis);
  };

  const updateMapping = (field: AdColumnKey, value: string) => {
    if (!analysis) return;
    const mapping = { ...analysis.mapping };
    if (value === "") delete mapping[field];
    else mapping[field] = Number(value);
    previewFromAnalysis({ ...analysis, mapping });
  };

  const importRows = async () => {
    if (!sourceFileName || !preview) return;
    setImporting(true);
    try {
      const res = await fetch("/api/ad-performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          projectId,
          folderId,
          sourceType: preview.sourceType,
          sourceName: SOURCE_LABELS[preview.sourceType],
          fileName: sourceFileName,
          reportStart: preview.reportStart,
          reportEnd: preview.reportEnd,
          rows: preview.rows,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "소스 추가에 실패했어요");
      toast.success(`${preview.rows.length.toLocaleString()}건의 광고 성과를 추가했어요`);
      onImported();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "소스 추가에 실패했어요");
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: 36, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 36, opacity: 0 }}
        transition={spring}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-6">
          <div>
            <h2 className="text-lg font-semibold">소스 추가</h2>
            <p className="mt-1 text-sm text-muted-foreground">CSV/엑셀 파일 또는 Google Sheets를 광고 성과 소스로 추가합니다.</p>
          </div>
          <motion.button
            onClick={onClose}
            whileHover={{ rotate: 4, scale: 1.04 }}
            whileTap={{ scale: 0.94 }}
            transition={spring}
            className="rounded-xl p-2 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </motion.button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="grid grid-cols-2 rounded-2xl border border-border bg-secondary/30 p-1">
            {[
              { value: "file" as const, label: "CSV/엑셀", desc: "파일 가져오기" },
              { value: "googleSheet" as const, label: "Google Sheets", desc: "시트 URL 연결" },
            ].map((mode) => {
              const active = addMode === mode.value;
              return (
                <motion.button
                  key={mode.value}
                  type="button"
                  onClick={() => changeAddMode(mode.value)}
                  whileHover={{ scale: active ? 1 : 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  transition={spring}
                  className={`relative rounded-xl px-3 py-2.5 text-left transition-colors ${
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {active && (
                    <motion.div
                      layoutId="ad-source-mode-bg"
                      className="absolute inset-0 rounded-xl bg-background shadow-sm"
                      transition={spring}
                      style={{ zIndex: 0 }}
                    />
                  )}
                  <span className="relative z-10 block text-sm font-semibold">{mode.label}</span>
                  <span className="relative z-10 mt-0.5 block text-[11px]">{mode.desc}</span>
                </motion.button>
              );
            })}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {addMode === "file" ? (
              <motion.label
                key="file-source"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                whileHover={!isDragging ? { y: -2, borderColor: "rgba(139, 92, 246, 0.6)" } : undefined}
                whileTap={{ scale: 0.995 }}
                transition={{ duration: 0.18 }}
                className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center transition-colors ${
                  isDragging
                    ? "border-violet-400 bg-violet-500/10"
                    : "border-border hover:bg-violet-500/5"
                }`}
                onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); void handleFile(e.dataTransfer.files?.[0] ?? null); }}
              >
                <motion.div animate={parsing ? { rotate: 360 } : { rotate: 0 }} transition={parsing ? { duration: 1, repeat: Infinity, ease: "linear" } : spring}>
                  <FileSpreadsheet className={`mb-3 h-8 w-8 ${isDragging ? "text-violet-400" : "text-violet-500"}`} />
                </motion.div>
                <span className="text-sm font-medium">{file ? file.name : "파일을 끌어다 놓거나 클릭해서 선택"}</span>
                <span className="mt-1 text-xs text-muted-foreground">.csv, .xlsx, .xls 파일을 지원합니다.</span>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
                />
              </motion.label>
            ) : (
              <motion.div
                key="sheet-source"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.18 }}
                className="rounded-2xl border border-border bg-secondary/20 p-4"
              >
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Google Sheets URL</span>
                  <input
                    value={sheetUrl}
                    onChange={(event) => setSheetUrl(event.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void loadGoogleSheet(); }}
                    placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0"
                    className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-violet-400"
                  />
                </label>
                <div className="mt-3 flex items-start justify-between gap-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    링크가 있는 사용자가 볼 수 있는 시트만 불러올 수 있어요. 첫 번째 탭 또는 URL의 gid 탭을 읽습니다.
                  </p>
                  <motion.button
                    type="button"
                    onClick={() => void loadGoogleSheet()}
                    disabled={sheetLoading}
                    whileHover={!sheetLoading ? { y: -1 } : undefined}
                    whileTap={!sheetLoading ? { scale: 0.97 } : undefined}
                    transition={spring}
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-violet-500 px-3 text-sm font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
                  >
                    {sheetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    시트 불러오기
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid gap-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">매체</span>
              <select
                value={sourceChoice}
                onChange={(event) => {
                  changeSourceChoice(event.target.value as SourceChoice);
                }}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-violet-400"
              >
                <option value="AUTO">자동 인식</option>
                <option value="GOOGLE">Google Ads</option>
                <option value="META">Meta Ads</option>
                <option value="LINKEDIN">LinkedIn Ads</option>
                <option value="MANUAL">직접 입력</option>
              </select>
            </label>
          </div>

          {analysis && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              className="rounded-2xl border border-border bg-secondary/20 p-4"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">컬럼 매핑</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    보고서 컬럼명이 달라도 표준 항목에 맞춰 선택하면 그대로 가져올 수 있어요.
                  </p>
                </div>
                <motion.button
                  onClick={reparse}
                  disabled={parsing || sheetLoading}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
                >
                  {parsing || sheetLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  다시 분석
                </motion.button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {coreFields.map((field) => (
                  <ColumnMappingSelect
                    key={field.key}
                    field={field}
                    headers={analysis.headers}
                    value={analysis.mapping[field.key]}
                    onChange={(value) => updateMapping(field.key, value)}
                  />
                ))}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                  추가 지표 매핑
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {extraFields.map((field) => (
                    <ColumnMappingSelect
                      key={field.key}
                      field={field}
                      headers={analysis.headers}
                      value={analysis.mapping[field.key]}
                      onChange={(value) => updateMapping(field.key, value)}
                    />
                  ))}
                </div>
              </details>
            </motion.div>
          )}

          <AnimatePresence>
            {preview && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={spring}
                className="space-y-3"
              >
              <motion.div whileHover={{ borderColor: "rgba(139, 92, 246, 0.42)" }} transition={spring} className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{SOURCE_LABELS[preview.sourceType]}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {preview.rows.length.toLocaleString()}건 · {preview.reportStart && preview.reportEnd
                        ? `${preview.reportStart} ~ ${preview.reportEnd}`
                        : "파일 날짜 미인식"}
                    </p>
                  </div>
                  <motion.button
                    onClick={reparse}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    transition={spring}
                    className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs hover:bg-secondary"
                  >
                    다시 분석
                  </motion.button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <PreviewMetric label="지출" value={formatKRW(previewTotals.cost)} />
                  <PreviewMetric label="노출" value={formatNumber(previewTotals.impressions)} />
                  <PreviewMetric label="클릭" value={formatNumber(previewTotals.clicks)} />
                  <PreviewMetric label="결과" value={formatNumber(previewTotals.conversions)} />
                </div>
              </motion.div>

              {preview.warnings.map((warning) => (
                <motion.p
                  key={warning}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-700"
                >
                  {warning}
                </motion.p>
              ))}

              {overlappingBatches.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-red-300/30 bg-red-500/5 px-3 py-2.5 text-xs text-red-600"
                >
                  <p className="font-medium">같은 매체·기간 데이터가 이미 있어요</p>
                  <ul className="mt-1 space-y-0.5 text-red-500/80">
                    {overlappingBatches.map((b) => (
                      <li key={b.id}>
                        · {b.fileName}
                        {b.reportStart && b.reportEnd
                          ? ` (${kstDateOnly(b.reportStart)} ~ ${kstDateOnly(b.reportEnd)})`
                          : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-red-500/70">추가하면 해당 기간 데이터가 중복됩니다. 기존 소스를 먼저 삭제하는 걸 권장해요.</p>
                </motion.div>
              )}

              <div className="max-h-72 overflow-auto rounded-2xl border border-border">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="bg-secondary/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">캠페인</th>
                      <th className="px-3 py-2 text-left font-medium">광고그룹/세트</th>
                      <th className="px-3 py-2 text-right font-medium">지출</th>
                      <th className="px-3 py-2 text-right font-medium">클릭</th>
                      <th className="px-3 py-2 text-right font-medium">결과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 8).map((row, index) => (
                      <motion.tr
                        key={`${row.campaignName}:${index}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        whileHover={{ backgroundColor: "rgba(139, 92, 246, 0.045)" }}
                        className="border-t border-border"
                      >
                        <td className="max-w-52 truncate px-3 py-2 font-medium">{row.campaignName}</td>
                        <td className="max-w-48 truncate px-3 py-2 text-muted-foreground">{row.adGroupName || "-"}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatKRW(row.cost)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatNumber(row.clicks)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatNumber(row.conversions)}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="border-t border-border p-4">
          <motion.button
            onClick={importRows}
            disabled={!preview || importing}
            whileHover={preview && !importing ? { y: -1 } : undefined}
            whileTap={preview && !importing ? { scale: 0.98 } : undefined}
            transition={spring}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 text-sm font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-40"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            소스 추가
          </motion.button>
        </div>
      </motion.div>
    </>
  );
}

function ColumnMappingSelect({
  field,
  headers,
  value,
  onChange,
}: {
  field: { key: AdColumnKey; label: string; required?: boolean; hint?: string };
  headers: string[];
  value: number | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="flex items-center justify-between gap-2 text-xs font-medium">
        <span>
          {field.label}
          {field.required && <span className="ml-1 text-violet-500">*</span>}
        </span>
        {field.hint && <span className="truncate text-[11px] font-normal text-muted-foreground">{field.hint}</span>}
      </span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-violet-400"
      >
        <option value="">사용 안 함</option>
        {headers.map((header, index) => (
          <option key={`${header}:${index}`} value={index}>
            {header || `column_${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1, borderColor: "rgba(139, 92, 246, 0.32)" }}
      transition={spring}
      className="rounded-xl border border-border bg-background p-3"
    >
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono font-semibold">{value}</p>
    </motion.div>
  );
}
