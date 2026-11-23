import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { createSurveyTicket } from "@/lib/survey-ticket";
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone } from "@/lib/webinar-config";
import { isSurveyAcceptingResponses } from "@/lib/webinar-survey";

const headers = { "Cache-Control": "no-store" };
const limited = { error: "확인 요청이 너무 잦아요. 잠시 후 다시 시도해주세요." };

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; surveyId: string }> }) {
  const { slug, surveyId } = await params;
  const ipLimit = await rateLimitAsync(`webinar-survey-identify:${slug}:${getClientIp(request)}`, { limit: 120, windowMs: 60_000 });
  if (!ipLimit.allowed) return NextResponse.json(limited, { status: 429, headers });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  const phone = typeof body?.phone === "string" ? normalizePhone(body.phone) : null;
  const identity = email && !phone && isValidEmail(email)
    ? { type: "email", value: email } as const
    : phone && !email && isValidPhone(phone) ? { type: "phone", value: phone } as const : null;
  if (!identity) return NextResponse.json({ found: false }, { headers });

  const lookupKey = createHash("sha256").update(JSON.stringify([slug, identity.value])).digest("base64url");
  const lookupLimit = await rateLimitAsync(`webinar-survey-${identity.type}:${lookupKey}`, { limit: 10, windowMs: 600_000 });
  if (!lookupLimit.allowed) return NextResponse.json(limited, { status: 429, headers });

  const survey = await prisma.webinarSurvey.findFirst({
    where: { id: surveyId, webinar: { slug } },
    select: { webinarId: true, isOpen: true, opensAt: true, closesAt: true },
  });
  if (!survey || !isSurveyAcceptingResponses(survey)) {
    return NextResponse.json({ error: "지금은 설문에 응답할 수 없어요." }, { status: 400, headers });
  }

  const select = { id: true } as const;
  const registrations = identity.type === "phone"
    ? await prisma.webinarRegistration.findMany({
      where: { webinarId: survey.webinarId, phone: identity.value }, select, take: 2,
    })
    : [await prisma.webinarRegistration.findFirst({
      where: { webinarId: survey.webinarId, email: { equals: identity.value, mode: "insensitive" } }, select,
    })];
  const registration = registrations.length === 1 ? registrations[0] : null;
  if (!registration) return NextResponse.json({ found: false }, { headers });
  return NextResponse.json({
    found: true,
    ticket: createSurveyTicket(`webinar:${surveyId}`, registration.id, ""),
  }, { headers });
}
