import { adCampaignScope, projectAdCampaignScope } from "@/lib/ad-campaign-scope";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { classifyResultBucket } from "@/lib/ad-parse";
import { fillAdDailySeries } from "@/lib/ad-daily-series";

const MAX_IMPORT_ROWS = 20_000;
const CREATE_CHUNK_SIZE = 1_000;

type SourceType = "GOOGLE" | "META" | "TIKTOK" | "LINKEDIN" | "MANUAL";
type DetailGroupBy = "campaign" | "adGroup";
type DetailDateGranularity = "day" | "week" | "month";

const DEFAULT_DETAIL_PAGE_SIZE = 20;
const MAX_DETAIL_PAGE_SIZE = 100;

interface ImportRowInput {
  sourceType?: SourceType;
  campaignName?: string;
  campaignId?: string | null;
  adGroupName?: string | null;
  adGroupId?: string | null;
  adName?: string | null;
  adId?: string | null;
  creativeName?: string | null;
  creativeId?: string | null;
  thumbnailUrl?: string | null;
  reportDate?: string | null;
  reportStart?: string | null;
  reportEnd?: string | null;
  status?: string | null;
  currency?: string | null;
  cost?: number | null;
  impressions?: number | null;
  reach?: number | null;
  clicks?: number | null;
  cpm?: number | null;
  cpc?: number | null;
  ctr?: number | null;
  conversions?: number | null;
  costPerConversion?: number | null;
  conversionRate?: number | null;
  resultType?: string | null;
  raw?: Prisma.InputJsonValue;
}

function toDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00+09:00`)
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toFiniteNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function toInt(value: unknown) {
  const n = toFiniteNumber(value);
  return n == null ? null : Math.round(n);
}

function toBoundedInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(1, Math.floor(parsed)), max);
}

function parseDetailGroupBy(value: string | null): DetailGroupBy {
  return value === "adGroup" ? "adGroup" : "campaign";
}

function parseDetailDateGranularity(value: string | null): DetailDateGranularity {
  if (value === "week" || value === "month") return value;
  return "day";
}

function dateKey(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

function monthKey(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

function weekKey(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60_000);
  const day = kst.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  kst.setUTCDate(kst.getUTCDate() - diffToMonday);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

function detailPeriodKey(date: Date, granularity: DetailDateGranularity) {
  if (granularity === "month") return monthKey(date);
  if (granularity === "week") return weekKey(date);
  return dateKey(date);
}

function withDerivedMetrics<T extends {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  purchaseValue?: number;
}>(row: T) {
  return {
    ...row,
    ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
    cvr: row.clicks > 0 ? (row.conversions / row.clicks) * 100 : 0,
    cpc: row.clicks > 0 ? row.cost / row.clicks : 0,
    cpm: row.impressions > 0 ? (row.cost / row.impressions) * 1000 : 0,
    costPerConversion: row.conversions > 0 ? row.cost / row.conversions : 0,
    roas: row.cost > 0 ? (row.purchaseValue ?? 0) / row.cost : 0,
  };
}

function sumToBase(sum: {
  cost: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
}) {
  return {
    cost: sum.cost ?? 0,
    impressions: sum.impressions ?? 0,
    clicks: sum.clicks ?? 0,
    conversions: sum.conversions ?? 0,
  };
}

async function getMembership(workspaceId: string, userId: string) {
  return prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const projectId = searchParams.get("projectId");
  const folderId = searchParams.get("folderId");
  const sourceType = searchParams.get("sourceType");
  const campaignName = searchParams.get("campaignName")?.trim() || null;
  const adGroupName = searchParams.get("adGroupName")?.trim() || null;
  const from = toDate(searchParams.get("from"));
  const to = toDate(searchParams.get("to"));
  const detailGroupBy = parseDetailGroupBy(searchParams.get("detailGroupBy"));
  const detailDateGranularity = parseDetailDateGranularity(searchParams.get("detailDateGranularity"));
  const requestedDetailPeriod = searchParams.get("detailPeriod")?.trim() || null;
  const requestedDetailPage = toBoundedInt(searchParams.get("detailPage"), 1, Number.MAX_SAFE_INTEGER);
  const detailPageSize = toBoundedInt(searchParams.get("detailPageSize"), DEFAULT_DETAIL_PAGE_SIZE, MAX_DETAIL_PAGE_SIZE);

  if (!workspaceId || !projectId) {
    return NextResponse.json({ error: "workspaceId/projectId 필요" }, { status: 400 });
  }

  const membership = await getMembership(workspaceId, user.id);
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId, deletedAt: null }, select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  let campaignScope: Prisma.AdPerformanceRecordWhereInput = {};
  if (folderId) {
    const folder = await prisma.adPerformanceFolder.findFirst({
      where: { id: folderId, workspaceId, projectId }, select: { id: true, mediaAccounts: true },
    });
    if (!folder) return NextResponse.json({ error: "광고 성과 폴더를 찾을 수 없습니다." }, { status: 404 });
    campaignScope = adCampaignScope(folder.mediaAccounts);
  } else {
    campaignScope = projectAdCampaignScope(await prisma.adPerformanceFolder.findMany({ where: { projectId, workspaceId }, select: { id: true, mediaAccounts: true } }));
  }

  const rangeWhere = from || to
    ? {
        OR: [
          {
            reportDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          },
          {
            reportDate: null,
            ...(from ? { reportEnd: { gte: from } } : {}),
            ...(to ? { reportStart: { lte: to } } : {}),
          },
          {
            reportDate: null,
            reportStart: null,
            reportEnd: null,
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          },
        ],
      }
    : {};

  const sourceWhere = sourceType && sourceType !== "ALL" ? { sourceType } : {};

  const where: Prisma.AdPerformanceRecordWhereInput = {
    workspaceId,
    projectId,
    ...(folderId ? { folderId } : {}),
    ...sourceWhere,
    ...(campaignName ? { campaignName } : {}),
    ...(adGroupName ? { adGroupName } : {}),
    ...rangeWhere,
    AND: [campaignScope],
  };

  // mediaSummary: date range only (no source/campaign/adGroup filter — shows all media)
  const mediaSummaryWhere: Prisma.AdPerformanceRecordWhereInput = {
    workspaceId,
    projectId,
    ...(folderId ? { folderId } : {}),
    ...rangeWhere,
    AND: [campaignScope],
  };

  // campaignSummary: source filter + date range (no campaign/adGroup filter — shows all campaigns in source)
  const campaignSummaryWhere: Prisma.AdPerformanceRecordWhereInput = {
    workspaceId,
    projectId,
    ...(folderId ? { folderId } : {}),
    ...sourceWhere,
    ...rangeWhere,
    AND: [campaignScope],
  };

  // adGroupSummary: source + campaign filter + date range
  const adGroupSummaryWhere: Prisma.AdPerformanceRecordWhereInput = {
    workspaceId,
    projectId,
    ...(folderId ? { folderId } : {}),
    ...sourceWhere,
    ...(campaignName ? { campaignName } : {}),
    ...rangeWhere,
    AND: [campaignScope],
  };

  const [totalsAgg, mediaSummaryGroups, campaignGroups, adGroupGroups, trendGroups, batches] = await Promise.all([
    // Aggregate totals (single row, no data transfer)
    prisma.adPerformanceRecord.aggregate({
      where,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true, reach: true, purchaseValue: true },
    }),

    // Media summary: group by sourceType
    prisma.adPerformanceRecord.groupBy({
      by: ["sourceType"],
      where: mediaSummaryWhere,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true },
    }),

    // Campaign summary: group by sourceType + campaignName
    prisma.adPerformanceRecord.groupBy({
      by: ["sourceType", "campaignName"],
      where: campaignSummaryWhere,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true },
      orderBy: { _sum: { cost: "desc" } },
      take: 100,
    }),

    // AdGroup summary: group by sourceType + campaignName + adGroupName
    prisma.adPerformanceRecord.groupBy({
      by: ["sourceType", "campaignName", "adGroupName"],
      where: adGroupSummaryWhere,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true },
      orderBy: { _sum: { cost: "desc" } },
      take: 100,
    }),

    // Pre-aggregated rows for daily trend + detail table
    // groupBy collapses raw records into (source, campaign, adGroup, date) buckets
    prisma.adPerformanceRecord.groupBy({
      by: ["sourceType", "campaignName", "adGroupName", "reportDate", "reportStart"],
      where,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true, reach: true },
      orderBy: [{ reportDate: "desc" }, { reportStart: "desc" }],
      take: 10_000,
    }),

    prisma.adPerformanceImportBatch.findMany({
      where: { workspaceId, projectId, ...(folderId ? { folderId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { _count: { select: { records: true } } },
    }),
  ]);

  // --- Build response objects ---

  const totals = {
    cost: totalsAgg._sum.cost ?? 0,
    impressions: totalsAgg._sum.impressions ?? 0,
    clicks: totalsAgg._sum.clicks ?? 0,
    conversions: totalsAgg._sum.conversions ?? 0,
    reach: totalsAgg._sum.reach ?? 0,
    purchaseValue: totalsAgg._sum.purchaseValue ?? 0,
  };

  const mediaSummary = mediaSummaryGroups
    .map((row) => withDerivedMetrics({ sourceType: row.sourceType, ...sumToBase(row._sum) }))
    .sort((a, b) => b.cost - a.cost);

  const campaignSummary = campaignGroups
    .map((row) => withDerivedMetrics({ sourceType: row.sourceType, campaignName: row.campaignName, ...sumToBase(row._sum) }))
    .sort((a, b) => b.cost - a.cost);

  const adGroupSummary = adGroupGroups
    .map((row) => withDerivedMetrics({ sourceType: row.sourceType, campaignName: row.campaignName, adGroupName: row.adGroupName, ...sumToBase(row._sum) }))
    .sort((a, b) => b.cost - a.cost);

  // Build daily trend and detail rows from pre-aggregated trendGroups
  const dailyMap = new Map<string, {
    date: string;
    cost: number;
    impressions: number;
    clicks: number;
    conversions: number;
  }>();

  const dailyBySourceMap = new Map<string, Map<string, {
    cost: number; impressions: number; clicks: number; conversions: number;
  }>>();

  const detailMap = new Map<string, {
    id: string;
    periodKey: string;
    sourceType: string;
    campaignName: string;
    adGroupName: string | null;
    reportDate: string | null;
    reportStart: string | null;
    cost: number;
    impressions: number;
    reach: number;
    clicks: number;
    conversions: number;
  }>();
  const detailPeriodSet = new Set<string>();

  for (const row of trendGroups) {
    // Fall back to reportStart when reportDate is absent (period reports without daily breakdown)
    const effectiveDate = row.reportDate ?? row.reportStart ?? new Date();
    const cost = row._sum.cost ?? 0;
    const impressions = row._sum.impressions ?? 0;
    const clicks = row._sum.clicks ?? 0;
    const conversions = row._sum.conversions ?? 0;

    const dKey = dateKey(effectiveDate);
    const day = dailyMap.get(dKey) ?? { date: dKey, cost: 0, impressions: 0, clicks: 0, conversions: 0 };
    day.cost += cost;
    day.impressions += impressions;
    day.clicks += clicks;
    day.conversions += conversions;
    dailyMap.set(dKey, day);

    if (!dailyBySourceMap.has(dKey)) dailyBySourceMap.set(dKey, new Map());
    const srcDay = dailyBySourceMap.get(dKey)!;
    const prevSrc = srcDay.get(row.sourceType) ?? { cost: 0, impressions: 0, clicks: 0, conversions: 0 };
    prevSrc.cost += cost;
    prevSrc.impressions += impressions;
    prevSrc.clicks += clicks;
    prevSrc.conversions += conversions;
    srcDay.set(row.sourceType, prevSrc);

    const periodKey = detailPeriodKey(effectiveDate, detailDateGranularity);
    detailPeriodSet.add(periodKey);
    const detailAdGroupName = detailGroupBy === "adGroup" ? row.adGroupName : null;
    const detailKey = `${periodKey}:${row.sourceType}:${row.campaignName}:${detailAdGroupName ?? ""}`;
    const detail = detailMap.get(detailKey) ?? {
      id: crypto.createHash("sha1").update(detailKey).digest("hex"),
      periodKey,
      sourceType: row.sourceType,
      campaignName: row.campaignName,
      adGroupName: detailAdGroupName,
      reportDate: detailDateGranularity === "day" ? periodKey : null,
      reportStart: periodKey,
      cost: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      conversions: 0,
    };
    detail.cost += cost;
    detail.impressions += impressions;
    detail.reach += row._sum.reach ?? 0;
    detail.clicks += clicks;
    detail.conversions += conversions;
    detailMap.set(detailKey, detail);
  }

  const sortedDetailPeriods = Array.from(detailPeriodSet).sort((a, b) => b.localeCompare(a));
  const selectedDetailPeriod = requestedDetailPeriod && detailPeriodSet.has(requestedDetailPeriod)
    ? requestedDetailPeriod
    : sortedDetailPeriods[0] ?? null;

  const detailPeriodCounts = new Map<string, number>();
  for (const detail of detailMap.values()) {
    detailPeriodCounts.set(detail.periodKey, (detailPeriodCounts.get(detail.periodKey) ?? 0) + 1);
  }

  const detailRowsAll = Array.from(detailMap.values())
    .filter((row) => !selectedDetailPeriod || row.periodKey === selectedDetailPeriod)
    .map(withDerivedMetrics)
    .sort((a, b) => {
      const dateOrder = b.periodKey.localeCompare(a.periodKey);
      if (dateOrder !== 0) return dateOrder;
      const costOrder = b.cost - a.cost;
      if (costOrder !== 0) return costOrder;
      return a.campaignName.localeCompare(b.campaignName, "ko-KR", { numeric: true });
    });
  const detailTotal = detailRowsAll.length;
  const detailTotalPages = Math.max(1, Math.ceil(detailTotal / detailPageSize));
  const detailPage = Math.min(requestedDetailPage, detailTotalPages);
  const detailStart = (detailPage - 1) * detailPageSize;
  const detailRows = detailRowsAll.slice(detailStart, detailStart + detailPageSize);

  const dailyTrend = fillAdDailySeries(Array.from(dailyMap.values()), from, to);

  return NextResponse.json({
    totals: withDerivedMetrics(totals),
    sourceSummary: mediaSummary,
    mediaSummary,
    campaignSummary,
    adGroupSummary,
    topCampaigns: campaignSummary.slice(0, 50),
    topAdGroups: adGroupSummary.slice(0, 50),
    dailyTrend,
    dailyTrendBySource: dailyTrend.map(({ date }) => ({
      date,
      sources: Object.fromEntries(dailyBySourceMap.get(date) ?? []),
    })),
    detailRows,
    detailPeriodOptions: sortedDetailPeriods.map((value) => ({
      value,
      rowCount: detailPeriodCounts.get(value) ?? 0,
    })),
    detailPagination: {
      page: detailPage,
      pageSize: detailPageSize,
      total: detailTotal,
      totalPages: detailTotalPages,
      groupBy: detailGroupBy,
      dateGranularity: detailDateGranularity,
      period: selectedDetailPeriod,
    },
    recentRows: detailRows,
    batches,
  });
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const body = await request.json();
    const {
      workspaceId,
      projectId,
      folderId,
      sourceType,
      sourceName,
      fileName,
      reportStart,
      reportEnd,
      rows,
    } = body as {
      workspaceId?: string;
      projectId?: string;
      folderId?: string;
      sourceType?: SourceType;
      sourceName?: string;
      fileName?: string;
      reportStart?: string | null;
      reportEnd?: string | null;
      rows?: ImportRowInput[];
    };

    if (!workspaceId || !projectId || !sourceType || !fileName || !Array.isArray(rows)) {
      return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
    }

    if (rows.length < 1) {
      return NextResponse.json({ error: "가져올 성과 row가 없어요" }, { status: 400 });
    }

    if (rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json({ error: `한 번에 최대 ${MAX_IMPORT_ROWS.toLocaleString()}건까지 가져올 수 있어요` }, { status: 400 });
    }

    const membership = await getMembership(workspaceId, user.id);
    if (!membership || membership.role === "MEMBER") {
      return NextResponse.json({ error: "권한 없음" }, { status: 403 });
    }

    if (folderId) {
      const folder = await prisma.adPerformanceFolder.findFirst({
        where: { id: folderId, workspaceId, projectId },
        select: { id: true },
      });
      if (!folder) return NextResponse.json({ error: "광고 성과 폴더를 찾을 수 없습니다." }, { status: 404 });
    }

    const batchStart = toDate(reportStart);
    const batchEnd = toDate(reportEnd);
    const sanitizedRows = rows
      .map((row) => ({
        ...row,
        campaignName: typeof row.campaignName === "string" ? row.campaignName.trim() : "",
      }))
      .filter((row) => row.campaignName);

    if (!sanitizedRows.length) {
      return NextResponse.json({ error: "캠페인명이 있는 row가 없어요" }, { status: 400 });
    }

    const batch = await prisma.$transaction(async (tx) => {
      const createdBatch = await tx.adPerformanceImportBatch.create({
        data: {
          workspaceId,
          projectId,
          uploadedById: user.id,
          folderId: folderId || null,
          sourceType,
          sourceName: sourceName?.trim() || null,
          fileName,
          rowCount: sanitizedRows.length,
          reportStart: batchStart,
          reportEnd: batchEnd,
        },
      });

      for (let i = 0; i < sanitizedRows.length; i += CREATE_CHUNK_SIZE) {
        const chunk = sanitizedRows.slice(i, i + CREATE_CHUNK_SIZE);
        await tx.adPerformanceRecord.createMany({
          data: chunk.map((row) => {
            const reachVal = toInt(row.reach);
            const conversionsVal = toFiniteNumber(row.conversions);
            // 서버에서 결과유형 분류 재계산(클라이언트 값 비신뢰).
            const bucket = classifyResultBucket(row.resultType ?? null, reachVal, conversionsVal);
            const isReach = bucket === "reach";
            return {
              id: crypto.randomUUID(),
              batchId: createdBatch.id,
              workspaceId,
              projectId,
              folderId: folderId || null,
              sourceType,
              campaignId: row.campaignId?.trim() || null,
              campaignName: row.campaignName,
              adGroupId: row.adGroupId?.trim() || null,
              adGroupName: row.adGroupName?.trim() || null,
              adId: row.adId?.trim() || null,
              adName: row.adName?.trim() || null,
              creativeId: row.creativeId?.trim() || null,
              creativeName: row.creativeName?.trim() || null,
              thumbnailUrl: row.thumbnailUrl?.trim() || null,
              reportDate: toDate(row.reportDate),
              reportStart: toDate(row.reportStart) ?? batchStart,
              reportEnd: toDate(row.reportEnd) ?? batchEnd,
              status: row.status?.trim() || null,
              currency: row.currency?.trim() || null,
              cost: toFiniteNumber(row.cost),
              impressions: toInt(row.impressions),
              reach: reachVal,
              clicks: toInt(row.clicks),
              cpm: toFiniteNumber(row.cpm),
              cpc: toFiniteNumber(row.cpc),
              ctr: toFiniteNumber(row.ctr),
              // 도달성 결과는 전환 건수가 아니므로 전환 지표에선 0/null (도달 인원은 reach 에 보존)
              conversions: isReach ? 0 : conversionsVal,
              costPerConversion: isReach ? null : toFiniteNumber(row.costPerConversion),
              conversionRate: isReach ? null : toFiniteNumber(row.conversionRate),
              resultType: row.resultType?.trim() || null,
              resultBucket: bucket,
              raw: row.raw ?? {},
            };
          }),
        });
      }

      return createdBatch;
    });

    await logActivity({
      workspaceId,
      userId: user.id,
      action: "ad.batch_uploaded",
      meta: {
        batchId: batch.id,
        sourceType,
        sourceName: sourceName?.trim() || null,
        fileName,
        recordCount: sanitizedRows.length,
        projectId,
      },
    });

    return NextResponse.json({ batch }, { status: 201 });
  } catch (error) {
    console.error("[ad-performance] import failed", error);
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: `가져오기 실패: ${message}` }, { status: 500 });
  }
}
