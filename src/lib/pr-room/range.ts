// 조사 기간 — "언제부터 언제까지 나온 글을 가져올지".
//
// 예전엔 무료 검색은 최근 30일로 고정, AI 조사는 "검색되는 전체 기간"이라 몇 년 전 글까지 끌려왔다.
// 날짜는 KST 달력 날짜(YYYY-MM-DD)로 다룬다 — 홍보 담당자가 고르는 "11월 1일"은 한국 날짜다.
// 서버(수집기)·클라이언트(가져오기) 양쪽에서 쓰는 순수 로직이라 서버 전용 의존성을 두지 않는다.

export interface ResearchRange {
  /** 시작일(포함), KST YYYY-MM-DD */
  from: string;
  /** 종료일(포함), KST YYYY-MM-DD */
  to: string;
}

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** KST 기준 오늘 날짜 문자열. */
export function kstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 오늘을 포함한 최근 N일. */
export function recentRange(days: number, now = new Date()): ResearchRange {
  const to = kstToday(now);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return { from, to };
}

export const DEFAULT_RANGE_DAYS = 30;

const startMs = (day: string) => Date.parse(`${day}T00:00:00+09:00`);

/** 올바른 기간이면 그대로, 아니면 null. 시작이 끝보다 늦으면 두 날짜를 바꿔 준다. */
export function parseRange(input: unknown): ResearchRange | null {
  if (!input || typeof input !== "object") return null;
  const { from, to } = input as Record<string, unknown>;
  if (typeof from !== "string" || typeof to !== "string" || !DATE.test(from) || !DATE.test(to)) return null;
  if (Number.isNaN(startMs(from)) || Number.isNaN(startMs(to))) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** 그 기간에 나온 글인가. 날짜를 모르는 글은 "unknown" — 버리지 않고 따로 센다. */
export function rangeContains(range: ResearchRange, publishedAt: Date | string | null | undefined): boolean | "unknown" {
  if (!publishedAt) return "unknown";
  const t = new Date(publishedAt).getTime();
  if (Number.isNaN(t)) return "unknown";
  return t >= startMs(range.from) && t < startMs(range.to) + DAY_MS;
}

/** 기간의 일수(양끝 포함). */
export function rangeDays(range: ResearchRange): number {
  return Math.round((startMs(range.to) - startMs(range.from)) / DAY_MS) + 1;
}

export function rangeLabel(range: ResearchRange): string {
  const dot = (d: string) => d.replace(/-/g, ".");
  return range.from === range.to ? dot(range.from) : `${dot(range.from)} ~ ${dot(range.to)}`;
}
