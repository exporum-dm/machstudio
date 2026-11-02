"use client";

/**
 * 업무일지 — 매일 한 일을 적으면 주간업무보고가 자동으로 써진다(2026-10-17).
 *
 *  일지      : 날짜·행사·분류·내역·상태·결과를 한 줄씩. 표에서 바로 고친다.
 *  주간 보고 : DM 주간 업무 보고 시트와 같은 표 — 엑셀로 받아 회사 양식에 붙이거나 글로 복사.
 *  행사 관리 : 보고서의 "행사" 줄(이름·기간·이어진 프로젝트·순서).
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { CalendarDays, FileSpreadsheet, Loader2, NotebookPen } from "lucide-react";
import { PageHeader, PageTabs } from "@/components/ui/page-layout";
import { useQueryTab } from "@/components/ui/use-query-tab";
import { InlineError } from "@/components/ui/inline-error";
import { useWorkspace } from "@/contexts/workspace";
import JournalTab from "./JournalTab";
import ReportTab from "./ReportTab";
import GroupsTab from "./GroupsTab";
import type { WorkGroupDto } from "./types";

const TABS = [
  { id: "journal", label: "일지", icon: NotebookPen },
  { id: "report", label: "주간 보고", icon: FileSpreadsheet },
  { id: "groups", label: "행사 관리", icon: CalendarDays },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function WorklogPage() {
  const { workspace, isLoading } = useWorkspace();
  const [tab, select] = useQueryTab<TabId>(TABS.map(t => t.id), "journal");
  const requestSequence = useRef(0);
  const [loadedWorkspace, setLoadedWorkspace] = useState("");
  const [error, setError] = useState(false);
  const [groups, setGroups] = useState<WorkGroupDto[] | null>(null);

  const loadGroups = useCallback(async () => {
    if (!workspace) return;
    const sequence = ++requestSequence.current;
    setError(false);
    try {
      const res = await fetch(`/api/worklog/groups?workspaceId=${workspace.id}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (sequence !== requestSequence.current) return;
      setGroups(data.groups ?? []);
      setLoadedWorkspace(workspace.id);
    } catch { if (sequence === requestSequence.current) { setError(true); setLoadedWorkspace(workspace.id); } }
  }, [workspace]);
  useEffect(() => {
    const sequence = requestSequence;
    let disposed = false;
    void Promise.resolve().then(() => { if (!disposed) void loadGroups(); });
    return () => { disposed = true; sequence.current++; };
  }, [loadGroups]);

  if (isLoading || !workspace) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader title="업무일지" context={workspace.name} description="매일 한 일을 적고 주간 보고로 모읍니다." />
      <PageTabs label="업무일지" value={tab} onChange={select} options={TABS} />
      {error && <InlineError message="행사 목록을 불러오지 못했어요" onRetry={loadGroups} />}
      {groups === null || loadedWorkspace !== workspace.id ? (
        !error && <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {tab === "journal" && <JournalTab workspaceId={workspace.id} groups={groups} onGoGroups={() => select("groups")} />}
          {tab === "report" && <ReportTab workspaceId={workspace.id} hasGroups={groups.length > 0} />}
          {tab === "groups" && <GroupsTab workspaceId={workspace.id} groups={groups} onChange={setGroups} />}
        </>
      )}
    </div>
  );
}
