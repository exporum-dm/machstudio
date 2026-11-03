/**
 * 콘텐츠 캘린더 — 올릴 콘텐츠를 캘린더·보드·목록으로 본다(2026-11-02).
 * 화면과 API 가 같이 쓰는 값·순수 함수만 둔다(서버 전용 코드 없음).
 * 2026-11-03 노션 "DM 업무 관리 › 콘텐츠" 구조에 맞춤 — 상태 7단계·형식/담당 여러 개·캠페인.
 */
import { shiftDay } from "@/lib/worklog";

export { isValidDay, kstToday, shiftDay } from "@/lib/worklog";

export const CONTENT_STATUSES = [
  { id: "waiting", label: "대기", dot: "bg-zinc-400", chip: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300" },
  { id: "planning", label: "기획 중", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  { id: "doing", label: "진행 중", dot: "bg-blue-500", chip: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  { id: "design", label: "디자인 중", dot: "bg-fuchsia-500", chip: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300" },
  { id: "confirm", label: "컨펌 대기", dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  { id: "done", label: "완료", dot: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  { id: "stopped", label: "중단", dot: "bg-rose-400", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number]["id"];

export const isContentStatus = (v: unknown): v is ContentStatus =>
  typeof v === "string" && CONTENT_STATUSES.some((s) => s.id === v);

export const statusMeta = (id: string) => CONTENT_STATUSES.find((s) => s.id === id) ?? CONTENT_STATUSES[0];

/** 끝난 것 — 캘린더에서 흐리게 */
export const isClosedStatus = (id: string) => id === "done" || id === "stopped";

/** 고르기 쉬운 기본 채널(노션 "플랫폼"과 같은 목록). 목록에 없는 채널도 직접 적을 수 있다. */
export const CONTENT_CHANNELS = ["인스타그램", "페이스북", "유튜브", "블로그", "스레드", "X", "틱톡", "링크드인", "카카오톡", "홈페이지", "스티비", "SMS", "노션"] as const;
/** 노션 "형식" 목록 */
export const CONTENT_FORMATS = ["카드뉴스", "숏폼 비디오", "롱폼 비디오", "스토리", "리그램", "텍스트", "뉴스레터", "표지"] as const;
/** 노션 "캠페인" 목록 */
export const CONTENT_CAMPAIGNS = [
  "사전등록 유도", "티켓 판매", "참가사 모집", "바이어 모집", "바이어 리포트", "Save the date", "브랜딩", "리브랜딩", "웨비나",
  "분위기 고조", "팬덤 확보", "운영 도움", "업계 트렌드", "큐레이션", "시즌 그리팅", "브랜드 광고", "현장 운영", "WCTB",
  "보도자료", "정보 제공", "바이럴", "KPOP", "기념일", "기타",
] as const;

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
  formats: string[];
  campaign: string;
  assignees: ContentAssignee[];
  body: string;
  link: string;
  /** 노션 원본 주소 — 노션에서 가져온 항목만 */
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentMemberDto {
  id: string;
  name: string;
}

/**
 * 담당자 한 명. id 가 없으면 계정 없는 사람(노션에서 가져온 퇴사자 등) — 이름만.
 * interface 가 아니라 type — Prisma Json 칸에 그대로 넣으려면 암묵 인덱스 시그니처가 필요하다.
 */
export type ContentAssignee = {
  id: string | null;
  name: string;
};

/** 필터·비교용 키 — 계정 없는 사람은 이름으로 */
export const assigneeKey = (a: ContentAssignee) => a.id ?? `~${a.name}`;

/** 저장된 JSON → 담당자 목록(이상한 값은 버린다) */
export function parseAssignees(v: unknown): ContentAssignee[] {
  if (!Array.isArray(v)) return [];
  const out: ContentAssignee[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const id = typeof (x as { id?: unknown }).id === "string" && (x as { id: string }).id ? (x as { id: string }).id : null;
    const name = typeof (x as { name?: unknown }).name === "string" ? (x as { name: string }).name.trim().slice(0, 40) : "";
    if (!id && !name) continue;
    if (out.some((o) => assigneeKey(o) === assigneeKey({ id, name }))) continue;
    out.push({ id, name });
    if (out.length >= 10) break;
  }
  return out;
}

/** "HH:MM"(00:00–23:59) 또는 빈 값. */
export function isValidTime(v: unknown): v is string {
  return typeof v === "string" && (v === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(v));
}

/** 채널·형식 목록 정리 — 공백 제거·중복 제거·길이 제한. 순서는 적은 대로. */
export function normalizeTags(v: unknown, max = 15): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.trim().slice(0, 30);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
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
  formats: string[];
  /** "none" = 캠페인 없음 */
  campaigns: string[];
  /** assigneeKey 값. "none" = 담당 없음 */
  assignees: string[];
  query: string;
}

export const EMPTY_FILTER: Omit<ContentFilter, "project"> = { statuses: [], channels: [], formats: [], campaigns: [], assignees: [], query: "" };

export function matchesFilter(item: ContentItemDto, f: ContentFilter): boolean {
  if (f.project !== "all" && (item.projectId ?? "none") !== f.project) return false;
  if (f.statuses.length && !f.statuses.includes(item.status)) return false;
  if (f.channels.length && !item.channels.some((c) => f.channels.includes(c))) return false;
  if (f.formats.length && !item.formats.some((c) => f.formats.includes(c))) return false;
  if (f.campaigns.length && !f.campaigns.includes(item.campaign || "none")) return false;
  if (f.assignees.length) {
    const keys = item.assignees.length ? item.assignees.map(assigneeKey) : ["none"];
    if (!keys.some((k) => f.assignees.includes(k))) return false;
  }
  const q = f.query.trim().toLowerCase();
  const hay = [item.title, item.body, item.campaign, ...item.formats, ...item.channels, ...item.assignees.map((a) => a.name)].join("\n");
  if (q && !hay.toLowerCase().includes(q)) return false;
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

/** 필터 후보 — 실제로 쓰인 값만. 기본 목록 순서 먼저, 직접 적은 값은 뒤(가나다순). */
export function usedOptions(values: string[], base: readonly string[]): string[] {
  const used = new Set(values.filter(Boolean));
  const head = base.filter((c) => used.has(c));
  const extra = [...used].filter((c) => !base.includes(c)).sort((a, b) => a.localeCompare(b, "ko"));
  return [...head, ...extra];
}
export const channelOptions = (items: ContentItemDto[]) => usedOptions(items.flatMap((i) => i.channels), CONTENT_CHANNELS);
export const formatOptions = (items: ContentItemDto[]) => usedOptions(items.flatMap((i) => i.formats), CONTENT_FORMATS);
export const campaignOptions = (items: ContentItemDto[]) => usedOptions(items.map((i) => i.campaign), CONTENT_CAMPAIGNS);

/** 담당 필터 후보 — 팀원 + 항목에만 있는 사람(계정 없는 사람) */
export function assigneeOptions(items: ContentItemDto[], members: ContentMemberDto[]): { value: string; label: string }[] {
  const out = members.map((m) => ({ value: m.id, label: m.name }));
  for (const a of items.flatMap((i) => i.assignees)) {
    const key = assigneeKey(a);
    if (!out.some((o) => o.value === key)) out.push({ value: key, label: a.id ? a.name : `${a.name} (계정 없음)` });
  }
  return out;
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

