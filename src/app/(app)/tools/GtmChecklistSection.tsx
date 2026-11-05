"use client";

/**
 * 프로젝트별 GTM 설치 체크리스트 — 엑셀 "이벤트 택소노미" 시트를 대체한다(2026-11-05).
 * 워크스페이스 공통 이벤트 사전(위 섹션)과 달리 프로젝트(+ Korea Expo 처럼 쇼가 여럿이면 행사)로
 * 묶이고, 이름은 자유 텍스트다. 고치는 화면이다(AGENTS §2): 값은 표에서 바로 고치고 벗어나면 저장.
 *
 * 한 프로젝트에 줄이 많아(수십 줄) 카드형 펼치기는 스크롤이 너무 길어진다 — 원래 엑셀처럼
 * 한 행 = 한 줄, 칸마다 바로 입력하는 표로 보여준다(2026-11-05, 카드형에서 교체).
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FIELD_CLS } from "@/components/ui/primitives";

interface ChecklistRow {
  id: string;
  projectId: string | null;
  groupId: string | null;
  step: number | null;
  name: string;
  trigger: string;
  triggerCondition: string;
  content: string;
  className: string;
  tagged: boolean;
  note: string;
}

interface WorkGroupOption { id: string; name: string; projectId: string | null }

// 빽빽한 표 전용 — FIELD_CLS(최소 36px·넉넉한 패딩)를 쓰면 h-7 로 줄여도 min-h-9 가 이긴다.
// 표 칸은 테두리를 TD 가 이미 그려서 칸마다 또 테두리를 두르지 않는다.
const CELL = "h-7 w-full border-0 bg-transparent px-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none";
const TH = "whitespace-nowrap border-b border-border px-1.5 py-1.5 text-left font-medium text-muted-foreground";
const TD = "border-b border-border p-0 align-top";

export default function GtmChecklistSection({ workspaceId, projects }: { workspaceId: string; projects: { id: string; name: string }[] }) {
  const confirm = useConfirm();
  const [projectId, setProjectId] = useState("");
  const [allGroups, setAllGroups] = useState<WorkGroupOption[]>([]);
  const [groupId, setGroupId] = useState("");
  const [rows, setRows] = useState<ChecklistRow[] | null>(null);

  useEffect(() => {
    fetch(`/api/worklog/groups?workspaceId=${workspaceId}`).then((r) => r.json()).then((d) => setAllGroups(d.groups ?? [])).catch(() => {});
  }, [workspaceId]);

  const groupsForProject = allGroups.filter((g) => g.projectId === projectId);

  const load = useCallback(async () => {
    if (!projectId) { setRows(null); return; }
    setRows(null);
    const params = new URLSearchParams({ workspaceId, projectId, ...(groupId ? { groupId } : {}) });
    const r = await fetch(`/api/event-taxonomy?${params}`).then((r) => r.json()).catch(() => ({ events: [] }));
    setRows(r.events ?? []);
  }, [workspaceId, projectId, groupId]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const addRow = async () => {
    if (!projectId) return;
    const nextStep = Math.max(0, ...(rows ?? []).map((r) => r.step ?? 0)) + 1;
    const res = await fetch("/api/event-taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, projectId, groupId: groupId || null, name: "새 단계", step: nextStep }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "추가하지 못했어요"); return; }
    setRows((prev) => [...(prev ?? []), data.event]);
  };
  const patchRow = async (id: string, patch: Partial<ChecklistRow>) => {
    setRows((prev) => (prev ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const res = await fetch("/api/event-taxonomy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // projectId 를 항상 같이 보낸다 — 없으면 서버가 "워크스페이스 공통 사전" 검증(snake_case)으로 오해한다.
      body: JSON.stringify({ id, projectId, groupId: groupId || null, ...patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "저장하지 못했어요"); void load(); return; }
    setRows((prev) => (prev ?? []).map((x) => (x.id === id ? data.event : x)));
  };
  const removeRow = async (row: ChecklistRow) => {
    const ok = await confirm({ title: `'${row.name}' 단계를 지울까요?`, confirmLabel: "지우기", tone: "danger" });
    if (!ok) return;
    const res = await fetch(`/api/event-taxonomy?id=${row.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("지우지 못했어요"); return; }
    setRows((prev) => (prev ?? []).filter((x) => x.id !== row.id));
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">프로젝트별 GTM 설치 체크리스트</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">태그·트리거·설치 코드까지 — 프로젝트(쇼)를 골라 그 설치 과정을 기록해요.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={projectId}
          onChange={(e) => { setProjectId(e.target.value); setGroupId(""); }}
          className={`${FIELD_CLS} h-8 w-56 text-xs`}
        >
          <option value="">프로젝트를 선택해주세요</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {projectId && groupsForProject.length > 0 && (
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className={`${FIELD_CLS} h-8 w-44 text-xs`}
          >
            <option value="">전체 쇼</option>
            {groupsForProject.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>

      {!projectId ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">프로젝트를 고르면 그 설치 체크리스트가 보여요.</p>
      ) : rows === null ? (
        <div className="flex h-24 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-background">
          {rows.length === 0 ? (
            <p className="px-4 py-5 text-center text-xs text-muted-foreground">아직 등록한 단계가 없어요</p>
          ) : (
            <table className="w-full min-w-[1100px] table-fixed border-collapse">
              <thead>
                <tr className="bg-secondary/40">
                  <th className={`${TH} w-12`}>단계</th>
                  <th className={`${TH} w-40`}>이름</th>
                  <th className={`${TH} w-40`}>트리거</th>
                  <th className={`${TH} w-40`}>트리거 조건</th>
                  <th className={`${TH} w-64`}>내용</th>
                  <th className={`${TH} w-32`}>class명</th>
                  <th className={`${TH} w-14 text-center`}>태깅</th>
                  <th className={`${TH} w-40`}>비고</th>
                  <th className={`${TH} w-10 text-center`}>삭제</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ChecklistTableRow
                    key={row.id}
                    row={row}
                    onPatch={(patch) => void patchRow(row.id, patch)}
                    onRemove={() => void removeRow(row)}
                  />
                ))}
              </tbody>
            </table>
          )}
          <div className="flex items-center gap-2 border-t border-border p-2">
            <button onClick={() => void addRow()} className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-600">
              <Plus className="h-3 w-3" />단계 추가
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ChecklistTableRow({
  row, onPatch, onRemove,
}: {
  row: ChecklistRow;
  onPatch: (patch: Partial<ChecklistRow>) => void;
  onRemove: () => void;
}) {
  return (
    <tr className="hover:bg-secondary/20">
      <td className={TD}>
        <input
          type="number"
          defaultValue={row.step ?? ""}
          onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== row.step) onPatch({ step: v }); }}
          className={CELL}
          aria-label="단계"
        />
      </td>
      <td className={TD}>
        <input defaultValue={row.name} onBlur={(e) => { if (e.target.value !== row.name) onPatch({ name: e.target.value }); }} className={CELL} aria-label="이름" />
      </td>
      <td className={TD}>
        <input defaultValue={row.trigger} onBlur={(e) => { if (e.target.value !== row.trigger) onPatch({ trigger: e.target.value }); }} className={CELL} aria-label="트리거" />
      </td>
      <td className={TD}>
        <input defaultValue={row.triggerCondition} onBlur={(e) => { if (e.target.value !== row.triggerCondition) onPatch({ triggerCondition: e.target.value }); }} className={`${CELL} font-mono`} aria-label="트리거 조건" />
      </td>
      <td className={TD}>
        <input defaultValue={row.content} onBlur={(e) => { if (e.target.value !== row.content) onPatch({ content: e.target.value }); }} className={`${CELL} font-mono`} aria-label="내용" />
      </td>
      <td className={TD}>
        <input defaultValue={row.className} onBlur={(e) => { if (e.target.value !== row.className) onPatch({ className: e.target.value }); }} className={`${CELL} font-mono`} aria-label="class명" />
      </td>
      <td className={`${TD} text-center`}>
        <input type="checkbox" checked={row.tagged} onChange={(e) => onPatch({ tagged: e.target.checked })} className="accent-violet-500" aria-label="태깅 완료" />
      </td>
      <td className={TD}>
        <input defaultValue={row.note} onBlur={(e) => { if (e.target.value !== row.note) onPatch({ note: e.target.value }); }} className={CELL} aria-label="비고" />
      </td>
      <td className={`${TD} text-center`}>
        <button onClick={onRemove} className="rounded p-1 text-muted-foreground transition-colors hover:text-red-500" aria-label={`${row.name} 지우기`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}
