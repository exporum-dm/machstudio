"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Award, BarChart3, FileText, Loader2, Scale, Send, Share2, Trophy, Users, Vote } from "lucide-react";
import { PageTabs } from "@/components/ui/page-layout";
import { useQueryTab } from "@/components/ui/use-query-tab";
import { toast } from "sonner";
import { InlineError } from "@/components/ui/inline-error";
import { COMPETITION_PHASE_META, resolveCompetitionStatus } from "@/lib/competition-status";
import type { CompetitionConfig } from "@/lib/competition-config";
import BasicInfoTab from "./BasicInfoTab";
import NoticePageTab from "./NoticePageTab";
import EntryFormTab from "./EntryFormTab";
import EntriesTab from "./EntriesTab";
import DeployTab from "./DeployTab";
import VoteSettingsTab, { type RoundDto } from "./VoteSettingsTab";
import JudgesTab from "./JudgesTab";
import TallyTab from "./TallyTab";
import AwardsTab from "./AwardsTab";
import CompetitionLifecycle from "./CompetitionLifecycle";


export interface CompetitionDetail {
  id: string;
  workspaceId?: string;
  name: string;
  slug: string;
  description: string | null;
  phaseOverride: string | null;
  recruitOpenAt: string | null;
  recruitCloseAt: string | null;
  theme: Record<string, string>;
  config: CompetitionConfig;
  maxEntriesPerApplicant: number;
  previewToken: string | null;
  showToken: string | null;
  showConfig: unknown;
  resultPublishedAt: string | null;
}

const TABS = [
  { id: "basic", label: "기본정보", icon: Trophy },
  { id: "notice", label: "공고 페이지", icon: FileText },
  { id: "form", label: "신청 폼", icon: Send },
  { id: "entries", label: "참가작", icon: Users },
  { id: "vote", label: "투표 설정", icon: Vote },
  { id: "judges", label: "심사단", icon: Scale },
  { id: "tally", label: "집계", icon: BarChart3 },
  { id: "awards", label: "시상 · 결과", icon: Award },
  { id: "deploy", label: "배포", icon: Share2 },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function CompetitionDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [competition, setCompetition] = useState<CompetitionDetail | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const [rounds, setRounds] = useState<RoundDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useQueryTab<TabId>(TABS.map(t => t.id), "basic");

  const fetchCompetition = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/competitions/by-slug/${encodeURIComponent(slug)}`);
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setCompetition(data.competition);
      setEntryCount(data.entryCount ?? 0);
      setRounds(data.rounds ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void Promise.resolve().then(fetchCompetition); }, [fetchCompetition]);

  const patch = useCallback(async (body: Record<string, unknown>, successMessage?: string) => {
    if (!competition) return false;
    const res = await fetch(`/api/competitions/${competition.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "저장 실패"); return false; }
    setCompetition((prev) => (prev ? { ...prev, ...data.competition } : prev));
    if (successMessage) toast.success(successMessage);
    return true;
  }, [competition]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError || !competition) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <InlineError message="대회를 불러오지 못했어요" onRetry={fetchCompetition} />
      </div>
    );
  }

  const status = resolveCompetitionStatus({ ...competition, rounds });
  const meta = COMPETITION_PHASE_META[status.phase];

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <div>
        <Link
          href="/competition"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          대회 목록
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{competition.name}</h1>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}>{meta.label}</span>
          {status.isOverridden && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">수동 전환</span>
          )}
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">/{competition.slug}</p>
      </div>

      <CompetitionLifecycle competition={{ ...competition, rounds }} patch={patch} />

      <PageTabs label="대회 메뉴" value={tab} onChange={setTab} options={TABS.map(t => ({ ...t, badge: t.id === "entries" && entryCount > 0 ? entryCount : undefined }))} />

      {tab === "basic" && <BasicInfoTab competition={competition} rounds={rounds} patch={patch} />}
      {tab === "notice" && <NoticePageTab competition={competition} rounds={rounds} patch={patch} />}
      {tab === "form" && <EntryFormTab competition={competition} patch={patch} workspaceId={competition.workspaceId} />}
      {tab === "entries" && <EntriesTab competition={competition} onCountChange={setEntryCount} />}
      {tab === "vote" && <VoteSettingsTab competition={competition} rounds={rounds} onRoundsChange={setRounds} patch={patch} />}
      {tab === "judges" && <JudgesTab competition={competition} rounds={rounds} onRoundsChange={setRounds} />}
      {tab === "tally" && <TallyTab competition={competition} rounds={rounds} />}
      {tab === "awards" && <AwardsTab competition={competition} patch={patch} onPublishedChange={(resultPublishedAt) => setCompetition((prev) => prev ? { ...prev, resultPublishedAt } : prev)} />}
      {tab === "deploy" && <DeployTab competition={competition} patch={patch} />}
    </div>
  );
}
