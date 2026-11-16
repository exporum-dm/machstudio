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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const announcements = await prisma.webinarAnnouncement.findMany({
    where: { webinarId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ announcements });
}

async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  // 입력 검증·상한 — 공지는 live-state 폴링으로 전 시청자에게 12초마다 전송되므로 초대형 텍스트 증폭을 막는다.
  const message = String(body?.message ?? "").trim().slice(0, 2000);
  if (!message) return NextResponse.json({ error: "공지 내용을 입력해주세요" }, { status: 400 });
  const type = typeof body?.type === "string" ? body.type : "info";
  const announcement = await prisma.webinarAnnouncement.create({
    data: { webinarId: id, type, message, sentBy: user.id },
  });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.announcement_created",
    meta: { webinarId: id, announcementId: announcement.id, type: announcement.type },
  });

  return NextResponse.json({ announcement }, { status: 201 });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const POST = withLiveSignal("announcement", postHandler);
