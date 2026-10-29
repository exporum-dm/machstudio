/**
 * 만족도 조사 AI 해석 — POST, 눌렀을 때만 돈다(worklog AI 다듬기와 같은 패턴).
 * 결과는 저장하지 않는다 — 등록·응답이 계속 쌓이므로 매번 새로 해석해야 한다.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { loadCollectAnalysis } from "@/lib/collect-registration-loader";
import { normalizeSurveyConfig, resolveLinkedQuestions } from "@/lib/survey-config";
import { interpretSurveyWithAi, surveyAiAvailable, type SurveyAiResponse } from "@/lib/survey-ai-insight";

export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const source = await prisma.collectSource.findUnique({ where: { id } });
  if (!source || source.deletedAt) return NextResponse.json({ error: "소스를 찾을 수 없어요" }, { status: 404 });
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: source.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });
  if (source.mode !== "builder") return NextResponse.json({ error: "빌더형 등록에서만 볼 수 있어요" }, { status: 400 });
  if (!surveyAiAvailable()) return NextResponse.json({ error: "AI 해석은 Vercel 환경 변수 ANTHROPIC_API_KEY 를 넣으면 켜져요" }, { status: 501 });

  // 한 소스에 조사가 여럿이면 가장 먼저 만든 것 하나를 해석한다(실제로는 거의 항상 1개).
  const survey = await prisma.survey.findFirst({ where: { sourceId: id }, orderBy: { createdAt: "asc" } });
  if (!survey) return NextResponse.json({ error: "연결된 만족도 조사가 없어요" }, { status: 404 });

  const form = normalizeCollectForm(source.formConfig);
  const surveyConfig = resolveLinkedQuestions(normalizeSurveyConfig(survey.config), form);
  const [{ analysis, audienceRows }, responses] = await Promise.all([
    loadCollectAnalysis(source),
    prisma.surveyResponse.findMany({ where: { surveyId: survey.id }, select: { answers: true, recordId: true, audience: true, channel: true } }),
  ]);

  try {
    const result = await interpretSurveyWithAi({
      surveyName: survey.name,
      registrantsTotal: analysis.kpi.registrations.total,
      config: surveyConfig,
      responses: responses as SurveyAiResponse[],
      audienceRows,
      registrationInsights: analysis.insights,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 가 해석을 쓰지 못했어요" }, { status: 502 });
  }
}
