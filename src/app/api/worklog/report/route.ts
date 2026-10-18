/**
 * 주간업무보고 자동 작성 — GET ?workspaceId&date=YYYY-MM-DD[&format=xlsx][&hideOwners=1][&metrics=1]
 *
 * 업무일지 줄로 DM 주간 업무 보고 시트와 같은 표를 만든다(lib/worklog.ts).
 * metrics=1 이면 프로젝트와 이어진 행사에 전주 숫자(사전등록·광고)를 "[지표]" 묶음으로 붙인다 —
 * 매주 대시보드를 보고 손으로 옮겨 적던 부분이다.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import { buildWeeklyReport, effectiveStatus, kstToday, reportSheetName, reportTable, shiftDay, type ReportBlock, type WorkStatus } from "@/lib/worklog";
import { buildReportWorkbook } from "@/lib/worklog-xlsx";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const dateParam = searchParams.get("date");
  const reportDate = dateParam && DAY_RE.test(dateParam) ? dateParam : kstToday();
  const hideOwners = searchParams.get("hideOwners") === "1";
  const withMetrics = searchParams.get("metrics") === "1";

  const [groups, workspace] = await Promise.all([
    prisma.workGroup.findMany({ where: { workspaceId: workspaceId! }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.workspace.findUnique({ where: { id: workspaceId! }, select: { name: true } }),
  ]);
  // 금주 + 전주 두 주만 읽으면 된다.
  const thisWeekStart = buildWeeklyReport({ reportDate, groups: [], entries: [], authorName: () => "" }).lastWeek.start;
  const entries = await prisma.workEntry.findMany({
    where: { workspaceId: workspaceId!, date: { gte: new Date(`${thisWeekStart}T00:00:00Z`), lte: new Date(`${shiftDay(thisWeekStart, 13)}T00:00:00Z`) } },
    include: { author: { select: { name: true, email: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const names = new Map(entries.map((e) => [e.authorId, e.author.name || e.author.email.split("@")[0]]));

  const report = buildWeeklyReport({
    reportDate,
    groups: groups.map((g) => ({
      id: g.id, name: g.name, sortOrder: g.sortOrder, archived: g.archived,
      startDate: g.startDate ? g.startDate.toISOString().slice(0, 10) : null,
      endDate: g.endDate ? g.endDate.toISOString().slice(0, 10) : null,
    })),
    entries: entries.map((e) => ({
      id: e.id, groupId: e.groupId, authorId: e.authorId, date: e.date!.toISOString().slice(0, 10),
      // 시트처럼 취소선만 긋는다 — 안 그은 줄은 보고일 기준으로 진행/예정을 다시 정한다(미리 적어 둔 일이 날짜가 지나면 진행·이월).
      category: e.category, content: e.content, status: effectiveStatus(e.status as WorkStatus, e.date!.toISOString().slice(0, 10), reportDate), result: e.result, note: e.note,
    })),
    authorName: (id) => names.get(id) ?? "",
  });

  if (withMetrics) {
    const projectIds = [...new Set(groups.map((g) => g.projectId).filter((id): id is string => !!id))];
    const metrics = await weeklyMetrics(projectIds, report.lastWeek);
    // 같은 프로젝트에 행사가 여럿이면(LA·도쿄·파리) 지금 가장 가까운 행사 하나에만 붙인다 — 세 줄에 같은 숫자가 반복되면 읽는 사람이 더한다.
    const attached = new Set<string>();
    const today = reportDate;
    const ordered = [...groups].filter((g) => g.projectId).sort((a, b) => {
      const da = a.endDate ? a.endDate.toISOString().slice(0, 10) : "9999";
      const db = b.endDate ? b.endDate.toISOString().slice(0, 10) : "9999";
      const pa = da >= today ? 0 : 1;
      const pb = db >= today ? 0 : 1;
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

  const table = reportTable(report, { hideOwners });

  if (searchParams.get("format") === "xlsx") {
    const buffer = buildReportWorkbook(table, { title: `${workspace?.name ?? "DM"} 주간 업무 보고`, reportDate, hideOwners });
    const filename = `주간업무보고_${reportSheetName(reportDate)}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ report, table }, { headers: { "Cache-Control": "no-store" } });
}
