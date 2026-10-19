/**
 * 만족도 조사 본인 확인 — POST /api/q/{token}/identify { email? | phone? }
 *
 * 등록 확인(/api/collect/{id}/lookup)과 같은 규칙:
 *  · IP 와 입력값 양쪽에 한도 · 못 찾으면 이유 없이 found:false 하나로 끝 · 이메일 먼저, 전화는 한 명만 맞을 때
 *  · 돌려주는 건 부를 이름·유형·이미 응답했는지(+ 그 답)·응답 티켓뿐 — 연락처·다른 등록 답은 주지 않는다
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { buildLookupCriteria } from "@/lib/collect-lookup";
import { greetingName, loadPublicSurvey } from "@/lib/survey-server";
import { createSurveyTicket } from "@/lib/survey-ticket";

const valueKey = (kind: string, id: string, value: string) =>
  `survey-id-${kind}:${createHash("sha256").update(`${id}|${value}`).digest("base64url").slice(0, 22)}`;

const TOO_MANY = { error: "Too many attempts. Please try again shortly." };

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ipRl = await rateLimitAsync(`survey-id-ip:${getClientIp(request)}`, { limit: 120, windowMs: 60_000 });
  if (!ipRl.allowed) return NextResponse.json(TOO_MANY, { status: 429 });

  const survey = await loadPublicSurvey(token);
  if (!survey) return NextResponse.json({ found: false });
  const body = await request.json().catch(() => ({}));

  const config = {
    ...survey.formConfig,
    lookup: { ...survey.formConfig.lookup, enabled: true, fields: survey.config.identifyFields, logic: "or" as const },
  };
  const criteria = buildLookupCriteria(config, body);
  if (!criteria) return NextResponse.json({ found: false });
  for (const [kind, value] of [["e", criteria.emailNormalized], ["p", criteria.phoneE164]] as const) {
    if (!value) continue;
    const rl = await rateLimitAsync(valueKey(kind, survey.id, value), { limit: 10, windowMs: 10 * 60_000 });
    if (!rl.allowed) return NextResponse.json(TOO_MANY, { status: 429 });
  }

  const SELECT = { id: true, data: true } as const;
  let record: { id: string; data: unknown } | null = null;
  if (criteria.emailNormalized) {
    record = await prisma.collectRecord.findFirst({ where: { sourceId: survey.sourceId, emailNormalized: criteria.emailNormalized }, select: SELECT });
  }
  if (!record && criteria.phoneE164) {
    // 같은 번호가 여럿이면 못 찾은 것으로 — 아무나 고르면 남의 이름으로 응답이 들어간다.
    const byPhone = await prisma.collectRecord.findMany({ where: { sourceId: survey.sourceId, phoneE164: criteria.phoneE164 }, select: SELECT, take: 2 });
    record = byPhone.length === 1 ? byPhone[0] : null;
  }
  if (!record) return NextResponse.json({ found: false });

  const key = survey.config.audienceFieldKey;
  const rawAudience = key ? (record.data as Record<string, unknown>)?.[key] : "";
  const audience = typeof rawAudience === "string" ? rawAudience : Array.isArray(rawAudience) ? String(rawAudience[0] ?? "") : "";
  const previous = await prisma.surveyResponse.findUnique({
    where: { surveyId_recordId: { surveyId: survey.id, recordId: record.id } },
    select: { answers: true },
  });
  return NextResponse.json({
    found: true,
    name: greetingName(record.data),
    audience,
    answered: !!previous,
    previous: previous?.answers ?? null,
    ticket: createSurveyTicket(survey.id, record.id, audience),
  });
}
