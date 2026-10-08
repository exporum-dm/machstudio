import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { buildProjectOverview } from "@/lib/project-overview";

/** 프로젝트 대시보드 — 진행 중인 사전등록·광고·대회·웨비나·상세페이지 요약(lib/project-overview.ts). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const projectId = searchParams.get("projectId");
  if (!workspaceId || !projectId) return NextResponse.json({ error: "workspaceId·projectId 필요" }, { status: 400 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });
  // 프로젝트가 그 워크스페이스 소속인지 서버가 확인한다 — 쿼리스트링의 짝을 믿지 않는다.
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "프로젝트 없음" }, { status: 404 });

  const overview = await buildProjectOverview(workspaceId, projectId);
  return NextResponse.json(overview, { headers: { "Cache-Control": "no-store" } });
}
