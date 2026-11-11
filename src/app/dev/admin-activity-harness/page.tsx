import { notFound } from "next/navigation";
import { ActivityCategoryChips, ActivityLogList, type AdminActivityRow } from "@/app/(app)/admin/ActivityLogList";
import { DevLogList } from "@/app/(app)/admin/DevLogList";
import { DEV_LOG_REPO, fetchDevLog } from "@/lib/dev-log";

/**
 * 관리자 활동 로그·개발 로그 하니스(개발 전용).
 * 관리자 페이지는 슈퍼어드민 로그인이 있어야 열려서, 같은 컴포넌트를 모의 기록으로 그린다.
 * 개발 로그는 실제 GitHub 에서 읽는다(공개 저장소).
 */
const at = (iso: string) => new Date(iso);
const ROWS: AdminActivityRow[] = [
  {
    id: "1", action: "webinar.updated", createdAt: at("2026-11-10T02:12:00Z"),
    meta: { webinarId: "w1", details: ["등록 폼 · 항목 이름 ‘업종’ → ‘강연에서 다루었으면 하는 질문’", "등록 폼 · ‘관심 세션’ 선택지 2개 추가", "키 컬러: #6d28d9 → #e11d48", "테두리 둥글기: 기본 → 약간", "랜딩 페이지 · 제목, 히어로 이미지·영상 수정", "라이브 중 등록 · 계속 받기"] },
    workspace: { name: "Exporum" }, user: { email: "kim@exporum.com", name: "김주현" }, source: null,
  },
  {
    id: "2", action: "webinar.updated", createdAt: at("2026-11-09T08:00:05Z"),
    meta: { webinarId: "w1", changes: ["config"] },
    workspace: { name: "Exporum" }, user: { email: "kim@exporum.com", name: "김주현" }, source: null,
  },
  {
    id: "3", action: "records.imported", createdAt: at("2026-11-09T05:30:00Z"),
    meta: { imported: 1204, skipped: 12 },
    workspace: { name: "Exporum" }, user: { email: "lee@exporum.com", name: "이창환" }, source: { name: "2026 서울 인디뷰티쇼 등록" },
  },
  {
    id: "4", action: "webinar.registrations.exported", createdAt: at("2026-11-09T01:02:00Z"),
    meta: { webinarId: "w1", recordCount: 92 },
    workspace: { name: "Exporum" }, user: null, source: null,
  },
];

export default async function AdminActivityHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const devLog = await fetchDevLog(8);
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      <section className="space-y-4">
        <h1 className="text-lg font-semibold">활동 로그</h1>
        <ActivityCategoryChips current="" />
        <ActivityLogList rows={ROWS} names={{ webinars: new Map([["w1", "인디뷰티 글로벌 진출 솔루션 데스크"]]) }} />
      </section>
      <section className="space-y-4">
        <h1 className="text-lg font-semibold">개발 로그</h1>
        <DevLogList entries={devLog.entries} error={devLog.error} repo={DEV_LOG_REPO} deployed={{ sha: "117a495", message: "Merge pull request #63" }} />
      </section>
    </div>
  );
}
