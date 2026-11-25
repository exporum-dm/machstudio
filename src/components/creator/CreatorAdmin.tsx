"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageTabs } from "@/components/ui/page-layout";
import { getPublicAppOrigin } from "@/lib/app-url";
import type { CreatorView } from "@/lib/creator/types";
import type { CreatorAction } from "@/lib/creator/model";
import { CandidateGrid } from "./CandidateGrid";
import { Applicants, CreatorSettings } from "./Recruitment";
import { Announcements, People } from "./People";
import { Dashboard, Missions } from "./Operations";
import { button, Empty } from "./ui";

const tabs = [
  { id: "dashboard", label: "대시보드" }, { id: "candidates", label: "발굴 후보" },
  { id: "applications", label: "신청서" }, { id: "people", label: "선발자" },
  { id: "missions", label: "미션" }, { id: "announcements", label: "발표·임베드" },
  { id: "settings", label: "설정" },
] as const;

type Tab = (typeof tabs)[number]["id"];

export function CreatorAdmin({ programId, projectName }: { programId: string; projectName: string }) {
  const [data, setData] = useState<CreatorView | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [saved, setSaved] = useState(false);
  const sequence = useRef(0);
  const api = "/api/creators/" + programId;
  const origin = getPublicAppOrigin();

  const load = useCallback(async () => {
    const seq = ++sequence.current;
    const response = await fetch(api, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "불러오지 못했어요.");
    if (seq === sequence.current) setData(result);
  }, [api]);

  const refresh = useCallback(async () => {
    setError("");
    try { await load(); }
    catch (error) { setError(error instanceof Error ? error.message : "불러오지 못했어요."); }
  }, [load]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  async function save(action: CreatorAction) {
    setPending((count) => count + 1);
    setError("");
    try {
      const response = await fetch(api, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "저장하지 못했어요.");
      setSaved(true);
      try {
        await load();
        if (action.action === "unselect") {
          setTab("applications");
          toast.success("신청서 목록으로 돌려보냈어요.");
        }
      } catch { setError("저장했어요. 새로고침하면 최신 내용을 불러올 수 있어요."); }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "저장하지 못했어요.";
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setPending((count) => count - 1);
    }
  }

  function copy(value: string) {
    void navigator.clipboard.writeText(value).then(() => toast.success("복사했어요.")).catch(() => toast.error("복사하지 못했어요."));
  }

  const program = data?.program;
  return <div className="mx-auto grid w-full min-w-0 max-w-7xl gap-5 p-4 sm:p-8">
    <PageHeader
      title={program?.name ?? "크리에이터 관리"}
      context={projectName}
      back={{ href: "/creators", label: "회차 목록" }}
      actions={data && <div className="flex items-center gap-2" aria-live="polite">
        <span className="text-xs text-muted-foreground">{pending ? "저장 중…" : saved ? <><Check className="mr-1 inline size-3" />저장됨</> : ""}</span>
        <button className={button} onClick={() => void refresh()} aria-label="최신 내역 불러오기"><RefreshCw className="size-4" /></button>
      </div>}
    />
    {error && <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
    {data && program ? <>
      <PageTabs label="크리에이터 관리 메뉴" value={tab} onChange={setTab} options={tabs} />
      {tab === "dashboard" && <Dashboard data={data} program={program} programId={programId} origin={origin} save={save} copy={copy} />}
      {tab === "candidates" && <CandidateGrid program={program} applications={data.applications} origin={origin} save={save} copy={copy} />}
      {tab === "applications" && <Applicants program={program} applications={data.applications} labels={data.applicationLabels} save={save} />}
      {tab === "people" && <People program={program} applications={data.applications} labels={data.applicationLabels} origin={origin} programId={programId} save={save} copy={copy} />}
      {tab === "missions" && <Missions program={program} save={save} origin={origin} copy={copy} />}
      {tab === "announcements" && <Announcements key={program.applicationSourceId ?? "unlinked"} program={program} projectName={projectName}
        labels={data.applicationLabels} applications={data.applications} origin={origin} save={save} copy={copy} />}
      {tab === "settings" && <CreatorSettings key={program.applicationSourceId ?? "unlinked"} program={program} sources={data.sources} origin={origin} save={save} copy={copy} />}
    </> : error ? <button className={button + " justify-self-start"} onClick={() => void refresh()}>다시 불러오기</button>
      : <Empty>회차를 불러오는 중이에요.</Empty>}
  </div>;
}
