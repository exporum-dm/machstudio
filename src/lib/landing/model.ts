/**
 * 랜딩 파생 로직 — 순수 함수만. React / Next / Prisma 를 import 하지 않는다.
 * (호스트 DOM 임베드 번들에 그대로 들어가므로 브라우저 안전해야 한다.)
 */

export const SAFE_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 좌측 목차 정의 — 실제 노출은 섹션에 내용이 있을 때만. */
export const TOC_DEF = [
  { id: "lnd-about", label: "About" },
  { id: "lnd-sessions", label: "Sessions" },
  { id: "lnd-timetable", label: "Time Table" },
  { id: "lnd-programs", label: "Programs" },
  /* Audience(조건) → Benefits(보상) → Join 순서. 조건으로 걸러낸 다음 보상을 제시하고,
     보상 직후에 참여 방법이 온다. 혜택은 accent-zone 이라 Join 바로 앞이어야 색 전환의
     기세가 살아 있다(mount 주석 참고). */
  { id: "lnd-audience", label: "Audience" },
  { id: "lnd-highlights", label: "Benefits" },
  { id: "lnd-join", label: "Join" },
  { id: "lnd-faq", label: "FAQ" },
  /* 최하단. 읽으러 가는 섹션은 아니지만 목차에 넣는다 — 자기 로고가 어디 실렸는지
     확인하러 오는 파트너에게는 이게 유일한 바로가기다(스크롤 끝까지 내려야 나온다). */
  { id: "lnd-sponsors", label: "Sponsors" },
] as const;

/**
 * 키컬러 위 텍스트 — 브랜드 요청으로 흰색 기본(라이브 페이지의 밝은 버튼 인상과 통일).
 *
 * **계산은 `@/lib/color` 한 곳에 있다.** 여기엔 YIQ 0.78 임계값을 쓰는 네 번째 사본이
 * 있었고, 그게 2026-11 사고의 자리다: YIQ 는 감마를 안 펴서 형광색을 과소평가한다 —
 * 네온 그린·순초록·시안 키컬러가 전부 "밝지 않다"로 분류돼 흰 글자를 받았고,
 * 상세페이지(랜딩)에서 글자가 배경에 녹았다. 정본은 흰 글자의 **실제 대비**를 잰다.
 *
 * 이름은 여기 그대로 둔다 — 랜딩 뷰들(view-hero·view-sections·mount)이 이 이름으로 가져간다.
 */
export { onAccentColor as onPrimaryFor } from "@/lib/color";

/* parseSpeaker 는 webinar-sessions.ts 로 옮겼다 — 랜딩(타임테이블·상세 팝업)뿐 아니라
   대기·라이브 화면의 세션 순서도 같은 규칙으로 "이름 | 소속·직책" 을 그려야 한다.
   재수출해 두는 이유: 랜딩 뷰들이 이 모듈에서 가져오고 있고, 경로를 바꾸는 것과
   규칙을 한 곳으로 모으는 것은 별개의 변경이다. */
export { parseSpeaker } from "@/lib/webinar-sessions";
