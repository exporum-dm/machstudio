import { PageHeader, WebsiteNavigation } from "@/components/ui/page-layout";
import { Suspense } from "react";
import { ExpoProjectListLoader } from "@/components/expo/ExpoProjectListLoader";

/**
 * 홈페이지 목록 — **읽는 영역**이다.
 *
 * 시선 흐름을 헤드라인 → 짧은 설명 → 목록 순으로 둔다. 지표 카드를 늘어놓지 않는다:
 * 이 화면에서 내릴 결정은 "어느 홈페이지를 열까" 하나다.
 *
 * 목록 자체는 클라이언트에서 불러온다 — 현재 전시가 클라이언트 저장소에서
 * 하이드레이션되기 때문이다(그 함정은 로더 머리말에 적었다).
 */
export const dynamic = "force-dynamic";

export default function HomepageListPage() {
  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <WebsiteNavigation />
      <PageHeader title="홈페이지" description="페이지를 구성하고 미리보기로 확인한 뒤 완성된 페이지를 발행합니다." />
      {/* useSearchParams 를 쓰는 로더라 경계가 필요하다. */}
      <Suspense fallback={null}>
        <ExpoProjectListLoader />
      </Suspense>
    </div>
  );
}
