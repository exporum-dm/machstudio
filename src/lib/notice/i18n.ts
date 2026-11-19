/**
 * 공고(상세페이지 · 대회 공고)의 **언어별 덮개**와 번역 칸.
 *
 * ── 왜 선언 테이블인가 ────────────────────────────────────────────────
 * 공고는 섹션이 15개이고 섹션마다 kicker·title·본문·항목 배열이 있다 — 번역 칸이 100개를
 * 넘는다. 랜딩처럼 필드를 하나하나 적으면 덮개 타입과 번역 칸 생성기에 **같은 목록이 두 벌**
 * 생기고, 섹션에 글칸을 하나 더할 때 한쪽만 고쳐도 컴파일이 통과한다. 그 순간 그 칸은
 * 번역할 수 없게 되고(또는 번역해도 안 나가고), 그걸 알아채는 건 그 언어 페이지를 보는
 * 방문자뿐이다.
 *
 * 그래서 "어느 섹션의 어느 키가 번역 대상인가" 를 **표 하나**(`SECTION_SLOTS`)에 두고,
 * 덮개 적용·번역 칸 생성·진행률이 모두 그 표를 읽는다. 섹션에 칸을 더할 때 고칠 곳은 한 곳이다.
 *
 * ── 덮개를 쓰는 이유 ──────────────────────────────────────────────────
 * 공고 문구는 전부 `string` 이고 읽는 쪽이 모델 빌더·뷰 둘·CSS 로 퍼져 있다. 타입을 로케일
 * 맵으로 바꾸면 그 전부를 고쳐야 하고 그건 공개 화면을 한꺼번에 흔드는 변경이다. 덮개는
 * `normalizeNoticePageConfig(raw, { locale })` 한 곳에서 적용되고 읽는 쪽은 안 바뀐다
 * (웨비나 등록 폼·상세페이지에서 이미 검증된 방식).
 *
 * 번역하지 않는 값: 색·배경·순서·토글·URL·숫자(배점·퍼센트)·날짜. 스폰서는 분류(tier)만 —
 * 회사 이름은 고유명사다.
 */
import { FORM_LOCALES, normalizeLocaleTag } from "@/lib/form-locale";
import type { NoticePageConfig, NoticeSectionKey } from "./config";
import type { TranslationEntry } from "@/lib/translation-entry";

/** 섹션 하나의 번역 — 섹션 자체 문구와 항목별 문구. */
export interface NoticeSectionTranslation {
  /** kicker·title·body 같은 섹션 문구. 키는 원문 config 의 키와 같다. */
  text?: Record<string, string>;
  /** 항목 배열의 문구. **인덱스로 짝짓는다**(원문 길이를 따른다). */
  items?: Array<Record<string, string>>;
}

export interface NoticePageTranslation {
  /** 히어로. `titleLines` 는 줄 배열이라 따로 둔다(줄바꿈 위치가 언어마다 달라야 한다). */
  hero?: { text?: Record<string, string>; titleLines?: string[]; facts?: Array<Record<string, string>> };
  sections?: Partial<Record<NoticeSectionKey, NoticeSectionTranslation>>;
}

/** 로케일 → 번역. 원문 언어는 여기 없다(원문은 덮개가 아니다). */
export type NoticePageI18n = Record<string, NoticePageTranslation>;

// ── 선언 테이블 ───────────────────────────────────────────────────────

/** 히어로의 번역 대상 문구 — [키, 사람이 읽을 이름, 여러 줄인가]. */
const HERO_SLOTS = [
  ["brand", "브랜드 라벨", false],
  ["subtitle", "부제", true],
  ["ctaLabel", "주 버튼 문구", false],
  ["upcomingLabel", "접수 전 버튼 문구", false],
  ["upcomingNote", "접수 전 안내", true],
  ["closedLabel", "마감 버튼 문구", false],
  ["closedNote", "마감 안내", true],
  ["secondaryLabel", "보조 버튼 문구", false],
] as const satisfies readonly (readonly [string, string, boolean])[];

/** 히어로 사실 카드(label·value) — 둘 다 번역 대상이다("형식" / "온라인 심사"). */
const HERO_FACT_SLOTS = [
  ["label", "이름", false],
  ["value", "값", false],
] as const satisfies readonly (readonly [string, string, boolean])[];

type Slots = readonly (readonly [string, string, boolean])[];

/**
 * 섹션별 번역 대상. `text` 는 섹션 자체 문구, `items` 는 항목 배열의 문구,
 * `itemsKey` 는 그 배열이 config 에서 쓰는 키 이름(대부분 "items", 선발 방식만 "rounds").
 *
 * **여기 없는 키는 번역되지 않는다.** 섹션에 글칸을 더하면 이 표에도 더해야 한다 —
 * 그게 이 파일이 존재하는 이유다(머리말).
 */
const SECTION_SLOTS: Record<
  NoticeSectionKey,
  { text: Slots; items?: Slots; itemsKey?: string; itemLabel?: (row: Record<string, unknown>, i: number) => string }
> = {
  concept: {
    text: [
      ["kicker", "라벨", false],
      ["headline", "제목", true],
      ["highlight", "강조구", false],
      ["body", "본문", true],
    ],
  },
  banner: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", true],
      ["body", "본문", true],
    ],
  },
  split: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", true],
      ["body", "본문", true],
    ],
  },
  video: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", true],
      ["description", "설명", true],
      ["captionLabel", "캡션 라벨", false],
      ["captionTitle", "캡션 제목", false],
      ["captionBody", "캡션 본문", true],
    ],
  },
  form: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
      ["description", "설명", true],
    ],
  },
  snapshot: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
    ],
    items: [
      ["label", "이름", false],
      ["value", "값", false],
      ["note", "덧붙임", false],
    ],
  },
  timeline: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
      ["description", "설명", true],
    ],
    // date 는 번역하지 않는다 — "2026.03.01" 같은 값이고, 말로 적었다면 그건 title 자리다.
    items: [
      ["title", "제목", false],
      ["description", "설명", true],
    ],
  },
  apply: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
      ["description", "설명", true],
    ],
    items: [["title", "제목", false], ["details", "준비물", true]],
  },
  eligibility: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
    ],
  },
  selection: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
      ["footnote", "각주", true],
    ],
    itemsKey: "rounds",
    items: [
      ["title", "라운드 이름", false],
      ["note", "설명", true],
      ["barLabels", "평가 비율", true],
    ],
    itemLabel: (row, i) => (typeof row.title === "string" && row.title) || `라운드 ${i + 1}`,
  },
  criteria: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
      ["description", "설명", true],
    ],
    items: [
      ["name", "항목 이름", false],
      ["description", "설명", true],
    ],
    itemLabel: (row, i) => (typeof row.name === "string" && row.name) || `항목 ${i + 1}`,
  },
  prizes: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
    ],
    items: [
      ["rank", "등수", false],
      ["title", "제목", false],
      ["description", "설명", true],
      ["amount", "금액 표기", false],
    ],
  },
  countdown: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
      ["description", "설명", true],
      ["ctaLabel", "버튼 문구", false],
    ],
  },
  faq: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
    ],
    items: [
      ["question", "질문", false],
      ["answer", "답", true],
    ],
    itemLabel: (row, i) => (typeof row.question === "string" && row.question) || `질문 ${i + 1}`,
  },
  sponsors: {
    text: [
      ["kicker", "라벨", false],
      ["title", "제목", false],
    ],
    // 회사 이름·로고·링크는 언어와 무관하다 — 분류만 바꾼다.
    items: [["tier", "분류", false]],
    itemLabel: (row, i) => (typeof row.name === "string" && row.name) || `항목 ${i + 1}`,
  },
};

/**
 * 편집 화면의 묶음 이름. `NOTICE_SECTIONS` 의 라벨을 **쓰지 않고 여기 둔다** —
 * `config.ts` 가 이 파일을 값으로 가져오므로, 거기서 값을 되가져오면 런타임 순환이 되고
 * 모듈 초기화 순서에 따라 이 표가 비어 버린다(섹션 이름이 키로 나온다).
 * 섹션을 더할 때 `SECTION_SLOTS` 에 칸을 적게 되므로 라벨도 같은 자리에서 눈에 띈다.
 */
const SECTION_LABEL: Record<NoticeSectionKey, string> = {
  concept: "개념",
  banner: "사진 배너",
  split: "사진 + 글",
  video: "영상",
  snapshot: "한눈에 보기",
  timeline: "타임라인",
  apply: "신청 방법",
  eligibility: "자격 요건",
  selection: "선발 방식",
  criteria: "심사 기준",
  prizes: "상금 · 시상",
  countdown: "마감 카운트다운",
  form: "신청 폼",
  faq: "자주 묻는 질문",
  sponsors: "주최 · 후원",
};

// ── 정규화 ────────────────────────────────────────────────────────────

const strOf = (v: unknown) => (typeof v === "string" ? v : "");
const optOf = (v: unknown) => {
  const t = strOf(v);
  return t.trim() ? t : undefined;
};
const objOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function normalizeTextMap(raw: unknown, slots: Slots): Record<string, string> | undefined {
  const src = objOf(raw);
  const out: Record<string, string> = {};
  for (const [key] of slots) {
    const v = optOf(src[key]);
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeItemMaps(raw: unknown, slots: Slots | undefined): Array<Record<string, string>> | undefined {
  if (!slots || !Array.isArray(raw)) return undefined;
  const rows = raw.map((row) => normalizeTextMap(row, slots) ?? {});
  return rows.some((r) => Object.keys(r).length) ? rows : undefined;
}

/** 저장된 덮개를 모양만 맞춰 읽는다 — JSONB 라 무엇이든 들어올 수 있다. */
export function normalizeNoticeI18n(raw: unknown): NoticePageI18n {
  const src = objOf(raw);
  const out: NoticePageI18n = {};

  for (const [rawLocale, value] of Object.entries(src)) {
    const locale = normalizeLocaleTag(rawLocale);
    if (!locale) continue;
    const v = objOf(value);

    const heroRaw = objOf(v.hero);
    const heroText = normalizeTextMap(heroRaw.text, HERO_SLOTS);
    const heroLines = Array.isArray(heroRaw.titleLines) ? heroRaw.titleLines.map(strOf) : undefined;
    const heroFacts = normalizeItemMaps(heroRaw.facts, HERO_FACT_SLOTS);

    const sections: Partial<Record<NoticeSectionKey, NoticeSectionTranslation>> = {};
    const sectionsRaw = objOf(v.sections);
    for (const key of Object.keys(SECTION_SLOTS) as NoticeSectionKey[]) {
      const def = SECTION_SLOTS[key];
      const sRaw = objOf(sectionsRaw[key]);
      const text = normalizeTextMap(sRaw.text, def.text);
      const items = normalizeItemMaps(sRaw.items, key === "eligibility" ? [["value", "", false]] : def.items);
      if (text || items) sections[key] = { ...(text ? { text } : {}), ...(items ? { items } : {}) };
    }

    const hero =
      heroText || heroLines || heroFacts
        ? {
            ...(heroText ? { text: heroText } : {}),
            ...(heroLines ? { titleLines: heroLines } : {}),
            ...(heroFacts ? { facts: heroFacts } : {}),
          }
        : undefined;

    out[locale] = {
      ...(hero ? { hero } : {}),
      ...(Object.keys(sections).length ? { sections } : {}),
    };
  }
  return out;
}

/** 열어 둔 번역 언어 목록 정리 — 문자열만, 중복 제거, 원문 언어 제외. */
export function normalizeNoticeLocales(raw: unknown, base: string): string[] {
  if (!Array.isArray(raw)) return [];
  const baseKey = (base || "ko").trim().toLowerCase();
  const out: string[] = [];
  for (const item of raw) {
    const v = normalizeLocaleTag(item);
    if (!v || v === baseKey || out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

// ── 덮개 적용 ─────────────────────────────────────────────────────────

const pick = (translated: string | undefined, base: string): string =>
  translated && translated.trim() ? translated : base;

/** 섹션·항목에 번역을 얹는다. 표에 없는 키는 건드리지 않는다(색·숫자·URL·토글). */
function mergeText<T extends Record<string, unknown>>(row: T, slots: Slots, tr: Record<string, string> | undefined): T {
  if (!tr) return row;
  const out: Record<string, unknown> = { ...row };
  for (const [key] of slots) {
    if (typeof row[key] === "string") out[key] = pick(tr[key], row[key] as string);
  }
  return out as T;
}

/**
 * 덮개를 씌운 공고. **번역이 없는 칸은 원문 그대로** 남는다 — 섞이는 것이 비는 것보다 낫다
 * (빈 제목은 방문자에게 "고장" 으로 보인다).
 *
 * 배열은 **원문 길이를 따른다.** 번역이 모자라면 그 칸만 원문이고, 남으면 무시된다 —
 * 항목 개수가 언어마다 다르면 같은 공고가 언어별로 다른 구조가 된다.
 */
export function applyNoticeLocale(
  np: NoticePageConfig,
  i18n: NoticePageI18n,
  locale: string,
): NoticePageConfig {
  const normalized = normalizeLocaleTag(locale);
  const language = FORM_LOCALES.find(({ code }) => code === normalized)?.code;
  if (!language || language === np.language) return np;
  const tr = i18n[language];
  if (!tr) return { ...np, language };
  np = applyNoticeStringLists(np, i18n, language);

  const heroTr = tr.hero;
  const hero = {
    ...mergeText(np.hero as unknown as Record<string, unknown>, HERO_SLOTS, heroTr?.text),
    // 줄 나눔은 언어마다 달라야 한다 — 여기만 배열을 통째로 바꾼다.
    titleLines:
      heroTr?.titleLines && heroTr.titleLines.some((l) => l.trim()) ? heroTr.titleLines : np.hero.titleLines,
    facts: np.hero.facts.map((row, i) =>
      mergeText(row as unknown as Record<string, unknown>, HERO_FACT_SLOTS, heroTr?.facts?.[i]),
    ),
  } as unknown as NoticePageConfig["hero"];

  const out = { ...np, language, hero } as Record<string, unknown>;

  for (const key of Object.keys(SECTION_SLOTS) as NoticeSectionKey[]) {
    const def = SECTION_SLOTS[key];
    const section = np[key] as unknown as Record<string, unknown>;
    if (!section) continue;
    const sTr = tr.sections?.[key];
    let next = mergeText(section, def.text, sTr?.text);

    if (def.items) {
      const itemsKey = def.itemsKey ?? "items";
      const rows = next[itemsKey];
      if (Array.isArray(rows)) {
        next = {
          ...next,
          [itemsKey]: rows.map((row, i) =>
            mergeText(objOf(row), def.items!, sTr?.items?.[i]),
          ),
        };
      }
    }
    out[key] = next;
  }

  const translated = out as unknown as NoticePageConfig;
  translated.apply.items = translated.apply.items.map((row, index) => {
    const lines = tr.sections?.apply?.items?.[index]?.details?.split("\n");
    return lines ? { ...row, items: row.items.map((text, i) => pick(lines[i], text)) } : row;
  });
  translated.selection.rounds = translated.selection.rounds.map((round, index) => {
    const lines = tr.sections?.selection?.items?.[index]?.barLabels?.split("\n");
    return lines ? { ...round, bars: round.bars.map((bar, i) => ({ ...bar, label: pick(lines[i], bar.label) })) } : round;
  });
  return translated;
}

/** 덮개에 글이 한 자라도 있나. */
function hasText(tr: NoticePageTranslation): boolean {
  const someMap = (m: Record<string, string> | undefined) => Object.values(m ?? {}).some((v) => v.trim());
  const someRows = (rows: Array<Record<string, string>> | undefined) => (rows ?? []).some(someMap);
  if (someMap(tr.hero?.text) || someRows(tr.hero?.facts)) return true;
  if ((tr.hero?.titleLines ?? []).some((l) => l.trim())) return true;
  for (const s of Object.values(tr.sections ?? {})) {
    if (someMap(s?.text) || someRows(s?.items)) return true;
  }
  return false;
}

/**
 * **실제로 번역이 들어 있는** 언어들. 원문 언어가 맨 앞.
 * 방문자 화면은 글이 있을 때만 바뀐다 — 빈 언어로 그리면 전부 원문으로 폴백해
 * "바꿨는데 안 바뀐다" 가 된다.
 */
export function noticeTranslatedLocales(base: string, i18n: NoticePageI18n): string[] {
  const out = [base];
  for (const [locale, tr] of Object.entries(i18n)) {
    if (locale === base || out.includes(locale)) continue;
    if (hasText(tr)) out.push(locale);
  }
  return out;
}

/** 편집 화면 탭 — 열어 둔 언어 ∪ 글이 있는 언어. 원문 언어가 맨 앞. */
export function noticeEditableLocales(base: string, locales: string[], i18n: NoticePageI18n): string[] {
  const out = [base];
  for (const l of [...locales, ...noticeTranslatedLocales(base, i18n)]) {
    if (l && l !== base && !out.includes(l)) out.push(l);
  }
  return out;
}

// ── 번역 칸 ───────────────────────────────────────────────────────────

/** 번역 표가 다루는 값 — 공고 config 와 덮개를 함께 들고 다닌다. */
export interface NoticeTranslationState {
  np: NoticePageConfig;
  i18n: NoticePageI18n;
  locales: string[];
}

export type NoticeTranslationEntry = TranslationEntry<NoticeTranslationState>;

function writeHeroText(state: NoticeTranslationState, locale: string, key: string, next: string): NoticeTranslationState {
  const tr = state.i18n[locale] ?? {};
  const text = { ...(tr.hero?.text ?? {}) };
  if (next.trim()) text[key] = next;
  else delete text[key];
  return { ...state, i18n: { ...state.i18n, [locale]: { ...tr, hero: { ...tr.hero, text } } } };
}

function writeRows(
  state: NoticeTranslationState,
  locale: string,
  index: number,
  count: number,
  key: string,
  next: string,
  read: (tr: NoticePageTranslation) => Array<Record<string, string>> | undefined,
  put: (tr: NoticePageTranslation, rows: Array<Record<string, string>>) => NoticePageTranslation,
): NoticeTranslationState {
  const tr = state.i18n[locale] ?? {};
  const rows = Array.from({ length: count }, (_, i) => ({ ...(read(tr)?.[i] ?? {}) }));
  if (next.trim()) rows[index][key] = next;
  else delete rows[index][key];
  return { ...state, i18n: { ...state.i18n, [locale]: put(tr, rows) } };
}

/**
 * 이 공고에서 번역할 칸 전부.
 *
 * **원문이 비어 있는 칸과 꺼진 섹션은 넣지 않는다** — 방문자에게 안 보이는 글을 번역하라고
 * 요구하면 진행률이 영원히 100% 가 안 되고, 그러면 그 숫자를 아무도 믿지 않는다.
 *
 * `state.np` 는 **원문 config** 여야 한다(덮개를 적용하지 않은 것). 덮개가 이미 적용된 것을
 * 넘기면 원문 칸에 번역이 뜨고 무엇을 고치는지 알 수 없다.
 */
export function noticeTranslationEntries(state: NoticeTranslationState, locale: string): NoticeTranslationEntry[] {
  const { np } = state;
  const tr = state.i18n[locale] ?? {};
  const out: NoticeTranslationEntry[] = [];

  const push = (
    id: string,
    group: string,
    context: string,
    base: string,
    value: string | undefined,
    multiline: boolean,
    write: (s: NoticeTranslationState, next: string) => NoticeTranslationState,
  ) => {
    if (!base.trim()) return;
    out.push({ id, group, context, base, value: value ?? "", multiline, write });
  };

  // ── 히어로 ──
  for (const [key, label, multiline] of HERO_SLOTS) {
    const base = strOf((np.hero as unknown as Record<string, unknown>)[key]);
    push(`hero:${key}`, "히어로", label, base, tr.hero?.text?.[key], multiline, (s, v) =>
      writeHeroText(s, locale, key, v),
    );
  }
  push(
    "hero:titleLines",
    "히어로",
    "큰 제목 (줄바꿈으로 줄을 나눠요)",
    np.hero.titleLines.join("\n"),
    tr.hero?.titleLines?.join("\n"),
    true,
    (s, v) => {
      const cur = s.i18n[locale] ?? {};
      const lines = v.split("\n");
      return {
        ...s,
        i18n: {
          ...s.i18n,
          [locale]: { ...cur, hero: { ...cur.hero, titleLines: lines.some((l) => l.trim()) ? lines : undefined } },
        },
      };
    },
  );
  np.hero.facts.forEach((fact, i) => {
    for (const [key, label] of HERO_FACT_SLOTS) {
      const base = strOf((fact as unknown as Record<string, unknown>)[key]);
      const name = fact.label || `사실 ${i + 1}`;
      push(`hero:fact:${i}:${key}`, "히어로", `${name} · ${label}`, base, tr.hero?.facts?.[i]?.[key], false, (s, v) =>
        writeRows(
          s,
          locale,
          i,
          np.hero.facts.length,
          key,
          v,
          (t) => t.hero?.facts,
          (t, rows) => ({ ...t, hero: { ...t.hero, facts: rows.some((r) => Object.keys(r).length) ? rows : undefined } }),
        ),
      );
    }
  });

  // ── 섹션 ── 순서는 운영자가 정한 렌더 순서를 따른다(표를 위에서 아래로 읽으면 페이지와 같다).
  for (const key of np.order) {
    const def = SECTION_SLOTS[key];
    const section = np[key] as unknown as Record<string, unknown> | undefined;
    if (!def || !section || section.enabled === false) continue;
    const group = SECTION_LABEL[key] ?? key;

    for (const [slot, label, multiline] of def.text) {
      push(`${key}:${slot}`, group, label, strOf(section[slot]), tr.sections?.[key]?.text?.[slot], multiline, (s, v) => {
        const cur = s.i18n[locale] ?? {};
        const sec = cur.sections?.[key] ?? {};
        const text = { ...(sec.text ?? {}) };
        if (v.trim()) text[slot] = v;
        else delete text[slot];
        return {
          ...s,
          i18n: { ...s.i18n, [locale]: { ...cur, sections: { ...cur.sections, [key]: { ...sec, text } } } },
        };
      });
    }

    // 자격 요건은 문구가 **문자열 배열**이다 — 한 칸에서 줄바꿈으로 편집한다.
    if (key === "eligibility" && Array.isArray(section.items)) {
      const lines = (section.items as unknown[]).map(strOf);
      push(
        "eligibility:items",
        group,
        "항목 (한 줄에 하나)",
        lines.join("\n"),
        tr.sections?.eligibility?.items?.map((r) => r.value ?? "").join("\n"),
        true,
        (s, v) => {
          const cur = s.i18n[locale] ?? {};
          const sec = cur.sections?.eligibility ?? {};
          const rows: Array<Record<string, string>> = v
            .split("\n")
            .map((line) => (line.trim() ? { value: line } : ({} as Record<string, string>)));
          const any = rows.some((r) => Object.keys(r).length);
          return {
            ...s,
            i18n: {
              ...s.i18n,
              [locale]: {
                ...cur,
                sections: { ...cur.sections, eligibility: { ...sec, items: any ? rows : undefined } },
              },
            },
          };
        },
      );
      continue;
    }

    if (!def.items) continue;
    const itemsKey = def.itemsKey ?? "items";
    const rows = section[itemsKey];
    if (!Array.isArray(rows)) continue;

    rows.forEach((raw, i) => {
      const row = objOf(raw);
      if ((key === "selection" || key === "criteria") && section.source !== "manual") return;
      const name = def.itemLabel ? def.itemLabel(row, i) : strOf(row.title) || strOf(row.label) || `항목 ${i + 1}`;
      for (const [slot, label, multiline] of def.items!) {
        push(
          `${key}:${i}:${slot}`,
          group,
          `${name} · ${label}`,
          slot === "details" ? (row.items as string[]).join("\n")
            : slot === "barLabels" ? (row.bars as Array<{ label: string }>).map((bar) => bar.label).join("\n")
            : strOf(row[slot]),
          tr.sections?.[key]?.items?.[i]?.[slot],
          multiline,
          (s, v) =>
            writeRows(
              s,
              locale,
              i,
              rows.length,
              slot,
              v,
              (t) => t.sections?.[key]?.items,
              (t, next) => ({
                ...t,
                sections: { ...t.sections, [key]: { ...(t.sections?.[key] ?? {}), items: next.some((r) => Object.keys(r).length) ? next : undefined } },
              }),
            ),
        );
      }
    });
  }

  return out;
}

/**
 * 자격 요건처럼 **문자열 배열**인 항목에 번역을 얹는다.
 *
 * `applyNoticeLocale` 의 일반 경로는 `Record` 항목만 다룬다 — 문자열 배열은 키가 없어서
 * 같은 규칙으로 섞을 수 없다. 덮개에는 `{ value }` 로 저장하고 여기서 되돌린다.
 */
function applyNoticeStringLists(
  np: NoticePageConfig,
  i18n: NoticePageI18n,
  locale: string,
): NoticePageConfig {
  const rows = i18n[locale]?.sections?.eligibility?.items;
  if (!rows || locale === np.language) return np;
  return {
    ...np,
    eligibility: {
      ...np.eligibility,
      items: np.eligibility.items.map((line, i) => pick(rows[i]?.value, line)),
    },
  };
}

/** 언어 하나를 **글까지 같이** 지운다 — 목록에서만 빼면 런타임이 그 언어로 계속 바뀐다. */
export function dropNoticeLocale(state: NoticeTranslationState, locale: string): NoticeTranslationState {
  if (!locale || locale === state.np.language) return state;
  const i18n = { ...state.i18n };
  delete i18n[locale];
  return { ...state, i18n, locales: state.locales.filter((l) => l !== locale) };
}

/** Keep translations paired with their original rows when rows are moved or discarded. */
export function remapNoticeRows(
  i18n: NoticePageI18n,
  key: NoticeSectionKey | "hero",
  indices: number[],
): NoticePageI18n {
  return Object.fromEntries(Object.entries(i18n).map(([locale, translation]) => {
    if (key === "hero") {
      const hero = translation.hero;
      const facts = hero?.facts;
      return [locale, facts ? { ...translation, hero: { ...hero, facts: indices.map((i) => facts[i] ?? {}) } } : translation];
    }
    const section = translation.sections?.[key];
    const items = section?.items;
    return [locale, items ? {
      ...translation,
      sections: { ...translation.sections, [key]: { ...section, items: indices.map((i) => items[i] ?? {}) } },
    } : translation];
  }));
}

export function remapNoticeNestedRows(
  i18n: NoticePageI18n,
  key: "apply" | "selection",
  rowIndex: number,
  indices: number[],
): NoticePageI18n {
  const field = key === "apply" ? "details" : "barLabels";
  return Object.fromEntries(Object.entries(i18n).map(([locale, translation]) => {
    const section = translation.sections?.[key];
    const items = section?.items;
    const lines = items?.[rowIndex]?.[field]?.split("\n");
    if (!items || !lines) return [locale, translation];
    return [locale, {
      ...translation,
      sections: {
        ...translation.sections,
        [key]: {
          ...section,
          items: items.map((row, i) => i === rowIndex
            ? { ...row, [field]: indices.map((index) => lines[index] ?? "").join("\n") }
            : row),
        },
      },
    }];
  }));
}
