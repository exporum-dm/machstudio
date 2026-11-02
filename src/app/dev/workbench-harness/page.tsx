"use client";

import { notFound, useSearchParams } from "next/navigation";
import CollectPage from "@/app/(app)/collect/page";
import CompetitionPage from "@/app/(app)/competition/page";
import DetailPage from "@/app/(app)/detail-page/page";
import WebinarPage from "@/app/(app)/webinar/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import PrRoomPage from "@/app/(app)/brief/page";
import { WorkspaceProvider } from "@/contexts/workspace";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

if (process.env.NODE_ENV === "production") notFound();

/** 실제 등록 화면을 가짜 API 응답으로 검증한다. 운영 환경에는 열리지 않는다. */
export default function WorkbenchHarness() {
  const view = useSearchParams().get("screen");
  return <WorkspaceProvider><ConfirmProvider><main className="min-h-screen bg-background">{
    view === "competition" ? <CompetitionPage /> : view === "detail" ? <DetailPage /> : view === "webinar" ? <WebinarPage /> : view === "analytics" ? <AnalyticsPage /> : view === "pr" ? <PrRoomPage /> : <CollectPage />
  }</main></ConfirmProvider></WorkspaceProvider>;
}
