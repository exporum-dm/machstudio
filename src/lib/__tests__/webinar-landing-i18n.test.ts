import { describe, expect, it } from "vitest";
import {
  applyLandingLocale,
  landingEditableLocales,
  landingTranslatedLocales,
  normalizeLandingPageConfig,
} from "@/lib/webinar-config";
import {
  dropLandingLocale,
  landingTranslationEntries,
  retagLandingLocale,
} from "@/lib/webinar-landing-i18n";
import { translationProgress } from "@/lib/translation-entry";

/**
 * **"상세페이지 하나를 여러 언어 페이지에 붙인다"의 계약.**
 *
 * 언어마다 상세페이지를 따로 만들면 운영자가 관리할 산출물이 언어 수만큼 늘고, 고칠 때마다
 * 전부를 고쳐야 한다 — 그게 이 기능이 존재하는 이유다. 그래서 여기서 지키는 것은 문구 번역이
 * 아니라 **구조가 언어와 무관하다**는 사실이다.
 */

function landing(lp: Record<string, unknown>) {
  return normalizeLandingPageConfig({ landingPage: { enabled: true, ...lp } });
}

const FULL = {
  brand: "코리아 엑스포",
  titleLines: ["한국의 영감을", "만나는 자리"],
  subtitle: "3일간의 전시",
  venue: "온라인 라이브",
  ctaLabel: "사전 등록하기",
  intro: { enabled: true, title: "이 행사는", body: "국내 브랜드를 소개합니다." },
  audience: { enabled: true, title: "이런 분들께 추천합니다", items: [{ title: "바이어", description: "소싱을 찾는 분" }] },
  faq: { enabled: true, items: [{ category: "참가", question: "비용이 있나요?", answer: "무료입니다." }] },
  sponsors: { enabled: true, title: "주최 · 후원", items: [{ tier: "주최", name: "Exporum", logoUrl: "", url: "" }] },
};

describe("덮개 적용 — applyLandingLocale", () => {
  it("번역이 있는 칸만 바뀌고 없는 칸은 원문으로 남는다", () => {
    const base = landing({
      ...FULL,
      i18n: { ja: { brand: "コリアエキスポ", audience: { items: [{ title: "バイヤー" }] } } },
    });
    const ja = applyLandingLocale(base, "ja");

    expect(ja.brand).toBe("コリアエキスポ");
    expect(ja.audience.items[0].title).toBe("バイヤー");
    // 설명은 번역 안 했다 — 섞이는 것이 비는 것보다 낫다(빈 제목은 "고장"으로 보인다).
    expect(ja.audience.items[0].description).toBe("소싱을 찾는 분");
    expect(ja.ctaLabel).toBe("사전 등록하기");
  });

  /**
   * 큰 제목만 배열을 통째로 교체한다 — 줄바꿈 위치가 언어마다 달라야 하기 때문이다
   * (한국어로 두 줄인 제목이 영어로는 세 줄이 되기도 한다).
   */
  it("큰 제목은 줄 수가 달라도 된다", () => {
    const base = landing({ ...FULL, i18n: { en: { titleLines: ["Meet", "the", "Inspiration"] } } });
    expect(applyLandingLocale(base, "en").titleLines).toEqual(["Meet", "the", "Inspiration"]);
  });

  /** **구조는 언어와 무관하다.** 항목 개수가 언어마다 다르면 같은 페이지가 다른 모양이 된다. */
  it("항목 개수는 원문을 따른다 — 번역이 남아도 늘지 않는다", () => {
    const base = landing({
      ...FULL,
      i18n: { ja: { audience: { items: [{ title: "バイヤー" }, { title: "来場者" }, { title: "報道" }] } } },
    });
    expect(applyLandingLocale(base, "ja").audience.items).toHaveLength(1);
  });

  it("회사 이름·로고는 번역하지 않고 분류만 바꾼다", () => {
    const base = landing({ ...FULL, i18n: { en: { sponsors: { items: [{ tier: "Host" }] } } } });
    const en = applyLandingLocale(base, "en");
    expect(en.sponsors.items[0].tier).toBe("Host");
    expect(en.sponsors.items[0].name).toBe("Exporum");
  });

  it("기본 언어나 없는 언어를 주면 원본을 그대로 돌려준다", () => {
    const base = landing({ ...FULL, i18n: { ja: {} } });
    expect(applyLandingLocale(base, base.defaultLocale)).toBe(base);
    expect(applyLandingLocale(base, "fr")).toBe(base);
  });

  it("빈 문자열 번역은 번역 안 한 것과 같다", () => {
    const base = landing({ ...FULL, i18n: { ja: { brand: "   " } } });
    expect(applyLandingLocale(base, "ja").brand).toBe("코리아 엑스포");
  });
});

describe("언어 목록 — 두 가지 질문", () => {
  /** 런타임이 보는 것: **실제 번역이 있는 언어**. 방문자 화면은 글이 있을 때만 바뀐다. */
  it("translatedLocales 는 글이 있는 언어만", () => {
    expect(landingTranslatedLocales(landing({ ...FULL, locales: ["ja"] }))).toEqual(["ko"]);
    expect(landingTranslatedLocales(landing({ ...FULL, i18n: { ja: { brand: "コリアエキスポ" } } }))).toEqual(["ko", "ja"]);
    // 빈 덮개는 번역이 아니다.
    expect(landingTranslatedLocales(landing({ ...FULL, i18n: { ja: { brand: "  " } } }))).toEqual(["ko"]);
  });

  /** 편집 화면이 보는 것: **열어 둔 언어**까지. 한 글자도 안 적은 탭이 새로고침에 안 사라진다. */
  it("editableLocales 는 비어 있는 언어도 남긴다", () => {
    const opened = landing({ ...FULL, locales: ["ja", "en"] });
    expect(landingTranslatedLocales(opened)).toEqual(["ko"]);
    expect(landingEditableLocales(opened)).toEqual(["ko", "ja", "en"]);
  });

  it("기본 언어는 ko — 랜딩 문구는 처음부터 한국어였다", () => {
    expect(landing(FULL).defaultLocale).toBe("ko");
    expect(landing({ ...FULL, defaultLocale: "EN" }).defaultLocale).toBe("en");
  });
});

describe("번역 칸 뽑기", () => {
  it("원문이 있는 칸만, 섹션 순서대로 나온다", () => {
    const groups = [...new Set(landingTranslationEntries(landing(FULL), "ja").map((e) => e.group))];
    // "참여 방법" 은 운영자가 비워 둬도 기본 3단계가 방문자에게 나간다
    // (DEFAULT_LANDING_JOIN_STEPS) — 보이는 글이므로 번역 대상이다.
    expect(groups).toEqual(["히어로", "소개", "추천 대상", "참여 방법", "자주 묻는 질문", "주최 · 후원"]);
  });

  /** 꺼진 섹션은 방문자에게 안 보인다 — 번역을 요구하면 진행률이 영영 100% 가 안 된다. */
  it("꺼진 섹션은 세지 않는다", () => {
    const off = landing({ ...FULL, intro: { enabled: false, title: "이 행사는", body: "본문" } });
    expect(landingTranslationEntries(off, "ja").some((e) => e.group === "소개")).toBe(false);
  });

  it("빈 원문은 칸을 만들지 않는다", () => {
    const bare = landing({
      brand: "브랜드",
      titleLines: [],
      subtitle: "",
      venue: "",
      ctaLabel: "",
      // 기본 단계가 들어오는 섹션은 끄고 본다 — 여기서 보려는 건 "빈 칸은 안 나온다" 하나다.
      join: { enabled: false },
    });
    expect(landingTranslationEntries(bare, "ja").map((e) => e.context)).toEqual(["브랜드 라벨"]);
  });

  it("쓰면 덮개에만 들어가고 원문은 그대로", () => {
    const base = landing(FULL);
    const entry = landingTranslationEntries(base, "ja").find((e) => e.context === "브랜드 라벨")!;
    const next = entry.write(base, "コリアエキスポ");

    expect(next.i18n.ja?.brand).toBe("コリアエキスポ");
    expect(next.brand).toBe("코리아 엑스포");
    // 원본 객체는 건드리지 않는다(자동저장이 직전 값과 비교한다).
    expect(base.i18n.ja).toBeUndefined();
  });

  it("큰 제목은 한 칸에서 줄바꿈으로 편집한다", () => {
    const base = landing(FULL);
    const entry = landingTranslationEntries(base, "en").find((e) => e.id === "titleLines")!;
    expect(entry.base).toBe("한국의 영감을\n만나는 자리");
    expect(entry.multiline).toBe(true);
    expect(entry.write(base, "Meet\nthe\nInspiration").i18n.en?.titleLines).toEqual(["Meet", "the", "Inspiration"]);
  });

  it("배열 항목은 원문 길이에 맞춘 자리에 들어간다", () => {
    const base = landing({
      ...FULL,
      audience: { enabled: true, title: "제목", items: [{ title: "바이어", description: "설명" }, { title: "참관객", description: "설명2" }] },
    });
    const second = landingTranslationEntries(base, "ja").find((e) => e.id === "audience:1:title")!;
    expect(second.write(base, "来場者").i18n.ja?.audience?.items).toEqual([
      { title: undefined, description: undefined },
      { title: "来場者", description: undefined },
    ]);
  });

  it("비우면 번역이 '있다'고 세어지지 않는다", () => {
    const base = landing({ ...FULL, i18n: { ja: { brand: "コリアエキスポ" } } });
    const entry = landingTranslationEntries(base, "ja").find((e) => e.context === "브랜드 라벨")!;
    expect(landingTranslatedLocales(entry.write(base, ""))).toEqual(["ko"]);
  });

  it("진행률은 채운 칸 수", () => {
    const base = landing(FULL);
    const entries = landingTranslationEntries(base, "ja");
    expect(translationProgress(entries).done).toBe(0);
    const next = entries[0].write(base, "コリアエキスポ");
    expect(translationProgress(landingTranslationEntries(next, "ja")).done).toBe(1);
  });

  /**
   * **이게 깨지면 기능의 전제가 무너진다.** 번역을 아무리 채워도 방문자가 보는 구조
   * (섹션 토글·항목 개수·줄 수를 뺀 나머지)는 원문과 같아야 한다.
   */
  it("번역을 전부 채워도 항목 개수와 토글이 그대로", () => {
    let config = landing(FULL);
    for (const entry of landingTranslationEntries(config, "ja")) {
      config = entry.write(config, "JA:" + entry.base);
    }
    const ja = applyLandingLocale(config, "ja");
    expect(ja.audience.items).toHaveLength(config.audience.items.length);
    expect(ja.faq.items).toHaveLength(config.faq.items.length);
    expect(ja.sponsors.items).toHaveLength(config.sponsors.items.length);
    expect(ja.intro.enabled).toBe(config.intro.enabled);
    expect(ja.sponsors.items[0].name).toBe("Exporum");
  });
});

describe("언어 지우기 · 원문 언어 정정", () => {
  it("덮개까지 함께 지운다", () => {
    const base = landing({ ...FULL, locales: ["ja"], i18n: { ja: { brand: "コリアエキスポ" } } });
    expect(landingTranslatedLocales(base)).toEqual(["ko", "ja"]);

    const dropped = dropLandingLocale(base, "ja");
    expect(landingTranslatedLocales(dropped)).toEqual(["ko"]);
    expect(landingEditableLocales(dropped)).toEqual(["ko"]);
    expect(dropped.brand).toBe("코리아 엑스포");
  });

  it("기본 언어는 지워지지 않는다", () => {
    const base = landing(FULL);
    expect(dropLandingLocale(base, "ko")).toBe(base);
  });

  it("원문 언어 정정은 글을 옮기지 않고 선언만 바꾼다", () => {
    const base = landing({ ...FULL, locales: ["ja"] });
    const fixed = retagLandingLocale(base, "en");
    expect(fixed.defaultLocale).toBe("en");
    expect(fixed.brand).toBe("코리아 엑스포");
    expect(fixed.i18n).toEqual(base.i18n);
  });

  /** 목적지에 덮개가 있으면 원문과 겹친다 — 아무것도 하지 않는다. */
  it("목적지에 번역이 있으면 거부한다", () => {
    const base = landing({ ...FULL, i18n: { en: { brand: "Korea Expo" } } });
    expect(retagLandingLocale(base, "en")).toBe(base);
  });
});
