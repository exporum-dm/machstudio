/**
 * 웨비나 등록 폼의 **번역 칸** — 수집 빌더와 같은 표를 쓰되, 저장은 덮개(i18n)로 한다.
 *
 * 왜 저장 구조가 다른가: 수집 빌더의 문구는 처음부터 로케일 맵이었고, 웨비나 등록 폼의
 * 문구는 전부 `string` 이며 읽는 곳이 네 군데다(라이브 페이지 React, 임베드 로더 **문자열
 * 스크립트**, 어드민 편집기, 등록 라우트). 그중 하나는 번들링도 트랜스파일도 거치지 않아
 * 타입을 바꿀 수 없다 — 그래서 원문은 그대로 두고 언어별 덮개를 얹는다
 * (`webinar-config.ts` 의 WebinarFormTranslation 머리말).
 *
 * 편집 경험은 두 제품이 같아야 한다 — 공용 모양(`lib/translation-entry`)을 낸다.
 */
import { guessLocaleOfTexts } from "@/lib/form-locale";
import type { TranslationEntry } from "@/lib/translation-entry";
import type {
  WebinarFormTranslation,
  WebinarRegistrationFormConfig,
} from "@/lib/webinar-config";

export type WebinarTranslationEntry = TranslationEntry<WebinarRegistrationFormConfig>;

const EMPTY_TRANSLATION: WebinarFormTranslation = { fields: {} };

/** 항목에 속하지 않는 문구 한 칸 — [덮개 키, 묶음, 설명, 여러 줄인가]. */
type TopSlot = [keyof Omit<WebinarFormTranslation, "fields">, string, string, boolean];

function translationFor(form: WebinarRegistrationFormConfig, locale: string): WebinarFormTranslation {
  return form.i18n[locale] ?? EMPTY_TRANSLATION;
}

/** 덮개의 한 칸을 바꾼 새 설정. 비우면 키를 지운다(빈 문자열은 "번역 안 함"과 같다). */
function writeTop(
  form: WebinarRegistrationFormConfig,
  locale: string,
  key: keyof Omit<WebinarFormTranslation, "fields">,
  next: string,
): WebinarRegistrationFormConfig {
  const current = translationFor(form, locale);
  const updated: WebinarFormTranslation = { ...current, fields: { ...current.fields } };
  if (next.trim()) updated[key] = next;
  else delete updated[key];
  return { ...form, i18n: { ...form.i18n, [locale]: updated } };
}

/** 항목 하나의 라벨·안내 문구·선택지를 덮개에 쓴다. */
function writeField(
  form: WebinarRegistrationFormConfig,
  locale: string,
  fieldKey: string,
  slot: "label" | "placeholder",
  next: string,
): WebinarRegistrationFormConfig {
  const current = translationFor(form, locale);
  const field = { ...(current.fields[fieldKey] ?? {}) };
  if (next.trim()) field[slot] = next;
  else delete field[slot];
  return {
    ...form,
    i18n: { ...form.i18n, [locale]: { ...current, fields: { ...current.fields, [fieldKey]: field } } },
  };
}

function writeOption(
  form: WebinarRegistrationFormConfig,
  locale: string,
  fieldKey: string,
  index: number,
  optionCount: number,
  next: string,
): WebinarRegistrationFormConfig {
  const current = translationFor(form, locale);
  const field = { ...(current.fields[fieldKey] ?? {}) };
  /**
   * 선택지는 **인덱스로 짝짓는다.** 그래서 배열 길이를 원문에 맞춰 둔다 — 길이가 짧으면
   * 뒤쪽 번역이 저장될 자리가 없고, 길면 원문에 없는 선택지가 남아 다음에 선택지를
   * 추가했을 때 엉뚱한 번역이 붙는다.
   */
  const options = Array.from({ length: optionCount }, (_, i) => field.options?.[i] ?? "");
  options[index] = next;
  if (options.some((o) => o.trim())) field.options = options;
  else delete field.options;
  return {
    ...form,
    i18n: { ...form.i18n, [locale]: { ...current, fields: { ...current.fields, [fieldKey]: field } } },
  };
}

/**
 * 이 폼에서 번역할 칸 전부. **원문이 비어 있는 칸은 넣지 않는다** — 번역할 글이 없는 줄은
 * 표를 길게만 만들고, 그러면 운영자가 "남은 번역" 개수를 못 믿게 된다.
 *
 * `form` 은 **원문 폼**이어야 한다(`normalizeRegistrationForm(config, { includeDisabled: true })`).
 * 덮개가 이미 적용된 폼을 넘기면 원문 칸에 번역이 뜨고, 그러면 무엇을 고치는지 알 수 없다.
 */
export function webinarTranslationEntries(
  form: WebinarRegistrationFormConfig,
  locale: string,
): WebinarTranslationEntry[] {
  const tr = translationFor(form, locale);
  const out: WebinarTranslationEntry[] = [];

  for (const field of form.fields) {
    // 꺼진 항목은 방문자에게 안 보인다 — 번역을 요구하면 진행률이 영영 100% 가 안 된다.
    if (field.enabled === false) continue;
    const name = field.label || field.key;
    const group = field.system ? "기본 항목" : "추가 항목";

    if (field.label) {
      out.push({
        id: "field:" + field.key + ":label",
        group,
        context: name + " · 라벨",
        base: field.label,
        value: tr.fields[field.key]?.label ?? "",
        multiline: false,
        write: (f, next) => writeField(f, locale, field.key, "label", next),
      });
    }
    if (field.placeholder) {
      out.push({
        id: "field:" + field.key + ":placeholder",
        group,
        context: name + " · 입력칸 안내",
        base: field.placeholder,
        value: tr.fields[field.key]?.placeholder ?? "",
        multiline: false,
        write: (f, next) => writeField(f, locale, field.key, "placeholder", next),
      });
    }
    field.options.forEach((option, i) => {
      if (!option) return;
      out.push({
        id: "field:" + field.key + ":option:" + i,
        group,
        context: name + " · 선택지 " + (i + 1),
        base: option,
        value: tr.fields[field.key]?.options?.[i] ?? "",
        multiline: false,
        write: (f, next) => writeOption(f, locale, field.key, i, field.options.length, next),
      });
    });
  }

  const tops: TopSlot[] = [
    ...(form.thirdPartyEnabled ? [["thirdPartyText", "동의", "제3자 제공 동의 문구", false] as TopSlot] : []),
    ...(form.thirdPartyEnabled && form.thirdPartyBodyMode === "text" ? [["thirdPartyBody", "동의", "제3자 제공 동의 전문", true] as TopSlot] : []),
    ["privacyText", "동의", "개인정보 동의 문구", false],
    // 링크 모드면 번역할 글이 없다 — 그건 "언어별 약관 URL" 문제이고 이 표의 일이 아니다.
    ...(form.privacyBodyMode === "text" ? [["privacyBody", "동의", "개인정보 동의 전문", true] as TopSlot] : []),
    ["marketingText", "동의", "마케팅 동의 문구", false],
    ...(form.marketingBodyMode === "text" ? [["marketingBody", "동의", "마케팅 동의 전문", true] as TopSlot] : []),
    ["submitLabel", "버튼", "제출 버튼", false],
    ...(form.successCta.enabled ? [["successCtaLabel", "버튼", "완료 화면 추가 버튼", false] as TopSlot] : []),
  ];

  for (const [key, group, context, multiline] of tops) {
    const base =
      key === "successCtaLabel" ? form.successCta.label : (form[key as keyof WebinarRegistrationFormConfig] as string);
    if (!base) continue;
    out.push({
      id: "top:" + key,
      group,
      context,
      base,
      value: tr[key] ?? "",
      multiline,
      write: (f, next) => writeTop(f, locale, key, next),
    });
  }

  return out;
}

/**
 * 언어 하나를 **글까지 같이** 지운다.
 *
 * 목록(`locales`)에서만 빼면 덮개가 그대로 남고, 런타임은 목록이 아니라 글을 보므로
 * 방문자 화면이 그 언어로 계속 바뀐다 — "지웠는데 다시 생긴다" 가 된다.
 */
export function dropWebinarFormLocale(
  form: WebinarRegistrationFormConfig,
  locale: string,
): WebinarRegistrationFormConfig {
  if (!locale || locale === form.defaultLocale) return form;
  const i18n = { ...form.i18n };
  delete i18n[locale];
  return { ...form, i18n, locales: form.locales.filter((l) => l !== locale) };
}

/**
 * **원문이 어느 언어로 쓰였는지**를 정정한다.
 *
 * 수집 빌더의 `retagFormLocale` 과 달리 글을 옮기지 않는다 — 웨비나는 원문이 필드에 그대로
 * 있고 i18n 은 그 위에 얹는 덮개이므로, 바꿀 것은 "이 원문은 X 언어다" 라는 **선언**뿐이다.
 *
 * 목적지에 덮개가 있으면 아무것도 하지 않는다. 그 경우 원문과 덮개가 같은 언어로 겹쳐
 * 어느 쪽이 보일지 알 수 없게 된다 — 호출부가 미리 막아야 하고, 여기는 마지막 방어선이다.
 */
export function retagWebinarFormLocale(
  form: WebinarRegistrationFormConfig,
  to: string,
): WebinarRegistrationFormConfig {
  if (!to || to === form.defaultLocale || form.i18n[to]) return form;
  return {
    ...form,
    defaultLocale: to,
    // 새 원문 언어는 번역 목록에서 빠진다(원문은 덮개가 아니다).
    locales: form.locales.filter((l) => l !== to),
  };
}

/**
 * 원문 언어 표시와 **적혀 있는 글**이 어긋났는가. 어긋나지 않았으면 null.
 *
 * 웨비나 등록 폼의 기본값은 "ko" 다(이 폼의 문구는 처음부터 한국어였다). 영문 전용 웨비나를
 * 만든 경우에는 그 표시가 틀리고, 그러면 영어가 원문 자리를 못 차지해 **영어 번역을 추가할
 * 수 없다.** 운영자가 그 원인을 스스로 찾을 방법이 없어 편집 화면이 먼저 알려 준다.
 */
export function webinarFormLocaleMismatch(form: WebinarRegistrationFormConfig): string | null {
  const texts = [
    ...form.fields.filter((f) => f.enabled !== false).map((f) => f.label),
    form.privacyText,
    form.submitLabel,
  ].filter(Boolean);
  const guess = guessLocaleOfTexts(texts);
  // 추정한 언어에 이미 번역이 있으면 어긋남이 아니다(그 언어는 제자리에 있다).
  return guess && guess !== form.defaultLocale && !form.i18n[guess] ? guess : null;
}
