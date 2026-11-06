import { describe, expect, it } from "vitest";
import { recordAttendance, attendanceCsvValues } from "../collect-record-attendance";
const dates = ["2026-03-26", "2026-03-27"];
describe("actual attendance display", () => {
  it("preserves legacy visit days without fabricating midnight scans", () => {
    const a = recordAttendance({ actual_visit_status: "방문 확인", actual_visit_dates: dates }, dates)!;
    expect(a.dates).toEqual(dates);
    expect(a.firstAt).toBeNull();
    expect(a.scanCount).toBe(0);
    expect(attendanceCsvValues(a, "Asia/Seoul")).toContain("시각 미수집");
  });
  it("never treats planned attendance as actual attendance", () => {
    expect(recordAttendance({ visit_date: dates }, dates)).toBeNull();
  });
  it("distinguishes unmeasured from non-visitors", () => {
    expect(recordAttendance({ actual_visit_status: "미집계", actual_visit_dates: [] }, dates)?.measured).toBe(false);
    expect(recordAttendance({ actual_visit_status: "미방문", actual_visit_dates: [] }, dates)?.measured).toBe(true);
  });
  it("keeps genuine scan times and formats them in event local time", () => {
    const a = recordAttendance({}, dates, {firstAt:"2026-03-26T01:30:00Z", lastAt:"2026-03-26T01:30:00Z", count:1, days:[dates[0]]})!;
    expect(a.dates).toEqual([dates[0]]);
    expect(a.scanCount).toBe(1);
    expect(attendanceCsvValues(a,"Asia/Seoul").join(" ")).toContain("10:30");
  });
});
