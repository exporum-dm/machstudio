/**
 * 만족도 조사 결과 — GET [?audience=][&by=등록항목key][&format=xlsx]
 *
 *  - 문항별 집계(평균·NPS·분포·의견) — audience 로 유형 하나만 볼 수 있다
 *  - 등록 정보로 나눠 보기(by): 점수 문항(scale·nps)의 평균을 등록 항목 값(유형·성별·연령…)별로.
 *    조사에 인구통계 문항이 없어도 되는 이유가 이것이다.
 *  - xlsx: 응답 한 줄 = 등록 정보 열 + 문항 열
 */
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { localize, normalizeCollectForm } from "@/lib/collect-form-config";
import { answerText, normalizeSurveyConfig, resolveLinkedQuestions, summarizeSurvey, type SurveyAnswerMap } from "@/lib/survey-config";
import { authorizeSurvey } from "@/lib/survey-access";

export async function GET(request: Request, { params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  const auth = await authorizeSurvey(surveyId);
  if ("error" in auth) return auth.error;
  const { searchParams } = new URL(request.url);
  const source = await prisma.collectSource.findUnique({ where: { id: auth.survey.sourceId }, select: { formConfig: true, name: true } });
  const form = normalizeCollectForm(source?.formConfig);
  const config = resolveLinkedQuestions(normalizeSurveyConfig(auth.survey.config), form);
  const locale = config.defaultLocale;

  const responses = await prisma.surveyResponse.findMany({
    where: { surveyId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, audience: true, answers: true, channel: true, createdAt: true, updatedAt: true, recordId: true,
      record: { select: { data: true, registrationNo: true, emailNormalized: true } },
    },
  });

  // 등록 폼 항목 — 나눠 보기·엑셀 열에 쓴다(유형 분기 그룹 항목까지).
  const regFields = [...form.fields.filter((f) => f.enabled), ...form.branch.groups.flatMap((g) => g.fields.filter((f) => f.enabled))];
  const seenKeys = new Set<string>();
  const regColumns = regFields.filter((f) => !seenKeys.has(f.key) && !!seenKeys.add(f.key));
  const questions = [...config.walkIn.questions, ...config.sections.flatMap((s) => s.questions)];

  if (searchParams.get("format") === "xlsx") {
    const header = ["응답 일시", "경로", "유형", "등록 여부", "등록번호", ...regColumns.map((f) => localize(f.label, form.defaultLocale) || f.key), ...questions.map((q) => localize(q.title, locale) || q.key)];
    const rows = responses.map((r) => {
      const data = (r.record?.data ?? {}) as Record<string, unknown>;
      const answers = (r.answers ?? {}) as SurveyAnswerMap;
      return [
        new Date(r.updatedAt).toISOString().replace("T", " ").slice(0, 16),
        r.channel,
        config.audienceLabels[r.audience] ?? r.audience,
        r.recordId ? "사전등록" : "등록 없이",
        r.record?.registrationNo ?? "",
        // 등록 없이 참여한 사람은 등록 폼과 같은 key 로 답했다 — 같은 열에 넣는다.
        ...regColumns.map((f) => { const v = r.recordId ? data[f.key] : answers[f.key]; return Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v); }),
        ...questions.map((q) => answerText(q, answers[q.key], locale)),
      ];
    });
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "응답");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const filename = `${auth.survey.name}_응답_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  }

  const audience = searchParams.get("audience") ?? "";
  const filtered = audience ? responses.filter((r) => r.audience === audience) : responses;
  const countBy = (pick: (r: (typeof responses)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of responses) m.set(pick(r), (m.get(pick(r)) ?? 0) + 1);
    return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  };

  // 등록 정보로 나눠 보기 — 선택지가 있는 등록 항목만(자유 입력은 값이 흩어져 의미가 없다).
  const segmentable = regColumns.filter((f) => f.options.length > 0).map((f) => ({ key: f.key, label: localize(f.label, form.defaultLocale) || f.key }));
  const by = searchParams.get("by") || config.audienceFieldKey || segmentable[0]?.key || "";
  const scoreQuestions = questions.filter((q) => q.type === "scale" || q.type === "nps");
  const segMap = new Map<string, typeof filtered>();
  for (const r of filtered) {
    // 등록자는 등록 정보, 등록 없이 참여한 사람은 같은 key 로 받은 답 — 같은 조건으로 받았으니 한 표에 합친다.
    const raw = r.record ? (r.record.data as Record<string, unknown>)?.[by] : (r.answers as Record<string, unknown>)?.[by];
    if (!r.record && raw === undefined) continue;
    for (const v of Array.isArray(raw) ? raw : [raw]) {
      const key = v == null || v === "" ? "(빈 값)" : String(v);
      segMap.set(key, [...(segMap.get(key) ?? []), r]);
    }
  }
  const segments = [...segMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([value, rs]) => ({
      value,
      count: rs.length,
      scores: scoreQuestions.map((q) => {
        const nums = rs.map((r) => Number((r.answers as SurveyAnswerMap)?.[q.key])).filter((n) => Number.isFinite(n));
        if (!nums.length) return { key: q.key, average: null, nps: null };
        const avg = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
        const nps = q.type === "nps" ? Math.round(((nums.filter((n) => n >= 9).length - nums.filter((n) => n <= 6).length) / nums.length) * 100) : null;
        return { key: q.key, average: avg, nps };
      }),
    }));

  return NextResponse.json({
    total: responses.length,
    registered: responses.filter((r) => r.recordId).length,
    byAudience: countBy((r) => r.audience || "(없음)"),
    byChannel: countBy((r) => r.channel || "direct"),
    summaries: summarizeSurvey(config, filtered),
    segmentable,
    by,
    scoreQuestions: scoreQuestions.map((q) => ({ key: q.key, type: q.type, title: localize(q.title, locale) })),
    segments,
    lastAt: responses[0]?.updatedAt ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
