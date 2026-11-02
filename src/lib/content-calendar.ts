/**
 * 콘텐츠 캘린더 — 올릴 콘텐츠를 캘린더·보드·목록으로 본다(2026-11-02).
 * 화면과 API 가 같이 쓰는 값·순수 함수만 둔다(서버 전용 코드 없음).
 */
import { shiftDay } from "@/lib/worklog";

export { isValidDay, kstToday, shiftDay } from "@/lib/worklog";

export const CONTENT_STATUSES = [
  { id: "idea", label: "아이디어", dot: "bg-zinc-400", chip: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300" },
  { id: "draft", label: "제작중", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  { id: "review", label: "검수", dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  { id: "scheduled", label: "발행대기", dot: "bg-violet-500", chip: "bg-violet-500/10 text-violet-600 dark:text-violet-300" },
  { id: "published", label: "발행완료", dot: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number]["id"];

export const isContentStatus = (v: unknown): v is ContentStatus =>
  typeof v === "string" && CONTENT_STATUSES.some((s) => s.id === v);

export const statusMeta = (id: string) => CONTENT_STATUSES.find((s) => s.id === id) ?? CONTENT_STATUSES[0];

/** 고르기 쉬운 기본 채널. 목록에 없는 채널도 직접 적을 수 있다. */
export const CONTENT_CHANNELS = ["인스타그램", "페이스북", "블로그", "유튜브", "링크드인", "스레드", "X", "틱톡", "뉴스레터", "카카오톡", "홈페이지"] as const;
export const CONTENT_FORMATS = ["카드뉴스", "릴스·숏폼", "피드", "스토리", "영상", "글", "보도자료", "이메일", "라이브"] as const;

/** 프로젝트 색 — 전체 보기에서 어느 프로젝트 것인지 한눈에. 프로젝트 목록 순서로 돌려 쓴다. */
export const PROJECT_COLORS = [
  "bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500",
  "bg-teal-500", "bg-indigo-500", "bg-orange-500", "bg-fuchsia-500", "bg-lime-500",
] as const;
export const NO_PROJECT_COLOR = "bg-zinc-400";

export interface ContentItemDto {
  id: string;
  projectId: string | null;
  title: string;
  /** YYYY-MM-DD, null = 날짜 미정 */
  date: string | null;
  /** "HH:MM" 또는 "" */
  time: string;
  status: ContentStatus;
  channels: string[];
  format: string;
  assigneeId: string | null;
  assigneeName: string;
  body: string;
  link: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentMemberDto {
  id: string;
  name: string;
}

/** "HH:MM"(00:00–23:59) 또는 빈 값. */
export function isValidTime(v: unknown): v is string {
  return typeof v === "string" && (v === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(v));
}

/** 채널 목록 정리 — 공백 제거·중복 제거·길이 제한. 순서는 적은 대로. */
export function normalizeChannels(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.trim().slice(0, 30);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

export const monthKey = (day: string) => day.slice(0, 7);
export const isValidMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** 그 달의 첫날·마지막 날 */
export function monthRange(month: string): { start: string; end: string } {
  const start = `${month}-01`;
  return { start, end: shiftDay(`${shiftMonth(month, 1)}-01`, -1) };
}

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * 달력 칸 — 일요일부터 토요일까지 한 줄 7칸, 앞뒤 달의 날짜로 채운다.
 * 줄 수는 그 달에 필요한 만큼(4~6줄).
 */
export function monthGrid(month: string): string[][] {
  const { start, end } = monthRange(month);
  let cursor = shiftDay(start, -weekday(start));
  const last = shiftDay(end, 6 - weekday(end));
  const weeks: string[][] = [];
  while (cursor <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) { week.push(cursor); cursor = shiftDay(cursor, 1); }
    weeks.push(week);
  }
  return weeks;
}

export interface ContentFilter {
  /** "all" 이거나 프로젝트 id. "none" = 프로젝트 없는 항목 */
  project: string;
  statuses: string[];
  channels: string[];
  /** 담당자 id. "none" = 담당 없음 */
  assignees: string[];
  query: string;
}

export const EMPTY_FILTER: Omit<ContentFilter, "project"> = { statuses: [], channels: [], assignees: [], query: "" };

export function matchesFilter(item: ContentItemDto, f: ContentFilter): boolean {
  if (f.project !== "all" && (item.projectId ?? "none") !== f.project) return false;
  if (f.statuses.length && !f.statuses.includes(item.status)) return false;
  if (f.channels.length && !item.channels.some((c) => f.channels.includes(c))) return false;
  if (f.assignees.length && !f.assignees.includes(item.assigneeId ?? "none")) return false;
  const q = f.query.trim().toLowerCase();
  if (q && !`${item.title}\n${item.body}\n${item.format}\n${item.channels.join(" ")}`.toLowerCase().includes(q)) return false;
  return true;
}

/** 날짜 → 시간(빈 시간은 뒤) → 만든 순. 날짜 미정은 맨 뒤. */
export function compareItems(a: ContentItemDto, b: ContentItemDto): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  }
  if (a.time !== b.time) {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** 날짜별로 묶는다(날짜 미정 제외). 각 날의 항목은 compareItems 순. */
export function groupByDay(items: ContentItemDto[]): Map<string, ContentItemDto[]> {
  const map = new Map<string, ContentItemDto[]>();
  for (const item of [...items].sort(compareItems)) {
    if (!item.date) continue;
    const list = map.get(item.date);
    if (list) list.push(item); else map.set(item.date, [item]);
  }
  return map;
}

/** 필터에 쓸 채널 후보 — 기본 채널 + 실제로 쓰인 채널(기본 순서 먼저). */
export function channelOptions(items: ContentItemDto[]): string[] {
  const used = new Set(items.flatMap((i) => i.channels));
  const base = CONTENT_CHANNELS.filter((c) => used.has(c));
  const extra = [...used].filter((c) => !(CONTENT_CHANNELS as readonly string[]).includes(c)).sort((a, b) => a.localeCompare(b, "ko"));
  return [...base, ...extra];
}

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "11월 4일 (화)" */
export function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${m}월 ${d}일 (${WEEKDAYS[weekday(day)]})`;
}

/** "2026년 11월" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}년 ${m}월`;
}

