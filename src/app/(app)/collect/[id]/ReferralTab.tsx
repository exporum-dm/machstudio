"use client";

/**
 * 등록 폼 "추천" 탭 — 친구 초대 기능 설정 + 추천 순위표(관리자용, 이름·연락처 포함).
 *
 * 설정은 이 탭이 혼자 소유한다(PATCH { referral }) — 폼 빌더의 자동 저장이 통째로 보내는
 * formConfig 는 추천 설정을 덮지 않는다(mergeFormConfigUpdate).
 * 공개 순위판은 같은 계산을 쓰므로, 여기 순위와 순위판 순위가 같다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Btn, Field, FieldSelect, FINISH, R } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/switch";
import { getPublicAppOrigin } from "@/lib/app-url";
import { referralBoardPath, rewardRuleLabel, type CollectReferralConfig, type ReferralRewardMode } from "@/lib/collect-referral";

interface Row {
  recordId: string;
  rank: number;
  count: number;
  label: string;
  rewarded: boolean;
  name: string;
  phone: string;
  email: string;
  registrationNo: string | null;
}
interface Loaded { referral: CollectReferralConfig; defaultLocale: string; ranked: Row[]; referredTotal: number }

const MODES: Array<{ id: ReferralRewardMode; label: string; unit: string }> = [
  { id: "none", label: "정하지 않음", unit: "" },
  { id: "topN", label: "상위 N명", unit: "명" },
  { id: "topPercent", label: "상위 N%", unit: "%" },
  { id: "minCount", label: "N명 이상 추천", unit: "명 이상" },
];

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export function ReferralTab({ sourceId, canEdit = true }: { sourceId: string; canEdit?: boolean }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<CollectReferralConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}/referrals`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error ?? "추천 현황을 불러오지 못했어요");
      setData(body as Loaded);
      setDraft((body as Loaded).referral);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "추천 현황을 불러오지 못했어요");
    }
  }, [sourceId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 탭을 열 때 한 번 불러온다(다른 탭들과 같은 방식)
  useEffect(() => { void load(); }, [load]);

  // 참관객에게 돌릴 주소라 정식 공개 주소로 만든다(미리보기 배포 주소가 새지 않게).
  const boardUrl = `${getPublicAppOrigin()
    // eslint-disable-next-line no-restricted-syntax -- 정식 주소 환경변수가 없는 로컬 개발에서만 지금 주소로 대신한다
    || (typeof window === "undefined" ? "" : window.location.origin)}${referralBoardPath(sourceId)}`;
  const locale = data?.defaultLocale ?? "ko";
  const dirty = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.referral);

  const save = async (next: CollectReferralConfig) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referral: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "저장하지 못했어요");
      toast.success(next.enabled ? "친구 초대 설정을 저장했어요" : "친구 초대를 껐어요");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장하지 못했어요");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "");
    const all = data?.ranked ?? [];
    if (!q) return all;
    return all.filter((r) => [r.name, r.label, r.phone, r.email, r.registrationNo ?? ""].some((v) => v.toLowerCase().replace(/\s+/g, "").includes(q)));
  }, [data, query]);

  const downloadCsv = () => {
    if (!data) return;
    const header = ["순위", "추천 인원", "혜택 대상", "이름", "연락처", "이메일", "등록번호", "순위판 이름표"];
    const lines = data.ranked.map((r) => [r.rank, r.count, r.rewarded ? "Y" : "", r.name, r.phone, r.email, r.registrationNo ?? "", r.label].map(csvCell).join(","));
    const blob = new Blob([`﻿${[header.map(csvCell).join(","), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `referral-ranking-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (error) return <div className="p-6"><p className="text-sm text-destructive">{error}</p><Btn className="mt-3" onClick={() => void load()}>다시 시도</Btn></div>;
  if (!data || !draft) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const mode = MODES.find((m) => m.id === draft.rewardMode) ?? MODES[0];
  const rewardedCount = data.ranked.filter((r) => r.rewarded).length;

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <section className={`${R.panel} ${FINISH.s1} bg-card p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">친구 초대</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              켜면 등록 완료 화면에 초대 링크(공유하기·링크 복사)와 &quot;추천 순위 보기&quot;가 생겨요. 그 링크로 등록한 사람이 추천 인원으로 집계돼요.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            {draft.enabled ? "켜짐" : "꺼짐"}
            <Switch checked={draft.enabled} disabled={!canEdit || saving} label="친구 초대 켜기" onChange={(v) => { const next = { ...draft, enabled: v }; setDraft(next); void save(next); }} />
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[12rem_8rem_minmax(0,1fr)]">
          <label className="text-xs font-medium">
            혜택 기준
            <FieldSelect className="mt-1" disabled={!canEdit} value={draft.rewardMode} onChange={(e) => setDraft({ ...draft, rewardMode: e.target.value as ReferralRewardMode, rewardValue: e.target.value === "none" ? 0 : draft.rewardValue || 10 })}>
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </FieldSelect>
          </label>
          <label className="text-xs font-medium">
            N
            <span className="mt-1 flex items-center gap-1.5">
              <Field type="number" min={1} max={draft.rewardMode === "topPercent" ? 100 : undefined} disabled={!canEdit || draft.rewardMode === "none"} value={draft.rewardMode === "none" ? "" : draft.rewardValue} onChange={(e) => setDraft({ ...draft, rewardValue: Number(e.target.value) || 0 })} />
              <span className="shrink-0 text-xs text-muted-foreground">{mode.unit}</span>
            </span>
          </label>
          <label className="text-xs font-medium">
            순위판 혜택 안내 (비우면 &quot;{rewardRuleLabel(draft) || "안내 없음"}&quot;)
            <Field className="mt-1" disabled={!canEdit} placeholder="예: 상위 10명에게 현장 기념품을 드려요" value={draft.rewardNote[locale] ?? ""} onChange={(e) => setDraft({ ...draft, rewardNote: { ...draft.rewardNote, [locale]: e.target.value } })} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn tone="key" disabled={!canEdit || !dirty || saving} onClick={() => void save(draft)}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            설정 저장
          </Btn>
          {data.referral.enabled && (
            <>
              <Btn onClick={() => { void navigator.clipboard.writeText(boardUrl).then(() => toast.success("순위판 주소를 복사했어요")); }}>
                <Copy className="h-4 w-4" /> 순위판 주소 복사
              </Btn>
              <a className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline" href={boardUrl} target="_blank" rel="noreferrer">
                순위판 열기 <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </div>
      </section>

      <section className={`${R.panel} ${FINISH.s1} bg-card p-5`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">추천 순위</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              추천한 사람 {data.ranked.length.toLocaleString()}명 · 추천으로 등록 {data.referredTotal.toLocaleString()}명
              {data.referral.rewardMode !== "none" && ` · 혜택 대상(${rewardRuleLabel(data.referral)}) ${rewardedCount.toLocaleString()}명`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Field className="pl-8" placeholder="이름·연락처·이메일·등록번호" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="추천 순위 검색" />
            </span>
            <Btn disabled={!data.ranked.length} onClick={downloadCsv}><Download className="h-4 w-4" /> 엑셀(CSV)</Btn>
          </div>
        </div>
        {data.ranked.length === 0 ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">아직 추천으로 등록한 사람이 없어요.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">순위</th>
                  <th className="py-2 pr-3 font-medium">이름</th>
                  <th className="py-2 pr-3 font-medium">순위판 이름표</th>
                  <th className="py-2 pr-3 font-medium">연락처</th>
                  <th className="py-2 pr-3 font-medium">이메일</th>
                  <th className="py-2 pr-3 text-right font-medium">추천 인원</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.recordId} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 tabular-nums font-semibold">{r.rank}</td>
                    <td className="py-2 pr-3">
                      {r.name || "-"}
                      {r.rewarded && <span className="ml-2 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-600">혜택 대상</span>}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.label}</td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">{r.phone || "-"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.email || "-"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">{r.count.toLocaleString()}명</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="mt-4 text-center text-sm text-muted-foreground">검색 결과가 없어요.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
