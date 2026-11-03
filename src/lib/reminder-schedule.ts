/**
 * 정기 알림 일정 — 순수 함수(2026-11-03).
 *
 * 규칙 하나 = "매달 기준일" + "업무일로 며칠 전에 알릴지".
 *   last_business_day : 그 달 마지막 업무일 (월간 엑스포럼 업로드)
 *   nth_business_day  : 그 달 n번째 업무일 (광고비 충전금 정산 — 셋째 업무일)
 * 알림은 "알릴 날 ≤ 오늘 ≤ 기준일" 이고 그 달 알림을 아직 안 보냈을 때 나간다.
 * cron 이 하루 빠져도 기준일까지는 따라잡아 보낸다.
 */
import { lastBusinessDayOfMonth, nthBusinessDayOfMonth, shiftBusinessDays } from "@/lib/business-days";

export type ReminderScheduleKind = "last_business_day" | "nth_business_day";

export interface ReminderSchedule {
  schedule: ReminderScheduleKind;
  /** nth_business_day 의 n */
  nth: number;
  /** 기준일보다 업무일로 며칠 먼저 알릴지(0 = 그날) */
  leadBusinessDays: number;
}

export const isReminderScheduleKind = (v: unknown): v is ReminderScheduleKind =>
  v === "last_business_day" || v === "nth_business_day";

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};

export function targetDay(s: ReminderSchedule, month: string): string {
  return s.schedule === "last_business_day" ? lastBusinessDayOfMonth(month) : nthBusinessDayOfMonth(month, Math.max(1, s.nth));
}

export function notifyDay(s: ReminderSchedule, month: string): string {
  return shiftBusinessDays(targetDay(s, month), -Math.max(0, s.leadBusinessDays));
}

/**
 * 오늘 알려야 할 달("YYYY-MM") — 없으면 null.
 * 이번 달과 다음 달을 본다(앞당겨 알리는 날이 지난달로 넘어갈 수 있어서).
 * lastNotifiedMonth 이후의 달만 — 같은 달을 두 번 보내지 않는다.
 */
export function dueMonth(s: ReminderSchedule, today: string, lastNotifiedMonth: string | null): string | null {
  const thisMonth = today.slice(0, 7);
  for (const month of [thisMonth, shiftMonth(thisMonth, 1)]) {
    if (lastNotifiedMonth && month <= lastNotifiedMonth) continue;
    if (notifyDay(s, month) <= today && today <= targetDay(s, month)) return month;
  }
  return null;
}

/** 콘텐츠를 미리 넣어 둘 달들 — 이번 달부터 n개월 */
export function upcomingMonths(today: string, count: number): string[] {
  const first = today.slice(0, 7);
  return Array.from({ length: Math.max(0, count) }, (_, i) => shiftMonth(first, i));
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
/** "11월 30일 (월)" */
export function reminderDayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${m}월 ${d}일 (${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
}
