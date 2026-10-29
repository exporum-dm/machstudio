import "server-only";

/**
 * 등록 결과 분석 로더 — "결과 분석" API(route.ts)와 만족도 조사 AI 해석(survey-ai route.ts)이
 * **같은 숫자**를 쓰게 한다. 전자는 화면에 바로 쓰고, 후자는 AI 에게 맥락으로 준다 — 정의가
 * 둘로 갈리면 "화면은 A 라는데 AI 는 B 라고 한다" 는 신뢰도 문제가 생긴다.
 */
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { collectColumnsFor } from "@/lib/collect-columns";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import {
  audienceInsights,
  buildRegistrationAnalysis,
  pickAnalysisFields,
  summarizeAudiences,
  type AnalysisInput,
  type AudienceRow,
  type RegistrationAnalysis,
} from "@/lib/registration-analysis";

export interface CollectAnalysisBundle {
  analysis: RegistrationAnalysis;
  audiences: { value: string; analysis: RegistrationAnalysis }[];
  audienceRows: AudienceRow[];
  audienceKey: string | null;
  audienceLabel: string;
  companionKey: string | null;
  visitDateKey: string | null;
  regionKey: string | null;
}

export async function loadCollectAnalysis(source: {
  id: string;
  mode: string;
  formConfig: unknown;
  checkinTimezone: string;
}): Promise<CollectAnalysisBundle> {
  const config = normalizeCollectForm(source.formConfig);
  const { fields, companionKey, visitDateKey, regionKey, textFields } = pickAnalysisFields(collectColumnsFor(source));

  const keys = Array.from(new Set([...fields.map((f) => f.key), ...textFields.map((t) => t.key), companionKey, visitDateKey, regionKey].filter((k): k is string => Boolean(k))));
  const [records, checkIns] = await Promise.all([
    prisma.$queryRaw<{ id: string; registrationNo: string | null; createdAt: Date; utm: string | null; d: Record<string, unknown> | null }[]>(Prisma.sql`
      SELECT id, "registrationNo", "createdAt",
             COALESCE(NULLIF("firstUtmSource", ''), NULLIF("utmSource", '')) AS utm,
             (SELECT jsonb_object_agg(key, value) FROM jsonb_each(data) WHERE key = ANY(${keys})) AS d
        FROM "CollectRecord" WHERE "sourceId" = ${source.id}`),
    prisma.collectCheckIn.findMany({ where: { sourceId: source.id }, select: { recordId: true, eventDate: true, scannedAt: true } }),
  ]);

  const audienceKey = config.branch.enabled && config.branch.fieldKey ? config.branch.fieldKey : fields.find((f) => /visitor_?type|attendee_?type/i.test(f.key))?.key ?? null;
  const audienceField = fields.find((f) => f.key === audienceKey);
  const groupKeys = new Map(config.branch.enabled ? config.branch.groups.map((g) => [g.value.trim(), new Set(g.fields.map((gf) => gf.key))]) : []);
  const branchOnly = new Set([...groupKeys.values()].flatMap((set) => [...set]));
  const commonFields = fields.filter((f) => !branchOnly.has(f.key));
  const commonText = textFields.filter((t) => !branchOnly.has(t.key));

  const all = records.map((r) => ({ id: r.id, registrationNo: r.registrationNo, createdAt: r.createdAt, data: r.d ?? {}, utmSource: r.utm }));
  const base: Omit<AnalysisInput, "fields" | "records" | "checkIns"> = {
    timezone: source.checkinTimezone,
    eventDates: config.eventInfo.eventDates,
    onsiteFrom: null,
    companionKey,
    visitDateKey,
    regionKey,
  };
  const analysis = buildRegistrationAnalysis({ ...base, fields: commonFields, textFields: commonText, records: all, checkIns });

  let audiences: { value: string; analysis: RegistrationAnalysis }[] = [];
  if (audienceKey) {
    const byValue = new Map<string, typeof all>();
    for (const r of all) {
      const v = String(r.data[audienceKey] ?? "").trim() || "(미응답)";
      const list = byValue.get(v) ?? [];
      list.push(r);
      byValue.set(v, list);
    }
    const order = audienceField?.options.map((o) => o.trim()) ?? [];
    const values = [...byValue.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || (byValue.get(b)!.length - byValue.get(a)!.length));
    audiences = values.map((value) => {
      const recs = byValue.get(value)!;
      const ids = new Set(recs.map((r) => r.id));
      const own = groupKeys.get(value);
      return {
        value,
        analysis: buildRegistrationAnalysis({
          ...base,
          fields: [...commonFields.filter((f) => f.key !== audienceKey), ...fields.filter((f) => own?.has(f.key))],
          textFields: [...commonText, ...textFields.filter((t) => own?.has(t.key))],
          records: recs,
          checkIns: checkIns.filter((c) => ids.has(c.recordId)),
        }),
      };
    });
    const rows = summarizeAudiences(audiences);
    analysis.insights.splice(2, 0, ...audienceInsights(rows, audienceField?.label ?? "유형"));
  }

  return {
    analysis,
    audiences,
    audienceRows: summarizeAudiences(audiences),
    audienceKey,
    audienceLabel: audienceField?.label ?? "유형",
    companionKey,
    visitDateKey,
    regionKey,
  };
}
