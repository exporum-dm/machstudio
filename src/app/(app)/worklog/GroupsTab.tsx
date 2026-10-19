"use client";

/**
 * 행사 관리 — 주간 보고의 "행사" 줄. 표에서 바로 고친다(칸을 벗어나면 저장).
 * 프로젝트를 이으면 주간 보고에 그 프로젝트의 전주 숫자(사전등록·광고)가 붙는다.
 * 끝난 행사는 지우지 말고 "보관" — 지난 일지가 그 행사를 가리키고 있다.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { defaultReportDate, kstToday, orderGroupsForReport } from "@/lib/worklog";
import type { WorkGroupDto } from "./types";

export default function GroupsTab({ workspaceId, groups, onChange }: { workspaceId: string; groups: WorkGroupDto[]; onChange: (groups: WorkGroupDto[]) => void }) {
  const { projects } = useWorkspace();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  // 주간 보고와 같은 순서로 보여 준다 — 행사 날짜가 가까운 순(날짜 없는 행사·지난 행사는 아래).
  const sorted = orderGroupsForReport(groups, defaultReportDate(kstToday()));
  // 화살표는 날짜 없는 행사끼리만 의미가 있다(날짜 있는 행사는 날짜순으로 자리가 정해진다).
  const manual = sorted.filter((g) => !g.startDate);

  const call = async (method: string, body?: unknown, qs = "") => {
    const res = await fetch(`/api/worklog/groups${qs}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "저장하지 못했어요"); return null; }
    return data;
  };

  const seed = async () => {
    const data = await call("POST", { workspaceId, seed: true });
    if (data) { onChange(data.groups); toast.success("주간업무보고 양식의 행사를 불러왔어요 — 날짜·프로젝트를 확인해 주세요"); }
  };
  const add = async () => {
    if (!name.trim()) return;
    const data = await call("POST", { workspaceId, name });
    if (data) { onChange([...groups, data.group]); setName(""); }
  };
  const patch = async (group: WorkGroupDto, body: Partial<WorkGroupDto>) => {
    onChange(groups.map((g) => (g.id === group.id ? { ...g, ...body } : g)));
    const data = await call("PATCH", { id: group.id, ...body });
    if (data) onChange(groups.map((g) => (g.id === group.id ? data.group : g)));
  };
  const move = async (group: WorkGroupDto, dir: -1 | 1) => {
    const index = manual.findIndex((g) => g.id === group.id);
    const a = manual[index];
    const b = manual[index + dir];
    if (!a || !b) return;
    onChange(groups.map((g) => (g.id === a.id ? { ...g, sortOrder: b.sortOrder } : g.id === b.id ? { ...g, sortOrder: a.sortOrder } : g)));
    await Promise.all([call("PATCH", { id: a.id, sortOrder: b.sortOrder }), call("PATCH", { id: b.id, sortOrder: a.sortOrder })]);
  };
  const remove = async (group: WorkGroupDto) => {
    const ok = await confirm({
      title: `'${group.name}' 행사를 지울까요?`,
      description: "이 행사로 적은 일지는 남고 '기타'로 옮겨져요. 끝난 행사라면 지우지 말고 보관을 권해요.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!ok) return;
    if (await call("DELETE", undefined, `?id=${group.id}`)) onChange(groups.filter((g) => g.id !== group.id));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">주간 보고는 <b className="font-medium text-foreground">행사 날짜가 가까운 순서</b>로 자동 정렬돼요(이번 주에 끝난 행사는 위, 지난 행사·날짜 없는 행사는 아래 — 끝난 행사는 다음 회차 날짜로 바꾸거나 보관해 주세요). <b className="font-medium text-foreground">머리표</b>는 일지에 쓰는 줄임말이에요 — 일지에 <code className="rounded bg-secondary px-1">[코엑] 할 일</code> 로 적으면 그 행사로 들어가요. 프로젝트를 이으면 전주 사전등록·광고 숫자가 함께 붙어요.</p>
      {groups.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-8 text-center">
          <p className="text-sm text-muted-foreground">아직 행사가 없어요</p>
          <button onClick={() => void seed()} className={`flex items-center gap-1 bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 ${R.control}`}>
            <Download className="h-3 w-3" />주간업무보고 양식의 행사 불러오기
          </button>
          <p className="text-[11px] text-muted-foreground">X-Space · 코리아 엑스포 LA/도쿄/파리 · STK · 인디뷰티 서울 등 11개</p>
        </div>
      )}
      {sorted.length > 0 && (
        <div className={`divide-y divide-border overflow-hidden bg-background ${R.panel} ${FINISH.s1}`}>
          <div className="hidden grid-cols-[48px_minmax(0,1.4fr)_minmax(0,1fr)_130px_130px_minmax(0,1fr)_64px_28px] gap-2 bg-secondary/40 px-3 py-2 text-[11px] font-medium text-muted-foreground md:grid">
            <span>순서</span><span>행사</span><span>머리표(쉼표로)</span><span>시작</span><span>종료</span><span>이어진 프로젝트(지표)</span><span>보관</span><span />
          </div>
          {sorted.map((g, i) => (
            <div key={g.id} className={`grid grid-cols-2 gap-2 px-3 py-2 md:grid-cols-[48px_minmax(0,1.4fr)_minmax(0,1fr)_130px_130px_minmax(0,1fr)_64px_28px] md:items-center ${g.archived ? "opacity-60" : ""}`}>
              <div className="flex gap-0.5">
                {g.startDate ? (
                  <span className="px-0.5 text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
                ) : (
                  <>
                    <button onClick={() => void move(g, -1)} disabled={manual[0]?.id === g.id} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="위로"><ChevronUp className="h-3.5 w-3.5" /></button>
                    <button onClick={() => void move(g, 1)} disabled={manual.at(-1)?.id === g.id} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="아래로"><ChevronDown className="h-3.5 w-3.5" /></button>
                  </>
                )}
              </div>
              <input defaultValue={g.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.name) void patch(g, { name: v }); }}
                className={`${FIELD_CLS} col-span-2 h-8 text-xs md:col-span-1`} aria-label="행사 이름" />
              <input key={g.aliases.join(",")} defaultValue={g.aliases.join(", ")} placeholder="코엑, LA"
                onBlur={(e) => {
                  const next = e.target.value.split(",").map((s) => s.replace(/[[\]]/g, "").trim()).filter(Boolean);
                  if (next.join(",") !== g.aliases.join(",")) void patch(g, { aliases: next });
                }}
                className={`${FIELD_CLS} col-span-2 h-8 text-xs md:col-span-1`} aria-label="머리표" />
              <input type="date" value={g.startDate ?? ""} onChange={(e) => void patch(g, { startDate: e.target.value || null })} className={`${FIELD_CLS} h-8 text-xs`} aria-label="시작일" />
              <input type="date" value={g.endDate ?? ""} onChange={(e) => void patch(g, { endDate: e.target.value || null })} className={`${FIELD_CLS} h-8 text-xs`} aria-label="종료일" />
              <select value={g.projectId ?? ""} onChange={(e) => void patch(g, { projectId: e.target.value || null })} className={`${FIELD_CLS} col-span-2 h-8 text-xs md:col-span-1`} aria-label="프로젝트">
                <option value="">이어진 프로젝트 없음</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={g.archived} onChange={(e) => void patch(g, { archived: e.target.checked })} className="accent-violet-500" />
                <span className="md:hidden">보관</span>
              </label>
              <button onClick={() => void remove(g)} className="justify-self-end rounded p-1 text-muted-foreground hover:text-red-500" aria-label="지우기"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void add(); }}
          placeholder="새 행사 이름 (예: 코리아 엑스포 도쿄)" className={`${FIELD_CLS} h-8 max-w-sm flex-1 text-xs`} />
        <button onClick={() => void add()} className={`flex items-center gap-1 bg-secondary px-3 py-1.5 text-xs text-foreground hover:bg-secondary/70 ${R.control}`}>
          <Plus className="h-3 w-3" />추가
        </button>
      </div>
    </div>
  );
}
