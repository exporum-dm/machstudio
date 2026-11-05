import { projectAdCampaignScope } from "@/lib/ad-campaign-scope";
import { Prisma } from "@/generated/prisma";
import { generateDashboardReport, type ReportFilters } from "@/app/api/dashboard-report/route";
import { prisma } from "@/lib/prisma";
import type { RealtimeReportData } from "@/app/(app)/dashboard/RealtimeReport";

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;

export type ApiDateRange = { from: Date; to: Date };

export function parseApiDateRange(values: { from?: string | null; to?: string | null }): ApiDateRange {
  const now = new Date();
  const to = values.to ? new Date(values.to) : now;
  const from = values.from ? new Date(values.from) : new Date(to.getTime() - 30 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("invalid_date_range");
  if (from > to) throw new Error("invalid_date_range");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) throw new Error("date_range_too_large");
  return { from, to };
}

export async function listApiProjects(workspaceId: string) {
  const projects = await prisma.project.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { collectSources: true, collectRecords: true, adPerformanceRecords: true } },
    },
  });
  return projects.map(({ _count, ...project }) => ({
    ...project,
    counts: {
      registrationSources: _count.collectSources,
      registrations: _count.collectRecords,
      adPerformanceRows: _count.adPerformanceRecords,
    },
  }));
}

export async function requireApiProject(workspaceId: string, projectId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, workspaceId, deletedAt: null },
    select: { id: true, name: true, workspaceId: true },
  });
}

export async function getApiDashboard(options: {
  workspaceId: string;
  projectId: string;
  range: ApiDateRange;
  filters?: ReportFilters;
}) {
  const result = await generateDashboardReport({
    workspaceId: options.workspaceId,
    projectId: options.projectId,
    from: options.range.from.toISOString(),
    to: options.range.to.toISOString(),
    filters: options.filters,
  });
  if ("error" in result) return null;
  return sanitizeExternalReport({ ...result.data, project: { id: options.projectId, name: result.data.project.name } });
}

const SENSITIVE_FIELD = /(name|성명|이름|email|메일|phone|mobile|전화|연락처|address|주소|birthday|birth|생년|주민|passport|여권)/i;

/** 외부 API에서는 자유 입력 PII와 1회성 희소 응답을 집계 결과에서도 노출하지 않는다. */
export function sanitizeExternalReport(report: RealtimeReportData): RealtimeReportData {
  const distributions = (rows: RealtimeReportData["fieldStats"]) => rows
    .filter((row) => !SENSITIVE_FIELD.test(`${row.key} ${row.label}`))
    .map((row) => ({ ...row, items: row.items.filter((item) => item.count >= 2) }))
    .filter((row) => row.items.length > 0);
  return {
    ...report,
    fieldStats: distributions(report.fieldStats),
    composition: distributions(report.composition),
    emailDomainTop: report.emailDomainTop.filter((item) => item.count >= 2),
  };
}

function derived(row: { cost: number; impressions: number; clicks: number; conversions: number; purchaseValue: number }) {
  return {
    ...row,
    ctr: row.impressions ? row.clicks / row.impressions * 100 : 0,
    cpc: row.clicks ? row.cost / row.clicks : 0,
    cpm: row.impressions ? row.cost / row.impressions * 1000 : 0,
    cvr: row.clicks ? row.conversions / row.clicks * 100 : 0,
    cpa: row.conversions ? row.cost / row.conversions : 0,
    roas: row.cost ? row.purchaseValue / row.cost : 0,
  };
}

export async function getApiAdPerformance(options: {
  workspaceId: string;
  projectId: string;
  range: ApiDateRange;
  sourceType?: string | null;
}) {
  const where: Prisma.AdPerformanceRecordWhereInput = {
    AND: [projectAdCampaignScope(await prisma.adPerformanceFolder.findMany({ where: { projectId: options.projectId, workspaceId: options.workspaceId }, select: { id: true, mediaAccounts: true } }))],
    workspaceId: options.workspaceId,
    projectId: options.projectId,
    ...(options.sourceType && options.sourceType !== "ALL" ? { sourceType: options.sourceType.toUpperCase() } : {}),
    OR: [
      { reportDate: { gte: options.range.from, lte: options.range.to } },
      { reportDate: null, reportStart: { lte: options.range.to }, reportEnd: { gte: options.range.from } },
      { reportDate: null, reportStart: null, reportEnd: null, createdAt: { gte: options.range.from, lte: options.range.to } },
    ],
  };
  const [totals, media, campaigns, daily] = await Promise.all([
    prisma.adPerformanceRecord.aggregate({
      where,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true, reach: true, purchaseValue: true },
    }),
    prisma.adPerformanceRecord.groupBy({
      by: ["sourceType"], where,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true, reach: true, purchaseValue: true },
    }),
    prisma.adPerformanceRecord.groupBy({
      by: ["sourceType", "campaignName"], where,
      _sum: { cost: true, impressions: true, clicks: true, conversions: true, reach: true, purchaseValue: true },
      orderBy: { _sum: { cost: "desc" } }, take: 50,
    }),
    prisma.adPerformanceRecord.groupBy({
      by: ["reportDate"], where: { ...where, reportDate: { gte: options.range.from, lte: options.range.to } },
      _sum: { cost: true, impressions: true, clicks: true, conversions: true, purchaseValue: true },
      orderBy: { reportDate: "asc" }, take: 367,
    }),
  ]);
  const normalize = (sum: { cost?: number | null; impressions?: number | null; clicks?: number | null; conversions?: number | null; purchaseValue?: number | null }) => derived({
    cost: sum.cost ?? 0,
    impressions: sum.impressions ?? 0,
    clicks: sum.clicks ?? 0,
    conversions: sum.conversions ?? 0,
    purchaseValue: sum.purchaseValue ?? 0,
  });
  return {
    range: { from: options.range.from.toISOString(), to: options.range.to.toISOString() },
    totals: { ...normalize(totals._sum), reach: totals._sum.reach ?? 0 },
    media: media.map((row) => ({ sourceType: row.sourceType, ...normalize(row._sum) })),
    campaigns: campaigns.map((row) => ({ sourceType: row.sourceType, campaignName: row.campaignName, reach: row._sum.reach ?? 0, ...normalize(row._sum) })),
    daily: daily.map((row) => ({ date: row.reportDate?.toISOString().slice(0, 10) ?? null, ...normalize(row._sum) })),
  };
}
