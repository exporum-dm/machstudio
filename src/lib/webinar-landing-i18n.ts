/**
 * 웨비나 상세페이지(랜딩)의 **번역 칸** — 원문 옆에 그 언어의 글을 적는 표를 만든다.
 *
 * 저장은 덮개(`LandingPageConfig.i18n`)다 — 이유는 `webinar-config.ts` 의
 * `LandingPageTranslation` 머리말에 있다. 편집 경험은 등록 폼과 **같은 표**를 쓴다
 * (`lib/translation-entry` 의 공통 모양 → `components/form-builder/TranslationTable`).
 *
 * ── 구조는 기본 언어에서만 바꾼다 ──────────────────────────────────────
 * 여기서 나오는 칸은 **문구뿐**이다. 항목을 더하고 지우고 옮기는 일은 기본 언어 탭의 일이고,
 * 그 변경이 모든 언어에 그대로 간다. 언어마다 항목 수가 다르면 같은 상세페이지가 언어별로
 * 다른 구조가 되고, 그러면 "하나를 만들어 여러 언어에 쓴다" 는 전제가 깨진다.
 */
import type { TranslationEntry } from "@/lib/translation-entry";
import type {
  LandingPageConfig,
  LandingPageTranslation,
  LandingTranslationItem,
} from "@/lib/webinar-config";

export type LandingTranslationEntry = TranslationEntry<LandingPageConfig>;

const EMPTY: LandingPageTranslation = {};

function trOf(lp: LandingPageConfig, locale: string): LandingPageTranslation {
  return lp.i18n[locale] ?? EMPTY;
}

/** 덮개를 고친 새 config. 원본을 건드리지 않는다(자동저장이 직전 값과 비교한다). */
function writeTr(
  lp: LandingPageConfig,
  locale: string,
  mutate: (tr: LandingPageTranslation) => LandingPageTranslation,
): LandingPageConfig {
  return { ...lp, i18n: { ...lp.i18n, [locale]: mutate(trOf(lp, locale)) } };
}

/** 빈 값은 undefined 로 — 빈 문자열이 남으면 "번역이 있다"로 세어져 빈 화면이 나간다. */
function opt(v: string): string | undefined {
  return v.trim() ? v : undefined;
}

/**
 * 배열 항목 한 칸을 쓴다. 길이를 **원문에 맞춰 둔다** — 짧으면 뒤쪽 번역이 저장될 자리가 없다.
 * 남는 자리는 빈 객체로 채워지고, 적용 시점에 원문으로 폴백한다.
 */
function setItem(
  rows: LandingTranslationItem[] | undefined,
  index: number,
  count: number,
  slot: "title" | "description",
  value: string,
): LandingTranslationItem[] | undefined {
  const out: LandingTranslationItem[] = Array.from({ length: count }, (_, i) => ({ ...(rows?.[i] ?? {}) }));
  out[index] = { ...out[index], [slot]: opt(value) };
  return out.some((r) => r.title || r.description) ? out : undefined;
}

/**
 * 이 상세페이지에서 번역할 칸 전부.
 *
 * **원문이 비어 있는 칸과 꺼진 섹션은 넣지 않는다** — 방문자에게 안 보이는 글을 번역하라고
 * 요구하면 진행률이 영원히 100% 가 안 되고, 그러면 그 숫자를 아무도 믿지 않는다.
 *
 * `lp` 는 **원문 config** 여야 한다(`normalizeLandingPageConfig(config)` — locale 옵션 없이).
 * 덮개가 이미 적용된 것을 넘기면 원문 칸에 번역이 뜨고 무엇을 고치는지 알 수 없다.
 */
export function landingTranslationEntries(lp: LandingPageConfig, locale: string): LandingTranslationEntry[] {
  const tr = trOf(lp, locale);
  const out: LandingTranslationEntry[] = [];

  const push = (
    id: string,
    group: string,
    context: string,
    base: string,
    value: string | undefined,
    multiline: boolean,
    write: (config: LandingPageConfig, next: string) => LandingPageConfig,
  ) => {
    if (!base.trim()) return;
    out.push({ id, group, context, base, value: value ?? "", multiline, write });
  };

  // ── 히어로 ──
  push("brand", "히어로", "브랜드 라벨", lp.brand, tr.brand, false, (c, v) =>
    writeTr(c, locale, (t) => ({ ...t, brand: opt(v) })),
  );
  /**
   * 큰 제목은 **줄 단위 배열**인데 번역 칸은 하나로 둔다 — 줄바꿈 위치가 언어마다 달라야
   * 하기 때문이다(한국어로 두 줄인 제목이 영어로는 세 줄이 되기도 한다). 그래서 적용 쪽도
   * 이 칸만 배열을 통째로 교체한다(`applyLandingLocale` 의 titleLines 주석).
   */
  push(
    "titleLines",
    "히어로",
    "큰 제목 (줄바꿈으로 줄을 나눠요)",
    lp.titleLines.join("\n"),
    tr.titleLines?.join("\n"),
    true,
    (c, v) =>
      writeTr(c, locale, (t) => {
        const lines = v.split("\n");
        return { ...t, titleLines: lines.some((l) => l.trim()) ? lines : undefined };
      }),
  );
  push("subtitle", "히어로", "부제", lp.subtitle, tr.subtitle, true, (c, v) =>
    writeTr(c, locale, (t) => ({ ...t, subtitle: opt(v) })),
  );
  push("venue", "히어로", "일시 옆 라벨", lp.venue, tr.venue, false, (c, v) =>
    writeTr(c, locale, (t) => ({ ...t, venue: opt(v) })),
  );
  push("ctaLabel", "히어로", "주 버튼 문구", lp.ctaLabel, tr.ctaLabel, false, (c, v) =>
    writeTr(c, locale, (t) => ({ ...t, ctaLabel: opt(v) })),
  );

  // ── 소개 ──
  if (lp.intro.enabled) {
    const slots = [
      ["title", "제목", false],
      ["body", "본문", true],
      ["titleMobile", "제목 (모바일 전용)", false],
      ["bodyMobile", "본문 (모바일 전용)", true],
    ] as const;
    for (const [key, label, multiline] of slots) {
      push("intro:" + key, "소개", label, lp.intro[key], tr.intro?.[key], multiline, (c, v) =>
        writeTr(c, locale, (t) => ({ ...t, intro: { ...t.intro, [key]: opt(v) } })),
      );
    }
  }

  // ── 제목 + 항목 배열을 쓰는 섹션들 ──
  const itemSections = [
    { key: "audience", group: "추천 대상", hasTitle: true },
    { key: "programs", group: "프로그램", hasTitle: false },
    { key: "highlights", group: "혜택", hasTitle: true },
  ] as const;

  for (const { key, group, hasTitle } of itemSections) {
    const section = lp[key];
    if (!section.enabled) continue;

    if (hasTitle && "title" in section) {
      const title = section.title;
      push(key + ":title", group, "섹션 제목", title, (tr[key] as { title?: string } | undefined)?.title, false, (c, v) =>
        writeTr(c, locale, (t) => ({ ...t, [key]: { ...t[key], title: opt(v) } })),
      );
    }

    const rows = section.items;
    rows.forEach((row, i) => {
      const name = row.title || `항목 ${i + 1}`;
      const trRows = (tr[key] as { items?: LandingTranslationItem[] } | undefined)?.items;
      push(`${key}:${i}:title`, group, `${name} · 제목`, row.title, trRows?.[i]?.title, false, (c, v) =>
        writeTr(c, locale, (t) => ({
          ...t,
          [key]: { ...t[key], items: setItem((t[key] as { items?: LandingTranslationItem[] })?.items, i, rows.length, "title", v) },
        })),
      );
      push(`${key}:${i}:desc`, group, `${name} · 설명`, row.description, trRows?.[i]?.description, true, (c, v) =>
        writeTr(c, locale, (t) => ({
          ...t,
          [key]: { ...t[key], items: setItem((t[key] as { items?: LandingTranslationItem[] })?.items, i, rows.length, "description", v) },
        })),
      );
    });
  }

  // ── 참여 방법 ──
  if (lp.join.enabled) {
    lp.join.steps.forEach((step, i) => {
      const name = step.title || `${i + 1}단계`;
      push(`join:${i}:title`, "참여 방법", `${name} · 제목`, step.title, tr.join?.steps?.[i]?.title, false, (c, v) =>
        writeTr(c, locale, (t) => ({
          ...t,
          join: { ...t.join, steps: setItem(t.join?.steps, i, lp.join.steps.length, "title", v) },
        })),
      );
      push(`join:${i}:desc`, "참여 방법", `${name} · 설명`, step.description, tr.join?.steps?.[i]?.description, true, (c, v) =>
        writeTr(c, locale, (t) => ({
          ...t,
          join: { ...t.join, steps: setItem(t.join?.steps, i, lp.join.steps.length, "description", v) },
        })),
      );
    });
    push("join:note", "참여 방법", "마감 안내 줄", lp.join.note, tr.join?.note, true, (c, v) =>
      writeTr(c, locale, (t) => ({ ...t, join: { ...t.join, note: opt(v) } })),
    );
  }

  // ── FAQ ──
  if (lp.faq.enabled) {
    lp.faq.items.forEach((item, i) => {
      const name = item.question || `질문 ${i + 1}`;
      const slots = [
        ["category", "분류", false],
        ["question", "질문", false],
        ["answer", "답", true],
      ] as const;
      for (const [slot, label, multiline] of slots) {
        push(`faq:${i}:${slot}`, "자주 묻는 질문", `${name} · ${label}`, item[slot], tr.faq?.items?.[i]?.[slot], multiline, (c, v) =>
          writeTr(c, locale, (t) => {
            const rows = Array.from({ length: lp.faq.items.length }, (_, k) => ({ ...(t.faq?.items?.[k] ?? {}) }));
            rows[i] = { ...rows[i], [slot]: opt(v) };
            const any = rows.some((r) => r.category || r.question || r.answer);
            return { ...t, faq: { items: any ? rows : undefined } };
          }),
        );
      }
    });
  }

  // ── 주최·후원 ──
  if (lp.sponsors.enabled) {
    push("sponsors:title", "주최 · 후원", "섹션 제목", lp.sponsors.title, tr.sponsors?.title, false, (c, v) =>
      writeTr(c, locale, (t) => ({ ...t, sponsors: { ...t.sponsors, title: opt(v) } })),
    );
    // 회사 이름·로고·링크는 언어와 무관하다 — 분류(주최·후원 같은 말)만 번역한다.
    lp.sponsors.items.forEach((item, i) => {
      push(`sponsors:${i}:tier`, "주최 · 후원", `${item.name || `항목 ${i + 1}`} · 분류`, item.tier, tr.sponsors?.items?.[i]?.tier, false, (c, v) =>
        writeTr(c, locale, (t) => {
          const rows = Array.from({ length: lp.sponsors.items.length }, (_, k) => ({ ...(t.sponsors?.items?.[k] ?? {}) }));
          rows[i] = { tier: opt(v) };
          const any = rows.some((r) => r.tier);
          return { ...t, sponsors: { ...t.sponsors, items: any ? rows : undefined } };
        }),
      );
    });
  }

  return out;
}

/**
 * 언어 하나를 **글까지 같이** 지운다.
 *
 * 목록(`locales`)에서만 빼면 덮개가 남고, 런타임은 목록이 아니라 글을 보므로 방문자 화면이
 * 그 언어로 계속 바뀐다 — "지웠는데 다시 생긴다" 가 된다.
 */
export function dropLandingLocale(lp: LandingPageConfig, locale: string): LandingPageConfig {
  if (!locale || locale === lp.defaultLocale) return lp;
  const i18n = { ...lp.i18n };
  delete i18n[locale];
  return { ...lp, i18n, locales: lp.locales.filter((l) => l !== locale) };
}

/**
 * **원문이 어느 언어로 쓰였는지**를 정정한다. 글은 옮기지 않는다 — 원문은 config 본체에
 * 그대로 있고 i18n 은 그 위에 얹는 덮개이므로, 바꿀 것은 선언뿐이다(등록 폼과 같은 규칙).
 *
 * 목적지에 덮개가 있으면 아무것도 하지 않는다. 원문과 덮개가 같은 언어로 겹치면 어느 쪽이
 * 보일지 알 수 없다 — 호출부가 미리 막아야 하고 여기는 마지막 방어선이다.
 */
export function retagLandingLocale(lp: LandingPageConfig, to: string): LandingPageConfig {
  if (!to || to === lp.defaultLocale || lp.i18n[to]) return lp;
  return { ...lp, defaultLocale: to, locales: lp.locales.filter((l) => l !== to) };
}
