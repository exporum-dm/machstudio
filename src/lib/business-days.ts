/**
 * 업무일 계산 — 주말·한국 공휴일(대체공휴일 포함)·노동절을 뺀 날(2026-11-03).
 * 날짜는 모두 KST 기준 "YYYY-MM-DD" 문자열.
 *
 * 공휴일은 해마다 손으로 넣는다(음력·대체공휴일·선거일은 계산으로 정할 수 없다).
 * 목록에 없는 해는 주말만 빼고 계산하고, isHolidayYearCovered 로 알 수 있다 — cron 결과에 경고가 뜬다.
 * 5/1 노동절은 법정 공휴일 여부와 상관없이 회사가 쉬는 날이라 넣었다.
 */
import { shiftDay } from "@/lib/worklog";

const HOLIDAYS: Record<number, string[]> = {
  2026: [
    "2026-01-01", // 신정
    "2026-02-16", "2026-02-17", "2026-02-18", // 설날 연휴
    "2026-03-02", // 삼일절(일) 대체
    "2026-05-01", // 노동절
    "2026-05-05", // 어린이날
    "2026-05-25", // 부처님오신날(5/24 일) 대체
    "2026-06-03", // 전국동시지방선거
    "2026-08-17", // 광복절(토) 대체
    "2026-09-24", "2026-09-25", // 추석 연휴(9/26 토)
    "2026-10-05", // 개천절(토) 대체
    "2026-10-09", // 한글날
    "2026-12-25", // 성탄절
  ],
  2027: [
    "2027-01-01", // 신정
    "2027-02-08", "2027-02-09", // 설날 연휴(2/6 토·2/7 일) + 대체
    "2027-03-01", // 삼일절
    "2027-05-05", // 어린이날
    "2027-05-13", // 부처님오신날
    "2027-08-16", // 광복절(일) 대체
    "2027-09-14", "2027-09-15", "2027-09-16", // 추석 연휴
    "2027-10-04", // 개천절(일) 대체
    "2027-10-11", // 한글날(토) 대체
    "2027-12-27", // 성탄절(토) 대체
  ],
};
const HOLIDAY_SET = new Set(Object.values(HOLIDAYS).flat());

export const isHolidayYearCovered = (year: number) => year in HOLIDAYS;

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

export function isBusinessDay(day: string): boolean {
  const w = weekday(day);
  return w !== 0 && w !== 6 && !HOLIDAY_SET.has(day);
}

/** 업무일로 n 일 앞(+)·뒤(-). 시작일이 업무일이 아니어도 거기서부터 센다. */
export function shiftBusinessDays(day: string, n: number): string {
  let cursor = day;
  let left = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  while (left > 0) {
    cursor = shiftDay(cursor, step);
    if (isBusinessDay(cursor)) left--;
  }
  return cursor;
}

const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** 그 달의 마지막 업무일 */
export function lastBusinessDayOfMonth(month: string): string {
  let cursor = monthEnd(month);
  while (!isBusinessDay(cursor)) cursor = shiftDay(cursor, -1);
  return cursor;
}

/** 그 달의 n번째 업무일(1부터) */
export function nthBusinessDayOfMonth(month: string, n: number): string {
  let cursor = `${month}-01`;
  let count = isBusinessDay(cursor) ? 1 : 0;
  while (count < n) {
    cursor = shiftDay(cursor, 1);
    if (isBusinessDay(cursor)) count++;
  }
  return cursor;
}
