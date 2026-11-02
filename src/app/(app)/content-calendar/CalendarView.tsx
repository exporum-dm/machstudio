"use client";

/**
 * 캘린더 보기 — 한 달 칸. 칸의 + 로 그날 콘텐츠를 만들고, 항목을 끌어 다른 날로 옮긴다.
 * 날짜 미정 항목은 아래 서랍에 모이고, 서랍에서 날짜 칸으로 끌어 놓으면 날짜가 잡힌다.
 * 좁은 화면(모바일)은 칸에 점만 찍고, 고른 날의 목록을 아래에 펼친다 — 7칸에 제목이 들어가지 않는다.
 */
import { useMemo, useState } from "react";
import { CalendarOff, Plus } from "lucide-react";
import { FINISH, R, SELECTED_TEXT } from "@/components/ui/primitives";
import { CONTENT_STATUSES, WEEKDAYS, dayLabel, groupByDay, monthGrid, monthKey } from "@/lib/content-calendar";
import { CalendarChip, DRAG_TYPE, ItemCard, StatusDot, type ViewProps } from "./parts";

export default function CalendarView({ items, month, today, projectName, projectColor, showProject, onOpen, onCreate, onPatch }: ViewProps & {
  month: string;
  today: string;
}) {
  const weeks = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => groupByDay(items), [items]);
  const undated = useMemo(() => items.filter((i) => !i.date), [items]);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDay = selected && monthKey(selected) === month ? selected : monthKey(today) === month ? today : `${month}-01`;
  const selectedItems = byDay.get(selectedDay) ?? [];

  const dropProps = (day: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOverDay(day ?? "none");
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverDay(null);
    },
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      setOverDay(null);
      if (!id) return;
      e.preventDefault();
      const item = items.find((i) => i.id === id);
      if (item && item.date !== day) onPatch(id, { date: day });
    },
  });

  return (
    <div className="space-y-4">
      <div className={`overflow-hidden bg-card ${R.panel} ${FINISH.s1}`}>
        <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-medium text-muted-foreground">
          {WEEKDAYS.map((w, i) => <div key={w} className={`py-2 ${i === 0 ? "text-rose-500" : i === 6 ? "text-sky-600 dark:text-sky-400" : ""}`}>{w}</div>)}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b border-border last:border-b-0">
            {week.map((day, i) => {
              const inMonth = monthKey(day) === month;
              const list = byDay.get(day) ?? [];
              const isToday = day === today;
              const isOver = overDay === day;
              const dayNum = Number(day.slice(8));
              return (
                <div
                  key={day}
                  {...dropProps(day)}
                  onClick={() => setSelected(day)}
                  className={`group relative min-h-16 min-w-0 border-r border-border p-1 last:border-r-0 sm:min-h-28 sm:p-1.5 ${inMonth ? "" : "bg-secondary/40"} ${isOver ? "bg-violet-500/10" : ""} ${selectedDay === day ? "max-sm:bg-violet-500/8" : ""}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums ${
                      isToday ? "bg-violet-500 font-semibold text-white" : !inMonth ? "text-muted-foreground/60" : i === 0 ? "text-rose-500" : i === 6 ? "text-sky-600 dark:text-sky-400" : ""
                    }`}>{dayNum === 1 ? `${Number(day.slice(5, 7))}/${dayNum}` : dayNum}</span>
                    <button
                      type="button"
                      aria-label={`${dayLabel(day)}에 콘텐츠 추가`}
                      onClick={(e) => { e.stopPropagation(); onCreate({ date: day }); }}
                      className={`hidden h-6 w-6 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 sm:inline-flex ${R.control}`}
                    ><Plus className="h-3.5 w-3.5" aria-hidden /></button>
                  </div>
                  {/* 넓은 화면: 제목 줄 */}
                  <div className="hidden space-y-1 sm:block">
                    {list.map((item) => (
                      <CalendarChip key={item.id} item={item} color={projectColor(item.projectId)} showProject={showProject} projectName={projectName(item.projectId)} onOpen={() => onOpen(item.id)} />
                    ))}
                  </div>
                  {/* 좁은 화면: 점 */}
                  {list.length > 0 && (
                    <div className="flex flex-wrap items-center gap-0.5 sm:hidden" aria-label={`${list.length}건`}>
                      {list.slice(0, 4).map((item) => <span key={item.id} aria-hidden className={`h-1.5 w-1.5 rounded-full ${projectColor(item.projectId)}`} />)}
                      {list.length > 4 && <span className="text-[10px] leading-none text-muted-foreground">+{list.length - 4}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 좁은 화면: 고른 날 */}
      <section className="space-y-2 sm:hidden" aria-label={`${dayLabel(selectedDay)} 콘텐츠`}>
        <div className="flex items-center justify-between">
          <h2 className={`text-sm font-semibold ${selectedDay === today ? SELECTED_TEXT : ""}`}>{dayLabel(selectedDay)}</h2>
          <button type="button" onClick={() => onCreate({ date: selectedDay })} className={`inline-flex min-h-9 items-center gap-1 px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground ${R.control}`}>
            <Plus className="h-4 w-4" aria-hidden />추가
          </button>
        </div>
        {selectedItems.length === 0
          ? <p className="py-3 text-center text-xs text-muted-foreground">이 날 올릴 콘텐츠가 없어요</p>
          : selectedItems.map((item) => (
            <ItemCard key={item.id} item={item} color={projectColor(item.projectId)} projectName={projectName(item.projectId)} showProject={showProject} showDate={false} onOpen={() => onOpen(item.id)} />
          ))}
      </section>

      {/* 날짜 미정 서랍 — 여기로 끌어 놓으면 날짜가 빠진다 */}
      <section
        {...dropProps(null)}
        aria-label="날짜 미정"
        className={`space-y-2 p-3 transition-colors ${R.panel} ${overDay === "none" ? "bg-violet-500/10" : "bg-secondary/50"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <CalendarOff className="h-4 w-4 text-muted-foreground" aria-hidden />날짜 미정
            <span className="rounded-full bg-secondary px-1.5 text-[11px] tabular-nums text-muted-foreground">{undated.length}</span>
          </h2>
          <button type="button" onClick={() => onCreate({ date: null })} className={`inline-flex min-h-9 items-center gap-1 px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground ${R.control}`}>
            <Plus className="h-4 w-4" aria-hidden />아이디어
          </button>
        </div>
        {undated.length === 0
          ? <p className="text-xs text-muted-foreground">날짜를 정하지 않은 아이디어를 여기 모아 두고, 정해지면 캘린더 칸으로 끌어 놓으세요.</p>
          : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {undated.map((item) => (
                <ItemCard key={item.id} item={item} color={projectColor(item.projectId)} projectName={projectName(item.projectId)} showProject={showProject} onOpen={() => onOpen(item.id)} />
              ))}
            </div>
          )}
      </section>
      <p className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
        항목을 끌어 다른 날로 옮길 수 있어요.
        {CONTENT_STATUSES.map((s) => <span key={s.id} className="inline-flex items-center gap-1"><StatusDot status={s.id} />{s.label}</span>)}
      </p>
    </div>
  );
}
