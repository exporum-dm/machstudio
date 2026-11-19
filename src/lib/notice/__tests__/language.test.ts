import { describe, expect, it } from "vitest";
import { buildNoticeModel } from "@/lib/notice/build-model";
import { normalizeNoticePageConfig } from "@/lib/notice/config";
import type { NoticeCompetition } from "@/lib/notice/types";

/**
 * 영어 공고에 한글이 섞이지 않는가.
 *
 * 실제로 이렇게 나왔다: LA 대회를 전부 영어로 써 놓았는데 "선발 방식"과 "심사 기준"은
 * machstudio 설정에서 자동으로 끌려오느라 그 두 섹션만 한글이었다. 운영자가 손댈 수 있는
 * 칸이 아니라 더 답답한 종류였고, **화면을 봐야만 아는 버그**라 여기서 못박는다.
 */
const competition: NoticeCompetition = {
  id: "c1",
  name: "K-POP DANCE BLAST",
  description: "Own the stage.",
  theme: { accentColor: "#7c3aed" },
  recruitOpenAt: null,
  recruitCloseAt: null,
  phase: "upcoming",
  canApply: false,
  statusMessages: { upcoming: "Applications open soon.", closed: "Applications are closed." },
  rounds: [
    // 대회를 만들 때 우리가 넣는 기본 이름 그대로 — 운영자가 손대지 않은 상태다.
    { kind: "prelim", name: "예선", publicWeight: 20, judgeWeight: 80, criteria: [] },
    { kind: "final", name: "본선", publicWeight: 50, judgeWeight: 50, criteria: [] },
  ],
};

const build = (language: string, hero: Record<string, unknown> = {}) =>
  buildNoticeModel(
    competition,
    // 정규화는 **대회 config 전체**를 받아 그 안의 noticePage 를 읽는다. 벗겨서 넘기면
    // 전부 기본값(=한국어)이 되어 테스트가 통과해도 아무것도 검증하지 못한다.
    normalizeNoticePageConfig({ noticePage: { enabled: true, language, hero, selection: { enabled: true } } }),
    { uid: "u1", embedded: false, isPreview: true },
  );

/** 한글 음절이 하나라도 있으면 걸린다. */
const hasHangul = (value: string) => /[가-힣]/.test(value);

describe("공고 문구 언어", () => {
  it("영어면 설정에서 끌어온 선발 방식에도 한글이 없다", () => {
    const m = build("en");
    for (const round of m.selectionRounds) {
      expect(hasHangul(round.note)).toBe(false);
      for (const bar of round.bars) expect(hasHangul(bar.label)).toBe(false);
    }
  });

  it("영어면 접수 상태 버튼도 영어다", () => {
    expect(hasHangul(build("en").ctaLabel)).toBe(false);
    // 반대로 한국어에서는 그대로 한글이어야 한다 — 사전이 통째로 영어로 굳으면 안 된다.
    expect(build("ko").ctaLabel).toBe("접수 시작 전");
  });

  /**
   * 대회를 만들 때 넣어 둔 "예선"/"본선" 은 **우리 글**이다. 영문 공고에서 그 두 글자만
   * 한글로 남아, 운영자 눈에는 바꿀 수 없는 하드코딩으로 보였다.
   */
  it("손대지 않은 기본 라운드 이름은 언어를 따라간다", () => {
    expect(build("en").selectionRounds.map((r) => r.title)).toEqual(["Preliminary", "Finals"]);
    expect(build("ko").selectionRounds.map((r) => r.title)).toEqual(["예선", "본선"]);
  });

  it("운영자가 바꾼 이름은 번역하지 않는다 — 그건 운영자가 쓴 글이다", () => {
    const renamed = {
      ...competition,
      rounds: [
        { kind: "prelim" as const, name: "1차 온라인", publicWeight: 20, judgeWeight: 80, criteria: [] },
        { kind: "final" as const, name: "Stage Final", publicWeight: 50, judgeWeight: 50, criteria: [] },
      ],
    };
    const m = buildNoticeModel(
      renamed,
      normalizeNoticePageConfig({ noticePage: { enabled: true, language: "en", selection: { enabled: true } } }),
      { uid: "u1", embedded: false, isPreview: true },
    );
    expect(m.selectionRounds.map((r) => r.title)).toEqual(["1차 온라인", "Stage Final"]);
  });

  it("지원하는 언어는 그대로 쓴다", () => {
    expect(build("fr").ctaLabel).toBe("Inscriptions bientôt ouvertes");
    expect(build("ja").ctaLabel).toBe("受付開始前");
  });

  /** 오타 하나로 화면이 비거나 엉뚱한 언어가 되면 안 된다. */
  it("모르는 값이면 한국어 — 기존 대회가 조용히 다른 언어가 되면 안 된다", () => {
    expect(build("de").ctaLabel).toBe("접수 시작 전");
    expect(build("").ctaLabel).toBe("접수 시작 전");
  });
});

/**
 * 접수 전·마감 후 문구.
 *
 * 이 자리는 손댈 수 없었다 — 시스템이 넣은 "접수 시작 전 / 접수 시작 전이에요." 가 영문
 * 공고에도 그대로 떴고, 대회 설정의 statusMessages 는 신청 폼과 함께 쓰는 값이라
 * 공고만 바꾸려고 건드릴 수도 없었다.
 */
describe("접수 상태 문구", () => {
  it("공고에 적은 문구가 사전 기본값을 이긴다", () => {
    const m = build("en", { upcomingLabel: "Opens Sep 1", upcomingNote: "Doors open at 9am PT." });
    expect(m.ctaLabel).toBe("Opens Sep 1");
    expect(m.ctaNote).toBe("Doors open at 9am PT.");
  });

  it("안 적으면 언어에 맞는 기본 문구", () => {
    expect(build("en").ctaLabel).toBe("Applications open soon");
    expect(build("ko").ctaLabel).toBe("접수 시작 전");
  });

  /**
   * statusMessages 는 대회 설정에 있는 **한글** 문구다. 영문 공고에서 폴백으로 쓰면
   * 버튼만 영어고 그 아래 한 줄이 한글인 화면이 나온다 — 실제로 그렇게 보였다.
   */
  it("영문 공고는 대회 설정의 한글 안내로 떨어지지 않는다", () => {
    expect(build("en").ctaNote).toBe("");
    expect(build("ko").ctaNote).toBe("Applications open soon.");
  });
});

it("keeps translated rows paired after a move and after discarding blank draft rows", async () => {
  const { remapNoticeRows, remapNoticeNestedRows } = await import("@/lib/notice/i18n");
  const noticePage = normalizeNoticePageConfig({ noticePage: {
    language: "ko",
    faq: { enabled: true, items: [{ question: "first" }, {}, { question: "second", answer: "fallback" }] },
    eligibility: { enabled: true, items: ["", "required"] },
    apply: { enabled: true, items: [{ title: "step", items: ["", "bring this"] }] },
    i18n: { ja: { sections: {
      faq: { items: [{ question: "one" }, {}, { question: "two" }] },
      eligibility: { items: [{}, { value: "required JA" }] },
      apply: { items: [{ details: "\nbring this JA" }] },
    } } },
  } }, { keepEmptyRows: true });

  noticePage.faq.items.reverse();
  noticePage.i18n = remapNoticeRows(noticePage.i18n, "faq", [2, 1, 0]);
  noticePage.apply.items[0].items.unshift("new");
  noticePage.i18n = remapNoticeNestedRows(noticePage.i18n, "apply", 0, [-1, 0, 1]);

  const result = normalizeNoticePageConfig({ noticePage }, { locale: "ja" });
  expect(result.language).toBe("ja");
  expect(result.faq.items).toEqual([{ question: "two", answer: "fallback" }, { question: "one", answer: "" }]);
  expect(result.eligibility.items).toEqual(["required JA"]);
  expect(result.apply.items[0].items).toEqual(["new", "bring this JA"]);
  expect(normalizeNoticePageConfig({ noticePage }).faq.items[0].question).toBe("second");
});
