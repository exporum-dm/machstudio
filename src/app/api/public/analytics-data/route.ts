import { projectAdCampaignScope } from "@/lib/ad-campaign-scope";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/ratelimit";
import { dashboardCache } from "@/lib/cache";
import { createHash } from "node:crypto";
import { verifySharePassword } from "@/lib/share-password";
import type { Prisma } from "@/generated/prisma";

function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function tokenInvalid(token: string) {
  return !token || token.length < 32 || !/^[A-Za-z0-9_-]+$/.test(token);
}

function dateKey(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

function withDerivedMetrics<T extends {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
}>(row: T) {
  return {
    ...row,
    ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
    cvr: row.clicks > 0 ? (row.conversions / row.clicks) * 100 : 0,
    cpc: row.clicks > 0 ? row.cost / row.clicks : 0,
    cpm: row.impressions > 0 ? (row.cost / row.impressions) * 1000 : 0,
    costPerConversion: row.conversions > 0 ? row.cost / row.conversions : 0,
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { token, password } = body as { token?: string; password?: string };

  if (typeof token !== "string" || tokenInvalid(token)) {
    return NextResponse.json({ error: "토큰 형식 오류" }, { status: 401 });
  }

  const rl = rateLimit(`analytics-data:${clientIp(request)}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "요청이 너무 잦아요" }, { status: 429 });
  }

  const project = await prisma.project.findUnique({
    where: { analyticsShareToken: token },
    select: {
      id: true,
      workspaceId: true,
      analyticsShareEnabled: true,
      analyticsSharePasswordHash: true,
      deletedAt: true,
    },
  });
  if (!project || !project.analyticsShareEnabled || project.deletedAt) {
    return NextResponse.json({ error: "공유가 비활성화됐어요" }, { status: 403 });
  }

  if (project.analyticsSharePasswordHash) {
    const cookieStore = await cookies();
    const verifiedCookie = cookieStore.get(`share_password_${token}`)?.value;
    const passwordOk = verifiedCookie === "verified" ||
      (typeof password === "string" && verifySharePassword(password, project.analyticsSharePasswordHash));
    if (!passwordOk) {
      return NextResponse.json({ error: "비밀번호 필요", requiresPassword: true }, { status: 401 });
    }
  }

  // 고정: 최근 30일
  const now = new Date();
  const fromD = new Date(now.getTime() - 30 * 86400_000);
  const toD = now;

  const campaignScope = projectAdCampaignScope(await prisma.adPerformanceFolder.findMany({ where: { projectId: project.id, workspaceId: project.workspaceId }, select: { id: true, mediaAccounts: true } }));
  const cacheKey = "pub-analytics:" + createHash("sha1")
    .update(JSON.stringify({ token, from: fromD.toISOString(), to: toD.toISOString(), campaignScope }))
    .digest("hex");
  const cached = dashboardCache.get(cacheKey);
  if (cached) return NextResponse.json(cached);

  const rangeWhere = {
    OR: [
      { reportDate: { gte: fromD, lte: toD } },
      { reportDate: null, reportEnd: { gte: fromD }, reportStart: { lte: toD } },
      { reportDate: null, reportStart: null, reportEnd: null, createdAt: { gte: fromD, lte: toD } },
    ],
  } satisfies Prisma.AdPerformanceRecordWhereInput;

  const where: Prisma.AdPerformanceRecordWhereInput = {
    projectId: project.id,
    workspaceId: project.workspaceId,
    ...rangeWhere,
    AND: [campaignScope],
  };

  const [totalsAgg, mediaGroups, campaignGroups, trendGroups] = await Promise.all([
    prisma.adPerformanceRecord.aggregate({
      where,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true, reach: true },
    }),
    prisma.adPerformanceRecord.groupBy({
      by: ["sourceType"],
      where,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true },
    }),
    prisma.adPerformanceRecord.groupBy({
      by: ["sourceType", "campaignName"],
      where,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true },
      orderBy: { _sum: { cost: "desc" } },
      take: 10,
    }),
    prisma.adPerformanceRecord.groupBy({
      by: ["sourceType", "reportDate", "reportStart"],
      where,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true },
      orderBy: [{ reportDate: "desc" }],
      take: 5000,
    }),
  ]);

  const totals = {
    ...withDerivedMetrics({
      cost: totalsAgg._sum.cost ?? 0,
      impressions: totalsAgg._sum.impressions ?? 0,
      clicks: totalsAgg._sum.clicks ?? 0,
      conversions: totalsAgg._sum.conversions ?? 0,
    }),
    reach: totalsAgg._sum.reach ?? 0,
  };

  const mediaSummary = mediaGroups
    .map((row) => withDerivedMetrics({ sourceType: row.sourceType, ...sumToBase(row._sum) }))
    .sort((a, b) => b.cost - a.cost);

  const campaignSummary = campaignGroups
    .map((row) => withDerivedMetrics({ sourceType: row.sourceType, campaignName: row.campaignName, ...sumToBase(row._sum) }))
    .sort((a, b) => b.cost - a.cost);

  const dailyMap = new Map<string, { date: string; cost: number; impressions: number; clicks: number; conversions: number }>();
  const dailyBySourceMap = new Map<string, Map<string, { cost: number; impressions: number; clicks: number; conversions: number }>>();

  for (const row of trendGroups) {
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
  }

  const payload = {
    totals,
    mediaSummary,
    campaignSummary,
    dailyTrend: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    dailyTrendBySource: Array.from(dailyMap.keys()).sort().map((date) => ({
      date,
      sources: Object.fromEntries(dailyBySourceMap.get(date) ?? []),
    })),
    batches: [] as never[],
    detailRows: [] as never[],
    detailPagination: {
      page: 1,
      pageSize: 0,
      total: 0,
      totalPages: 1,
      groupBy: "campaign" as const,
      dateGranularity: "day" as const,
      period: null as string | null,
    },
    rangeDays: 30,
  };

  dashboardCache.set(cacheKey, payload);
  return NextResponse.json(payload);
}
