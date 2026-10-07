"use client";

/**
 * 상세페이지 **편집 화면** 하니스 — 개발 환경 전용(프로덕션 404).
 *
 * 편집 화면은 로그인 뒤에 있어서 레이아웃(특히 모바일 폭)을 보려면 매번 로그인·페이지 생성이
 * 필요하다. notice-editor-harness 와 같은 방식으로 편집기만 격리해 태운다.
 * save 는 저장하지 않는다.
 */

import { useCallback, useMemo } from "react";
import { notFound } from "next/navigation";
import { NoticeEditor, type NoticeEditorHost } from "@/app/(app)/competition/[slug]/NoticePageTab";
import {
  detailPageNoticeCompetition,
  initialDetailPageConfig,
  normalizeDetailPageSettings,
  type DetailPageSettings,
} from "@/lib/detail-page/config";

const NAME = "2026 바이어 상담회 안내";

export default function DetailPageHarness() {
  if (process.env.NODE_ENV === "production") notFound();

  const config = useMemo(() => {
    const base = initialDetailPageConfig(NAME);
    return {
      ...base,
      noticePage: {
        ...base.noticePage,
        hero: { brand: "KOREA EXPO", titleLines: ["바이어 상담회", "Meet the Buyers."], subtitle: "해외 바이어와 1:1 상담", ctaLabel: "사전등록 하기" },
        concept: { enabled: true, kicker: "ABOUT", headline: "해외 진출의 첫 미팅", highlight: "여기서 시작하세요", body: "엄선된 바이어와 만나는 하루." },
        faq: { enabled: true, title: "자주 묻는 질문", items: [{ question: "참가비가 있나요?", answer: "무료입니다." }] },
        countdown: { enabled: true, title: "신청 마감까지" },
        banner: { enabled: true, kicker: "This is the Energy", title: "SEE WHAT IT FEELS LIKE." },
        split: { enabled: true, title: "FEEL THE K-POP ENERGY!", body: "A room full of music, movement and K-pop fans.", image: { url: "https://ytfjlegolgfycowfxivd.supabase.co/storage/v1/object/public/webinar-assets/cmp6zn9t600005csaxd2uno40/cmsskg8540000aomyno33x0i9/notice/e6beb557-11ec-4f3f-862b-3710002aff2f.jpg" }, imageSide: "left" },
        video: { enabled: true, kicker: "Practice before class", title: "WATCH. PRACTICE. DANCE.", url: "https://youtube.com/shorts/aqz-KE-bpKQ", captionLabel: "Class Song", captionTitle: "LNGSHOT Saucin", captionBody: "You don't need to memorize everything." },
        form: { enabled: true, title: "READY TO DANCE?", description: "Fill out the form below.", sourceId: "cmharnessform0000000000" },
        sectionMedia: { banner: { url: "https://ytfjlegolgfycowfxivd.supabase.co/storage/v1/object/public/webinar-assets/cmp6zn9t600005csaxd2uno40/cmsskg8540000aomyno33x0i9/notice/e6beb557-11ec-4f3f-862b-3710002aff2f.jpg", scrim: 60 } },
      },
      page: { ctaUrl: "https://example.com/register", ctaNewTab: true, deadline: "2026-12-31T23:59:00+09:00" },
    };
  }, []);
  const settings = useMemo(() => normalizeDetailPageSettings(config), [config]);

  const buildPreview = useCallback(
    (theme: Record<string, string>, next: DetailPageSettings | null) =>
      detailPageNoticeCompetition({ id: "harness", name: NAME, theme, settings: next ?? settings }),
    [settings],
  );

  const host: NoticeEditorHost = useMemo(
    () => ({
      kind: "page",
      config,
      theme: { accentColor: "#6d28d9" },
      uploadUrl: "/api/detail-pages/harness/media",
      rounds: null,
      status: null,
      fixedLanguageLabel: null,
      pageSettings: settings,
      formSources: [{ id: "cmharnessform0000000000", name: "K-POP 원데이 클래스 등록" }],
      buildPreview,
      save: async () => true,
    }),
    [config, settings, buildPreview],
  );

  return (
    <div className="p-4 sm:p-6">
      <NoticeEditor host={host} />
    </div>
  );
}
