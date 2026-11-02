/**
 * 홈페이지 사이트 목록·생성.
 *
 * 목록은 **프로젝트 문맥**에서 그린다 — 사이드바가 고른 프로젝트를 쿼리로 받는다.
 * 상세 화면과 달리 목록은 그게 맞다(무엇을 보여줄지 고르는 일이다).
 * 다만 그 프로젝트가 내 워크스페이스인지는 서버가 확인한다.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardExpoRoute, readJsonBody, authFailure } from "@/lib/expo/route-guard";
import { requireProjectAccess } from "@/lib/expo/auth";
import { normalizeExpoTheme, EXPO_DEFAULT_THEME } from "@/lib/expo/config";
import { homePageDefaults } from "@/lib/expo/model";
import { canAccessExpoProject, deriveExpoPermissions } from "@/lib/expo/permissions";
import { isExpoPublicEmbedReleaseEnabled } from "@/lib/expo/capability";
import { randomUUID } from "node:crypto";

export async function GET(request: Request) {
  const guard = await guardExpoRoute(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");

  /**
   * 명시한 프로젝트의 워크스페이스 소속을 목록 조회 전에 확인한다.
   * 같은 워크스페이스의 계정은 배정 없이 조회하며 편집 권한은 별도로 내려준다.
   */
  let projectPermissions = deriveExpoPermissions(null, null);
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, workspaceId: true },
    });
    if (!project) return authFailure({ kind: "not-found" });
    const access = requireProjectAccess(guard.ctx.workspaceRole(project.workspaceId), guard.ctx.projectRole(project.id));
    if (!access.ok) return authFailure(access.failure);
    projectPermissions = deriveExpoPermissions(guard.ctx.workspaceRole(project.workspaceId), guard.ctx.projectRole(project.id));
  }

  const sites = await prisma.expoSite.findMany({
    where: {
      deletedAt: null,
      workspaceId: { in: guard.ctx.memberWorkspaceIds },
      ...(projectId ? { projectId } : {}),
    },
    select: {
      id: true, workspaceId: true, name: true, projectId: true, siteUrl: true, updatedAt: true,
      _count: { select: { pages: { where: { deletedAt: null } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  /**
   * "여기에 만들 수 있나" 는 **그 전시의 워크스페이스** 기준이다. 목록이 비어 있으면
   * 사이트에서 유도할 수 없으므로, 전시를 지정한 경우 그 프로젝트의 소속에서 뽑는다.
   * 전시를 안 지정했으면(워크스페이스 전체 보기) 만들기 대상이 정해지지 않았으므로 닫는다.
   */
  /**
   * 화면이 뷰어에게 **눌러도 실패할 버튼**을 보여주지 않게 하는 값들.
   * 권한 판정 자체는 모든 서비스·라우트가 자기 자리에서 다시 한다 — 숨기기는 인가가 아니다.
   *
   * 권한은 **그 사이트의 워크스페이스** 기준이다. 목록에 여러 워크스페이스가 섞일 수
   * 있으므로 사이트마다 붙인다 — 하나로 뭉치면 남의 워크스페이스 사이트에 편집
   * 버튼이 켜진다.
   */
  return NextResponse.json({
    sites: sites.filter((s) => canAccessExpoProject(
      guard.ctx.workspaceRole(s.workspaceId), guard.ctx.projectRole(s.projectId),
    )).map((s) => ({
      id: s.id, name: s.name, projectId: s.projectId, siteUrl: s.siteUrl,
      updatedAt: s.updatedAt, pageCount: s._count.pages,
      permissions: deriveExpoPermissions(guard.ctx.workspaceRole(s.workspaceId), guard.ctx.projectRole(s.projectId)),
    })),
    // 이 전시에 새로 만들 수 있는가 — 목록이 비어 있을 때 쓰는 값이다.
    permissions: projectPermissions,
    // 공개 승인은 권한과 별개다 — 권한이 있어도 승인 전에는 아무도 못 켠다.
    release: { publicEmbedEnabled: isExpoPublicEmbedReleaseEnabled() },
  });
}

export async function POST(request: Request) {
  const guard = await guardExpoRoute(request, { write: true });
  if (!guard.ok) return guard.response;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const projectId = String(parsed.body.projectId ?? "");
  const name = String(parsed.body.name ?? "").trim().slice(0, 120);
  if (!projectId || !name) {
    return NextResponse.json({ error: "전시와 이름이 필요해요" }, { status: 400 });
  }

  // 소속은 **프로젝트 레코드**에서 온다 — 클라이언트가 보낸 워크스페이스를 믿지 않는다.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, workspaceId: true },
  });
  if (!project) return authFailure({ kind: "not-found" });

  const access = requireProjectAccess(guard.ctx.workspaceRole(project.workspaceId), guard.ctx.projectRole(project.id));
  if (!access.ok) return authFailure(access.failure);
  if (!deriveExpoPermissions(guard.ctx.workspaceRole(project.workspaceId), guard.ctx.projectRole(project.id)).canEdit) {
    return authFailure({ kind: "forbidden" });
  }

  const home = homePageDefaults("ko");
  const site = await prisma.expoSite.create({
    data: {
      workspaceId: project.workspaceId,
      projectId: project.id,
      name,
      // Prisma 의 Json 입력 타입은 인덱스 시그니처를 요구한다 — 우리 타입은 고정 키라 한 번 넓힌다.
      theme: { ...normalizeExpoTheme(parsed.body.theme ?? EXPO_DEFAULT_THEME) },
      previewToken: randomUUID(),
      pages: { create: [{ ...home, draft: home.draft }] },
    },
    select: { id: true, name: true, projectId: true },
  });

  return NextResponse.json({ site }, { status: 201 });
}
