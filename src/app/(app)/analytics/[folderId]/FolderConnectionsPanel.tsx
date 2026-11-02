"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { AD_DETAIL_METRIC_COLUMNS, type AdDetailMetricColumn } from "@/lib/meta-result-metrics";

type MediaAccount = { platform: string; accountId: string; accountName: string };
type MetaAccount = { id: string; name: string; currency?: string; timezone_name?: string };
type GoogleAccount = { id: string; name: string; currency?: string; timezone?: string };
type GoogleMeta = { lastSyncedAt: string | null; lastSyncError: string | null; accountsError: string | null };

// DB에는 UTC로 저장되지만 이 앱의 날짜는 KST 달력일 기준 — naive slice(0,10)은 자정 부근에 하루 밀린다.
function kstDateOnly(value: string) {
  const kst = new Date(new Date(value).getTime() + 9 * 60 * 60_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

export function FolderConnectionsPanel({
  folderId,
  folderName,
  folderDescription,
  reportStart,
  reportEnd,
  detailColumns,
  accounts,
  onFolderNameChange,
  onFolderDescriptionChange,
  onDateRangeChange,
  onDashboardSettingsChange,
  onChange,
}: {
  folderId: string;
  folderName: string;
  folderDescription: string | null;
  reportStart: string;
  reportEnd: string;
  detailColumns: AdDetailMetricColumn[];
  accounts: MediaAccount[];
  onFolderNameChange(name: string): void;
  onFolderDescriptionChange(description: string | null): void;
  onDateRangeChange(range: { reportStart: string; reportEnd: string }): void;
  onDashboardSettingsChange(detailColumns: AdDetailMetricColumn[]): void;
  onChange(accounts: MediaAccount[]): void;
}) {
  const [available, setAvailable] = useState<MetaAccount[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [googleAvailable, setGoogleAvailable] = useState<GoogleAccount[]>([]);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [googleMeta, setGoogleMeta] = useState<GoogleMeta>({ lastSyncedAt: null, lastSyncError: null, accountsError: null });
  const [googleSelectedId, setGoogleSelectedId] = useState("");
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(folderName);
  const [description, setDescription] = useState(folderDescription ?? "");
  const [savingName, setSavingName] = useState(false);
  const [range, setRange] = useState({ reportStart: kstDateOnly(reportStart), reportEnd: kstDateOnly(reportEnd) });
  const [savingRange, setSavingRange] = useState(false);
  const [savingDashboard, setSavingDashboard] = useState(false);
  const [manual, setManual] = useState({ platform: "GOOGLE", accountName: "", accountId: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [response, googleResponse] = await Promise.all([fetch(`/api/ad-performance/folders/${folderId}/meta-accounts`, { cache: "no-store" }), fetch(`/api/ad-performance/folders/${folderId}/google-accounts`, { cache: "no-store" })]);
    const [data, googleData] = await Promise.all([response.json().catch(() => null), googleResponse.json().catch(() => null)]);
    if (!response.ok) toast.error(data?.error || "Meta 광고 계정을 불러오지 못했습니다.");
    else { setAvailable(data.accounts ?? []); setConnected(data.connected === true); }
    if (!googleResponse.ok) toast.error(googleData?.error || "Google Ads 계정을 불러오지 못했습니다.");
    else {
      setGoogleAvailable(googleData.accounts ?? []);
      setGoogleConnected(googleData.connected === true);
      setGoogleMeta({ lastSyncedAt: googleData.lastSyncedAt ?? null, lastSyncError: googleData.lastSyncError ?? null, accountsError: googleData.accountsError ?? null });
    }
    setLoading(false);
  }, [folderId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const selectable = useMemo(
    () => available.filter(item => !accounts.some(account => account.platform === "META" && account.accountId === item.id)),
    [available, accounts],
  );
  const googleSelectable = useMemo(() => googleAvailable.filter(item => !accounts.some(account => account.platform === "GOOGLE" && account.accountId === item.id)), [googleAvailable, accounts]);

  async function save(next: MediaAccount[], success: string) {
    setSaving(true);
    const response = await fetch(`/api/ad-performance/folders/${folderId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaAccounts: next }),
    });
    const data = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return toast.error(data?.error || "광고 계정 설정을 저장하지 못했습니다.");
    onChange(data.folder.mediaAccounts ?? next); setSelectedId(""); setGoogleSelectedId(""); toast.success(success);
  }

  function add() {
    const selected = available.find(item => item.id === selectedId);
    if (!selected) return;
    void save([...accounts, { platform: "META", accountId: selected.id, accountName: selected.name }], "광고 계정을 폴더에 연결했습니다.");
  }

  function remove(target: MediaAccount) {
    void save(accounts.filter(item => !(item.platform === target.platform && item.accountId === target.accountId)), "광고 계정을 폴더에서 삭제했습니다.");
  }

  function addOtherMedia() {
    const accountName = manual.accountName.trim();
    const accountId = manual.accountId.trim();
    if (!accountName || !accountId) return toast.error("계정 이름과 광고 계정 ID를 모두 입력해주세요.");
    if (accounts.some(item => item.platform === manual.platform && item.accountId === accountId)) return toast.error("이미 이 폴더에 추가된 계정입니다.");
    void save([...accounts, { platform: manual.platform, accountName, accountId }], `${manual.platform} 계정을 폴더에 추가했습니다.`);
    setManual(current => ({ ...current, accountName: "", accountId: "" }));
  }

  async function saveName() {
    const nextName = name.trim();
    const nextDescription = description.trim();
    if (!nextName || (nextName === folderName && nextDescription === (folderDescription ?? ""))) return;
    setSavingName(true);
    const response = await fetch(`/api/ad-performance/folders/${folderId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nextName, description: nextDescription }),
    });
    const data = await response.json().catch(() => null);
    setSavingName(false);
    if (!response.ok) return toast.error(data?.error || "폴더명을 저장하지 못했습니다.");
    setName(data.folder.name); setDescription(data.folder.description ?? ""); onFolderNameChange(data.folder.name); onFolderDescriptionChange(data.folder.description ?? null); toast.success("폴더 정보를 변경했습니다.");
  }

  async function saveRange() {
    if (!range.reportStart || !range.reportEnd) return toast.error("시작일과 종료일을 모두 선택해주세요.");
    if (range.reportStart > range.reportEnd) return toast.error("종료일은 시작일보다 빠를 수 없습니다.");
    setSavingRange(true);
    const response = await fetch(`/api/ad-performance/folders/${folderId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(range),
    });
    const data = await response.json().catch(() => null);
    setSavingRange(false);
    if (!response.ok) return toast.error(data?.error || "조회 기간을 저장하지 못했습니다.");
    const next = { reportStart: data.folder.reportStart, reportEnd: data.folder.reportEnd };
    setRange({ reportStart: kstDateOnly(next.reportStart), reportEnd: kstDateOnly(next.reportEnd) });
    onDateRangeChange(next); toast.success("조회 기간을 변경했습니다.");
  }

  function addGoogle() {
    const selected = googleAvailable.find(item => item.id === googleSelectedId);
    if (selected) void save([...accounts, { platform: "GOOGLE", accountId: selected.id, accountName: selected.name }], "Google Ads 계정을 폴더에 추가했습니다.");
  }

  async function syncGoogle() {
    setGoogleSyncing(true);
    const response = await fetch(`/api/ad-performance/folders/${folderId}/google-sync`, { method: "POST" });
    const data = await response.json().catch(() => null);
    setGoogleSyncing(false);
    await load(); // 성공/실패 모두 lastSyncError·lastSyncedAt 을 새로 읽어와 카드에 보여준다
    if (!response.ok) return toast.error(data?.error || "Google Ads 데이터를 동기화하지 못했습니다.");
    toast.success(`Google Ads 성과 ${Number(data.rowCount || 0).toLocaleString()}건을 동기화했습니다.`);
  }

  async function saveDashboardSettings(nextDetailColumns: AdDetailMetricColumn[]) {
    if (savingDashboard) return;
    setSavingDashboard(true);
    try {
      const response = await fetch(`/api/ad-performance/folders/${folderId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detailColumns: nextDetailColumns }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "결과 상세 설정을 저장하지 못했습니다.");
      onDashboardSettingsChange(nextDetailColumns);
      toast.success("결과 상세 표시 설정을 저장했습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "결과 상세 설정을 저장하지 못했습니다.");
    } finally {
      setSavingDashboard(false);
    }
  }

  async function resyncMetaResults() {
    if (savingDashboard || !accounts.some((account) => account.platform === "META")) return;
    setSavingDashboard(true);
    try {
      const response = await fetch(`/api/ad-performance/folders/${folderId}/sync`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "현재 결과 기준으로 Meta 데이터를 다시 계산하지 못했습니다.");
      toast.success("현재 결과 기준으로 Meta 데이터를 다시 계산했습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Meta 데이터를 다시 계산하지 못했습니다.");
    } finally {
      setSavingDashboard(false);
    }
  }

  return <div className="space-y-5 p-4 sm:p-6 lg:p-8">
    <section className="max-w-2xl rounded-2xl bg-card p-5 shadow-sm"><h2 className="text-sm font-semibold">폴더 정보</h2><p className="mt-1 text-xs text-muted-foreground">이 광고 성과 공간의 제목과 설명입니다.</p><div className="mt-4 space-y-3"><label className="block text-xs font-medium text-muted-foreground">제목<input value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void saveName(); }} maxLength={100} className="mt-1.5 h-10 w-full rounded-xl bg-secondary/55 px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-violet-400" /></label><label className="block text-xs font-medium text-muted-foreground">설명<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={500} rows={3} placeholder="이 폴더에서 비교할 캠페인이나 운영 목적을 적어주세요." className="mt-1.5 w-full resize-y rounded-xl bg-secondary/55 px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-violet-400" /></label><div className="flex justify-end"><button type="button" onClick={saveName} disabled={savingName || !name.trim() || (name.trim() === folderName && description.trim() === (folderDescription ?? ""))} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-xs font-medium text-background shadow-sm disabled:opacity-35">{savingName && <Loader2 className="h-3.5 w-3.5 animate-spin" />}정보 저장</button></div></div></section>
    <section className="max-w-2xl rounded-2xl bg-card p-5 shadow-sm"><h2 className="text-sm font-semibold">기본 조회 기간</h2><p className="mt-1 text-xs text-muted-foreground">대시보드와 다음 Meta 동기화에 사용할 기간입니다.</p><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-medium text-muted-foreground">시작일<input type="date" value={range.reportStart} onChange={event => setRange(current => ({ ...current, reportStart: event.target.value }))} className="mt-1.5 h-10 w-full rounded-xl bg-secondary/55 px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-violet-400" /></label><label className="text-xs font-medium text-muted-foreground">종료일<input type="date" value={range.reportEnd} onChange={event => setRange(current => ({ ...current, reportEnd: event.target.value }))} className="mt-1.5 h-10 w-full rounded-xl bg-secondary/55 px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-violet-400" /></label><button type="button" onClick={saveRange} disabled={savingRange || !range.reportStart || !range.reportEnd || (range.reportStart === kstDateOnly(reportStart) && range.reportEnd === kstDateOnly(reportEnd))} className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-xs font-medium text-background shadow-sm disabled:opacity-35">{savingRange && <Loader2 className="h-3.5 w-3.5 animate-spin" />}기간 저장</button></div>{range.reportStart > range.reportEnd && <p className="mt-2 text-xs text-red-500">종료일은 시작일보다 빠를 수 없습니다.</p>}</section>
    <section className="max-w-2xl rounded-2xl bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">결과 상세 표시</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">상세 표와 CSV에서 보고 싶은 Meta 지표를 켜고 끕니다. 변경 즉시 저장됩니다.</p></div>{savingDashboard && <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-muted-foreground" />}</div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/35 px-3 py-2.5">
        <p className="text-[11px] leading-5 text-muted-foreground">결과와 결과당 비용은 Meta 광고 관리자가 캠페인 목표에 맞춰 반환한 값을 그대로 사용합니다.</p>
        <button type="button" onClick={() => void resyncMetaResults()} disabled={savingDashboard || !accounts.some((account) => account.platform === "META")} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-secondary/70 px-3 text-[11px] font-medium text-foreground shadow-sm transition hover:bg-secondary disabled:opacity-40">
          <RefreshCw className={`h-3.5 w-3.5 ${savingDashboard ? "animate-spin" : ""}`} />현재 기준으로 다시 계산
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {AD_DETAIL_METRIC_COLUMNS.map((column) => {
          const checked = detailColumns.includes(column.key);
          return <label key={column.key} className="flex items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3 py-2.5 text-xs font-medium"><span>{column.label}</span><Switch checked={checked} disabled={savingDashboard} onChange={(next) => void saveDashboardSettings(next ? [...detailColumns, column.key] : detailColumns.filter((key) => key !== column.key))} label={`${column.label} 표시`} /></label>;
        })}
      </div>
    </section>
    <div><h2 className="font-semibold">매체 계정 연결</h2><p className="mt-1 text-xs text-muted-foreground">OAuth로 연결된 광고 계정 중 이 폴더에서 비교할 계정을 선택합니다.</p></div>
    <div className="grid gap-3 lg:grid-cols-3">{accounts.map(item => <div key={`${item.platform}-${item.accountId}`} className="relative rounded-2xl bg-card p-4 shadow-sm"><span className="text-[10px] font-semibold text-violet-500">{item.platform}</span><p className="mt-2 pr-8 text-sm font-medium">{item.accountName}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{item.accountId}</p><button type="button" aria-label={`${item.accountName} 삭제`} disabled={saving} onClick={() => remove(item)} className="absolute right-3 top-3 rounded-lg p-2 text-muted-foreground transition hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></div>)}</div>
    <section className="max-w-2xl rounded-2xl bg-secondary/35 p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600/10 text-blue-600"><PlugZap className="h-4 w-4" /></span><div><h3 className="text-sm font-semibold">Meta 광고 계정 추가</h3><p className="mt-1 text-xs text-muted-foreground">Meta는 한 번 연결하면 내가 접근하는 모든 워크스페이스에서 사용할 수 있습니다.</p></div></div>{loading ? <div className="mt-4 flex h-10 items-center"><Loader2 className="h-4 w-4 animate-spin" /></div> : !connected ? <a href={`/api/meta-ads/connect?folderId=${encodeURIComponent(folderId)}`} className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700">Meta 계정 연결</a> : <div className="mt-4 flex flex-col gap-2 sm:flex-row"><select value={selectedId} onChange={event => setSelectedId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-violet-400"><option value="">광고 계정을 선택해주세요</option>{selectable.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}{item.currency ? ` · ${item.currency}` : ""}</option>)}</select><button type="button" disabled={!selectedId || saving} onClick={add} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 text-xs font-medium text-white shadow-sm disabled:opacity-40">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}계정 추가</button></div>}</section>
    <section className="max-w-2xl rounded-2xl bg-secondary/35 p-5"><h3 className="text-sm font-semibold">다른 매체 계정 추가</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Google Ads와 TikTok Ads도 같은 폴더에 포함할 수 있습니다. API OAuth 연결 전에는 폴더의 데이터 추가에서 해당 매체 보고서를 가져와 비교할 수 있습니다.</p><div className="mt-4 grid gap-2 sm:grid-cols-[150px_1fr_1fr_auto]"><select value={manual.platform} onChange={event => setManual(current => ({ ...current, platform: event.target.value }))} className="h-10 rounded-xl bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-violet-400"><option value="GOOGLE">Google Ads</option><option value="TIKTOK">TikTok Ads</option><option value="LINKEDIN">LinkedIn Ads</option></select><input value={manual.accountName} onChange={event => setManual(current => ({ ...current, accountName: event.target.value }))} placeholder="계정 이름" className="h-10 min-w-0 rounded-xl bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-violet-400" /><input value={manual.accountId} onChange={event => setManual(current => ({ ...current, accountId: event.target.value }))} placeholder="광고 계정 ID" className="h-10 min-w-0 rounded-xl bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-violet-400" /><button type="button" disabled={saving || !manual.accountName.trim() || !manual.accountId.trim()} onClick={addOtherMedia} className="h-10 rounded-xl bg-violet-500 px-4 text-xs font-medium text-white shadow-sm disabled:opacity-40">계정 추가</button></div></section>
    <section className="max-w-2xl rounded-2xl bg-secondary/35 p-5">
      <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/15 font-bold text-amber-600">G</span><div><h3 className="text-sm font-semibold">Google Ads 계정 추가</h3><p className="mt-1 text-xs text-muted-foreground">Google 로그인 한 번으로 관리자 계정의 광고 계정을 선택합니다.</p></div></div>{googleConnected && accounts.some(item => item.platform === "GOOGLE") && <button type="button" onClick={() => void syncGoogle()} disabled={googleSyncing} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-amber-500 px-3 text-xs font-semibold text-white shadow-sm disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${googleSyncing ? "animate-spin" : ""}`} />Google 동기화</button>}</div>
      {loading ? <div className="mt-4 flex h-10 items-center"><Loader2 className="h-4 w-4 animate-spin" /></div> : !googleConnected ? <a href={`/api/google-ads/connect?folderId=${encodeURIComponent(folderId)}`} className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-amber-500 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600">Google 계정 연결</a> : <div className="mt-4 flex flex-col gap-2 sm:flex-row"><select value={googleSelectedId} onChange={event => setGoogleSelectedId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-amber-400"><option value="">광고 계정을 선택해주세요</option>{googleSelectable.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}{item.currency ? ` · ${item.currency}` : ""}</option>)}</select><button type="button" disabled={!googleSelectedId || saving} onClick={addGoogle} className="h-10 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-white shadow-sm disabled:opacity-40">계정 추가</button></div>}
      {googleConnected && googleMeta.lastSyncedAt && <p className="mt-2 text-[11px] text-muted-foreground">마지막 동기화 {new Date(googleMeta.lastSyncedAt).toLocaleString("ko-KR")}</p>}
      {googleConnected && googleMeta.lastSyncError && <p className="mt-1.5 whitespace-pre-wrap break-all text-xs text-amber-600">동기화 오류: {googleMeta.lastSyncError}</p>}
      {googleConnected && googleMeta.accountsError && <p className="mt-1.5 whitespace-pre-wrap break-all text-xs text-amber-600">계정 목록 조회 오류: {googleMeta.accountsError}</p>}
    </section>
  </div>;
}
