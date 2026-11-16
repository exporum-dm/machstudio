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

async function patchHandler(request: Request, { params }: { params: Promise<{ id: string; pollId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, pollId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const poll = await prisma.webinarPoll.findFirst({
    where: { id: pollId, webinarId: id },
    select: { id: true, options: { select: { id: true } } },
  });
  if (!poll) return NextResponse.json({ error: "투표를 찾지 못했어요" }, { status: 404 });

  const body = await request.json();

  // 질문/선택지 문구 수정 (선택지 추가·삭제는 미지원 — 라벨만 id 기준 업데이트)
  const question = typeof body.question === "string" ? body.question.trim() : undefined;
  const optionEdits = Array.isArray(body.options)
    ? (body.options as { id?: string; label?: string }[])
        .filter((o) => o && typeof o.id === "string" && poll.options.some((p) => p.id === o.id))
        .map((o) => ({ id: String(o.id), label: String(o.label ?? "").trim() }))
        .filter((o) => o.label)
    : [];

  if (question !== undefined || optionEdits.length) {
    await prisma.$transaction([
      ...(question ? [prisma.webinarPoll.update({ where: { id: poll.id }, data: { question } })] : []),
      ...optionEdits.map((o) => prisma.webinarPollOption.update({ where: { id: o.id }, data: { label: o.label } })),
    ]);
  }

  // 발행(ON) 은 웨비나당 1개만 — 켜는 순간 다른 투표를 전부 끈다 (팝업·Tally 규칙 계승)
  if (body.isActive === true) {
    try {
      await prisma.$transaction([
        prisma.webinarPoll.updateMany({ where: { webinarId: id, isActive: true }, data: { isActive: false } }),
        prisma.webinarPoll.update({ where: { id: poll.id }, data: { isActive: true } }),
      ]);
    } catch (e) {
      // 부분 유니크 인덱스(웨비나당 활성 1개) 위반 — 동시에 다른 항목이 켜진 경우. 500 대신 409.
      if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "다른 항목이 방금 활성화됐어요. 새로고침 후 다시 시도해주세요." }, { status: 409 });
      }
      throw e;
    }
  } else if (body.isActive === false) {
    await prisma.webinarPoll.update({ where: { id: poll.id }, data: { isActive: false } });
  }

  const updated = await prisma.webinarPoll.findUnique({
    where: { id: poll.id },
    include: { options: { orderBy: { order: "asc" } } },
  });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.poll_updated",
    meta: { webinarId: id, pollId, changes: Object.keys(body) },
  });

  return NextResponse.json({ poll: updated });
}

async function deleteHandler(_request: Request, { params }: { params: Promise<{ id: string; pollId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, pollId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const poll = await prisma.webinarPoll.findFirst({ where: { id: pollId, webinarId: id }, select: { id: true } });
  if (!poll) return NextResponse.json({ error: "투표를 찾지 못했어요" }, { status: 404 });

  await prisma.webinarPoll.delete({ where: { id: poll.id } });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.poll_deleted",
    meta: { webinarId: id, pollId },
  });
  return NextResponse.json({ ok: true });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const PATCH = withLiveSignal("poll", patchHandler);
export const DELETE = withLiveSignal("poll", deleteHandler);
