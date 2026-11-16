import { NextResponse } from "next/server";
import { withLiveSignal } from "@/lib/webinar-live-signal";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

async function authorize(webinarId: string, userId: string) {
  const webinar = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!webinar) return null;
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: webinar.workspaceId } },
  });
  return membership ? webinar : null;
}

async function patchHandler(request: Request, { params }: { params: Promise<{ id: string; popupId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, popupId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json();
  const popup = await prisma.webinarPopup.findFirst({ where: { id: popupId, webinarId: id }, select: { id: true } });
  if (!popup) return NextResponse.json({ error: "팝업을 찾지 못했어요" }, { status: 404 });

  // ON 은 1개만 유지 — 켜는 순간 같은 웨비나의 다른 팝업을 전부 끈다 (레거시 STK 규칙 계승)
  if (body.isActive === true) {
    try {
      await prisma.$transaction([
        prisma.webinarPopup.updateMany({ where: { webinarId: id, isActive: true }, data: { isActive: false } }),
        prisma.webinarPopup.update({ where: { id: popup.id }, data: { isActive: true } }),
      ]);
    } catch (e) {
      // 부분 유니크 인덱스(웨비나당 활성 1개) 위반 — 동시에 다른 항목이 켜진 경우. 500 대신 409.
      if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "다른 항목이 방금 활성화됐어요. 새로고침 후 다시 시도해주세요." }, { status: 409 });
      }
      throw e;
    }
  } else if (body.isActive === false) {
    await prisma.webinarPopup.update({ where: { id: popup.id }, data: { isActive: false } });
  }

  const updated = await prisma.webinarPopup.findUnique({ where: { id: popup.id } });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.popup_updated",
    meta: { webinarId: id, popupId, changes: Object.keys(body) },
  });

  return NextResponse.json({ popup: updated });
}

async function deleteHandler(_request: Request, { params }: { params: Promise<{ id: string; popupId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, popupId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const popup = await prisma.webinarPopup.findFirst({ where: { id: popupId, webinarId: id }, select: { id: true } });
  if (!popup) return NextResponse.json({ error: "팝업을 찾지 못했어요" }, { status: 404 });

  await prisma.webinarPopup.delete({ where: { id: popup.id } });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.popup_deleted",
    meta: { webinarId: id, popupId },
  });
  return NextResponse.json({ ok: true });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const PATCH = withLiveSignal("popup", patchHandler);
export const DELETE = withLiveSignal("popup", deleteHandler);
