/**
 * 랜딩 상세페이지 데이터 형태 — 단독 페이지 / 어드민 미리보기 / 외부 사이트 임베드 공통.
 * React 나 Next 에 의존하지 않는다(브라우저 번들에 그대로 들어간다).
 */

export interface LandingSession {
  id: string;
  number: number;
  type?: string;
  title: string;
  speaker: string | null;
  speakerCompany?: string | null;
  speakerPhotoUrl?: string | null;
  /** 세션에 붙는 조직 마크. 사람 사진과 달리 원본 비율 유지(잘리면 글자를 못 읽는다). */
  logoUrl?: string | null;
  description?: string | null;
  speakerBio?: string | null;
  /** 연사·소속 홈페이지. 상세 팝업의 바로가기 — 절대 http(s) 만 표시된다. */
  speakerHomepage?: string | null;
  /** SNS 링크(URL 배열). 플랫폼은 저장하지 않고 호스트로 판정한다 — webinar-speaker-links.ts. */
  speakerLinks?: unknown;
  startTime: string;
  endTime: string;
}

/** 서버가 resolveWebinarStatus 로 판정한 값 — 랜딩 CTA 가 상태를 반영하는 근거. */
export interface LandingStatusInfo {
  status: "upcoming" | "registration" | "live" | "ended" | string;
  entryOpen: boolean;
  canRegister: boolean;
}

export interface LandingWebinar {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  liveStartAt: string;
  theme: Record<string, string>;
  config: Record<string, unknown>;
  sessions: LandingSession[];
  // 서버(resolveWebinarStatus) 판정값 — 히어로 CTA 가 등록/입장/종료를 구분하는 근거.
  // optional: 구 페이로드(상태 없음)도 등록중으로 취급해 그대로 동작한다.
  status?: string;
  entryOpen?: boolean;
  canRegister?: boolean;
}

export interface LandingTocItem {
  /** uid 접두 **전**의 base id (예: "lnd-sessions"). 접두는 렌더 시 sectionId() 가 한 번만 붙인다. */
  id: string;
  label: string;
}

/**
 * 스폰서 한 묶음 — 같은 tier(주최·주관·후원 …)끼리 모은 결과.
 * 묶음 나누기는 모델에서 끝난다(뷰는 그리기만) — tier 가 전부 비어 있으면 라벨 없는 한 묶음.
 */
export interface LandingSponsorGroup {
  /** 묶음 라벨. 빈 문자열이면 라벨을 그리지 않는다. */
  tier: string;
  items: import("@/lib/webinar-config").LandingSponsorItem[];
}

/**
 * 렌더 직전까지 모든 파생을 끝낸 모델. 뷰 함수는 여기서만 값을 읽는다
 * (뷰에 조건 분기가 흩어지지 않게 — 단독/미리보기/임베드가 같은 결론을 보게 하려는 목적).
 */
export interface LandingModel {
  webinar: LandingWebinar;
  lp: import("@/lib/webinar-config").LandingPageConfig;
  /** 인스턴스 고유 접두 — 한 페이지에 랜딩이 둘 이상 붙어도 id 가 안 부딪히게. */
  uid: string;
  accent: string;
  onPrimary: string;
  brand: string;
  /** 일시 옆 라벨 — 비면 기본 문구가 들어간 값(폴백은 모델에서 한 번). */
  venue: string;
  titleLines: string[];
  subtitle: string;
  dateStr: string;
  /** 히어로 CTA 링크 — 상태에 따라 등록/입장/종료 화면으로 갈린다. */
  registerUrl: string;
  /** 히어로 CTA 라벨 — 등록중에는 어드민이 설정한 ctaLabel, 그 외엔 상태 문구. */
  ctaLabel: string;
  /** 서버 판정 상태(없으면 등록중으로 가정 — 구 페이로드 호환). */
  statusInfo: LandingStatusInfo;
  introTitle: string;
  introBody: string;
  /** 모바일 뷰포트에서 보여줄 문구 — 폴백은 모델에서 끝난다(비면 introTitle/introBody 와 같다). */
  introTitleMobile: string;
  introBodyMobile: string;
  sessionCards: LandingSession[];
  timetableRows: LandingSession[];
  faqCategories: string[];
  tocItems: LandingTocItem[];
  showIntro: boolean;
  showAudience: boolean;
  /** 편집된 머리글 또는 기본 문구 — 폴백은 모델에서 끝난다. */
  audienceTitle: string;
  /** 혜택 섹션 머리글 — 비면 기본 문구가 들어간 값. */
  highlightsTitle: string;
  showPrograms: boolean;
  showHighlights: boolean;
  showJoin: boolean;
  showFaq: boolean;
  showSponsors: boolean;
  /** 스폰서 섹션 머리글 — 비면 기본 문구가 들어간 값. */
  sponsorsTitle: string;
  /** tier 로 묶은 스폰서. 등장 순서 유지(운영자가 끈 드래그 순서가 곧 노출 순서). */
  sponsorGroups: LandingSponsorGroup[];
  /** 세션 카드 클릭 시 상세 팝업 사용 여부. */
  detailPopup: boolean;
  /** 임베드로 마운트된 경우 true — 링크 target, 랜드마크 태그 선택에 쓴다. */
  embedded: boolean;
  isPreview: boolean;
  /** 섹션 id 를 uid 접두 붙여 만든다. */
  sectionId: (base: string) => string;
}

