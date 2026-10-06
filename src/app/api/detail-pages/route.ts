import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { DEFAULT_COMPETITION_THEME } from "@/lib/competition-config";
import { getWorkspaceMemberAccess } from "@/lib/detail-page/access";
import { initialDetailPageConfig } from "@/lib/detail-page/config";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const projectId = searchParams.get("projectId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId 필요" }, { status: 400 });
  const access = await getWorkspaceMemberAccess(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const pages = await prisma.detailPage.findMany({
    where: { workspaceId, deletedAt: null, ...(projectId ? { projectId } : {}) },
    select: { id: true, name: true, config: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  // 목록에는 공개 여부만 있으면 된다 — 섹션 내용 전체를 내려보내지 않는다.
  return NextResponse.json({
    pages: pages.map(({ config, ...page }) => {
      const np = (config as { noticePage?: { enabled?: unknown } } | null)?.noticePage;
      return { ...page, enabled: np?.enabled === true };
    }),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { workspaceId, projectId } = body as { workspaceId?: string; projectId?: string };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!workspaceId || !projectId) return NextResponse.json({ error: "필수 항목이 누락됐어요" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "페이지 이름을 입력해주세요" }, { status: 400 });
  if (name.length > 120) return NextResponse.json({ error: "이름은 120자까지 쓸 수 있어요" }, { status: 400 });

  const access = await getWorkspaceMemberAccess(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null } });
  if (!project) return NextResponse.json({ error: "프로젝트 없음" }, { status: 404 });

  const page = await prisma.detailPage.create({
    data: {
      workspaceId,
      projectId,
      name,
      config: initialDetailPageConfig(name) as Prisma.InputJsonValue,
      theme: { accentColor: DEFAULT_COMPETITION_THEME.accentColor },
      createdById: access.user.id,
    },
  });
  await logActivity({ workspaceId, userId: access.user.id, action: "detailPage.created", meta: { detailPageId: page.id, name } });
  return NextResponse.json({ page }, { status: 201 });
}
