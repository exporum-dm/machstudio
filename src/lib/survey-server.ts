import "server-only";
/** 만족도 조사 공개 API 공용 — 토큰으로 조사·연결된 등록 폼을 읽는다. */
import { prisma } from "@/lib/prisma";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { normalizeSurveyConfig, resolveLinkedQuestions } from "@/lib/survey-config";

export async function loadPublicSurvey(token: string) {
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(token)) return null;
  const survey = await prisma.survey.findUnique({
    where: { token },
    select: { id: true, name: true, status: true, config: true, sourceId: true, source: { select: { id: true, formConfig: true, deletedAt: true } } },
  });
  if (!survey || survey.source.deletedAt) return null;
  const formConfig = normalizeCollectForm(survey.source.formConfig);
  return {
    id: survey.id,
    name: survey.name,
    status: survey.status,
    sourceId: survey.sourceId,
    // 등록 폼 연결 문항은 여기서 채운다 — 공개 화면과 제출 검증이 같은 문항을 본다.
    config: resolveLinkedQuestions(normalizeSurveyConfig(survey.config), formConfig),
    formConfig,
  };
}

/** 등록 정보에서 부를 이름 — first_name → name → 비움. */
export function greetingName(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>;
  for (const k of ["first_name", "firstName", "name", "full_name"]) {
    if (typeof d[k] === "string" && d[k]) return String(d[k]).trim().split(/\s+/)[0].slice(0, 40);
  }
  return "";
}
