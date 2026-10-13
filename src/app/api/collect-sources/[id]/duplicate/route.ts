import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { duplicateName, duplicateSourceData } from "@/lib/collect-source-duplicate";

/** 사전등록 폼 복제 — 폼 항목·문구·설정은 그대로, 등록 데이터와 링크·키는 새로(lib/collect-source-duplicate.ts). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const source = await prisma.collectSource.findFirst({
    where: { id, deletedAt: null },
    include: { fieldMappings: true },
  });
  if (!source) return NextResponse.json({ error: "사전등록 폼을 찾을 수 없어요" }, { status: 404 });

  // 새 폼을 만드는 것과 같은 권한 — 일반 멤버는 폼을 만들 수 없다(POST /api/collect-sources 와 같은 기준).
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: source.workspaceId } },
  });
  if (!membership || membership.role === "MEMBER") return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const requested = typeof body.name === "string" ? body.name.trim() : "";
  if (requested.length > 200) return NextResponse.json({ error: "이름은 200자까지 쓸 수 있어요" }, { status: 400 });
  const name = requested || duplicateName(source.name);

  const retention = await prisma.collectRetentionPolicy.findUnique({ where: { sourceId: source.id } });

  const created = await prisma.$transaction(async (tx) => {
    const data = duplicateSourceData(source, name);
    const copy = await tx.collectSource.create({
      data: {
        ...data,
        formConfig: (data.formConfig ?? Prisma.DbNull) as Prisma.InputJsonValue,
        emailConfig: (data.emailConfig ?? Prisma.DbNull) as Prisma.InputJsonValue,
        venueConfig: (data.venueConfig ?? Prisma.DbNull) as Prisma.InputJsonValue,
        workspaceId: source.workspaceId,
        projectId: source.projectId,
        previewToken: source.mode === "builder" ? randomBytes(24).toString("base64url") : null,
      },
    });
    // 연동형은 필드 매핑이 곧 폼 항목이다 — 그대로 옮긴다(빌더형은 formConfig 안에 있다).
    if (source.fieldMappings.length > 0) {
      await tx.fieldMapping.createMany({
        data: source.fieldMappings.map(({ id: _id, sourceId: _sourceId, createdAt: _createdAt, ...mapping }) => ({ ...mapping, sourceId: copy.id })),
      });
    }
    if (retention) {
      await tx.collectRetentionPolicy.create({ data: { sourceId: copy.id, retainDays: retention.retainDays } });
    }
    return copy;
  });

  await logActivity({
    workspaceId: source.workspaceId,
    sourceId: created.id,
    userId: user.id,
    action: "source.created",
    meta: { name: created.name, duplicatedFrom: { id: source.id, name: source.name } },
  });

  return NextResponse.json({ source: { id: created.id, name: created.name, mode: created.mode } }, { status: 201 });
}
