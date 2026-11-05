import { describe, expect, it } from "vitest";
import { readAttendanceHistory } from "@/lib/collect-attendance-history";
import { collectAnalysisColumnsFor } from "@/lib/collect-analysis-columns";
import { buildRegistrationAnalysis, type AnalysisRecord } from "@/lib/registration-analysis";

const dates = ["2026-09-17", "2026-09-18"];
const history = (channel: string, visitDates: string[], sessions: unknown[] = []) => ({ version: 1, kind: "visitor-history", channel, visitDates, sessions });

describe("historical attendance evidence", () => {
  it("does not classify an undated contact list as onsite registrations", () => {
    const a = buildRegistrationAnalysis({ timezone: "Europe/Paris", eventDates: ["2025-06-13"], fields: [{ key: "gender", label: "성별", kind: "multi", options: ["여성"] }], companionKey: null, visitDateKey: null, regionKey: null, records: [{ id: "old", registrationNo: null, createdAt: new Date("2026-11-05"), entryChannel: null, utmSource: null, data: { gender: ["여성"], __import_timestamp_missing: true, __attendance_import: { version: 1, kind: "visitor-history", measured: false, channel: null, visitDates: [], sessions: [] } } }], checkIns: [] });
    expect(a.kpi.registrations).toEqual({ total: 1, pre: 0, onsite: 0, unknown: 1 });
    expect(a.daily).toEqual([]);
    expect(a.segments[0].rows[0]).toMatchObject({ regs: 1, preRegs: 0, onsiteRegs: 0 });
  });
  it("distinguishes unmeasured attendance from confirmed absence", () => {
    const record: AnalysisRecord = { id: "a", registrationNo: null, createdAt: new Date("2026-09-01"), utmSource: null, data: { gender: "여성", __attendance_import: { ...history("online", []), measured: false } } };
    const input = { timezone: "Asia/Seoul", eventDates: dates, fields: [{ key: "gender", label: "성별", kind: "single" as const, options: ["여성"] }], companionKey: null, visitDateKey: null, regionKey: null, records: [record], checkIns: [] };
    const a = buildRegistrationAnalysis(input);
    expect(a.attendance?.measurementAvailable).toBe(false);
    expect(a.kpi.registrations.total).toBe(1);
    expect(a.segments[0].rows[0].regs).toBe(1);
    expect(buildRegistrationAnalysis({ ...input, checkIns: [{ recordId: "a", eventDate: dates[0], scannedAt: new Date("2026-09-17T01:00:00Z") }] }).attendance?.measurementAvailable).toBe(true);
  });
  it("accepts dated attendance without inventing a clock or using unrelated import metadata", () => {
    expect(readAttendanceHistory({ __attendance_import: history("online", [dates[0], dates[0], "1900-01-01"]) }, dates)?.dates).toEqual([dates[0]]);
    expect(readAttendanceHistory({ __attendance_import: { file: "old.xlsx", visitDates: dates } }, dates)).toBeNull();
  });
  it("requires both actual timestamps for dwell and excludes reversed or invalid pairs", () => {
    const parsed = readAttendanceHistory({ __attendance_import: history("online", [], [
      { date: dates[0], enteredAt: "2026-09-17T01:00:00Z", exitedAt: null, durationSeconds: 0 },
      { date: dates[1], enteredAt: "2026-09-18T02:00:00Z", exitedAt: "2026-09-18T01:00:00Z" },
      { date: "1900-01-01", enteredAt: "bad" },
    ]) }, dates)!;
    expect(parsed.dates).toEqual(dates);
    expect(parsed.sessions.map((s) => s.durationSeconds)).toEqual([null, null]);
  });
  it("combines date-only visitors and actual tags without double counting, with independent time coverage", () => {
    const records: AnalysisRecord[] = [
      { id: "timed", registrationNo: null, createdAt: new Date("2026-09-01T00:00:00Z"), utmSource: null, data: { choices: "교육, 연구(학교, 기관)", __attendance_import: history("online", [dates[0]], [{ date: dates[0], enteredAt: "2026-09-17T01:00:00Z", exitedAt: "2026-09-17T03:00:00Z" }]) } },
      { id: "dated", registrationNo: null, createdAt: new Date("2026-11-04T00:00:00Z"), entryChannel: "onsite", utmSource: null, data: { __import_timestamp_missing: true, choices: ["기타, 직접입력"], __attendance_import: history("onsite", dates) } },
      { id: "absent", registrationNo: null, createdAt: new Date("2026-09-01T00:00:00Z"), utmSource: null, data: { __attendance_import: history("online", []) } },
    ];
    const a = buildRegistrationAnalysis({ timezone: "Asia/Seoul", eventDates: dates, fields: [{ key: "choices", label: "관심분야", kind: "multi", options: ["교육", "연구(학교, 기관)"] }], companionKey: null, visitDateKey: null, regionKey: null, records, checkIns: [{ recordId: "timed", eventDate: dates[0], scannedAt: new Date("2026-09-17T01:00:00Z") }] });
    expect(a.kpi.registrations).toEqual({ total: 3, pre: 2, onsite: 1 });
    expect(a.kpi.visitors.unique).toBe(2);
    expect(a.kpi.visitors.visitorDays).toBe(3);
    expect(a.kpi.visitors.scans).toBe(1);
    expect(a.arrivalsHourly).toEqual([{ date: dates[0], hour: 10, n: 1 }]);
    expect(a.attendance).toMatchObject({ historicalVisitors: 2, visitorsWithEntryTime: 1, dateOnlyVisitors: 1, stay: { sessions: 1, averageSeconds: 7200, medianSeconds: 7200 } });
    expect(a.segments.find((s) => s.key === "choices")?.rows.map((r) => r.value)).toEqual(["교육", "연구(학교, 기관)", "기타, 직접입력"]);
    expect(a.kpi.showUp.pre.rate).toBe(0.5);
    expect(a.kpi.showUp.onsite.rate).toBe(1);
  });
  it("reads serialized Korean planned dates against actual event dates", () => {
    const record: AnalysisRecord = { id: "a", registrationNo: null, createdAt: new Date("2026-09-01"), utmSource: null, data: { visit_date: "9월 17일(목), 9월 18일(금)", __attendance_import: history("online", [dates[1]]) } };
    const a = buildRegistrationAnalysis({ timezone: "Asia/Seoul", eventDates: dates, fields: [{ key: "visit_date", label: "예정일", kind: "multi", options: ["9월 17일(목)", "9월 18일(금)"] }], companionKey: null, visitDateKey: "visit_date", regionKey: null, records: [record], checkIns: [] });
    expect(a.plannedVsActual?.matchRate).toBe(1);
    expect(a.plannedVsActual?.rows.map((r) => r.planned)).toEqual([1, 1]);
  });
});

describe("capture analysis columns", () => {
  it("applies analysis choices and disabled questions without changing the capture mappings", () => {
    const mappings = [{ id: "m", index: 0, key: "interest", label: "관심", type: "checkbox", isRequired: false, showInDashboard: true, sortOrder: 0 }, { id: "date", index: 1, key: "visit_date", label: "예정일", type: "checkbox", isRequired: false, showInDashboard: true, sortOrder: 1 }];
    const columns = collectAnalysisColumnsFor({ mode: "capture", fieldMappings: mappings, formConfig: { defaultLocale: "ko", fields: [{ id: "f", key: "interest", type: "multiple", enabled: true, options: [{ ko: "교육, 연구" }] }, { id: "d", key: "visit_date", enabled: false }] } });
    expect(columns).toHaveLength(1);
    expect(columns[0]).toMatchObject({ id: "m", type: "multiple", options: ["교육, 연구"] });
    expect(mappings[0].type).toBe("checkbox");
    expect(mappings).toHaveLength(2);
  });
});
