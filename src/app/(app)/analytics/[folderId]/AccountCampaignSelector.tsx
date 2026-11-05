"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import type { AccountCampaign, MediaAccount } from "@/lib/ad-campaign-scope";

export function AccountCampaignSelector({ folderId, account, onChange }: { folderId: string; account: MediaAccount; onChange(accounts: MediaAccount[]): void }) {
  const [campaigns, setCampaigns] = useState<AccountCampaign[]>([]);
  const base = JSON.stringify(account.campaignIds ?? null);
  const [optimistic, setOptimistic] = useState<{ base: string; ids: string[] | undefined } | null>(null);
  const ids = optimistic?.base === base ? optimistic.ids : account.campaignIds;
  const setIds = (value: string[] | undefined) => setOptimistic({ base, ids: value });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/ad-performance/folders/${folderId}/campaigns?${new URLSearchParams({ platform: account.platform, accountId: account.accountId })}`, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "캠페인을 불러오지 못했습니다.");
      setCampaigns(data.campaigns);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "캠페인을 불러오지 못했습니다."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [folderId, account.platform, account.accountId]);
  const selecting = ids !== undefined;
  useEffect(() => { if (!selecting) return; const controller = new AbortController(); const timer = window.setTimeout(() => void load(controller.signal), 0); return () => { window.clearTimeout(timer); controller.abort(); }; }, [load, selecting]);
  async function save(next: string[] | undefined) {
    if (saving) return;
    const previous = ids;
    setIds(next); setSaving(true); setError("");
    try {
      const response = await fetch(`/api/ad-performance/folders/${folderId}/campaigns`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: account.platform, accountId: account.accountId, campaignIds: next ?? null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "캠페인 선택을 저장하지 못했습니다.");
      onChange(data.mediaAccounts);
    } catch (e) { setIds(previous); setError(e instanceof Error ? e.message : "캠페인 선택을 저장하지 못했습니다."); }
    finally { setSaving(false); }
  }
  const choices = useMemo(() => [...campaigns, ...(ids ?? []).filter(id => !campaigns.some(c => c.id === id)).map(id => ({ id, name: "기존 선택 캠페인", status: "목록에서 확인되지 않음" }))], [campaigns, ids]);
  const visible = choices.filter(c => `${c.name} ${c.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="mt-4 space-y-3">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">분석에 포함할 캠페인</p><span className="text-[10px] text-muted-foreground" aria-live="polite">{saving ? "저장 중…" : ids === undefined ? "전체 포함" : `${ids.length}개 선택 · 자동 저장`}</span></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label={`${account.accountName} 캠페인 범위`}>
      {[{ all: true, label: "전체 캠페인" }, { all: false, label: "직접 선택" }].map(mode => <button key={mode.label} type="button" aria-pressed={(ids === undefined) === mode.all} disabled={saving} onClick={() => { if ((ids === undefined) !== mode.all) void save(mode.all ? undefined : []); }} className={`rounded-lg px-3 py-2 text-xs shadow-sm transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40 ${((ids === undefined) === mode.all) ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}>{mode.label}</button>)}
    </div>
    {ids === undefined ? <p className="text-[11px] leading-5 text-muted-foreground">이 계정의 기간 내 전체 캠페인이 포함됩니다. 특정 행사만 분석하려면 직접 선택해주세요.</p> : <>
      <div className="flex gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-secondary/50 px-2.5 focus-within:ring-2 focus-within:ring-violet-400"><Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><input aria-label={`${account.accountName} 캠페인 검색`} value={query} onChange={e => setQuery(e.target.value)} placeholder="캠페인 이름·ID 검색" className="h-9 min-w-0 w-full bg-transparent text-xs outline-none" /></label><button type="button" aria-label="캠페인 목록 새로고침" onClick={() => void load()} disabled={loading || saving} className="rounded-lg bg-secondary p-2 shadow-sm transition hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} /></button></div>
      {loading ? <p role="status" className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />계정의 캠페인 목록을 불러오는 중</p> : <div className="max-h-64 space-y-1 overflow-y-auto">{visible.map(c => <label key={c.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-secondary/25 p-2.5 transition hover:bg-secondary/60"><input type="checkbox" checked={ids.includes(c.id)} disabled={saving} onChange={e => void save(e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} className="mt-0.5 accent-violet-500" /><span className="min-w-0"><span className="block break-words text-xs font-medium">{c.name}</span><span className="mt-0.5 block break-all text-[10px] text-muted-foreground">{c.id}{c.status ? ` · ${c.status}` : ""}</span></span></label>)}{!visible.length && <p className="py-3 text-xs text-muted-foreground">{query ? "검색 결과가 없습니다." : "선택할 캠페인이 없습니다."}</p>}</div>}
      {!ids.length && <p className="text-xs text-amber-600">선택된 캠페인이 없어 이 계정의 성과는 집계되지 않습니다.</p>}
      <p className="text-[10px] leading-4 text-muted-foreground">목록은 기간과 무관합니다. 집계에는 선택한 캠페인과 조회 기간을 함께 적용하며, 계정·캠페인을 확인할 수 없는 자료는 제외합니다. 새로 선택한 캠페인의 최신 성과는 상단 ‘전체 매체 동기화’로 가져옵니다.</p>
    </>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-red-500">{error}</p>}
  </div>;
}
