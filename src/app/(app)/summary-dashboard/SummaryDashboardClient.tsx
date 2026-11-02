"use client";

import { DashboardNavigation } from "@/components/ui/page-layout";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid, Link2, Loader2, Printer, RefreshCw, Share2, Unlink } from "lucide-react";
import { motion } from "framer-motion";
import { useWorkspace } from "@/contexts/workspace";
import { useWorkspaceChannelColors } from "@/components/ui/use-workspace-channel-colors";
import type { RealtimeReportData } from "../dashboard/RealtimeReport";
import ProjectSummaryCard from "../dashboard/ProjectSummaryCard";
import { toast } from "sonner";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

/** 주간 보고에 붙일 캡처 대신 — 화면 그대로 인쇄해 "PDF로 저장"하면 카드마다 이미 있는 기간·프로젝트명이 그대로 문서에 남는다. */
function formatPrintedAt(date: Date): string {
  const KST = 9 * 60 * 60 * 1000;
  const kst = new Date(date.getTime() + KST);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}.${m}.${d} ${hh}:${mm} KST 생성`;
}

export default function SummaryDashboardClient() {
  const { workspace, isLoading: wsLoading } = useWorkspace();
  const [reports, setReports] = useState<RealtimeReportData[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [share, setShare] = useState<{ shareEnabled: boolean; shareUrl: string | null } | null>(null);
  const [sharing, setSharing] = useState(false);
  const { channelColors, setChannelColorOverride } = useWorkspaceChannelColors(workspace?.id);

  const fetchReports = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/summary-dashboard?workspaceId=${workspace.id}`);
      const data = await res.json().catch(() => null);
      setReports(res.ok ? data.projects ?? [] : []);
      setFetchedAt(new Date());
    } catch (error) {
      console.error("[summary-dashboard] failed", error);
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  const printedAtLabel = useMemo(() => (fetchedAt ? formatPrintedAt(fetchedAt) : ""), [fetchedAt]);

  useEffect(() => {
    void Promise.resolve().then(fetchReports);
  }, [fetchReports]);

  useEffect(() => {
    if (!workspace) return;
    void fetch(`/api/workspace/${workspace.id}/summary-share`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { if (value) setShare(value); });
  }, [workspace]);

  async function copyShareLink() {
    if (!workspace || sharing) return;
    setSharing(true);
    const response = await fetch(`/api/workspace/${workspace.id}/summary-share`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shareEnabled: true }),
    });
    const value = await response.json().catch(() => null);
    setSharing(false);
    if (!response.ok || !value?.shareUrl) return toast.error(value?.error || "공유 링크를 만들지 못했습니다.");
    setShare(value);
    await navigator.clipboard.writeText(value.shareUrl);
    toast.success("읽기 전용 공유 링크를 복사했습니다.");
  }

  async function disableShare() {
    if (!workspace || sharing) return;
    setSharing(true);
    const response = await fetch(`/api/workspace/${workspace.id}/summary-share`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shareEnabled: false }),
    });
    const value = await response.json().catch(() => null);
    setSharing(false);
    if (!response.ok) return toast.error(value?.error || "공유를 중지하지 못했습니다.");
    setShare(value); toast.success("공유 링크를 비활성화했습니다.");
  }

  if (wsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <LayoutGrid className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">워크스페이스를 먼저 선택해주세요</p>
      </div>
    );
  }

  return (
    <div className="summary-dashboard-print space-y-4 p-4 sm:p-6 lg:p-8 print:space-y-2 print:p-0">
      <DashboardNavigation />
      {/*
        세로 A4 유지. 도넛/스파크라인은 화면·인쇄가 같은 recharts 컴포넌트를 쓰고 크기만
        print: 로 줄인다 — 인쇄용으로 별도 마크업을 갈아 끼우는 방식(CSS 토글, JS 분기 둘 다)은
        인쇄 미리보기가 전환을 반영하지 않아 반복적으로 실패했다. 갈아 끼울 게 없으면
        어긋날 수도 없다. 여기 남은 건 페이지 크기/여백뿐이다.
      */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          /* 넓은 화면(>=1024px)에서 인쇄하면 lg:ml-64 사이드바 여백이 인쇄에도 남을 수 있다 — 항상 0으로 고정한다. */
          main { margin: 0 !important; }
        }
      `}</style>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between print:hidden">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">성과 보고</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <p className="text-sm">진행중인 프로젝트의 등록 현황을 한눈에 모아봅니다</p>
            <p className="flex items-center gap-1.5 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500 shadow-sm" />
              범례의 색상 원을 클릭하면 채널 색상을 바꿀 수 있어요
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} transition={spring}
            onClick={() => void copyShareLink()} disabled={sharing}
            className="flex items-center gap-1.5 rounded-xl bg-violet-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-violet-600 disabled:opacity-40"
          >
            {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : share?.shareEnabled ? <Link2 className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
            {share?.shareEnabled ? "공유 링크 복사" : "공유"}
          </motion.button>
          {share?.shareEnabled && <motion.button whileTap={{ scale: 0.96 }} onClick={() => void disableShare()} disabled={sharing} className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-1.5 text-xs text-muted-foreground shadow-sm hover:text-foreground disabled:opacity-40"><Unlink className="h-3.5 w-3.5" />공유 중지</motion.button>}
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={() => window.print()}
            disabled={!reports || reports.length === 0}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            title="PDF로 내보내기 (인쇄 대화상자에서 'PDF로 저장' 선택)"
          >
            <Printer className="h-3.5 w-3.5" />
            PDF 내보내기
          </motion.button>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={() => void fetchReports()}
            className="rounded-xl border border-border p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
            title="새로고침"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </motion.button>
        </div>
      </div>

      {/* 인쇄에만 보이는 보고서 헤더 — 화면 UI 없이 제목·생성 시각만 문서에 남긴다 */}
      <div className="hidden print:block">
        <h1 className="text-base font-semibold">성과 보고</h1>
        {printedAtLabel && <p className="mt-0.5 text-[10px] text-muted-foreground">{printedAtLabel}</p>}
      </div>

      {loading && !reports ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !reports || reports.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <LayoutGrid className="mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            진행중으로 표시된 프로젝트가 없습니다
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            등록 페이지에서 폼을 켜두면 이곳에 표시됩니다
          </p>
        </div>
      ) : (
        <div className="space-y-4 print:space-y-2">
          {reports.map((report) => (
            <div key={report.project.id} className="break-inside-avoid">
              <ProjectSummaryCard data={report} channelColors={channelColors} onChannelColorChange={setChannelColorOverride} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
