"use client";

/**
 * 일지 — 시트(DM 업무 현황)처럼 쓴다(2026-10-18).
 *
 *  행 = 날짜(맨 위 "먼 미래", 미래가 위·과거가 아래 — 시트와 같은 순서), 열 = 공통 + 사람.
 *  칸을 누르면 바로 적고 Enter 로 다음 줄. 끝나면 ● 를 누르거나 Ctrl+Enter → 취소선(완료).
 *  "[LA] 배너 교체" 처럼 머리표로 시작하면 행사(아니면 분류)가 붙고, Enter 로 이어 쓰는 줄도 같은 머리표.
 *  시트 칸을 통째로 붙여 넣으면 줄마다 나뉜다. 줄을 끌어 다른 날·먼 미래·공통으로 옮긴다.
 *  상태는 고르지 않는다 — 취소선이면 완료, 아니면 날짜로 진행/예정(주간 보고가 그렇게 읽는다).
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronUp, GripVertical, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import {
  WORK_CATEGORIES, kstToday, openStatus, parsePastedWork, resolveWorkTag, shiftDay, splitWorkTag, weekOf,
} from "@/lib/worklog";
import type { WorkEntryDto, WorkGroupDto, WorkMemberDto } from "./types";

const SOMEDAY = "someday";
const COMMON = "common";
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const dow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const dayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEKDAY[d.getUTCDay()]})`;
};

type Line = WorkEntryDto & { ck: string; temp?: boolean };
type TagFields = { groupId: string | null; category: string };
type Focus = { ck: string; caret: "start" | "end" } | null;

/** 주 경계 — 위가 미래라 월요일 행 아래에 굵은 선. */
const WEEK_EDGE = "shadow-[inset_0_-2px_0_var(--color-border)]";

const MOBILE_Q = "(max-width: 639px)";
const subscribeMobile = (cb: () => void) => {
  const m = window.matchMedia(MOBILE_Q);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useIsMobile = () => useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_Q).matches, () => false);

let seq = 0;
const tmpKey = () => `tmp-${Date.now().toString(36)}-${++seq}`;

export default function JournalTab({ workspaceId, groups, onGoGroups }: { workspaceId: string; groups: WorkGroupDto[]; onGoGroups: () => void }) {
  const today = kstToday();
  const isMobile = useIsMobile();
  const [range, setRange] = useState(() => ({ from: shiftDay(weekOf(today).start, -7), to: shiftDay(weekOf(today).end, 14) }));
  const [members, setMembers] = useState<WorkMemberDto[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showWeekend, setShowWeekend] = useState(false);
  // 보는 사람(열) — null 이면 전체. 사람마다 브라우저에 기억한다.
  const viewKey = `worklog-cols:${workspaceId}`;
  const [visible, setVisibleState] = useState<string[] | null>(() => {
    if (typeof window === "undefined") return null;
    try { const v = JSON.parse(window.localStorage.getItem(viewKey) ?? "null"); return Array.isArray(v) ? v : null; } catch { return null; }
  });
  const setVisible = (next: string[] | null) => {
    setVisibleState(next);
    try { window.localStorage.setItem(viewKey, JSON.stringify(next)); } catch { /* 사생활 보호 모드 */ }
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mobileCol, setMobileCol] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ ck: string; rect: DOMRect } | null>(null);
  const [loadingMore, setLoadingMore] = useState<"past" | "future" | null>(null);

  // 줄 목록은 ref 가 원본 — Enter·blur 가 같은 틱에 이어 불려도 최신 값을 본다.
  const linesRef = useRef<Line[]>([]);
  const [lines, setLinesState] = useState<Line[] | null>(null);
  const setLines = useCallback((fn: (prev: Line[]) => Line[]) => {
    linesRef.current = fn(linesRef.current);
    setLinesState(linesRef.current);
  }, []);
  const creating = useRef(new Map<string, Promise<string | null>>());
  const dragCk = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledToToday = useRef(false);

  const groupMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const myName = members.find((m) => m.id === me)?.name ?? "나";

  const fetchRange = useCallback(async (from: string, to: string, someday: boolean) => {
    const res = await fetch(`/api/worklog/entries?workspaceId=${workspaceId}&from=${from}&to=${to}${someday ? "&someday=1" : ""}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "일지를 불러오지 못했어요"); return null; }
    setMe(data.me);
    setIsAdmin(!!data.isAdmin);
    setMembers(data.members ?? []);
    return (data.entries ?? []) as WorkEntryDto[];
  }, [workspaceId]);

  // 늘릴 땐 늘어난 만큼만 따로 읽어 합친다(적고 있던 줄을 덮지 않게). 다시 읽기는 지금까지 늘린 범위 전체.
  const rangeRef = useRef(range);
  const load = useCallback(async () => {
    const entries = await fetchRange(rangeRef.current.from, rangeRef.current.to, true);
    if (!entries) { if (!linesRef.current.length) setLinesState([]); return; }
    linesRef.current = entries.map((e) => ({ ...e, ck: e.id }));
    setLinesState(linesRef.current);
  }, [fetchRange]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const extend = async (dir: "past" | "future") => {
    const from = dir === "past" ? shiftDay(range.from, -14) : shiftDay(range.to, 1);
    const to = dir === "past" ? shiftDay(range.from, -1) : shiftDay(range.to, 14);
    setLoadingMore(dir);
    const entries = await fetchRange(from, to, false);
    setLoadingMore(null);
    if (!entries) return;
    setLines((prev) => {
      const seen = new Set(prev.map((l) => l.id));
      return [...prev, ...entries.filter((e) => !seen.has(e.id)).map((e) => ({ ...e, ck: e.id }))];
    });
    rangeRef.current = dir === "past" ? { ...rangeRef.current, from } : { ...rangeRef.current, to };
    setRange(rangeRef.current);
  };

  // ── 칸 · 열 · 행 ──────────────────────────────────────────────
  const colOf = (l: Line) => (l.common ? COMMON : l.authorId);
  const rowOf = (l: Line) => l.date ?? SOMEDAY;
  const cellKey = (row: string, col: string) => `${row}|${col}`;
  // 시트처럼 팀원 누구나 다른 사람 칸에도 적고 고친다(2026-10-21) — 워크스페이스를 떠난 사람 칸만 막는다.
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const canCreateIn = (col: string) => col === COMMON || col === me || memberIds.has(col);
  const canEditLine = (l: Line) => l.common || l.authorId === me || isAdmin || memberIds.has(l.authorId);
  const nameOf = (id: string) => (id === me ? myName : members.find((m) => m.id === id)?.name ?? "");

  const byCell = useMemo(() => {
    const map = new Map<string, Line[]>();
    for (const l of lines ?? []) {
      const key = cellKey(rowOf(l), colOf(l));
      map.set(key, [...(map.get(key) ?? []), l]);
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    return map;
  }, [lines]);

  const allCols = useMemo(() => {
    const cols: Array<{ key: string; label: string; mine?: boolean }> = [{ key: COMMON, label: "공통" }];
    if (me) cols.push({ key: me, label: myName, mine: true });
    for (const m of members) if (m.id !== me) cols.push({ key: m.id, label: m.name });
    // 워크스페이스를 떠난 사람의 줄도 보이게.
    const known = new Set(cols.map((c) => c.key));
    for (const l of lines ?? []) {
      if (!l.common && !known.has(l.authorId)) { known.add(l.authorId); cols.push({ key: l.authorId, label: l.authorName }); }
    }
    return cols;
  }, [members, me, myName, lines]);

  const shownCols = visible ? allCols.filter((c) => visible.includes(c.key)) : allCols;
  const pickable = shownCols.length ? shownCols : allCols;
  const activeMobileCol = pickable.some((c) => c.key === mobileCol) ? mobileCol! : (pickable.find((c) => c.mine) ?? pickable[0])?.key ?? COMMON;
  const cols = isMobile ? pickable.filter((c) => c.key === activeMobileCol) : pickable;
  const pickerLabel = !visible || shownCols.length === allCols.length
    ? "전체"
    : shownCols.length <= 2 ? shownCols.map((c) => (c.mine ? "나" : c.label)).join(", ") : `${shownCols.length}명`;

  const days = useMemo(() => {
    const used = new Set((lines ?? []).map((l) => l.date).filter(Boolean));
    const out: string[] = [];
    for (let d = range.to; d >= range.from; d = shiftDay(d, -1)) {
      const weekend = dow(d) === 0 || dow(d) === 6;
      if (showWeekend || !weekend || used.has(d) || d === today) out.push(d);
    }
    return out;
  }, [range, lines, showWeekend, today]);

  // 처음 열 때 오늘 줄이 위쪽에 오게 — 시트에서 오늘 행으로 내려가 쓰던 것처럼.
  useLayoutEffect(() => {
    if (scrolledToToday.current || !lines || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-day="${today}"]`);
    if (!el) return;
    scrolledToToday.current = true;
    // 오늘 위로 다가올 날 몇 줄이 보이게(미리 넣어 둔 일도 같이 본다).
    scrollRef.current.scrollTop = Math.max(0, el.offsetTop - scrollRef.current.clientHeight * 0.3);
  }, [lines, today]);

  const scrollToToday = () => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-day="${today}"]`);
    if (el && scrollRef.current) scrollRef.current.scrollTo({ top: Math.max(0, el.offsetTop - scrollRef.current.clientHeight * 0.3), behavior: "smooth" });
  };

  // ── 저장 ──────────────────────────────────────────────────────
  const find = (ck: string) => linesRef.current.find((l) => l.ck === ck);
  const idOf = async (ck: string): Promise<string | null> => {
    const line = find(ck);
    if (line && !line.temp) return line.id;
    const pending = creating.current.get(ck);
    return pending ? pending : null;
  };
  const replace = (ck: string, entry: WorkEntryDto) =>
    setLines((prev) => prev.map((l) => (l.ck === ck ? { ...entry, ck } : l)));

  const createOne = (line: Line) => {
    const p = (async () => {
      const res = await fetch("/api/worklog/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId, date: line.date, common: line.common, sortOrder: line.sortOrder, groupId: line.groupId,
          category: line.category, content: line.content, status: line.status, result: line.result, note: line.note,
          authorId: line.common ? undefined : line.authorId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "저장하지 못했어요");
        setLines((prev) => prev.filter((l) => l.ck !== line.ck));
        return null;
      }
      // 저장되는 사이 더 고쳤으면 그 값은 update 가 따로 보낸다 — 여기선 id 만 받는다.
      setLines((prev) => prev.map((l) => (l.ck === line.ck ? { ...l, id: data.entry.id, temp: false, authorName: data.entry.authorName, createdById: data.entry.createdById, createdAt: data.entry.createdAt } : l)));
      return data.entry.id as string;
    })();
    creating.current.set(line.ck, p);
    void p.finally(() => creating.current.delete(line.ck));
    return p;
  };

  const update = async (ck: string, patch: Partial<WorkEntryDto>, localOnly: Partial<Line> = {}) => {
    setLines((prev) => prev.map((l) => (l.ck === ck ? { ...l, ...patch, ...localOnly } : l)));
    const id = await idOf(ck);
    if (!id) return;
    const res = await fetch("/api/worklog/entries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "저장하지 못했어요"); void load(); return; }
    const current = find(ck);
    // 그새 다시 고친 글자는 살린다 — 서버 값으로 덮는 건 글자 말고 나머지(작성자·시각).
    if (current) replace(ck, { ...data.entry, content: current.content, status: current.status, date: current.date, common: current.common, sortOrder: current.sortOrder });
  };

  const restore = (line: Line) => {
    const ck = tmpKey();
    const copy: Line = { ...line, ck, id: ck, temp: true };
    setLines((prev) => [...prev, copy]);
    void createOne(copy);
  };

  const remove = async (ck: string, undo = true) => {
    const line = find(ck);
    if (!line) return;
    setLines((prev) => prev.filter((l) => l.ck !== ck));
    const wasSaved = !line.temp || creating.current.has(ck);
    if (!wasSaved) return;
    const id = await idOf(ck);
    if (!id) return;
    const res = await fetch(`/api/worklog/entries?id=${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("지우지 못했어요"); setLines((prev) => [...prev, line]); return; }
    if (undo) toast("줄을 지웠어요", { description: line.content, action: { label: "되돌리기", onClick: () => restore(line) } });
  };

  /** 칸에 빈 줄을 하나 만든다(저장은 글자가 생길 때). after 가 있으면 그 줄 바로 아래. */
  const addDraft = (row: string, col: string, after?: Line, tags?: TagFields) => {
    const list = byCellNow(row, col);
    const existing = list.find((l) => l.temp && !l.content && !creating.current.has(l.ck));
    if (existing && !after) { setFocus({ ck: existing.ck, caret: "end" }); return; }
    let sortOrder: number;
    if (after) {
      const i = list.findIndex((l) => l.ck === after.ck);
      const next = list[i + 1];
      sortOrder = next ? (after.sortOrder + next.sortOrder) / 2 : after.sortOrder + 1;
    } else {
      sortOrder = (list.at(-1)?.sortOrder ?? 0) + 1;
    }
    const date = row === SOMEDAY ? null : row;
    const now = new Date().toISOString();
    const ck = tmpKey();
    const draft: Line = {
      ck, id: ck, temp: true, authorId: col === COMMON ? me ?? "" : col, authorName: col === COMMON ? myName : nameOf(col), createdById: me, date, common: col === COMMON, sortOrder,
      groupId: tags?.groupId ?? null, category: tags?.category ?? "", content: "", status: openStatus(date, today),
      result: "", note: "", createdAt: now, updatedAt: now,
    };
    setLines((prev) => [...prev, draft]);
    setFocus({ ck, caret: "end" });
  };

  /** 지금 ref 기준의 칸 줄(렌더 전 값까지). */
  const byCellNow = (row: string, col: string) =>
    linesRef.current
      .filter((l) => rowOf(l) === row && colOf(l) === col)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));

  /** 글을 확정한다(Enter·blur). 머리표 "[LA]" 는 떼어 행사/분류로. 비우면 지운다. */
  const commit = (ck: string, raw: string) => {
    const line = find(ck);
    if (!line) return;
    const { tag, content } = splitWorkTag(raw);
    const tags = tag !== null ? resolveWorkTag(tag, groups) : null;
    if (!content) {
      if (line.temp && !creating.current.has(ck)) setLines((prev) => prev.filter((l) => l.ck !== ck));
      else void remove(ck);
      return;
    }
    const sameTags = !tags || (tags.groupId === line.groupId && tags.category === line.category);
    if (line.temp && !creating.current.has(ck)) {
      const next = { ...line, content, ...(tags ?? {}) };
      setLines((prev) => prev.map((l) => (l.ck === ck ? next : l)));
      void createOne(next);
      return;
    }
    if (content === line.content && sameTags) return;
    void update(ck, { content, ...(tags ?? {}) });
  };

  const onEnter = (ck: string, raw: string) => {
    const line = find(ck);
    if (!line) return;
    commit(ck, raw);
    const { tag } = splitWorkTag(raw);
    const tags = tag !== null ? resolveWorkTag(tag, groups) : { groupId: line.groupId, category: line.category };
    const after = find(ck);
    if (after && canCreateIn(colOf(after))) addDraft(rowOf(after), colOf(after), after, tags);
  };

  const toggleDone = (ck: string) => {
    const line = find(ck);
    if (!line || !line.content) return;
    void update(ck, { status: line.status === "done" ? openStatus(line.date, today) : "done" });
  };

  const move = (ck: string, row: string, col: string) => {
    const line = find(ck);
    if (!line || !canCreateIn(col)) return;
    if (rowOf(line) === row && colOf(line) === col) return;
    const date = row === SOMEDAY ? null : row;
    const sortOrder = (byCellNow(row, col).at(-1)?.sortOrder ?? 0) + 1;
    const patch: Partial<WorkEntryDto> = { date, common: col === COMMON, sortOrder };
    if (line.status !== "done") patch.status = openStatus(date, today);
    if (col !== COMMON && col !== line.authorId) patch.authorId = col;
    const local: Partial<Line> = col !== COMMON ? { authorId: col, authorName: nameOf(col) } : {};
    void update(ck, patch, local);
  };

  const neighbor = (ck: string, dir: -1 | 1) => {
    const line = find(ck);
    if (!line) return;
    const list = byCellNow(rowOf(line), colOf(line));
    const i = list.findIndex((l) => l.ck === ck);
    const target = list[i + dir];
    if (target) setFocus({ ck: target.ck, caret: dir < 0 ? "end" : "start" });
  };

  const backspaceEmpty = (ck: string) => {
    const line = find(ck);
    if (!line) return;
    const list = byCellNow(rowOf(line), colOf(line));
    const prev = list[list.findIndex((l) => l.ck === ck) - 1];
    if (line.temp && !creating.current.has(ck)) setLines((p) => p.filter((l) => l.ck !== ck));
    else void remove(ck);
    if (prev) setFocus({ ck: prev.ck, caret: "end" });
  };

  /** 여러 줄 붙여넣기 — 시트 칸을 통째로. 한 줄이면 평소처럼 붙인다(false). */
  const paste = (ck: string, text: string, currentValue: string): boolean => {
    const items = parsePastedWork(text);
    if (items.length <= 1 || !text.includes("\n")) return false;
    const line = find(ck);
    if (!line) return false;
    const row = rowOf(line), col = colOf(line);
    if (!canCreateIn(col)) return false;
    const list = byCellNow(row, col);
    const i = list.findIndex((l) => l.ck === ck);
    const replaceCurrent = !currentValue.trim() && line.temp && !creating.current.has(ck);
    const anchor = replaceCurrent ? list[i - 1] : line;
    const nextLine = list[i + 1];
    const start = anchor ? anchor.sortOrder : (nextLine ? nextLine.sortOrder - 1 : 0);
    const end = nextLine ? nextLine.sortOrder : start + items.length + 1;
    const step = (end - start) / (items.length + 1);
    if (replaceCurrent) setLines((p) => p.filter((l) => l.ck !== ck));
    else commit(ck, currentValue);
    const date = line.date;
    const now = new Date().toISOString();
    const fallback: TagFields = { groupId: line.groupId, category: line.category };
    const drafts: Line[] = items.map((item, n) => {
      const tags = item.tag !== null ? resolveWorkTag(item.tag, groups) : fallback;
      const k = tmpKey();
      return {
        ck: k, id: k, temp: true, authorId: col === COMMON ? me ?? "" : col, authorName: col === COMMON ? myName : nameOf(col), createdById: me, date, common: col === COMMON,
        sortOrder: start + step * (n + 1), ...tags, content: item.content, status: openStatus(date, today),
        result: "", note: "", createdAt: now, updatedAt: now,
      };
    });
    setLines((p) => [...p, ...drafts]);
    const batch = (async () => {
      const res = await fetch("/api/worklog/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          items: drafts.map((d) => ({ date: d.date, common: d.common, sortOrder: d.sortOrder, groupId: d.groupId, category: d.category, content: d.content, status: d.status, authorId: d.common ? undefined : d.authorId })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "붙여 넣지 못했어요");
        const cks = new Set(drafts.map((d) => d.ck));
        setLines((p) => p.filter((l) => !cks.has(l.ck)));
        return null;
      }
      const saved = data.entries as WorkEntryDto[];
      setLines((p) => p.map((l) => {
        const n = drafts.findIndex((d) => d.ck === l.ck);
        return n < 0 || !saved[n] ? l : { ...l, id: saved[n].id, temp: false, authorName: saved[n].authorName, createdAt: saved[n].createdAt };
      }));
      return saved.map((s) => s.id);
    })();
    drafts.forEach((d, n) => {
      const p = batch.then((ids) => ids?.[n] ?? null);
      creating.current.set(d.ck, p);
      void p.finally(() => creating.current.delete(d.ck));
    });
    toast.success(`${drafts.length}줄을 붙여 넣었어요`);
    return true;
  };

  const labelOf = (l: Line) => {
    const g = l.groupId ? groupMap.get(l.groupId)?.name : null;
    return [g, l.category].filter(Boolean).join(" · ");
  };

  const menuLine = menu ? (lines ?? []).find((l) => l.ck === menu.ck) ?? null : null;

  if (lines === null) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const gridTemplateColumns = `${isMobile ? 64 : 88}px repeat(${cols.length}, minmax(${isMobile ? 0 : 230}px, 1fr))`;

  return (
    <div className="space-y-3">
      {/* 도구줄 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={scrollToToday} className={`bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-secondary/70 ${R.control}`}>오늘로</button>
          <Toggle on={showWeekend} onClick={() => setShowWeekend((v) => !v)}>주말 보기</Toggle>
          <div className="relative">
            <button onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors ${R.control} ${visible ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
              보는 사람: {pickerLabel}<ChevronDown className="h-3 w-3" />
            </button>
            {pickerOpen && (
              <PeoplePicker
                cols={allCols}
                visible={visible}
                onChange={setVisible}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
        </div>
        <p className="hidden text-[11px] text-muted-foreground sm:block">
          칸을 눌러 바로 적기 · <Kbd>Enter</Kbd> 다음 줄 · <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> 또는 ● 완료(취소선) · <code className="rounded bg-secondary px-1">[LA] 할 일</code> 로 행사 지정(<button onClick={onGoGroups} className="underline">행사 관리</button>) · 줄을 끌어 다른 날로
        </p>
      </div>

      {isMobile && (
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {pickable.map((c) => (
            <button key={c.key} onClick={() => setMobileCol(c.key)}
              className={`shrink-0 px-3 py-1.5 text-xs transition-colors ${R.control} ${activeMobileCol === c.key ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}>
              {c.label}{c.mine ? " (나)" : ""}
            </button>
          ))}
        </div>
      )}

      {/* 시트 */}
      <div ref={scrollRef} className={`relative max-h-[calc(100dvh-230px)] min-h-[320px] overflow-auto bg-background ${R.panel} ${FINISH.s1}`}>
        <div className="grid min-w-full" style={{ gridTemplateColumns }}>
          {/* 머리 */}
          <div className="sticky left-0 top-0 z-30 border-b border-r border-border bg-secondary px-2 py-2 text-[11px] font-semibold text-muted-foreground">일자</div>
          {cols.map((c) => (
            <div key={c.key} className="sticky top-0 z-20 truncate border-b border-r border-border bg-secondary px-2.5 py-2 text-xs font-semibold">
              {c.label}{c.mine && <span className="ml-1 font-normal text-violet-500">나</span>}
            </div>
          ))}

          {/* 먼 미래 */}
          <RowHead day={SOMEDAY} today={today} />
          {cols.map((c) => renderCell(SOMEDAY, c.key))}

          <div className="col-span-full border-b border-border">
            <button onClick={() => void extend("future")} disabled={loadingMore !== null}
              className="flex w-full items-center justify-center gap-1 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary/60 hover:text-foreground">
              {loadingMore === "future" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronUp className="h-3 w-3" />}
              {dayLabel(shiftDay(range.to, 1))} 이후 2주 더
            </button>
          </div>

          {days.map((day) => (
            <Fragment key={day}>
              <RowHead day={day} today={today} />
              {cols.map((c) => renderCell(day, c.key))}
            </Fragment>
          ))}

          <div className="col-span-full">
            <button onClick={() => void extend("past")} disabled={loadingMore !== null}
              className="flex w-full items-center justify-center gap-1 py-2 text-[11px] text-muted-foreground hover:bg-secondary/60 hover:text-foreground">
              {loadingMore === "past" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3" />}
              {dayLabel(shiftDay(range.from, -1))} 이전 2주 더
            </button>
          </div>
        </div>
      </div>

      {menu && menuLine && (
        <LineMenu
          line={menuLine}
          rect={menu.rect}
          groups={groups}
          today={today}
          canCommon
          members={members.map((m) => ({ id: m.id, name: m.id === me ? `${m.name} (나)` : m.name }))}
          onAssign={(id) => { move(menuLine.ck, rowOf(menuLine), id); setMenu(null); }}
          onClose={() => setMenu(null)}
          onPatch={(patch) => void update(menuLine.ck, patch)}
          onMove={(row, col) => { move(menuLine.ck, row, col ?? colOf(menuLine)); setMenu(null); }}
          onToggleCommon={() => { move(menuLine.ck, rowOf(menuLine), menuLine.common ? (me ?? COMMON) : COMMON); setMenu(null); }}
          onRemove={() => { void remove(menuLine.ck); setMenu(null); }}
        />
      )}
    </div>
  );

  function renderCell(row: string, col: string) {
    const key = cellKey(row, col);
    const list = byCell.get(key) ?? [];
    const creatable = canCreateIn(col);
    const isToday = row === today;
    const weekend = row !== SOMEDAY && (dow(row) === 0 || dow(row) === 6);
    const weekStart = row !== SOMEDAY && dow(row) === 1;
    return (
      <div
        key={key}
        data-cell={key}
        onDragOver={(e) => { if (dragCk.current && creatable) { e.preventDefault(); if (dropKey !== key) setDropKey(key); } }}
        onDragLeave={() => { if (dropKey === key) setDropKey(null); }}
        onDrop={(e) => { e.preventDefault(); setDropKey(null); if (dragCk.current) move(dragCk.current, row, col); dragCk.current = null; }}
        className={`group/cell flex min-h-[44px] min-w-0 flex-col border-b border-r border-border px-1.5 py-1 transition-colors
          ${weekStart ? WEEK_EDGE : ""} ${isToday ? "bg-violet-500/[0.05]" : weekend ? "bg-secondary/30" : ""}
          ${dropKey === key ? "bg-violet-500/10 ring-1 ring-inset ring-violet-500/40" : ""} ${creatable ? "cursor-text" : ""}`}
      >
        {list.map((l, i) => {
          const label = labelOf(l);
          const prevLabel = i > 0 ? labelOf(list[i - 1]) : "";
          const header = label !== prevLabel ? label || "기타" : null;
          return (
            <LineRow
              key={l.ck}
              line={l}
              header={i === 0 && !label ? null : header}
              editable={canEditLine(l)}
              showAuthor={l.common}
              byline={!l.common && l.createdById && l.createdById !== l.authorId ? (nameOf(l.createdById) || "다른 팀원") : null}
              focus={focus?.ck === l.ck ? focus : null}
              onFocused={() => setFocus(null)}
              onCommit={(v) => commit(l.ck, v)}
              onEnter={(v) => onEnter(l.ck, v)}
              onToggle={() => toggleDone(l.ck)}
              onBackspaceEmpty={() => backspaceEmpty(l.ck)}
              onArrow={(dir) => neighbor(l.ck, dir)}
              onPaste={(text, value) => paste(l.ck, text, value)}
              onMenu={(rect) => setMenu({ ck: l.ck, rect })}
              onDragStart={() => { dragCk.current = l.ck; }}
              onDragEnd={() => { dragCk.current = null; setDropKey(null); }}
            />
          );
        })}
        {creatable && (
          <div
            onMouseDown={(e) => { e.preventDefault(); addDraft(row, col); }}
            className="flex min-h-[22px] flex-1 items-start pl-5 text-[11px] text-muted-foreground/0 transition-colors group-hover/cell:text-muted-foreground/60 [@media(hover:none)]:text-muted-foreground/40"
          >
            {list.length === 0 ? "+ 적기" : ""}
          </div>
        )}
      </div>
    );
  }
}

function RowHead({ day, today }: { day: string; today: string }) {
  if (day === SOMEDAY) {
    return (
      <div className="sticky left-0 z-10 border-b border-r border-border bg-background px-2 py-1.5">
        <div className="text-xs font-semibold">먼 미래</div>
        <div className="text-[10px] text-muted-foreground">날짜 없이</div>
      </div>
    );
  }
  const d = dow(day);
  const isToday = day === today;
  return (
    <div data-day={day}
      className={`sticky left-0 z-10 border-b border-r border-border px-2 py-1.5 ${isToday ? "bg-violet-50 dark:bg-violet-950" : "bg-background"} ${d === 1 ? WEEK_EDGE : ""}`}>
      <div className={`text-xs font-medium tabular-nums ${d === 0 ? "text-red-500" : d === 6 ? "text-blue-500" : ""}`}>{dayLabel(day)}</div>
      {isToday ? <div className="text-[10px] font-semibold text-violet-500">오늘</div> : day > today ? <div className="text-[10px] text-muted-foreground">예정</div> : null}
    </div>
  );
}

function LineRow({
  line, header, editable, showAuthor, byline, focus, onFocused, onCommit, onEnter, onToggle, onBackspaceEmpty, onArrow, onPaste, onMenu, onDragStart, onDragEnd,
}: {
  byline?: string | null;
  line: Line;
  header: string | null;
  editable: boolean;
  showAuthor: boolean;
  focus: Focus;
  onFocused: () => void;
  onCommit: (v: string) => void;
  onEnter: (v: string) => void;
  onToggle: () => void;
  onBackspaceEmpty: () => void;
  onArrow: (dir: -1 | 1) => void;
  onPaste: (text: string, value: string) => boolean;
  onMenu: (rect: DOMRect) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? line.content;
  const done = line.status === "done";

  useEffect(() => {
    if (!focus || !ref.current) return;
    const el = ref.current;
    el.focus();
    const pos = focus.caret === "start" ? 0 : el.value.length;
    el.setSelectionRange(pos, pos);
    onFocused();
  }, [focus, onFocused]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const mod = e.ctrlKey || e.metaKey;
    if ((e.key === "Enter" && mod) || (mod && e.shiftKey && e.key.toLowerCase() === "x") || (e.ctrlKey && e.key === "5") || (e.altKey && e.shiftKey && e.code === "Digit5")) {
      e.preventDefault();
      onCommit(el.value);
      onToggle();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (el.value.trim()) onEnter(el.value);
      return;
    }
    if (e.key === "Backspace" && el.value === "") { e.preventDefault(); onBackspaceEmpty(); return; }
    if (e.key === "ArrowUp" && el.selectionStart === 0 && el.selectionEnd === 0) { e.preventDefault(); onArrow(-1); return; }
    if (e.key === "ArrowDown" && el.selectionStart === el.value.length) { e.preventDefault(); onArrow(1); return; }
    if (e.key === "Escape") el.blur();
  };

  return (
    <div className="group/line relative">
      {header && <div className="mt-1 truncate pl-5 text-[11px] font-semibold text-violet-600 dark:text-violet-400">[{header}]</div>}
      <div className="flex items-start gap-1">
        {editable ? (
          <span
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", line.content); onDragStart(); }}
            onDragEnd={onDragEnd}
            className="-ml-1 mt-[3px] hidden h-4 w-3 shrink-0 cursor-grab items-center text-muted-foreground/0 group-hover/line:text-muted-foreground/60 sm:flex"
            aria-label="끌어서 옮기기"
          >
            <GripVertical className="h-3 w-3" />
          </span>
        ) : null}
        <button
          type="button"
          disabled={!editable || !line.content}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggle}
          aria-label={done ? "완료 취소" : "완료"}
          className={`mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${
            done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 hover:border-emerald-500"
          } disabled:cursor-default`}
        >
          {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          {editable ? (
            <textarea
              ref={ref}
              rows={1}
              value={value}
              onFocus={() => setDraft(line.content)}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => { onCommit(e.target.value); setDraft(null); }}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text/plain");
                if (onPaste(text, e.currentTarget.value)) { e.preventDefault(); setDraft(null); }
              }}
              placeholder="할 일"
              className={`block w-full resize-none overflow-hidden bg-transparent text-[13px] leading-5 outline-none placeholder:text-muted-foreground/40 ${
                done ? "text-muted-foreground line-through decoration-foreground/40" : ""
              }`}
            />
          ) : (
            <div className={`whitespace-pre-wrap break-words text-[13px] leading-5 ${done ? "text-muted-foreground line-through decoration-foreground/40" : ""}`}>{line.content}</div>
          )}
          {(line.result || line.note) && (
            <div className="truncate text-[11px] leading-4 text-muted-foreground">
              {line.result && <span>↳ {line.result}</span>}
              {line.result && line.note && " · "}
              {line.note && <span>비고 {line.note}</span>}
            </div>
          )}
        </div>
        {showAuthor && <span className="mt-[3px] shrink-0 text-[10px] text-muted-foreground">{line.authorName}</span>}
        {byline && <span className="mt-[3px] shrink-0 rounded bg-violet-500/10 px-1 text-[10px] text-violet-600 dark:text-violet-400" title={`${byline}님이 적은 줄`}>by {byline}</span>}
        {editable && !line.temp && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => onMenu(e.currentTarget.getBoundingClientRect())}
            className="mt-[1px] shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus:opacity-100 group-hover/line:opacity-100 [@media(hover:none)]:opacity-60"
            aria-label="줄 설정"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function LineMenu({
  line, rect, groups, today, canCommon, members, onAssign, onClose, onPatch, onMove, onToggleCommon, onRemove,
}: {
  members: Array<{ id: string; name: string }>;
  onAssign: (memberId: string) => void;
  line: Line;
  rect: DOMRect;
  groups: WorkGroupDto[];
  today: string;
  canCommon: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<WorkEntryDto>) => void;
  onMove: (row: string, col?: string) => void;
  onToggleCommon: () => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [onClose]);

  const width = 280;
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const below = rect.bottom + 380 < window.innerHeight;
  const style: React.CSSProperties = below ? { top: rect.bottom + 4, left, width } : { bottom: window.innerHeight - rect.top + 4, left, width };
  const nextMonday = shiftDay(weekOf(today).start, 7);
  const tomorrow = shiftDay(today, 1);
  const quick: Array<[string, string]> = [["오늘", today], ["내일", tomorrow], ["다음 주 월", nextMonday], ["먼 미래", SOMEDAY]];
  const active = groups.filter((g) => !g.archived || g.id === line.groupId);

  return createPortal(
    <div ref={ref} style={style} className={`fixed z-50 max-h-[70vh] space-y-3 overflow-auto bg-background p-3 text-xs ${R.panel} shadow-xl ring-1 ring-border`}>
      <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
        <span className="text-muted-foreground">행사</span>
        <select value={line.groupId ?? ""} onChange={(e) => onPatch({ groupId: e.target.value || null })} className={`${FIELD_CLS} h-7 text-xs`}>
          <option value="">없음(기타)</option>
          {active.map((g) => <option key={g.id} value={g.id}>{g.name}{g.archived ? " (보관)" : ""}</option>)}
        </select>
        <span className="text-muted-foreground">분류</span>
        <input list="worklog-categories" defaultValue={line.category} placeholder="운영·콘텐츠…"
          onBlur={(e) => { if (e.target.value.trim() !== line.category) onPatch({ category: e.target.value.trim() }); }}
          className={`${FIELD_CLS} h-7 text-xs`} />
        <span className="text-muted-foreground">결과</span>
        <input defaultValue={line.result} placeholder="결과 및 산출물(링크·수치)"
          onBlur={(e) => { if (e.target.value.trim() !== line.result) onPatch({ result: e.target.value.trim() }); }}
          className={`${FIELD_CLS} h-7 text-xs`} />
        <span className="text-muted-foreground">비고</span>
        <input defaultValue={line.note} placeholder="금주 목표 비고"
          onBlur={(e) => { if (e.target.value.trim() !== line.note) onPatch({ note: e.target.value.trim() }); }}
          className={`${FIELD_CLS} h-7 text-xs`} />
      </div>
      <datalist id="worklog-categories">{WORK_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>

      <div className="space-y-1.5">
        <div className="text-muted-foreground">옮기기</div>
        <div className="flex flex-wrap gap-1">
          {quick.map(([label, row]) => (
            <button key={label} onClick={() => onMove(row)} disabled={(line.date ?? SOMEDAY) === row}
              className={`bg-secondary px-2 py-1 hover:bg-secondary/70 disabled:opacity-40 ${R.control}`}>{label}</button>
          ))}
          <input type="date" defaultValue={line.date ?? ""} onChange={(e) => { if (e.target.value) onMove(e.target.value); }}
            className={`${FIELD_CLS} h-7 w-[130px] text-xs`} aria-label="날짜 고르기" />
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          <span className="shrink-0 text-muted-foreground">담당</span>
          <select value={line.common ? "" : line.authorId} onChange={(e) => { if (e.target.value) onAssign(e.target.value); }} className={`${FIELD_CLS} h-7 min-w-0 flex-1 text-xs`} aria-label="담당자">
            {line.common && <option value="">공통</option>}
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {canCommon && (
          <button onClick={onToggleCommon} className={`bg-secondary px-2 py-1 hover:bg-secondary/70 ${R.control}`}>
            {line.common ? "내 칸으로" : "공통 칸으로"}
          </button>
        )}
      </div>

      <div className="flex justify-end border-t border-border pt-2">
        <button onClick={onRemove} className="flex items-center gap-1 rounded px-2 py-1 text-red-500 hover:bg-red-500/10">
          <Trash2 className="h-3 w-3" />지우기
        </button>
      </div>
    </div>,
    document.body,
  );
}

function PeoplePicker({ cols, visible, onChange, onClose }: {
  cols: Array<{ key: string; label: string; mine?: boolean }>;
  visible: string[] | null;
  onChange: (next: string[] | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [onClose]);
  const on = (key: string) => !visible || visible.includes(key);
  const toggle = (key: string) => {
    const current = visible ?? cols.map((c) => c.key);
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    onChange(next.length === 0 || next.length === cols.length ? null : next);
  };
  const me = cols.find((c) => c.mine);
  return (
    <div ref={ref} className={`absolute left-0 top-full z-40 mt-1 w-56 space-y-1 bg-background p-2 text-xs shadow-xl ring-1 ring-border ${R.panel}`}>
      <div className="flex gap-1 pb-1">
        <button onClick={() => onChange(null)} className={`flex-1 bg-secondary px-2 py-1 hover:bg-secondary/70 ${R.control}`}>전체</button>
        {me && <button onClick={() => onChange([me.key])} className={`flex-1 bg-secondary px-2 py-1 hover:bg-secondary/70 ${R.control}`}>나만</button>}
        {me && <button onClick={() => onChange([COMMON, me.key])} className={`flex-1 bg-secondary px-2 py-1 hover:bg-secondary/70 ${R.control}`}>공통+나</button>}
      </div>
      <div className="max-h-72 overflow-auto">
        {cols.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-secondary/60">
            <input type="checkbox" checked={on(c.key)} onChange={() => toggle(c.key)} className="accent-violet-500" />
            <span className="truncate">{c.label}</span>
            {c.mine && <span className="text-[10px] text-violet-500">나</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`px-2.5 py-1 text-xs transition-colors ${R.control} ${on ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-secondary px-1 font-sans text-[10px]">{children}</kbd>;
}
