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

/**
 * 저장할 설정 — 들어온 문항에 linkKey 칸 자체가 없으면(연결 기능 전의 화면이 자동 저장한 것) 기존 연결을 지킨다.
 * 배포 직후 열려 있던 설계 화면이 연결 표시를 지워 버려 공개 화면의 등록 폼 문항이 비었던 일(2026-10-20) 때문.
 */
function keepLinks(incoming: unknown, stored: unknown) {
  const prev = new Map<string, string>();
  const st = normalizeSurveyConfig(stored);
  for (const q of [...st.walkIn.questions, ...st.sections.flatMap((s) => s.questions)]) if (q.linkKey) prev.set(q.key, q.linkKey);
  const raw = (incoming && typeof incoming === "object" ? incoming : {}) as { walkIn?: { questions?: unknown[] }; sections?: Array<{ questions?: unknown[] }> };
  const patch = (qs: unknown[] | undefined) => (qs ?? []).map((q) => {
    const o = (q ?? {}) as Record<string, unknown>;
    return !("linkKey" in o) && typeof o.key === "string" && prev.has(o.key) ? { ...o, linkKey: prev.get(o.key) } : o;
  });
  return normalizeSurveyConfig({
    ...raw,
    walkIn: raw.walkIn ? { ...raw.walkIn, questions: patch(raw.walkIn.questions) } : raw.walkIn,
    sections: Array.isArray(raw.sections) ? raw.sections.map((s) => ({ ...s, questions: patch(s?.questions) })) : raw.sections,
  });
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
  if (body.config !== undefined) data.config = keepLinks(body.config, auth.survey.config) as unknown as Prisma.InputJsonValue;
  const survey = await prisma.survey.update({
    where: { id: surveyId },
    data,
    select: { id: true, name: true, token: true, status: true, config: true, updatedAt: true },
  });
  return NextResponse.json({ survey: { ...survey, config: normalizeSurveyConfig(survey.config) } });
}
