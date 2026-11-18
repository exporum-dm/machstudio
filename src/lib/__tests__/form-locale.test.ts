import { describe, expect, it } from "vitest";
import {
  formLocaleLabel,
  guessLocaleOfTexts,
  guessTextLocale,
  hostLocaleCandidates,
  localeFromHostname,
  localeFromPathname,
  localeFromSearch,
  normalizeLocaleTag,
  parseLocaleSignalParam,
  resolveFormLocale,
  resolveLocaleFromRawSignals,
} from "@/lib/form-locale";

/**
 * **호스트 페이지의 언어를 읽는 규칙.**
 *
 * 이 판정이 틀리면 국문 페이지에 영문 폼이, 영문 페이지에 국문 폼이 박힌다 — 방문자에게는
 * 사이트가 고장 난 것으로 보이고, 운영자는 "폼은 분명 번역했는데" 에서 막힌다.
 * 그래서 신호의 **우선순위**까지 테스트로 못 박는다.
 */

describe("normalizeLocaleTag", () => {
  it("지역 꼬리표를 떼고 2글자로 좁힌다", () => {
    expect(normalizeLocaleTag("en-US")).toBe("en");
    expect(normalizeLocaleTag("ko-KR")).toBe("ko");
    expect(normalizeLocaleTag("zh-Hant-TW")).toBe("zh");
    expect(normalizeLocaleTag("  KO  ")).toBe("ko");
    expect(normalizeLocaleTag("ja_JP")).toBe("ja");
  });

  /** 다국어 플러그인·운영자가 실제로 적는 비표준 약어들. */
  it("흔한 약어를 받아 준다", () => {
    expect(normalizeLocaleTag("kr")).toBe("ko");
    expect(normalizeLocaleTag("jp")).toBe("ja");
    expect(normalizeLocaleTag("cn")).toBe("zh");
    expect(normalizeLocaleTag("tw")).toBe("zh");
  });

  /** 모르는 언어를 **추측하지 않는다** — 추측이 틀리면 폼이 통째로 딴 언어가 된다. */
  it("모르는 값은 null", () => {
    for (const bad of ["", "   ", "xx", "klingon", "123", null, undefined, {}]) {
      expect(normalizeLocaleTag(bad as unknown as string)).toBeNull();
    }
  });
});

describe("localeFromPathname", () => {
  it("첫 조각이 언어면 그 언어", () => {
    expect(localeFromPathname("/en/events/expo")).toBe("en");
    expect(localeFromPathname("/ko-KR/apply")).toBe("ko");
    expect(localeFromPathname("/jp/")).toBe("ja");
  });

  /** 평범한 경로를 언어로 읽으면 안 된다 — /es-tore/ 가 스페인어가 되던 자리. */
  it("언어 태그 모양이 아니면 보지 않는다", () => {
    for (const p of ["/events/en", "/estore/x", "/english/x", "/", "", "/apply"]) {
      expect(localeFromPathname(p)).toBeNull();
    }
  });
});

describe("localeFromSearch", () => {
  it("lang · hl · locale · language 를 모두 본다", () => {
    expect(localeFromSearch("?lang=en")).toBe("en");
    expect(localeFromSearch("hl=ja")).toBe("ja");
    expect(localeFromSearch("?a=1&locale=zh-CN")).toBe("zh");
    expect(localeFromSearch("?language=kr")).toBe("ko");
  });

  it("없거나 모르는 값이면 null", () => {
    expect(localeFromSearch("?x=1")).toBeNull();
    expect(localeFromSearch("?lang=xx")).toBeNull();
    expect(localeFromSearch("")).toBeNull();
  });
});

describe("hostLocaleCandidates — 우선순위", () => {
  /**
   * `<html lang>` 이 맨 뒤인 이유: 가장 흔하지만 **제일 자주 틀려 있다**(템플릿 기본값 ko 를
   * 그대로 둔 채 영문 페이지를 만든 사이트가 많다). 운영자가 직접 적은 값이 항상 이긴다.
   */
  it("data-mach-lang → 쿼리 → 경로 → html lang", () => {
    expect(
      hostLocaleCandidates({ explicit: "ja", search: "?lang=en", pathname: "/zh/x", documentLang: "ko" }),
    ).toEqual(["ja", "en", "zh", "ko"]);
  });

  it("없는 신호는 건너뛰고 중복은 한 번만", () => {
    expect(hostLocaleCandidates({ search: "?lang=en", pathname: "/en/x", documentLang: "en" })).toEqual(["en"]);
    expect(hostLocaleCandidates({})).toEqual([]);
  });
});

describe("resolveFormLocale", () => {
  /**
   * **실제 번역이 있는 언어만** 고른다. 빈 언어를 고르면 문구마다 폴백이 걸려 화면이
   * 반쯤 섞이고(번역한 라벨만 영어), 운영자는 원인을 못 찾는다.
   */
  it("번역이 없는 언어는 고르지 않는다", () => {
    expect(resolveFormLocale({ documentLang: "ja" }, ["ko", "en"], "ko")).toBe("ko");
    expect(resolveFormLocale({ documentLang: "en" }, ["ko", "en"], "ko")).toBe("en");
  });

  it("신호가 없으면 기본 언어", () => {
    expect(resolveFormLocale({}, ["ko", "en"], "ko")).toBe("ko");
  });

  /** 사람의 언어(navigator.language)는 신호에 **없다** — 기준은 페이지의 언어다. */
  it("우선순위가 높은 신호가 번역이 없으면 다음 신호로 내려간다", () => {
    expect(resolveFormLocale({ explicit: "ja", documentLang: "en" }, ["ko", "en"], "ko")).toBe("en");
  });
});

describe("formLocaleLabel", () => {
  it("아는 코드는 그 언어 이름으로, 모르는 코드는 코드 그대로", () => {
    expect(formLocaleLabel("ko")).toBe("한국어");
    expect(formLocaleLabel("en")).toBe("English");
    expect(formLocaleLabel("xx")).toBe("xx");
  });
});

describe("날 신호 목록 — 임베드 로더가 보내는 값", () => {
  /**
   * 웨비나 로더는 서버가 만든 문자열이라 이 모듈을 import 할 수 없다. 그래서 로더는
   * **읽기만** 하고(data-mach-lang, ?lang=, 경로 첫 조각, html lang) 판정은 서버가 한다.
   * 계산을 두 벌로 만들지 않기 위한 입구다 — 색 계산이 네 벌로 갈라져 생긴 사고가 이미 있다.
   */
  it("hl=a|b|c|d|e 를 신호 배열로 되읽는다", () => {
    expect(parseLocaleSignalParam("ja|en|zh|vi|ko")).toEqual(["ja", "en", "zh", "vi", "ko"]);
    expect(parseLocaleSignalParam("||en|ko")).toEqual(["", "", "en", "ko"]);
    expect(parseLocaleSignalParam("")).toEqual([]);
    expect(parseLocaleSignalParam(null)).toEqual([]);
  });

  /**
   * 신호가 끝없이 늘어나지 못하게 — 로더는 다섯만 보낸다
   * (data-mach-lang · ?lang= · 경로 · 호스트명 · html lang). 이 값은 설정 응답의 캐시 키에
   * 들어가므로 상한이 없으면 캐시가 갈라질 수 있다.
   */
  it("조각은 다섯까지만 본다", () => {
    expect(parseLocaleSignalParam("a|b|c|d|e|f|g")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("보낸 순서대로, 번역이 있는 첫 언어를 고른다", () => {
    expect(resolveLocaleFromRawSignals(["ja", "en-US", "", "ko"], ["ko", "en"], "ko")).toBe("en");
    expect(resolveLocaleFromRawSignals(["", "", "", "KR"], ["ko", "en"], "ko")).toBe("ko");
    expect(resolveLocaleFromRawSignals([], ["ko", "en"], "ko")).toBe("ko");
    // 번역이 없는 언어는 고르지 않는다 — 폴백 때문에 화면이 그대로여서 원인이 안 보인다.
    expect(resolveLocaleFromRawSignals(["ja"], ["ko", "en"], "ko")).toBe("ko");
  });

  it("빈 값·모르는 값은 건너뛴다", () => {
    expect(resolveLocaleFromRawSignals([null, undefined, "xx", "events", "en"], ["ko", "en"], "ko")).toBe("en");
  });
});

describe("localeFromHostname — 언어별 서브도메인", () => {
  /**
   * 우리 전시 사이트가 이 형태다: `en.japan.k-expo.org`(영문) · `jp.japan.k-expo.org`(일본어).
   * 경로만 보던 동안 이 사이트에서는 URL 신호가 하나도 없었고, `<html lang>` 하나에
   * 매달렸다 — 그 값은 템플릿 기본값이 남아 있기 쉬워 **영문 페이지에 국문 폼**이 나간다.
   */
  it("첫 라벨이 언어면 그 언어", () => {
    expect(localeFromHostname("en.japan.k-expo.org")).toBe("en");
    expect(localeFromHostname("jp.japan.k-expo.org")).toBe("ja");
    expect(localeFromHostname("KO.example.com")).toBe("ko");
    expect(localeFromHostname("zh-cn.example.com")).toBe("zh");
  });

  /** 언어가 아닌 라벨은 모양 검사와 아는 언어 목록에서 두 번 걸러진다. */
  it("언어가 아닌 첫 라벨은 보지 않는다", () => {
    for (const h of ["japan.k-expo.org", "www.k-expo.org", "k-expo.org", "shop.example.com", "", "localhost"]) {
      expect(localeFromHostname(h)).toBeNull();
    }
  });

  it("문자열이 아니어도 안전하다", () => {
    expect(localeFromHostname(null)).toBeNull();
    expect(localeFromHostname(undefined)).toBeNull();
  });
});

describe("경로와 서브도메인이 어긋날 때", () => {
  /**
   * 경로가 호스트명보다 앞이다. 서브도메인은 **사이트 전체**의 언어를 말하고 경로는
   * **그 페이지**의 언어를 말하므로, 둘이 어긋나면 더 좁은 쪽을 믿는 게 맞다.
   */
  it("경로가 호스트명을 이긴다", () => {
    expect(
      hostLocaleCandidates({ pathname: "/ko/apply", hostname: "en.japan.k-expo.org", documentLang: "ja" }),
    ).toEqual(["ko", "en", "ja"]);
  });

  /** 실제 사이트 모양 — 경로에는 언어가 없고 서브도메인에만 있다. */
  it("경로에 언어가 없으면 서브도메인이 답한다", () => {
    expect(hostLocaleCandidates({ pathname: "/exhibition/items", hostname: "en.japan.k-expo.org" })).toEqual(["en"]);
    expect(resolveFormLocale({ pathname: "/", hostname: "jp.japan.k-expo.org" }, ["ko", "ja"], "ko")).toBe("ja");
  });

  /** html lang 이 템플릿 기본값(ko)으로 남아 있어도 서브도메인이 먼저 답한다. */
  it("틀린 html lang 을 서브도메인이 구해 준다", () => {
    expect(resolveFormLocale({ hostname: "en.japan.k-expo.org", documentLang: "ko" }, ["ko", "en"], "ko")).toBe("en");
  });
});

describe("글의 문자 체계로 언어 추정", () => {
  /**
   * 쓰는 곳은 하나다: **기본 언어 표시가 글과 어긋났는가.** 수집 빌더의 기본 로케일이 오래
   * "en" 이었어서 국문으로 만든 기존 폼은 전부 그 상태이고, 그러면 "English" 가 원문 자리를
   * 차지해 영어 번역을 추가할 수 없다. 운영자가 스스로 찾을 수 없는 원인이라 먼저 알린다.
   */
  it("문자 체계로 한국어·일본어·중국어를 가른다", () => {
    expect(guessTextLocale("성함")).toBe("ko");
    expect(guessTextLocale("참가 구분")).toBe("ko");
    expect(guessTextLocale("お名前")).toBe("ja");
    expect(guessTextLocale("カタカナ")).toBe("ja");
    expect(guessTextLocale("姓名")).toBe("zh");
  });

  /** 일본어 글에는 거의 항상 가나가 섞인다 — 한자가 있어도 가나가 있으면 일본어다. */
  it("가나가 섞인 한자는 일본어", () => {
    expect(guessTextLocale("お申し込み内容")).toBe("ja");
  });

  /**
   * 라틴 문자는 **추측하지 않는다.** 영어·스페인어·베트남어를 글자만으로 가를 수 없고,
   * 틀린 추정으로 "언어가 어긋났다" 고 말하면 그 안내 자체를 못 믿게 된다.
   */
  it("라틴 문자는 null", () => {
    for (const t of ["Full name", "Nombre completo", "", "   ", "01012345678"]) {
      expect(guessTextLocale(t)).toBeNull();
    }
  });

  /** 한 줄만 보면 고유명사("Email") 하나에 판정이 흔들린다 — 가장 많이 나온 쪽을 쓴다. */
  it("여러 문구에서는 다수를 따른다", () => {
    expect(guessLocaleOfTexts(["Email", "성함", "연락처", "회사명"])).toBe("ko");
    expect(guessLocaleOfTexts(["Email", "Full name", "Company"])).toBeNull();
    expect(guessLocaleOfTexts([])).toBeNull();
  });
});
