/**
 * 등록 결과 분석 — 등록 상세의 "결과 분석" 탭이 보여 주는 숫자를 만든다(2026-10-28).
 *
 * 순수 함수다(DB·네트워크 없음). 라우트가 레코드·입장 기록을 모아 넘기고, 같은 입력이면 같은 숫자가
 * 나온다 — 화면과 결과보고, 그리고 내년 행사와의 비교가 **같은 정의**를 쓰게 하려는 것.
 *
 * ── 정의(화면 "용어" 에 그대로 보인다) ─────────────────────────────────────
 *  · 사전등록 / 현장등록: 등록 시각이 onsiteFrom(현장등록 시작 — 기본은 행사 첫날 0시, 현지) 이전이면 사전.
 *    현장등록도 온라인 폼으로 들어온다 — 구분은 오직 시각이다.
 *  · 방문: 입장 스캔이 1번 이상. 현장등록을 했어도 스캔이 없으면 방문이 아니다(LA 2026 운영 결정).
 *  · 순방문자: 사람 수(몇 번 와도 1). 누적 방문객(연인원): 날마다 각각 센 합 — 이틀 오면 2.
 *  · 동반 인원: 등록자가 적은 동반 자녀 수. **방문자 수에만 더한다**(인구통계는 모른다).
 *    순방문자에는 한 번, 연인원에는 그 사람이 온 날마다 더한다.
 *  · 방문율: 방문한 등록자 / 등록자(동반 인원 제외 — 사람 단위 전환율).
 *  · 등록 시점(D-n): 행사 첫날(현지 날짜) 기준 며칠 전에 등록했나.
 */
import { zonedLocalToUtc } from "@/lib/collect-checkin";

// ── 입력 ────────────────────────────────────────────────────────────────
export interface AnalysisField {
  key: string;
  label: string;
  /** single = radio·select, multi = multiple·checkbox */
  kind: "single" | "multi";
  options: string[];
}

export interface AnalysisRecord {
  id: string;
  registrationNo: string | null;
  createdAt: Date;
  data: Record<string, unknown>;
  /** 최초 유입 소스(없으면 마지막) */
  utmSource: string | null;
}

export interface AnalysisCheckIn {
  recordId: string;
  /** 현지 날짜 "2026-10-22" */
  eventDate: string;
  scannedAt: Date;
}

export interface AnalysisInput {
  timezone: string;
  eventDates: string[];
  /** 현장등록 시작 시각. 없으면 행사 첫날 0시(현지). */
  onsiteFrom?: Date | null;
  fields: AnalysisField[];
  companionKey: string | null;
  visitDateKey: string | null;
  regionKey: string | null;
  records: AnalysisRecord[];
  checkIns: AnalysisCheckIn[];
}

// ── 출력 ────────────────────────────────────────────────────────────────
export interface Rate { regs: number; visited: number; rate: number }
export interface SegmentRow {
  value: string;
  regs: number;
  visited: number;
  rate: number;
  preRegs: number;
  onsiteRegs: number;
  preVisited: number;
  onsiteVisited: number;
}
export interface Segment {
  key: string;
  label: string;
  kind: "single" | "multi";
  /** 이 문항에 답한 등록자 / 방문자 — 비율의 분모 */
  answered: number;
  visitorsAnswered: number;
  rows: SegmentRow[];
}
export interface Insight { tone: "good" | "warn" | "info"; title: string; detail: string }

export interface RegistrationAnalysis {
  definitions: { timezone: string; eventDates: string[]; onsiteFrom: string; firstEventDate: string };
  kpi: {
    registrations: { total: number; pre: number; onsite: number };
    visitors: {
      unique: number;
      uniqueWithCompanions: number;
      companionsUnique: number;
      visitorDays: number;
      visitorDaysWithCompanions: number;
      companionsDays: number;
      scans: number;
    };
    showUp: { total: Rate; pre: Rate; onsite: Rate };
    /** 방문자(사람) 중 사전/현장 등록 */
    visitorMix: { pre: number; onsite: number };
    repeat: { days: number; people: number }[];
  };
  companions: {
    fieldKey: string | null;
    /** 아이를 데려온 방문자 수 */
    visitorsWithKids: number;
    /** 숫자가 아닌 글(None·회사명 등)이라 0 으로 친 방문자 */
    textAsZero: number;
    blank: number;
    /** 숫자처럼 보이지만 믿기 어려운 값 — 0 으로 치고 목록으로 보여 준다 */
    flagged: { registrationNo: string | null; raw: string }[];
  };
  daily: { date: string; pre: number; onsite: number; cumulative: number }[];
  onsiteHourly: { date: string; hour: number; n: number }[];
  visitsByDay: { date: string; unique: number; companions: number; withCompanions: number; scans: number; preVisitors: number; onsiteVisitors: number }[];
  /** 그날 첫 스캔 시각(사람당 1) — 입장 피크 */
  arrivalsHourly: { date: string; hour: number; n: number }[];
  leadTime: { bucket: string; regs: number; visited: number; rate: number }[];
  segments: Segment[];
  plannedVsActual: {
    rows: { date: string; planned: number; plannedCame: number; came: number; cameUnplanned: number }[];
    /** 방문 예정일을 고른 방문자 중 고른 날 중 하루라도 온 비율 */
    matchRate: number;
    visitorsWithPlan: number;
  } | null;
  insights: Insight[];
}

// ── 분석에 쓸 항목 고르기 ──────────────────────────────────────────────────
export interface AnalysisColumn { key: string; label: string; type: string; options?: string[] }
const SINGLE_TYPES = new Set(["radio", "select"]);
const MULTI_TYPES = new Set(["multiple", "checkbox"]);
const FREE_TYPES = new Set(["text", "number", "textarea", "tel"]);

/**
 * 폼 항목 → 분포를 볼 선택형 문항 + 특수 항목(동반 인원·방문 예정일·주소).
 * 특수 항목은 폼마다 운영자가 만든 것이라 고정 키가 없다 — **키를 먼저** 보고, 라벨은 자유 입력형에서만 본다
 * (LA 2026: 연령 문항 설명에 "accompanied by a companion" 이 있어 라벨만 보면 연령이 동반 인원으로 잡혔다).
 */
export function pickAnalysisFields(all: AnalysisColumn[]): { fields: AnalysisField[]; companionKey: string | null; visitDateKey: string | null; regionKey: string | null } {
  const columns = all.filter((c) => !c.key.startsWith("__") && !c.key.startsWith("notice_"));
  const fields: AnalysisField[] = columns
    .filter((c) => (SINGLE_TYPES.has(c.type) || MULTI_TYPES.has(c.type)) && (c.options?.length ?? 0) > 0)
    .map((c) => ({ key: c.key, label: c.label, kind: SINGLE_TYPES.has(c.type) ? "single" : "multi", options: c.options ?? [] }));
  const byKey = (re: RegExp, types?: Set<string>) => columns.find((c) => re.test(c.key) && (!types || types.has(c.type)))?.key ?? null;
  const byLabel = (re: RegExp, types: Set<string>) => columns.find((c) => types.has(c.type) && re.test(c.label))?.key ?? null;
  const companionKey = byKey(/companion|accompan|kids|children/i, FREE_TYPES) ?? byLabel(/how many .*(child|kid|accompan)|동반.*(인원|수)|accompanying/i, FREE_TYPES);
  const visitDateKey = byKey(/visit_?date|visit_?day/i) ?? byLabel(/visit (date|day)|방문 ?(예정)?일/i, MULTI_TYPES) ?? byLabel(/visit (date|day)|방문 ?(예정)?일/i, SINGLE_TYPES);
  const regionKey = byKey(/^address$|^city$|region|location/i, FREE_TYPES) ?? byLabel(/^address|주소|지역|^city/i, FREE_TYPES);
  return { fields, companionKey, visitDateKey, regionKey };
}

// ── 동반 인원 ────────────────────────────────────────────────────────────
const MAX_COMPANIONS = 10;
const WORD_NUM: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ZERO_WORDS = /^(none|no|non|nope|nothing|n\/?a|na|o|x|-|nil|nobody|없음|없어요|아니요)\b/;

/**
 * 자유 입력 "동반 자녀 수" → 숫자. 비었으면 blank, 숫자가 아닌 글이면 text(0 으로 침),
 * 숫자처럼 보이지만 이상하면(10 초과·"2/3"·"11 13 16") flagged(0 으로 치고 확인 목록에).
 */
export function parseCompanionCount(raw: unknown): { count: number; status: "ok" | "blank" | "text" | "flagged" } {
  if (raw == null) return { count: 0, status: "blank" };
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 0 && raw <= MAX_COMPANIONS ? { count: raw, status: "ok" } : { count: 0, status: "flagged" };
  const s = String(raw).replace(/[​-‏‪-‮﻿]/g, "").trim().toLowerCase().replace(/\.$/, "");
  if (!s) return { count: 0, status: "blank" };
  const m = /^(\d{1,3})\s*(kids?|children|child|명|people|persons?|ppl)?$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n <= MAX_COMPANIONS ? { count: n, status: "ok" } : { count: 0, status: "flagged" };
  }
  if (s in WORD_NUM) return { count: WORD_NUM[s], status: "ok" };
  if (ZERO_WORDS.test(s)) return { count: 0, status: "ok" };
  if (/\d/.test(s)) return { count: 0, status: "flagged" };
  return { count: 0, status: "text" };
}

// ── 지역 ────────────────────────────────────────────────────────────────
const REGION_STOP = new Set(["the", "usa", "us", "u", "s", "united", "states", "america", "of", "california", "ca", "calif", "korea", "south", "republic", "st", "street", "ave", "avenue", "dr", "drive", "blvd", "rd", "road", "apt", "unit", "suite", "ste", "n", "e", "w", "way", "ln", "lane", "ct", "pl"]);

/** 주소 자유 입력 → 도시 추정. "116 w 92nd st, Los Angeles, CA, USA" → "Los Angeles". 모르면 "" */
export function normalizeRegion(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.toLowerCase();
  if (/\b(los|lis|loss)?\s*a?ng[ea]l[ea]s\b/.test(s) || /^\s*l\.?a\.?\s*$/.test(s) || /\bla\b,?\s*(ca|usa|california)?\s*$/.test(s)) return "Los Angeles";
  const words = s.replace(/\b\d+(st|nd|rd|th)\b/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !REGION_STOP.has(w));
  if (words.length === 0) return "";
  return words.slice(-2).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// ── 시간대 계산(포매터는 한 번만 만든다 — 2만 건을 돈다) ─────────────────────────
function zonedParts(timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" });
  // 시간대 오프셋은 정시 단위로만 바뀐다(인도·네팔 등 30분 단위는 15분 키로도 충분) — 15분 칸마다 한 번만 포맷한다.
  const cache = new Map<number, { date: string; hour: number }>();
  return (d: Date) => {
    const slot = Math.floor(d.getTime() / 900_000);
    let hit = cache.get(slot);
    if (!hit) {
      const p: Record<string, string> = {};
      for (const x of fmt.formatToParts(new Date(slot * 900_000))) p[x.type] = x.value;
      hit = { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
      cache.set(slot, hit);
    }
    return hit;
  };
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

function rate(regs: number, visited: number): Rate {
  return { regs, visited, rate: regs ? visited / regs : 0 };
}

const LEAD_BUCKETS: { bucket: string; test: (d: number) => boolean }[] = [
  { bucket: "D-31 이전", test: (d) => d >= 31 },
  { bucket: "D-15~30", test: (d) => d >= 15 && d <= 30 },
  { bucket: "D-8~14", test: (d) => d >= 8 && d <= 14 },
  { bucket: "D-2~7", test: (d) => d >= 2 && d <= 7 },
  { bucket: "D-1 (전날)", test: (d) => d === 1 },
  { bucket: "행사 기간(현장)", test: (d) => d <= 0 },
];

/** "Oct 22, 2026" · "2026-10-22" · "10/22" → "2026-10-22" (행사 날짜 중 하나일 때만) */
function optionToEventDate(option: string, eventDates: string[]): string | null {
  const t = Date.parse(option);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (eventDates.includes(iso)) return iso;
  }
  const md = /(\d{1,2})[./-](\d{1,2})/.exec(option);
  if (md) {
    const hit = eventDates.find((e) => Number(e.slice(5, 7)) === Number(md[1]) && Number(e.slice(8, 10)) === Number(md[2]));
    if (hit) return hit;
  }
  return null;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const num = (x: number) => x.toLocaleString("ko-KR");

// ── 본체 ────────────────────────────────────────────────────────────────
export function buildRegistrationAnalysis(input: AnalysisInput): RegistrationAnalysis {
  const { timezone, records, checkIns } = input;
  const eventDates = [...input.eventDates].sort();
  const firstEventDate = eventDates[0] ?? "";
  const onsiteFrom = input.onsiteFrom ?? (firstEventDate ? zonedLocalToUtc(`${firstEventDate}T00:00:00`, timezone) : new Date(8.64e15));
  const parts = zonedParts(timezone);

  // 사람별 방문일·스캔
  const visitDays = new Map<string, Set<string>>();
  const firstScanOfDay = new Map<string, Date>(); // `${recordId}|${date}`
  let scans = 0;
  const scansByDay = new Map<string, number>();
  for (const c of checkIns) {
    scans++;
    scansByDay.set(c.eventDate, (scansByDay.get(c.eventDate) ?? 0) + 1);
    let set = visitDays.get(c.recordId);
    if (!set) visitDays.set(c.recordId, (set = new Set()));
    set.add(c.eventDate);
    const k = `${c.recordId}|${c.eventDate}`;
    const prev = firstScanOfDay.get(k);
    if (!prev || c.scannedAt < prev) firstScanOfDay.set(k, c.scannedAt);
  }

  // 레코드 1회 순회
  const companionFlagged: { registrationNo: string | null; raw: string }[] = [];
  let textAsZero = 0, blank = 0, visitorsWithKids = 0, companionsUnique = 0, companionsDays = 0;
  let pre = 0, onsite = 0, preVisited = 0, onsiteVisited = 0;
  const dailyMap = new Map<string, { pre: number; onsite: number }>();
  const onsiteHourMap = new Map<string, number>();
  const leadMap = new Map<string, { regs: number; visited: number }>();
  const dayVisitors = new Map<string, { unique: number; companions: number; pre: number; onsite: number }>();
  const repeatMap = new Map<number, number>();
  const kidsById = new Map<string, number>();
  const isPreById = new Map<string, boolean>();

  type Acc = { regs: number; visited: number; preRegs: number; onsiteRegs: number; preVisited: number; onsiteVisited: number };
  const segAcc = new Map<string, { answered: number; visitorsAnswered: number; rows: Map<string, Acc> }>();
  const segKeys: { key: string; label: string; kind: "single" | "multi"; options: string[] }[] = [
    ...input.fields.filter((f) => f.key !== input.visitDateKey && f.key !== input.companionKey),
    { key: "__utm", label: "유입 소스 (UTM 최초)", kind: "single", options: [] },
    ...(input.regionKey ? [{ key: "__region", label: "지역 (주소에서 추정)", kind: "single" as const, options: [] }] : []),
  ];
  for (const s of segKeys) segAcc.set(s.key, { answered: 0, visitorsAnswered: 0, rows: new Map() });

  const planned = input.visitDateKey && eventDates.length
    ? { rows: new Map(eventDates.map((d) => [d, { planned: 0, plannedCame: 0, came: 0, cameUnplanned: 0 }])), withPlan: 0, matched: 0 }
    : null;
  const visitOptionMap = new Map<string, string | null>();

  for (const r of records) {
    const isPre = r.createdAt < onsiteFrom;
    isPreById.set(r.id, isPre);
    const days = visitDays.get(r.id);
    const visited = Boolean(days?.size);
    const { date: regDate, hour: regHour } = parts(r.createdAt);

    if (isPre) { pre++; if (visited) preVisited++; } else { onsite++; if (visited) onsiteVisited++; }
    const dm = dailyMap.get(regDate) ?? { pre: 0, onsite: 0 };
    if (isPre) dm.pre++; else dm.onsite++;
    dailyMap.set(regDate, dm);
    if (!isPre) onsiteHourMap.set(`${regDate}|${regHour}`, (onsiteHourMap.get(`${regDate}|${regHour}`) ?? 0) + 1);

    const lead = firstEventDate ? dayDiff(firstEventDate, regDate) : 0;
    const bucket = isPre ? LEAD_BUCKETS.find((b) => b.test(Math.max(lead, 1)))!.bucket : LEAD_BUCKETS[LEAD_BUCKETS.length - 1].bucket;
    const lm = leadMap.get(bucket) ?? { regs: 0, visited: 0 };
    lm.regs++;
    if (visited) lm.visited++;
    leadMap.set(bucket, lm);

    // 동반 인원 — 방문자만 센다
    let kids = 0;
    if (visited && input.companionKey) {
      const parsed = parseCompanionCount(r.data[input.companionKey]);
      kids = parsed.count;
      if (parsed.status === "blank") blank++;
      else if (parsed.status === "text") textAsZero++;
      else if (parsed.status === "flagged") companionFlagged.push({ registrationNo: r.registrationNo, raw: String(r.data[input.companionKey]) });
      if (kids > 0) visitorsWithKids++;
      companionsUnique += kids;
      companionsDays += kids * (days?.size ?? 0);
    }
    kidsById.set(r.id, kids);
    if (visited) {
      repeatMap.set(days!.size, (repeatMap.get(days!.size) ?? 0) + 1);
      for (const d of days!) {
        const dv = dayVisitors.get(d) ?? { unique: 0, companions: 0, pre: 0, onsite: 0 };
        dv.unique++;
        dv.companions += kids;
        if (isPre) dv.pre++; else dv.onsite++;
        dayVisitors.set(d, dv);
      }
    }

    // 세그먼트
    for (const s of segKeys) {
      const acc = segAcc.get(s.key)!;
      let values: string[];
      if (s.key === "__utm") values = [(r.utmSource ?? "").trim() || "(없음)"];
      else if (s.key === "__region") { const v = normalizeRegion(r.data[input.regionKey!]); values = v ? [v] : []; }
      else {
        const raw = r.data[s.key];
        values = (Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw]).map((v) => String(v).trim()).filter(Boolean);
      }
      if (values.length === 0) continue;
      acc.answered++;
      if (visited) acc.visitorsAnswered++;
      for (const v of new Set(values)) {
        const row = acc.rows.get(v) ?? { regs: 0, visited: 0, preRegs: 0, onsiteRegs: 0, preVisited: 0, onsiteVisited: 0 };
        row.regs++;
        if (isPre) row.preRegs++; else row.onsiteRegs++;
        if (visited) { row.visited++; if (isPre) row.preVisited++; else row.onsiteVisited++; }
        acc.rows.set(v, row);
      }
    }

    // 방문 예정일 vs 실제
    if (planned && visited) {
      const raw = r.data[input.visitDateKey!];
      const opts = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
      const plannedDates = new Set<string>();
      for (const o of opts) {
        if (!visitOptionMap.has(o)) visitOptionMap.set(o, optionToEventDate(o, eventDates));
        const d = visitOptionMap.get(o);
        if (d) plannedDates.add(d);
      }
      if (plannedDates.size) {
        planned.withPlan++;
        if ([...days!].some((d) => plannedDates.has(d))) planned.matched++;
        for (const d of eventDates) {
          const row = planned.rows.get(d)!;
          const p = plannedDates.has(d), c = days!.has(d);
          if (p) row.planned++;
          if (p && c) row.plannedCame++;
          if (c) row.came++;
          if (c && !p) row.cameUnplanned++;
        }
      }
    }
  }

  // 입장 피크 — 그날 첫 스캔
  const arrivalMap = new Map<string, number>();
  for (const [k, at] of firstScanOfDay) {
    const date = k.slice(k.indexOf("|") + 1);
    const { hour } = parts(at);
    arrivalMap.set(`${date}|${hour}`, (arrivalMap.get(`${date}|${hour}`) ?? 0) + 1);
  }

  const visitorsUnique = preVisited + onsiteVisited;
  const visitorDays = [...dayVisitors.values()].reduce((a, v) => a + v.unique, 0);
  let cumulative = 0;
  const daily = [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => {
    cumulative += v.pre + v.onsite;
    return { date, pre: v.pre, onsite: v.onsite, cumulative };
  });
  const splitKey = (k: string) => { const i = k.indexOf("|"); return { date: k.slice(0, i), hour: Number(k.slice(i + 1)) }; };
  const onsiteHourly = [...onsiteHourMap.entries()].map(([k, n]) => ({ ...splitKey(k), n })).sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
  const arrivalsHourly = [...arrivalMap.entries()].map(([k, n]) => ({ ...splitKey(k), n })).sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
  const visitDates = Array.from(new Set([...eventDates, ...dayVisitors.keys()])).sort();
  const visitsByDay = visitDates.map((date) => {
    const v = dayVisitors.get(date) ?? { unique: 0, companions: 0, pre: 0, onsite: 0 };
    return { date, unique: v.unique, companions: v.companions, withCompanions: v.unique + v.companions, scans: scansByDay.get(date) ?? 0, preVisitors: v.pre, onsiteVisitors: v.onsite };
  });
  const leadTime = LEAD_BUCKETS.map((b) => { const v = leadMap.get(b.bucket) ?? { regs: 0, visited: 0 }; return { bucket: b.bucket, ...rate(v.regs, v.visited) }; }).filter((b) => b.regs > 0);

  const segments: Segment[] = segKeys.map((s) => {
    const acc = segAcc.get(s.key)!;
    const order = new Map(s.options.map((o, i) => [o.trim(), i]));
    let rows = [...acc.rows.entries()].map(([value, a]) => ({ value, ...a, rate: a.regs ? a.visited / a.regs : 0 }));
    rows.sort((a, b) => (order.has(a.value) && order.has(b.value) ? order.get(a.value)! - order.get(b.value)! : order.has(a.value) ? -1 : order.has(b.value) ? 1 : b.regs - a.regs));
    // 선택지 밖 자유값이 많은 문항(UTM·지역·기타 입력)은 상위 12개 + 기타
    if (rows.length > 12) {
      const sorted = [...rows].sort((a, b) => b.regs - a.regs);
      const top = sorted.slice(0, 11);
      const rest = sorted.slice(11).reduce((t, r) => ({ value: "기타", regs: t.regs + r.regs, visited: t.visited + r.visited, preRegs: t.preRegs + r.preRegs, onsiteRegs: t.onsiteRegs + r.onsiteRegs, preVisited: t.preVisited + r.preVisited, onsiteVisited: t.onsiteVisited + r.onsiteVisited, rate: 0 }), { value: "기타", regs: 0, visited: 0, preRegs: 0, onsiteRegs: 0, preVisited: 0, onsiteVisited: 0, rate: 0 });
      rest.rate = rest.regs ? rest.visited / rest.regs : 0;
      rows = [...top, rest];
    }
    return { key: s.key, label: s.label, kind: s.kind, answered: acc.answered, visitorsAnswered: acc.visitorsAnswered, rows };
  }).filter((s) => s.answered > 0);

  const plannedVsActual = planned && planned.withPlan > 0
    ? { rows: eventDates.map((d) => ({ date: d, ...planned.rows.get(d)! })), matchRate: planned.matched / planned.withPlan, visitorsWithPlan: planned.withPlan }
    : null;

  const analysis: RegistrationAnalysis = {
    definitions: { timezone, eventDates, onsiteFrom: onsiteFrom.toISOString(), firstEventDate },
    kpi: {
      registrations: { total: records.length, pre, onsite },
      visitors: {
        unique: visitorsUnique,
        uniqueWithCompanions: visitorsUnique + companionsUnique,
        companionsUnique,
        visitorDays,
        visitorDaysWithCompanions: visitorDays + companionsDays,
        companionsDays,
        scans,
      },
      showUp: { total: rate(records.length, visitorsUnique), pre: rate(pre, preVisited), onsite: rate(onsite, onsiteVisited) },
      visitorMix: { pre: preVisited, onsite: onsiteVisited },
      repeat: [...repeatMap.entries()].sort(([a], [b]) => a - b).map(([days, people]) => ({ days, people })),
    },
    companions: { fieldKey: input.companionKey, visitorsWithKids, textAsZero, blank, flagged: companionFlagged },
    daily,
    onsiteHourly,
    visitsByDay,
    arrivalsHourly,
    leadTime,
    segments,
    plannedVsActual,
    insights: [],
  };
  analysis.insights = buildInsights(analysis);
  return analysis;
}

// ── 인사이트 — 숫자에서 바로 읽히는 것만, 표본이 충분할 때만 ─────────────────────
const MIN_N = 100;

export function buildInsights(a: RegistrationAnalysis): Insight[] {
  const out: Insight[] = [];
  const { kpi } = a;
  if (kpi.visitors.unique === 0) return out;

  // 1) 사전등록 방문율 · 현장등록 비중
  if (kpi.registrations.pre >= MIN_N) {
    out.push({
      tone: "info",
      title: `사전등록자 ${pct(kpi.showUp.pre.rate)}가 실제로 방문했어요`,
      detail: `사전등록 ${num(kpi.registrations.pre)}명 중 ${num(kpi.showUp.pre.visited)}명 — 사전등록 방문자 1명에 등록 약 ${(1 / Math.max(kpi.showUp.pre.rate, 0.01)).toFixed(1)}명이 필요했어요. 내년 사전등록 목표를 잡을 때 이 배수를 쓰세요.`,
    });
  }
  if (kpi.registrations.onsite >= 30) {
    out.push({
      tone: "info",
      title: `방문자 ${pct(kpi.visitorMix.onsite / kpi.visitors.unique)}는 현장등록이었어요`,
      detail: `방문자 ${num(kpi.visitors.unique)}명 중 현장등록 ${num(kpi.visitorMix.onsite)}명. 현장등록자의 방문율은 ${pct(kpi.showUp.onsite.rate)}로, 등록만 하고 입장 스캔이 없는 사람이 ${num(kpi.registrations.onsite - kpi.showUp.onsite.visited)}명이에요.`,
    });
  }

  // 2) 등록 시점
  const leads = a.leadTime.filter((l) => l.regs >= MIN_N && l.bucket !== "행사 기간(현장)");
  if (leads.length >= 2) {
    const best = leads.reduce((x, y) => (y.rate > x.rate ? y : x));
    const worst = leads.reduce((x, y) => (y.rate < x.rate ? y : x));
    if (best.rate > worst.rate * 1.3) {
      out.push({
        tone: "good",
        title: `${best.bucket}에 등록한 사람의 방문율이 ${(best.rate / worst.rate).toFixed(1)}배 높아요`,
        detail: `${best.bucket} ${pct(best.rate)} vs ${worst.bucket} ${pct(worst.rate)}. 일찍 모은 등록자는 행사 직전 리마인드(메일·문자)가 방문율을 끌어올릴 여지가 커요.`,
      });
    }
  }

  // 3) 유입 소스
  const utm = a.segments.find((s) => s.key === "__utm");
  if (utm) {
    // "(없음)" 은 UTM 없이 들어온 사람(직접 방문·검색·지인 공유) — 채널이 아니라 비교에서 뺀다
    const rows = utm.rows.filter((r) => r.preRegs >= MIN_N && r.value !== "기타" && r.value !== "(없음)");
    if (rows.length >= 2) {
      const best = rows.reduce((x, y) => (y.rate > x.rate ? y : x));
      const biggest = rows.reduce((x, y) => (y.regs > x.regs ? y : x));
      out.push({
        tone: best.value === biggest.value ? "good" : "warn",
        title: `유입 소스 중 방문율은 ${best.value}(${pct(best.rate)})가 가장 높아요`,
        detail: best.value === biggest.value
          ? `등록 수도 가장 많은 소스예요.`
          : `등록이 가장 많은 ${biggest.value}는 ${num(biggest.regs)}명을 모았지만 방문율은 ${pct(biggest.rate)}예요. 등록 수만이 아니라 '방문당 비용'으로 채널을 비교해 보세요.`,
      });
    }
  }

  // 4) 방문자 구성이 등록자 구성과 크게 다른 값
  for (const s of a.segments) {
    if (s.kind !== "single" || s.key.startsWith("__") || s.answered < MIN_N * 5) continue;
    // 분기 문항(바이어 전용 등)은 그 문항에 답한 사람끼리 비교한다
    const baseRate = s.answered ? s.visitorsAnswered / s.answered : 0;
    for (const r of s.rows) {
      if (r.regs < MIN_N) continue;
      const regShare = r.regs / s.answered;
      const visShare = s.visitorsAnswered ? r.visited / s.visitorsAnswered : 0;
      if (Math.abs(visShare - regShare) >= 0.05) {
        out.push({
          tone: visShare > regShare ? "good" : "warn",
          title: `${s.label}: ${r.value}는 등록자의 ${pct(regShare)}인데 방문자의 ${pct(visShare)}예요`,
          detail: `방문율 ${pct(r.rate)} (이 문항 응답자 평균 ${pct(baseRate)}).`,
        });
      }
    }
  }

  // 5) 입장 피크 · 현장등록 피크
  const peakBy = (rows: { date: string; hour: number; n: number }[]) => {
    const byHour = new Map<number, number>();
    for (const r of rows) byHour.set(r.hour, (byHour.get(r.hour) ?? 0) + r.n);
    const total = [...byHour.values()].reduce((x, y) => x + y, 0);
    const [hour, n] = [...byHour.entries()].reduce((x, y) => (y[1] > x[1] ? y : x), [0, 0]);
    return { hour, share: total ? n / total : 0, total };
  };
  const arr = peakBy(a.arrivalsHourly);
  if (arr.total >= MIN_N) {
    out.push({ tone: "info", title: `입장은 ${arr.hour}시대에 가장 몰렸어요 (${pct(arr.share)})`, detail: `입구 스캔 인력·대기 동선은 이 시간대에 맞추세요. 일자별 시간대 분포는 아래 '방문 패턴'에서 볼 수 있어요.` });
  }
  const reg = peakBy(a.onsiteHourly);
  if (reg.total >= MIN_N) {
    out.push({ tone: "info", title: `현장등록은 ${reg.hour}시대에 가장 많았어요 (${pct(reg.share)})`, detail: `현장등록 안내 인력·등록용 QR 배너는 이 시간 전에 준비해 두세요.` });
  }

  // 6) 방문 예정일
  if (a.plannedVsActual && a.plannedVsActual.visitorsWithPlan >= MIN_N) {
    out.push({
      tone: "info",
      title: `방문 예정일을 고른 방문자의 ${pct(a.plannedVsActual.matchRate)}가 고른 날에 왔어요`,
      detail: `예정일 질문은 일자별 인원 예측에 쓸 수 있어요 — 아래 표에서 날짜별로 예정 대비 실제를 볼 수 있어요.`,
    });
  }

  // 7) 동반 · 재방문
  if (kpi.visitors.companionsUnique > 0 && kpi.visitors.unique >= MIN_N) {
    out.push({
      tone: "info",
      title: `방문자 ${pct(a.companions.visitorsWithKids / kpi.visitors.unique)}가 아이를 데려왔어요 (동반 ${num(kpi.visitors.companionsUnique)}명)`,
      detail: `동반 포함 순방문자 ${num(kpi.visitors.uniqueWithCompanions)}명. 가족 단위 동선·키즈 프로그램 규모를 정할 때 참고하세요.`,
    });
  }
  const repeaters = kpi.repeat.filter((r) => r.days > 1).reduce((x, r) => x + r.people, 0);
  if (repeaters > 0 && kpi.visitors.unique >= MIN_N) {
    out.push({ tone: "info", title: `${num(repeaters)}명(${pct(repeaters / kpi.visitors.unique)})이 이틀 이상 다시 왔어요`, detail: `재방문 동기(일자별 다른 프로그램·이벤트)가 있으면 이 비율이 올라가요.` });
  }
  return out;
}

// ── 유형별(General·Buyer·Press …) 비교 ─────────────────────────────────────
export interface AudienceRow {
  value: string;
  regs: number;
  pre: number;
  onsite: number;
  visitors: number;
  companions: number;
  visitorsWithCompanions: number;
  visitorDaysWithCompanions: number;
  showUp: Rate;
  showUpPre: Rate;
  showUpOnsite: Rate;
}

/** 유형마다 따로 낸 분석을 한 표로 — 정의는 각 분석과 같다(합치면 전체와 맞는다). */
export function summarizeAudiences(list: { value: string; analysis: RegistrationAnalysis }[]): AudienceRow[] {
  return list.map(({ value, analysis: a }) => ({
    value,
    regs: a.kpi.registrations.total,
    pre: a.kpi.registrations.pre,
    onsite: a.kpi.registrations.onsite,
    visitors: a.kpi.visitors.unique,
    companions: a.kpi.visitors.companionsUnique,
    visitorsWithCompanions: a.kpi.visitors.uniqueWithCompanions,
    visitorDaysWithCompanions: a.kpi.visitors.visitorDaysWithCompanions,
    showUp: a.kpi.showUp.total,
    showUpPre: a.kpi.showUp.pre,
    showUpOnsite: a.kpi.showUp.onsite,
  }));
}

/** 유형 사이 차이 — 사전등록 방문율이 가장 높은/낮은 유형, 등록 비중 대비 방문 비중. */
export function audienceInsights(rows: AudienceRow[], label = "유형"): Insight[] {
  const out: Insight[] = [];
  const valid = rows.filter((r) => r.pre >= 30);
  if (valid.length >= 2) {
    const best = valid.reduce((x, y) => (y.showUpPre.rate > x.showUpPre.rate ? y : x));
    const worst = valid.reduce((x, y) => (y.showUpPre.rate < x.showUpPre.rate ? y : x));
    if (best.value !== worst.value && best.showUpPre.rate > worst.showUpPre.rate * 1.2) {
      out.push({
        tone: "info",
        title: `${label}별 사전등록 방문율: ${best.value} ${pct(best.showUpPre.rate)} · ${worst.value} ${pct(worst.showUpPre.rate)}`,
        detail: `${best.value}는 등록하면 실제로 오는 비율이 높고, ${worst.value}는 리마인드·방문 동기 설계가 더 필요해요. 유형별 목표 등록 수를 따로 잡으세요.`,
      });
    }
  }
  const totalRegs = rows.reduce((a, r) => a + r.regs, 0);
  const totalVis = rows.reduce((a, r) => a + r.visitors, 0);
  for (const r of rows) {
    if (!totalRegs || !totalVis || r.regs < 30) continue;
    const regShare = r.regs / totalRegs, visShare = r.visitors / totalVis;
    if (regShare < 0.5 && visShare >= regShare * 1.3) {
      out.push({ tone: "good", title: `${r.value}는 등록의 ${pct(regShare)}지만 방문자의 ${pct(visShare)}예요`, detail: `등록 대비 실제 방문 기여가 커요 — 순방문 ${num(r.visitors)}명(동반 포함 ${num(r.visitorsWithCompanions)}명).` });
    }
  }
  return out;
}
