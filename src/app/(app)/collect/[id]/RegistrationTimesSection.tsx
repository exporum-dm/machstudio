"use client";

/**
 * "기본 정보" 탭의 등록 시간 — 사전등록·현장등록 운영 일정(formConfig.schedule, collect-form-config.ts).
 *
 * 일정은 이 영역이 **혼자 소유한다.** 저장은 `registrationSchedule` 한 키만 보내고, 서버가 DB 의 폼 정의에
 * 일정만 갈아 끼운다(PATCH /api/collect-sources/[id]). 폼 빌더 자동저장은 일정을 건드리지 않는다 —
 * 두 탭이 같은 값을 들고 있으면 늦게 저장한 쪽이 다른 쪽을 되돌린다.
 *
 * 편집 영역이라 값은 항상 보이고 그 자리에서 고쳐진다(AGENTS.md §2) — 자동저장.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAutosave, type AutosaveState } from "@/components/ui/use-autosave";
import { useReportAutosave } from "@/components/ui/autosave-scope";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { CHECKIN_TIMEZONES } from "@/lib/collect-checkin";
import {
  DEFAULT_LOCALE,
  localize,
  normalizeCollectForm,
  resolveRegistrationPhase,
  toLocalized,
  type RegistrationSchedule,
} from "@/lib/collect-form-config";

/** 지금 일정으로 본 상태 한 줄 — 저장 전에도 바로 바뀐다 */
function schedulePreview(schedule: RegistrationSchedule, now: Date): { tone: "ok" | "warn" | "muted"; text: string } {
  const p = resolveRegistrationPhase(schedule, now);
  const fmt = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: schedule.timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  if (p.status === "open") return { tone: "ok", text: p.phase === "onsite" ? "지금: 현장등록 받는 중" : "지금: 사전등록 받는 중" };
  if (p.status === "before") return { tone: "muted", text: `지금: 사전등록 시작 전 (${p.nextOpenAt ? fmt(p.nextOpenAt) : ""} 시작)` };
  if (p.nextOpenAt) return { tone: "warn", text: `지금: 닫힘 — 다음 현장등록 ${fmt(p.nextOpenAt)} (현지)` };
  return { tone: "muted", text: "지금: 모든 등록 종료" };
}

/** 시작~종료일(YYYY-MM-DD) 사이 날짜 — 개최일이 폼에 없을 때 기본 정보의 일자로 채운다. 2주까지만 */
function dateRange(start?: string, end?: string): string[] {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const last = end && /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : start;
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); out.length < 14; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d > last) break;
    out.push(d);
  }
  return out;
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  );
}

export default function RegistrationTimesSection({
  sourceId,
  formConfig,
  eventStart,
  eventEnd,
  onSaved,
  onStateChange,
}: {
  sourceId: string;
  formConfig: unknown;
  /** 기본 정보의 행사 일자 — 폼의 개최일이 비어 있을 때 "개최일로 채우기"에 쓴다 */
  eventStart?: string;
  eventEnd?: string;
  /** 저장된 폼 정의 전체(서버 응답) — 상위 상태를 갈아 끼워 등록 폼 탭이 새 값으로 열리게 */
  onSaved?: (formConfig: unknown) => void;
  onStateChange?: (state: AutosaveState, retry: () => void) => void;
}) {
  const config = useMemo(() => normalizeCollectForm(formConfig), [formConfig]);
  const [schedule, setScheduleState] = useState<RegistrationSchedule>(config.schedule);
  const setSchedule = (next: Partial<RegistrationSchedule>) => setScheduleState((s) => ({ ...s, ...next }));

  const save = useCallback(async (next: RegistrationSchedule) => {
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationSchedule: next }),
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      if (data?.source) onSaved?.(data.source.formConfig);
      return true;
    } catch { return false; }
  }, [onSaved, sourceId]);

  const { state, retry } = useAutosave(schedule, save);
  useReportAutosave(state, retry);
  // 상위(기본 정보 머리)의 저장 표시 하나에 합친다
  useEffect(() => { onStateChange?.(state, retry); }, [onStateChange, state, retry]);

  const eventDates = config.eventInfo.eventDates.length > 0 ? config.eventInfo.eventDates : dateRange(eventStart, eventEnd);
  const preview = schedulePreview(schedule, new Date());
  const badRows = schedule.onsite.filter((w) => w.open >= w.close);
  const preBad = schedule.preOpensAt && schedule.preClosesAt && schedule.preOpensAt >= schedule.preClosesAt;

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">등록 시간 (사전등록 · 현장등록)</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            켜 두면 이 시간에 맞춰 등록 폼이 자동으로 열리고 닫혀요. 현장등록도 같은 폼이고, 새 등록에 사전/현장 구분이 남아요.
            등록 폼 탭의 &lsquo;상태 수동 전환&rsquo;은 여전히 이 시간보다 우선해요.
          </p>
        </div>
        <Switch checked={schedule.enabled} onChange={(v) => setSchedule({ enabled: v })} label="등록 시간대로 폼 열고 닫기" />
      </div>

      <div className={`space-y-4 ${schedule.enabled ? "" : "opacity-60"}`}>
        <Row label="시간대" hint="아래 시각은 모두 이 시간대의 현지 시각이에요 — 서울에서 입력해도 LA 시간 그대로 적으면 돼요.">
          <select value={schedule.timezone} onChange={(e) => setSchedule({ timezone: e.target.value })} className={`${FIELD_CLS} h-9`}>
            {CHECKIN_TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Row>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Row label="사전등록 시작 (현지, 선택)" hint="비우면 지금부터 받아요.">
            <input type="datetime-local" value={schedule.preOpensAt ?? ""} onChange={(e) => setSchedule({ preOpensAt: e.target.value || null })} className={`${FIELD_CLS} h-9`} />
          </Row>
          <Row label="사전등록 마감 (현지)" hint="비우면 첫 현장등록 시작 전까지 받아요.">
            <input type="datetime-local" value={schedule.preClosesAt ?? ""} onChange={(e) => setSchedule({ preClosesAt: e.target.value || null })} className={`${FIELD_CLS} h-9`} />
          </Row>
        </div>
        {preBad && (
          <p className="-mt-2 flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            사전등록 마감이 시작보다 빠르거나 같아요 — 이대로면 사전등록이 열리지 않아요.
          </p>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">현장등록 운영 시간 (현지)</span>
            {eventDates.length > 0 && (
              <button
                type="button"
                onClick={() => setSchedule({ onsite: eventDates.map((date) => schedule.onsite.find((w) => w.date === date) ?? { date, open: "08:00", close: "17:00" }) })}
                className="text-[11px] text-violet-600 hover:underline dark:text-violet-300"
              >
                개최일로 채우기 (08:00~17:00)
              </button>
            )}
          </div>
          {schedule.onsite.length === 0 ? (
            <p className="rounded-xl bg-secondary/40 p-3 text-center text-[11px] text-muted-foreground">현장등록을 받지 않아요 — 사전등록 마감 뒤에는 닫혀요</p>
          ) : (
            <ul className="space-y-1.5">
              {schedule.onsite.map((item, i) => {
                const setRow = (next: Partial<RegistrationSchedule["onsite"][number]>) =>
                  setSchedule({ onsite: schedule.onsite.map((w, j) => (j === i ? { ...w, ...next } : w)) });
                return (
                  <li key={i} className={`${R.surface} flex flex-wrap items-center gap-1.5 bg-secondary p-2 ${FINISH.s2}`}>
                    <input type="date" value={item.date} onChange={(e) => setRow({ date: e.target.value })} aria-label="날짜" className="min-w-0 flex-1 rounded-lg bg-background px-2 py-1 text-[12px] outline-none" />
                    <input type="time" value={item.open} onChange={(e) => setRow({ open: e.target.value })} aria-label="시작" className="rounded-lg bg-background px-2 py-1 text-[12px] outline-none" />
                    <span className="text-[11px] text-muted-foreground">~</span>
                    <input type="time" value={item.close} onChange={(e) => setRow({ close: e.target.value })} aria-label="마감" className="rounded-lg bg-background px-2 py-1 text-[12px] outline-none" />
                    <button
                      type="button"
                      onClick={() => setSchedule({ onsite: schedule.onsite.filter((_, j) => j !== i) })}
                      className="rounded-lg px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-background hover:text-destructive"
                      aria-label={`${item.date || "이 날짜"} 현장등록 빼기`}
                    >
                      빼기
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              const last = schedule.onsite[schedule.onsite.length - 1];
              const nextDate = eventDates.find((d) => !schedule.onsite.some((w) => w.date === d))
                ?? (last?.date ? new Date(Date.parse(`${last.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : "");
              setSchedule({ onsite: [...schedule.onsite, { date: nextDate, open: last?.open ?? "08:00", close: last?.close ?? "17:00" }] });
            }}
            className="text-[11px] font-medium text-violet-600 hover:underline dark:text-violet-300"
          >
            + 날짜 추가
          </button>
          {badRows.length > 0 && (
            <p className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {badRows.map((w) => w.date).join(", ")} — 마감이 시작보다 빠르거나 같아요. 이 날은 열리지 않아요.
            </p>
          )}
        </div>

        <Row label="사전등록 마감 후 안내 제목" hint="비우면: Pre-registration is closed">
          <input value={localize(schedule.betweenTitle, DEFAULT_LOCALE)} onChange={(e) => setSchedule({ betweenTitle: toLocalized(e.target.value) })} placeholder="Pre-registration is closed" className={`${FIELD_CLS} h-9`} />
        </Row>
        <Row label="사전등록 마감 후 안내 본문" hint="{next} 자리에 다음 현장등록 시작 시각이 들어가요. 비우면 기본 문구를 써요.">
          <textarea
            value={localize(schedule.betweenBody, DEFAULT_LOCALE)}
            onChange={(e) => setSchedule({ betweenBody: toLocalized(e.target.value) })}
            placeholder="On-site registration opens {next}. Please register at the venue."
            rows={2}
            className={`${FIELD_CLS} resize-y`}
          />
        </Row>

        {schedule.enabled && (
          <p className={`text-[11px] font-medium ${preview.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : preview.tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
            {preview.text}
          </p>
        )}
      </div>
    </section>
  );
}
