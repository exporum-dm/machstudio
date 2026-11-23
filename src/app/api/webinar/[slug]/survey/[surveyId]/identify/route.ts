import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { createSurveyTicket } from "@/lib/survey-ticket";
import { isValidEmail, normalizeEmail } from "@/lib/webinar-config";
import { isSurveyAcceptingResponses } from "@/lib/webinar-survey";

const headers = { "Cache-Control": "no-store" };
const limited = { error: "확인 요청이 너무 잦아요. 잠시 후 다시 시도해주세요." };

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; surveyId: string }> }) {
  const { slug, surveyId } = await params;
  const ipLimit = await rateLimitAsync(`webinar-survey-identify:${slug}:${getClientIp(request)}`, { limit: 120, windowMs: 60_000 });
  if (!ipLimit.allowed) return NextResponse.json(limited, { status: 429, headers });

  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email || !isValidEmail(email)) return NextResponse.json({ found: false }, { headers });

  const emailKey = createHash("sha256").update(JSON.stringify([slug, email])).digest("base64url");
  const emailLimit = await rateLimitAsync(`webinar-survey-email:${emailKey}`, { limit: 10, windowMs: 600_000 });
  if (!emailLimit.allowed) return NextResponse.json(limited, { status: 429, headers });

  const survey = await prisma.webinarSurvey.findFirst({
    where: { id: surveyId, webinar: { slug } },
    select: { webinarId: true, isOpen: true, opensAt: true, closesAt: true },
  });
  if (!survey || !isSurveyAcceptingResponses(survey)) {
    return NextResponse.json({ error: "지금은 설문에 응답할 수 없어요." }, { status: 400, headers });
  }

  const registration = await prisma.webinarRegistration.findFirst({
    where: { webinarId: survey.webinarId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!registration) return NextResponse.json({ found: false }, { headers });
  return NextResponse.json({
    found: true,
    ticket: createSurveyTicket(`webinar:${surveyId}`, registration.id, ""),
  }, { headers });
}
