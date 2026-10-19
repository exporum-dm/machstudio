import { describe, expect, it } from "vitest";
import { normalizeSurveyConfig, summarizeSurvey, validateSurveyAnswers, visibleSections } from "@/lib/survey-config";

const config = normalizeSurveyConfig({
  defaultLocale: "en",
  audienceFieldKey: "visitor_type",
  allowWalkIn: true,
  walkIn: { questions: [{ key: "visitor_type", type: "single", title: { en: "Type" }, options: [{ en: "General" }, { en: "Buyer" }] }] },
  sections: [
    { id: "all", questions: [
      { key: "overall", type: "scale", title: { en: "Overall" } },
      { key: "nps", type: "nps", title: { en: "NPS" } },
      { key: "watched", type: "single", title: { en: "Stage?" }, options: [{ en: "Yes" }, { en: "No" }] },
      { key: "stage", type: "scale", title: { en: "Stage" }, showIf: { key: "watched", value: "Yes" } },
      { key: "why", type: "long", title: { en: "Why" }, required: false },
    ] },
    { id: "buyer", audiences: ["Buyer"], questions: [
      { key: "cats", type: "multiple", title: { en: "Cats" }, options: [{ en: "Beauty" }, { en: "Food" }], allowOther: true },
    ] },
    { id: "grid", questions: [{ key: "aspects", type: "grid", title: { en: "Aspects" }, rows: [{ en: "A" }, { en: "B" }] }] },
  ],
});

describe("만족도 조사 — 보이는 문항", () => {
  it("유형별 섹션과 보이기 조건", () => {
    const keys = (aud: string, answers = {}, walk = false) => visibleSections(config, aud, answers, walk).flatMap((s) => s.questions.map((q) => q.key));
    expect(keys("General")).toEqual(["overall", "nps", "watched", "why", "aspects"]);
    expect(keys("Buyer", { watched: "Yes" })).toEqual(["overall", "nps", "watched", "stage", "why", "cats", "aspects"]);
    expect(keys("General", {}, true)[0]).toBe("visitor_type");
  });
});

describe("만족도 조사 — 검증", () => {
  it("필수·범위를 보고, 안 보이는 문항의 답은 버린다", () => {
    const bad = validateSurveyAnswers(config, "General", { overall: 9, nps: 10 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.map((i) => i.key)).toEqual(["overall", "watched", "aspects"]);

    const good = validateSurveyAnswers(config, "General", { overall: 4, nps: 10, watched: "No", stage: 5, aspects: { 0: 5, 1: "na" }, cats: ["Beauty"] });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.answers).toEqual({ overall: 4, nps: 10, watched: "No", aspects: { 0: 5, 1: "na" } });
  });

  it("기타(직접 입력)는 선택지 밖 값 하나까지 허용", () => {
    const r = validateSurveyAnswers(config, "Buyer", { overall: 3, nps: 5, watched: "No", aspects: { 0: 1, 1: 2 }, cats: ["Food", "Cosmetics tools"] });
    expect(r.ok).toBe(true);
  });
});

describe("만족도 조사 — 집계", () => {
  it("평균·NPS·분포", () => {
    const s = summarizeSurvey(config, [
      { answers: { overall: 5, nps: 10, watched: "Yes" } },
      { answers: { overall: 3, nps: 6, watched: "No" } },
      { answers: { overall: 4, nps: 9, watched: "Yes" } },
    ]);
    const nps = s.find((x) => x.key === "nps")!;
    expect(nps.nps).toBe(33); // 추천 2 − 비추천 1, 3명
    expect(s.find((x) => x.key === "overall")!.average).toBe(4);
    expect(s.find((x) => x.key === "watched")!.counts).toEqual([{ label: "Yes", count: 2 }, { label: "No", count: 1 }]);
  });
});
