import { WorkspaceProvider } from "@/contexts/workspace";
import { Sidebar } from "@/components/layout/sidebar";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { WorkspaceGate } from "./workspace-gate";
import { getExpoCapabilities } from "@/lib/expo/capability";
import { probeExpoSchema } from "@/lib/expo/schema-probe";

/**
 * **요청마다** 홈페이지 기능 준비 상태를 확인한다.
 *
 * 이게 없으면 Next 가 이 레이아웃을 빌드 결과에 굳혀 버린다 — 그러면 스키마를 적용하고
 * 플래그를 켠 뒤에도 **메뉴가 안 나타나고**, 반대로 껐는데 남아 있을 수도 있다.
 * 그 상태는 "왜 안 보이지" 로 시작해 한참 헤매는 종류의 문제다.
 *
 * 비용은 거의 없다: 플래그가 안 맞으면 `getExpoCapabilities` 가 카탈로그를 조회하지 않고
 * 즉시 답하고(순수 문자열 비교), 맞을 때의 조회는 30초 캐시를 공유한다.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  /**
   * 서버에서 판정해 prop 으로 내린다. `NEXT_PUBLIC_*` 플래그를 만들지 않고, 클라이언트가
   * 준비 상태를 조회하지도 않는다 — 아직 공개 전인 기능의 존재를 브라우저에 알릴 이유가 없다.
   */
  const caps = await getExpoCapabilities({ probe: probeExpoSchema });

  return (
    <WorkspaceProvider expoHomepageEnabled={caps.admin}>
      <ConfirmProvider>
        <div className="flex h-screen bg-muted print:block print:h-auto print:bg-white">
          {/*
            메뉴를 숨기는 것은 **인가가 아니다.** 홈페이지 레이아웃과 모든 API·공개
            핸들러가 각자 다시 게이트를 통과해야 한다.
          */}
          <div className="print:hidden">
            <Sidebar expoHomepageEnabled={caps.admin} />
          </div>
          <main className="flex-1 overflow-y-auto bg-background rounded-2xl shadow-sm mt-16 mb-2 mx-2 pb-24 lg:pb-0 lg:mt-2 lg:mr-2 lg:ml-64 print:m-0 print:overflow-visible print:rounded-none print:shadow-none print:pb-0">
            <WorkspaceGate>{children}</WorkspaceGate>
          </main>
        </div>
      </ConfirmProvider>
    </WorkspaceProvider>
  );
}
