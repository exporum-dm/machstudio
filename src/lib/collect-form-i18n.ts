/**
 * 폼 **번역**의 단일 출처 — "기본 언어로 쓴 글" 과 "다른 언어의 같은 글" 을 짝지어 준다.
 *
 * ── 왜 번역 표인가 ────────────────────────────────────────────────────
 * 언어마다 폼을 따로 만들면 등록 데이터가 갈라진다(명단·중복확인·CSV·체크인이 두 벌).
 * 그래서 폼은 하나로 두고 문구만 언어별로 갖는다. 그런데 "언어를 고르고 빌더를 그대로
 * 편집" 하게 두면 **구조가 갈라진다** — 영어에서만 항목을 하나 더 추가하는 순간 두 언어의
 * 저장 키가 달라지고, 그러면 한 테이블에 모으려던 이유가 사라진다.
 *
 * 그래서 번역 모드에서는 **구조를 못 바꾸고 문구만 채운다.** 원문 옆에 번역 칸이 있는 표다.
 * 항목을 더하고 지우고 옮기는 일은 기본 언어에서만 한다 — 그 변경이 모든 언어에 그대로 간다.
 *
 * ── 왜 경로 문자열이 아니라 클로저인가 ────────────────────────────────
 * `"fields.3.options.2"` 같은 경로를 쓰면 읽기·쓰기 양쪽에 파서가 필요하고, 그 파서가
 * 타입을 잃는다. 여기서는 항목을 만들 때 인덱스를 **닫아 두고** read/write 함수를 같이 준다 —
 * 호출부는 경로를 몰라도 되고, 구조가 바뀌면 컴파일이 잡는다.
 */
import {
  localize,
  type CollectConsentItem,
  type CollectField,
  type CollectFormConfig,
  type Localized,
} from "@/lib/collect-form-config";
import type { TranslationEntry } from "@/lib/translation-entry";

export { translationProgress } from "@/lib/translation-entry";

/**
 * 이 모듈의 번역 칸 — 공용 모양(`lib/translation-entry`)에 수집 설정 타입을 꽂은 것.
 * 웨비나 등록 폼도 같은 모양을 내고, 그래서 편집 표 컴포넌트를 함께 쓴다.
 */
export type CollectTranslationEntry = TranslationEntry<CollectFormConfig>;

/** 로케일 맵에서 **폴백 없이** 그 언어의 값만. 번역 칸은 비어 있어야 비어 보여야 한다. */
export function exactLocalized(value: Localized | undefined, locale: string): string {
  if (!value) return "";
  return Object.prototype.hasOwnProperty.call(value, locale) ? (value[locale] ?? "") : "";
}

/**
 * 로케일 맵에 한 언어를 써 넣는다. **빈 값은 키를 지운다** —
 * 빈 문자열이 남아 있으면 `collectFormLocales` 가 "번역이 있다"로 세고, 방문자는
 * 라벨만 빈 폼을 받는다(그 상태가 제일 찾기 어렵다).
 */
export function putLocalized(prev: Localized | undefined, locale: string, next: string): Localized {
  const out: Localized = { ...(prev ?? {}) };
  if (next.trim()) out[locale] = next;
  else delete out[locale];
  return out;
}

function replaceAt<T>(arr: readonly T[], index: number, value: T): T[] {
  const out = arr.slice();
  out[index] = value;
  return out;
}

/** 항목 하나가 내는 번역 칸들 — 본 목록과 분기 그룹이 같은 규칙을 쓰게 뽑아 둔다. */
function fieldEntries(
  field: CollectField,
  locale: string,
  base: string,
  group: string,
  idPrefix: string,
  writeField: (config: CollectFormConfig, next: CollectField) => CollectFormConfig,
): CollectTranslationEntry[] {
  const name = localize(field.label, base) || field.key;
  const out: CollectTranslationEntry[] = [];

  const labelText = localize(field.label, base);
  if (labelText) {
    out.push({
      id: idPrefix + ":label",
      group,
      context: name + " · 라벨",
      base: labelText,
      value: exactLocalized(field.label, locale),
      multiline: false,
      write: (c, next) => writeField(c, { ...field, label: putLocalized(field.label, locale, next) }),
    });
  }

  const placeholderText = localize(field.placeholder, base);
  if (placeholderText) {
    out.push({
      id: idPrefix + ":placeholder",
      group,
      context: name + " · 입력칸 안내",
      base: placeholderText,
      value: exactLocalized(field.placeholder, locale),
      multiline: false,
      write: (c, next) => writeField(c, { ...field, placeholder: putLocalized(field.placeholder, locale, next) }),
    });
  }

  field.options.forEach((option, oi) => {
    const optionText = localize(option, base);
    if (!optionText) return;
    out.push({
      id: idPrefix + ":option:" + oi,
      group,
      context: name + " · 선택지 " + (oi + 1),
      base: optionText,
      value: exactLocalized(option, locale),
      multiline: false,
      write: (c, next) =>
        writeField(c, { ...field, options: replaceAt(field.options, oi, putLocalized(option, locale, next)) }),
    });
  });

  return out;
}

function consentEntries(
  which: "privacy" | "marketing" | "thirdParty",
  title: string,
  item: CollectConsentItem,
  locale: string,
  base: string,
): CollectTranslationEntry[] {
  if (!item.enabled) return [];
  const setItem = (c: CollectFormConfig, next: CollectConsentItem): CollectFormConfig => ({
    ...c,
    consent: { ...c.consent, [which]: next },
  });
  const out: CollectTranslationEntry[] = [];

  const labelText = localize(item.label, base);
  if (labelText) {
    out.push({
      id: "consent:" + which + ":label",
      group: "동의",
      context: title + " · 문구",
      base: labelText,
      value: exactLocalized(item.label, locale),
      multiline: false,
      write: (c, next) => setItem(c, { ...item, label: putLocalized(item.label, locale, next) }),
    });
  }

  // 링크 모드면 번역할 글이 없다 — 그건 "언어별 약관 URL" 문제이고 이 표의 일이 아니다.
  const bodyText = item.bodyFormat === "link" ? "" : localize(item.body, base);
  if (bodyText) {
    out.push({
      id: "consent:" + which + ":body",
      group: "동의",
      context: title + " · 전문",
      base: bodyText,
      value: exactLocalized(item.body, locale),
      multiline: true,
      write: (c, next) => setItem(c, { ...item, body: putLocalized(item.body, locale, next) }),
    });
  }
  return out;
}

/**
 * 이 폼에서 번역할 칸 전부. **원문이 비어 있는 칸은 넣지 않는다** — 번역할 글이 없는 줄은
 * 표를 길게만 만들고, 그러면 운영자가 "남은 번역" 개수를 못 믿게 된다.
 *
 * 꺼진 항목·안내·동의도 넣지 않는다. 방문자에게 안 보이는 글을 번역하라고 요구하면
 * 진행률이 영원히 100% 가 안 된다.
 */
export function collectTranslationEntries(config: CollectFormConfig, locale: string): CollectTranslationEntry[] {
  const base = config.defaultLocale;
  const out: CollectTranslationEntry[] = [];

  config.fields.forEach((field, fi) => {
    if (!field.enabled) return;
    out.push(
      ...fieldEntries(field, locale, base, "등록 항목", "field:" + field.id, (c, next) => ({
        ...c,
        fields: replaceAt(c.fields, fi, next),
      })),
    );
  });

  if (config.branch.enabled) {
    config.branch.groups.forEach((groupDef, gi) => {
      groupDef.fields.forEach((field, fi) => {
        if (!field.enabled) return;
        out.push(
          ...fieldEntries(
            field,
            locale,
            base,
            "유형 " + groupDef.value + " 문항",
            "branch:" + gi + ":" + field.id,
            (c, next) => ({
              ...c,
              branch: {
                ...c.branch,
                groups: replaceAt(c.branch.groups, gi, {
                  ...groupDef,
                  fields: replaceAt(groupDef.fields, fi, next),
                }),
              },
            }),
          ),
        );
      });
    });
  }

  config.notices.forEach((notice, ni) => {
    if (!notice.enabled) return;
    const setNotice = (c: CollectFormConfig, next: typeof notice): CollectFormConfig => ({
      ...c,
      notices: replaceAt(c.notices, ni, next),
    });
    const titleText = localize(notice.title, base);
    const label = titleText || "안내 " + (ni + 1);
    if (titleText) {
      out.push({
        id: "notice:" + notice.id + ":title",
        group: "안내",
        context: label + " · 제목",
        base: titleText,
        value: exactLocalized(notice.title, locale),
        multiline: false,
        write: (c, next) => setNotice(c, { ...notice, title: putLocalized(notice.title, locale, next) }),
      });
    }
    const bodyText = localize(notice.body, base);
    if (bodyText) {
      out.push({
        id: "notice:" + notice.id + ":body",
        group: "안내",
        context: label + " · 본문",
        base: bodyText,
        value: exactLocalized(notice.body, locale),
        multiline: true,
        write: (c, next) => setNotice(c, { ...notice, body: putLocalized(notice.body, locale, next) }),
      });
    }
  });

  out.push(...consentEntries("privacy", "개인정보 수집·이용", config.consent.privacy, locale, base));
  out.push(...consentEntries("marketing", "마케팅 수신", config.consent.marketing, locale, base));
  out.push(...consentEntries("thirdParty", "제3자 제공", config.consent.thirdParty, locale, base));

  const submitText = localize(config.submitLabel, base);
  if (submitText) {
    out.push({
      id: "submitLabel",
      group: "버튼",
      context: "제출 버튼",
      base: submitText,
      value: exactLocalized(config.submitLabel, locale),
      multiline: false,
      write: (c, next) => ({ ...c, submitLabel: putLocalized(c.submitLabel, locale, next) }),
    });
  }

  if (config.eventInfo.enabled) {
    const venueText = localize(config.eventInfo.venue, base);
    if (venueText) {
      out.push({
        id: "event:venue",
        group: "행사 개요",
        context: "장소",
        base: venueText,
        value: exactLocalized(config.eventInfo.venue, locale),
        multiline: false,
        write: (c, next) => ({
          ...c,
          eventInfo: { ...c.eventInfo, venue: putLocalized(c.eventInfo.venue, locale, next) },
        }),
      });
    }
    config.eventInfo.extraRows.forEach((row, ri) => {
      const setRow = (c: CollectFormConfig, next: typeof row): CollectFormConfig => ({
        ...c,
        eventInfo: { ...c.eventInfo, extraRows: replaceAt(c.eventInfo.extraRows, ri, next) },
      });
      const rowLabel = localize(row.label, base);
      if (rowLabel) {
        out.push({
          id: "event:row:" + ri + ":label",
          group: "행사 개요",
          context: "추가 항목 " + (ri + 1) + " · 이름",
          base: rowLabel,
          value: exactLocalized(row.label, locale),
          multiline: false,
          write: (c, next) => setRow(c, { ...row, label: putLocalized(row.label, locale, next) }),
        });
      }
      const rowValue = localize(row.value, base);
      if (rowValue) {
        out.push({
          id: "event:row:" + ri + ":value",
          group: "행사 개요",
          context: (rowLabel || "추가 항목 " + (ri + 1)) + " · 값",
          base: rowValue,
          value: exactLocalized(row.value, locale),
          multiline: false,
          write: (c, next) => setRow(c, { ...row, value: putLocalized(row.value, locale, next) }),
        });
      }
    });
  }

  if (config.confirmationEmail.enabled) {
    /**
     * 확인 메일도 번역한다. 다만 `collectFormLocales`(= 방문자 화면의 언어 전환 근거)에는
     * 메일 문구가 안 들어간다 — 메일만 번역해 둔 폼이 화면 언어까지 바꾸면 안 된다.
     */
    const slots = [
      ["subject", "제목", false],
      ["heading", "머리글", false],
      ["body", "본문", true],
      ["buttonLabel", "버튼 문구", false],
      ["calloutTitle", "QR 안내 제목", false],
      ["calloutBody", "QR 안내 본문", false],
    ] as const;
    for (const [key, title, multiline] of slots) {
      const current = config.confirmationEmail[key];
      const text = localize(current, base);
      if (!text) continue;
      out.push({
        id: "email:" + key,
        group: "확인 메일",
        context: title,
        base: text,
        value: exactLocalized(current, locale),
        multiline,
        write: (c, next) => ({
          ...c,
          confirmationEmail: {
            ...c.confirmationEmail,
            [key]: putLocalized(c.confirmationEmail[key], locale, next),
          },
        }),
      });
    }
  }

  return out;
}


/**
 * **기본 언어를 바꾼다** — 저장된 글의 로케일 키를 통째로 옮긴다.
 *
 * 왜 필요한가: 빌더의 기본 로케일이 오래 `"en"` 이었다(첫 사용처가 LA 전시였다).
 * 국문으로 폼을 만든 운영자의 글은 전부 `{"en": "성함"}` 으로 저장돼 있다. 그 상태에서
 * 영어 번역을 추가하면 **같은 칸을 덮어쓰게** 된다 — 국문 원문이 사라진다.
 * 그래서 기본 언어를 ko 로 바꿀 때 기존 글을 ko 칸으로 옮겨 준다.
 *
 * 구현이 재귀인 이유: 로케일 맵은 config 의 열 군데 넘는 깊이에 흩어져 있고, 목록을 손으로
 * 적으면 새 필드가 생길 때마다 **조용히 하나씩 빠진다**(그 빠짐은 운영자 글이 사라지는 형태로
 * 드러난다). 대신 바꿀 조건을 좁게 건다:
 *  · 키 이름이 정확히 `from` 이고,
 *  · 그 객체의 **모든 값이 문자열**이며(= 로케일 맵의 모양),
 *  · 아직 `to` 키가 없을 것.
 * 이 셋을 다 만족하는 자리는 로케일 맵뿐이다 — theme·validation 처럼 값이 전부 문자열인
 * 객체는 있지만, 거기에 `"ko"`·`"en"` 이라는 키가 있을 리 없다.
 */
export function retagFormLocale(config: CollectFormConfig, from: string, to: string): CollectFormConfig {
  if (!from || !to || from === to) return config;

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;

    const record = value as Record<string, unknown>;
    const allStrings = Object.values(record).every((v) => typeof v === "string");
    const isLocaleMap =
      allStrings && Object.prototype.hasOwnProperty.call(record, from) && !Object.prototype.hasOwnProperty.call(record, to);

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (isLocaleMap && k === from) out[to] = v;
      else out[k] = walk(v);
    }
    return out;
  };

  const moved = walk(config) as CollectFormConfig;
  return {
    ...moved,
    defaultLocale: to,
    // 새 기본 언어는 번역 목록에서 빠지고, 옛 기본 언어는 이제 번역 대상이 된다.
    locales: [...new Set([...config.locales.filter((l) => l !== to), from])].filter((l) => l !== to),
  };
}

/**
 * 언어 하나를 **글까지 같이** 지운다.
 *
 * 목록(`locales`)에서만 빼면 저장된 번역이 그대로 남고, `collectFormLocales` 가 그 글을
 * 보고 탭을 되살린다 — 운영자에게는 "지웠는데 다시 생긴다" 로 보인다. 더 나쁜 건 그동안
 * 방문자 화면은 그 언어로 계속 바뀐다는 것이다(런타임은 목록이 아니라 글을 본다).
 */
export function dropFormLocale(config: CollectFormConfig, locale: string): CollectFormConfig {
  if (!locale || locale === config.defaultLocale) return config;

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    // retagFormLocale 과 **같은 판정**을 쓴다 — 값이 전부 문자열인 객체가 로케일 맵이다.
    const isLocaleMap =
      Object.values(record).every((v) => typeof v === "string") &&
      Object.prototype.hasOwnProperty.call(record, locale);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (isLocaleMap && k === locale) continue;
      out[k] = walk(v);
    }
    return out;
  };

  const stripped = walk(config) as CollectFormConfig;
  return { ...stripped, locales: config.locales.filter((l) => l !== locale) };
}
