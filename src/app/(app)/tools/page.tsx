"use client";

/**
 * 도구 — UTM 빌더 · 미디어 · 이벤트 택소노미를 한 메뉴의 탭으로(2026-10-17).
 * UTM 선택지(source·medium·campaign 값)는 UTM 빌더 안 "선택지 관리"에서 고친다(2026-10-29).
 *
 * 사이드바에 작은 도구가 하나씩 늘어나면 정작 매일 쓰는 메뉴가 묻힌다. 셋 다 "캠페인을 만들 때 옆에
 * 두고 쓰는 것" 이라 한 자리에 모은다. 예전 주소(/utm-builder, /media)도 그대로 열린다 —
 * 공유해 둔 링크와 즐겨찾기가 깨지지 않게, 화면은 같은 컴포넌트를 쓴다.
 */
import { BookOpen, ImageIcon, Link2 } from "lucide-react";
import { PageTabs } from "@/components/ui/page-layout";
import { useQueryTab } from "@/components/ui/use-query-tab";
import UTMBuilderPage from "../utm-builder/page";
import MediaPage from "../media/page";
import TaxonomyTab from "./TaxonomyTab";

const TABS = [
  { id: "utm", label: "UTM 빌더", icon: Link2 },
  { id: "media", label: "미디어", icon: ImageIcon },
  { id: "taxonomy", label: "측정 이벤트", icon: BookOpen },
] as const;
type TabId = (typeof TABS)[number]["id"];


export default function ToolsPage() {
  const [tab, select] = useQueryTab<TabId>(TABS.map(t => t.id), "utm");

  return (
    <div>
      <PageTabs label="도구" value={tab} onChange={select} options={TABS} className="px-4 sm:px-6 lg:px-8" />
      {tab === "utm" && <UTMBuilderPage />}
      {tab === "media" && <MediaPage />}
      {tab === "taxonomy" && (
        <div className="p-4 sm:p-6 lg:p-8">
          <TaxonomyTab onOpenUtm={() => { setTab("utm"); router.replace("/tools?tab=utm&manage=1", { scroll: false }); }} />
        </div>
      )}
    </div>
  );
}
