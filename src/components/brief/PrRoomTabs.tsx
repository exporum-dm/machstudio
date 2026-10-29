"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Clipboard, ExternalLink, FileText, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Btn, Field, FINISH, R } from "@/components/ui/primitives";
import { api, type BriefItem, type BriefRow, type PressDraft } from "./types";

const selectClass = `min-h-9 rounded-lg bg-background px-2 text-sm shadow-sm ${R.control}`;
const channelLabel: Record<string, string> = { press: "보도자료", sns: "SNS", comment: "댓글", community: "커뮤니티", web: "웹" };

async function patchItem(briefId: string, itemId: string, data: Record<string, unknown>) {
  return api<{ item: BriefItem }>(`/api/briefs/${briefId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function OverviewTab({ brief, items, onMove }: { brief: BriefRow; items: BriefItem[]; onMove: (tab: "monitor" | "response") => void }) {
  const fresh = items.filter((x) => x.reviewStatus === "new").length;
  const negative = items.filter((x) => x.sentiment === "negative").length;
  const issues = items.filter((x) => x.reviewStatus === "issue" || ["urgent", "crisis"].includes(x.riskLevel)).length;
  return <div className="max-w-5xl space-y-5">
    {issues > 0 && <button onClick={() => onMove("response")} className="flex w-full items-center justify-between rounded-xl bg-rose-50 p-4 text-left shadow-sm dark:bg-rose-950/30">
      <span className="flex items-center gap-3"><ShieldAlert className="h-5 w-5 text-rose-600" /><span><b>바로 확인할 이슈 {issues}건</b><span className="mt-0.5 block text-sm text-muted-foreground">대응 수준과 답변 방향을 정해주세요.</span></span></span>
      <span className="text-sm font-medium text-rose-700">대응하기 →</span>
    </button>}
    <div className="grid gap-3 sm:grid-cols-3">
      {[["새 언급", fresh, "monitor"], ["부정 반응", negative, "monitor"], ["대응 이슈", issues, "response"]].map(([label, count, target]) => <button key={String(label)} onClick={() => onMove(target as "monitor" | "response")} className={`${R.panel} ${FINISH.s1} bg-card p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md`}><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-2 block text-3xl">{count}</strong></button>)}
    </div>
    <section className={`${R.panel} ${FINISH.s1} bg-card p-5`}><h2 className="font-semibold">조사 상태</h2><p className="mt-2 text-sm text-muted-foreground">{brief.collectEveryDays}일마다 등록된 보도·SNS 소스를 조사합니다. 마지막 조사: {brief.lastCollectedAt ? new Date(brief.lastCollectedAt).toLocaleString("ko-KR") : "아직 없음"}</p></section>
  </div>;
}

export function MonitoringTab({ brief, items, canWrite, setItems }: { brief: BriefRow; items: BriefItem[]; canWrite: boolean; setItems: React.Dispatch<React.SetStateAction<BriefItem[]>> }) {
  const [filter, setFilter] = useState("all");
  const shown = items.filter((x) => filter === "all" || (filter === "issue" ? x.reviewStatus === "issue" : x.sentiment === filter));
  const update = async (item: BriefItem, data: Record<string, unknown>) => {
    setItems((list) => list.map((x) => x.id === item.id ? { ...x, ...data } as BriefItem : x));
    try { const r = await patchItem(brief.id, item.id, data); setItems((list) => list.map((x) => x.id === item.id ? r.item : x)); }
    catch (e) { toast.error((e as Error).message); }
  };
  return <div className="max-w-5xl space-y-4">
    <div className="flex flex-wrap gap-2">{[["all","전체"],["positive","긍정"],["neutral","중립"],["negative","부정"],["issue","이슈"]].map(([v,l]) => <button key={v} onClick={() => setFilter(v)} className={`rounded-full px-3 py-1.5 text-sm shadow-sm ${filter === v ? "bg-violet-600 text-white" : "bg-card text-muted-foreground"}`}>{l}</button>)}</div>
    <div className="space-y-2">{shown.map((item) => <article key={item.id} className={`${R.surface} ${FINISH.s1} bg-card p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="rounded-md bg-secondary px-2 py-0.5 text-xs">{channelLabel[item.channel] ?? item.channel}</span><span className="text-xs text-muted-foreground">{item.org || item.sourceName || item.source}</span></div><a href={item.url} target="_blank" rel="noreferrer" className="mt-2 flex items-start gap-1 font-medium hover:text-violet-600">{item.title}<ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0" /></a>{item.excerpt && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.excerpt}</p>}</div>
      {canWrite && <div className="flex flex-wrap gap-2"><select className={selectClass} value={item.channel} onChange={(e) => update(item,{channel:e.target.value})}>{Object.entries(channelLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select className={selectClass} value={item.sentiment} onChange={(e)=>update(item,{sentiment:e.target.value,reviewStatus:"reviewed"})}><option value="positive">긍정</option><option value="neutral">중립</option><option value="negative">부정</option></select><Btn tone={item.reviewStatus === "issue" ? "ghost" : "key"} onClick={()=>update(item,{reviewStatus:item.reviewStatus === "issue" ? "reviewed" : "issue",riskLevel:item.reviewStatus === "issue" ? "watch" : "attention"})}>{item.reviewStatus === "issue" ? <><Check className="h-4 w-4"/>이슈 해제</> : <><AlertTriangle className="h-4 w-4"/>대응 필요</>}</Btn></div>}</div>
    </article>)}</div>{shown.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">조건에 맞는 언급이 없습니다.</p>}
  </div>;
}

export function ResponseTab({ brief, items, canWrite, setItems }: { brief: BriefRow; items: BriefItem[]; canWrite: boolean; setItems: React.Dispatch<React.SetStateAction<BriefItem[]>> }) {
  const issues = items.filter((x) => x.reviewStatus === "issue" || x.sentiment === "negative" || x.riskLevel !== "watch");
  const update = async (item: BriefItem, data: Record<string, unknown>) => { const r = await patchItem(brief.id,item.id,data); setItems((list)=>list.map((x)=>x.id===item.id?r.item:x)); toast.success("대응 기록을 저장했어요"); };
  return <div className="max-w-4xl space-y-3">{issues.map((item)=><article key={item.id} className={`${R.panel} ${FINISH.s1} bg-card p-5`}><div className="flex flex-wrap justify-between gap-3"><div><span className="text-xs text-muted-foreground">{channelLabel[item.channel]} · {item.org}</span><h3 className="mt-1 font-semibold">{item.title}</h3></div><select disabled={!canWrite} className={selectClass} value={item.riskLevel} onChange={(e)=>update(item,{riskLevel:e.target.value,reviewStatus:"issue"})}><option value="watch">관찰</option><option value="attention">주의</option><option value="urgent">긴급</option><option value="crisis">위기</option></select></div><p className="mt-3 rounded-lg bg-secondary/60 p-3 text-sm">{item.riskLevel === "crisis" ? "즉시 사실관계를 확정하고 공식 입장문·문의 창구를 단일화하세요." : item.riskLevel === "urgent" ? "당일 답변 원칙과 FAQ를 정하고 책임자를 지정하세요." : "확산 속도와 반복 질문을 관찰하고 답변 초안을 준비하세요."}</p><textarea disabled={!canWrite} defaultValue={item.responseNote} onBlur={(e)=>e.target.value !== item.responseNote && update(item,{responseNote:e.target.value})} placeholder="확인된 사실, 대응 문구, 담당자와 다음 조치를 기록하세요" className={`mt-3 min-h-28 w-full bg-background p-3 text-sm ${R.control} ${FINISH.s2}`} /><div className="mt-3 flex justify-end"><Btn tone="ghost" disabled={!canWrite} onClick={()=>update(item,{reviewStatus:"archived",riskLevel:"watch"})}><Check className="h-4 w-4"/>대응 완료</Btn></div></article>)}{issues.length===0&&<p className="py-14 text-center text-sm text-muted-foreground">현재 대응할 이슈가 없습니다.</p>}</div>;
}

const draftType: Record<PressDraft["type"], string> = { advance:"사전 보도자료", opening:"개막 보도자료", closing:"성료 보도자료", statement:"공식 입장문" };
export function PressStudioTab({ brief, canWrite, onChange }: { brief: BriefRow; canWrite: boolean; onChange: (b: BriefRow)=>void }) {
  const [type,setType]=useState<PressDraft["type"]>("advance"); const [facts,setFacts]=useState(""); const [angle,setAngle]=useState("");
  const body = useMemo(()=>{ const lead = type === "advance" ? `${brief.name}이(가) 개최를 앞두고 주요 프로그램을 공개했다.` : type === "opening" ? `${brief.name}이(가) 오늘 개막했다.` : type === "closing" ? `${brief.name}이(가) 일정을 마무리하며 주요 성과를 발표했다.` : `${brief.name} 관련 공식 입장을 안내드립니다.`; return `${lead}\n\n${angle || "핵심 메시지를 입력하면 이 문단에 반영됩니다."}\n\n${facts || "확인된 사실을 한 줄씩 입력해주세요."}\n\n자세한 내용과 문의 창구는 공식 채널을 통해 확인할 수 있다.`;},[brief.name,type,facts,angle]);
  const save=async()=>{ const d:PressDraft={id:crypto.randomUUID(),type,title:`[${draftType[type]}] ${brief.name}`,body,updatedAt:new Date().toISOString()}; const r=await api<{brief:BriefRow}>(`/api/briefs/${brief.id}`,{method:"PATCH",body:JSON.stringify({pressDrafts:[d,...brief.pressDrafts]})}); onChange(r.brief); toast.success("초안을 저장했어요"); };
  return <div className="grid max-w-6xl gap-4 lg:grid-cols-[360px_minmax(0,1fr)]"><section className={`${R.panel} ${FINISH.s1} space-y-4 bg-card p-5`}><h2 className="font-semibold">보도자료 설계</h2><label className="block text-sm">자료 종류<select className={`${selectClass} mt-1 w-full`} value={type} onChange={(e)=>setType(e.target.value as PressDraft["type"])}>{Object.entries(draftType).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label className="block text-sm">핵심 방향<Field className="mt-1" value={angle} onChange={(e)=>setAngle(e.target.value)} placeholder="이번 자료에서 가장 강조할 한 문장"/></label><label className="block text-sm">확인된 사실<textarea className={`mt-1 min-h-36 w-full bg-background p-3 text-sm ${R.control} ${FINISH.s2}`} value={facts} onChange={(e)=>setFacts(e.target.value)} placeholder="일정, 장소, 수치, 참여사 등 확인된 사실만 입력"/></label><Btn tone="key" disabled={!canWrite} onClick={save}><FileText className="h-4 w-4"/>초안 저장</Btn></section><section className={`${R.panel} ${FINISH.s1} bg-card p-6`}><div className="flex justify-between gap-3"><h2 className="font-semibold">미리보기</h2><Btn tone="ghost" onClick={()=>navigator.clipboard.writeText(body).then(()=>toast.success("복사했어요"))}><Clipboard className="h-4 w-4"/>복사</Btn></div><h3 className="mt-6 text-xl font-semibold">[{draftType[type]}] {brief.name}</h3><p className="mt-5 whitespace-pre-wrap text-sm leading-7">{body}</p></section></div>;
}

export function ReportTab({ brief, items }: { brief: BriefRow; items: BriefItem[] }) { const pos=items.filter(x=>x.sentiment==="positive").length, neg=items.filter(x=>x.sentiment==="negative").length; const text=`${brief.name} 홍보 모니터링 요약\n전체 언급 ${items.length}건 · 긍정 ${pos}건 · 부정 ${neg}건\n대응 필요 ${items.filter(x=>x.reviewStatus==="issue").length}건\n권고: ${neg ? "부정 반응의 반복 질문을 FAQ와 공식 메시지에 반영" : "현재 메시지를 유지하며 긍정 반응의 확산 채널을 확인"}`; return <div className={`${R.panel} ${FINISH.s1} max-w-4xl bg-card p-6`}><div className="flex justify-between"><div><h2 className="font-semibold">최근 모니터링 리포트</h2><p className="mt-1 text-sm text-muted-foreground">현재 수집된 자료를 바탕으로 즉시 공유할 수 있는 요약입니다.</p></div><Btn tone="ghost" onClick={()=>navigator.clipboard.writeText(text).then(()=>toast.success("복사했어요"))}><Clipboard className="h-4 w-4"/>복사</Btn></div><pre className="mt-5 whitespace-pre-wrap rounded-xl bg-secondary/60 p-5 font-sans text-sm leading-7">{text}</pre></div>; }
