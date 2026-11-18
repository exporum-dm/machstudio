/**
 * **호스트 페이지의 언어를 읽어 폼 언어를 고른다.**
 *
 * ── 풀려는 문제 ───────────────────────────────────────────────────────
 * 홈페이지를 언어별 페이지로 나눠 쓴다(국문 /, 영문 /en/). 같은 행사인데 페이지가 둘이라,
 * 폼을 둘로 만들면 **등록 데이터도 둘로 갈라진다** — 명단·중복확인·CSV·체크인이 전부
 * 두 벌이 되고, 두 벌을 합치는 일은 사람이 손으로 하게 된다.
 *
 * 그래서 폼은 **하나**로 두고 문구만 언어별로 갖는다(라벨은 이미 로케일 맵이다 —
 * collect-form-config 의 Localized). 남은 문제는 "지금 이 페이지가 무슨 언어인가" 를
 * 임베드 런타임이 스스로 아는 것뿐이고, 이 파일이 그 판정이다.
 *
 * ── 왜 navigator.language 를 안 보나 ──────────────────────────────────
 * 보고 싶어지는 값이지만 **틀린 신호**다. 국문 페이지를 영어 브라우저로 여는 사람
 * (해외 거주 한국인, 영문 OS 를 쓰는 국내 사용자)이 흔한데, 그 사람에게 영문 폼을 주면
 * 국문 페이지 한가운데 영어 폼이 박힌다. 기준은 **페이지의 언어**지 사람의 언어가 아니다.
 * 사람의 언어를 쓰고 싶으면 그건 "언어 고르기" 버튼의 일이다.
 *
 * ── React·DOM 비의존 ──────────────────────────────────────────────────
 * 임베드 번들에 그대로 들어간다. DOM 은 호출부가 읽어서 **문자열로** 넘긴다.
 */

/** 폼 문구를 번역해 둘 수 있는 언어. 여기 없는 태그는 저장은 되되 고르는 UI 에 안 나온다. */
export const FORM_LOCALES = [
  { code: "ko", label: "한국어", englishLabel: "Korean" },
  { code: "en", label: "English", englishLabel: "English" },
  { code: "ja", label: "日本語", englishLabel: "Japanese" },
  { code: "zh", label: "中文", englishLabel: "Chinese" },
  { code: "es", label: "Español", englishLabel: "Spanish" },
  { code: "vi", label: "Tiếng Việt", englishLabel: "Vietnamese" },
] as const;

export type FormLocaleCode = typeof FORM_LOCALES[number]["code"];

const KNOWN = new Set<string>(FORM_LOCALES.map((l) => l.code));

/** 사람이 적는 비표준 약어. 아임웹·워드프레스 다국어 설정에서 실제로 쓰이는 값들이다. */
const ALIASES: Record<string, string> = {
  kr: "ko", "ko-kr": "ko",
  jp: "ja", "ja-jp": "ja",
  cn: "zh", tw: "zh", hk: "zh",
  us: "en", uk: "en", gb: "en",
  vn: "vi",
};

/** 주어진 코드의 표시 이름. 모르는 코드는 코드 그대로 보여 준다(지어내지 않는다). */
export function formLocaleLabel(code: string): string {
  return FORM_LOCALES.find((l) => l.code === code)?.label ?? code;
}

/**
 * `en-US` · `zh-Hant-TW` · ` KO ` 같은 값을 우리가 쓰는 2글자 코드로 좁힌다.
 * 모르는 언어면 null — **추측해서 엉뚱한 언어를 돌려주지 않는다**(그러면 폼이 통째로 딴
 * 언어로 뜨고, 운영자는 어디서 온 값인지 못 찾는다).
 */
export function normalizeLocaleTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase().replace(/_/g, "-");
  if (!trimmed) return null;
  if (KNOWN.has(trimmed)) return trimmed;
  if (ALIASES[trimmed]) return ALIASES[trimmed];
  const base = trimmed.split("-")[0];
  if (KNOWN.has(base)) return base;
  return ALIASES[base] ?? null;
}

/**
 * **언어 태그 모양인가** — `en` · `ko-KR` · `zh-Hant`. 경로 조각·호스트 라벨을 걸러낼 때 쓴다.
 *
 * 이 모양 검사를 먼저 하는 이유: URL 조각은 대부분 언어가 아니다("events", "www", "japan").
 * 모양을 안 보고 `normalizeLocaleTag` 에 바로 넣으면 `es-tore` 같은 평범한 조각이
 * 스페인어로 읽힌다.
 */
const LOCALE_SHAPE = /^[a-z]{2}(-[a-z0-9]{2,4})?$/i;

/**
 * **호스트명의 첫 라벨**이 언어면 그 언어. `en.japan.k-expo.org` · `jp.japan.k-expo.org`.
 *
 * 왜 필요한가: 언어별 페이지를 경로(`/en/`)로 나누는 사이트도 있고 **서브도메인**으로 나누는
 * 사이트도 있다. 우리 전시 사이트가 후자다(en. / jp.). 경로만 보면 그 사이트에서는 신호가
 * 아예 없고, 그러면 `<html lang>` 하나에 매달리게 된다 — 그 값은 템플릿 기본값이 그대로
 * 남아 있기 쉬워서 **영문 페이지에 국문 폼이 나간다.**
 *
 * 첫 라벨만 본다. `www`·`japan` 처럼 언어가 아닌 라벨은 모양 검사와 아는 언어 목록에서
 * 두 번 걸러진다 — `www` 는 세 글자라 모양에서 탈락하고, `jp` 는 별칭으로 `ja` 가 된다.
 */
export function localeFromHostname(hostname: unknown): string | null {
  if (typeof hostname !== "string") return null;
  const first = hostname.trim().toLowerCase().split(".")[0];
  if (!first || !LOCALE_SHAPE.test(first)) return null;
  return normalizeLocaleTag(first);
}

/** URL 경로의 첫 조각이 언어면 그 언어. `/en/events/x` · `/ko-KR/x` · `/jp/x`. */
export function localeFromPathname(pathname: unknown): string | null {
  if (typeof pathname !== "string") return null;
  const first = pathname.split("/").filter(Boolean)[0];
  if (!first) return null;
  // 경로 조각은 대부분 언어가 아니다("events", "page"). 언어 태그 모양일 때만 본다 —
  // 그러지 않으면 /es-tore/ 같은 평범한 경로가 스페인어로 읽힌다.
  if (!LOCALE_SHAPE.test(first)) return null;
  return normalizeLocaleTag(first);
}

/** 쿼리스트링에서 언어를 읽는다. 호스트 사이트마다 키가 다르다. */
const QUERY_KEYS = ["lang", "hl", "locale", "language"] as const;

export function localeFromSearch(search: unknown): string | null {
  if (typeof search !== "string" || !search) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return null;
  }
  for (const key of QUERY_KEYS) {
    const found = normalizeLocaleTag(params.get(key));
    if (found) return found;
  }
  return null;
}

export interface HostLocaleSignals {
  /** 마운트 지점·스크립트 태그의 `data-mach-lang`. 운영자가 직접 지목한 값이라 1순위. */
  explicit?: string | null;
  /** 호스트 페이지 URL 의 쿼리스트링(`location.search`). */
  search?: string | null;
  /** 호스트 페이지 URL 의 경로(`location.pathname`). */
  pathname?: string | null;
  /** 호스트 페이지의 호스트명(`location.hostname`) — 언어별 서브도메인(`en.`)을 쓰는 사이트용. */
  hostname?: string | null;
  /** `<html lang="...">`. */
  documentLang?: string | null;
}

/**
 * 우선순위대로 후보를 늘어놓는다. **고르기는 하지 않는다** — 실제 번역이 있는 언어로
 * 좁히는 일은 `resolveFormLocale` 이 한다.
 *
 * 순서의 이유:
 *  1. data-mach-lang — 운영자가 이 자리에 대해 직접 적은 유일한 값이다. 자동 판정이
 *     틀렸을 때 **고칠 방법이 있어야** 한다.
 *  2. ?lang= — 많은 다국어 플러그인이 이 방식이고, 사람이 링크로 공유하기도 한다.
 *  3. 경로 — /en/ 형태. 아임웹·Wix 다국어의 기본.
 *  4. 호스트명 첫 라벨 — en.japan.k-expo.org 형태. 경로보다 뒤인 이유는 **덜 구체적**이어서다:
 *     서브도메인은 사이트 전체의 언어를 말하고 경로는 그 페이지의 언어를 말한다. 둘이
 *     어긋나면(en. 도메인 아래 /ko/ 페이지) 더 좁은 쪽을 믿는 게 맞다.
 *  5. <html lang> — 가장 흔하지만 **제일 자주 틀려 있다**(템플릿 기본값 ko 를 안 고치고
 *     영문 페이지를 만든 사이트가 많다). 그래서 맨 뒤다.
 */
export function hostLocaleCandidates(signals: HostLocaleSignals): string[] {
  const out: string[] = [];
  const push = (v: string | null) => {
    if (v && !out.includes(v)) out.push(v);
  };
  push(normalizeLocaleTag(signals.explicit));
  push(localeFromSearch(signals.search));
  push(localeFromPathname(signals.pathname));
  push(localeFromHostname(signals.hostname));
  push(normalizeLocaleTag(signals.documentLang));
  return out;
}

/**
 * 최종 선택. **실제로 번역이 들어 있는 언어만** 고른다.
 *
 * 빈 언어를 고르면 각 문구가 폴백 사슬을 타서 기본 언어로 돌아오는데, 그러면 화면이
 * 반쯤 섞인다(번역한 라벨만 영어, 나머지는 한국어). 차라리 통째로 기본 언어인 편이 낫다 —
 * 섞인 화면은 운영자가 "번역을 넣었는데 왜 안 나오지" 로 읽고 원인을 못 찾는다.
 */
export function resolveFormLocale(
  signals: HostLocaleSignals,
  available: readonly string[],
  fallback: string,
): string {
  const pool = new Set(available.filter(Boolean));
  for (const candidate of hostLocaleCandidates(signals)) {
    if (pool.has(candidate)) return candidate;
  }
  return fallback;
}

/**
 * 브라우저에서 신호를 읽어 바로 고른다. 임베드 런타임의 진입점.
 *
 * `root` 는 폼이 붙는 자리(또는 스크립트 태그) — 거기서 위로 올라가며 `data-mach-lang` 을
 * 찾는다. 호스트가 섹션 단위로 언어를 가르는 경우(한 페이지 안에 영문 블록)가 있어서
 * 가장 가까운 조상의 값을 쓴다.
 */
export function detectFormLocale(
  root: Element | null,
  available: readonly string[],
  fallback: string,
): string {
  if (typeof document === "undefined") return fallback;
  let explicit: string | null = null;
  try {
    explicit =
      (root?.closest?.("[data-mach-lang]") as HTMLElement | null)?.getAttribute("data-mach-lang") ??
      document.documentElement.getAttribute("data-mach-lang");
  } catch {
    explicit = null;
  }
  return resolveFormLocale(
    {
      explicit,
      search: typeof location !== "undefined" ? location.search : null,
      pathname: typeof location !== "undefined" ? location.pathname : null,
      hostname: typeof location !== "undefined" ? location.hostname : null,
      documentLang: document.documentElement.getAttribute("lang"),
    },
    available,
    fallback,
  );
}

/**
 * **날 신호 목록**에서 언어를 고른다 — 임베드 로더처럼 판정 로직을 둘 수 없는 쪽을 위한 입구.
 *
 * 웨비나 로더(`/w/{id}`)는 번들이 아니라 서버가 만든 문자열이라 이 모듈을 import 할 수 없다.
 * 그래서 로더는 **읽기만** 한다(data-mach-lang, ?lang=, 경로 첫 조각, html lang) — 네 값을
 * 그대로 설정 요청에 실어 보내고, 판정은 여기서 한다. 계산을 두 벌로 만들지 않기 위해서다
 * (색 계산이 네 벌로 갈라져 생긴 사고가 이미 있다 — `lib/color.ts` 머리말).
 *
 * 순서는 보낸 쪽이 정한다. 로더는 `hostLocaleCandidates` 와 같은 우선순위로 싣는다.
 */
export function resolveLocaleFromRawSignals(
  raw: readonly (string | null | undefined)[],
  available: readonly string[],
  fallback: string,
): string {
  const pool = new Set(available.filter(Boolean));
  for (const signal of raw) {
    const code = normalizeLocaleTag(signal);
    if (code && pool.has(code)) return code;
  }
  return fallback;
}

/**
 * 로더가 실어 보낸 `hl=a|b|c|d|e` 를 신호 배열로 되읽는다. 빈 조각은 신호가 없다는 뜻.
 *
 * 다섯 칸인 이유는 `hostLocaleCandidates` 의 신호가 다섯이기 때문이다
 * (data-mach-lang · ?lang= · 경로 · 호스트명 · html lang). 상한을 두는 것은 캐시 키가
 * 끝없이 갈라지지 못하게 하려는 것이다 — 이 값은 설정 응답의 캐시 키에 들어간다.
 */
export function parseLocaleSignalParam(value: string | null): string[] {
  if (!value) return [];
  return value.split("|").slice(0, 5);
}

/**
 * 글의 **문자 체계**로 언어를 추정한다. 못 알아보면 null — 추측하지 않는다.
 *
 * ── 어디에 쓰나 ───────────────────────────────────────────────────────
 * 수집 빌더의 기본 로케일이 오래 `"en"` 이었다(첫 사용처가 LA 전시). 그래서 국문으로 만든
 * 기존 폼의 글은 전부 `{"en": "성함"}` 으로 저장돼 있고, 그 상태에서는 **영어 번역을 추가할
 * 수가 없다** — "English" 가 이미 기본 언어 자리를 차지하고 있어 추가 목록에서 빠진다.
 * 운영자가 스스로 그 원인을 찾을 방법은 없다. 그래서 편집 화면이 먼저 알려 준다.
 *
 * ── 왜 문자 체계만 보나 ───────────────────────────────────────────────
 * 언어 판별 라이브러리를 들이지 않는다. 우리가 답해야 하는 질문은 "무슨 언어인가" 가 아니라
 * **"기본 언어 표시가 글과 어긋났는가"** 뿐이고, 그 어긋남은 거의 전부 한국어·일본어·중국어
 * 글이 영어로 표시된 경우다. 문자 체계는 그걸 **확실하게** 가른다.
 *
 * 라틴 문자는 null 이다 — 영어·스페인어·베트남어를 글자만으로 가를 수 없고, 틀린 추정으로
 * 운영자에게 "언어가 어긋났다" 고 말하면 그 안내 자체를 못 믿게 된다.
 */
export function guessTextLocale(text: string): string | null {
  if (typeof text !== "string" || !text) return null;
  if (/[\uAC00-\uD7A3\u1100-\u11FF]/.test(text)) return "ko"; // 한글 음절·자모
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return "ja"; // 히라가나·가타카나
  // 한자만 있고 가나·한글이 없으면 중국어로 본다 — 일본어 글에는 거의 항상 가나가 섞인다.
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  return null;
}

/**
 * 여러 문구를 합쳐 본 추정. 한 줄만 보면 고유명사("Email") 하나에 판정이 흔들린다.
 * **가장 많이 나온 문자 체계**를 쓴다.
 */
export function guessLocaleOfTexts(texts: readonly string[]): string | null {
  const tally = new Map<string, number>();
  for (const t of texts) {
    const guess = guessTextLocale(t);
    if (guess) tally.set(guess, (tally.get(guess) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [locale, count] of tally) {
    if (count > bestCount) {
      best = locale;
      bestCount = count;
    }
  }
  return best;
}
