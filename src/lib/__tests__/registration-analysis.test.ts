import { describe, expect, it } from "vitest";
import {
  audienceInsights,
  buildRegistrationAnalysis,
  normalizeRegion,
  parseCompanionCount,
  pickAnalysisFields,
  type AnalysisCheckIn,
  type AnalysisRecord,
} from "@/lib/registration-analysis";

describe("parseCompanionCount", () => {
  it("reads plain and worded numbers", () => {
    expect(parseCompanionCount("2")).toEqual({ count: 2, status: "ok" });
    expect(parseCompanionCount(" 2 children ")).toEqual({ count: 2, status: "ok" });
    expect(parseCompanionCount("‏1")).toEqual({ count: 1, status: "ok" });
    expect(parseCompanionCount("two")).toEqual({ count: 2, status: "ok" });
    expect(parseCompanionCount("0.")).toEqual({ count: 0, status: "ok" });
  });

  it("treats none-like answers as zero, blanks as blank", () => {
    expect(parseCompanionCount("None ")).toEqual({ count: 0, status: "ok" });
    expect(parseCompanionCount("N/A")).toEqual({ count: 0, status: "ok" });
    expect(parseCompanionCount("No I do not")).toEqual({ count: 0, status: "ok" });
    expect(parseCompanionCount("")).toEqual({ count: 0, status: "blank" });
    expect(parseCompanionCount(undefined)).toEqual({ count: 0, status: "blank" });
  });

  it("counts company names as zero text, and flags odd numbers", () => {
    expect(parseCompanionCount("Clear Channel Outdoor")).toEqual({ count: 0, status: "text" });
    expect(parseCompanionCount("14")).toEqual({ count: 0, status: "flagged" });
    expect(parseCompanionCount("500333197")).toEqual({ count: 0, status: "flagged" });
    expect(parseCompanionCount("2/3")).toEqual({ count: 0, status: "flagged" });
    expect(parseCompanionCount("11 13 16")).toEqual({ count: 0, status: "flagged" });
  });
});

describe("normalizeRegion", () => {
  it("folds the many spellings of Los Angeles", () => {
    for (const s of ["Los Angeles", "USA, Los Angeles", "los angeles ca", "LA", "116 w 92nd st, Los Angeles, California, USA", "Los Ngeles"]) {
      expect(normalizeRegion(s)).toBe("Los Angeles");
    }
  });
  it("keeps other cities and drops country words", () => {
    expect(normalizeRegion("United States, Baldwin Park")).toBe("Baldwin Park");
    expect(normalizeRegion("Irvine, CA")).toBe("Irvine");
    expect(normalizeRegion("USA")).toBe("");
  });
});

describe("pickAnalysisFields", () => {
  it("does not mistake an age question that mentions companions for the companion count", () => {
    const picked = pickAnalysisFields([
      { key: "age", label: "Age group (*Children aged 0–15 must be accompanied by a companion.)", type: "radio", options: ["16~24", "25~34"] },
      { key: "companions", label: "How many children aged 0 to 15 are accompanying you?", type: "text" },
      { key: "visit_date", label: "Planned visit date", type: "multiple", options: ["Oct 22, 2026"] },
      { key: "address", label: "Address", type: "text" },
      { key: "__consent_privacy", label: "privacy", type: "checkbox", options: ["yes"] },
    ]);
    expect(picked.companionKey).toBe("companions");
    expect(picked.visitDateKey).toBe("visit_date");
    expect(picked.regionKey).toBe("address");
    expect(picked.fields.map((f) => f.key)).toEqual(["age", "visit_date"]);
  });
});

describe("buildRegistrationAnalysis", () => {
  // LA 시간: 행사 10/22~10/23. 첫날 0시(PT) = 2026-10-22T07:00Z 부터 현장등록.
  const at = (iso: string) => new Date(iso);
  const records: AnalysisRecord[] = [
    { id: "a", registrationNo: "A", createdAt: at("2026-09-01T18:00:00Z"), data: { gender: "Female", companions: "2", visit_date: ["Oct 22, 2026"] }, utmSource: "meta" },
    { id: "b", registrationNo: "B", createdAt: at("2026-10-21T20:00:00Z"), data: { gender: "Male", companions: "None", visit_date: ["Oct 23, 2026"] }, utmSource: null },
    { id: "c", registrationNo: "C", createdAt: at("2026-10-15T18:00:00Z"), data: { gender: "Female" }, utmSource: "meta" },
    { id: "d", registrationNo: "D", createdAt: at("2026-10-22T17:30:00Z"), data: { gender: "Male", companions: "1" }, utmSource: null },
    { id: "e", registrationNo: "E", createdAt: at("2026-10-23T18:00:00Z"), data: { gender: "Female" }, utmSource: null },
  ];
  const checkIns: AnalysisCheckIn[] = [
    // a: 이틀 방문, 첫날 두 번 스캔
    { recordId: "a", eventDate: "2026-10-22", scannedAt: at("2026-10-22T17:10:00Z") },
    { recordId: "a", eventDate: "2026-10-22", scannedAt: at("2026-10-22T20:00:00Z") },
    { recordId: "a", eventDate: "2026-10-23", scannedAt: at("2026-10-23T18:00:00Z") },
    { recordId: "b", eventDate: "2026-10-23", scannedAt: at("2026-10-23T17:05:00Z") },
    { recordId: "d", eventDate: "2026-10-22", scannedAt: at("2026-10-22T17:40:00Z") },
  ];
  const a = buildRegistrationAnalysis({
    timezone: "America/Los_Angeles",
    eventDates: ["2026-10-22", "2026-10-23"],
    fields: [{ key: "gender", label: "Gender", kind: "single", options: ["Male", "Female"] }],
    companionKey: "companions",
    visitDateKey: "visit_date",
    regionKey: null,
    records,
    checkIns,
  });

  it("splits pre and onsite by the first event day (local midnight)", () => {
    expect(a.definitions.onsiteFrom).toBe("2026-10-22T07:00:00.000Z");
    expect(a.kpi.registrations).toEqual({ total: 5, pre: 3, onsite: 2 });
    expect(a.kpi.showUp.pre).toEqual({ regs: 3, visited: 2, rate: 2 / 3 });
    // 현장등록도 스캔이 없으면 방문이 아니다(e)
    expect(a.kpi.showUp.onsite).toEqual({ regs: 2, visited: 1, rate: 0.5 });
  });

  it("counts companions only in visitor totals — once per person, per day for visitor-days", () => {
    expect(a.kpi.visitors).toEqual({
      unique: 3,
      uniqueWithCompanions: 3 + 3, // a 2명 + d 1명
      companionsUnique: 3,
      visitorDays: 4, // a 2일 + b + d
      visitorDaysWithCompanions: 4 + 5, // a 2명 × 2일 + d 1명
      companionsDays: 5,
      scans: 5,
    });
    expect(a.visitsByDay.map((d) => [d.date, d.unique, d.companions, d.scans])).toEqual([
      ["2026-10-22", 2, 3, 3],
      ["2026-10-23", 2, 2, 2],
    ]);
    // 인구통계(성별)에는 동반이 들어가지 않는다
    const gender = a.segments.find((s) => s.key === "gender")!;
    expect(gender.visitorsAnswered).toBe(3);
    expect(gender.rows.find((r) => r.value === "Female")).toMatchObject({ regs: 3, visited: 1 });
  });

  it("buckets lead time and compares planned vs actual visit days", () => {
    expect(a.leadTime.map((l) => [l.bucket, l.regs, l.visited])).toEqual([
      ["D-31 이전", 1, 1],
      ["D-2~7", 1, 0],
      ["D-1 (전날)", 1, 1],
      ["행사 기간(현장)", 2, 1],
    ]);
    expect(a.plannedVsActual?.visitorsWithPlan).toBe(2);
    expect(a.plannedVsActual?.matchRate).toBe(1);
    expect(a.kpi.repeat).toEqual([{ days: 1, people: 2 }, { days: 2, people: 1 }]);
  });

  it("uses the first scan of each day for arrival hours", () => {
    expect(a.arrivalsHourly).toEqual([
      { date: "2026-10-22", hour: 10, n: 2 },
      { date: "2026-10-23", hour: 10, n: 1 },
      { date: "2026-10-23", hour: 11, n: 1 },
    ]);
  });
});

describe("audienceInsights", () => {
  const row = (value: string, regs: number, pre: number, visitors: number, preVisited: number) => ({
    value, regs, pre, onsite: regs - pre, visitors, companions: 0, visitorsWithCompanions: visitors, visitorDaysWithCompanions: visitors,
    showUp: { regs, visited: visitors, rate: visitors / regs },
    showUpPre: { regs: pre, visited: preVisited, rate: preVisited / pre },
    showUpOnsite: { regs: regs - pre, visited: visitors - preVisited, rate: regs - pre ? (visitors - preVisited) / (regs - pre) : 0 },
  });
  it("names the audience with the best and worst pre-registration show-up, and over-contributors", () => {
    const out = audienceInsights([row("General", 22841, 21468, 5866, 4816), row("Buyer", 898, 827, 279, 231), row("Press", 468, 444, 180, 160)], "Visitor type");
    expect(out[0].title).toBe("Visitor type별 사전등록 방문율: Press 36% · General 22.4%");
    expect(out.some((i) => i.title.startsWith("Press는 등록의"))).toBe(true);
  });
});
