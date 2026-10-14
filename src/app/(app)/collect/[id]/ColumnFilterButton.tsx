"use client";

/**
 * 등록자 DB 열 머리의 필터 버튼 + 팝오버 — 포함 검색 · 값 고르기 · 비어 있음.
 *
 * 팝오버는 body 에 띄운다(포털 + fixed). 표는 가로 스크롤 상자 안에 있어서 그 안에 그리면
 * 상자 밖으로 나가는 부분이 잘린다. 값 목록은 팝오버를 열 때 한 번 서버에서 받아 온다
 * (실제 들어 있는 값과 건수 — 고를 수 있는 값을 사람이 기억해 칠 필요가 없게).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Filter, Loader2, Search, X } from "lucide-react";
import {
  CHECKIN_VALUES,
  EMPTY_VALUE,
  isColumnFilterActive,
  type ColumnFilter,
  type ColumnFilterKey,
} from "@/lib/collect-record-filter-model";

type Kind = "values" | "checkin";

interface Props {
  sourceId: string;
  column: ColumnFilterKey;
  label: string;
  value: ColumnFilter | undefined;
  onChange: (next: ColumnFilter | undefined) => void;
  kind?: Kind;
}

/** 저장된 값 → 화면에 보이는 글자. 참/거짓은 표와 같게 TRUE/FALSE. */
export function filterValueLabel(value: string): string {
  if (value === "" || value === EMPTY_VALUE) return "(비어 있음)";
  if (value === "true") return "TRUE";
  if (value === "false") return "FALSE";
  return value;
}

/** 칩에 쓸 한 줄 요약 — "25-34, 16-24", "‘gmail’ 포함", "비어 있음". */
export function summarizeFilter(filter: ColumnFilter): string {
  const parts: string[] = [];
  if (filter.values?.length) {
    const shown = filter.values.slice(0, 3).map(filterValueLabel).join(", ");
    parts.push(filter.values.length > 3 ? `${shown} 외 ${filter.values.length - 3}개` : shown);
  }
  if (filter.contains) parts.push(`‘${filter.contains}’ 포함`);
  if (filter.empty === "empty") parts.push("비어 있음");
  if (filter.empty === "notEmpty") parts.push("비어 있지 않음");
  return parts.join(" · ");
}

export default function ColumnFilterButton({ sourceId, column, label, value, onChange, kind = "values" }: Props) {
  const [open, setOpen] = useState(false);
  const active = isColumnFilterActive(value);
  // 앵커는 상태로 들고 있는다 — 렌더 중에 ref.current 를 읽으면 안 된다(React 규칙).
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        ref={setAnchorEl}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`shrink-0 rounded p-0.5 transition-colors ${
          active ? "text-violet-500" : "text-muted-foreground/50 hover:text-foreground"
        }`}
        title={active ? `${label} 필터: ${summarizeFilter(value!)}` : `${label} 필터`}
        aria-label={`${label} 필터`}
        aria-expanded={open}
      >
        <Filter className={`h-3 w-3 ${active ? "fill-current" : ""}`} />
      </button>
      {open && (
        <FilterPopover
          anchor={anchorEl}
          sourceId={sourceId}
          column={column}
          label={label}
          kind={kind}
          value={value}
          onApply={(next) => { onChange(next); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FilterPopover({
  anchor,
  sourceId,
  column,
  label,
  kind,
  value,
  onApply,
  onClose,
}: {
  anchor: HTMLElement | null;
  sourceId: string;
  column: ColumnFilterKey;
  label: string;
  kind: Kind;
  value: ColumnFilter | undefined;
  onApply: (next: ColumnFilter | undefined) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [contains, setContains] = useState(value?.contains ?? "");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(value?.values ?? []));
  const [empty, setEmpty] = useState<ColumnFilter["empty"]>(value?.empty);
  const [listQuery, setListQuery] = useState("");
  const [options, setOptions] = useState<Array<{ value: string; count: number }> | null>(
    kind === "checkin" ? [{ value: CHECKIN_VALUES.in, count: -1 }, { value: CHECKIN_VALUES.out, count: -1 }] : null,
  );
  const [truncated, setTruncated] = useState(false);

  // 위치 — 버튼 바로 아래, 화면 밖으로 나가지 않게.
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 16);
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - width - 8)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  // 바깥 클릭·Escape 로 닫는다.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  // 값 목록 — 열 때 한 번.
  useEffect(() => {
    if (kind === "checkin") return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/collect-sources/${sourceId}/records/values?c=${encodeURIComponent(column)}`);
        const data = res.ok ? await res.json() : { values: [], truncated: false };
        if (!alive) return;
        // 빈 값("")은 자리표시로 바꿔 둔다 — 빈 문자열은 필터에서 "값 없음" 으로 걸러져 버린다.
        setOptions((data.values ?? []).map((o: { value: string; count: number }) => ({ ...o, value: o.value === "" ? EMPTY_VALUE : o.value })));
        setTruncated(!!data.truncated);
      } catch {
        if (alive) setOptions([]);
      }
    })();
    return () => { alive = false; };
  }, [sourceId, column, kind]);

  const visibleOptions = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return (options ?? []).filter((o) => !q || filterValueLabel(o.value).toLowerCase().includes(q));
  }, [options, listQuery]);

  const toggle = (v: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const apply = () => {
    const next: ColumnFilter = { c: column };
    if (kind !== "checkin" && contains.trim()) next.contains = contains.trim();
    if (picked.size) next.values = [...picked];
    if (kind !== "checkin" && empty) next.empty = empty;
    onApply(isColumnFilterActive(next) ? next : undefined);
  };

  if (!pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${label} 필터`}
      style={{ top: pos.top, left: pos.left, width: Math.min(288, window.innerWidth - 16) }}
      className="fixed z-[60] rounded-xl border border-border bg-background p-3 text-xs shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{label}</span>
        <button onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:bg-secondary" aria-label="닫기">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {kind !== "checkin" && (
        <label className="mb-2 block space-y-1">
          <span className="text-[11px] text-muted-foreground">이 글자를 포함</span>
          <input
            autoFocus
            value={contains}
            onChange={(e) => setContains(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) apply(); }}
            placeholder="예: gmail"
            className="h-8 w-full rounded-lg border border-border bg-background px-2 outline-none focus:border-violet-400"
          />
        </label>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">값 고르기{picked.size > 0 && ` · ${picked.size}개`}</span>
          {picked.size > 0 && (
            <button onClick={() => setPicked(new Set())} className="text-[11px] text-muted-foreground hover:text-foreground">선택 해제</button>
          )}
        </div>
        {kind !== "checkin" && (options?.length ?? 0) > 8 && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="목록에서 찾기"
              className="h-7 w-full rounded-lg border border-border bg-background pl-6 pr-2 outline-none focus:border-violet-400"
            />
          </div>
        )}
        <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
          {options === null ? (
            <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : visibleOptions.length === 0 ? (
            <p className="px-2 py-3 text-center text-muted-foreground">값이 없어요</p>
          ) : (
            visibleOptions.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-secondary/60">
                <input type="checkbox" checked={picked.has(o.value)} onChange={() => toggle(o.value)} className="accent-violet-500" />
                <span className="min-w-0 flex-1 truncate" title={filterValueLabel(o.value)}>{filterValueLabel(o.value)}</span>
                {o.count >= 0 && <span className="shrink-0 tabular-nums text-muted-foreground">{o.count.toLocaleString()}</span>}
              </label>
            ))
          )}
        </div>
        {truncated && <p className="text-[10px] text-muted-foreground">값이 많아 상위 200개만 보여요 — 위 &lsquo;포함&rsquo; 검색을 함께 쓰세요.</p>}
      </div>

      {kind !== "checkin" && (
        <div className="mt-2 flex gap-1">
          {([
            [undefined, "전체"],
            ["empty", "비어 있음"],
            ["notEmpty", "비어 있지 않음"],
          ] as const).map(([v, text]) => (
            <button
              key={text}
              onClick={() => setEmpty(v)}
              className={`flex-1 rounded-lg px-1.5 py-1 text-[11px] transition-colors ${
                empty === v ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex justify-end gap-1.5">
        <button
          onClick={() => onApply(undefined)}
          className="rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-secondary"
        >
          필터 지우기
        </button>
        <button
          onClick={apply}
          className="rounded-lg bg-violet-500 px-3 py-1.5 font-medium text-white transition-colors hover:bg-violet-600"
        >
          적용
        </button>
      </div>
    </div>,
    document.body,
  );
}
