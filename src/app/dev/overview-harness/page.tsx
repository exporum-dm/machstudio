"use client";

/**
 * 프로젝트 대시보드 하니스 — 개발 환경 전용(프로덕션 404).
 * 대시보드는 로그인 뒤에 있어 레이아웃(특히 모바일 폭)을 보려면 매번 로그인해야 한다.
 * 데이터 모양은 2026-10-08 Korea Expo 프로젝트 실측값을 줄여 옮겼다.
 */
import { notFound } from "next/navigation";
import { OverviewSections } from "@/app/(app)/dashboard/DashboardClient";
import type { ProjectOverview } from "@/lib/project-overview";

const DATA: ProjectOverview = {
  generatedAt: "2026-10-08T09:21:16.711Z",
  collect: {
    active: [
      { id: "a", name: "2026 Korea Expo LA", mode: "builder", registration: "open", closesAt: "2026-10-21T21:00:00.000Z", total: 15747, today: 3, yesterday: 471, startedAt: "2026-07-20", trend: [120, 340, 210, 180, 260, 300, 410, 380, 520, 610, 700, 650, 800, 900, 1100, 950, 1200, 1300, 1250, 1400, 373, 479, 791, 509, 567, 471, 3], lastAt: "2026-10-08T09:16:12.282Z", checkedIn: null },
      { id: "b", name: "2026 Korea Expo LA Oneday Class", mode: "builder", registration: "open", closesAt: "2026-10-12T07:00:00.000Z", total: 17, today: 3, yesterday: 5, startedAt: "2026-10-01", trend: [0, 0, 0, 0, 9, 5, 3, 0], lastAt: "2026-10-08T09:07:31.539Z", checkedIn: 0 },
    ],
    otherCount: 0,
  },
  ads: {
    active: [
      { id: "f", name: "Korea Expo LA 2026 참관객 전환 캠페인", reportStart: "2026-08-31T15:00:00.000Z", reportEnd: "2026-10-23T15:00:00.000Z", currency: "KRW", platforms: ["META", "GOOGLE"], cost: 6908810.86, impressions: 504150, clicks: 27607, conversions: 7773, lastSyncedAt: "2026-10-07T15:40:13.223Z" },
    ],
    otherCount: 2,
  },
  competitions: {
    active: [
      { id: "c", slug: "la-k-pop", name: "[LA] K-POP Dance Blast Contest", phase: "recruiting", recruitCloseAt: "2026-10-09T07:00:00.000Z", entries: 6, approved: 4, published: 4, advanced: 0, votes: 0 },
    ],
    otherCount: 0,
  },
  webinars: { active: [], otherCount: 1 },
  detailPages: { published: [{ id: "d", name: "Korea Expo LA 2026 K-POP Dance One-point Class", updatedAt: "2026-10-07T05:29:28.275Z" }], otherCount: 0 },
};

export default function OverviewHarness() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <OverviewSections data={DATA} onShare={() => {}} />
    </div>
  );
}
