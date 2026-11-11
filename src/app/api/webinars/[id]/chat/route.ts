import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity, logWebinarUpdate } from "@/lib/activity";

async function authorize(webinarId: string, userId: string) {
  // tick 폴링 라우트 — theme/config 등 큰 JSON 을 매번 끌어오지 않게 사용하는 컬럼만 select.
  const webinar = await prisma.webinar.findUnique({
    where: { id: webinarId },
    select: { id: true, workspaceId: true, name: true, components: true, chatHideLinks: true, chatSlowSec: true, chatBannedWords: true, chatBannedRegIds: true },
  });
  if (!webinar) return null;
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: webinar.workspaceId } },
  });
  return membership ? webinar : null;
}

// 어드민 GET — 모더레이션용 최근 메시지(실명 그대로).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const recent = await prisma.webinarChatMessage.findMany({
    where: { webinarId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true, message: true, isHost: true, isPinned: true, registrationId: true, createdAt: true },
  });
  const settings = {
    chatEnabled: (webinar.components as { chatEnabled?: boolean } | null)?.chatEnabled === true,
    hideLinks: webinar.chatHideLinks !== false,
    slowSec: webinar.chatSlowSec ?? 0,
    bannedWords: webinar.chatBannedWords ?? [],
    bannedCount: (webinar.chatBannedRegIds ?? []).length,
  };
  return NextResponse.json({ messages: recent, settings });
}

// 어드민 POST — 호스트(운영자) 발언.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json();
  const message = String(body.message ?? "").trim().slice(0, 300);
  if (!message) return NextResponse.json({ error: "메시지를 입력해주세요" }, { status: 400 });
  const name = String(body.name ?? "").trim().slice(0, 60) || "운영자";

  const created = await prisma.webinarChatMessage.create({
    data: { webinarId: id, name, message, isHost: true },
    select: { id: true },
  });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.chat_host_posted",
    meta: { webinarId: id, messageId: created.id },
  });

  return NextResponse.json({ message: created }, { status: 201 });
}

// 어드민 PATCH — 채팅 모더레이션 설정(천천히 모드 초·금지어)을 components 에 병합(다른 플래그 보존).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const data: { chatSlowSec?: number; chatBannedWords?: string[]; chatHideLinks?: boolean; components?: object } = {};
  if (body.slowSec !== undefined) data.chatSlowSec = Math.max(0, Math.min(300, Number(body.slowSec) || 0));
  if (Array.isArray(body.bannedWords)) {
    // substring 매칭이라 1자 토큰은 과다 차단 위험 — 2자 이상만 저장(최대 40자·50개).
    data.chatBannedWords = (body.bannedWords as unknown[]).map((w) => String(w).trim().slice(0, 40)).filter((w) => w.length >= 2).slice(0, 50);
  }
  if (body.hideLinks !== undefined) data.chatHideLinks = Boolean(body.hideLinks);
  // 채팅 on/off 는 components.chatEnabled(뷰어 게이팅과 동일 소스). 다른 컴포넌트 플래그 보존 병합.
  if (body.chatEnabled !== undefined) {
    const comp = (webinar.components ?? {}) as Record<string, unknown>;
    data.components = { ...comp, chatEnabled: Boolean(body.chatEnabled) };
  }
  const updated = await prisma.webinar.update({ where: { id }, data: data as never, select: { chatSlowSec: true, chatBannedWords: true } });

  const before = webinar as unknown as { name?: string; chatSlowSec?: number; chatBannedWords?: string[]; chatHideLinks?: boolean; components?: unknown };
  const beforeChat = ((before.components ?? {}) as Record<string, unknown>).chatEnabled;
  const details: string[] = [];
  if (data.chatSlowSec !== undefined && data.chatSlowSec !== before.chatSlowSec) {
    details.push(`채팅 저속 모드: ${before.chatSlowSec ? `${before.chatSlowSec}초` : "끔"} → ${data.chatSlowSec ? `${data.chatSlowSec}초` : "끔"}`);
  }
  if (data.chatBannedWords && JSON.stringify(data.chatBannedWords) !== JSON.stringify(before.chatBannedWords ?? [])) {
    details.push(`채팅 금칙어 ${data.chatBannedWords.length}개로 변경`);
  }
  if (data.chatHideLinks !== undefined && data.chatHideLinks !== Boolean(before.chatHideLinks)) {
    details.push(`채팅 링크 ${data.chatHideLinks ? "가리기" : "보이기"}`);
  }
  if (body.chatEnabled !== undefined && Boolean(body.chatEnabled) !== (beforeChat !== false)) {
    details.push(`채팅 ${body.chatEnabled ? "켜기" : "끄기"}`);
  }
  await logWebinarUpdate({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    webinarId: id,
    webinarName: before.name ?? "",
    details,
  });

  return NextResponse.json({ ok: true, settings: { slowSec: updated.chatSlowSec, bannedWords: updated.chatBannedWords } });
}
