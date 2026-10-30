/**
 * 등록 결과 분석 — 등록 상세의 "결과 분석" 탭(빌더형 전용). 읽기만 한다.
 *
 * 숫자는 lib/registration-analysis.ts 가 만든다. 여기서는 레코드에서 **분석에 쓰는 항목만** 골라
 * 읽는다(이메일·전화·이름은 DB 에서 꺼내지도 않는다 — 2만 건이 넘어 전송량도 아낀다).
 *
 * 전체 + 유형별(분기 기준 항목 — LA 는 visitor_type: General·Buyer·Press)을 함께 낸다.
 * 분기 문항(바이어 전용 등)은 그 유형 분석에만 넣는다 — 전체에 섞으면 분모가 달라 읽기 어렵다.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { loadCollectAnalysis } from "@/lib/collect-registration-loader";
import { normalizeSurveyConfig, resolveLinkedQuestions, surveyInsights } from "@/lib/survey-config";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const config = normalizeCollectForm(source.formConfig);
  const { analysis, audiences, audienceRows, audienceKey, companionKey, visitDateKey, regionKey } = await loadCollectAnalysis(source);

  /**
   * 연결된 만족도 조사 — 문항별 결과(분포·평균·NPS)는 만족도 조사 탭에 이미 있다. 여기서는
   * 그 숫자를 다시 보여주지 않는다 — **등록 분석과 교차해야만 나오는 해석**만 insights 에 더한다
   * (유형별 격차·사전등록자 vs 워크인·응답률 신뢰도). 한 등록 소스에 조사가 0·1·N개일 수 있다.
   */
  const audienceVisitRate = audienceKey
    ? Object.fromEntries(audienceRows.map((r) => [r.value, r.showUpPre.rate]))
    : undefined;
  const surveyRows = await prisma.survey.findMany({
    where: { sourceId: id },
    select: { id: true, name: true, config: true },
    orderBy: { createdAt: "asc" },
  });
  for (const s of surveyRows) {
    const surveyConfig = resolveLinkedQuestions(normalizeSurveyConfig(s.config), config);
    const responses = await prisma.surveyResponse.findMany({ where: { surveyId: s.id }, select: { answers: true, recordId: true, audience: true } });
    analysis.insights.push(...surveyInsights({
      surveyName: s.name,
      registrantsTotal: analysis.kpi.registrations.total,
      config: surveyConfig,
      responses,
      audienceVisitRate,
    }));
  }

  // 행사 운영 시간(개최일별 개장·마감 중 가장 이른·늦은 시) — 시간대별 그래프 가로축을 마감까지 그린다
  const hourOf = (v: string) => (/^\d{1,2}:\d{2}$/.test(v) ? Number(v.split(":")[0]) : NaN);
  const opens = config.eventInfo.openingHours.map((h) => hourOf(h.open)).filter(Number.isFinite);
  const closes = config.eventInfo.openingHours.map((h) => hourOf(h.close)).filter(Number.isFinite);
  const hours = { open: opens.length ? Math.min(...opens) : null, close: closes.length ? Math.max(...closes) : null };

  return NextResponse.json(
    {
      sourceName: source.name,
      generatedAt: new Date().toISOString(),
      fields: { companionKey, visitDateKey, regionKey, audienceKey },
      hours,
      analysis,
      audiences,
      audienceRows,
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
