"use client";
import { useState } from "react";
import { toast } from "sonner";
import { getPublicAppOrigin } from "@/lib/app-url";
import { canonicalBranchValue, localize, type CollectFormConfig } from "@/lib/collect-form-config";

export function DomesticBuilderSettings({config,patch,sourceId}:{config:CollectFormConfig;patch:(v:Partial<CollectFormConfig>)=>void;sourceId:string}) {
  const [input,setInput] = useState({base:config.registrationPrefix,value:config.registrationPrefix});
  const draft = input.base === config.registrationPrefix ? input.value : config.registrationPrefix;
  const field = config.fields.find(f=>f.key===config.branch.fieldKey);
  const options = config.branch.enabled ? field?.options ?? [] : [];
  const origin = getPublicAppOrigin();
  const valid = /^[0-9]{2}$/.test(draft);
  return <section className="space-y-3 rounded-xl bg-secondary/35 p-4 shadow-sm">
    <div><h2 className="text-sm font-semibold">빌더형 2 · 국내형 · 시스포유 협업</h2><p className="mt-1 text-xs text-muted-foreground">상단 유형 탭으로 등록받고 하나의 DB에서 관리합니다. 탭 이름과 유형별 질문은 아래 등록 유형 항목에서 수정하세요.</p></div>
    <div className="flex flex-wrap items-start gap-4"><label className="text-xs">등록번호 접두번호<input aria-label="등록번호 접두번호" inputMode="numeric" maxLength={2} value={draft} onChange={e=>{const v=e.target.value.replace(/[^0-9]/g,"").slice(0,2);setInput({base:config.registrationPrefix,value:v});if(/^[0-9]{2}$/.test(v))patch({registrationPrefix:v});}} className="mt-1 block w-24 rounded-lg bg-background px-3 py-2 font-mono text-sm shadow-sm" />{!valid && <span role="alert" className="mt-1 block text-xs text-destructive">숫자 2자리를 입력하세요.</span>}</label><p className="pt-5 font-mono text-sm">{valid?draft:config.registrationPrefix}000001 → {valid?draft:config.registrationPrefix}999999</p></div>
    <p className="text-xs text-muted-foreground">같은 접두번호를 쓰는 국내형 폼 전체에서 순번을 공유합니다. 일반·바이어는 같은 순번을 쓰며 삭제된 번호는 재사용하지 않습니다. 접두번호 변경은 이후 신규 등록에만 적용됩니다.</p>
    {!options.length && <p role="alert" className="text-xs text-destructive">상단 탭을 쓰려면 선택 항목의 유형 분기를 켜고 선택지를 추가하세요.</p>}
    {origin && options.map((o,i)=>{const label=localize(o,config.defaultLocale); const value=canonicalBranchValue(config,label); const url=`${origin}/register/${sourceId}?type=${encodeURIComponent(value)}`;return <div key={i} className="flex flex-wrap items-center gap-2 text-xs"><span className="min-w-20 font-medium">{label}</span><a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 break-all text-muted-foreground underline underline-offset-2">{url}</a><button type="button" className="rounded-lg bg-background px-3 py-1.5 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2" onClick={()=>{void navigator.clipboard.writeText(url).then(()=>toast.success("유형별 등록 링크를 복사했어요")).catch(()=>toast.error("링크를 복사하지 못했어요. 주소를 직접 복사해 주세요."));}}>링크 복사</button></div>;})}
  </section>;
}
