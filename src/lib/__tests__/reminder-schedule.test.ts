import { describe, expect, it } from "vitest";
import { holidayName, isBusinessDay, isHolidayYearCovered, lastBusinessDayOfMonth, nthBusinessDayOfMonth, shiftBusinessDays } from "@/lib/business-days";
import { dueMonth, notifyDay, targetDay, upcomingMonths, type ReminderSchedule } from "@/lib/reminder-schedule";

const monthly: ReminderSchedule = { schedule: "last_business_day", nth: 1, leadBusinessDays: 4 };
const settle: ReminderSchedule = { schedule: "nth_business_day", nth: 3, leadBusinessDays: 0 };

describe("업무일", () => {
  it("주말·공휴일·대체공휴일은 업무일이 아니다", () => {
    expect(isBusinessDay("2026-11-02")).toBe(true); // 월
    expect(isBusinessDay("2026-11-01")).toBe(false); // 일
    expect(isBusinessDay("2026-12-25")).toBe(false); // 성탄절
    expect(isBusinessDay("2026-03-02")).toBe(false); // 삼일절 대체
    expect(isBusinessDay("2026-05-01")).toBe(false); // 노동절
  });
  it("업무일로 앞뒤 세기 — 휴일은 건너뛴다", () => {
    expect(shiftBusinessDays("2026-11-30", -4)).toBe("2026-11-24");
    expect(shiftBusinessDays("2026-12-31", -4)).toBe("2026-12-24"); // 12/25 건너뜀
    expect(shiftBusinessDays("2026-10-02", 1)).toBe("2026-10-06"); // 개천절 대체 10/5
  });
  it("달의 마지막·n번째 업무일", () => {
    expect(lastBusinessDayOfMonth("2026-11")).toBe("2026-11-30");
    expect(lastBusinessDayOfMonth("2026-02")).toBe("2026-02-27"); // 28일 토
    expect(lastBusinessDayOfMonth("2027-07")).toBe("2027-07-30"); // 31일 토
    expect(nthBusinessDayOfMonth("2026-11", 3)).toBe("2026-11-04");
    expect(nthBusinessDayOfMonth("2026-03", 3)).toBe("2026-03-05"); // 3/1 일·3/2 대체
    expect(nthBusinessDayOfMonth("2026-10", 3)).toBe("2026-10-06"); // 10/5 대체
    expect(nthBusinessDayOfMonth("2027-01", 3)).toBe("2027-01-06"); // 1/1 신정
  });
  it("캘린더에 칠할 공휴일 이름 — 주말에 겹친 날도", () => {
    expect(holidayName("2026-12-25")).toBe("성탄절");
    expect(holidayName("2026-10-03")).toBe("개천절"); // 토요일
    expect(holidayName("2026-10-05")).toBe("대체공휴일");
    expect(holidayName("2026-11-03")).toBeNull();
    expect(holidayName("constructor")).toBeNull();
  });
  it("공휴일 목록이 있는 해", () => {
    expect(isHolidayYearCovered(2026)).toBe(true);
    expect(isHolidayYearCovered(2027)).toBe(true);
    expect(isHolidayYearCovered(2028)).toBe(false);
  });
});

describe("정기 알림 일정", () => {
  it("월간 엑스포럼 — 마지막 업무일, 업무일 4일 전에 알림", () => {
    expect(targetDay(monthly, "2026-11")).toBe("2026-11-30");
    expect(notifyDay(monthly, "2026-11")).toBe("2026-11-24");
  });
  it("광고비 정산 — 셋째 업무일 당일", () => {
    expect(targetDay(settle, "2026-11")).toBe("2026-11-04");
    expect(notifyDay(settle, "2026-11")).toBe("2026-11-04");
  });
  it("알릴 날부터 기준일까지, 한 달에 한 번만", () => {
    expect(dueMonth(monthly, "2026-11-23", null)).toBeNull();
    expect(dueMonth(monthly, "2026-11-24", null)).toBe("2026-11");
    expect(dueMonth(monthly, "2026-11-25", "2026-11")).toBeNull();
    expect(dueMonth(monthly, "2026-11-30", "2026-10")).toBe("2026-11"); // cron 이 빠져도 따라잡음
    expect(dueMonth(monthly, "2026-12-01", "2026-10")).toBeNull(); // 기준일이 지나면 안 보냄
    expect(dueMonth(settle, "2026-11-03", null)).toBeNull();
    expect(dueMonth(settle, "2026-11-04", "2026-10")).toBe("2026-11");
  });
  it("앞당긴 알림이 지난달로 넘어가면 다음 달 몫으로 보낸다", () => {
    const early: ReminderSchedule = { schedule: "nth_business_day", nth: 1, leadBusinessDays: 2 };
    // 12월 첫 업무일 12/1(화) → 2업무일 전 11/27(금)
    expect(dueMonth(early, "2026-11-27", "2026-11")).toBe("2026-12");
  });
  it("미리 넣어 둘 달", () => {
    expect(upcomingMonths("2026-11-03", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});
