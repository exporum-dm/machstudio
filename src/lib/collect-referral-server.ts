// 추천 순위 계산(서버 전용) — 공개 순위판·내 순위 검색·관리자 추천 탭이 같은 계산을 쓴다.
// 세 화면이 각자 세면 "관리자 표에서는 3위인데 순위판에서는 4위" 같은 어긋남이 생긴다.

import { prisma } from "@/lib/prisma";
import { normalizeCollectForm, type CollectFormConfig } from "@/lib/collect-form-config";
import { buildTicketView } from "@/lib/collect-lookup";
import { phoneLast4, samePersonName, rankReferrers, referralLabel, type RankedReferrer } from "@/lib/collect-referral";

export interface ReferralSource {
  id: string;
  name: string;
  config: CollectFormConfig;
}

export interface AdminReferrer extends RankedReferrer {
  name: string;
  phone: string;
  email: string;
  registrationNo: string | null;
}

/** 추천이 켜진 빌더형 폼만. 꺼져 있거나 지워졌으면 null(순위판도 404). */
export async function loadReferralSource(sourceId: string): Promise<ReferralSource | null> {
  const source = await prisma.collectSource.findUnique({
    where: { id: sourceId },
    select: { id: true, name: true, mode: true, deletedAt: true, formConfig: true },
  });
  if (!source || source.deletedAt || source.mode !== "builder") return null;
  const config = normalizeCollectForm(source.formConfig);
  if (!config.referral.enabled) return null;
  return { id: source.id, name: source.name, config };
}

function contactOf(config: CollectFormConfig, record: { data: unknown; phoneE164: string | null }) {
  const data = (record.data && typeof record.data === "object" ? record.data : {}) as Record<string, unknown>;
  const pick = (type: string) => {
    const field = config.fields.find((f) => f.type === type);
    const v = field ? data[field.key] : undefined;
    return typeof v === "string" ? v.trim() : "";
  };
  return { phone: record.phoneE164 ?? pick("tel"), email: pick("email") };
}

/** 추천한 사람 전원의 순위. 관리자 화면용으로 이름·연락처도 함께 준다(공개 화면은 label 만 쓴다). */
export async function loadReferralRanking(source: ReferralSource): Promise<{ ranked: AdminReferrer[]; referredTotal: number }> {
  const groups = await prisma.collectRecord.groupBy({
    by: ["referredById"],
    where: { sourceId: source.id, referredById: { not: null } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const ids = groups.map((g) => g.referredById).filter((v): v is string => Boolean(v));
  const records = ids.length
    ? await prisma.collectRecord.findMany({
        where: { id: { in: ids }, sourceId: source.id },
        select: { id: true, data: true, phoneE164: true, registrationNo: true },
      })
    : [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const people = new Map<string, { name: string; phone: string; email: string; registrationNo: string | null }>();
  const rows = groups.flatMap((g) => {
    const record = g.referredById ? byId.get(g.referredById) : undefined;
    if (!record) return []; // 추천인이 지워졌다(관계는 SET NULL 이라 보통 여기 오지 않는다)
    const name = buildTicketView(source.config, { registrationNo: record.registrationNo ?? "-", data: record.data })?.name ?? "";
    const contact = contactOf(source.config, record);
    people.set(record.id, { name, ...contact, registrationNo: record.registrationNo });
    return [{
      recordId: record.id,
      count: g._count._all,
      label: referralLabel(name, contact.phone),
      lastReferredAt: g._max.createdAt?.getTime() ?? 0,
    }];
  });
  const ranked = rankReferrers(rows, source.config.referral).map((r) => ({ ...r, ...people.get(r.recordId)! }));
  return { ranked, referredTotal: ranked.reduce((sum, r) => sum + r.count, 0) };
}

/**
 * 내 순위 찾기 — 이름 전체(띄어쓰기·성과 이름 순서 무관) + 연락처 뒤 4자리가 **둘 다** 맞아야 찾아진다.
 * 이름표("이*환 · 1198")만으로는 남의 순위를 골라 볼 수 없게 하려는 것이다.
 */
export async function findMyReferralRank(
  source: ReferralSource,
  ranked: AdminReferrer[],
  query: { name: string; last4: string },
): Promise<{ registered: boolean; me: RankedReferrer | null }> {
  const wantName = query.name.trim();
  const last4 = query.last4.replace(/\D/g, "");
  if (!wantName || last4.length !== 4) return { registered: false, me: null };
  const hit = ranked.find((r) => samePersonName(r.name, wantName) && phoneLast4(r.phone) === last4);
  if (hit) {
    const { recordId, rank, count, label, rewarded } = hit;
    return { registered: true, me: { recordId, rank, count, label, rewarded } };
  }
  // 아직 아무도 데려오지 않은 등록자인지 — 연락처 뒷자리로 좁힌 뒤 이름을 맞춰 본다.
  const candidates = await prisma.collectRecord.findMany({
    where: { sourceId: source.id, phoneE164: { endsWith: last4 } },
    select: { data: true, registrationNo: true },
    take: 200,
  });
  const registered = candidates.some(
    (c) => samePersonName(buildTicketView(source.config, { registrationNo: c.registrationNo ?? "-", data: c.data })?.name ?? "", wantName),
  );
  return { registered, me: null };
}
