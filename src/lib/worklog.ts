/**
 * 업무일지 → 주간업무보고.
 *
 * 양식은 DM 팀의 dm-report-weekly 시트 그대로다(2026-10-17): 주마다 시트 하나, 행사별 줄,
 * 왼쪽 "전주 달성"(내역·담당·달성·결과 및 산출물) / 오른쪽 "금주 목표"(내역·담당·달성·비고).
 * 한 칸 안에는 "[분류] - 내역 - 내역" 처럼 분류별로 묶어 적는다.
 *
 * 규칙
 *  - 주는 월~일(KST). 보고일이 속한 주 = 금주, 그 앞 주 = 전주.
 *  - 전주 달성 = 전주 날짜로 적힌 줄. 금주 목표 = 금주 날짜로 적힌 줄 + 전주에 "진행"으로 끝난 줄(이월).
 *  - 같은 분류 묶음의 달성: 진행이 하나라도 있으면 진행, 전부 완료면 완료, 전부 예정이면 예정,
 *    완료와 예정이 섞이면 진행.
 *  - 같은 내역이 며칠 적혀 있으면 한 번만(매일 "광고 모니터링" 을 적어도 보고서에는 한 줄).
 *
 * DB 를 모른다 — 화면·엑셀·테스트가 같은 결과를 쓴다.
 */

export type WorkStatus = "planned" | "doing" | "done";
export const WORK_STATUS_LABEL: Record<WorkStatus, string> = { planned: "예정", doing: "진행", done: "완료" };
export const WORK_STATUSES: WorkStatus[] = ["done", "doing", "planned"];
/** 분류 — 보고서 묶음 순서이기도 하다. 목록에 없는 분류는 뒤에 이름순. */
export const WORK_CATEGORIES = ["운영", "콘텐츠", "퍼포먼스", "홈페이지", "제작", "기획", "기타"] as const;

export function isWorkStatus(v: unknown): v is WorkStatus {
  return v === "planned" || v === "doing" || v === "done";
}

export interface WorkGroupInput {
  id: string;
  name: string;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  sortOrder: number;
  archived?: boolean;
}

export interface WorkEntryInput {
  id: string;
  groupId: string | null;
  authorId: string;
  date: string; // YYYY-MM-DD (KST 달력일)
  category: string;
  content: string;
  status: WorkStatus;
  result: string;
  note: string;
}

export interface ReportBlock {
  category: string;
  lines: string[];
  owners: string[];
  status: string;
  /** 결과 및 산출물(전주) 또는 비고(금주) */
  extra: string[];
}

export interface ReportRow {
  groupId: string | null;
  groupName: string;
  /** 첫 줄에만 행사 이름을 쓴다(시트와 같은 모양). */
  pairs: Array<{ last: ReportBlock | null; next: ReportBlock | null }>;
}

export interface WeeklyReport {
  reportDate: string;
  thisWeek: { start: string; end: string };
  lastWeek: { start: string; end: string };
  rows: ReportRow[];
}

const DAY = 86_400_000;
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toKey = (d: Date) => d.toISOString().slice(0, 10);

/** 그 날이 속한 주(월~일). */
export function weekOf(day: string): { start: string; end: string } {
  const d = toDate(day);
  const offset = (d.getUTCDay() + 6) % 7; // 월=0 … 일=6
  const start = new Date(d.getTime() - offset * DAY);
  return { start: toKey(start), end: toKey(new Date(start.getTime() + 6 * DAY)) };
}

export function shiftDay(day: string, days: number): string {
  return toKey(new Date(toDate(day).getTime() + days * DAY));
}

/** KST 오늘(YYYY-MM-DD). */
export function kstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** "(2026. 10. 22 - 24)" — 시트에 적던 모양. 끝 날짜가 다른 달이면 월도 적는다. */
export function groupDateLabel(start: string | null, end: string | null): string {
  if (!start) return "";
  const [y, m, d] = start.split("-").map(Number);
  if (!end || end === start) return `(${y}. ${m}. ${d})`;
  const [y2, m2, d2] = end.split("-").map(Number);
  if (y2 !== y) return `(${y}. ${m}. ${d} - ${y2}. ${m2}. ${d2})`;
  if (m2 !== m) return `(${y}. ${m}. ${d} - ${m2}. ${d2})`;
  return `(${y}. ${m}. ${d} - ${d2})`;
}

function categoryRank(category: string): number {
  const i = (WORK_CATEGORIES as readonly string[]).indexOf(category);
  return i < 0 ? WORK_CATEGORIES.length : i;
}

function blockStatus(statuses: WorkStatus[]): string {
  if (statuses.includes("doing")) return WORK_STATUS_LABEL.doing;
  const done = statuses.includes("done");
  const planned = statuses.includes("planned");
  if (done && planned) return WORK_STATUS_LABEL.doing;
  return done ? WORK_STATUS_LABEL.done : WORK_STATUS_LABEL.planned;
}

function buildBlock(category: string, entries: WorkEntryInput[], authorName: (id: string) => string, extraOf: (e: WorkEntryInput) => string): ReportBlock {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const e of entries) {
    const text = e.content.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    lines.push(text);
  }
  return {
    category,
    lines,
    owners: [...new Set(entries.map((e) => authorName(e.authorId)).filter(Boolean))],
    status: blockStatus(entries.map((e) => e.status)),
    extra: [...new Set(entries.map((e) => extraOf(e).trim()).filter(Boolean))],
  };
}

export function buildWeeklyReport(input: {
  reportDate: string;
  groups: WorkGroupInput[];
  entries: WorkEntryInput[];
  authorName: (id: string) => string;
}): WeeklyReport {
  const thisWeek = weekOf(input.reportDate);
  const lastWeek = { start: shiftDay(thisWeek.start, -7), end: shiftDay(thisWeek.start, -1) };
  const inRange = (day: string, r: { start: string; end: string }) => day >= r.start && day <= r.end;

  const lastEntries = input.entries.filter((e) => inRange(e.date, lastWeek));
  const thisEntries = input.entries.filter((e) => inRange(e.date, thisWeek));
  // 이월 — 전주에 진행으로 끝난 줄은 금주 목표에도 올린다(금주에 같은 내역을 이미 적었으면 그쪽이 이긴다).
  const thisKeys = new Set(thisEntries.map((e) => `${e.groupId}|${e.category}|${e.content.trim().toLowerCase()}`));
  const carried = lastEntries.filter(
    (e) => e.status === "doing" && !thisKeys.has(`${e.groupId}|${e.category}|${e.content.trim().toLowerCase()}`),
  );
  const nextEntries = [...thisEntries, ...carried];

  const groupOrder = [...input.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const groupIds = new Set(groupOrder.map((g) => g.id));
  // 행사가 지워졌거나 안 고른 줄은 "기타" 로 모은다.
  const gid = (e: WorkEntryInput) => (e.groupId && groupIds.has(e.groupId) ? e.groupId : null);

  const rows: ReportRow[] = [];
  const slots: Array<{ id: string | null; name: string; hideWhenEmpty: boolean }> = [
    ...groupOrder.map((g) => ({
      id: g.id as string | null,
      name: [g.name, groupDateLabel(g.startDate, g.endDate)].filter(Boolean).join(" "),
      // 보관한 행사는 그 주에 적은 줄이 있을 때만 보인다.
      hideWhenEmpty: !!g.archived,
    })),
    { id: null, name: "기타", hideWhenEmpty: true },
  ];

  for (const slot of slots) {
    const last = lastEntries.filter((e) => gid(e) === slot.id);
    const next = nextEntries.filter((e) => gid(e) === slot.id);
    if (slot.hideWhenEmpty && last.length === 0 && next.length === 0) continue;
    const categories = [...new Set([...last, ...next].map((e) => e.category.trim()))].sort(
      (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, "ko"),
    );
    const pairs = categories.map((category) => {
      const l = last.filter((e) => e.category.trim() === category);
      const n = next.filter((e) => e.category.trim() === category);
      return {
        last: l.length ? buildBlock(category, l, input.authorName, (e) => e.result) : null,
        next: n.length ? buildBlock(category, n, input.authorName, (e) => e.note) : null,
      };
    });
    rows.push({ groupId: slot.id, groupName: slot.name, pairs });
  }

  return { reportDate: input.reportDate, thisWeek, lastWeek, rows };
}

/** 칸 안의 글 — 시트에 적던 모양 "[운영]\n- 내역\n- 내역". 분류가 없으면 머리 없이. */
export function blockText(block: ReportBlock | null): string {
  if (!block || block.lines.length === 0) return "";
  const head = block.category ? `[${block.category}]\n` : "";
  return head + block.lines.map((l) => `- ${l}`).join("\n");
}

/** 시트에 붙여 넣을 표(행사 줄마다 분류 묶음 하나씩). 첫 칸은 행사 이름 — 묶음 첫 줄에만. */
export function reportTable(report: WeeklyReport, opts: { hideOwners?: boolean } = {}): string[][] {
  const header = [
    ["", "전주 달성", "", "", "", "금주 목표", "", "", ""],
    ["행사", "내역", "담당", "달성", "결과 및 산출물", "내역", "담당", "달성", "비고"],
  ];
  const body: string[][] = [];
  for (const row of report.rows) {
    if (row.pairs.length === 0) {
      body.push([row.groupName, "", "", "", "", "", "", "", ""]);
      continue;
    }
    row.pairs.forEach((pair, i) => {
      body.push([
        i === 0 ? row.groupName : "",
        blockText(pair.last),
        opts.hideOwners ? "" : pair.last?.owners.join(", ") ?? "",
        pair.last?.status ?? "",
        opts.hideOwners ? "" : pair.last?.extra.join("\n") ?? "",
        blockText(pair.next),
        opts.hideOwners ? "" : pair.next?.owners.join(", ") ?? "",
        pair.next?.status ?? "",
        pair.next?.extra.join("\n") ?? "",
      ]);
    });
  }
  return [...header, ...body];
}

/** 보고서 시트 이름 — 시트에서 쓰던 YYMMDD. */
export function reportSheetName(reportDate: string): string {
  return reportDate.replace(/-/g, "").slice(2);
}

// ── 시트처럼 적기(2026-10-18) ─────────────────────────────────────────────
// 일지는 시트(DM 업무 현황)와 같은 모양이다: 행 = 날짜(맨 위 "먼 미래"), 열 = 공통 + 사람.
// 칸 안에 "[행사] - 할 일" 처럼 줄을 적고, 끝나면 취소선(완료). 상태는 사람이 고르지 않는다 —
// 취소선이면 완료, 아니면 날짜가 지났으면 진행 · 아직이면 예정.

/** 취소선이 아닌 줄의 상태 — 기준일(보통 오늘·보고일)보다 뒤거나 날짜가 없으면 예정, 아니면 진행. */
export function openStatus(date: string | null, today: string): WorkStatus {
  return !date || date > today ? "planned" : "doing";
}

/** 저장된 상태를 기준일로 다시 본다 — 미리 적어 둔 "예정" 도 날짜가 지나면 진행(이월 대상). */
export function effectiveStatus(status: WorkStatus, date: string | null, today: string): WorkStatus {
  return status === "done" ? "done" : openStatus(date, today);
}

const normTag = (s: string) => s.toLowerCase().replace(/[\s·・.\-_]/g, "");

/**
 * "[LA]" 같은 머리표 → 행사 또는 분류. 행사 이름과 같으면 그 행사, 이름에 들어 있으면(LA → 코리아 엑스포 LA)
 * 순서가 앞선 행사. 행사가 아니면 분류로 남긴다 — 보고서의 [운영]·[콘텐츠] 와 같은 자리.
 */
export function resolveWorkTag(
  tag: string,
  groups: Array<{ id: string; name: string; archived?: boolean; sortOrder?: number }>,
): { groupId: string | null; category: string } {
  const t = normTag(tag);
  if (!t) return { groupId: null, category: "" };
  const ordered = [...groups].sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const exact = ordered.find((g) => normTag(g.name) === t);
  const partial = exact ?? ordered.find((g) => normTag(g.name).includes(t));
  if (partial) return { groupId: partial.id, category: "" };
  return { groupId: null, category: tag.trim().slice(0, 40) };
}

/** 줄 앞의 "[머리표]" 를 떼어 낸다. "[LA] - 배너 교체" → { tag: "LA", content: "배너 교체" } */
export function splitWorkTag(line: string): { tag: string | null; content: string } {
  const m = line.match(/^\s*\[([^\]]{1,40})\]\s*(.*)$/);
  const strip = (s: string) => s.replace(/^\s*(?:[-–—•·*]|\d+[.)])\s*/, "").trim();
  if (!m) return { tag: null, content: strip(line) };
  return { tag: m[1].trim(), content: strip(m[2]) };
}

/**
 * 붙여 넣은 여러 줄(시트 칸 그대로) → 줄 목록. "[IB]" 만 있는 줄은 아래 줄들의 머리표가 되고,
 * "- 할 일" 의 글머리는 뗀다. 빈 줄은 버린다.
 */
export function parsePastedWork(text: string): Array<{ tag: string | null; content: string }> {
  const out: Array<{ tag: string | null; content: string }> = [];
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const { tag, content } = splitWorkTag(raw);
    if (tag !== null) current = tag;
    if (!content) continue;
    out.push({ tag: current, content: content.slice(0, 2000) });
  }
  return out;
}
