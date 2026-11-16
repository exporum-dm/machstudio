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

async function patchHandler(request: Request, { params }: { params: Promise<{ id: string; pushId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, pushId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json();
  const push = await prisma.webinarTallyPush.findFirst({ where: { id: pushId, webinarId: id }, select: { id: true } });
  if (!push) return NextResponse.json({ error: "Tally 푸시를 찾지 못했어요" }, { status: 404 });

  // ON 은 1개만 유지 (레거시 STK 규칙 계승)
  if (body.isActive === true) {
    try {
      await prisma.$transaction([
        prisma.webinarTallyPush.updateMany({ where: { webinarId: id, isActive: true }, data: { isActive: false } }),
        prisma.webinarTallyPush.update({ where: { id: push.id }, data: { isActive: true } }),
      ]);
    } catch (e) {
      // 부분 유니크 인덱스(웨비나당 활성 1개) 위반 — 동시에 다른 항목이 켜진 경우. 500 대신 409.
      if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "다른 항목이 방금 활성화됐어요. 새로고침 후 다시 시도해주세요." }, { status: 409 });
      }
      throw e;
    }
  } else if (body.isActive === false) {
    await prisma.webinarTallyPush.update({ where: { id: push.id }, data: { isActive: false } });
  }

  const updated = await prisma.webinarTallyPush.findUnique({ where: { id: push.id } });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.tally_push_updated",
    meta: { webinarId: id, pushId, changes: Object.keys(body) },
  });

  return NextResponse.json({ tallyPush: updated });
}

async function deleteHandler(_request: Request, { params }: { params: Promise<{ id: string; pushId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, pushId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const push = await prisma.webinarTallyPush.findFirst({ where: { id: pushId, webinarId: id }, select: { id: true } });
  if (!push) return NextResponse.json({ error: "Tally 푸시를 찾지 못했어요" }, { status: 404 });

  await prisma.webinarTallyPush.delete({ where: { id: push.id } });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.tally_push_deleted",
    meta: { webinarId: id, pushId },
  });
  return NextResponse.json({ ok: true });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const PATCH = withLiveSignal("tally", patchHandler);
export const DELETE = withLiveSignal("tally", deleteHandler);
