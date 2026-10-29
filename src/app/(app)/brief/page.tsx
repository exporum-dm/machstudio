"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Megaphone, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";
import { Btn, FINISH, R, Segmented } from "@/components/ui/primitives";
import { api, type BriefIssueRow, type BriefItem, type BriefRow } from "@/components/brief/types";
import { PickTab } from "@/components/brief/PickTab";
import { PublicTab } from "@/components/brief/PublicTab";
import { SourcesTab } from "@/components/brief/SourcesTab";
import { MonitoringTab, OverviewTab, PressStudioTab, ReportTab, ResponseTab } from "@/components/brief/PrRoomTabs";

type Tab = "overview" | "monitor" | "response" | "studio" | "report" | "sources";
type StudioTab = "press" | "brief" | "public";
interface PresetOption { key: string; label: string; description: string; name: string }

export default function BriefPage() {
  const { currentProject } = useWorkspace();
  const projectId = currentProject?.id ?? "";
  if (!projectId) return <div className="p-6 text-sm text-muted-foreground">왼쪽에서 프로젝트를 먼저 골라주세요.</div>;
  return <PrWorkspace key={projectId} projectId={projectId} />;
}

function PrWorkspace({ projectId }: { projectId: string }) {
  const [briefs,setBriefs]=useState<BriefRow[]|null>(null); const [presets,setPresets]=useState<PresetOption[]>([]); const [creating,setCreating]=useState(false); const [canWrite,setCanWrite]=useState(false); const [briefId,setBriefId]=useState(""); const [tab,setTab]=useState<Tab>("overview"); const [studioTab,setStudioTab]=useState<StudioTab>("press");
  const [brief,setBrief]=useState<BriefRow|null>(null); const [items,setItems]=useState<BriefItem[]>([]); const [issues,setIssues]=useState<BriefIssueRow[]>([]);
  useEffect(()=>{let cancelled=false;(async()=>{try{const res=await api<{canWrite:boolean;briefs:BriefRow[];suggestedPreset:string|null;presets:PresetOption[]}>(`/api/briefs?projectId=${encodeURIComponent(projectId)}`);let list=res.briefs;const suggested=res.presets.find(p=>p.key===res.suggestedPreset);if(!list.length&&res.canWrite&&suggested){setCreating(true);const made=await api<{brief:BriefRow}>("/api/briefs",{method:"POST",body:JSON.stringify({projectId,name:suggested.name,slug:"the-action",intro:"이번 주 바로 확인해야 할 소식을 전합니다.",preset:suggested.key})});list=[made.brief];}if(cancelled)return;setBriefs(list);setPresets(res.presets);setCanWrite(res.canWrite);setBriefId(list[0]?.id??"");}catch(e){toast.error((e as Error).message);setBriefs([]);}finally{setCreating(false)}})();return()=>{cancelled=true}},[projectId]);
  const fetchDetail=useCallback(()=>api<{canWrite:boolean;brief:BriefRow;items:BriefItem[];issues:BriefIssueRow[]}>(`/api/briefs/${briefId}`),[briefId]);
  const apply=useCallback((r:Awaited<ReturnType<typeof fetchDetail>>)=>{setBrief(r.brief);setItems(r.items);setIssues(r.issues);setCanWrite(r.canWrite)},[]); const reload=useCallback(async()=>{if(briefId)apply(await fetchDetail())},[briefId,fetchDetail,apply]);
  useEffect(()=>{if(!briefId)return;let stop=false;fetchDetail().then(r=>!stop&&apply(r)).catch(e=>toast.error((e as Error).message));return()=>{stop=true}},[briefId,fetchDetail,apply]);
  const create=async(p:PresetOption|null)=>{setCreating(true);try{const r=await api<{brief:BriefRow}>("/api/briefs",{method:"POST",body:JSON.stringify(p?{projectId,name:p.name,preset:p.key,intro:"이번 주 바로 확인해야 할 소식을 전합니다."}:{projectId,name:"프로젝트 홍보실"})});setBriefs([r.brief]);setBriefId(r.brief.id);setTab(p?"overview":"sources")}catch(e){toast.error((e as Error).message)}finally{setCreating(false)}};
  return <div className="space-y-5 p-4 sm:p-6"><header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-semibold"><Megaphone className="h-5 w-5 text-violet-600"/>프로젝트 홍보실</h1><p className="mt-1 text-sm text-muted-foreground">보도·SNS 반응을 모으고, 이슈 대응부터 보도자료와 뉴스 브리프 발행까지 한곳에서 관리합니다.</p></div>{briefs&&briefs.length>1&&<select className="rounded-lg bg-card px-3 py-2 text-sm shadow-sm" value={briefId} onChange={e=>setBriefId(e.target.value)}>{briefs.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>}</header>
    <Segmented<Tab> label="홍보실 메뉴" value={tab} onChange={setTab} options={[{value:"overview",label:"상황판"},{value:"monitor",label:"모니터링"},{value:"response",label:"이슈 대응"},{value:"studio",label:"작성실"},{value:"report",label:"리포트"},{value:"sources",label:"수집 설정"}]}/>
    {!brief?(creating?<div className="flex gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>홍보실을 준비하는 중</div>:briefs?.length===0&&canWrite?<StartCard presets={presets} onPick={create}/>:<div className="text-sm text-muted-foreground">불러오는 중…</div>):tab==="overview"?<OverviewTab brief={brief} items={items} onMove={setTab}/>:tab==="monitor"?<MonitoringTab brief={brief} items={items} canWrite={canWrite} setItems={setItems}/>:tab==="response"?<ResponseTab brief={brief} items={items} canWrite={canWrite} setItems={setItems}/>:tab==="report"?<ReportTab brief={brief} items={items}/>:tab==="sources"?<SourcesTab brief={brief} canWrite={canWrite} onCollected={reload} onBriefChange={setBrief}/>:<div className="space-y-4"><Segmented<StudioTab> label="작성실 종류" value={studioTab} onChange={setStudioTab} options={[{value:"press",label:"보도자료"},{value:"brief",label:"뉴스 브리프"},{value:"public",label:"공개 화면"}]}/>{studioTab==="press"?<PressStudioTab brief={brief} canWrite={canWrite} onChange={setBrief}/>:studioTab==="brief"?<PickTab brief={brief} items={items} issues={issues} canWrite={canWrite} setItems={setItems} reload={reload} onOpenSources={()=>setTab("sources")}/>:<PublicTab brief={brief} canWrite={canWrite} onChange={setBrief} items={items}/>}</div>}
  </div>;
}

function StartCard({presets,onPick}:{presets:PresetOption[];onPick:(p:PresetOption|null)=>void}){return <section className={`${R.panel} ${FINISH.s1} max-w-xl space-y-3 bg-card p-5`}><div><h2 className="font-semibold">어떤 소식부터 조사할까요?</h2><p className="mt-1 text-sm text-muted-foreground">추천 소스 세트를 넣거나 빈 홍보실로 시작할 수 있습니다.</p></div>{presets.map(p=><button key={p.key} onClick={()=>onPick(p)} className={`${R.surface} ${FINISH.s1} flex w-full gap-3 bg-background p-4 text-left transition hover:shadow-md`}><Sparkles className="mt-0.5 h-4 w-4 text-violet-500"/><span><b className="block text-sm">{p.label}</b><span className="text-xs text-muted-foreground">{p.description}</span></span></button>)}<Btn tone="ghost" onClick={()=>onPick(null)}>빈 홍보실로 시작</Btn></section>}
