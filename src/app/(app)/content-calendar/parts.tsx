"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Clock } from "lucide-react";
import { FINISH, R, SELECTED } from "@/components/ui/primitives";
import { isClosedStatus, isRange, statusMeta, type ContentItemDto, type WeekSpan } from "@/lib/content-calendar";

/** 세 보기가 같이 받는 것 */
export interface ViewProps {
  items: ContentItemDto[];
  projectName: (id: string | null) => string;
  projectColor: (id: string | null) => string;
  /** 전체 보기일 때만 카드에 프로젝트를 보인다 */
  showProject: boolean;
  onOpen: (id: string) => void;
  onCreate: (defaults: Partial<ContentItemDto>) => void;
  onPatch: (id: string, fields: Partial<ContentItemDto>) => void;
}

/** 드래그로 옮기는 항목 id — 캘린더 칸·보드 열이 같이 읽는다 */
export const DRAG_TYPE = "application/x-content-item";

export function StatusDot({ status, className = "" }: { status: string; className?: string }) {
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusMeta(status).dot} ${className}`} />;
}

export function StatusChip({ status }: { status: string }) {
  const s = statusMeta(status);
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.chip}`}><StatusDot status={status} />{s.label}</span>;
}

/** 캘린더 칸 안의 한 줄 — 프로젝트 색 막대 + 시간 + 제목. 끌어서 다른 날로 옮긴다. */
export function CalendarChip({ item, color, onOpen, showProject, projectName }: {
  item: ContentItemDto; color: string; onOpen: () => void; showProject: boolean; projectName: string;
}) {
  const done = isClosedStatus(item.status);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, item.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      title={`${showProject ? `[${projectName}] ` : ""}${item.title} · ${statusMeta(item.status).label}`}
      className={`group/chip flex w-full min-w-0 items-center gap-1.5 bg-card px-1.5 py-1 text-left text-xs transition-colors hover:bg-secondary ${R.control} ${FINISH.s2} cursor-grab active:cursor-grabbing`}
    >
      <span aria-hidden className={`h-3.5 w-1 shrink-0 rounded-full ${color}`} />
      {item.time && <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{item.time}</span>}
      <span className={`min-w-0 flex-1 truncate ${done ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}>{item.title}</span>
      <StatusDot status={item.status} />
    </button>
  );
}

/** 캘린더 막대 한 줄의 높이(px) — CalendarView 가 칸 안에 같은 높이만큼 자리를 비운다. */
export const RANGE_BAR_ROW = 26;

/**
 * 기간 콘텐츠 막대 — 시작일부터 종료일까지 칸을 가로질러 이어진다(노션처럼).
 * 주가 바뀌면 다음 줄에서 이어지고, 이어지는 쪽 모서리는 둥글리지 않는다.
 * 끌어서 다른 날로 옮기면 길이를 그대로 두고 통째로 옮겨진다.
 */
export function RangeBar({ span, color, onOpen, showProject, projectName, top, passThrough = false }: {
  span: WeekSpan; color: string; onOpen: () => void; showProject: boolean; projectName: string; top: number;
  /** 끌기 중 — 막대가 마우스를 받지 않아 아래 날짜 칸에 놓을 수 있다 */
  passThrough?: boolean;
}) {
  const { item } = span;
  const done = isClosedStatus(item.status);
  const cols = span.end - span.start + 1;
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, item.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      title={`${showProject ? `[${projectName}] ` : ""}${item.title} · ${shortDay(item.date!)} ~ ${shortDay(item.endDate!)} · ${statusMeta(item.status).label}`}
      style={{
        top,
        left: `calc(${(span.start / 7) * 100}% + ${span.fromPrev ? 0 : 4}px)`,
        width: `calc(${(cols / 7) * 100}% - ${(span.fromPrev ? 0 : 4) + (span.toNext ? 0 : 4)}px)`,
      }}
      className={`${passThrough ? "pointer-events-none" : "pointer-events-auto"} absolute flex h-[22px] min-w-0 items-center gap-1.5 bg-card px-1.5 text-left text-xs transition-colors hover:bg-secondary ${FINISH.s2} cursor-grab active:cursor-grabbing ${
        span.fromPrev ? "rounded-l-none" : "rounded-l-md"} ${span.toNext ? "rounded-r-none" : "rounded-r-md"}`}
    >
      {!span.fromPrev && <span aria-hidden className={`h-3.5 w-1 shrink-0 rounded-full ${color}`} />}
      <span className={`min-w-0 flex-1 truncate ${done ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}>
        {span.fromPrev && <span className="text-muted-foreground">← </span>}{item.title}
      </span>
      {!span.toNext && <StatusDot status={item.status} />}
    </button>
  );
}

/** 보드·날짜 미정 목록의 카드 */
export function ItemCard({ item, color, projectName, showProject, onOpen, showDate = true }: {
  item: ContentItemDto; color: string; projectName: string; showProject: boolean; onOpen: () => void; showDate?: boolean;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, item.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={onOpen}
      className={`flex w-full flex-col gap-1.5 bg-card p-3 text-left transition-shadow hover:shadow-md ${R.surface} ${FINISH.s1} cursor-grab active:cursor-grabbing`}
    >
      {showProject && (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${color}`} /><span className="truncate">{projectName}</span>
        </span>
      )}
      <span className="whitespace-pre-line text-sm font-medium leading-snug">{item.title}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {(showDate || isRange(item)) && item.date && <span className="inline-flex items-center gap-1 tabular-nums"><Clock className="h-3 w-3" aria-hidden />{shortDay(item.date)}{isRange(item) && ` ~ ${shortDay(item.endDate!)}`}{item.time && ` ${item.time}`}</span>}
        {item.campaign && <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-700 dark:text-violet-300">{item.campaign}</span>}
        {item.formats.map((f) => <span key={f} className="rounded bg-secondary px-1.5 py-0.5">{f}</span>)}
        {item.channels.map((c) => <span key={c} className="rounded bg-secondary px-1.5 py-0.5">{c}</span>)}
        {item.assignees.length > 0 && <span className="ml-auto">{item.assignees.map((a) => a.name).join(", ")}</span>}
      </span>
    </button>
  );
}

export const shortDay = (day: string) => { const [, m, d] = day.split("-").map(Number); return `${m}.${d}`; };

/** 여러 개 고르는 필터 — 버튼 + 체크 목록 팝오버 */
export function FilterMenu({ label, options, value, onChange }: {
  label: string;
  options: { value: string; label: ReactNode }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const active = value.length > 0;
  const summary = active
    ? value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? "1개" : `${value.length}개`
    : null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex min-h-9 items-center gap-1.5 px-3 py-2 text-sm transition-colors ${R.control} ${active ? SELECTED : `${FINISH.s2} text-muted-foreground hover:bg-secondary hover:text-foreground`}`}
      >
        <span>{label}</span>
        {summary && <span className="max-w-28 truncate font-medium">: {summary}</span>}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <div role="menu" className={`absolute left-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto bg-popover p-1 ${R.surface} ${FINISH.overlay}`}>
          {options.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">고를 값이 없어요</p>}
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary ${R.control}`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${on ? "bg-violet-500 text-white" : FINISH.s2}`}>{on && <Check className="h-3 w-3" aria-hidden />}</span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </button>
            );
          })}
          {active && (
            <button type="button" onClick={() => onChange([])} className={`mt-1 w-full px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-secondary ${R.control}`}>선택 해제</button>
          )}
        </div>
      )}
    </div>
  );
}
