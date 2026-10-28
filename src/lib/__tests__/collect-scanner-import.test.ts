import { describe, expect, it } from "vitest";
import { parseScannerLine, scannerRowText, zonedLocalToUtc } from "@/lib/collect-scanner-import";
import { generateRegistrationNo } from "@/lib/collect-registration-no";

describe("parseScannerLine", () => {
  const no = generateRegistrationNo();

  it("reads the offline scanner line (local date, time, machine field, code, device)", () => {
    expect(parseScannerLine(`2026.10.22 09:32:49 00000 ${no} P044`)).toEqual({
      eventDate: "2026-10-22", local: "2026-10-22T09:32:49", raw: no, registrationNo: no, device: "P044",
    });
  });

  it("accepts other separators, missing seconds and extra spaces", () => {
    const p = parseScannerLine(`2026-10-3 7:05   ${no}`);
    expect(p).toMatchObject({ eventDate: "2026-10-03", local: "2026-10-03T07:05:00", registrationNo: no, device: "" });
  });

  it("keeps foreign codes as raw for the unmatched report", () => {
    expect(parseScannerLine("2026.10.23 11:20:24 00000 https://m.site.naver.com/2ieWn P153")).toMatchObject({
      registrationNo: null, raw: "https://m.site.naver.com/2ieWn", device: "P153",
    });
  });

  it("skips lines that do not start with a date", () => {
    expect(parseScannerLine("8185901756")).toBeNull();
    expect(parseScannerLine("")).toBeNull();
  });
});

describe("scannerRowText", () => {
  it("joins spreadsheet cells into one line", () => {
    expect(scannerRowText(["2026.10.22", "09:32:49", 0, "P044"])).toBe("2026.10.22 09:32:49 0 P044");
    expect(scannerRowText("  a b ")).toBe("a b");
  });
});

describe("zonedLocalToUtc", () => {
  it("treats the time as the event's wall clock", () => {
    // LA 10월은 서머타임(UTC-7)
    expect(zonedLocalToUtc("2026-10-22T09:32:49", "America/Los_Angeles").toISOString()).toBe("2026-10-22T16:32:49.000Z");
    // 11월 3일 이후는 표준시(UTC-8)
    expect(zonedLocalToUtc("2026-11-05T09:00:00", "America/Los_Angeles").toISOString()).toBe("2026-11-05T17:00:00.000Z");
    expect(zonedLocalToUtc("2026-10-22T09:00:00", "Asia/Seoul").toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });
});
