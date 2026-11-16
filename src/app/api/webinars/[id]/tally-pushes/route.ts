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

// Tally 코드/URL 에서 form ID 추출 (레거시 어드민의 자동 추출 계승)
function extractTallyFormId(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const patterns = [
    /data-tally-open=["']([^"']+)["']/i,
    /#tally-open=([^&"'\s]+)/i,
    /tally\.so\/(?:forms|r)\/([^/?#"']+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]).trim();
  }
  if (/^[a-zA-Z0-9_-]{4,}$/.test(text)) return text;
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const tallyPushes = await prisma.webinarTallyPush.findMany({
    where: { webinarId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ tallyPushes });
}

async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json();
  const formId = extractTallyFormId(body.formId ?? body.embedCode);
  if (!formId) return NextResponse.json({ error: "Tally 폼 ID 또는 임베드 코드를 입력해주세요" }, { status: 400 });

  const push = await prisma.webinarTallyPush.create({
    data: {
      webinarId: id,
      title: clean(body.title) ?? "Tally 설문",
      formId,
      emojiText: clean(body.emojiText) ?? "👋",
      emojiAnimation: clean(body.emojiAnimation) ?? "wave",
      layout: clean(body.layout) ?? "modal",
      width: Number(body.width) || 700,
      autoClose: Number(body.autoClose) || 5000,
      showOnce: body.showOnce !== false,
      doNotShowAfterSubmit: body.doNotShowAfterSubmit !== false,
      memo: clean(body.memo),
      isActive: false, // 등록 후 이력에서 ON
      sentBy: user.id,
    },
  });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.tally_push_created",
    meta: { webinarId: id, pushId: push.id, formId },
  });

  return NextResponse.json({ tallyPush: push }, { status: 201 });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const POST = withLiveSignal("tally", postHandler);
