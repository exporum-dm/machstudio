"use client";

/**
 * 일지 — 한 주(월~일)씩 본다. 맨 위 입력 줄에 적고 Enter, 아래 표에서 바로 고친다.
 * 행사·분류는 직전에 고른 값을 이어 쓴다 — 하루에 같은 행사 일을 여러 줄 적는 게 보통이다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { WORK_CATEGORIES, WORK_STATUSES, WORK_STATUS_LABEL, kstToday, shiftDay, weekOf, type WorkStatus } from "@/lib/worklog";
import type { WorkEntryDto, WorkGroupDto } from "./types";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEKDAY[d.getUTCDay()]})`;
};
const STATUS_TONE: Record<WorkStatus, string> = {
  done: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  doing: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  planned: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export default function JournalTab({ workspaceId, groups, onGoGroups }: { workspaceId: string; groups: WorkGroupDto[]; onGoGroups: () => void }) {
  const confirm = useConfirm();
  const today = kstToday();
  const [weekStart, setWeekStart] = useState(() => weekOf(today).start);
  const [mine, setMine] = useState(true);
  const [entries, setEntries] = useState<WorkEntryDto[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const weekEnd = shiftDay(weekStart, 6);
  const activeGroups = useMemo(() => groups.filter((g) => !g.archived), [groups]);

  const [draft, setDraft] = useState({ date: today, groupId: "", category: "", content: "", status: "done" as WorkStatus, result: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setEntries(null);
    const res = await fetch(`/api/worklog/entries?workspaceId=${workspaceId}&from=${weekStart}&to=${weekEnd}${mine ? "&mine=1" : ""}`);
    const data = await res.json().catch(() => ({}));
    setEntries(res.ok ? data.entries ?? [] : []);
    if (res.ok) { setMe(data.me); setIsAdmin(!!data.isAdmin); }
  }, [workspaceId, weekStart, weekEnd, mine]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const moveWeek = (days: number) => {
    const next = shiftDay(weekStart, days);
    setWeekStart(next);
    // 입력 날짜도 그 주 안으로 — 이번 주면 오늘, 아니면 그 주 월요일.
    setDraft((d) => ({ ...d, date: weekOf(today).start === next ? today : next }));
  };

  const add = async () => {
    if (!draft.content.trim()) { toast.error("내역을 입력해주세요"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/worklog/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, ...draft, groupId: draft.groupId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "저장하지 못했어요"); return; }
      if (data.entry.date >= weekStart && data.entry.date <= weekEnd) setEntries((prev) => [...(prev ?? []), data.entry]);
      else toast.success(`${dayLabel(data.entry.date)}에 저장했어요`);
      // 행사·분류·상태는 남긴다 — 같은 행사 일을 이어서 적는 게 보통이다.
      setDraft((d) => ({ ...d, content: "", result: "" }));
    } finally {
      setSaving(false);
    }
  };

  const patch = async (entry: WorkEntryDto, body: Partial<WorkEntryDto>) => {
    setEntries((prev) => (prev ?? []).map((e) => (e.id === entry.id ? { ...e, ...body } : e)));
    const res = await fetch("/api/worklog/entries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "저장하지 못했어요"); void load(); return; }
    setEntries((prev) => {
      const list = prev ?? [];
      // 날짜를 다른 주로 옮겼으면 이 주 목록에서 뺀다.
      if (data.entry.date < weekStart || data.entry.date > weekEnd) return list.filter((e) => e.id !== entry.id);
      return list.map((e) => (e.id === entry.id ? data.entry : e));
    });
  };

  const remove = async (entry: WorkEntryDto) => {
    const ok = await confirm({ title: "이 줄을 지울까요?", description: entry.content, confirmLabel: "지우기", tone: "danger" });
    if (!ok) return;
    const res = await fetch(`/api/worklog/entries?id=${entry.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("지우지 못했어요"); return; }
    setEntries((prev) => (prev ?? []).filter((e) => e.id !== entry.id));
  };

  const byDay = useMemo(() => {
    const map = new Map<string, WorkEntryDto[]>();
    for (const e of entries ?? []) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);
  const thisWeek = weekOf(today).start === weekStart;

  return (
    <div className="space-y-4">
      {/* 주 이동 · 보기 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => moveWeek(-7)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary" aria-label="지난주"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[150px] text-center text-sm font-medium tabular-nums">{dayLabel(weekStart)} – {dayLabel(weekEnd)}</span>
          <button onClick={() => moveWeek(7)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary" aria-label="다음주"><ChevronRight className="h-4 w-4" /></button>
          {!thisWeek && <button onClick={() => moveWeek(Math.round((Date.parse(weekOf(today).start) - Date.parse(weekStart)) / 86_400_000))} className="ml-1 rounded-lg px-2 py-1 text-xs text-violet-500 hover:bg-violet-500/10">이번 주</button>}
        </div>
        <div className="flex gap-0.5">
          {([[true, "내 일지"], [false, "팀 전체"]] as const).map(([v, label]) => (
            <button key={label} onClick={() => setMine(v)}
              className={`px-2.5 py-1 text-xs transition-colors ${R.control} ${mine === v ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeGroups.length === 0 && (
        <p className={`bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 ${R.control}`}>
          아직 행사가 없어요 — 주간 보고는 행사별로 묶여요. <button onClick={onGoGroups} className="font-medium underline">행사 관리</button>에서 먼저 만들거나 불러와 주세요.
        </p>
      )}

      {/* 입력 줄 */}
      <div className={`space-y-2 bg-background p-3 ${R.panel} ${FINISH.s1}`}>
        <div className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)_120px]">
          <input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} className={`${FIELD_CLS} h-8 text-xs`} aria-label="날짜" />
          <select value={draft.groupId} onChange={(e) => setDraft((d) => ({ ...d, groupId: e.target.value }))} className={`${FIELD_CLS} h-8 text-xs`} aria-label="행사">
            <option value="">행사 고르기 (없으면 기타)</option>
            {activeGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <input list="worklog-categories" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            placeholder="분류" className={`${FIELD_CLS} h-8 text-xs`} aria-label="분류" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={draft.content} onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void add(); }}
            placeholder="한 일 / 할 일 (Enter로 저장)" className={`${FIELD_CLS} h-9 min-w-0 flex-1 text-sm`} aria-label="내역" />
          <div className="flex shrink-0 gap-0.5">
            {WORK_STATUSES.map((s) => (
              <button key={s} onClick={() => setDraft((d) => ({ ...d, status: s }))}
                className={`px-2.5 py-1.5 text-xs transition-colors ${R.control} ${draft.status === s ? STATUS_TONE[s] + " font-medium" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                {WORK_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={draft.result} onChange={(e) => setDraft((d) => ({ ...d, result: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void add(); }}
            placeholder="결과 및 산출물 (선택 — 링크, 수치)" className={`${FIELD_CLS} h-8 min-w-0 flex-1 text-xs`} aria-label="결과" />
          <button onClick={() => void add()} disabled={saving}
            className={`flex shrink-0 items-center justify-center gap-1 bg-violet-500 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50 ${R.control}`}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}적기
          </button>
        </div>
        <datalist id="worklog-categories">{WORK_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
      </div>

      {/* 목록 */}
      {entries === null ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : byDay.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">이 주에 적은 일지가 없어요</div>
      ) : (
        byDay.map(([day, list]) => (
          <section key={day} className="space-y-1.5">
            <h3 className="text-xs font-semibold text-muted-foreground">{dayLabel(day)}{day === today && <span className="ml-1.5 text-violet-500">오늘</span>}</h3>
            <div className={`divide-y divide-border overflow-hidden bg-background ${R.panel} ${FINISH.s1}`}>
              {list.map((entry) => (
                <EntryRow key={entry.id} entry={entry} groups={groups} editable={entry.authorId === me || isAdmin} showAuthor={!mine}
                  onPatch={(body) => void patch(entry, body)} onRemove={() => void remove(entry)} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function EntryRow({
  entry, groups, editable, showAuthor, onPatch, onRemove,
}: {
  entry: WorkEntryDto;
  groups: WorkGroupDto[];
  editable: boolean;
  showAuthor: boolean;
  onPatch: (body: Partial<WorkEntryDto>) => void;
  onRemove: () => void;
}) {
  const ro = !editable;
  return (
    <div className="grid gap-1.5 px-3 py-2 sm:grid-cols-[minmax(0,150px)_88px_minmax(0,1fr)_72px_minmax(0,0.6fr)_auto] sm:items-center">
      <select value={entry.groupId ?? ""} disabled={ro} onChange={(e) => onPatch({ groupId: e.target.value || null })} className={`${FIELD_CLS} h-7 text-xs`} aria-label="행사">
        <option value="">기타</option>
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.archived ? " (보관)" : ""}</option>)}
      </select>
      <input list="worklog-categories" defaultValue={entry.category} disabled={ro}
        onBlur={(e) => { if (e.target.value.trim() !== entry.category) onPatch({ category: e.target.value.trim() }); }}
        placeholder="분류" className={`${FIELD_CLS} h-7 text-xs`} aria-label="분류" />
      <input defaultValue={entry.content} disabled={ro}
        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== entry.content) onPatch({ content: v }); }}
        className={`${FIELD_CLS} h-7 text-xs`} aria-label="내역" />
      <select value={entry.status} disabled={ro} onChange={(e) => onPatch({ status: e.target.value as WorkStatus })}
        className={`${FIELD_CLS} h-7 text-xs ${STATUS_TONE[entry.status]}`} aria-label="상태">
        {WORK_STATUSES.map((s) => <option key={s} value={s}>{WORK_STATUS_LABEL[s]}</option>)}
      </select>
      <input defaultValue={entry.result} disabled={ro}
        onBlur={(e) => { if (e.target.value.trim() !== entry.result) onPatch({ result: e.target.value.trim() }); }}
        placeholder="결과·산출물" className={`${FIELD_CLS} h-7 text-xs`} aria-label="결과" />
      <div className="flex items-center justify-end gap-1">
        {showAuthor && <span className="whitespace-nowrap text-[11px] text-muted-foreground">{entry.authorName}</span>}
        {editable && (
          <button onClick={onRemove} className="rounded p-1 text-muted-foreground hover:text-red-500" aria-label="지우기"><Trash2 className="h-3.5 w-3.5" /></button>
        )}
      </div>
    </div>
  );
}
