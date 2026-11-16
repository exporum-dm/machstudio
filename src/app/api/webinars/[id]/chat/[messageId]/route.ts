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

// 어드민 DELETE — 메시지 모더레이션(삭제).
async function deleteHandler(_request: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, messageId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const msg = await prisma.webinarChatMessage.findFirst({ where: { id: messageId, webinarId: id }, select: { id: true } });
  if (!msg) return NextResponse.json({ error: "메시지를 찾지 못했어요" }, { status: 404 });

  await prisma.webinarChatMessage.delete({ where: { id: msg.id } });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.chat_deleted",
    meta: { webinarId: id, messageId },
  });
  return NextResponse.json({ ok: true });
}

// 어드민 PATCH — 고정(웨비나당 1개, 단일활성) / 차단(작성 등록자를 채팅에서 차단 + 기존 메시지 정리).
async function patchHandler(request: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, messageId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const msg = await prisma.webinarChatMessage.findFirst({
    where: { id: messageId, webinarId: id },
    select: { id: true, registrationId: true },
  });
  if (!msg) return NextResponse.json({ error: "메시지를 찾지 못했어요" }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  // 고정 — 켜는 순간 다른 고정을 전부 끈다(팝업/투표/Q&A 단일활성 패턴).
  if (body.isPinned === true) {
    try {
      await prisma.$transaction([
        prisma.webinarChatMessage.updateMany({ where: { webinarId: id, isPinned: true }, data: { isPinned: false } }),
        prisma.webinarChatMessage.update({ where: { id: msg.id }, data: { isPinned: true } }),
      ]);
    } catch (e) {
      if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "다른 메시지가 방금 고정됐어요. 새로고침 후 다시 시도해주세요." }, { status: 409 });
      }
      throw e;
    }
  } else if (body.isPinned === false) {
    await prisma.webinarChatMessage.update({ where: { id: msg.id }, data: { isPinned: false } });
  }

  // 차단 — 작성자를 채팅에서 차단(전용 컬럼에 원자적 push)하고 해당 등록자 메시지 정리. 한 트랜잭션으로.
  if (body.ban === true && msg.registrationId) {
    const already = (webinar.chatBannedRegIds ?? []).includes(msg.registrationId);
    await prisma.$transaction([
      ...(already ? [] : [prisma.webinar.update({ where: { id }, data: { chatBannedRegIds: { push: msg.registrationId } } })]),
      prisma.webinarChatMessage.deleteMany({ where: { webinarId: id, registrationId: msg.registrationId, isHost: false } }),
    ]);
  }

  return NextResponse.json({ ok: true });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const DELETE = withLiveSignal("chat", deleteHandler);
export const PATCH = withLiveSignal("chat", patchHandler);
