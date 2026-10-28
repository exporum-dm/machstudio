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
import { Prisma } from "@/generated/prisma";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { collectColumnsFor } from "@/lib/collect-columns";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { audienceInsights, buildRegistrationAnalysis, pickAnalysisFields, summarizeAudiences, type AnalysisInput } from "@/lib/registration-analysis";


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
  const { fields, companionKey, visitDateKey, regionKey, textFields } = pickAnalysisFields(collectColumnsFor(source));

  const keys = Array.from(new Set([...fields.map((f) => f.key), ...textFields.map((t) => t.key), companionKey, visitDateKey, regionKey].filter((k): k is string => Boolean(k))));
  const [records, checkIns] = await Promise.all([
    prisma.$queryRaw<{ id: string; registrationNo: string | null; createdAt: Date; utm: string | null; d: Record<string, unknown> | null }[]>(Prisma.sql`
      SELECT id, "registrationNo", "createdAt",
             COALESCE(NULLIF("firstUtmSource", ''), NULLIF("utmSource", '')) AS utm,
             (SELECT jsonb_object_agg(key, value) FROM jsonb_each(data) WHERE key = ANY(${keys})) AS d
        FROM "CollectRecord" WHERE "sourceId" = ${id}`),
    prisma.collectCheckIn.findMany({ where: { sourceId: id }, select: { recordId: true, eventDate: true, scannedAt: true } }),
  ]);

  // 유형(분기 기준) 항목과 그룹별 문항
  const audienceKey = config.branch.enabled && config.branch.fieldKey ? config.branch.fieldKey : fields.find((f) => /visitor_?type|attendee_?type/i.test(f.key))?.key ?? null;
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

  let audiences: { value: string; analysis: ReturnType<typeof buildRegistrationAnalysis> }[] = [];
  if (audienceKey) {
    const audienceField = fields.find((f) => f.key === audienceKey);
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
          // 유형 안에서는 유형 문항 자체는 뺀다(100% 한 값) — 그 유형의 분기 문항을 더한다
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
      audienceRows: summarizeAudiences(audiences),
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
