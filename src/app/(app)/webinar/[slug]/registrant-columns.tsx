"use client";

/**
 * 등록자 명단 열 — 보고 싶은 열을 고르고, 열 너비를 끌어서 맞춘다(2026-11-03).
 *
 * 왜: 화면 열이 코드에 고정돼 있었는데 CSV 에는 훨씬 많은 열(부서·동의·UTM·커스텀 항목·설문 문항)이
 * 나간다. 그 값들은 이미 명단 API 로 내려오고 있어서 화면에서 켜기만 하면 된다.
 *
 * 설정은 이 브라우저에 저장한다(localStorage) — 사람마다 보는 열이 다르고, 모든 웨비나에 같이 적용된다.
 * 열 id 는 고정 열은 이름("email"), 커스텀 항목은 "cf:키", 설문 문항은 "sq:설문id:문항id".
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Columns3, RotateCcw } from "lucide-react";

export interface ColumnDef<R> {
  id: string;
  label: string;
  group: string;
  /** 기본 너비(px) */
  width: number;
  defaultVisible: boolean;
  /** 끌 수 없는 열(이름) */
  locked?: boolean;
  header?: ReactNode;
  /** 머리칸 툴팁 */
  headerTitle?: string;
  cell: (r: R) => ReactNode;
  /** 잘린 글자를 볼 수 있게 — 없으면 툴팁 없음 */
  cellTitle?: (r: R) => string | undefined;
}

const STORAGE_KEY = "machstudio:webinar-registrant-columns:v1";
const MIN_WIDTH = 56;
const MAX_WIDTH = 640;

interface Prefs {
  /** 기본값과 다르게 켜고 끈 열 */
  visible: Record<string, boolean>;
  widths: Record<string, number>;
}

function readPrefs(): Prefs {
  if (typeof window === "undefined") return { visible: {}, widths: {} };
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    const visible: Record<string, boolean> = {};
    const widths: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw?.visible ?? {})) if (typeof v === "boolean") visible[k] = v;
    for (const [k, v] of Object.entries(raw?.widths ?? {})) if (typeof v === "number" && Number.isFinite(v)) widths[k] = clampWidth(v);
    return { visible, widths };
  } catch {
    return { visible: {}, widths: {} };
  }
}

function writePrefs(prefs: Prefs) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* 저장 못 해도 이번 화면에서는 그대로 쓴다 */ }
}

const clampWidth = (w: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));

export function useColumnPrefs<R>(columns: ColumnDef<R>[]) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const update = (fn: (p: Prefs) => Prefs) => setPrefs((p) => { const next = fn(p); writePrefs(next); return next; });

  const isVisible = (c: ColumnDef<R>) => c.locked || (prefs.visible[c.id] ?? c.defaultVisible);
  const widthOf = (c: ColumnDef<R>) => prefs.widths[c.id] ?? c.width;
  return {
    visibleColumns: columns.filter(isVisible),
    isVisible,
    widthOf,
    toggle: (c: ColumnDef<R>) => update((p) => ({ ...p, visible: { ...p.visible, [c.id]: !isVisible(c) } })),
    /** 끄는 중에는 화면만, 놓을 때 저장 */
    setWidth: (id: string, w: number, persist: boolean) => {
      const apply = (p: Prefs) => ({ ...p, widths: { ...p.widths, [id]: clampWidth(w) } });
      if (persist) update(apply); else setPrefs(apply);
    },
    resetWidth: (id: string) => update((p) => { const widths = { ...p.widths }; delete widths[id]; return { ...p, widths }; }),
    reset: () => update(() => ({ visible: {}, widths: {} })),
  };
}

/** 머리칸 오른쪽 끝의 손잡이 — 끌어서 너비, 두 번 누르면 기본 너비, 키보드 ←→ 도 된다 */
export function ResizeHandle({ label, width, onResize, onReset }: {
  label: string;
  width: number;
  onResize: (w: number, persist: boolean) => void;
  onReset: () => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label} 열 너비`}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      title="끌어서 너비 조절 · 두 번 누르면 기본 너비"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
      }}
      onPointerMove={(e) => { if (start.current) onResize(start.current.w + e.clientX - start.current.x, false); }}
      onPointerUp={(e) => {
        if (!start.current) return;
        onResize(start.current.w + e.clientX - start.current.x, true);
        start.current = null;
      }}
      onPointerCancel={() => { start.current = null; }}
      onDoubleClick={onReset}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); onResize(width - 16, true); }
        if (e.key === "ArrowRight") { e.preventDefault(); onResize(width + 16, true); }
      }}
      className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none after:absolute after:right-0.5 after:top-1/4 after:h-1/2 after:w-px after:bg-border hover:after:bg-violet-500 focus-visible:after:bg-violet-500 focus-visible:outline-none"
    />
  );
}

/** "열 선택" 버튼 + 묶음별 체크 목록 */
export function ColumnPicker<R>({ columns, isVisible, onToggle, onReset }: {
  columns: ColumnDef<R>[];
  isVisible: (c: ColumnDef<R>) => boolean;
  onToggle: (c: ColumnDef<R>) => void;
  onReset: () => void;
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

  const groups: { name: string; items: ColumnDef<R>[] }[] = [];
  for (const c of columns) {
    if (c.locked) continue;
    const g = groups.find((x) => x.name === c.group);
    if (g) g.items.push(c); else groups.push({ name: c.group, items: [c] });
  }
  // 켠 열 개수는 버튼에 넣지 않는다 — 설정이 이 브라우저에만 있어서 서버가 그린 화면과 달라진다(하이드레이션 경고)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs transition-colors ${open ? "border-violet-400 bg-violet-500/10 text-violet-600 dark:text-violet-300" : "border-border hover:bg-secondary"}`}
      >
        <Columns3 className="w-3.5 h-3.5" />열 선택
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 max-h-[70vh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-popover p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <p className="text-xs text-muted-foreground">보일 열을 고르세요 · 너비는 머리칸 끝을 끌어서</p>
          </div>
          {groups.map((g) => (
            <div key={g.name} className="py-1">
              <p className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">{g.name}</p>
              {g.items.map((c) => {
                const on = isVisible(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => onToggle(c)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary"
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${on ? "bg-violet-500 text-white" : "border border-border"}`}>{on && <Check className="h-3 w-3" aria-hidden />}</span>
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <button
            type="button"
            onClick={onReset}
            className="mt-1 flex w-full items-center gap-1.5 rounded-lg border-t border-border px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />기본 열·너비로 되돌리기
          </button>
        </div>
      )}
    </div>
  );
}
