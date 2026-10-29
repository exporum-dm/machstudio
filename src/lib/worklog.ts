/**
 * 업무일지 → 주간업무보고.
 *
 * 양식은 DM 팀의 dm-report-weekly 시트 그대로다: 보고일마다 시트 하나, 행사별 줄,
 * 왼쪽 "전주 달성"(내역·담당·달성·결과 및 산출물) / 오른쪽 "금주 목표"(내역·담당·달성·비고).
 * 한 칸 안에는 "[분류]\n- 내역\n- 내역" 처럼 분류별로 묶어 적는다.
 *
 * 실제 보고서를 일지와 맞대 본 규칙(2026-10-18, 261001·261008 시트 ↔ DM 업무 현황):
 *  - 보고일은 목요일(금요일 주간업무회의 전날). 전주 달성 = 보고일까지 7일(d-6 ~ d),
 *    금주 목표 = 다음 7일(d+1 ~ d+7). "뉴스레터 발송(10/8)" 처럼 보고일 당일 일은 전주에 들어간다.
 *  - 일지 머리표 "[코엑]" "[교박]" "[STK]" 는 **행사**다(보고서의 줄). 각 업무에는 "운영·콘텐츠·
 *    퍼포먼스·제작·기획" 분류를 직접 고를 수 있고, 비어 있으면 내용을 보고 자동 분류한다.
 *  - 회의·연차·전표 입력·주간업무보고 작성 같은 일상 업무는 보고서에 쓰지 않는다.
 *  - 행사 줄은 일이 없어도 다 보인다(보관한 행사는 일이 있을 때만). 맨 끝은 늘 "기타".
 *  - 같은 분류 묶음의 달성: 진행이 하나라도 있으면 진행, 전부 완료면 완료, 전부 예정이면 예정,
 *    완료와 예정이 섞이면 진행.
 *  - 같은 내역이 며칠 적혀 있으면 한 번만(매일 "광고 모니터링" 을 적어도 보고서에는 한 줄).
 *  - 금주 목표 = 다음 7일에 미리 적어 둔 줄 + 전주에 끝내지 못한 줄(이월).
 * 여러 줄을 한 문장으로 합치는 건 사람(또는 AI 다듬기)이 한다 — 이건 그 초안이다.
 *
 * DB 를 모른다 — 화면·엑셀·테스트가 같은 결과를 쓴다.
 */

export type WorkStatus = "planned" | "doing" | "done";
export const WORK_STATUS_LABEL: Record<WorkStatus, string> = { planned: "예정", doing: "진행", done: "완료" };
export const WORK_STATUSES: WorkStatus[] = ["done", "doing", "planned"];
/** 보고서 분류 — 묶음 순서이기도 하다. 목록에 없는 분류는 뒤에 이름순. */
export const WORK_CATEGORIES = ["운영", "콘텐츠", "퍼포먼스", "제작", "홈페이지", "기획", "SNS", "기타"] as const;
export const REPORT_STATUS_LABELS = ["진행", "완료", "예정"] as const;

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
  /** 일지 머리표 줄임말("코엑", "교박") */
  aliases?: string[];
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
  common?: boolean;
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
  /** 금주 목표 기간(d+1 ~ d+7) */
  thisWeek: { start: string; end: string };
  /** 전주 달성 기간(d-6 ~ d) */
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

/** 기본 보고일 — 그 주(월~일)의 목요일. */
export function defaultReportDate(today: string): string {
  return shiftDay(weekOf(today).start, 3);
}

/** 보고일 → 전주 달성(d-6 ~ d) · 금주 목표(d+1 ~ d+7). */
export function reportWindows(reportDate: string) {
  return {
    last: { start: shiftDay(reportDate, -6), end: reportDate },
    next: { start: shiftDay(reportDate, 1), end: shiftDay(reportDate, 7) },
  };
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

export function isReportCategory(category: string): boolean {
  return (WORK_CATEGORIES as readonly string[]).includes(category.trim());
}

// ── 낱말로 분류 · 일상 업무 거르기 ─────────────────────────────────────────
// 실제 보고서에서 같은 분류에 들어간 일들의 낱말이다. 앞에서부터 처음 맞는 분류.
const CATEGORY_RULES: Array<[string, RegExp]> = [
  ["퍼포먼스", /광고|캠페인|메타|구글|틱톡|디멘드젠|\bGA4?\b|\bGTM\b|\bSA\b|\bDA\b|예산|오디언스|타겟|소재|전환|입찰|키워드|픽셀|성과|CPA|CTR|ROAS|모니터링/i],
  ["콘텐츠", /콘텐츠|컨텐츠|업로드|영상|릴스|쇼츠|shorts|스토리|카드뉴스|게시물|피드|칼럼|블로그|인스타|유튜브|촬영|편집|보도자료|축전|타임테이블|탐테|라인업/i],
  ["제작", /페이지|홈페이지|랜딩|폼\b|신청\s*폼|개발|QR|체크인|디자인|배너|포스터|시안|키비|인쇄|출력물|OOH|제작/i],
  ["기획", /기획|전략|계획|가이드|WBS|아이데이션|리서치|자료\s*조사|분석|제안서/i],
];

/** 내역 낱말로 보고서 분류를 고른다. 아무것도 안 맞으면 운영(소통·안내·관리·발송…). */
export function classifyWork(content: string): string {
  for (const [category, re] of CATEGORY_RULES) if (re.test(content)) return category;
  return "운영";
}

const ROUTINE = [
  /^(연차|반차|오전\s*반차|오후\s*반차|휴가|병가|재택|출국|입국|출장|외근|교육|현장\s*지원)$/,
  /주간\s*업무\s*(회의|보고)/,
  /전표\s*(입력|마감)?/,
  /^\d{1,2}(:\d{2})?\s*시?\s*.*회의$/,
  /회의$/,
  /^↳/,
  /^good\s*bye/i,
];
/** 보고서에 쓰지 않는 일상 업무. */
export function isRoutineWork(content: string): boolean {
  const c = content.trim();
  return ROUTINE.some((re) => re.test(c));
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
    const key = text.toLowerCase().replace(/\s+/g, "");
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

/**
 * 보고서의 행사 줄 순서 — 실제 보고서처럼 행사 날짜가 가까운 순서(2026-10-19).
 *  1) 진행 중·다가오는 행사(이번 전주 달성 기간 안에 끝난 행사 포함): 시작일 빠른 순
 *  2) 날짜를 안 넣은 행사: 행사 관리 순서
 *  3) 그보다 먼저 끝난 행사: 최근에 끝난 순(다음 회차 날짜로 바꾸거나 보관하면 다시 제자리로)
 * 같은 날짜면 행사 관리 순서.
 */
export function orderGroupsForReport<G extends Pick<WorkGroupInput, "startDate" | "endDate" | "sortOrder">>(groups: G[], reportDate: string): G[] {
  const { last } = reportWindows(reportDate);
  const tier = (g: G) => {
    const end = g.endDate ?? g.startDate;
    if (!g.startDate || !end) return 1;
    return end >= last.start ? 0 : 2;
  };
  return [...groups].sort((a, b) => {
    const ta = tier(a), tb = tier(b);
    if (ta !== tb) return ta - tb;
    if (ta === 0) return a.startDate!.localeCompare(b.startDate!) || a.sortOrder - b.sortOrder;
    if (ta === 2) return (b.endDate ?? b.startDate)!.localeCompare((a.endDate ?? a.startDate)!) || a.sortOrder - b.sortOrder;
    return a.sortOrder - b.sortOrder;
  });
}

export function buildWeeklyReport(input: {
  reportDate: string;
  groups: WorkGroupInput[];
  entries: WorkEntryInput[];
  authorName: (id: string) => string;
}): WeeklyReport {
  const { last: lastWeek, next: thisWeek } = reportWindows(input.reportDate);
  const inRange = (day: string, r: { start: string; end: string }) => day >= r.start && day <= r.end;

  const groupOrder = [...input.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const groupIds = new Set(groupOrder.map((g) => g.id));
  // 행사: 고른 행사 → 없으면 머리표(분류 칸에 남은 "[코엑]")를 줄임말로 찾는다 → 그래도 없으면 기타.
  const gid = (e: WorkEntryInput): string | null => {
    if (e.groupId && groupIds.has(e.groupId)) return e.groupId;
    if (e.category && !isReportCategory(e.category)) return matchGroup(e.category, groupOrder)?.id ?? null;
    return null;
  };
  // 분류: 보고서 분류면 그대로, 아니면 낱말로. 기타 줄에서는 행사를 못 찾은 머리표를 분류 자리에 남긴다("[더모스트]").
  const catOf = (e: WorkEntryInput): string => {
    const c = e.category.trim();
    if (c && isReportCategory(c)) return c;
    if (c && gid(e) === null) return c;
    return classifyWork(e.content);
  };

  const usable = input.entries.filter((e) => !isRoutineWork(e.content) && !(e.common && !e.groupId && !e.category));
  const lastEntries = usable.filter((e) => inRange(e.date, lastWeek) && e.status !== "planned");
  const plannedNext = usable.filter((e) => inRange(e.date, thisWeek));
  // 이월 — 전주에 끝내지 못한 줄은 금주 목표에도 올린다(금주에 같은 내역을 이미 적었으면 그쪽이 이긴다).
  const key = (e: WorkEntryInput) => `${gid(e)}|${e.content.trim().toLowerCase().replace(/\s+/g, "")}`;
  const nextKeys = new Set(plannedNext.map(key));
  const carried = usable.filter((e) => inRange(e.date, lastWeek) && e.status !== "done" && !nextKeys.has(key(e)));
  const nextEntries = [...plannedNext, ...carried.map((e) => ({ ...e, status: "doing" as WorkStatus }))];

  const rows: ReportRow[] = [];
  const slots: Array<{ id: string | null; name: string; hideWhenEmpty: boolean }> = [
    ...orderGroupsForReport(groupOrder, input.reportDate).map((g) => ({
      id: g.id as string | null,
      name: [g.name, groupDateLabel(g.startDate, g.endDate)].filter(Boolean).join("\n"),
      // 보관한 행사는 그 기간에 적은 줄이 있을 때만 보인다.
      hideWhenEmpty: !!g.archived,
    })),
    { id: null, name: "기타", hideWhenEmpty: false },
  ];

  for (const slot of slots) {
    const last = lastEntries.filter((e) => gid(e) === slot.id);
    const next = nextEntries.filter((e) => gid(e) === slot.id);
    if (slot.hideWhenEmpty && last.length === 0 && next.length === 0) continue;
    const categories = [...new Set([...last, ...next].map(catOf))].sort(
      (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, "ko"),
    );
    const pairs = categories.map((category) => {
      const l = last.filter((e) => catOf(e) === category);
      const n = next.filter((e) => catOf(e) === category);
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
  if (!block || block.lines.length === 0) return block?.category ? `[${block.category}]` : "";
  const head = block.category ? `[${block.category}]\n` : "";
  return head + block.lines.map((l) => `- ${l}`).join("\n");
}

/** 칸 글 → 묶음(분류·줄). blockText 의 반대 — 화면에서 칸을 고칠 때. */
export function parseBlockText(text: string): { category: string; lines: string[] } {
  let category = "";
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^\[([^\]]{1,40})\]\s*(.*)$/);
    if (head && !category && lines.length === 0) {
      category = head[1].trim();
      const rest = head[2].replace(/^[-–—•·*]\s*/, "").trim();
      if (rest) lines.push(rest);
      continue;
    }
    lines.push(line.replace(/^[-–—•·*]\s*/, "").trim());
  }
  return { category, lines: lines.filter(Boolean) };
}

/** 시트에 붙여 넣을 표(행사 줄마다 분류 묶음 하나씩). 첫 칸은 행사 이름 — 묶음 첫 줄에만. */
export function reportTable(report: Pick<WeeklyReport, "rows">, opts: { hideOwners?: boolean } = {}): string[][] {
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

/** 저장된 보고서 rows(JSON) 를 믿을 수 있는 모양으로. */
export function normalizeReportRows(raw: unknown): ReportRow[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
  const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 2000)).filter((x) => x.trim()) : []);
  const block = (b: unknown): ReportBlock | null => {
    if (!b || typeof b !== "object") return null;
    const o = b as Record<string, unknown>;
    const out = { category: str(o.category, 40).trim(), lines: strs(o.lines), owners: strs(o.owners), status: str(o.status, 10), extra: strs(o.extra) };
    return out.lines.length || out.category || out.extra.length ? out : null;
  };
  return raw.slice(0, 100).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const pairs = Array.isArray(o.pairs) ? o.pairs.slice(0, 40) : [];
    return {
      groupId: typeof o.groupId === "string" ? o.groupId : null,
      groupName: str(o.groupName, 200),
      pairs: pairs.map((p) => {
        const po = (p ?? {}) as Record<string, unknown>;
        return { last: block(po.last), next: block(po.next) };
      }),
    };
  });
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

const normTag = (s: string) => s.toLowerCase().replace(/[\s·・.\-_&]/g, "");

type TagGroup = { id: string; name: string; archived?: boolean; sortOrder?: number; aliases?: string[] };

/** 머리표 → 행사. 줄임말이 같거나, 이름이 같거나, 이름에 들어 있으면(LA → 코리아 엑스포 LA). 보관하지 않은 행사·앞 순서 우선. */
export function matchGroup<G extends TagGroup>(tag: string, groups: G[]): G | null {
  const t = normTag(tag);
  if (!t) return null;
  const ordered = [...groups].sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return (
    ordered.find((g) => (g.aliases ?? []).some((a) => normTag(a) === t)) ??
    ordered.find((g) => normTag(g.name) === t) ??
    (t.length >= 2 ? ordered.find((g) => normTag(g.name).includes(t)) : undefined) ??
    null
  );
}

/**
 * "[LA]" 같은 머리표 → 행사 또는 분류. 행사(줄임말·이름)를 찾으면 그 행사, 아니면 분류로 남긴다 —
 * 보고서의 [운영]·[콘텐츠] 와 같은 자리.
 */
export function resolveWorkTag(tag: string, groups: TagGroup[]): { groupId: string | null; category: string } {
  if (!normTag(tag)) return { groupId: null, category: "" };
  const g = isReportCategory(tag) ? null : matchGroup(tag, groups);
  if (g) return { groupId: g.id, category: "" };
  return { groupId: null, category: tag.trim().slice(0, 40) };
}

/** 행사 안에서 분류 머리표를 쓰면 행사는 유지하고 분류만 바꾼다. 행사 머리표면 새 행사로 바꾼다. */
export function resolveWorkTagInContext(
  tag: string,
  groups: TagGroup[],
  current: { groupId: string | null; category: string },
): { groupId: string | null; category: string } {
  const resolved = resolveWorkTag(tag, groups);
  return resolved.groupId ? resolved : { ...resolved, groupId: current.groupId };
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

// ── 칸 안의 줄 순서(2026-10-29) ───────────────────────────────────────────
// 한 칸(날짜×사람)에 여러 행사 일이 섞여 적혀도 같은 행사는 한 머리표 아래 모아 보인다.
// 행사 묶음의 자리는 그 행사의 가장 위 줄(sortOrder 가 가장 작은 줄) 자리, 묶음 안은 sortOrder 순.

type CellLine = { groupId: string | null; sortOrder: number; createdAt: string };

/** 칸 안 줄을 보이는 순서로. 아직 글이 없는 새 줄도 같은 행사 묶음에 둔다 — 다 적고 나서 옮겨 가지 않게. */
export function orderCellLines<T extends CellLine>(list: T[]): T[] {
  const raw = [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  const clusters = new Map<string, T[]>();
  for (const l of raw) {
    const key = l.groupId ?? "";
    const run = clusters.get(key);
    if (run) run.push(l);
    else clusters.set(key, [l]);
  }
  return [...clusters.values()].flat();
}

/** v 보다 바로 위(작은 쪽 가장 가까운)·아래(큰 쪽 가장 가까운) sortOrder. 없으면 null. */
export function sortOrderNeighbors(orders: number[], v: number): { below: number | null; above: number | null } {
  let below: number | null = null;
  let above: number | null = null;
  for (const s of orders) {
    if (s < v && (below === null || s > below)) below = s;
    if (s > v && (above === null || s < above)) above = s;
  }
  return { below, above };
}

/**
 * 보이는 순서에서 한 줄을 위(-1)·아래(1)로. 같은 행사 안에선 이웃 줄과 자리를 바꾸고,
 * 행사 묶음 끝에서 더 가면 묶음째 이웃 묶음과 자리를 바꾼다(묶음은 다시 모이므로 한 줄만 넘기면 제자리로 돌아온다).
 */
export function shiftInCell<T extends { groupId: string | null }>(ordered: T[], index: number, dir: -1 | 1): T[] {
  const item = ordered[index];
  const neighbor = ordered[index + dir];
  if (!item || !neighbor) return ordered;
  if (neighbor.groupId === item.groupId) {
    const out = [...ordered];
    out[index] = neighbor;
    out[index + dir] = item;
    return out;
  }
  const runOf = (i: number): [number, number] => {
    let s = i, e = i;
    while (s > 0 && ordered[s - 1].groupId === ordered[i].groupId) s--;
    while (e < ordered.length - 1 && ordered[e + 1].groupId === ordered[i].groupId) e++;
    return [s, e];
  };
  const mine = runOf(index);
  const theirs = runOf(index + dir);
  const [first, second] = dir < 0 ? [theirs, mine] : [mine, theirs];
  return [
    ...ordered.slice(0, first[0]),
    ...ordered.slice(second[0], second[1] + 1),
    ...ordered.slice(first[0], first[1] + 1),
    ...ordered.slice(second[1] + 1),
  ];
}
