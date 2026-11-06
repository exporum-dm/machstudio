export interface HistoricalVisitSession {
  date: string;
  enteredAt: Date | null;
  exitedAt: Date | null;
  durationSeconds: number | null;
}

/** 원본 방문 명단의 날짜 증빙과 실제 태그 시각을 구분한다. 날짜만으로 시각을 만들지 않는다. */
export function readAttendanceHistory(data: Record<string, unknown>, eventDates: readonly string[]) {
  const raw = data.__attendance_import;
  const imported = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const legacy = Array.isArray(data.actual_visit_dates) && typeof data.actual_visit_status === "string";
  if ((!imported || imported.version !== 1 || imported.kind !== "visitor-history") && !legacy) return null;
  const value: Record<string, unknown> = imported?.version === 1 && imported.kind === "visitor-history" ? imported : {
    measured: !/미집계|미수집|미상/.test(String(data.actual_visit_status)),
    visitDates: data.actual_visit_dates, sessions: [],
    channel: data.registration_channel === "현장등록" ? "onsite" : data.registration_channel === "사전등록" ? "online" : null,
  };
  const validDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && eventDates.includes(v);
  const dateSet = new Set([...(Array.isArray(value.visitDates) ? value.visitDates : []), ...(legacy ? data.actual_visit_dates as unknown[] : [])].filter(validDate));
  const timestamp = (v: unknown) => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
    const time = new Date(v);
    return Number.isFinite(time.getTime()) ? time : null;
  };
  const sessions: HistoricalVisitSession[] = [];
  for (const item of Array.isArray(value.sessions) ? value.sessions : []) {
    if (!item || typeof item !== "object" || !validDate(item.date)) continue;
    const enteredAt = timestamp(item.enteredAt), exitedAt = timestamp(item.exitedAt);
    const seconds = enteredAt && exitedAt ? (exitedAt.getTime() - enteredAt.getTime()) / 1000 : null;
    if (enteredAt || exitedAt) dateSet.add(item.date);
    sessions.push({ date: item.date, enteredAt, exitedAt, durationSeconds: seconds !== null && seconds >= 0 && seconds <= 86_400 ? seconds : null });
  }
  return {
    measured: value.measured !== false,
    channel: value.channel === "online" || value.channel === "onsite" ? value.channel : null,
    dates: [...dateSet].sort(),
    sessions,
  };
}
