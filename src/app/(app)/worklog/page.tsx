"use client";

/**
 * 업무일지 — 매일 한 일을 적으면 주간업무보고가 자동으로 써진다(2026-10-17).
 *
 *  일지      : 날짜·행사·분류·내역·상태·결과를 한 줄씩. 표에서 바로 고친다.
 *  주간 보고 : DM 주간 업무 보고 시트와 같은 표 — 엑셀로 받아 회사 양식에 붙이거나 글로 복사.
 *  행사 관리 : 보고서의 "행사" 줄(이름·기간·이어진 프로젝트·순서).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { CalendarDays, FileSpreadsheet, Loader2, NotebookPen } from "lucide-react";
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
const spring = { type: "spring" as const, stiffness: 420, damping: 34 };

export default function WorklogPage() {
  const { workspace, isLoading } = useWorkspace();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>(() => TABS.find((t) => t.id === searchParams.get("tab"))?.id ?? "journal");
  const [groups, setGroups] = useState<WorkGroupDto[] | null>(null);

  const loadGroups = useCallback(async () => {
    if (!workspace) return;
    const res = await fetch(`/api/worklog/groups?workspaceId=${workspace.id}`);
    const data = await res.json().catch(() => ({}));
    setGroups(res.ok ? data.groups ?? [] : []);
  }, [workspace]);
  useEffect(() => { void Promise.resolve().then(loadGroups); }, [loadGroups]);

  const select = (id: TabId) => {
    setTab(id);
    router.replace(`/worklog?tab=${id}`, { scroll: false });
  };

  if (isLoading || !workspace) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold">업무일지</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">매일 한 일을 적어 두면 주간업무보고가 자동으로 써져요 · {workspace.name}</p>
      </div>
      <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-border bg-background">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => select(id)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${active ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />
              {label}
              {active && <motion.span layoutId="worklog-tab" transition={spring} className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-violet-500" />}
            </button>
          );
        })}
      </div>
      {groups === null ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
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
