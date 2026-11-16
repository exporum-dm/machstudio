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

async function patchHandler(request: Request, { params }: { params: Promise<{ id: string; annId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, annId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json();
  const announcement = await prisma.webinarAnnouncement.findFirst({
    where: { id: annId, webinarId: id },
    select: { id: true },
  });
  if (!announcement) return NextResponse.json({ error: "공지를 찾지 못했어요" }, { status: 404 });

  // 라이브 페이지는 공지 1건(가장 최근)만 노출한다 — 여러 개를 켜면 관리자 표시와 시청자 화면이 어긋난다.
  // 다른 푸시들과 같은 규약: 나머지를 먼저 끈 뒤 대상을 켠다(부분 유니크 인덱스와 순서가 맞아야 한다).
  let updated;
  try {
    const ops = [
      ...(body.isActive === true
        ? [prisma.webinarAnnouncement.updateMany({
            where: { webinarId: id, id: { not: announcement.id }, isActive: true },
            data: { isActive: false },
          })]
        : []),
      prisma.webinarAnnouncement.update({
        where: { id: announcement.id },
        data: { ...(body.isActive !== undefined && { isActive: body.isActive }), ...(body.message !== undefined && { message: body.message }) },
      }),
    ];
    const results = await prisma.$transaction(ops);
    updated = results[results.length - 1] as Awaited<ReturnType<typeof prisma.webinarAnnouncement.update>>;
  } catch (e) {
    // 부분 유니크 인덱스(웨비나당 활성 1개) 위반 — 동시에 다른 공지가 켜진 경우. 500 대신 409.
    if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "다른 공지가 방금 켜졌어요. 새로고침 후 다시 시도해주세요." }, { status: 409 });
    }
    throw e;
  }

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.announcement_updated",
    meta: { webinarId: id, announcementId: annId, changes: Object.keys(body) },
  });

  return NextResponse.json({ announcement: updated });
}

async function deleteHandler(request: Request, { params }: { params: Promise<{ id: string; annId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, annId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const announcement = await prisma.webinarAnnouncement.findFirst({
    where: { id: annId, webinarId: id },
    select: { id: true },
  });
  if (!announcement) return NextResponse.json({ error: "공지를 찾지 못했어요" }, { status: 404 });

  await prisma.webinarAnnouncement.delete({ where: { id: announcement.id } });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.announcement_deleted",
    meta: { webinarId: id, announcementId: annId },
  });
  return NextResponse.json({ ok: true });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const PATCH = withLiveSignal("announcement", patchHandler);
export const DELETE = withLiveSignal("announcement", deleteHandler);
