"use client";

/**
 * 콘텐츠 캘린더 — 올릴 콘텐츠를 캘린더·보드·목록으로 본다(2026-11-02, 노션 캘린더 대체).
 *
 *  범위 : 전체(모든 프로젝트를 합친 캘린더) 또는 프로젝트 하나. ?project=
 *  보기 : 캘린더(기본) · 보드(상태별 칸반) · 목록. ?view=
 *  달   : 세 보기가 같은 달을 본다. 날짜 미정 항목은 늘 같이 보인다. ?month=
 *  필터 : 상태·채널·담당·검색 — 화면에서 거른다(한 달 치라 가볍다).
 *
 * 저장: 고치는 즉시 낙관적으로 반영하고 항목마다 순서대로 보낸다(글자는 600ms 멈추면).
 * 새 항목은 화면에서 임시 id 로 먼저 만들고, 제목이 생기는 순간 서버에 만든다. 이후 요청은 진짜 id 로.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, List, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageTabs } from "@/components/ui/page-layout";
import { Btn, Field, FieldSelect, R } from "@/components/ui/primitives";
import { InlineError } from "@/components/ui/inline-error";
import { tabUrl, useQueryTab } from "@/components/ui/use-query-tab";
import { useUndoableDelete } from "@/components/ui/use-undoable-delete";
import { useWorkspace } from "@/contexts/workspace";
import {
  CONTENT_STATUSES, EMPTY_FILTER, NO_PROJECT_COLOR, PROJECT_COLORS, assigneeOptions, campaignOptions, channelOptions, formatOptions,
  isValidMonth, kstToday, matchesFilter,
  monthGrid, monthKey, monthLabel, monthRange, shiftMonth,
  type ContentFilter, type ContentItemDto, type ContentMemberDto, type ContentRepeat,
} from "@/lib/content-calendar";
import CalendarView from "./CalendarView";
import BoardView from "./BoardView";
import ListView from "./ListView";
import ItemEditor, { type SaveMode } from "./ItemEditor";
import { FilterMenu, StatusDot } from "./parts";

const VIEWS = [
  { id: "calendar", label: "캘린더", icon: CalendarDays },
  { id: "board", label: "보드", icon: Columns3 },
  { id: "list", label: "목록", icon: List },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

const TMP = "tmp-";
const isTmp = (id: string) => id.startsWith(TMP);
const newTmpId = () => `${TMP}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const nowIso = () => new Date().toISOString();
/** 보낼 수 있는 칸만 — 화면용 칸(createdAt 등)은 빼고 */
const SENDABLE = ["projectId", "title", "date", "time", "status", "channels", "formats", "campaign", "assignees", "body", "link"] as const;
const pickSendable = (fields: Partial<ContentItemDto>) =>
  Object.fromEntries(SENDABLE.filter((k) => k in fields).map((k) => [k, fields[k]]));

export default function ContentCalendarPage() {
  const { workspace, projects, isLoading } = useWorkspace();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [view, selectView] = useQueryTab<ViewId>(VIEWS.map((v) => v.id), "calendar", "view");
  const today = kstToday();
  const monthParam = params.get("month");
  const month = isValidMonth(monthParam) ? monthParam : monthKey(today);
  const projectParam = params.get("project") ?? "all";
  const scope = projectParam === "all" || projectParam === "none" || projects.some((p) => p.id === projectParam) ? projectParam : "all";
  const setParam = (key: string, value: string) => router.replace(tabUrl(pathname, params.toString(), key, value), { scroll: false });

  const [items, setItems] = useState<ContentItemDto[]>([]);
  const [members, setMembers] = useState<ContentMemberDto[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Omit<ContentFilter, "project">>(EMPTY_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);
  const openIdRef = useRef(openId);
  useEffect(() => { openIdRef.current = openId; }, [openId]);
  const { remove } = useUndoableDelete();

  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  /** 임시 id → 서버 id. 화면의 id 는 바꾸지 않는다(열린 상세·끌기가 그대로 이어지게). */
  const realIds = useRef(new Map<string, string>());
  /** 화면용 — 서버에 만들어진 임시 항목(상세의 삭제 버튼 등) */
  const [savedTmp, setSavedTmp] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Map<string, Partial<ContentItemDto>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chains = useRef(new Map<string, Promise<void>>());
  const apiId = (id: string) => realIds.current.get(id) ?? id;
  const isUnsaved = (id: string) => isTmp(id) && !realIds.current.has(id);

  const workspaceId = workspace?.id ?? "";
  const key = `${workspaceId}:${month}`;
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!workspaceId) return;
    const seq = ++loadSeq.current;
    const weeks = monthGrid(month);
    const from = weeks[0][0];
    const to = weeks[weeks.length - 1][6];
    setError(false);
    try {
      const res = await fetch(`/api/content-calendar/items?workspaceId=${workspaceId}&from=${from}&to=${to}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (seq !== loadSeq.current) return;
      // 아직 서버에 없는 새 항목은 남긴다(저장되기 전에 달을 바꿔도 사라지지 않게)
      setItems((prev) => {
        const aliases = new Map([...realIds.current].map(([ui, real]) => [real, ui]));
        const present = new Set(prev.map(i => i.id));
        const saved = (data.items as ContentItemDto[]).map(i => {
          const ui = aliases.get(i.id);
          return ui && present.has(ui) ? { ...i, id: ui } : i;
        });
        return [...saved, ...prev.filter(i => isUnsaved(i.id))];
      });
      setMembers(data.members ?? []);
      setLoadedKey(`${workspaceId}:${month}`);
    } catch {
      if (seq === loadSeq.current) { setError(true); setLoadedKey(`${workspaceId}:${month}`); }
    }
  }, [workspaceId, month]);
  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(() => { if (!disposed) void load(); });
    return () => { disposed = true; };
  }, [load]);

  const enqueue = (id: string, task: () => Promise<void>) => {
    const next = (chains.current.get(id) ?? Promise.resolve()).then(task, task);
    chains.current.set(id, next);
    return next;
  };

  const flush = (id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    const fields = pending.current.get(id);
    if (!fields) return;
    pending.current.delete(id);
    return enqueue(id, async () => {
      if (isUnsaved(id)) {
        const item = itemsRef.current.find((i) => i.id === id);
        if (!item) return;
        if (!item.title.trim()) { pending.current.set(id, { ...fields, ...pending.current.get(id) }); return; }
        const res = await fetch("/api/content-calendar/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, ...pickSendable(item), link: item.link && /^https?:\/\//i.test(item.link) ? item.link : "" }),
        }).catch(() => null);
        const data = await res?.json().catch(() => ({}));
        if (!res?.ok) { pending.current.set(id, { ...item, ...pending.current.get(id) }); toast.error(data?.error ?? "저장하지 못했어요"); return; }
        realIds.current.set(id, data.item.id);
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, createdAt: data.item.createdAt, updatedAt: data.item.updatedAt } : i)));
        setSavedTmp((prev) => new Set(prev).add(id));
        return;
      }
      const res = await fetch("/api/content-calendar/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ id: apiId(id), ...pickSendable(fields) }),
      }).catch(() => null);
      const data = await res?.json().catch(() => ({}));
      if (!res?.ok) {
        toast.error(data?.error ?? "저장하지 못했어요 — 다시 불러올게요");
        void load();
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, updatedAt: data.item.updatedAt } : i)));
    });
  };
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });

  const patch = (id: string, fields: Partial<ContentItemDto>, mode: SaveMode = "now") => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...fields } : i)));
    // 임시 항목은 다음 저장 때 itemsRef 에서 통째로 읽으므로, 렌더 전에도 최신값이 보이게 미리 맞춘다
    itemsRef.current = itemsRef.current.map((i) => (i.id === id ? { ...i, ...fields } : i));
    if (mode === "local") return;
    pending.current.set(id, { ...pending.current.get(id), ...fields });
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    if (mode === "debounce") timers.current.set(id, setTimeout(() => flushRef.current(id), 600));
    else flush(id);
  };

  // 페이지를 떠나면 기다리던 글자 저장을 바로 보낸다
  useEffect(() => {
    const flushAll = () => { for (const id of [...pending.current.keys()]) flushRef.current(id); };
    window.addEventListener("beforeunload", flushAll);
    return () => { window.removeEventListener("beforeunload", flushAll); flushAll(); };
  }, []);

  const create = (defaults: Partial<ContentItemDto>) => {
    const { start, end } = monthRange(month);
    const date = "date" in defaults ? defaults.date ?? null : today >= start && today <= end ? today : start;
    const now = nowIso();
    const item: ContentItemDto = {
      id: newTmpId(),
      projectId: scope !== "all" && scope !== "none" ? scope : null,
      title: "", time: "", status: "waiting", channels: [], formats: [], campaign: "",
      assignees: [], body: "", link: "", sourceUrl: "", createdAt: now, updatedAt: now,
      ...defaults,
      date,
    };
    setItems((prev) => [...prev, item]);
    itemsRef.current = [...itemsRef.current, item];
    setOpenId(item.id);
  };

  const copyItem = async (id: string, requestId: string, repeat?: ContentRepeat) => {
    const template = itemsRef.current.find(i => i.id === id);
    if (!template?.title.trim()) throw new Error("콘텐츠명을 먼저 입력해주세요.");
    const sequence = loadSeq.current;
    await flush(id);
    await chains.current.get(id);
    if (isUnsaved(id)) throw new Error("원본을 먼저 저장해야 해요. 저장 상태를 확인하고 다시 시도해주세요.");
    const response = await fetch("/api/content-calendar/items", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copyFromId: apiId(id), requestId, ...pickSendable(template), ...(repeat ? { repeat } : {}) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "콘텐츠를 만들지 못했어요. 다시 시도해주세요.");
    if (repeat) {
      if (!data?.created?.length) throw new Error("반복 일정 생성 결과를 확인하지 못했어요. 다시 시도해주세요.");
      if (sequence !== loadSeq.current) return;
      if (openIdRef.current === id) setOpenId(null);
      await load();
      toast.success(`${data.count}개 반복 일정을 추가했어요`);
      return;
    }
    if (!data?.items?.length) throw new Error("복제 결과를 확인하지 못했어요. 다시 시도해주세요.");
    const added = data.items as ContentItemDto[];
    if (sequence !== loadSeq.current) return;
    const ids = new Set(added.map(i => i.id));
    setItems(prev => [...prev.filter(i => !ids.has(apiId(i.id))), ...added]);
    itemsRef.current = [...itemsRef.current.filter(i => !ids.has(apiId(i.id))), ...added];
    if (openIdRef.current === id) setOpenId(added[0].id);
    toast.success("콘텐츠를 복제했어요");
  };

  const closeEditor = () => {
    const id = openId;
    setOpenId(null);
    if (!id) return;
    flush(id);
    // 제목 없이 닫은 새 항목은 버린다
    if (isUnsaved(id) && !itemsRef.current.find((i) => i.id === id)?.title.trim()) {
      pending.current.delete(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    }
  };

  const deleteItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setOpenId(null);
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    pending.current.delete(id);
    remove({
      key: id,
      message: `"${item.title || "제목 없음"}"을(를) 지웠어요`,
      onOptimistic: () => setItems((prev) => prev.filter((i) => i.id !== id)),
      onUndo: () => setItems((prev) => [...prev, item]),
      commit: () => enqueue(id, async () => {
        if (isUnsaved(id)) return;
        const res = await fetch(`/api/content-calendar/items?id=${encodeURIComponent(apiId(id))}`, { method: "DELETE", keepalive: true }).catch(() => null);
        if (!res?.ok) { toast.error("지우지 못했어요"); void load(); }
      }),
    });
  };

  // ── 보이는 것 ──
  const colorById = useMemo(() => new Map(projects.map((p, i) => [p.id, PROJECT_COLORS[i % PROJECT_COLORS.length]])), [projects]);
  const nameById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const projectColor = (id: string | null) => (id ? colorById.get(id) ?? NO_PROJECT_COLOR : NO_PROJECT_COLOR);
  const projectName = (id: string | null) => (id ? nameById.get(id) ?? "프로젝트" : "프로젝트 없음");

  const { start: mStart, end: mEnd } = monthRange(month);
  const fullFilter: ContentFilter = { ...filter, project: scope };
  const scoped = items.filter((i) => scope === "all" || (i.projectId ?? "none") === scope);
  const visible = items.filter((i) => matchesFilter(i, fullFilter));
  // 보드·목록은 이 달 + 날짜 미정(캘린더는 앞뒤 달 칸도 보여 주므로 그대로)
  const inMonth = visible.filter((i) => !i.date || (i.date >= mStart && i.date <= mEnd));
  const filterActive = filter.statuses.length + filter.channels.length + filter.formats.length + filter.campaigns.length + filter.assignees.length > 0
    || filter.query.trim() !== "";
  const known = { channels: channelOptions(items), formats: formatOptions(items), campaigns: campaignOptions(items) };
  const opened = openId ? items.find((i) => i.id === openId) ?? null : null;

  const viewProps = {
    projectName, projectColor, showProject: scope === "all",
    onOpen: setOpenId, onCreate: create, onPatch: (id: string, fields: Partial<ContentItemDto>) => patch(id, fields),
  };

  if (isLoading || !workspace) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="콘텐츠 캘린더"
        context={workspace.name}
        description="올릴 콘텐츠를 날짜에 놓고, 보드·목록으로도 봅니다."
        actions={<Btn tone="key" onClick={() => create({})}><Plus className="h-4 w-4" aria-hidden />새 콘텐츠</Btn>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="w-full sm:w-56">
          <span className="sr-only">프로젝트</span>
          <FieldSelect value={scope} onChange={(e) => setParam("project", e.target.value)}>
            <option value="all">전체 프로젝트</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="none">프로젝트 없음</option>
          </FieldSelect>
        </label>
        <PageTabs label="보기" value={view} onChange={selectView} options={VIEWS} sticky={false} className="!py-0" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="이전 달" onClick={() => setParam("month", shiftMonth(month, -1))} className={`inline-flex h-9 w-9 items-center justify-center hover:bg-secondary ${R.control}`}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
          <h2 className="min-w-28 text-center text-base font-semibold tabular-nums">{monthLabel(month)}</h2>
          <button type="button" aria-label="다음 달" onClick={() => setParam("month", shiftMonth(month, 1))} className={`inline-flex h-9 w-9 items-center justify-center hover:bg-secondary ${R.control}`}><ChevronRight className="h-4 w-4" aria-hidden /></button>
          {month !== monthKey(today) && <Btn tone="ghost" onClick={() => setParam("month", monthKey(today))} className="!min-h-8 !px-2 text-xs">오늘</Btn>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterMenu
            label="상태"
            value={filter.statuses}
            onChange={(statuses) => setFilter((f) => ({ ...f, statuses }))}
            options={CONTENT_STATUSES.map((s) => ({ value: s.id, label: <span className="inline-flex items-center gap-1.5"><StatusDot status={s.id} />{s.label}</span> }))}
          />
          <FilterMenu
            label="캠페인"
            value={filter.campaigns}
            onChange={(campaigns) => setFilter((f) => ({ ...f, campaigns }))}
            options={[...known.campaigns.map((c) => ({ value: c, label: c })), { value: "none", label: "캠페인 없음" }]}
          />
          <FilterMenu label="형식" value={filter.formats} onChange={(formats) => setFilter((f) => ({ ...f, formats }))} options={known.formats.map((c) => ({ value: c, label: c }))} />
          <FilterMenu label="플랫폼" value={filter.channels} onChange={(channels) => setFilter((f) => ({ ...f, channels }))} options={known.channels.map((c) => ({ value: c, label: c }))} />
          <FilterMenu
            label="담당"
            value={filter.assignees}
            onChange={(assignees) => setFilter((f) => ({ ...f, assignees }))}
            options={[...assigneeOptions(items, members), { value: "none", label: "담당 없음" }]}
          />
          <label className="relative w-full sm:w-44">
            <span className="sr-only">검색</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Field type="search" value={filter.query} onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))} placeholder="검색" className="pl-9" />
          </label>
          {filterActive && (
            <Btn tone="ghost" onClick={() => setFilter(EMPTY_FILTER)} className="!min-h-8 !px-2 text-xs"><X className="h-3.5 w-3.5" aria-hidden />필터 해제</Btn>
          )}
        </div>
      </div>

      {error && <InlineError message="콘텐츠를 불러오지 못했어요" onRetry={load} />}
      {loadedKey !== key ? (
        !error && <div className="flex h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {filterActive && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {scoped.length.toLocaleString()}개 중 {visible.length.toLocaleString()}개가 필터에 맞아요
            </p>
          )}
          {view === "calendar" && <CalendarView {...viewProps} items={visible} month={month} today={today} />}
          {view === "board" && <BoardView {...viewProps} items={inMonth} />}
          {view === "list" && <ListView {...viewProps} items={inMonth} />}
        </>
      )}

      {opened && (
        <ItemEditor
          key={opened.id}
          item={opened}
          isNew={isTmp(opened.id) && !savedTmp.has(opened.id)}
          projects={projects}
          members={members}
          known={known}
          onChange={(fields, mode) => patch(opened.id, fields, mode)}
          onCopy={(requestId, repeat) => copyItem(opened.id, requestId, repeat)}
          onClose={closeEditor}
          onDelete={() => deleteItem(opened.id)}
        />
      )}
    </div>
  );
}
