/**
 * 만족도 조사 공개 설정 — GET /api/q/{token}[?preview=1]
 * 작성 중(draft) 조사는 preview=1 일 때만 보인다(운영자 미리보기). 닫힌 조사는 닫혔다는 것만.
 */
import { NextResponse } from "next/server";
import { loadPublicSurvey } from "@/lib/survey-server";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const survey = await loadPublicSurvey(token);
  if (!survey || (survey.status === "draft" && !preview)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { config } = survey;
  return NextResponse.json(
    {
      status: survey.status,
      config: {
        title: config.title,
        intro: config.intro,
        identifyFields: config.identifyFields,
        audienceFieldKey: config.audienceFieldKey,
        audienceLabels: config.audienceLabels,
        allowWalkIn: config.allowWalkIn,
        walkIn: config.walkIn,
        sections: config.sections,
        completion: config.completion,
        privacyNote: config.privacyNote,
        accentColor: config.accentColor,
        defaultLocale: config.defaultLocale,
        defaultCountry: survey.formConfig.validation.defaultCountry,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
