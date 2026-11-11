"use client";

import { useEffect, useState } from "react";
import { R } from "@/components/ui/primitives";
import {
  DEFAULT_RANGE_DAYS,
  kstToday,
  parseRange,
  rangeDays,
  recentRange,
  type ResearchRange,
} from "@/lib/pr-room/range";

const storageKey = (projectId: string) => `pr-room:range:${projectId}`;

/**
 * 조사 기간 — 프로젝트마다 이 브라우저에 기억한다(다음에 열어도 같은 기간).
 * 저장이 막힌 브라우저(사생활 보호 창 등)에서는 기본값(최근 30일)으로 동작한다.
 */
export function useResearchRange(projectId: string) {
  const [range, setRangeState] = useState<ResearchRange>(() => recentRange(DEFAULT_RANGE_DAYS));
  useEffect(() => {
    try {
      const saved = parseRange(JSON.parse(window.localStorage.getItem(storageKey(projectId)) ?? "null"));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장소는 마운트 뒤에만 읽을 수 있다(서버 렌더와 맞추기)
      if (saved) setRangeState(saved);
    } catch { /* 저장소 차단 — 기본값 유지 */ }
  }, [projectId]);
  const setRange = (next: ResearchRange) => {
    const valid = parseRange(next) ?? next;
    setRangeState(valid);
    try { window.localStorage.setItem(storageKey(projectId), JSON.stringify(valid)); } catch { /* 무시 */ }
  };
  return [range, setRange] as const;
}

const PRESETS = [7, 30, 90] as const;

/** 시작일·종료일 + 최근 N일 바로 고르기. 무료 검색·AI 조사가 같은 기간을 쓴다. */
export function ResearchRangePicker({ range, onChange }: { range: ResearchRange; onChange: (r: ResearchRange) => void }) {
  const today = kstToday();
  const input = `h-9 rounded-lg bg-background px-2 text-sm tabular-nums shadow-sm ${R.control}`;
  return (
    <div role="group" aria-labelledby="pr-room-range-label" className="flex flex-wrap items-center gap-2">
      <span id="pr-room-range-label" className="text-xs font-medium text-muted-foreground">조사 기간</span>
      <input
        type="date"
        aria-label="조사 시작일"
        className={input}
        value={range.from}
        max={range.to}
        onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })}
      />
      <span className="text-xs text-muted-foreground">~</span>
      <input
        type="date"
        aria-label="조사 종료일"
        className={input}
        value={range.to}
        min={range.from}
        max={today}
        onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })}
      />
      <span className="flex gap-1">
        {PRESETS.map((days) => {
          const preset = recentRange(days);
          const active = preset.from === range.from && preset.to === range.to;
          return (
            <button
              key={days}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(preset)}
              className={`h-9 rounded-lg px-2.5 text-xs transition-colors ${active ? "bg-violet-500/10 font-medium text-violet-700" : "text-muted-foreground hover:bg-secondary"}`}
            >
              최근 {days}일
            </button>
          );
        })}
      </span>
      <span className="text-xs text-muted-foreground">{rangeDays(range)}일</span>
    </div>
  );
}
