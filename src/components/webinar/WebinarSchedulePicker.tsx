"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CalendarDays } from "lucide-react";
import RangeCalendar from "./RangeCalendar";
import { btnCls, FIELD_CLS, FINISH, R, SELECTED } from "@/components/ui/primitives";

/**
 * 웨비나 일정 픽커 — 달력 하나에서 라이브 시작일~종료일을 범위로 선택하고,
 * 시간은 time 입력, 사전등록 마감은 프리셋(시작 시점/하루 전/직접)으로 지정한다.
 * 값은 KST 벽시각 "YYYY-MM-DDTHH:mm" 문자열로 주고받아 부모의 kstDateTimeLocalToIso 흐름과 호환.
 */
export interface ScheduleValue {
  liveStartAt: string;   // "YYYY-MM-DDTHH:mm"
  liveEndAt: string;
  signupDeadline: string;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

function splitLocal(s: string): [string, string] {
  if (!s || s.length < 16) return ["", ""];
  return [s.slice(0, 10), s.slice(11, 16)];
}
function joinLocal(date: string, time: string): string {
  return date && time ? `${date}T${time}` : "";
}
// "YYYY-MM-DD" 순수 날짜 연산 (UTC 기준 — DST/로컬 타임존 드리프트 방지)
function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}
function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** "14:05" → "오후 2:05". 요약 한 줄에 쓰려고 — 24시간 표기는 훑을 때 한 번 더 계산해야 한다. */
function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m ?? 0).padStart(2, "0")}`;
}

function fmtDay(ymd: string): string {
  if (!ymd) return "";
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}월 ${d}일(${WEEKDAYS[weekdayOf(ymd)]})`;
}

type DeadlineMode = "atStart" | "dayBefore" | "custom";

/**
 * 사전등록 마감 — **라이브 시작 시각에 상대적인 값**이라(시작 시점 / 하루 전 / 직접) 시작 시각을
 * 함께 받아야 한다. IA 3단계에서 이 컨트롤이 '등록 폼 › 접수 창' 으로 옮겨가면서, 만들기 폼과
 * 등록 폼이 같은 UI 를 쓰도록 따로 떼어냈다.
 */
export function SignupDeadlineField({
  liveStartAt, value, onChange, label = "사전등록 마감",
}: {
  /** "YYYY-MM-DDTHH:mm" — atStart/dayBefore 계산의 기준 */
  liveStartAt: string;
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const [startDate, startTime] = splitLocal(liveStartAt);

  const [mode, setMode] = useState<DeadlineMode>(() => {
    if (!value) return "atStart";
    if (value === liveStartAt) return "atStart";
    if (startDate && value === joinLocal(addDaysYmd(startDate, -1), startTime)) return "dayBefore";
    return "custom";
  });
  const [custom, setCustom] = useState(() => splitLocal(value));

  const firstEmit = useRef(true);
  useEffect(() => {
    let next: string;
    if (mode === "atStart") next = liveStartAt;
    else if (mode === "dayBefore") next = startDate ? joinLocal(addDaysYmd(startDate, -1), startTime) : value;
    else next = joinLocal(custom[0], custom[1]);
    if (firstEmit.current) {
      firstEmit.current = false;
      if (next === value) return;
    }
    if (next && next !== value) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, custom, liveStartAt]);

  return (
    <div>
      <label className="mb-1.5 block text-xs text-muted-foreground">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {([
          { m: "atStart", label: "라이브 시작 시점" },
          { m: "dayBefore", label: "하루 전 같은 시각" },
          { m: "custom", label: "직접 지정" },
        ] as { m: DeadlineMode; label: string }[]).map(({ m, label: l }) => (
          <motion.button
            key={m}
            type="button"
            whileTap={{ scale: 0.96 }}
            transition={spring}
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            /* 선택 표현이 여기만 또 달랐다(bg-violet-500/10 + text-violet-500) → SELECTED 한 벌로. */
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${R.control} ${
              mode === m ? SELECTED : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {l}
          </motion.button>
        ))}
      </div>
      {mode === "custom" && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <input type="date" value={custom[0]} aria-label="마감 날짜"
            onChange={(e) => setCustom([e.target.value, custom[1] || "23:59"])}
            className={FIELD_CLS} />
          <input type="time" step={300} value={custom[1]} aria-label="마감 시각"
            onChange={(e) => setCustom([custom[0], e.target.value])}
            className={FIELD_CLS} />
        </div>
      )}
    </div>
  );
}

/**
 * 입장 오픈 — 화면이 쓰는 모양. 저장 모양(`EntryOpenSetting`)과 달리 **KST 벽시각 문자열**을
 * 쓴다(이 파일의 다른 컨트롤과 같은 규약). ISO 변환은 부모가 한다.
 */
export type EntryOpenValue = { mode: "before"; minutes: number } | { mode: "at"; local: string };

/** 프리셋 — "시작과 동시에" 가 맨 앞이다. 대개 그걸 고르고, 미리 여는 건 선택이다. */
const ENTRY_OPEN_PRESETS = [0, 30, 60, 120];

/**
 * **입장 오픈 시점.** 전까지는 "시작 60분 전" 이 코드에 박혀 있어 아무도 못 바꿨다.
 *
 * 프리셋은 `before`(시작 기준)로 저장한다 — 방송을 하루 미뤄도 입장이 같이 따라와야 한다.
 * `직접 지정` 만 `at`(절대 시각) 으로 굳힌다. 그게 "예약" 의 뜻이다.
 */
export function EntryOpenField({
  liveStartAt, value, onChange,
}: {
  /** "YYYY-MM-DDTHH:mm" — 프리셋 미리보기의 기준 */
  liveStartAt: string;
  value: EntryOpenValue;
  onChange: (next: EntryOpenValue) => void;
}) {
  const [startDate, startTime] = splitLocal(liveStartAt);
  const [custom, setCustom] = useState<[string, string]>(() =>
    value.mode === "at" && value.local ? splitLocal(value.local) : [startDate, startTime],
  );

  /** 프리셋이 가리키는 실제 시각 — 고르기 전에 보이면 "몇 분 전" 을 암산할 일이 없다. */
  const previewOf = (minutes: number) => {
    if (!startDate || !startTime) return "";
    const [h, m] = startTime.split(":").map(Number);
    const base = new Date(Date.UTC(
      Number(startDate.slice(0, 4)), Number(startDate.slice(5, 7)) - 1, Number(startDate.slice(8, 10)), h, m,
    ));
    base.setUTCMinutes(base.getUTCMinutes() - minutes);
    const ymd = base.toISOString().slice(0, 10);
    const hhmm = base.toISOString().slice(11, 16);
    return `${fmtDay(ymd)} ${fmtTime(hhmm)}`;
  };

  const activeMinutes = value.mode === "before" ? value.minutes : null;
  const preview =
    value.mode === "at"
      ? (value.local ? `${fmtDay(value.local.slice(0, 10))} ${fmtTime(value.local.slice(11, 16))}` : "")
      : previewOf(value.minutes);

  return (
    <div>
      <label className="mb-1.5 block text-xs text-muted-foreground">입장 오픈</label>
      <div className="flex flex-wrap gap-1.5">
        {ENTRY_OPEN_PRESETS.map((minutes) => (
          <motion.button
            key={minutes}
            type="button"
            whileTap={{ scale: 0.96 }}
            transition={spring}
            aria-pressed={activeMinutes === minutes}
            onClick={() => onChange({ mode: "before", minutes })}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${R.control} ${
              activeMinutes === minutes ? SELECTED : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {minutes === 0 ? "시작과 동시에" : minutes < 60 ? `${minutes}분 전` : `${minutes / 60}시간 전`}
          </motion.button>
        ))}
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          transition={spring}
          aria-pressed={value.mode === "at"}
          onClick={() => onChange({ mode: "at", local: joinLocal(custom[0] || startDate, custom[1] || startTime) })}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${R.control} ${
            value.mode === "at" ? SELECTED : "text-muted-foreground hover:bg-secondary"
          }`}
        >
          직접 지정
        </motion.button>
      </div>

      {value.mode === "at" && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <input type="date" value={custom[0]} aria-label="입장 오픈 날짜"
            onChange={(e) => { const next: [string, string] = [e.target.value, custom[1] || startTime]; setCustom(next); onChange({ mode: "at", local: joinLocal(next[0], next[1]) }); }}
            className={FIELD_CLS} />
          <input type="time" step={300} value={custom[1]} aria-label="입장 오픈 시각"
            onChange={(e) => { const next: [string, string] = [custom[0] || startDate, e.target.value]; setCustom(next); onChange({ mode: "at", local: joinLocal(next[0], next[1]) }); }}
            className={FIELD_CLS} />
        </div>
      )}

      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {preview ? <>이 시각부터 <b className="font-medium text-foreground">{preview}</b> 버튼이 &lsquo;입장하기&rsquo;로 바뀌어요.</> : "라이브 시작 시각을 먼저 정해주세요."}
        {value.mode === "before"
          ? " 방송 시각을 옮기면 함께 따라와요."
          : " 방송 시각을 옮겨도 이 시각 그대로예요."}
        {" 방송이 시작되면 설정과 무관하게 입장이 열립니다."}
      </p>
    </div>
  );
}

export default function WebinarSchedulePicker({
  value,
  onChange,
  /** 마감을 이 픽커에서 함께 고를지. 만들기 폼은 true(한 자리에서 전부),
   *  기본 정보 탭은 false — 마감은 '등록 폼 › 접수 창' 소관이다(IA 3단계). */
  showDeadline = true,
}: {
  value: ScheduleValue;
  onChange: (v: ScheduleValue) => void;
  showDeadline?: boolean;
}) {
  const [initStartDate, initStartTime] = splitLocal(value.liveStartAt);
  const [initEndDate, initEndTime] = splitLocal(value.liveEndAt);

  const [startDate, setStartDate] = useState(initStartDate);
  const [endDate, setEndDate] = useState(initEndDate || initStartDate);
  const [startTime, setStartTime] = useState(initStartTime || "14:00");
  const [endTime, setEndTime] = useState(initEndTime || "16:00");

  // 상태 → 부모 값 전파
  const firstEmit = useRef(true);
  useEffect(() => {
    if (!startDate || !startTime || !endTime) return;
    const liveStartAt = joinLocal(startDate, startTime);
    const endD = endDate || startDate;
    const liveEndAt = joinLocal(endD, endTime);
    // 마감은 SignupDeadlineField 소유 — 여기서는 기존 값을 그대로 넘긴다.
    const signupDeadline = value.signupDeadline;
    // 첫 렌더의 동일값 재전파는 건너뛴다
    if (firstEmit.current) {
      firstEmit.current = false;
      if (liveStartAt === value.liveStartAt && liveEndAt === value.liveEndAt && signupDeadline === value.signupDeadline) return;
    }
    onChange({ liveStartAt, liveEndAt, signupDeadline });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, startTime, endTime]);

  const rangeSummary = startDate
    ? (startDate === (endDate || startDate)
        ? fmtDay(startDate)
        : `${fmtDay(startDate)} ~ ${fmtDay(endDate)}`)
    : "날짜를 선택하세요";

  /**
   * 정해진 일정은 접는다.
   *
   * IA 문서가 지시한 건 아니고 AGENTS 판별질문 2 에 근거한 판단이다 —
   * "노출 정도 = 사용 빈도 × 값 확인 필요성. 저빈도 긴 세부는 가까운 확장으로."
   * 일정은 만들 때 한 번 정하고 거의 안 고치는데, 월 달력이 원본 정보 첫 화면의
   * 약 500px 을 차지해 정체성·진행 순서·브랜드를 전부 스크롤 밖으로 밀어냈다(실물 확인).
   * 값 확인 필요성은 남으므로 **숨기지 않고 한 줄 요약으로** 보여 준다.
   *
   * 날짜가 없으면(새 웨비나) 펼친 상태로 시작한다 — 요약할 값이 없다.
   */
  const [editing, setEditing] = useState(!initStartDate);
  const timeSummary = `${fmtTime(startTime)} ~ ${fmtTime(endTime)}`;

  if (!editing) {
    return (
      <div className="space-y-3">
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 bg-secondary px-3 py-2.5 ${R.surface} ${FINISH.s2}`}>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{rangeSummary}</span>
          <span className="text-sm tabular-nums text-muted-foreground">{timeSummary}</span>
          <button type="button" onClick={() => setEditing(true)} className={`ml-auto ${btnCls("quiet", "text-xs")}`}>
            일정 고치기
          </button>
        </div>
        {showDeadline && (
          <SignupDeadlineField
            liveStartAt={joinLocal(startDate, startTime)}
            value={value.signupDeadline}
            onChange={(next) =>
              onChange({
                liveStartAt: joinLocal(startDate, startTime),
                liveEndAt: joinLocal(endDate || startDate, endTime),
                signupDeadline: next,
              })
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className={`bg-secondary p-4 space-y-4 ${R.panel} ${FINISH.s2}`}>
      {/* 달력 — 범위 선택 (시작일 클릭 → 종료일 클릭) */}
      <div>
        <RangeCalendar start={startDate} end={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="w-3.5 h-3.5" />
            {rangeSummary}
          </p>
          {/* 날짜가 정해졌으면 접을 수 있다 — 새 웨비나에서는 아직 접을 게 없다 */}
          {startDate && (
            <button type="button" onClick={() => setEditing(false)} className={`ml-auto ${btnCls("ghost", "text-xs")}`}>
              접기
            </button>
          )}
        </div>
      </div>

      {/* 시간 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sched-start-time" className="text-xs text-muted-foreground mb-1 block">라이브 시작 시각</label>
          <input id="sched-start-time" type="time" step={300} value={startTime}
            onChange={(e) => setStartTime(e.target.value)} className={FIELD_CLS} />
        </div>
        <div>
          <label htmlFor="sched-end-time" className="text-xs text-muted-foreground mb-1 block">라이브 종료 시각</label>
          <input id="sched-end-time" type="time" step={300} value={endTime}
            onChange={(e) => setEndTime(e.target.value)} className={FIELD_CLS} />
        </div>
      </div>

      {showDeadline && (
        <SignupDeadlineField
          liveStartAt={joinLocal(startDate, startTime)}
          value={value.signupDeadline}
          onChange={(next) =>
            onChange({
              liveStartAt: joinLocal(startDate, startTime),
              liveEndAt: joinLocal(endDate || startDate, endTime),
              signupDeadline: next,
            })
          }
        />
      )}
    </div>
  );
}
