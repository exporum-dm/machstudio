/**
 * 만족도 조사 — GET 설정 · PATCH { name?, status?, token?, config? }
 * token 은 인쇄된 QR 이 가리키는 주소다 — 바꿀 수는 있지만 화면이 경고한다.
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { localize, normalizeCollectForm } from "@/lib/collect-form-config";
import { isSurveyStatus, linkedQuestionType, normalizeSurveyConfig, registrationFields } from "@/lib/survey-config";
import { authorizeSurvey } from "@/lib/survey-access";

export async function GET(_req: Request, { params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  const auth = await authorizeSurvey(surveyId);
  if ("error" in auth) return auth.error;
  const { survey } = auth;
  // 설계 화면이 "등록 폼 항목 연결" 목록을 그린다 — 질문·선택지는 등록 폼이 원본이다.
  const source = await prisma.collectSource.findUnique({ where: { id: survey.sourceId }, select: { formConfig: true } });
  const form = normalizeCollectForm(source?.formConfig);
  const fields = registrationFields(form)
    .filter((f) => linkedQuestionType(f))
    .map((f) => ({ key: f.key, label: localize(f.label, form.defaultLocale) || f.key, type: linkedQuestionType(f), group: f.group, options: f.options.length, required: f.required }));
  return NextResponse.json({ survey: { ...survey, config: normalizeSurveyConfig(survey.config) }, registrationFields: fields });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  const auth = await authorizeSurvey(surveyId);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const data: Prisma.SurveyUpdateInput = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 120);
  if (isSurveyStatus(body.status)) data.status = body.status;
  if (typeof body.token === "string") {
    const token = body.token.trim();
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(token)) return NextResponse.json({ error: "주소는 영문·숫자·-·_ 3~64자로 해 주세요" }, { status: 400 });
    const taken = await prisma.survey.findFirst({ where: { token, NOT: { id: surveyId } }, select: { id: true } });
    if (taken) return NextResponse.json({ error: "이미 쓰는 주소예요" }, { status: 409 });
    data.token = token;
  }
  if (body.config !== undefined) data.config = normalizeSurveyConfig(body.config) as unknown as Prisma.InputJsonValue;
  const survey = await prisma.survey.update({
    where: { id: surveyId },
    data,
    select: { id: true, name: true, token: true, status: true, config: true, updatedAt: true },
  });
  return NextResponse.json({ survey: { ...survey, config: normalizeSurveyConfig(survey.config) } });
}
