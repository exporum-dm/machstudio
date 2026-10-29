import "server-only";
/**
 * 주간 보고 초안 — 업무일지 줄 + 행사 + (선택) 지표. GET 보고서·AI 다듬기·엑셀이 같이 쓴다.
 */
import { prisma } from "@/lib/prisma";
import {
  buildWeeklyReport, effectiveStatus, normalizeReportRows, reportWindows, shiftDay,
  type ReportBlock, type WeeklyReport, type WorkEntryInput, type WorkGroupInput, type WorkStatus,
} from "@/lib/worklog";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const kstStart = (day: string) => new Date(`${day}T00:00:00+09:00`);

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 2 }).format(value);
  } catch {
    return Math.round(value).toLocaleString("ko-KR");
  }
}

/** 전주(월~일) 숫자 — 사전등록 증가·누적, 광고비·결과. 프로젝트별. */
async function weeklyMetrics(projectIds: string[], week: { start: string; end: string }): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (projectIds.length === 0) return out;
  const from = kstStart(week.start);
  const to = kstStart(shiftDay(week.end, 1));
  const [weekly, totals, ads] = await Promise.all([
    prisma.collectRecord.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, createdAt: { gte: from, lt: to }, source: { deletedAt: null } }, _count: { _all: true } }),
    prisma.collectRecord.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, createdAt: { lt: to }, source: { deletedAt: null } }, _count: { _all: true } }),
    prisma.adPerformanceRecord.groupBy({
      by: ["projectId", "currency"],
      where: { projectId: { in: projectIds }, reportDate: { gte: from, lt: to } },
      _sum: { cost: true, conversions: true },
    }),
  ]);
  for (const projectId of projectIds) {
    const lines: string[] = [];
    const added = weekly.find((w) => w.projectId === projectId)?._count._all ?? 0;
    const total = totals.find((t) => t.projectId === projectId)?._count._all ?? 0;
    if (added > 0) lines.push(`사전등록 +${added.toLocaleString("ko-KR")}명 (누적 ${total.toLocaleString("ko-KR")}명)`);
    for (const a of ads.filter((x) => x.projectId === projectId)) {
      const cost = a._sum.cost ?? 0;
      const conv = a._sum.conversions ?? 0;
      if (cost <= 0 && conv <= 0) continue;
      const cpa = conv > 0 ? ` · 결과당 ${money(cost / conv, a.currency ?? "KRW")}` : "";
      lines.push(`광고비 ${money(cost, a.currency ?? "KRW")} · 결과 ${Math.round(conv).toLocaleString("ko-KR")}${cpa}`);
    }
    if (lines.length) out.set(projectId, lines);
  }
  return out;
}

export async function loadGroups(workspaceId: string) {
  const groups = await prisma.workGroup.findMany({ where: { workspaceId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return groups;
}

export function toGroupInputs(groups: Awaited<ReturnType<typeof loadGroups>>): WorkGroupInput[] {
  return groups.map((g) => ({ id: g.id, name: g.name, sortOrder: g.sortOrder, archived: g.archived, aliases: g.aliases, startDate: day(g.startDate), endDate: day(g.endDate) }));
}

/** 보고 기간(전주 달성 · 금주 목표) 의 일지 줄. */
export async function loadReportEntries(workspaceId: string, reportDate: string) {
  const { last, next } = reportWindows(reportDate);
  const entries = await prisma.workEntry.findMany({
    where: { workspaceId, date: { gte: new Date(`${last.start}T00:00:00Z`), lte: new Date(`${next.end}T00:00:00Z`) } },
    include: { author: { select: { name: true, email: true } } },
    orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const names = new Map(entries.map((e) => [e.authorId, e.author.name || e.author.email.split("@")[0]]));
  const inputs: WorkEntryInput[] = entries.map((e) => ({
    id: e.id, groupId: e.groupId, authorId: e.authorId, date: day(e.date)!, common: e.common,
    // 시트처럼 취소선만 긋는다 — 안 그은 줄은 보고일 기준으로 진행/예정을 다시 정한다(미리 적어 둔 일이 날짜가 지나면 진행·이월).
    category: e.category, content: e.content, status: effectiveStatus(e.status as WorkStatus, day(e.date), reportDate), result: e.result, note: e.note,
  }));
  return { entries: inputs, authorName: (id: string) => names.get(id) ?? "" };
}

export async function buildDraftReport(
  workspaceId: string,
  reportDate: string,
  opts: { metrics: boolean; viewer: { userId: string; isAdmin: boolean } },
): Promise<WeeklyReport> {
  const [groups, { entries, authorName }, [prev]] = await Promise.all([
    loadGroups(workspaceId), loadReportEntries(workspaceId, reportDate), loadPreviousReports(workspaceId, reportDate, 1),
  ]);
  // 바로 앞 주(2주 안) 보고서만 잇는다 — 한참 전 보고서의 목표를 끌어오지 않게.
  const previous = prev && prev.reportDate >= shiftDay(reportDate, -13) ? prev.rows : undefined;
  const report = buildWeeklyReport({ reportDate, groups: toGroupInputs(groups), entries, authorName, previous });
  if (opts.metrics) {
    const linkedProjectIds = [...new Set(groups.map((g) => g.projectId).filter((id): id is string => !!id))];
    let projectIds = linkedProjectIds;
    if (!opts.viewer.isAdmin && linkedProjectIds.length) {
      // 일반 멤버에게는 직접 참여한 프로젝트 숫자만 보여 준다.
      const memberships = await prisma.projectMember.findMany({
        where: { userId: opts.viewer.userId, projectId: { in: linkedProjectIds } },
        select: { projectId: true },
      });
      projectIds = memberships.map((m) => m.projectId);
    }
    const metrics = await weeklyMetrics(projectIds, report.lastWeek);
    // 같은 프로젝트에 행사가 여럿이면(LA·도쿄·파리) 지금 가장 가까운 행사 하나에만 붙인다 — 세 줄에 같은 숫자가 반복되면 읽는 사람이 더한다.
    const attached = new Set<string>();
    const ordered = [...groups].filter((g) => g.projectId && !g.archived).sort((a, b) => {
      const da = day(a.endDate) ?? "9999";
      const db = day(b.endDate) ?? "9999";
      const pa = da >= reportDate ? 0 : 1;
      const pb = db >= reportDate ? 0 : 1;
      return pa - pb || da.localeCompare(db);
    });
    for (const g of ordered) {
      const lines = metrics.get(g.projectId!);
      if (!lines || attached.has(g.projectId!)) continue;
      attached.add(g.projectId!);
      const row = report.rows.find((r) => r.groupId === g.id);
      const block: ReportBlock = { category: "지표", lines, owners: [], status: "", extra: [] };
      if (row) row.pairs.push({ last: block, next: null });
    }
  }
  return report;
}

/** 저장된 보고서(있으면). */
export async function loadSavedReport(workspaceId: string, reportDate: string) {
  const saved = await prisma.weeklyReport.findUnique({ where: { workspaceId_reportDate: { workspaceId, reportDate: new Date(`${reportDate}T00:00:00Z`) } } });
  if (!saved) return null;
  const { last, next } = reportWindows(reportDate);
  return {
    report: { reportDate, lastWeek: last, thisWeek: next, rows: normalizeReportRows(saved.rows) } satisfies WeeklyReport,
    source: saved.source,
    updatedAt: saved.updatedAt.toISOString(),
    updatedById: saved.updatedById,
  };
}

/** 보고일 이전에 저장된 보고서 n 개(최근 순) — 지난 보고의 흐름·문체를 잇는 데 쓴다. */
export async function loadPreviousReports(workspaceId: string, reportDate: string, take: number) {
  const rows = await prisma.weeklyReport.findMany({
    where: { workspaceId, reportDate: { lt: new Date(`${reportDate}T00:00:00Z`) } },
    orderBy: { reportDate: "desc" },
    take,
  });
  return rows.map((r) => ({ reportDate: day(r.reportDate)!, rows: normalizeReportRows(r.rows) }));
}

