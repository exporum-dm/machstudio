import { readAttendanceHistory } from "@/lib/collect-attendance-history";
import { checkinTimezoneLabel, csvDateTimeIn } from "@/lib/collect-checkin";

export type RecordAttendance = {
  measured: boolean; visited: boolean; dates: string[];
  firstAt: string | null; lastAt: string | null; scanCount: number;
  sessions: Array<{ date: string; enteredAt: string | null; exitedAt: string | null }>;
};
type ScanSummary = { firstAt: Date | string | null; lastAt: Date | string | null; count: number; days?: string[] };
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const validDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** 원본 방문일과 실제 시각을 합쳐 보여준다. 날짜만 있는 기록으로 스캔·자정 시각을 만들지 않는다. */
export function recordAttendance(data: unknown, eventDates: readonly string[], scan?: ScanSummary): RecordAttendance | null {
  const row = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const raw = row.__attendance_import as { visitDates?: unknown[]; sessions?: Array<{ date?: unknown }> } | undefined;
  const knownDates = eventDates.length ? eventDates : [...new Set([
    ...(Array.isArray(row.actual_visit_dates) ? row.actual_visit_dates : []),
    ...(Array.isArray(raw?.visitDates) ? raw.visitDates : []),
    ...(Array.isArray(raw?.sessions) ? raw.sessions.map(s => s?.date) : []), ...(scan?.days ?? []),
  ].filter(validDay))];
  const history = readAttendanceHistory(row, knownDates);
  if (!history && !scan) return null;
  const sessions = (history?.sessions ?? []).filter(s => s.enteredAt || s.exitedAt).map(s => ({ date: s.date, enteredAt: iso(s.enteredAt), exitedAt: iso(s.exitedAt) }));
  const dates = [...new Set([...(history?.dates ?? []), ...(scan?.days ?? []).filter(validDay)])].sort();
  const entries = sessions.flatMap(s => s.enteredAt ? [s.enteredAt] : []);
  if (scan?.firstAt) entries.push(iso(scan.firstAt)!);
  if (scan?.lastAt) entries.push(iso(scan.lastAt)!);
  entries.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const visited = dates.length > 0 || entries.length > 0 || (scan?.count ?? 0) > 0 || row.actual_visit_status === "방문 확인";
  return { measured: visited || history?.measured === true, visited, dates, firstAt: entries[0] ?? null, lastAt: entries.at(-1) ?? null, scanCount: scan?.count ?? 0, sessions };
}

export function attendanceStatus(a: RecordAttendance | null | undefined) {
  return !a ? "" : a.visited ? "방문 확인" : a.measured ? "미방문" : "미집계";
}

export function attendanceCsvHeaders(timezone: string) {
  const label = checkinTimezoneLabel(timezone);
  return ["실제 방문 여부", "방문일 (현지)", "방문 일수", `최초 확인 입장시각 (${label})`, `마지막 확인 입장시각 (${label})`, "입장 스캔 횟수", "시각 정보"];
}
export function attendanceCsvValues(a: RecordAttendance | null | undefined, timezone: string) {
  return [attendanceStatus(a), a?.dates.join(", ") ?? "", a?.dates.length || "", a?.firstAt ? csvDateTimeIn(timezone, a.firstAt) : "", a?.lastAt ? csvDateTimeIn(timezone, a.lastAt) : "", a?.scanCount || "", a?.visited && !a.firstAt ? "시각 미수집" : a && !a.measured ? "방문 기록 미수집" : ""];
}
