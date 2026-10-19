/**
 * 만족도 조사 제출 — POST /api/q/{token}/submit { ticket? , walkIn?, answers, channel?, locale? }
 * 등록자: 본인 확인 티켓 → 1인 1응답(다시 내면 덮어쓴다). 등록 없이(walkIn): 조사가 허용할 때만, IP 한도.
 * 열린(open) 조사만 받는다 — 작성 중 미리보기는 저장하지 않는다.
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { validateSurveyAnswers } from "@/lib/survey-config";
import { loadPublicSurvey } from "@/lib/survey-server";
import { verifySurveyTicket } from "@/lib/survey-ticket";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[^\w\-.]/g, "").slice(0, n) : "");

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const survey = await loadPublicSurvey(token);
  if (!survey) return NextResponse.json({ error: "Survey not found" }, { status: 404 });
  if (survey.status !== "open") {
    return NextResponse.json({ error: survey.status === "closed" ? "This survey is closed." : "Preview only — answers are not saved." }, { status: 409 });
  }
  const body = await request.json().catch(() => ({}));
  const channel = clip(body.channel, 40);
  const locale = clip(body.locale, 10);
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 300);

  if (body.walkIn === true) {
    if (!survey.config.allowWalkIn) return NextResponse.json({ error: "Please verify your registration first." }, { status: 400 });
    const rl = await rateLimitAsync(`survey-walkin:${getClientIp(request)}`, { limit: 30, windowMs: 10 * 60_000 });
    if (!rl.allowed) return NextResponse.json({ error: "Too many submissions. Please try again later." }, { status: 429 });
    const key = survey.config.audienceFieldKey;
    const answersIn = (body.answers ?? {}) as Record<string, unknown>;
    const audience = key && typeof answersIn[key] === "string" ? String(answersIn[key]).slice(0, 60) : "";
    const result = validateSurveyAnswers(survey.config, audience, answersIn, true);
    if (!result.ok) return NextResponse.json({ error: "Please answer the highlighted questions.", issues: result.issues }, { status: 400 });
    await prisma.surveyResponse.create({
      data: { surveyId: survey.id, audience, answers: result.answers as unknown as Prisma.InputJsonValue, channel, locale, userAgent },
    });
    return NextResponse.json({ ok: true });
  }

  const ticket = verifySurveyTicket(body.ticket, survey.id);
  if (!ticket) return NextResponse.json({ error: "Your session expired. Please enter your email or phone again.", expired: true }, { status: 401 });
  const result = validateSurveyAnswers(survey.config, ticket.audience, body.answers);
  if (!result.ok) return NextResponse.json({ error: "Please answer the highlighted questions.", issues: result.issues }, { status: 400 });
  const answers = result.answers as unknown as Prisma.InputJsonValue;
  await prisma.surveyResponse.upsert({
    where: { surveyId_recordId: { surveyId: survey.id, recordId: ticket.recordId } },
    create: { surveyId: survey.id, recordId: ticket.recordId, audience: ticket.audience, answers, channel, locale, userAgent },
    update: { answers, audience: ticket.audience, ...(channel ? { channel } : {}), locale, userAgent },
  });
  return NextResponse.json({ ok: true });
}
