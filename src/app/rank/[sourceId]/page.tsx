/**
 * 공개 친구 초대 순위판 — 등록 완료 화면의 "추천 순위 보기"로 들어온다.
 *
 * - 상위 30명만 그리고, 아래로 갈수록 옅어지다 사라진다(그 아래는 "내 순위 찾기"로).
 * - 이름은 가린 이름표("이*환 · 1198")만 쓴다 — 이름·연락처 원문은 이 페이지로 내려오지 않는다.
 * - 순위는 등록할 때마다 바뀌므로 캐시하지 않는다.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadReferralRanking, loadReferralSource } from "@/lib/collect-referral-server";
import { localize } from "@/lib/collect-form-config";
import { rewardRuleLabel } from "@/lib/collect-referral";
import { fill, referralBoardCopy } from "@/lib/collect-referral-copy";
import { RankSearch } from "./RankSearch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** 화면에 그리는 줄 수 */
const SHOWN = 30;
/** 이 순위부터 옅어지기 시작한다 */
const FADE_FROM = 20;

export default async function ReferralBoardPage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const source = await loadReferralSource(sourceId);
  if (!source) notFound();
  const { ranked, referredTotal } = await loadReferralRanking(source);
  const locale = source.config.defaultLocale;
  const T = referralBoardCopy(locale);
  const eventName = source.config.legal.eventName || source.name;
  const note = localize(source.config.referral.rewardNote, locale) || rewardRuleLabel(source.config.referral);
  const accent = source.config.theme.accentColor || "#4f46e5";
  const rows = ranked.slice(0, SHOWN);

  return (
    <div className="min-h-dvh bg-neutral-50 px-4 py-8 text-neutral-900" style={{ colorScheme: "light" }}>
      <main className="mx-auto max-w-lg">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">{eventName}</p>
        <h1 className="mt-1 text-2xl font-bold">{T.title}</h1>
        <p className="mt-1 text-sm text-neutral-500">{T.subtitle}</p>
        {note && (
          <p className="mt-3 rounded-xl px-3.5 py-2.5 text-sm font-medium" style={{ background: `color-mix(in srgb, ${accent} 10%, white)`, color: accent }}>
            {note}
          </p>
        )}

        <RankSearch sourceId={source.id} copy={T} accent={accent} />

        <section className="mt-6">
          <div className="flex items-baseline justify-between text-xs text-neutral-400">
            <span>{fill(T.totals, { a: ranked.length.toLocaleString(), b: referredTotal.toLocaleString() })}</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              {T.updated}
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-white px-4 py-10 text-center text-sm text-neutral-500 shadow-sm">{T.empty}</p>
          ) : (
            <div className="relative mt-3">
              <ol className="overflow-hidden rounded-2xl bg-white shadow-sm">
                {rows.map((row, index) => {
                  // 20위부터 30위까지 점점 옅어진다 — 아래 순위는 검색으로 본다.
                  const fade = index + 1 > FADE_FROM ? Math.max(0.15, 1 - (index + 1 - FADE_FROM) / (SHOWN - FADE_FROM + 1)) : 1;
                  return (
                    <li
                      key={row.recordId}
                      className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0"
                      style={{ opacity: fade }}
                    >
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums"
                        style={row.rank <= 3 ? { background: accent, color: "#fff" } : { background: "#f4f4f5", color: "#52525b" }}
                      >
                        {row.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.label}</span>
                      {row.rewarded && (
                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${accent} 12%, white)`, color: accent }}>
                          {T.rewarded}
                        </span>
                      )}
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{fill(T.people, { n: row.count.toLocaleString() })}</span>
                    </li>
                  );
                })}
              </ol>
              {ranked.length > FADE_FROM && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-2xl bg-gradient-to-b from-transparent to-neutral-50" aria-hidden />
              )}
            </div>
          )}
          {ranked.length > FADE_FROM && <p className="mt-3 text-center text-xs text-neutral-400">{T.more}</p>}
        </section>
      </main>
    </div>
  );
}
