"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type GridLayout } from "@/lib/creator/model";
import { button, input } from "./ui";

export const clampWidth = (value: number) =>
  Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(value)));

/**
 * 열 경계를 끌어 너비를 바꾼다. 놓는 순간에만 저장해, 끄는 동안 서버로 요청이 쏟아지지 않게 한다.
 * 키보드만 쓰는 사람을 위해 좌우 화살표로도 20px 씩 움직인다.
 */
export function ColumnResizer({ label, width, onResize }: {
  label: string; width?: number; onResize: (width: number) => void;
}) {
  const [dragging, setDragging] = useState(false);

  function start(event: React.PointerEvent<HTMLButtonElement>) {
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width ?? handle.closest("th")?.getBoundingClientRect().width ?? 160;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    let latest = startWidth;

    const move = (moveEvent: PointerEvent) => {
      latest = clampWidth(startWidth + moveEvent.clientX - startX);
      // 끄는 동안은 화면만 즉시 반응시키고, 저장은 놓을 때 한 번.
      const cell = handle.closest("th");
      const index = [...(handle.closest("tr")?.children ?? [])].indexOf(cell as Element);
      const col = cell?.closest("table")?.querySelectorAll("col")[index] as HTMLTableColElement | undefined;
      if (col) col.style.width = latest + "px";
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDragging(false);
      if (latest !== startWidth) onResize(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  return <button
    type="button"
    aria-label={label + " 열 너비 조절"}
    className={`absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:outline-none ${dragging ? "bg-primary/60" : ""}`}
    onPointerDown={start}
    onKeyDown={(event) => {
      const step = event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0;
      if (!step) return;
      event.preventDefault();
      onResize(clampWidth((width ?? 160) + step));
    }}
  />;
}

const DRAG_TYPE = "application/x-creator-column";

/**
 * 표 머리 한 줄 — 열을 끌어 순서를 바꾸고 경계를 끌어 너비를 바꾼다.
 * 열 정의(이름·형식)는 코드가 들고, 사용자가 정하는 건 **순서·숨김·너비**뿐이다.
 */
export function GridHead<T extends { key: string; label: string; width?: number }>({ columns, leading, trailing, onReorder, onResize }: {
  columns: T[];
  leading?: ReactNode;
  trailing?: ReactNode;
  onReorder: (key: string, toIndex: number) => void;
  onResize: (key: string, width: number) => void;
}) {
  return <thead className="bg-muted/65 text-xs font-medium text-muted-foreground"><tr>
    {leading}
    {columns.map((column, index) => <th key={column.key} scope="col" className="relative px-3 py-3"
      onDragOver={(event) => { if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault(); }}
      onDrop={(event) => {
        event.preventDefault();
        const key = event.dataTransfer.getData(DRAG_TYPE);
        if (key && key !== column.key) onReorder(key, index);
      }}>
      <span draggable className="block cursor-grab truncate active:cursor-grabbing" title={column.label + " — 끌어서 순서 이동"}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, column.key);
          event.dataTransfer.effectAllowed = "move";
        }}>{column.label}</span>
      <ColumnResizer label={column.label} width={column.width} onResize={(width) => onResize(column.key, width)} />
    </th>)}
    {trailing}
  </tr></thead>;
}

/** 행을 펼치고 접는 손잡이. 펼친 자리에 긴 내용(프로필·신청서 답변)이 들어간다. */
export function RowToggle({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return <button type="button" aria-expanded={open} aria-label={label + (open ? " 접기" : " 펼치기")}
    className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    onClick={onToggle}>
    {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
  </button>;
}

/** 어떤 열을 보여 줄지 고르는 패널. 순서는 표 머리에서 끌어 바꾸므로 여기서는 숨김만 다룬다. */
export function ColumnPicker<T extends { key: string; label: string; hidden?: boolean }>({ columns, onToggle, onReset }: {
  columns: T[]; onToggle: (key: string) => void; onReset: () => void;
}) {
  return <div className="grid gap-2 rounded-xl bg-muted/30 p-3">
    <p className="text-sm font-medium">보여 줄 열 — 순서와 너비는 표 머리를 끌어 바꿔요</p>
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {columns.map((column) => <label key={column.key} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!column.hidden} onChange={() => onToggle(column.key)} />
        <span className="inline-flex items-center gap-1">{column.label}
          {column.hidden ? <EyeOff className="size-3 text-muted-foreground" aria-hidden /> : <Eye className="size-3 text-muted-foreground" aria-hidden />}
        </span>
      </label>)}
    </div>
    <button type="button" className={button + " justify-self-start"} onClick={onReset}>기본 배치로 되돌리기</button>
  </div>;
}

/** 저장된 배치를 화면에서 바꾼 뒤 서버로 보낼 모양으로 만든다. */
export function layoutFrom<T extends { key: string; hidden?: boolean; width?: number }>(columns: T[]): GridLayout {
  return columns.map(({ key, hidden, width }) => ({
    key, ...(hidden ? { hidden: true } : {}), ...(width ? { width } : {}),
  }));
}

export const gridSelect = input + " h-9 py-1";
