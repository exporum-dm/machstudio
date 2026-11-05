"use client";
import { useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Btn, Field, FieldSelect } from "@/components/ui/primitives";
import { contentRepeatDates, MAX_CONTENT_REPEATS, type ContentRepeat } from "@/lib/content-calendar";

export default function RepeatControls({ date, disabled, busy, onCreate }: { date: string | null; disabled: boolean; busy: boolean; onCreate(repeat: ContentRepeat): void }) {
  const [unit, setUnit] = useState<"none" | ContentRepeat["unit"]>("none");
  const [interval, setInterval] = useState("1");
  const [end, setEnd] = useState<ContentRepeat["end"]>("count");
  const [count, setCount] = useState("4");
  const [until, setUntil] = useState("");
  const repeat: ContentRepeat = { unit: unit === "none" ? "week" : unit, interval: Number(interval), end, ...(end === "count" ? { count: Number(count) } : { until }) };
  let dates: string[] = [], error = "";
  if (unit !== "none") { try { dates = contentRepeatDates(date, repeat); } catch (e) { error = (e as Error).message; } }
  return <section className="space-y-3 rounded-xl bg-secondary/35 p-3 shadow-sm">
    <label className="block text-xs font-medium">반복 일정<FieldSelect aria-label="반복 주기" value={unit} onChange={e => setUnit(e.target.value as typeof unit)} disabled={busy} className="mt-1.5"><option value="none">반복 없음</option><option value="day">일 단위</option><option value="week">주 단위</option><option value="month">월 단위</option></FieldSelect></label>
    {unit !== "none" && <>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs font-medium">반복 간격<Field aria-label="반복 간격" type="number" min={1} max={365} step={1} value={interval} disabled={busy} onChange={e => setInterval(e.target.value)} className="mt-1.5" /></label><label className="text-xs font-medium">생성 범위<FieldSelect aria-label="반복 종료 방식" value={end} disabled={busy} onChange={e => setEnd(e.target.value as typeof end)} className="mt-1.5"><option value="count">추가 횟수</option><option value="date">종료 날짜</option></FieldSelect></label></div>
      {end === "count" ? <label className="block text-xs font-medium">추가할 콘텐츠 수<Field aria-label="추가할 콘텐츠 수" type="number" min={1} max={MAX_CONTENT_REPEATS} step={1} value={count} disabled={busy} onChange={e => setCount(e.target.value)} className="mt-1.5" /></label> : <label className="block text-xs font-medium">종료일 (해당 날짜 포함)<Field aria-label="반복 종료일" type="date" min={date || undefined} value={until} disabled={busy} onChange={e => setUntil(e.target.value)} className="mt-1.5" /></label>}
      {error ? <p role="status" className="text-xs text-amber-600">{error}</p> : <div aria-live="polite" className="space-y-1.5"><p className="text-xs font-medium">원본 다음부터 {dates.length}개 추가 · 마지막 {dates.at(-1)}</p><div className="flex flex-wrap gap-1">{dates.slice(0, 5).map(d => <span key={d} className="rounded-md bg-background px-2 py-1 text-[11px] tabular-nums shadow-sm">{d}</span>)}{dates.length > 5 && <span className="px-1 py-1 text-[11px] text-muted-foreground">외 {dates.length - 5}개</span>}</div></div>}
      <p className="text-[11px] leading-5 text-muted-foreground">날짜를 미리 생성하며, 각 콘텐츠는 따로 수정·삭제할 수 있습니다. 새 항목은 ‘대기’ 상태와 빈 게시물 링크로 시작합니다.</p>
      <Btn disabled={disabled || busy || !!error} onClick={() => onCreate(repeat)} className="w-full text-xs">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <CalendarPlus className="h-3.5 w-3.5" />}{dates.length || "반복"}개 일정 추가</Btn>
    </>}
  </section>;
}
