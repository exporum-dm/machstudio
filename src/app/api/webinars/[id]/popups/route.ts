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

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const popups = await prisma.webinarPopup.findMany({
    where: { webinarId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ popups });
}

async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json();
  const title = clean(body.title);
  if (!title) return NextResponse.json({ error: "팝업 제목을 입력해주세요" }, { status: 400 });

  const integrationType = body.integrationType === "tally" ? "tally" : "link";
  const popup = await prisma.webinarPopup.create({
    data: {
      webinarId: id,
      type: clean(body.type) ?? "notice",
      title,
      message: clean(body.message),
      buttonLabel: clean(body.buttonLabel),
      buttonUrl: integrationType === "tally" ? null : clean(body.buttonUrl),
      secondaryLabel: clean(body.secondaryLabel),
      secondaryUrl: clean(body.secondaryUrl),
      integrationType,
      tallyFormId: clean(body.tallyFormId),
      tallyEmojiText: clean(body.tallyEmojiText),
      tallyEmojiAnimation: clean(body.tallyEmojiAnimation),
      tallyLayout: clean(body.tallyLayout) ?? "modal",
      tallyWidth: Number(body.tallyWidth) || 700,
      tallyAutoClose: Number(body.tallyAutoClose) || 5000,
      dismissible: body.dismissible !== false,
      isActive: false, // 등록 후 이력에서 ON — 실수 발행 방지
      sentBy: user.id,
    },
  });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.popup_created",
    meta: { webinarId: id, popupId: popup.id, type: popup.type },
  });

  return NextResponse.json({ popup }, { status: 201 });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const POST = withLiveSignal("popup", postHandler);
