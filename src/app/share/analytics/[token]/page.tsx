"use client";

import { useCallback, useEffect, useState, use } from "react";
import { BarChart3, CalendarDays, Loader2, Lock } from "lucide-react";
import { formatKstDateTime } from "@/lib/datetime";

interface PublicProject {
  id: string;
  name: string;
  workspaceName: string;
}

interface MediaRow {
  sourceType: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cvr: number;
}

interface CampaignRow {
  sourceType: string;
  campaignName: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
}

interface DailyPoint {
  date: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

interface AnalyticsData {
  totals: {
    cost: number;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cvr: number;
    cpc: number;
    cpm: number;
    costPerConversion: number;
    reach: number;
  };
  mediaSummary: MediaRow[];
  campaignSummary: CampaignRow[];
  dailyTrend: DailyPoint[];
  rangeDays: number;
  /** 서버가 정한 집계 기간 — 운영자가 공유 모달에서 고른 값이다(src/lib/share-range.ts). */
  rangeLabel?: string;
  rangeFrom?: string;
  rangeTo?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  GOOGLE: "Google",
  META: "Meta",
  MANUAL: "수동",
};

function formatKRW(n: number | undefined | null) {
  if (n == null) return "—";
  return `₩${Math.round(n).toLocaleString()}`;
}

function formatNumber(n: number | undefined | null) {
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}

function formatPct(n: number | undefined | null) {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

export default function AnalyticsSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [project, setProject] = useState<PublicProject | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/public/analytics/${token}`);
      if (res.status === 401) {
        const data = await res.json().catch(() => ({}));
        if (data?.requiresPassword) {
          setRequiresPassword(true);
          return;
        }
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "공유된 분석을 찾을 수 없어요");
        return;
      }
      setRequiresPassword(false);
      setProject(data.project);

      const password = sessionStorage.getItem(`share_password_${token}`) ?? undefined;
      const dataRes = await fetch("/api/public/analytics-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const dataPayload = await dataRes.json().catch(() => ({}));
      if (!dataRes.ok) {
        setError(dataPayload.error ?? "데이터를 불러올 수 없어요");
        return;
      }
      setAnalytics(dataPayload as AnalyticsData);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const submitPassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput) return;
    setVerifying(true);
    setPasswordError(null);
    try {
      const res = await fetch(`/api/public/analytics/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPasswordError(data.error ?? "비밀번호가 일치하지 않아요");
        return;
      }
      sessionStorage.setItem(`share_password_${token}`, passwordInput);
      await loadAll();
    } finally {
      setVerifying(false);
    }
  }, [passwordInput, token, loadAll]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (requiresPassword) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-medium">비밀번호로 보호된 공유 페이지</h1>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">접근하려면 공유 받은 비밀번호를 입력해주세요.</p>
          <form onSubmit={submitPassword} className="space-y-3">
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="비밀번호"
              autoFocus
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
            {passwordError && <p className="text-xs text-rose-500">{passwordError}</p>}
            <button
              type="submit"
              disabled={!passwordInput || verifying}
              className="w-full rounded-xl bg-violet-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
            >
              {verifying ? "확인 중…" : "확인"}
            </button>
          </form>
        </div>
      </div>
    );
  }
  if (error || !project || !analytics) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <BarChart3 className="w-12 h-12 text-muted-foreground/20 mb-3" />
        <p className="text-sm text-muted-foreground">{error ?? "데이터가 없어요"}</p>
      </div>
    );
  }

  const maxDailyCost = Math.max(...analytics.dailyTrend.map((d) => d.cost), 1);
  const totalCost = analytics.mediaSummary.reduce((s, m) => s + m.cost, 0) || 1;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{project.workspaceName} · {project.name}</p>
            <h1 className="text-2xl font-semibold mt-1">광고 성과</h1>
            {/* 어느 기간의 숫자인지가 숫자 자체만큼 중요하다 — 머리말에서 바로 읽히게 둔다. */}
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              <span className="tabular-nums text-foreground">
                {analytics.rangeFrom && analytics.rangeTo
                  ? `${analytics.rangeFrom} ~ ${analytics.rangeTo}`
                  : `최근 ${analytics.rangeDays}일`}
              </span>
              {analytics.rangeLabel && <span>· {analytics.rangeLabel}</span>}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" /> 읽기 전용
          </span>
        </header>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="지출" value={formatKRW(analytics.totals.cost)} />
          <KpiCard label="클릭" value={formatNumber(analytics.totals.clicks)} sub={`CTR ${formatPct(analytics.totals.ctr)}`} />
          <KpiCard label="전환" value={formatNumber(analytics.totals.conversions)} sub={`CVR ${formatPct(analytics.totals.cvr)}`} />
          <KpiCard label="도달" value={formatNumber(analytics.totals.reach)} sub="누적 도달(중복 포함)" />
          <KpiCard label="결과당 비용" value={formatKRW(analytics.totals.costPerConversion)} />
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-medium mb-4">매체별 비중</h2>
          {analytics.mediaSummary.length === 0 ? (
            <p className="text-xs text-muted-foreground">데이터 없음</p>
          ) : (
            <div className="space-y-2.5">
              {analytics.mediaSummary.map((m) => {
                const pct = (m.cost / totalCost) * 100;
                return (
                  <div key={m.sourceType} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{SOURCE_LABEL[m.sourceType] ?? m.sourceType}</span>
                      <span className="tabular-nums text-muted-foreground">{formatKRW(m.cost)} · {pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                      <div className="h-full bg-violet-500/70" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-medium mb-4">일자별 지출</h2>
          {analytics.dailyTrend.length === 0 ? (
            <p className="text-xs text-muted-foreground">데이터 없음</p>
          ) : (
            <div className="flex items-end gap-0.5 h-32">
              {analytics.dailyTrend.map((d) => (
                <div
                  key={d.date}
                  className="flex-1 bg-violet-500/60 rounded-t-sm"
                  style={{ height: `${(d.cost / maxDailyCost) * 100}%` }}
                  title={`${d.date}: ${formatKRW(d.cost)}`}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-medium mb-4">상위 캠페인</h2>
          {analytics.campaignSummary.length === 0 ? (
            <p className="text-xs text-muted-foreground">데이터 없음</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3 font-medium">매체</th>
                    <th className="py-2 pr-3 font-medium">캠페인</th>
                    <th className="py-2 pr-3 font-medium text-right">지출</th>
                    <th className="py-2 pr-3 font-medium text-right">클릭</th>
                    <th className="py-2 pr-3 font-medium text-right">전환</th>
                    <th className="py-2 font-medium text-right">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.campaignSummary.slice(0, 10).map((c) => (
                    <tr key={`${c.sourceType}:${c.campaignName}`} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 text-muted-foreground">{SOURCE_LABEL[c.sourceType] ?? c.sourceType}</td>
                      <td className="py-2 pr-3 truncate max-w-[280px]">{c.campaignName}</td>
                      <td className="py-2 pr-3 tabular-nums text-right">{formatKRW(c.cost)}</td>
                      <td className="py-2 pr-3 tabular-nums text-right">{formatNumber(c.clicks)}</td>
                      <td className="py-2 pr-3 tabular-nums text-right">{formatNumber(c.conversions)}</td>
                      <td className="py-2 tabular-nums text-right">{formatPct(c.ctr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="text-center pt-8 text-[11px] text-muted-foreground">
          이 페이지는 읽기 전용 공유 보기입니다 · 마지막 조회 {formatKstDateTime(new Date().toISOString())} KST
        </footer>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
