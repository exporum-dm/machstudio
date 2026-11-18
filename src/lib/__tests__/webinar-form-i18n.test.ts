import { describe, expect, it } from "vitest";
import {
  applyWebinarFormLocale,
  normalizeRegistrationForm,
  toBaseLocaleAnswer,
  webinarFormEditableLocales,
  webinarFormTranslatedLocales,
} from "@/lib/webinar-config";
import {
  dropWebinarFormLocale,
  retagWebinarFormLocale,
  webinarFormLocaleMismatch,
  webinarTranslationEntries,
} from "@/lib/webinar-form-i18n";
import { translationProgress } from "@/lib/translation-entry";

/**
 * **"한 폼, 여러 언어, 한 명단"의 계약.**
 *
 * 언어마다 폼을 따로 만들면 등록이 두 명단으로 갈라진다 — 그게 이 기능이 존재하는 이유다.
 * 그래서 여기서 지키는 것은 문구 번역이 아니라 두 가지 사실이다:
 *  (1) 구조(저장 키·선택지 개수)는 언어와 무관하다.
 *  (2) **저장되는 값은 언제나 원문 어휘**다 — 영문 폼의 "Buyer" 도 "바이어" 로 저장된다.
 */

function form(registrationForm: Record<string, unknown>) {
  return normalizeRegistrationForm({ registrationForm }, { includeDisabled: true });
}

const ROLE_FIELD = {
  id: "role",
  key: "role",
  label: "참가 구분",
  type: "select",
  enabled: true,
  options: ["바이어", "참관객"],
  placeholder: "",
};

describe("덮개 적용 — applyWebinarFormLocale", () => {
  it("번역이 있는 칸만 바뀌고 없는 칸은 원문으로 남는다", () => {
    const base = form({
      fields: [ROLE_FIELD],
      submitLabel: "사전 등록하기",
      i18n: { en: { fields: { role: { label: "Attendee type", options: ["Buyer"] } } } },
    });
    const en = applyWebinarFormLocale(base, "en");

    expect(en.fields.find((f) => f.key === "role")?.label).toBe("Attendee type");
    // 선택지 번역이 하나뿐이면 나머지는 원문 — 섞이는 것이 비는 것보다 낫다(빈 라벨은 "고장"으로 보인다).
    expect(en.fields.find((f) => f.key === "role")?.options).toEqual(["Buyer", "참관객"]);
    // 번역 안 한 버튼 문구는 그대로.
    expect(en.submitLabel).toBe("사전 등록하기");
  });

  /** **구조는 언어와 무관하다.** 선택지 개수가 언어마다 다르면 저장 값이 갈라진다. */
  it("선택지 개수는 원문을 따른다 — 번역이 남아도 늘지 않는다", () => {
    const base = form({
      fields: [ROLE_FIELD],
      i18n: { en: { fields: { role: { options: ["Buyer", "Visitor", "Press"] } } } },
    });
    expect(applyWebinarFormLocale(base, "en").fields.find((f) => f.key === "role")?.options).toEqual([
      "Buyer",
      "Visitor",
    ]);
  });

  it("기본 언어나 없는 언어를 주면 원본을 그대로 돌려준다", () => {
    const base = form({ fields: [ROLE_FIELD], i18n: { en: { fields: {} } } });
    expect(applyWebinarFormLocale(base, base.defaultLocale)).toBe(base);
    expect(applyWebinarFormLocale(base, "ja")).toBe(base);
  });

  it("빈 문자열 번역은 번역 안 한 것과 같다", () => {
    const base = form({ fields: [ROLE_FIELD], i18n: { en: { fields: { role: { label: "   " } } } } });
    expect(applyWebinarFormLocale(base, "en").fields.find((f) => f.key === "role")?.label).toBe("참가 구분");
  });
});

describe("언어 목록 — 두 가지 질문", () => {
  /** 런타임이 보는 것: **실제 번역이 있는 언어**. 방문자 화면은 글이 있을 때만 바뀐다. */
  it("translatedLocales 는 글이 있는 언어만", () => {
    expect(webinarFormTranslatedLocales(form({ fields: [ROLE_FIELD], locales: ["en"] }))).toEqual(["ko"]);
    expect(
      webinarFormTranslatedLocales(
        form({ fields: [ROLE_FIELD], i18n: { en: { fields: { role: { label: "Attendee type" } } } } }),
      ),
    ).toEqual(["ko", "en"]);
  });

  /** 편집 화면이 보는 것: **열어 둔 언어**까지. 한 글자도 안 적은 탭이 새로고침에 안 사라진다. */
  it("editableLocales 는 비어 있는 언어도 남긴다", () => {
    const opened = form({ fields: [ROLE_FIELD], locales: ["en", "ja"] });
    expect(webinarFormTranslatedLocales(opened)).toEqual(["ko"]);
    expect(webinarFormEditableLocales(opened)).toEqual(["ko", "en", "ja"]);
  });

  it("기본 언어는 목록에 중복으로 들어가지 않는다", () => {
    expect(form({ fields: [ROLE_FIELD], locales: ["ko", "en"] }).locales).toEqual(["en"]);
  });

  it("기본 언어는 ko — 이 폼의 문구는 처음부터 한국어였다", () => {
    expect(form({ fields: [ROLE_FIELD] }).defaultLocale).toBe("ko");
    expect(form({ fields: [ROLE_FIELD], defaultLocale: "EN" }).defaultLocale).toBe("en");
  });
});

describe("번역 칸 뽑기", () => {
  it("원문이 있는 칸만 나온다", () => {
    const base = form({
      fields: [{ ...ROLE_FIELD, placeholder: "" }],
      privacyText: "[필수] 개인정보 수집 및 이용에 동의합니다",
      privacyBody: "",
      marketingText: "[선택] 마케팅 정보 수신에 동의합니다",
      submitLabel: "사전 등록하기",
    });
    const contexts = webinarTranslationEntries(base, "en").map((e) => e.context);

    expect(contexts).toContain("참가 구분 · 라벨");
    expect(contexts).toContain("참가 구분 · 선택지 1");
    expect(contexts).toContain("개인정보 동의 문구");
    expect(contexts).toContain("제출 버튼");
    // 비어 있는 안내 문구·전문은 번역할 글이 없다.
    expect(contexts).not.toContain("참가 구분 · 입력칸 안내");
    expect(contexts).not.toContain("개인정보 동의 전문");
  });

  /** 꺼진 항목은 방문자에게 안 보인다 — 번역을 요구하면 진행률이 영영 100% 가 안 된다. */
  it("꺼진 항목은 세지 않는다", () => {
    const base = form({ fields: [{ ...ROLE_FIELD, enabled: false }], submitLabel: "" });
    expect(webinarTranslationEntries(base, "en").some((e) => e.context.startsWith("참가 구분"))).toBe(false);
  });

  it("쓰면 덮개에만 들어가고 원문은 그대로", () => {
    const base = form({ fields: [ROLE_FIELD] });
    const entry = webinarTranslationEntries(base, "en").find((e) => e.context === "참가 구분 · 라벨")!;
    const next = entry.write(base, "Attendee type");

    expect(next.i18n.en?.fields.role?.label).toBe("Attendee type");
    expect(next.fields.find((f) => f.key === "role")?.label).toBe("참가 구분");
    // 원본 객체는 건드리지 않는다(자동저장이 직전 값과 비교한다).
    expect(base.i18n.en).toBeUndefined();
  });

  it("선택지 번역은 원문 길이에 맞춘 자리에 들어간다", () => {
    const base = form({ fields: [ROLE_FIELD] });
    const second = webinarTranslationEntries(base, "en").find((e) => e.context === "참가 구분 · 선택지 2")!;
    expect(second.write(base, "Visitor").i18n.en?.fields.role?.options).toEqual(["", "Visitor"]);
  });

  it("비우면 덮개 키가 지워진다 — 빈 문자열이 '번역 있음'으로 세어지지 않게", () => {
    const base = form({ fields: [ROLE_FIELD], i18n: { en: { fields: { role: { label: "Attendee type" } } } } });
    const entry = webinarTranslationEntries(base, "en").find((e) => e.context === "참가 구분 · 라벨")!;
    const cleared = entry.write(base, "");
    expect(cleared.i18n.en?.fields.role?.label).toBeUndefined();
    expect(webinarFormTranslatedLocales(cleared)).toEqual(["ko"]);
  });

  it("진행률은 채운 칸 수", () => {
    const base = form({ fields: [ROLE_FIELD], submitLabel: "사전 등록하기" });
    const entries = webinarTranslationEntries(base, "en");
    expect(translationProgress(entries).done).toBe(0);
    const next = entries[0].write(base, "Attendee type");
    expect(translationProgress(webinarTranslationEntries(next, "en")).done).toBe(1);
  });
});

describe("선택지 되돌리기 — toBaseLocaleAnswer", () => {
  /**
   * 이게 없으면 영문 폼의 "Buyer" 와 국문 폼의 "바이어" 가 같은 열에 다른 값으로 쌓인다 —
   * 한 명단에 모은 의미가 사라지고, 분석·필터·CSV 가 두 갈래로 갈린다.
   */
  it("번역된 선택지를 원문 값으로 되돌린다", () => {
    const base = form({
      fields: [ROLE_FIELD],
      i18n: { en: { fields: { role: { options: ["Buyer", "Visitor"] } } } },
    });
    expect(toBaseLocaleAnswer(base, "en", "role", "Buyer")).toBe("바이어");
    expect(toBaseLocaleAnswer(base, "en", "role", "Visitor")).toBe("참관객");
  });

  /** '기타(직접입력)' 으로 쓴 자유 문장은 되돌릴 짝이 없다 — 그대로 둔다. */
  it("짝이 없는 값은 그대로 둔다", () => {
    const base = form({ fields: [ROLE_FIELD], i18n: { en: { fields: { role: { options: ["Buyer"] } } } } });
    expect(toBaseLocaleAnswer(base, "en", "role", "Journalist")).toBe("Journalist");
    expect(toBaseLocaleAnswer(base, "en", "unknown_key", "Buyer")).toBe("Buyer");
  });

  it("기본 언어·번역 없는 언어는 손대지 않는다", () => {
    const base = form({ fields: [ROLE_FIELD], i18n: { en: { fields: { role: { options: ["Buyer"] } } } } });
    expect(toBaseLocaleAnswer(base, "ko", "role", "바이어")).toBe("바이어");
    expect(toBaseLocaleAnswer(base, "ja", "role", "Buyer")).toBe("Buyer");
  });

  /** 복수 선택은 합친 문자열이다 — 조각마다 되돌린 뒤 같은 규칙으로 다시 합친다. */
  it("복수 선택은 조각마다 되돌린다", () => {
    const base = form({
      fields: [{ ...ROLE_FIELD, type: "multiple" }],
      i18n: { en: { fields: { role: { options: ["Buyer", "Visitor"] } } } },
    });
    expect(toBaseLocaleAnswer(base, "en", "role", "Buyer, Visitor")).toBe("바이어, 참관객");
  });
});

describe("언어 지우기", () => {
  /** 목록에서만 빼면 덮개가 남아 런타임이 그 언어로 계속 바뀐다 — "지웠는데 다시 생긴다". */
  it("덮개까지 함께 지운다", () => {
    const base = form({
      fields: [ROLE_FIELD],
      locales: ["en"],
      i18n: { en: { fields: { role: { label: "Attendee type" } } } },
    });
    expect(webinarFormTranslatedLocales(base)).toEqual(["ko", "en"]);

    const dropped = dropWebinarFormLocale(base, "en");
    expect(webinarFormTranslatedLocales(dropped)).toEqual(["ko"]);
    expect(webinarFormEditableLocales(dropped)).toEqual(["ko"]);
    // 원문은 그대로 남는다.
    expect(dropped.fields.find((f) => f.key === "role")?.label).toBe("참가 구분");
  });

  it("기본 언어는 지워지지 않는다", () => {
    const base = form({ fields: [ROLE_FIELD] });
    expect(dropWebinarFormLocale(base, "ko")).toBe(base);
  });
});

describe("원문 언어 정정", () => {
  /**
   * 기본값 "ko" 는 이 폼의 문구가 처음부터 한국어였기 때문이고, **영문 전용 웨비나에서는
   * 틀리다.** 그 상태에서는 영어가 원문 자리를 차지해 영어 번역을 추가할 수 없다.
   */
  it("글은 그대로 두고 표시만 바꾼다", () => {
    const base = form({ fields: [{ ...ROLE_FIELD, label: "Attendee type", options: ["Buyer", "Visitor"] }] });
    expect(base.defaultLocale).toBe("ko");

    const fixed = retagWebinarFormLocale(base, "en");
    expect(fixed.defaultLocale).toBe("en");
    // 수집 빌더와 달리 글을 옮기지 않는다 — 원문은 필드에 그대로 있고 i18n 은 덮개다.
    expect(fixed.fields.find((f) => f.key === "role")?.label).toBe("Attendee type");
    expect(fixed.i18n).toEqual(base.i18n);
  });

  /** 목적지에 덮개가 있으면 원문과 겹쳐 어느 쪽이 보일지 알 수 없다 — 아무것도 안 한다. */
  it("목적지에 번역이 있으면 거부한다", () => {
    const base = form({ fields: [ROLE_FIELD], i18n: { en: { fields: { role: { label: "Attendee type" } } } } });
    expect(retagWebinarFormLocale(base, "en")).toBe(base);
  });

  it("같은 언어로 바꾸면 아무것도 안 한다", () => {
    const base = form({ fields: [ROLE_FIELD] });
    expect(retagWebinarFormLocale(base, "ko")).toBe(base);
  });

  it("새 원문 언어는 번역 목록에서 빠진다", () => {
    const base = form({ fields: [ROLE_FIELD], locales: ["en", "ja"] });
    expect(retagWebinarFormLocale(base, "en").locales).toEqual(["ja"]);
  });
});

describe("어긋남 감지", () => {
  it("원문이 영어인데 표시가 ko 면 en 을 가리킨다", () => {
    const base = form({
      fields: [{ ...ROLE_FIELD, label: "Attendee type", options: [] }],
      privacyText: "I agree to the collection and use of personal information",
      submitLabel: "Register",
    });
    // 라틴 문자는 추측하지 않으므로 — 영어는 **감지되지 않는다**(틀린 안내를 하지 않는 쪽).
    expect(webinarFormLocaleMismatch(base)).toBeNull();
  });

  /** 실제로 잡아야 하는 경우: 표시가 en 인데 글이 한글. */
  it("표시가 en 인데 글이 한글이면 ko 를 가리킨다", () => {
    const base = form({ fields: [ROLE_FIELD], defaultLocale: "en", submitLabel: "사전 등록하기" });
    expect(webinarFormLocaleMismatch(base)).toBe("ko");
  });

  it("표시와 글이 맞으면 null", () => {
    expect(webinarFormLocaleMismatch(form({ fields: [ROLE_FIELD] }))).toBeNull();
  });

  /** 추정한 언어에 이미 번역이 있으면 그 언어는 제자리에 있다 — 어긋남이 아니다. */
  it("추정 언어에 번역이 있으면 조용히 둔다", () => {
    const base = form({
      fields: [ROLE_FIELD],
      defaultLocale: "en",
      i18n: { ko: { fields: { role: { label: "참가 구분" } } } },
    });
    expect(webinarFormLocaleMismatch(base)).toBeNull();
  });
});
