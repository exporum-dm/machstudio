"use client";

/**
 * 도구 — UTM 빌더 · 미디어 · 이벤트 택소노미를 한 메뉴의 탭으로(2026-10-17).
 * UTM 선택지(source·medium·campaign 값)는 UTM 빌더 안 "선택지 관리"에서 고친다(2026-10-29).
 *
 * 사이드바에 작은 도구가 하나씩 늘어나면 정작 매일 쓰는 메뉴가 묻힌다. 셋 다 "캠페인을 만들 때 옆에
 * 두고 쓰는 것" 이라 한 자리에 모은다. 예전 주소(/utm-builder, /media)도 그대로 열린다 —
 * 공유해 둔 링크와 즐겨찾기가 깨지지 않게, 화면은 같은 컴포넌트를 쓴다.
 */
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { BookOpen, ImageIcon, Link2 } from "lucide-react";
import UTMBuilderPage from "../utm-builder/page";
import MediaPage from "../media/page";
import TaxonomyTab from "./TaxonomyTab";

const TABS = [
  { id: "utm", label: "UTM 빌더", icon: Link2 },
  { id: "media", label: "미디어", icon: ImageIcon },
  { id: "taxonomy", label: "이벤트 택소노미", icon: BookOpen },
] as const;
type TabId = (typeof TABS)[number]["id"];

const spring = { type: "spring" as const, stiffness: 420, damping: 34 };

export default function ToolsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>(() => TABS.find((t) => t.id === searchParams.get("tab"))?.id ?? "utm");

  const select = (id: TabId) => {
    setTab(id);
    // 주소에 남겨 둔다 — 새로고침·공유해도 같은 탭이 열리게.
    router.replace(`/tools?tab=${id}`, { scroll: false });
  };

  return (
    <div>
      <div className="sticky top-0 z-20 flex flex-wrap gap-1 border-b border-border bg-background px-4 pt-4 sm:px-6 lg:px-8">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => select(id)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                active ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {active && <motion.span layoutId="tools-tab" transition={spring} className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-violet-500" />}
            </button>
          );
        })}
      </div>
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
