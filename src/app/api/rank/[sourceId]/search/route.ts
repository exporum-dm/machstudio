/**
 * 공개 추천 순위판의 "내 순위 찾기" — 이름 전체 + 연락처 뒤 4자리가 둘 다 맞아야 답한다.
 * 이름표만 아는 남이 다른 사람의 순위를 골라 보지 못하게, 그리고 연락처 뒷자리를 하나씩
 * 대입해 보는 일을 막으려고 IP 당 분당 횟수를 묶는다.
 */
import { NextResponse } from "next/server";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { findMyReferralRank, loadReferralRanking, loadReferralSource } from "@/lib/collect-referral-server";

export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const ip = getClientIp(request);
  const { allowed } = await rateLimitAsync(`referral-search:${ip}:${sourceId}`, { limit: 10, windowMs: 60_000 });
  if (!allowed) return NextResponse.json({ error: "too_many" }, { status: 429 });

  const source = await loadReferralSource(sourceId);
  if (!source) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(request.url);
  const name = (url.searchParams.get("name") ?? "").slice(0, 100);
  const last4 = (url.searchParams.get("last4") ?? "").slice(0, 8);
  const { ranked } = await loadReferralRanking(source);
  const result = await findMyReferralRank(source, ranked, { name, last4 });
  // recordId 는 내보내지 않는다 — 공개 화면에는 순위·인원·이름표만.
  return NextResponse.json({
    registered: result.registered,
    me: result.me ? { rank: result.me.rank, count: result.me.count, label: result.me.label, rewarded: result.me.rewarded } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
