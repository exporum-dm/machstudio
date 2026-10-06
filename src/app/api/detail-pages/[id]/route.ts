import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { getDetailPageAccess } from "@/lib/detail-page/access";
import { normalizeDetailPageSettings } from "@/lib/detail-page/config";
import { normalizeNoticePageConfig } from "@/lib/notice/config";

type Context = { params: Promise<{ id: string }> };

/** 섹션·이미지 주소가 쌓여도 이 정도면 충분하다 — 그 이상은 잘못 들어온 값으로 본다. */
const MAX_CONFIG_BYTES = 512 * 1024;
const HEX = /^#[0-9a-fA-F]{6}$/;

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const access = await getDetailPageAccess(id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json({ page: access.page });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const access = await getDetailPageAccess(id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await request.json().catch(() => ({}));
  const data: Prisma.DetailPageUpdateInput = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "페이지 이름을 입력해주세요" }, { status: 400 });
    if (name.length > 120) return NextResponse.json({ error: "이름은 120자까지 쓸 수 있어요" }, { status: 400 });
    data.name = name;
  }
  if (body.config !== undefined) {
    if (JSON.stringify(body.config).length > MAX_CONFIG_BYTES) {
      return NextResponse.json({ error: "내용이 너무 커요" }, { status: 413 });
    }
    // 저장 전에 정규화한다 — 모르는 키·틀린 형식은 여기서 걸러져 공개 페이지에 닿지 않는다.
    // 편집 중인 빈 행은 남긴다(편집기를 다시 열었을 때 쓰던 칸이 사라지지 않게).
    data.config = {
      noticePage: normalizeNoticePageConfig(body.config, { keepEmptyRows: true }),
      page: normalizeDetailPageSettings(body.config),
    } as unknown as Prisma.InputJsonValue;
  }
  if (body.theme !== undefined) {
    const accent = (body.theme as { accentColor?: unknown } | null)?.accentColor;
    if (typeof accent !== "string" || !HEX.test(accent)) {
      return NextResponse.json({ error: "키컬러 형식이 올바르지 않아요" }, { status: 400 });
    }
    data.theme = { accentColor: accent };
  }

  const page = await prisma.detailPage.update({ where: { id }, data });
  return NextResponse.json({ page });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  const access = await getDetailPageAccess(id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  // 소프트 삭제 — 붙여 둔 곳에서는 바로 "없음"이 된다.
  await prisma.detailPage.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity({
    workspaceId: access.page.workspaceId,
    userId: access.user.id,
    action: "detailPage.deleted",
    meta: { detailPageId: id, name: access.page.name },
  });
  return NextResponse.json({ ok: true });
}
