import { describe, expect, it } from "vitest";
import {
  collectFormLocales,
  editableFormLocales,
  localize,
  normalizeCollectForm,
} from "@/lib/collect-form-config";
import {
  collectTranslationEntries,
  dropFormLocale,
  exactLocalized,
  putLocalized,
  retagFormLocale,
  translationProgress,
} from "@/lib/collect-form-i18n";

/**
 * **"한 폼, 여러 언어, 한 테이블"의 계약.**
 *
 * 언어마다 폼을 따로 만들면 등록 데이터가 갈라진다 — 그게 이 기능이 존재하는 이유다.
 * 그래서 여기서 지키는 것은 문구 번역이 아니라 **구조가 언어와 무관하다**는 사실이다.
 */

function form(overrides: Record<string, unknown> = {}) {
  return normalizeCollectForm({
    defaultLocale: "ko",
    fields: [
      { id: "f1", key: "name", label: { ko: "성함" }, type: "text", required: true, enabled: true, placeholder: { ko: "홍길동" } },
      {
        id: "f2",
        key: "role",
        label: { ko: "참가 구분" },
        type: "select",
        enabled: true,
        options: [{ ko: "바이어" }, { ko: "참관객" }],
      },
    ],
    consent: { privacy: { enabled: true, label: { ko: "개인정보 수집에 동의합니다" }, body: { ko: "수집 항목: 이름" } } },
    submitLabel: { ko: "등록하기" },
    ...overrides,
  });
}

describe("번역 칸 뽑기", () => {
  it("원문이 있는 칸만 나오고, 묶음·순서가 폼 순서를 따른다", () => {
    const entries = collectTranslationEntries(form(), "en");
    expect(entries.map((e) => e.context)).toEqual([
      "성함 · 라벨",
      "성함 · 입력칸 안내",
      "참가 구분 · 라벨",
      "참가 구분 · 선택지 1",
      "참가 구분 · 선택지 2",
      "개인정보 수집·이용 · 문구",
      "개인정보 수집·이용 · 전문",
      "제출 버튼",
    ]);
  });

  /** 꺼진 항목은 방문자에게 안 보인다 — 번역을 요구하면 진행률이 영영 100% 가 안 된다. */
  it("꺼진 항목은 세지 않는다", () => {
    const config = form({
      fields: [{ id: "f1", key: "name", label: { ko: "성함" }, type: "text", enabled: false }],
      consent: { privacy: { enabled: false } },
      submitLabel: {},
    });
    expect(collectTranslationEntries(config, "en")).toHaveLength(0);
  });

  it("쓰면 그 언어 칸에만 들어간다 — 원문은 그대로", () => {
    const base = form();
    const entry = collectTranslationEntries(base, "en").find((e) => e.context === "성함 · 라벨")!;
    const next = entry.write(base, "Full name");

    expect(localize(next.fields[0].label, "en")).toBe("Full name");
    expect(localize(next.fields[0].label, "ko")).toBe("성함");
    // 원본 객체는 건드리지 않는다(자동저장이 직전 값과 비교한다).
    expect(localize(base.fields[0].label, "en")).toBe("성함");
  });

  it("진행률은 채운 칸 수", () => {
    const base = form();
    const first = collectTranslationEntries(base, "en")[0];
    const next = first.write(base, "Full name");
    expect(translationProgress(collectTranslationEntries(base, "en")).done).toBe(0);
    expect(translationProgress(collectTranslationEntries(next, "en")).done).toBe(1);
  });

  /**
   * **구조는 언어와 무관하다.** 번역을 아무리 채워도 저장 키가 늘거나 바뀌지 않는다 —
   * 이게 깨지면 영문 등록과 국문 등록이 다른 열에 쌓인다.
   */
  it("번역을 채워도 저장 키는 그대로", () => {
    let config = form();
    for (const entry of collectTranslationEntries(config, "en")) {
      config = entry.write(config, "EN:" + entry.base);
    }
    expect(config.fields.map((f) => f.key)).toEqual(["name", "role"]);
    expect(config.fields[1].options).toHaveLength(2);
  });
});

describe("로케일 맵 쓰기", () => {
  it("폴백 없이 그 언어 값만 읽는다", () => {
    expect(exactLocalized({ ko: "성함" }, "en")).toBe("");
    expect(localize({ ko: "성함" }, "en")).toBe("성함"); // localize 는 폴백한다 — 대비
  });

  /** 빈 문자열이 남으면 `collectFormLocales` 가 "번역이 있다"로 세고 라벨만 빈 폼이 나간다. */
  it("빈 값은 키를 지운다", () => {
    expect(putLocalized({ ko: "성함", en: "Name" }, "en", "")).toEqual({ ko: "성함" });
    expect(putLocalized({ ko: "성함", en: "Name" }, "en", "   ")).toEqual({ ko: "성함" });
    expect(putLocalized({ ko: "성함" }, "en", "Name")).toEqual({ ko: "성함", en: "Name" });
  });
});

describe("언어 목록 — 두 가지 질문", () => {
  /** 런타임이 보는 것: **실제 번역이 있는 언어**. 방문자 화면은 글이 있을 때만 바뀐다. */
  it("collectFormLocales 는 글이 있는 언어만", () => {
    expect(collectFormLocales(form())).toEqual(["ko"]);
    const withEn = collectTranslationEntries(form(), "en")[0].write(form(), "Full name");
    expect(collectFormLocales(withEn)).toEqual(["ko", "en"]);
  });

  /** 편집 화면이 보는 것: **열어 둔 언어**까지. 한 글자도 안 적은 탭이 새로고침에 안 사라진다. */
  it("editableFormLocales 는 비어 있는 언어도 남긴다", () => {
    const opened = form({ locales: ["en", "ja"] });
    expect(collectFormLocales(opened)).toEqual(["ko"]);
    expect(editableFormLocales(opened)).toEqual(["ko", "en", "ja"]);
  });

  it("기본 언어는 목록에 중복으로 들어가지 않는다", () => {
    expect(form({ locales: ["ko", "en"] }).locales).toEqual(["en"]);
  });
});

describe("기본 언어 바꾸기", () => {
  /**
   * 빌더의 기본 로케일이 오래 "en" 이었다(첫 사용처가 LA 전시). 국문으로 만든 폼의 글이
   * 전부 `{"en": "성함"}` 으로 저장돼 있고, 그 상태에서 영어 번역을 추가하면 같은 칸을
   * 덮어써 **국문 원문이 사라진다.** 그래서 글을 통째로 옮겨 준다.
   */
  it("저장된 글의 로케일 키를 통째로 옮긴다", () => {
    const enBase = normalizeCollectForm({
      defaultLocale: "en",
      fields: [{ id: "f1", key: "name", label: { en: "성함" }, type: "text", enabled: true }],
      submitLabel: { en: "등록하기" },
    });
    const moved = retagFormLocale(enBase, "en", "ko");

    expect(moved.defaultLocale).toBe("ko");
    expect(moved.fields[0].label).toEqual({ ko: "성함" });
    expect(moved.submitLabel).toEqual({ ko: "등록하기" });
    // 옛 기본 언어는 이제 번역 대상이다.
    expect(moved.locales).toContain("en");
  });

  it("이미 목적지 번역이 있으면 덮어쓰지 않는다", () => {
    const both = normalizeCollectForm({
      defaultLocale: "en",
      fields: [{ id: "f1", key: "name", label: { en: "Name", ko: "성함" }, type: "text", enabled: true }],
    });
    expect(retagFormLocale(both, "en", "ko").fields[0].label).toEqual({ en: "Name", ko: "성함" });
  });

  it("같은 언어로 바꾸면 아무것도 안 한다", () => {
    const f = form();
    expect(retagFormLocale(f, "ko", "ko")).toBe(f);
  });
});

describe("언어 지우기", () => {
  /** 목록에서만 빼면 글이 남아 런타임이 그 언어로 계속 바뀐다 — "지웠는데 다시 생긴다". */
  it("글까지 함께 지운다", () => {
    let config = form({ locales: ["en"] });
    for (const entry of collectTranslationEntries(config, "en")) {
      config = entry.write(config, "EN:" + entry.base);
    }
    expect(collectFormLocales(config)).toContain("en");

    const dropped = dropFormLocale(config, "en");
    expect(collectFormLocales(dropped)).toEqual(["ko"]);
    expect(editableFormLocales(dropped)).toEqual(["ko"]);
    // 기본 언어 글은 그대로 남는다.
    expect(localize(dropped.fields[0].label, "ko")).toBe("성함");
  });

  it("기본 언어는 지워지지 않는다", () => {
    const f = form();
    expect(dropFormLocale(f, "ko")).toBe(f);
  });
});

describe("기존 폼에 언어를 더하는 길 — 실제 시나리오", () => {
  /**
   * 수집 빌더의 기본 로케일이 오래 `"en"` 이었다(첫 사용처가 LA 전시). 그래서 국문으로 만든
   * **기존 폼은 전부** 글이 `{"en": "성함"}` 으로 저장돼 있다. 그 상태에서는:
   *  · "English" 가 원문 자리를 차지해 영어 번역을 추가할 수 없고,
   *  · 운영자가 그 원인을 스스로 찾을 방법이 없다.
   *
   * 길은 하나다: 기본 언어를 한국어로 **정정**하면 글이 ko 칸으로 옮겨지고, 비게 된 en 이
   * 번역 대상이 된다. 기존 폼을 건드리지 않아도 지금처럼 그대로 돌아가고, 언어를 더하려는
   * 사람만 이 길을 지난다.
   */
  it("기본 언어를 정정하면 그때부터 영어를 더할 수 있다", () => {
    // 1. 기존 폼 — 표시는 en, 글은 한국어.
    const legacy = normalizeCollectForm({
      defaultLocale: "en",
      fields: [
        { id: "f1", key: "name", label: { en: "성함" }, type: "text", enabled: true, required: true },
        { id: "f2", key: "role", label: { en: "참가 구분" }, type: "select", enabled: true, options: [{ en: "바이어" }] },
      ],
      submitLabel: { en: "등록하기" },
    });
    // 이 상태에서는 편집 탭이 "English(기본)" 하나뿐 — 영어를 더할 자리가 없다.
    expect(editableFormLocales(legacy)).toEqual(["en"]);

    // 2. 정정 — 글이 ko 칸으로 옮겨지고 en 이 번역 대상이 된다.
    const fixed = retagFormLocale(legacy, "en", "ko");
    expect(fixed.defaultLocale).toBe("ko");
    expect(localize(fixed.fields[0].label, "ko")).toBe("성함");
    expect(editableFormLocales(fixed)).toEqual(["ko", "en"]);

    // 3. 이제 영어 번역을 채운다 — 저장 키는 한 글자도 안 바뀐다.
    let filled = fixed;
    for (const entry of collectTranslationEntries(fixed, "en")) {
      filled = entry.write(filled, "EN:" + entry.base);
    }
    expect(filled.fields.map((f) => f.key)).toEqual(["name", "role"]);
    expect(localize(filled.fields[0].label, "en")).toBe("EN:성함");
    expect(localize(filled.fields[0].label, "ko")).toBe("성함");
    // 런타임이 보는 언어 — 이제 둘.
    expect(collectFormLocales(filled)).toEqual(["ko", "en"]);
  });

  /** 아무 조치도 안 하면 **지금과 똑같이** 동작한다 — 기존 폼을 강제로 고치지 않는다. */
  it("정정하지 않은 기존 폼은 한 언어 폼으로 그대로 돈다", () => {
    const legacy = normalizeCollectForm({
      defaultLocale: "en",
      fields: [{ id: "f1", key: "name", label: { en: "성함" }, type: "text", enabled: true }],
    });
    expect(collectFormLocales(legacy)).toEqual(["en"]);
    expect(legacy.locales).toEqual([]);
    expect(localize(legacy.fields[0].label, "en")).toBe("성함");
  });
});
