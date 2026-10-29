/**
 * 주간 보고 AI 다듬기 — POST { workspaceId, date }
 * 업무일지 초안 + 지난 보고서 3개(문체·흐름) → 보고서 칸 글. 저장은 하지 않는다(화면이 PUT 으로 저장).
 */
import { NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import { buildDraftReport, loadPreviousReports } from "@/lib/worklog-report-server";
import { polishReportWithAi, worklogAiAvailable } from "@/lib/worklog-ai";
import { isValidDay, reportTable } from "@/lib/worklog";
import { rateLimitAsync } from "@/lib/ratelimit";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!isValidDay(body.date)) return NextResponse.json({ error: "보고일을 확인해주세요" }, { status: 400 });
  if (!worklogAiAvailable()) return NextResponse.json({ error: "AI 다듬기는 Vercel 환경 변수 ANTHROPIC_API_KEY 를 넣으면 켜져요" }, { status: 501 });
  const limit = await rateLimitAsync(`worklog-ai:${access.userId}`, { limit: 6, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "AI 다듬기를 너무 자주 눌렀어요 — 잠시 후 다시 시도해 주세요" },
      { status: 429 },
    );
  }

  const [draft, previous] = await Promise.all([
    buildDraftReport(workspaceId!, body.date, {
      metrics: body.metrics === true,
      viewer: { userId: access.userId, isAdmin: access.isAdmin },
    }),
    loadPreviousReports(workspaceId!, body.date, 3),
  ]);
  try {
    const rows = await polishReportWithAi({ draft, previous });
    const report = { ...draft, rows };
    return NextResponse.json({ report, table: reportTable(report) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 가 보고서를 쓰지 못했어요" }, { status: 502 });
  }
}
