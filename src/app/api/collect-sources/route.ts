import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { createDomesticFormConfig } from "@/lib/collect-builder-type";
import { logActivity } from "@/lib/activity";

/** 미리보기 링크 토큰 — Project.analyticsShareToken 과 같은 방식·길이. */
function randomToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) return NextResponse.json({ error: "workspaceId 필요" }, { status: 400 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const sources = await prisma.collectSource.findMany({
    where: { workspaceId, ...(projectId ? { projectId } : {}), deletedAt: null },
    include: {
      _count: { select: { records: true } },
      fieldMappings: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ sources });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const body = await request.json();
  const { workspaceId, projectId, name, description, siteUrl, successTrigger, redirectUrl } = body;
  // 수집 방식 — 모르는 값은 기존 동작(capture)으로 떨어뜨린다. 새 방식이 기본이 되면
  // 스크립트를 붙여 쓰던 기존 흐름이 조용히 바뀐다(설계 §3.1).
  const mode = body.mode === "builder" ? "builder" : "capture";

  if (!workspaceId || !projectId || !name) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (!membership || membership.role === "MEMBER") {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  // projectId 가 이 워크스페이스 소속인지 검증 — 교차 테넌트 FK 방지.
  // (webinars/route.ts, webinar-embed-sites/route.ts 등은 이미 이 검사를 한다)
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없어요" }, { status: 400 });

  const source = await prisma.collectSource.create({
    data: {
      workspaceId,
      projectId,
      name,
      description: description || null,
      siteUrl: siteUrl || null,
      successTrigger: successTrigger || "정상적으로 접수되었습니다",
      redirectUrl: redirectUrl || null,
      mode,
      ...(mode === "builder" && body.builderVariant === "domestic" ? { formConfig: createDomesticFormConfig() as unknown as object } : {}),
      // 빌더형만 미리보기 링크를 갖는다. 연동형은 외부 사이트의 폼을 쓰므로 미리볼 대상이 없다.
      // 소스 id 대신 난수 토큰을 쓰는 이유는 **재발급으로 링크를 끊기 위해서**다(§16.1).
      previewToken: mode === "builder" ? randomToken() : null,
    },
    include: { fieldMappings: true },
  });

  await logActivity({
    workspaceId,
    sourceId: source.id,
    userId: user.id,
    action: "source.created",
    meta: { name: source.name },
  });

  return NextResponse.json({ source }, { status: 201 });
}
