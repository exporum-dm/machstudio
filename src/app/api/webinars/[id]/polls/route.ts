import { NextResponse } from "next/server";
import { withLiveSignal } from "@/lib/webinar-live-signal";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

async function authorize(webinarId: string, userId: string) {
  const webinar = await prisma.webinar.findUnique({ where: { id: webinarId }, select: { id: true, workspaceId: true } });
  if (!webinar) return null;
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: webinar.workspaceId } },
  });
  return membership ? webinar : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const polls = await prisma.webinarPoll.findMany({
    where: { webinarId: id },
    orderBy: { createdAt: "desc" },
    include: { options: { orderBy: { order: "asc" } } },
  });
  return NextResponse.json({ polls });
}

async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json();
  const question = String(body.question ?? "").trim();
  const options = Array.isArray(body.options)
    ? body.options.map((o: unknown) => String(o ?? "").trim()).filter(Boolean)
    : [];
  if (!question) return NextResponse.json({ error: "질문을 입력해주세요" }, { status: 400 });
  if (options.length < 2) return NextResponse.json({ error: "선택지를 2개 이상 입력해주세요" }, { status: 400 });

  const poll = await prisma.webinarPoll.create({
    data: {
      webinarId: id,
      question,
      isActive: false, // 등록 후 발행 — 실수 노출 방지
      sentBy: user.id,
      options: { create: options.slice(0, 8).map((label: string, i: number) => ({ label, order: i })) },
    },
    include: { options: { orderBy: { order: "asc" } } },
  });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.poll_created",
    meta: { webinarId: id, pollId: poll.id },
  });

  return NextResponse.json({ poll }, { status: 201 });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const POST = withLiveSignal("poll", postHandler);
