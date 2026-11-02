"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Newspaper, Radar, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";
import { Btn, FieldSelect, FINISH, R, Segmented } from "@/components/ui/primitives";
import { api, type BriefIssueRow, type BriefItem, type BriefRow } from "@/components/brief/types";
import { PickTab } from "@/components/brief/PickTab";
import { DashboardTab } from "@/components/brief/DashboardTab";
import { PublicTab } from "@/components/brief/PublicTab";
import { SourcesTab } from "@/components/brief/SourcesTab";
import { PageHeader, PageTabs } from "@/components/ui/page-layout";
import { useQueryTab } from "@/components/ui/use-query-tab";
import { MentionWorkspace, PressWorkspace } from "@/components/pr-room/workspaces";

type RoomTab="monitor"|"press"|"brief";type BriefTab="pick"|"dashboard"|"public"|"sources";
interface PresetOption{key:string;label:string;description:string;name:string}

const ROOM_TABS = [
  { id: "monitor", label: "언급·반응 조사", icon: Radar },
  { id: "press", label: "보도자료", icon: FileText },
  { id: "brief", label: "브리프", icon: Newspaper },
] as const;

export default function PrRoomPage() {
  const { currentProject } = useWorkspace();
  const projectId = currentProject?.id ?? "";
  const [roomTab, setRoomTab] = useQueryTab<RoomTab>(ROOM_TABS.map(t => t.id), "monitor", "room");
  if (!projectId) return <div className="p-6 text-sm text-muted-foreground">왼쪽에서 프로젝트를 먼저 골라 주세요.</div>;
  return <div className="space-y-5 p-4 sm:p-6 lg:p-8">
    <PageHeader title="홍보실" context={currentProject?.name} description="온라인 반응을 조사하고 보도자료와 뉴스 브리프를 만듭니다." />
    <PageTabs label="홍보실 업무" value={roomTab} onChange={setRoomTab} options={ROOM_TABS} sticky={false} />
    {roomTab === "monitor" ? <MentionWorkspace key={projectId} projectId={projectId} /> : roomTab === "press" ? <PressWorkspace key={projectId} projectId={projectId} /> : <BriefWorkspace key={projectId} projectId={projectId} />}
  </div>;
}

function BriefWorkspace({projectId}:{projectId:string}){const[briefs,setBriefs]=useState<BriefRow[]|null>(null);const[presets,setPresets]=useState<PresetOption[]>([]);const[creating,setCreating]=useState(false);const[canWrite,setCanWrite]=useState(false);const[briefId,setBriefId]=useState("");const[tab,setTab]=useQueryTab<BriefTab>(["pick","dashboard","public","sources"],"pick","briefTab");const[brief,setBrief]=useState<BriefRow|null>(null);const[items,setItems]=useState<BriefItem[]>([]);const[issues,setIssues]=useState<BriefIssueRow[]>([]);const[error,setError]=useState("");
  useEffect(()=>{let cancelled=false;(async()=>{try{const res=await api<{canWrite:boolean;briefs:BriefRow[];suggestedPreset:string|null;presets:PresetOption[]}>(`/api/briefs?projectId=${encodeURIComponent(projectId)}`);let list=res.briefs;const suggested=res.presets.find(p=>p.key===res.suggestedPreset);if(!list.length&&res.canWrite&&suggested){setCreating(true);const made=await api<{brief:BriefRow}>("/api/briefs",{method:"POST",body:JSON.stringify({projectId,name:suggested.name,slug:"the-action",intro:"이번주 바로 확인해야 할 실용 정보를 보내드립니다!",preset:suggested.key})});list=[made.brief]}if(cancelled)return;setBriefs(list);setPresets(res.presets);setCanWrite(res.canWrite);setBriefId(list[0]?.id??"")}catch(e){if(!cancelled){setError((e as Error).message);setBriefs([])}}finally{if(!cancelled)setCreating(false)}})();return()=>{cancelled=true}},[projectId]);
  const fetchDetail=useCallback(()=>api<{canWrite:boolean;brief:BriefRow;items:BriefItem[];issues:BriefIssueRow[]}>(`/api/briefs/${briefId}`),[briefId]);const apply=useCallback((r:Awaited<ReturnType<typeof fetchDetail>>)=>{setBrief(r.brief);setItems(r.items);setIssues(r.issues);setCanWrite(r.canWrite);setError("")},[]);const reload=useCallback(async()=>{if(briefId)apply(await fetchDetail())},[briefId,fetchDetail,apply]);useEffect(()=>{if(!briefId)return;let cancelled=false;fetchDetail().then(r=>!cancelled&&apply(r)).catch(e=>!cancelled&&setError((e as Error).message));return()=>{cancelled=true}},[briefId,fetchDetail,apply]);
  const create=async(p:PresetOption|null)=>{setCreating(true);try{const r=await api<{brief:BriefRow}>("/api/briefs",{method:"POST",body:JSON.stringify(p?{projectId,name:p.name,intro:"이번주 바로 확인해야 할 실용 정보를 보내드립니다!",preset:p.key}:{projectId,name:"브리프"})});setBriefs([r.brief]);setBriefId(r.brief.id);setTab(p?"pick":"sources")}catch(e){toast.error((e as Error).message)}finally{setCreating(false)}};
  return <section className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">브리프</h2><p className="mt-1 text-sm text-muted-foreground">지원사업·웨비나·산업 뉴스 링크를 모아 카톡 글과 공개 화면을 만듭니다.</p></div>{briefs&&briefs.length>1&&<FieldSelect value={briefId} onChange={e=>setBriefId(e.target.value)} className="w-auto">{briefs.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</FieldSelect>}</div><Segmented<BriefTab> label="브리프 탭" value={tab} onChange={setTab} options={[{value:"pick",label:"링크 고르기"},{value:"dashboard",label:"대시보드"},{value:"public",label:"공개 화면"},{value:"sources",label:"자동 수집"}]}/>{!brief?(creating?<Loading text="브리프를 만들고 첫 소식을 모으는 중이에요…"/>:briefs?.length===0&&canWrite?<StartCard presets={presets} onPick={create}/>:error?<ErrorCard message={error} retry={()=>void reload()}/>:<Loading text="불러오는 중"/>):tab==="sources"?<SourcesTab brief={brief} canWrite={canWrite} onCollected={reload}/>:tab==="pick"?<PickTab brief={brief} items={items} issues={issues} canWrite={canWrite} setItems={setItems} reload={reload} onOpenSources={()=>setTab("sources")}/>:tab==="dashboard"?<DashboardTab brief={brief}/>:<PublicTab brief={brief} canWrite={canWrite} onChange={setBrief} items={items}/>}</section>}

function StartCard({presets,onPick}:{presets:PresetOption[];onPick:(p:PresetOption|null)=>void}){return <section className={`${R.panel} ${FINISH.s1} max-w-xl space-y-4 bg-card p-5`}><div><h3 className="font-semibold">어떤 소식을 모을까요?</h3><p className="mt-1 text-sm text-muted-foreground">세트를 고르면 수집 소스가 채워지고 첫 소식을 바로 모아옵니다.</p></div>{presets.map(p=><button key={p.key} onClick={()=>onPick(p)} className={`${R.surface} flex w-full gap-3 bg-background p-4 text-left shadow-sm`}><Sparkles className="mt-0.5 h-4 w-4 text-violet-500"/><span><b className="block text-sm">{p.label}</b><span className="text-xs text-muted-foreground">{p.description}</span></span></button>)}<Btn tone="ghost" onClick={()=>onPick(null)}>빈 브리프로 시작</Btn></section>};function Loading({text}:{text:string}){return <div className="flex gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>{text}</div>};function ErrorCard({message,retry}:{message:string;retry:()=>void}){return <div className={`${R.panel} max-w-xl bg-card p-5`}><p className="font-medium">브리프를 불러오지 못했습니다.</p><p className="mt-1 text-sm text-muted-foreground">{message}</p><Btn className="mt-4" tone="key" onClick={retry}>다시 시도</Btn></div>}
