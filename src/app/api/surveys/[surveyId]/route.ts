/**
 * 만족도 조사 — GET 설정 · PATCH { name?, status?, token?, config? }
 * token 은 인쇄된 QR 이 가리키는 주소다 — 바꿀 수는 있지만 화면이 경고한다.
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { isSurveyStatus, normalizeSurveyConfig } from "@/lib/survey-config";
import { authorizeSurvey } from "@/lib/survey-access";

export async function GET(_req: Request, { params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  const auth = await authorizeSurvey(surveyId);
  if ("error" in auth) return auth.error;
  const { survey } = auth;
  return NextResponse.json({ survey: { ...survey, config: normalizeSurveyConfig(survey.config) } });
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
