import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { RealtimeReportData } from "@/app/(app)/dashboard/RealtimeReport";
import { normalizeUtmKey } from "@/lib/attribution-normalize";
import { getGa4ActiveUsers, getGa4ActiveUsersByDay } from "@/lib/ga4";
import {
  equivalentPreviousCutoff,
  eventDday,
  resolveCollectEventPair,
} from "@/lib/collect-event-comparison";
import { collectColumnsFor } from "@/lib/collect-columns";
import { splitCollectValues } from "@/lib/collect-value-split";

// 결과 캐싱 (egress 절감): 동일 조건 조회를 짧게 캐시해 반복 DB 트래픽 제거.
// 서버리스 인스턴스 단위 캐시 — 같은 인스턴스에 도달하는 반복/동시 조회에 효과.
const REPORT_CACHE = new Map<string, { at: number; data: RealtimeReportData }>();
const REPORT_CACHE_TTL_MS = 60_000;

export interface ReportFilters {
  sourceId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  attribution?: "last" | "first";
}

interface RequestBody {
  workspaceId: string;
  projectId: string;
  from?: string;
  to?: string;
  filters?: ReportFilters;
}

const KST_OFFSET = 9 * 60 * 60_000;
const DAY_MS = 86_400_000;

type TimedRecord = { createdAt: Date; data: Prisma.JsonValue };
type CompositionRecord = { sourceId: string; data: Prisma.JsonValue };
type FieldAlias = {
  key: string;
  label: string;
  normalizedKey: string;
  normalizedLabel: string;
};

const VISITOR_DIMENSIONS = [
  {
    key: "industry",
    label: "산업/업종",
    candidates: ["industry", "industries", "산업", "업종", "종사 산업", "관심 산업", "관심분야", "관심 분야"],
  },
  {
    key: "role",
    label: "직무/직책",
    candidates: ["jobTitle", "job_title", "position", "role", "title", "직책", "직함", "직급", "직위", "부서", "department", "담당업무"],
  },
  {
    key: "interest",
    label: "관심 분야",
    candidates: ["interest", "interests", "관심", "관심 제품", "관심분야", "관심 분야", "참관목적", "참관 목적", "참관 희망 전시회", "희망 전시회", "전시회", "방문 목적", "visit_purpose"],
  },
  {
    key: "company",
    label: "회사/기관",
    candidates: ["company", "organization", "org", "회사", "소속 회사", "기관", "기관명", "소속"],
  },
] as const;

const EMAIL_FIELD_CANDIDATES = [
  "email", "이메일", "Email", "메일", "mail", "e-mail", "emailAddress", "email_address",
] as const;

const TIME_FIELD_CANDIDATES = [
  "createdAt",
  "created_at",
  "created",
  "submittedAt",
  "submitted_at",
  "submitted",
  "submissionTime",
  "submission_time",
  "timestamp",
  "datetime",
  "dateTime",
  "time",
  "date",
  "registeredAt",
  "registered_at",
  "appliedAt",
  "applied_at",
  "응답시간",
  "응답 시간",
  "응답일시",
  "응답 일시",
  "신청일시",
  "신청 일시",
  "신청시간",
  "신청 시간",
  "신청일",
  "신청 일",
  "등록일시",
  "등록 일시",
  "등록시간",
  "등록 시간",
  "등록일",
  "등록 일",
  "접수일시",
  "접수 일시",
  "접수시간",
  "접수 시간",
  "접수일",
  "접수 일",
  "작성일시",
  "작성 일시",
  "작성시간",
  "작성 시간",
  "작성일",
  "작성 일",
  "일시",
  "날짜",
  "시간",
] as const;

function parseDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function getKstDayStart(date: Date) {
  const kst = new Date(date.getTime() + KST_OFFSET);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET);
}

function getUtmColumns(filters?: ReportFilters) {
  const useFirst = filters?.attribution === "first";
  return useFirst
    ? { source: "firstUtmSource", medium: "firstUtmMedium", campaign: "firstUtmCampaign", term: "firstUtmTerm", content: "firstUtmContent" }
    : { source: "utmSource", medium: "utmMedium", campaign: "utmCampaign", term: "utmTerm", content: "utmContent" };
}

function buildWhere(params: {
  workspaceId: string;
  projectId: string;
  filters?: ReportFilters;
  from?: Date;
  to?: Date;
  lt?: Date;
}) {
  const { workspaceId, projectId, filters, from, to, lt } = params;
  const utm = getUtmColumns(filters);
  const where: Prisma.CollectRecordWhereInput = { workspaceId, projectId };

  if (filters?.sourceId && filters.sourceId !== "all") where.sourceId = filters.sourceId;
  if (filters?.utmSource) Object.assign(where, { [utm.source]: filters.utmSource });
  if (filters?.utmMedium) Object.assign(where, { [utm.medium]: filters.utmMedium });
  if (filters?.utmCampaign) Object.assign(where, { [utm.campaign]: filters.utmCampaign });
  if (from || to || lt) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
      ...(lt ? { lt } : {}),
    };
  }
  return where;
}

// Build a parameterized SQL WHERE clause ($1, $2, …) + value list.
// NOTE: Prisma v7 regression (#28963) — nested Prisma.sql fragments inside
// $queryRaw template literals are serialized as JSON instead of composed as SQL.
// So we build a plain string + values and run it via $queryRawUnsafe.
// Column names come only from getUtmColumns (fixed whitelist), never user input.
function buildRawWhere(params: {
  workspaceId: string;
  projectId: string;
  filters?: ReportFilters;
  from?: Date;
  to?: Date;
  lt?: Date;
}): { clause: string; values: unknown[] } {
  const { workspaceId, projectId, filters, from, to, lt } = params;
  const utm = getUtmColumns(filters);
  const conds: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown) => { values.push(val); conds.push(`${col} = $${values.length}`); };
  push(`"workspaceId"`, workspaceId);
  push(`"projectId"`, projectId);
  if (filters?.sourceId && filters.sourceId !== "all") push(`"sourceId"`, filters.sourceId);
  if (filters?.utmSource) push(`"${utm.source}"`, filters.utmSource);
  if (filters?.utmMedium) push(`"${utm.medium}"`, filters.utmMedium);
  if (filters?.utmCampaign) push(`"${utm.campaign}"`, filters.utmCampaign);
  if (from) { values.push(from); conds.push(`"createdAt" >= $${values.length}`); }
  if (to) { values.push(to); conds.push(`"createdAt" <= $${values.length}`); }
  if (lt) { values.push(lt); conds.push(`"createdAt" < $${values.length}`); }
  return { clause: conds.join(" AND "), values };
}

function normalizeKey(key: string) {
  return key.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

function hasMeaningfulKstTime(date: Date) {
  const kst = new Date(date.getTime() + KST_OFFSET);
  return kst.getUTCHours() !== 0 || kst.getUTCMinutes() !== 0 || kst.getUTCSeconds() !== 0 || kst.getUTCMilliseconds() !== 0;
}

function makeKstDateTimeFromParts(params: { year: string | number; month: string | number; day: string | number; hour?: string | number; minute?: string | number; second?: string | number }) {
  const iso = `${params.year}-${String(params.month).padStart(2, "0")}-${String(params.day).padStart(2, "0")}T${String(params.hour ?? 0).padStart(2, "0")}:${String(params.minute ?? 0).padStart(2, "0")}:${String(params.second ?? 0).padStart(2, "0")}+09:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateLike(value: unknown, baseDate?: Date): { date: Date; hasTime: boolean } | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      date: value,
      hasTime: hasMeaningfulKstTime(value),
    };
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const timeOnly = raw.match(/^(오전|오후|AM|PM|am|pm)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnly && baseDate) {
    const baseKst = new Date(baseDate.getTime() + KST_OFFSET);
    let hour = Number(timeOnly[2]);
    const minute = Number(timeOnly[3]);
    const second = Number(timeOnly[4] ?? 0);
    const meridiem = timeOnly[1]?.toLowerCase();

    if (meridiem === "오후" || meridiem === "pm") {
      if (hour < 12) hour += 12;
    } else if ((meridiem === "오전" || meridiem === "am") && hour === 12) {
      hour = 0;
    }

    const parsed = makeKstDateTimeFromParts({
      year: baseKst.getUTCFullYear(),
      month: baseKst.getUTCMonth() + 1,
      day: baseKst.getUTCDate(),
      hour,
      minute,
      second,
    });
    if (parsed) return { date: parsed, hasTime: true };
  }

  const hasExplicitZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  if (hasExplicitZone) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return { date: parsed, hasTime: /\d{1,2}:\d{2}/.test(raw) };
  }

  const dateTime = raw.match(/^(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})(?:\s*(?:[T ]|일|\.)\s*)?(?:(오전|오후|AM|PM|am|pm)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dateTime) {
    let hour = dateTime[5] ? Number(dateTime[5]) : 0;
    const minute = dateTime[6] ? Number(dateTime[6]) : 0;
    const second = dateTime[7] ? Number(dateTime[7]) : 0;
    const meridiem = dateTime[4]?.toLowerCase();

    if (meridiem === "오후" || meridiem === "pm") {
      if (hour < 12) hour += 12;
    } else if ((meridiem === "오전" || meridiem === "am") && hour === 12) {
      hour = 0;
    }

    const parsed = makeKstDateTimeFromParts({
      year: dateTime[1],
      month: dateTime[2],
      day: dateTime[3],
      hour,
      minute,
      second,
    });
    if (parsed) {
      return { date: parsed, hasTime: !!dateTime[5] };
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    date: parsed,
    hasTime: /\d{1,2}:\d{2}/.test(raw) || /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw),
  };
}

function resolveEventTime(record: TimedRecord) {
  // 수집 레코드 자체의 createdAt 시간을 메인 기준으로 사용한다.
  // CSV/엑셀 일괄등록에서 createdAt이 날짜만 들어와 KST 00:00이 된 경우에만
  // 원본 데이터의 시간 필드로 보정한다.
  if (hasMeaningfulKstTime(record.createdAt)) return record.createdAt;

  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    const data = record.data as Record<string, unknown>;
    const normalizedCandidates = new Set(TIME_FIELD_CANDIDATES.map(normalizeKey));

    for (const [key, value] of Object.entries(data)) {
      if (!normalizedCandidates.has(normalizeKey(key))) continue;

      const parsed = parseDateLike(value, record.createdAt);
      if (parsed?.hasTime) return parsed.date;
    }
  }

  return record.createdAt;
}

function buildFieldAliasLookup(sources: Array<{ id: string; fieldMappings: Array<{ key: string; label: string }> }>) {
  return new Map(
    sources.map((source) => [
      source.id,
      source.fieldMappings.map((field) => ({
        key: field.key,
        label: field.label,
        normalizedKey: normalizeKey(field.key),
        normalizedLabel: normalizeKey(field.label),
      })),
    ]),
  );
}

function matchesCandidate(value: string, candidate: string) {
  return value === candidate || value.includes(candidate) || candidate.includes(value);
}

// composition / email / dedup 계산에 쓰이는 후보 키 전체.
// 이 후보들과 매칭되는 필드만 DB에서 추출하면 data JSON 전체를 안 받아도 됨(egress 절감).
const COMPOSITION_EMAIL_CANDIDATES: readonly string[] = [
  ...VISITOR_DIMENSIONS.flatMap((d) => d.candidates),
  ...EMAIL_FIELD_CANDIDATES,
];

// 소스 fieldMappings 에서 후보(키 또는 라벨)와 매칭되는 실제 data 키 목록을 산출한다.
// pickValue 의 매칭 규칙(normalizeKey + 양방향 부분일치)을 그대로 재현 → 결과 동일성 보존.
function resolveCompositionKeys(
  sources: Array<{ id: string; fieldMappings: Array<{ key: string; label: string }> }>,
): string[] {
  const normCandidates = COMPOSITION_EMAIL_CANDIDATES.map(normalizeKey).filter((c) => c.length > 1);
  const keys = new Set<string>();
  for (const src of sources) {
    for (const fm of src.fieldMappings) {
      const nk = normalizeKey(fm.key);
      const nl = normalizeKey(fm.label);
      if (normCandidates.some((c) => matchesCandidate(nk, c) || (nl ? matchesCandidate(nl, c) : false))) {
        keys.add(fm.key);
      }
    }
  }
  return [...keys];
}

function pickValue(data: Prisma.JsonValue, candidates: readonly string[], fieldAliases: FieldAlias[] = []) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const record = data as Record<string, unknown>;
  const normalizedCandidates = candidates.map(normalizeKey).filter((candidate) => candidate.length > 1);
  const entries = Object.entries(record).map(([key, value]) => {
    const alias = fieldAliases.find((field) => field.key === key);
    return {
      key,
      value,
      normalizedKey: normalizeKey(key),
      normalizedLabel: alias?.normalizedLabel ?? "",
    };
  });

  for (const candidate of normalizedCandidates) {
    const matched = entries.find(({ normalizedKey, normalizedLabel }) => (
      matchesCandidate(normalizedKey, candidate) ||
      (normalizedLabel ? matchesCandidate(normalizedLabel, candidate) : false)
    ));
    if (matched) return splitCollectValues(matched.value);
  }
  return [];
}

function topEntriesBySectionMax(counts: Map<string, number>, limit: number) {
  const max = Math.max(0, ...Array.from(counts.values()));
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, percent: max > 0 ? (count / max) * 100 : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function cleanUtmValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

interface YearOverYear {
  compareSourceName: string;
  compareTotal: number;
  progressPercent: number | null;
  daysUntilEvent: number | null;
  pace: null | {
    lastYearCountAtSameOffset: number;
    paceRatio: number | null;
  };
}

function buildHeatmapFromRows(rows: Array<{ dow: number; hour: number; count: number }>) {
  const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
  const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dayTotals = Array(7).fill(0) as number[];
  const hourTotals = Array(24).fill(0) as number[];

  for (const row of rows) {
    // Postgres DOW: 0=Sunday..6=Saturday. We want 0=Mon..6=Sun.
    const dayIndex = (row.dow + 6) % 7;
    const hour = row.hour;
    if (dayIndex < 0 || dayIndex > 6 || hour < 0 || hour > 23) continue;
    matrix[dayIndex][hour] += row.count;
    dayTotals[dayIndex] += row.count;
    hourTotals[hour] += row.count;
  }

  const max = matrix.flat().reduce((peak, count) => Math.max(peak, count), 0);
  const peakDayIndex = dayTotals.reduce((best, count, index) => count > dayTotals[best] ? index : best, 0);
  const peakHour = hourTotals.reduce((best, count, index) => count > hourTotals[best] ? index : best, 0);
  const topSlots = matrix
    .flatMap((row, dayIndex) => row.map((count, hour) => ({ day: dayLabels[dayIndex], hour, count })))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    dayLabels,
    matrix,
    max,
    peakDay: { label: dayLabels[peakDayIndex], count: dayTotals[peakDayIndex] ?? 0 },
    peakHour: { hour: peakHour, count: hourTotals[peakHour] ?? 0 },
    topSlots,
  };
}

function buildCumulativeTrendFromRows(
  rows: Array<{ day: string; count: number }>,
  from: Date,
  to: Date,
  initialCount: number,
) {
  const dailyCounts = new Map<string, number>();
  for (const row of rows) {
    // row.day is already a KST date string yyyy-mm-dd
    dailyCounts.set(row.day, (dailyCounts.get(row.day) ?? 0) + row.count);
  }
  const points: Array<{ date: string; label: string; count: number; cumulative: number }> = [];
  let cumulative = initialCount;
  let cursor = getKstDayStart(from);
  const end = getKstDayStart(to);
  while (cursor.getTime() <= end.getTime()) {
    const date = getKstDateKey(cursor);
    const count = dailyCounts.get(date) ?? 0;
    cumulative += count;
    points.push({
      date,
      label: date.slice(5).replace("-", "."),
      count,
      cumulative,
    });
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return points;
}

function buildDailyUtmTrendFromRows(
  rows: Array<{ day: string; source: string | null; medium: string | null; count: number }>,
  from: Date,
  to: Date,
): { source: DailyUtmView; medium: DailyUtmView; combined: DailyUtmView } {
  const TOP = 5;

  // 같은 채널이 대소문자 차이로 추이 차트에 두 시리즈로 갈라지지 않게 접는다(utmTop 과 같은 규칙).
  const getKey = (row: { source: string | null; medium: string | null }, dimension: "source" | "medium" | "combined") => {
    const src = normalizeUtmKey(row.source);
    const med = normalizeUtmKey(row.medium);
    if (dimension === "source") return src;
    if (dimension === "medium") return med;
    return [src, med].filter(Boolean).join(" / ");
  };

  const buildView = (dimension: "source" | "medium" | "combined"): DailyUtmView => {
    const totals = new Map<string, number>();
    const daily = new Map<string, Map<string, number>>();

    for (const row of rows) {
      const key = getKey(row, dimension);
      if (!key) continue;
      const date = row.day;
      totals.set(key, (totals.get(key) ?? 0) + row.count);
      if (!daily.has(date)) daily.set(date, new Map());
      const dayMap = daily.get(date)!;
      dayMap.set(key, (dayMap.get(key) ?? 0) + row.count);
    }

    const topKeys = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP)
      .map(([k]) => k);

    const rowsOut: DailyUtmRow[] = [];
    let cursor = getKstDayStart(from);
    const end = getKstDayStart(to);
    while (cursor.getTime() <= end.getTime()) {
      const date = getKstDateKey(cursor);
      const dayMap = daily.get(date) ?? new Map<string, number>();
      const row: DailyUtmRow = { date };
      for (const key of topKeys) row[key] = dayMap.get(key) ?? 0;
      rowsOut.push(row);
      cursor = new Date(cursor.getTime() + DAY_MS);
    }

    return { topKeys, rows: rowsOut };
  };

  return {
    source: buildView("source"),
    medium: buildView("medium"),
    combined: buildView("combined"),
  };
}

function buildHeatmap(records: TimedRecord[]) {
  const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
  const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dayTotals = Array(7).fill(0) as number[];
  const hourTotals = Array(24).fill(0) as number[];

  for (const record of records) {
    const eventTime = resolveEventTime(record);
    const kst = new Date(eventTime.getTime() + KST_OFFSET);
    const dayIndex = (kst.getUTCDay() + 6) % 7;
    const hour = kst.getUTCHours();
    matrix[dayIndex][hour] += 1;
    dayTotals[dayIndex] += 1;
    hourTotals[hour] += 1;
  }

  const max = matrix.flat().reduce((peak, count) => Math.max(peak, count), 0);
  const peakDayIndex = dayTotals.reduce((best, count, index) => count > dayTotals[best] ? index : best, 0);
  const peakHour = hourTotals.reduce((best, count, index) => count > hourTotals[best] ? index : best, 0);
  const topSlots = matrix
    .flatMap((row, dayIndex) => row.map((count, hour) => ({ day: dayLabels[dayIndex], hour, count })))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    dayLabels,
    matrix,
    max,
    peakDay: { label: dayLabels[peakDayIndex], count: dayTotals[peakDayIndex] ?? 0 },
    peakHour: { hour: peakHour, count: hourTotals[peakHour] ?? 0 },
    topSlots,
  };
}

function getKstDateKey(date: Date) {
  const kst = new Date(date.getTime() + KST_OFFSET);
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * GA4 일별 방문자 행("YYYYMMDD" 키, 방문 0인 날은 행 자체가 없음)을 조회 구간의
 * 매일에 맞춰 0으로 채운 연속 배열로 편다 — 요약 카드 미니 추이선(Sparkline)이
 * cumulativeTrend 와 같은 "구간 전체를 빠짐없이" 규칙을 따르게 한다.
 */
export function buildGa4DailyTrend(rows: Array<{ date: string; count: number }> | null, from: Date, to: Date): number[] | null {
  if (!rows) return null;
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (row.date.length !== 8) continue;
    const key = `${row.date.slice(0, 4)}-${row.date.slice(4, 6)}-${row.date.slice(6, 8)}`;
    byDate.set(key, row.count);
  }
  const points: number[] = [];
  let cursor = getKstDayStart(from);
  const end = getKstDayStart(to);
  while (cursor.getTime() <= end.getTime()) {
    points.push(byDate.get(getKstDateKey(cursor)) ?? 0);
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return points;
}

interface UtmTrendRecord {
  createdAt: Date;
  utmSource: string | null;
  utmMedium: string | null;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
}

interface DailyUtmRow {
  date: string;
  [key: string]: number | string;
}

interface DailyUtmView {
  topKeys: string[];
  rows: DailyUtmRow[];
}

function buildDailyUtmTrend(
  records: UtmTrendRecord[],
  from: Date,
  to: Date,
  useFirst: boolean,
): { source: DailyUtmView; medium: DailyUtmView; combined: DailyUtmView } {
  const TOP = 5;

  const getKey = (record: UtmTrendRecord, dimension: "source" | "medium" | "combined") => {
    const src = (useFirst ? record.firstUtmSource : record.utmSource) ?? "";
    const med = (useFirst ? record.firstUtmMedium : record.utmMedium) ?? "";
    if (dimension === "source") return src;
    if (dimension === "medium") return med;
    return [src, med].filter(Boolean).join(" / ");
  };

  const buildView = (dimension: "source" | "medium" | "combined"): DailyUtmView => {
    const totals = new Map<string, number>();
    const daily = new Map<string, Map<string, number>>();

    for (const record of records) {
      const key = getKey(record, dimension);
      if (!key) continue;
      const date = getKstDateKey(resolveEventTime(record as unknown as TimedRecord));
      totals.set(key, (totals.get(key) ?? 0) + 1);
      if (!daily.has(date)) daily.set(date, new Map());
      const dayMap = daily.get(date)!;
      dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
    }

    const topKeys = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP)
      .map(([k]) => k);

    const rows: DailyUtmRow[] = [];
    let cursor = getKstDayStart(from);
    const end = getKstDayStart(to);
    while (cursor.getTime() <= end.getTime()) {
      const date = getKstDateKey(cursor);
      const dayMap = daily.get(date) ?? new Map<string, number>();
      const row: DailyUtmRow = { date };
      for (const key of topKeys) row[key] = dayMap.get(key) ?? 0;
      rows.push(row);
      cursor = new Date(cursor.getTime() + DAY_MS);
    }

    return { topKeys, rows };
  };

  return {
    source: buildView("source"),
    medium: buildView("medium"),
    combined: buildView("combined"),
  };
}

function buildCumulativeTrend(records: TimedRecord[], from: Date, to: Date, initialCount: number) {
  const dailyCounts = new Map<string, number>();
  for (const record of records) {
    const key = getKstDateKey(resolveEventTime(record));
    dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
  }

  const points: Array<{ date: string; label: string; count: number; cumulative: number }> = [];
  let cumulative = initialCount;
  let cursor = getKstDayStart(from);
  const end = getKstDayStart(to);

  while (cursor.getTime() <= end.getTime()) {
    const date = getKstDateKey(cursor);
    const count = dailyCounts.get(date) ?? 0;
    cumulative += count;
    points.push({
      date,
      label: date.slice(5).replace("-", "."),
      count,
      cumulative,
    });
    cursor = new Date(cursor.getTime() + DAY_MS);
  }

  return points;
}

async function clampToOperationStart(from: Date, source: { id: string; createdAt: Date } | undefined): Promise<Date> {
  if (!source || from.getTime() >= source.createdAt.getTime()) return from;
  const first = await prisma.collectRecord.findFirst({
    where: { sourceId: source.id },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const start = first && first.createdAt < source.createdAt ? first.createdAt : source.createdAt;
  return from.getTime() >= start.getTime() ? from : getKstDayStart(start);
}

export interface GenerateReportOptions {
  workspaceId: string;
  projectId: string;
  from?: string;
  to?: string;
  filters?: ReportFilters;
}

export async function generateDashboardReport(options: GenerateReportOptions) {
  const { workspaceId, projectId, filters } = options;

  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId } });
  if (!project) return { error: "프로젝트 없음" as const };

  const sourceCatalog = await prisma.collectSource.findMany({
    where: { workspaceId, projectId, deletedAt: null },
    select: {
      id: true,
      name: true,
      isActive: true,
      formConfig: true,
      venueConfig: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const requestedSourceId = filters?.sourceId && filters.sourceId !== "all" ? filters.sourceId : null;
  const eventPair = resolveCollectEventPair(sourceCatalog, requestedSourceId);
  // 프로젝트 전체를 세면 2025·2026 행사가 한 누적으로 합쳐진다. 상세는 URL 소스, 요약은
  // 현재 활성 행사 하나를 기준으로 고정한다. 활성 소스가 없으면 전체로 되돌리지 않고 0건이다.
  const effectiveFilters: ReportFilters = {
    ...filters,
    sourceId: eventPair.current?.source.id ?? "__no_active_collect_source__",
  };

  const cacheKey = JSON.stringify({
    workspaceId,
    projectId,
    filters: effectiveFilters,
    previousSourceId: eventPair.previous?.source.id ?? null,
    from: options.from,
    to: options.to,
  });
  const cachedHit = REPORT_CACHE.get(cacheKey);
  if (cachedHit && Date.now() - cachedHit.at < REPORT_CACHE_TTL_MS) {
    return { data: cachedHit.data };
  }

  const now = new Date();
  const to = parseDate(options.to, now);
  const requestedFrom = parseDate(options.from, new Date(to.getTime() - 7 * DAY_MS));
  /**
   * "전체 기간"(epoch 부터)은 **그 폼이 운영을 시작한 날**부터로 자른다. 대시보드·현황 탭이 전체
   * 기간을 기본으로 보게 되면서(2026-10-08) 그대로 두면 일별 추이를 1970년부터 하루씩 채우고,
   * 비교 구간도 반세기 전이 된다. 시작일 = 폼 생성일과 첫 등록 중 이른 날(가져오기로 넣은 과거
   * 등록이 생성일보다 앞설 수 있다).
   */
  const from = await clampToOperationStart(requestedFrom, eventPair.current?.source);
  const todayStart = getKstDayStart(now);
  const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
  const span = Math.max(to.getTime() - from.getTime(), DAY_MS);
  const previousFrom = new Date(from.getTime() - span);
  const hasPaceComparison = Boolean(eventPair.current?.eventStart && eventPair.previous?.eventStart);
  const previousPaceCutoff = hasPaceComparison
    ? equivalentPreviousCutoff(eventPair.current!.eventStart!, eventPair.previous!.eventStart!, now)
    : null;
  const previousEventRangeFrom = hasPaceComparison
    ? equivalentPreviousCutoff(eventPair.current!.eventStart!, eventPair.previous!.eventStart!, from)
    : null;
  const previousEventRangeTo = hasPaceComparison
    ? equivalentPreviousCutoff(eventPair.current!.eventStart!, eventPair.previous!.eventStart!, to)
    : null;

  const baseParams = { workspaceId, projectId, filters: effectiveFilters };
  const previousFilters: ReportFilters | null = eventPair.previous
    ? { ...filters, sourceId: eventPair.previous.source.id }
    : null;
  const rangeWhere = buildWhere({ ...baseParams, from, to });
  const rangeRawWhere = buildRawWhere({ ...baseParams, from, to });
  const utmCols = getUtmColumns(filters);
  const utmSourceCol = utmCols.source === "firstUtmSource" ? "firstUtmSource" : "utmSource";
  const utmMediumCol = utmCols.medium === "firstUtmMedium" ? "firstUtmMedium" : "utmMedium";
  const utmTermCol = utmCols.term === "firstUtmTerm" ? "firstUtmTerm" : "utmTerm";

  // composition/email/dedup 에 필요한 필드만 추출하기 위해 소스 필드 정의를 먼저 조회
  const sourceRows = await prisma.collectSource.findMany({
    where: {
      workspaceId,
      projectId,
      id: effectiveFilters.sourceId ?? "__no_active_collect_source__",
    },
    select: {
      id: true,
      mode: true,
      formConfig: true,
      fieldMappings: { select: { id: true, index: true, key: true, label: true, type: true, isRequired: true, showInDashboard: true, sortOrder: true } },
    },
  });
  // 연동형은 저장된 매핑을, 빌더형은 폼 정의를 단일 출처로 쓴다. 빌더형에는 FieldMapping 행이
  // 없으므로 formConfig에서 열을 재생성하지 않으면 항목별 통계 토글과 차트가 모두 사라진다.
  const sourceFields = sourceRows.map((source) => ({
    id: source.id,
    fieldMappings: collectColumnsFor(source),
  }));
  /**
   * 운영자가 '필드' 탭에서 "통계" 를 켠 필드 — 프로젝트마다 수집 필드가 다 다르므로,
   * VISITOR_DIMENSIONS 같은 고정 후보 목록으로는 못 커버한다. 기본값이 true 라(스키마 주석)
   * 새 필드는 자동으로 여기 잡히고, 운영자가 안 쓸 것만 끈다.
   */
  const dashboardFields = new Map<string, { label: string; type: string; options: string[] }>();
  for (const src of sourceFields) {
    for (const fm of src.fieldMappings) {
      if (!fm.showInDashboard || dashboardFields.has(fm.key)) continue;
      dashboardFields.set(fm.key, { label: fm.label || fm.key, type: fm.type, options: fm.options ?? [] });
    }
  }
  const compositionKeys = Array.from(new Set([...resolveCompositionKeys(sourceFields), ...dashboardFields.keys()]));

  const [yesterdayCount, todayCount, cumulativeCount, rangeCount, previousRangeCount, cumulativeBeforeRange, previousTotalCount, previousPaceCount, previousRangeMatchedCount, heatmapRecords, utmGroups, heatmapRows, cumulativeDailyRows, utmTrendRows, ambassadorRows, ambassadorLinks] = await Promise.all([
    prisma.collectRecord.count({ where: buildWhere({ ...baseParams, from: yesterdayStart, lt: todayStart }) }),
    prisma.collectRecord.count({ where: buildWhere({ ...baseParams, from: todayStart, to: now }) }),
    prisma.collectRecord.count({ where: buildWhere(baseParams) }),
    prisma.collectRecord.count({ where: rangeWhere }),
    prisma.collectRecord.count({ where: buildWhere({ ...baseParams, from: previousFrom, lt: from }) }),
    prisma.collectRecord.count({ where: buildWhere({ ...baseParams, lt: from }) }),
    previousFilters
      ? prisma.collectRecord.count({ where: buildWhere({ workspaceId, projectId, filters: previousFilters }) })
      : Promise.resolve(null),
    previousFilters && previousPaceCutoff
      ? prisma.collectRecord.count({ where: buildWhere({ workspaceId, projectId, filters: previousFilters, to: previousPaceCutoff }) })
      : Promise.resolve(null),
    previousFilters && previousEventRangeFrom && previousEventRangeTo
      ? prisma.collectRecord.count({ where: buildWhere({ workspaceId, projectId, filters: previousFilters, from: previousEventRangeFrom, to: previousEventRangeTo }) })
      : Promise.resolve(null),
    // composition / emailDomainTop / dedup 용 — data JSON 전체 대신 집계에 필요한 필드만 추출(egress 절감).
    // 매칭되는 필드가 없으면 빈 배열. jsonb_build_object 로 부분 data 객체를 재구성 → 기존 메모리 로직 그대로 동작.
    (() => {
      if (compositionKeys.length === 0) {
        return Promise.resolve([] as Array<{ sourceId: string; data: Prisma.JsonValue }>);
      }
      const base = rangeRawWhere.values.length;
      // pg 파라미터 타입 모호성 회피: jsonb_build_object 키와 data-> 키 모두 ::text 캐스팅
      const pairs = compositionKeys.map((_, i) => `$${base + i + 1}::text, data->($${base + i + 1}::text)`).join(", ");
      return prisma.$queryRawUnsafe<Array<{ sourceId: string; data: Prisma.JsonValue }>>(
        `SELECT "sourceId", jsonb_build_object(${pairs}) AS data FROM "CollectRecord" WHERE ${rangeRawWhere.clause} LIMIT 50000`,
        ...rangeRawWhere.values, ...compositionKeys,
      );
    })(),
    (prisma.collectRecord.groupBy as unknown as (args: {
      by: string[];
      where: Prisma.CollectRecordWhereInput;
      _count: { _all: true };
    }) => Promise<Array<Record<string, string | null> & { _count: { _all: number } }>>)({
      by: [getUtmColumns(filters).source, getUtmColumns(filters).medium, getUtmColumns(filters).campaign],
      where: rangeWhere,
      _count: { _all: true },
    }),
    // Heatmap: KST day-of-week + hour aggregation in SQL.
    prisma.$queryRawUnsafe<Array<{ dow: number; hour: number; count: number }>>(`
      SELECT
        (EXTRACT(DOW FROM ("createdAt" + INTERVAL '9 hours')))::int AS dow,
        (EXTRACT(HOUR FROM ("createdAt" + INTERVAL '9 hours')))::int AS hour,
        COUNT(*)::int AS count
      FROM "CollectRecord"
      WHERE ${rangeRawWhere.clause}
      GROUP BY dow, hour
    `, ...rangeRawWhere.values),
    // Cumulative daily counts (KST).
    prisma.$queryRawUnsafe<Array<{ day: string; count: number }>>(`
      SELECT
        TO_CHAR(DATE_TRUNC('day', "createdAt" + INTERVAL '9 hours'), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS count
      FROM "CollectRecord"
      WHERE ${rangeRawWhere.clause}
      GROUP BY day
      ORDER BY day
    `, ...rangeRawWhere.values),
    // Daily UTM trend (source + medium pair, per KST day).
    prisma.$queryRawUnsafe<Array<{ day: string; source: string | null; medium: string | null; count: number }>>(`
      SELECT
        TO_CHAR(DATE_TRUNC('day', "createdAt" + INTERVAL '9 hours'), 'YYYY-MM-DD') AS day,
        "${utmSourceCol}" AS source,
        "${utmMediumCol}" AS medium,
        COUNT(*)::int AS count
      FROM "CollectRecord"
      WHERE ${rangeRawWhere.clause}
      GROUP BY day, source, medium
    `, ...rangeRawWhere.values),
    prisma.$queryRawUnsafe<Array<{ name: string | null; count: number }>>(`
      SELECT NULLIF(TRIM("${utmTermCol}"), '') AS name, COUNT(*)::int AS count
      FROM "CollectRecord"
      WHERE ${rangeRawWhere.clause}
        AND LOWER(TRIM(COALESCE("${utmSourceCol}", ''))) = 'ambassador'
      GROUP BY name
      ORDER BY count DESC, name ASC
    `, ...rangeRawWhere.values),
    prisma.uTMLink.findMany({
      where: { workspaceId, projectId },
      select: { utmSource: true, utmTerm: true },
    }),
  ]);

  const fieldAliasesBySource = buildFieldAliasLookup(sourceFields);
  const composition = VISITOR_DIMENSIONS.map((dimension) => {
    const counts = new Map<string, number>();
    for (const record of heatmapRecords as unknown as CompositionRecord[]) {
      const fieldAliases = fieldAliasesBySource.get(record.sourceId) ?? [];
      for (const value of pickValue(record.data, dimension.candidates, fieldAliases)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    const items = topEntriesBySectionMax(counts, 5);
    return { key: dimension.key, label: dimension.label, items, total: Array.from(counts.values()).reduce((sum, count) => sum + count, 0) };
  }).filter((section) => section.items.length > 0).slice(0, 4);

  /**
   * 필드별 통계 — '필드' 탭 "통계" 토글이 켜진 필드마다 값 분포 카드 하나.
   * composition 과 달리 후보 키워드로 추측하지 않는다 — FieldMapping.key 를 그대로 쓴다.
   * 체크박스형(콤마로 이어붙인 다중 선택)도 splitValues 로 항목별로 갈라서 센다.
   */
  const fieldStats = Array.from(dashboardFields.entries()).map(([key, meta]) => {
    const counts = new Map<string, number>();
    for (const record of heatmapRecords as unknown as CompositionRecord[]) {
      const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
        ? (record.data as Record<string, unknown>)
        : {};
      for (const value of splitCollectValues(data[key], meta.options)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    const items = topEntriesBySectionMax(counts, 8);
    return {
      key,
      label: meta.label,
      items,
      total: Array.from(counts.values()).reduce((sum, count) => sum + count, 0),
    };
  }).filter((section) => section.items.length > 0);

  // Email domain TOP 10
  const emailDomainCounts = new Map<string, number>();
  for (const record of heatmapRecords as unknown as CompositionRecord[]) {
    const fieldAliases = fieldAliasesBySource.get(record.sourceId) ?? [];
    const emails = pickValue(record.data, EMAIL_FIELD_CANDIDATES, fieldAliases);
    for (const email of emails) {
      const trimmed = email.trim().toLowerCase();
      const atIndex = trimmed.lastIndexOf("@");
      if (atIndex < 1 || atIndex === trimmed.length - 1) continue;
      const domain = trimmed.slice(atIndex + 1);
      if (!domain.includes(".")) continue;
      emailDomainCounts.set(domain, (emailDomainCounts.get(domain) ?? 0) + 1);
    }
  }
  const emailDomainTotal = Array.from(emailDomainCounts.values()).reduce((s, c) => s + c, 0);
  const emailDomainTop = Array.from(emailDomainCounts.entries())
    .map(([domain, count]) => ({
      domain,
      count,
      percent: emailDomainTotal > 0 ? (count / emailDomainTotal) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Unique vs duplicate email (within range)
  const emailSeen = new Map<string, number>();
  let recordsWithEmail = 0;
  for (const record of heatmapRecords as unknown as CompositionRecord[]) {
    const fieldAliases = fieldAliasesBySource.get(record.sourceId) ?? [];
    const emails = pickValue(record.data, EMAIL_FIELD_CANDIDATES, fieldAliases);
    if (emails.length === 0) continue;
    const email = emails[0].trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    recordsWithEmail += 1;
    emailSeen.set(email, (emailSeen.get(email) ?? 0) + 1);
  }
  const uniqueEmails = emailSeen.size;
  const duplicateRecords = recordsWithEmail - uniqueEmails;
  const dedup = {
    totalRecordsWithEmail: recordsWithEmail,
    uniqueEmails,
    duplicateRecords,
    uniqueRatio: recordsWithEmail > 0 ? uniqueEmails / recordsWithEmail : null,
  };

  /**
   * source/medium 은 접은 키로 **재병합**한다.
   *
   * groupBy 는 DB 원본값으로 묶으므로 naver / Naver 가 별개 그룹으로 나온다. 예전엔 trim 만 하고
   * 재병합을 안 해서 같은 채널이 리포트에 두 줄로 잡히고 비율(percent)이 서로 나뉘었다.
   * 정규화 규칙은 웨비나 분석 표와 같은 함수(attribution-normalize)를 쓴다 — 한 제품 안에서
   * 같은 채널이 화면마다 다른 이름·다른 비율로 보이면 안 된다.
   */
  const mergedUtm = new Map<string, { source: string; medium: string; campaign: string; count: number }>();
  for (const group of utmGroups) {
    const source = normalizeUtmKey(group[utmCols.source]);
    const medium = normalizeUtmKey(group[utmCols.medium]);
    const campaign = cleanUtmValue(group[utmCols.campaign]);
    if (!source && !medium && !campaign) continue;
    const key = `${source}|${medium}|${campaign}`;
    const prev = mergedUtm.get(key);
    if (prev) prev.count += group._count._all;
    else mergedUtm.set(key, { source, medium, campaign, count: group._count._all });
  }
  const utmRows = Array.from(mergedUtm.values());
  const utmTotal = utmRows.reduce((sum, group) => sum + group.count, 0);
  const utmTop = utmRows
    .map((group) => ({
      source: group.source || "소스 미지정",
      medium: group.medium || "매체 미지정",
      campaign: group.campaign || "캠페인 미지정",
      count: group.count,
      percent: utmTotal > 0 ? (group.count / utmTotal) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  function aggregateUtm(keyFn: (row: { source: string; medium: string; count: number }) => string) {
    const map = new Map<string, number>();
    for (const row of utmRows) {
      const k = keyFn(row);
      if (!k) continue;
      map.set(k, (map.get(k) ?? 0) + row.count);
    }
    return topEntriesBySectionMax(map, Infinity);
  }
  const utmBySource = aggregateUtm((row) => row.source);
  const utmByMedium = aggregateUtm((row) => row.medium);
  const utmBySourceMedium = aggregateUtm((row) => [row.source, row.medium].filter(Boolean).join(" / "));
  const ambassadors = new Map<string, { name: string; count: number }>();
  for (const link of ambassadorLinks) {
    if (normalizeUtmKey(link.utmSource) !== "ambassador" || !link.utmTerm?.trim()) continue;
    const name = link.utmTerm.trim();
    if (!ambassadors.has(name.toLocaleLowerCase())) ambassadors.set(name.toLocaleLowerCase(), { name, count: 0 });
  }
  for (const row of ambassadorRows) {
    const name = row.name?.trim() || "이름 미지정";
    const key = name.toLocaleLowerCase();
    const current = ambassadors.get(key);
    ambassadors.set(key, { name: current?.name || name, count: (current?.count || 0) + row.count });
  }
  const ambassadorTotal = ambassadorRows.reduce((sum, row) => sum + row.count, 0);
  const ambassadorRanking = Array.from(ambassadors.values()).map((row) => ({
    name: row.name,
    count: row.count,
    percent: ambassadorTotal > 0 ? (row.count / ambassadorTotal) * 100 : 0,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));

  const rangeChange = previousRangeCount > 0 ? ((rangeCount - previousRangeCount) / previousRangeCount) * 100 : null;
  const previousPaceChange = previousPaceCount !== null && previousPaceCount > 0
    ? ((cumulativeCount - previousPaceCount) / previousPaceCount) * 100
    : null;
  const previousRangeChange = previousRangeMatchedCount !== null && previousRangeMatchedCount > 0
    ? ((rangeCount - previousRangeMatchedCount) / previousRangeMatchedCount) * 100
    : null;

  // GA4 퍼널 — 사전등록 폼 자체엔 방문 추적이 없어서(collect-script.ts는 제출만 잡음), 이미 설치된
  // GA4에서 방문자 수를 끌어온다. 속성 미설정이거나 조회 실패면 퍼널 전체를 숨긴다(부분 데이터로 오해 방지).
  const funnel = project.ga4PropertyId
    ? await (async () => {
        const propertyId = project.ga4PropertyId!;
        const pagePathPrefix = project.ga4RegistrationPagePath || null;
        // 작년 웹사이트는 대개 다른 GA4 속성이라(행사마다 새로 만듦) 프로젝트에 별도 저장된
        // 속성 ID가 있어야만, 그리고 등록 쪽 "전년 동일 D구간"과 같은 전제(양쪽 소스 행사
        // 일자 확인됨)를 만족할 때만 시도한다 — 못 만족하면 조용히 생략(부분 데이터로 오해 방지).
        const previousYearPropertyId = hasPaceComparison ? project.ga4PreviousYearPropertyId : null;
        const [
          homepageVisitors,
          previousHomepageVisitors,
          registrationPageVisitors,
          previousRegistrationPageVisitors,
          homepageVisitorsDailyRows,
          registrationPageVisitorsDailyRows,
          previousYearHomepageVisitors,
          previousYearRegistrationPageVisitors,
        ] = await Promise.all([
          getGa4ActiveUsers({ propertyId, from, to }),
          getGa4ActiveUsers({ propertyId, from: previousFrom, to: from }),
          pagePathPrefix ? getGa4ActiveUsers({ propertyId, pagePathPrefix, from, to }) : Promise.resolve(null),
          pagePathPrefix ? getGa4ActiveUsers({ propertyId, pagePathPrefix, from: previousFrom, to: from }) : Promise.resolve(null),
          getGa4ActiveUsersByDay({ propertyId, from, to }),
          pagePathPrefix ? getGa4ActiveUsersByDay({ propertyId, pagePathPrefix, from, to }) : Promise.resolve(null),
          previousYearPropertyId
            ? getGa4ActiveUsers({ propertyId: previousYearPropertyId, from: previousEventRangeFrom!, to: previousEventRangeTo! })
            : Promise.resolve(null),
          previousYearPropertyId && pagePathPrefix
            ? getGa4ActiveUsers({ propertyId: previousYearPropertyId, pagePathPrefix, from: previousEventRangeFrom!, to: previousEventRangeTo! })
            : Promise.resolve(null),
        ]);
        if (homepageVisitors === null) return null;
        const homepageVisitorsChange =
          previousHomepageVisitors && previousHomepageVisitors > 0
            ? ((homepageVisitors - previousHomepageVisitors) / previousHomepageVisitors) * 100
            : null;
        const registrationPageVisitorsChange =
          registrationPageVisitors !== null && previousRegistrationPageVisitors && previousRegistrationPageVisitors > 0
            ? ((registrationPageVisitors - previousRegistrationPageVisitors) / previousRegistrationPageVisitors) * 100
            : null;
        const homepageVisitorsYoyChange =
          previousYearHomepageVisitors && previousYearHomepageVisitors > 0
            ? ((homepageVisitors - previousYearHomepageVisitors) / previousYearHomepageVisitors) * 100
            : null;
        const registrationPageVisitorsYoyChange =
          registrationPageVisitors !== null && previousYearRegistrationPageVisitors && previousYearRegistrationPageVisitors > 0
            ? ((registrationPageVisitors - previousYearRegistrationPageVisitors) / previousYearRegistrationPageVisitors) * 100
            : null;
        return {
          homepageVisitors,
          homepageVisitorsChange,
          homepageVisitorsYoyChange,
          homepageVisitorsDaily: buildGa4DailyTrend(homepageVisitorsDailyRows, from, to),
          registrationPageVisitors,
          registrationPageVisitorsChange,
          registrationPageVisitorsYoyChange,
          registrationPageVisitorsDaily: pagePathPrefix ? buildGa4DailyTrend(registrationPageVisitorsDailyRows, from, to) : null,
          registrants: rangeCount,
          homepageToPageRate:
            registrationPageVisitors !== null && homepageVisitors > 0
              ? (registrationPageVisitors / homepageVisitors) * 100
              : null,
          pageToRegistrantRate:
            registrationPageVisitors !== null && registrationPageVisitors > 0
              ? (rangeCount / registrationPageVisitors) * 100
              : null,
        };
      })()
    : null;

  // Anomaly detection
  const cumulativeTrend = buildCumulativeTrendFromRows(cumulativeDailyRows, from, to, cumulativeBeforeRange);
  const dailyCounts = cumulativeTrend.map((p) => p.count);
  let anomaly: null | { date: string; count: number; avg: number; severity: "low" | "high"; deviation: number } = null;
  if (dailyCounts.length >= 7) {
    const recent = cumulativeTrend[cumulativeTrend.length - 1];
    const baseline = dailyCounts.slice(-8, -1);
    if (baseline.length >= 5) {
      const avg = baseline.reduce((s, c) => s + c, 0) / baseline.length;
      const variance = baseline.reduce((s, c) => s + (c - avg) ** 2, 0) / baseline.length;
      const sd = Math.sqrt(variance);
      const threshold = Math.max(sd * 1.5, avg * 0.25);
      const diff = recent.count - avg;
      if (Math.abs(diff) >= threshold && avg > 0) {
        anomaly = {
          date: recent.date,
          count: recent.count,
          avg: Math.round(avg * 10) / 10,
          severity: diff < 0 ? "low" : "high",
          deviation: Math.round((diff / avg) * 100),
        };
      }
    }
  }

  const daysUntilEvent = eventPair.current?.eventStart ? eventDday(eventPair.current.eventStart, now) : null;
  const yearOverYear: YearOverYear | null = eventPair.previous ? {
    compareSourceName: eventPair.previous.source.name,
    compareTotal: previousTotalCount ?? 0,
    progressPercent: previousTotalCount && previousTotalCount > 0
      ? (cumulativeCount / previousTotalCount) * 100
      : null,
    daysUntilEvent,
    pace: previousPaceCount !== null
      ? {
          lastYearCountAtSameOffset: previousPaceCount,
          paceRatio: previousPaceCount > 0 ? (cumulativeCount / previousPaceCount) * 100 : null,
        }
      : null,
  } : null;

  const payload: RealtimeReportData = {
    generatedAt: now.toISOString(),
    project: { id: project.id, name: eventPair.current?.source.name ?? project.name },
    yearOverYear,
    performance: {
      yesterdayCount,
      todayCount,
      cumulativeCount,
      rangeCount,
      previousRangeCount,
      rangeChange,
      currentSource: eventPair.current ? {
        id: eventPair.current.source.id,
        name: eventPair.current.source.name,
        eventYear: eventPair.current.eventYear,
      } : null,
      previousYear: eventPair.previous ? {
        sourceId: eventPair.previous.source.id,
        sourceName: eventPair.previous.source.name,
        eventYear: eventPair.previous.eventYear,
        totalCount: previousTotalCount ?? 0,
        paceCount: previousPaceCount,
        paceChange: previousPaceChange,
        rangeCount: previousRangeMatchedCount,
        rangeChange: previousRangeChange,
        dDay: eventPair.current?.eventStart ? eventDday(eventPair.current.eventStart, now) : null,
      } : null,
    },
    /**
     * 이 리포트가 **어느 기간을 센 것인지**.
     *
     * 요약 대시보드는 주간 보고에 캡처해서 붙이는 화면이다. 기간이 안 적혀 있으면 그 캡처는
     * 일주일 뒤에 "이게 언제 것이지", "+102% 는 무엇 대비지" 를 답할 수 없다 —
     * 숫자만 있고 근거가 없는 이미지가 된다. 계산에 쓴 범위를 그대로 실어 보낸다.
     */
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousTo: from.toISOString(),
    },
    funnel,
    composition,
    fieldStats,
    emailDomainTop,
    emailDomainTotal,
    dedup,
    anomaly,
    cumulativeTrend,
    dailyUtmTrend: buildDailyUtmTrendFromRows(utmTrendRows, from, to),
    utmTop,
    utmBySource,
    utmByMedium,
    utmBySourceMedium,
    ambassadorRanking,
    ambassadorTotal,
    heatmap: buildHeatmapFromRows(heatmapRows),
  };
  REPORT_CACHE.set(cacheKey, { at: Date.now(), data: payload });
  return { data: payload };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const body: RequestBody = await request.json();
  const { workspaceId, projectId, filters, from, to } = body;
  if (!workspaceId || !projectId) {
    return NextResponse.json({ error: "workspaceId, projectId 필요" }, { status: 400 });
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const result = await generateDashboardReport({ workspaceId, projectId, filters, from, to });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(result.data);
}
