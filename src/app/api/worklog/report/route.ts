/**
 * 주간업무보고 — GET ?workspaceId&date=YYYY-MM-DD[&fresh=1][&format=xlsx][&hideOwners=1][&metrics=1] · PUT · DELETE
 *
 * GET : 그 보고일에 저장된 보고서가 있으면 그것, 없으면(또는 fresh=1) 업무일지로 만든 초안(lib/worklog.ts).
 *       metrics=1 이면 초안에 프로젝트 전주 숫자(사전등록·광고)를 "[지표]" 묶음으로 붙인다.
 * PUT : { workspaceId, date, rows, source? } — 화면에서 고친 보고서를 저장(보고일마다 하나).
 * DELETE ?workspaceId&date — 저장본을 지우고 자동 초안으로 돌아간다.
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import { defaultReportDate, kstToday, normalizeReportRows, reportSheetName, reportTable } from "@/lib/worklog";
import { buildReportWorkbook } from "@/lib/worklog-xlsx";
import { buildDraftReport, loadSavedReport } from "@/lib/worklog-report-server";
import { worklogAiAvailable } from "@/lib/worklog-ai";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: unknown): v is string => typeof v === "string" && DAY_RE.test(v) && !Number.isNaN(Date.parse(v));

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const dateParam = searchParams.get("date");
  const reportDate = validDay(dateParam) ? dateParam : defaultReportDate(kstToday());
  const hideOwners = searchParams.get("hideOwners") === "1";

  const saved = searchParams.get("fresh") === "1" ? null : await loadSavedReport(workspaceId!, reportDate);
  const report = saved?.report ?? (await buildDraftReport(workspaceId!, reportDate, { metrics: searchParams.get("metrics") === "1" }));
  const table = reportTable(report, { hideOwners });

  if (searchParams.get("format") === "xlsx") {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId! }, select: { name: true } });
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

  return NextResponse.json(
    {
      report,
      table,
      saved: saved ? { source: saved.source, updatedAt: saved.updatedAt } : null,
      aiAvailable: worklogAiAvailable(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!validDay(body.date)) return NextResponse.json({ error: "보고일을 확인해주세요" }, { status: 400 });
  const rows = normalizeReportRows(body.rows) as unknown as Prisma.InputJsonValue;
  const source = body.source === "ai" || body.source === "imported" ? body.source : "edited";
  const reportDate = new Date(`${body.date}T00:00:00Z`);
  const saved = await prisma.weeklyReport.upsert({
    where: { workspaceId_reportDate: { workspaceId: workspaceId!, reportDate } },
    create: { workspaceId: workspaceId!, reportDate, rows, source, updatedById: access.userId },
    update: { rows, source, updatedById: access.userId },
  });
  return NextResponse.json({ saved: { source: saved.source, updatedAt: saved.updatedAt.toISOString() } });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const date = searchParams.get("date");
  if (!validDay(date)) return NextResponse.json({ error: "보고일을 확인해주세요" }, { status: 400 });
  await prisma.weeklyReport.deleteMany({ where: { workspaceId: workspaceId!, reportDate: new Date(`${date}T00:00:00Z`) } });
  return NextResponse.json({ ok: true });
}
