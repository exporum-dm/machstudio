"use client";
import { dateTimeIn } from "@/lib/collect-checkin";
import { attendanceStatus, type RecordAttendance } from "@/lib/collect-record-attendance";

export function AttendanceCell({ attendance: a, timezone }: { attendance?: RecordAttendance | null; timezone: string }) {
  if (!a) return <span className="text-muted-foreground">-</span>;
  if (!a.visited) return <span className="text-muted-foreground">{attendanceStatus(a)}</span>;
  return <div className="space-y-0.5"><div className="flex flex-wrap gap-x-2 gap-y-0.5 font-medium text-emerald-700 dark:text-emerald-400">{a.dates.length ? a.dates.map(date => <span key={date}>{date}</span>) : "방문 확인"}</div><div className="text-[11px] text-muted-foreground">{a.firstAt ? dateTimeIn(timezone, a.firstAt) : "시각 미수집"}{a.dates.length > 1 ? ` · ${a.dates.length}일 방문` : ""}</div></div>;
}

export function AttendanceDetails({ attendance: a, timezone }: { attendance?: RecordAttendance | null; timezone: string }) {
  if (!a) return null;
  return <section className="space-y-2 rounded-xl bg-secondary/35 p-3 shadow-sm"><h3 className="text-xs font-semibold">실제 방문 기록</h3><p className="text-sm font-medium">{attendanceStatus(a)}{a.dates.length ? ` · ${a.dates.length}일 방문` : ""}</p>
    {a.dates.map(date => {
      const sessions = a.sessions.filter(s => s.date === date);
      return <div key={date} className="space-y-0.5 text-sm"><p className="font-medium tabular-nums">{date}</p>{sessions.length ? sessions.map((s, i) => <p key={i} className="text-xs tabular-nums text-muted-foreground">{s.enteredAt ? `입장 ${dateTimeIn(timezone, s.enteredAt)}` : "입장시각 미수집"}{s.exitedAt ? ` · 퇴장 ${dateTimeIn(timezone, s.exitedAt)}` : ""}</p>) : <p className="text-xs text-muted-foreground">{a.firstAt && a.dates.length === 1 ? `확인 입장시각 ${dateTimeIn(timezone, a.firstAt)}` : a.scanCount > 0 ? "입장시각은 아래 스캔 기록 참조" : "방문일 확인 · 시각 미수집"}</p>}</div>;
    })}
    {a.visited && !a.dates.length && a.firstAt && <p className="text-xs tabular-nums">{dateTimeIn(timezone, a.firstAt)}</p>}
    {!a.measured && <p className="text-xs text-muted-foreground">제공된 원본에 방문 기록이 없습니다.</p>}
    {a.scanCount > 0 && <p className="text-[11px] text-muted-foreground">시각이 기록된 입장 스캔 {a.scanCount}회 · 행사 현지 시간 기준</p>}
  </section>;
}
