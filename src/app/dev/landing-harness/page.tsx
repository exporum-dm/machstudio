"use client";

/**
 * 랜딩 뷰 검증용 하니스 — **개발 환경 전용**(프로덕션 404).
 *
 * 랜딩은 실제 웨비나 + `landingPage.enabled` + 세션 데이터가 다 있어야 뜬다. 그래서 카드 크기·
 * 텍스트 위계·상세 팝업 같은 **눈으로 봐야 아는 것**을 확인하려면 DB 를 고치거나 로그인해야 했다.
 * mountLanding 은 payload 를 인자로 받는 순수 함수라, 목업 하나만 있으면 그대로 띄울 수 있다.
 *
 * 이 하니스가 답하는 질문:
 *   · 연사 카드에서 이름·회사가 읽히는 크기인가, '자세히 보기' 가 오른쪽 하단에 있는가
 *   · 카드를 누르면 팝업이 뜨고 그 안에 **로고**가 보이는가
 *   · 로고가 타임테이블과 팝업에서 **같은 크기**인가(webinar-logo.ts 규격)
 *   · **섹션별 배경 모드**가 실제로 갈리는가, 라이트에서 글자·카드·선이 읽히는가
 *     (`?bg=light` / `?bg=dark` / `?bg=mix` · `?lightbg=%23fff5e6` · `?darkbg=%231a0f2e`)
 *   · 세션·타임테이블 구간에 스크롤이 걸리면 **키컬러로 바뀌는 전환**이 그대로인가
 */

import { useEffect, useRef } from "react";
import { notFound } from "next/navigation";
import { mountLanding } from "@/lib/landing/mount";
import type { LandingWebinar } from "@/lib/landing/types";

/**
 * 로고는 **절대 http(s) URL** 이어야 한다 — h() 의 URL_ATTRS 가드가 src 를 safeHttpUrl 로
 * 통과시키는데 그 함수는 `new URL()` 파싱을 요구해서 data: URI 도 상대경로도 지운다.
 * 랜딩이 파트너 도메인에 직접 마운트되기 때문에 둔 방어라, 하니스가 규칙에 맞춰야 한다.
 * (실제 로고는 Supabase 스토리지의 절대 https URL 이라 이 조건을 이미 만족한다.)
 * 그래서 MOCK 을 모듈 스코프에 두지 못하고 마운트 시점에 origin 을 붙여 만든다.
 */
type BgPreset = "light" | "dark" | "mix";

/** ?bg=mix — 라이트와 다크를 번갈아 두어 경계와 지브라를 한 화면에서 본다. */
function sectionBgFor(preset: BgPreset) {
  if (preset === "mix") {
    /* faq 와 sponsors 를 둘 다 light 로 둔다 — FAQ 다음에 오는 지브라 교대(mount 가 FAQ 슬롯
       뒤에서 손으로 이어 주는 자리)가 실제로 톤 차이를 만드는지 여기서 눈으로 본다. */
    return { hero: "dark", intro: "light", sessions: "dark", programs: "light",
             audience: "dark", highlights: "light", join: "light", faq: "light",
             sponsors: "light" } as const;
  }
  return { hero: preset, intro: preset, sessions: preset, programs: preset,
           audience: preset, highlights: preset, join: preset, faq: preset,
           sponsors: preset } as const;
}

const mockWebinar = (origin: string, bg: BgPreset, lightBg: string, darkBg: string): LandingWebinar => ({
  id: "harness",
  name: "2026 스마트테크 코리아 마케팅 웨비나",
  slug: "harness",
  description: "AI 마케팅 자동화의 최신 트렌드와, 전시·웨비나 리드를 매출로 잇는 실전 전략.",
  liveStartAt: "2026-08-20T10:00:00.000Z",
  theme: { accentColor: "#6d28d9", ...(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("radius") ? { borderRadius: new URLSearchParams(window.location.search).get("radius") as string } : {}) },
  status: "scheduled",
  canRegister: true,
  entryOpen: false,
  config: {
    landingPage: {
      enabled: true,
      colors: { lightBg, darkBg },
      sectionBg: sectionBgFor(bg),
      titleLines: ["리드를 매출로", "잇는 웨비나 운영"],
      detailPopup: true,
      /** 새 섹션 — 머리글을 비워 기본 문구가 나오는지, 아이콘 유무가 섞였을 때를 함께 본다. */
      audience: {
        enabled: true,
        title: "",
        items: [
          { icon: "", title: "미국 시장 진출을 준비하는 브랜드 담당자", description: "전시 참가는 결정했지만 후속 세일즈 설계가 막막한 분" },
          { icon: "🎯", title: "전시·웨비나 리드를 매출로 잇고 싶은 마케터", description: "" },
          { icon: "", title: "B2B 아웃바운드를 처음 세팅하는 팀", description: "무엇부터 손대야 할지 순서를 잡고 싶은 분\n(줄바꿈도 그대로 나갑니다)" },
        ],
      },
      sessions: { enabled: true },
      timetable: { enabled: true },
      // 지브라(같은 모드가 연달아 올 때의 톤 교대)를 보려면 섹션이 여러 개여야 한다.
      programs: {
        enabled: true,
        items: [
          { icon: "01", title: "리드 수집 설계", description: "폼·랜딩·추적을 한 벌로 맞춥니다." },
          { icon: "02", title: "후속 시퀀스", description: "등록 직후 72시간이 전환을 만듭니다." },
        ],
      },
      highlights: {
        enabled: true,
        items: [
          { title: "실제 화면으로", description: "슬라이드가 아니라 돌아가는 화면을 봅니다." },
          { title: "질문 그 자리에서", description: "실시간 Q&A 로 막힌 지점을 풉니다." },
          { title: "자료 제공", description: "종료 후 요약자료를 보내드립니다." },
        ],
      },
      // 아코디언 모션은 FAQ 와 타임테이블이 같은 헬퍼를 쓴다 — 둘 다 켜서 함께 확인한다.
      faq: {
        enabled: true,
        items: [
          { category: "참가", question: "다시보기가 제공되나요?", answer: "종료 후 영상 링크를 이메일로 보내드립니다." },
          { category: "참가", question: "모바일에서도 볼 수 있나요?", answer: "네, 브라우저만 있으면 됩니다.\n앱 설치는 필요하지 않습니다." },
          { category: "등록", question: "등록을 취소할 수 있나요?", answer: "문의 메일로 알려주시면 처리해드립니다." },
        ],
      },
      /**
       * 최하단 로고 벽 — 한 화면에서 네 경우를 다 본다:
       * 로고+링크 / 로고만 / **로고 없이 이름만**(글자 칩) / tier 없는 묶음.
       * 로고가 흰 판 위에서 같은 슬롯에 정렬되는지, 다크 배경에서 사라지지 않는지가 확인 대상.
       */
      sponsors: {
        enabled: true,
        title: "",
        items: [
          { tier: "주최", name: "엑스포럼", logoUrl: `${origin}/next.svg`, url: "https://www.exporum.com" },
          { tier: "주관", name: "머신스튜디오", logoUrl: `${origin}/vercel.svg`, url: "" },
          { tier: "후원", name: "Northwind Partners", logoUrl: "", url: "https://example.com" },
          { tier: "후원", name: "ACME Corp", logoUrl: `${origin}/next.svg`, url: "" },
          { tier: "", name: "협력 미디어", logoUrl: "", url: "" },
        ],
      },
    },
  },
  sessions: [
    {
      id: "s1", number: 1, type: "session",
      title: "AI 마케팅 자동화, 어디까지 왔나",
      speaker: "김지수", speakerCompany: "ACME Corp",
      speakerRole: "그로스 리드",
      speakerBio: "10년간 B2B SaaS 그로스를 담당했고, 웨비나·전시 리드 파이프라인을 설계했습니다.",
      speakerPhotoUrl: null,
      logoUrl: `${origin}/next.svg`,
      description: "실제로 돌아가는 자동화와 그렇지 않은 것을 사례로 가릅니다.\n리드 스코어링·세그먼트 분기·후속 시퀀스를 실제 화면으로 보여드립니다.",
      speakerHomepage: "https://www.exporum.com/team",
      speakerLinks: [
        "https://www.linkedin.com/in/example",
        "https://x.com/example",
        "https://brunch.co.kr/@example",
        "javascript:alert(1)",
      ],
      startAt: "2026-08-20T10:00:00.000Z", endAt: "2026-08-20T10:40:00.000Z",
    },
    {
      id: "s2", number: 2, type: "session",
      title: "전시 리드를 매출로 잇는 후속 설계",
      speaker: "박민준", speakerCompany: "Northwind Partners",
      speakerRole: "파트너",
      speakerBio: "전시·컨퍼런스 리드의 후속 시퀀스를 설계합니다.",
      speakerPhotoUrl: null,
      logoUrl: `${origin}/next.svg`,
      description: null,
      speakerHomepage: null,
      speakerLinks: null,
      startAt: "2026-08-20T10:40:00.000Z", endAt: "2026-08-20T11:20:00.000Z",
    },
    {
      // 펼칠 것이 없는 행 — details 가 아니라 정적 줄로 그려져야 한다.
      id: "s3", number: 3, type: "break",
      title: "휴식",
      speaker: null, speakerCompany: null,
      speakerBio: null, speakerPhotoUrl: null, logoUrl: null, description: null,
      speakerHomepage: null, speakerLinks: null,
      startAt: "2026-08-20T11:20:00.000Z", endAt: "2026-08-20T11:30:00.000Z",
    },
  ] as unknown as LandingWebinar["sessions"],
});

export default function LandingHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const q = new URLSearchParams(window.location.search);
    const raw = q.get("bg");
    const bg: BgPreset = raw === "light" || raw === "mix" ? raw : "dark";
    const handle = mountLanding({
      mount: host,
      webinar: mockWebinar(
        window.location.origin,
        bg,
        q.get("lightbg") || "#f6f8ff",
        q.get("darkbg") || "#06080d",
      ),
      embedded: false,
      isPreview: true, // 부작용(추적·전송) 차단
      origin: window.location.origin,
    });
    return () => handle.destroy();
  }, []);

  return <div ref={hostRef} />;
}
