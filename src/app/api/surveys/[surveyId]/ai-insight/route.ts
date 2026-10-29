/**
 * 만족도 조사 AI 해석 — POST, 만족도 조사 탭 "AI로 해석하기"에서만 호출(눌렀을 때만 돈다).
 * 결과는 Survey.aiSummary/aiInsights 에 저장한다 — 결과 분석 탭은 이걸 그대로 읽어서 보여준다
 * (다시 해석하지 않는다). 다시 해석하려면 여기서 또 누르면 된다.
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { loadCollectAnalysis } from "@/lib/collect-registration-loader";
import { authorizeSurvey } from "@/lib/survey-access";
import { normalizeSurveyConfig, resolveLinkedQuestions } from "@/lib/survey-config";
import { interpretSurveyWithAi, surveyAiAvailable, type SurveyAiResponse } from "@/lib/survey-ai-insight";

export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  const auth = await authorizeSurvey(surveyId);
  if ("error" in auth) return auth.error;
  if (!surveyAiAvailable()) return NextResponse.json({ error: "AI 해석은 Vercel 환경 변수 ANTHROPIC_API_KEY 를 넣으면 켜져요" }, { status: 501 });

  const source = await prisma.collectSource.findUnique({ where: { id: auth.survey.sourceId } });
  if (!source) return NextResponse.json({ error: "연결된 등록 폼을 찾을 수 없어요" }, { status: 404 });

  const form = normalizeCollectForm(source.formConfig);
  const surveyConfig = resolveLinkedQuestions(normalizeSurveyConfig(auth.survey.config), form);
  const [{ analysis, audienceRows }, responses] = await Promise.all([
    loadCollectAnalysis(source),
    prisma.surveyResponse.findMany({ where: { surveyId }, select: { answers: true, recordId: true, audience: true, channel: true } }),
  ]);

  try {
    const result = await interpretSurveyWithAi({
      surveyName: auth.survey.name,
      registrantsTotal: analysis.kpi.registrations.total,
      config: surveyConfig,
      responses: responses as SurveyAiResponse[],
      audienceRows,
      registrationInsights: analysis.insights,
    });
    const aiGeneratedAt = new Date();
    await prisma.survey.update({
      where: { id: surveyId },
      data: { aiSummary: result.summary, aiInsights: result.insights as unknown as Prisma.InputJsonValue, aiGeneratedAt },
    });
    return NextResponse.json({ ...result, generatedAt: aiGeneratedAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 가 해석을 쓰지 못했어요" }, { status: 502 });
  }
}
