import { NextResponse } from "next/server";
import { withLiveSignal } from "@/lib/webinar-live-signal";
import type { Prisma } from "@/generated/prisma";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { normalizeSurveyQuestions } from "@/lib/webinar-survey";

async function authorize(webinarId: string, userId: string) {
  const webinar = await prisma.webinar.findUnique({ where: { id: webinarId }, select: { id: true, workspaceId: true } });
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

  const surveys = await prisma.webinarSurvey.findMany({
    where: { webinarId: id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { responses: true } } },
  });
  // 어드민 편집기도 정규화된 형태만 받도록 — 드리프트된 JSON(비배열 등)으로 설문 탭이 죽지 않게
  return NextResponse.json({
    surveys: surveys.map((s) => ({ ...s, questions: normalizeSurveyQuestions(s.questions, { includeHidden: true }) })),
  });
}

async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const title = String(body?.title ?? "").trim() || "만족도 설문";

  const survey = await prisma.webinarSurvey.create({
    data: {
      webinarId: id,
      title,
      description: String(body?.description ?? "").trim() || null,
      questions: normalizeSurveyQuestions(body?.questions, { includeHidden: true }) as unknown as Prisma.InputJsonValue,
      sentBy: user.id,
    },
    include: { _count: { select: { responses: true } } },
  });
  return NextResponse.json({ survey }, { status: 201 });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const POST = withLiveSignal("survey", postHandler);
