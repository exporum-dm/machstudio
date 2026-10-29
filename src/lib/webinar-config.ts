// 웨비나 config(JSON) 정규화 — 단일 정의.
// registrationForm 정규화가 live 페이지 / RegistrationFormTab / register 라우트 / EmbedTab 4곳에
// 중복돼 있던 것을 이 파일로 수렴한다. (UI 파일들의 마이그레이션은 어드민 재편 Phase 에서)
//
// - 공개/제출 경로: normalizeRegistrationForm(config)            → enabled 필드만
// - 어드민 편집 경로: normalizeRegistrationForm(config, { includeDisabled: true }) → 전체 필드

/**
 * 등록 폼 필드 유형.
 *
 * checkbox 와 multiple 은 다른 물건이다:
 *   checkbox — 체크 하나(동의용). 값은 "예/아니오" 성격이고 required 면 체크를 요구한다.
 *   multiple — 선택지 여러 개에서 **복수 선택**. 값은 고른 항목들을 합친 문자열이다.
 * 이름을 나누는 이유: 기존 checkbox 로 저장된 동의 필드가 이미 있어서 의미를 바꿀 수 없다.
 */
export type WebinarFieldType = "text" | "email" | "tel" | "number" | "select" | "checkbox" | "multiple";

export interface WebinarRegistrationField {
  id: string;
  key: string;
  label: string;
  type: WebinarFieldType;
  placeholder: string;
  required: boolean;
  enabled: boolean;
  options: string[];
  system: boolean;
  /**
   * multiple 전용 — 최대 선택 개수. 없으면 무제한.
   * 설문(webinar-survey.ts)의 maxSelect 와 같은 계약을 쓴다: 1 이상, 옵션 수보다 작을 때만
   * 의미가 있다(옵션 전체 이상이면 무제한과 같아서 저장하지 않는다).
   */
  maxSelect?: number;
  /**
   * select·multiple 전용 — '기타(직접입력)' 선택지를 켠다.
   *
   * 켜면 공개 폼에 선택지 맨 아래 "기타" 가 하나 더 생기고, 고르면 자유 입력칸이 함께 뜬다.
   * 저장 값에는 어드민이 정한 선택지가 아니라 **사용자가 쓴 문장**이 들어간다 — 그래서
   * 서버가 값을 선택지 목록과 대조해 거부할 수 없다(그 검증을 넣으면 기타 답이 전부 막힌다).
   */
  allowOther?: boolean;
}

export interface WebinarLinkCtaConfig {
  enabled: boolean;
  label: string;
  url: string;
}

/**
 * "이 웨비나는" 소개 카드. 세 칸 모두 **비면 지금 동작으로 떨어진다** — 기존 웨비나의 화면이
 * 조용히 바뀌면 안 되므로 기본값을 넣지 않는다.
 *
 * 왜 웨비나 이름·설명을 그대로 쓰지 않고 덮어쓸 자리를 두나: 기본정보의 이름은 목록·메일·
 * 리마인더까지 쓰는 식별자라 길고 정확해야 하는데, 대기 화면의 이 카드는 **읽히는 카피**다.
 * 랜딩의 intro 가 이미 같은 이유로 자기 제목·본문을 갖고 있다.
 */
export interface WebinarWaitingAboutConfig {
  /** 카드 머리의 작은 라벨. 비면 "이 웨비나는". */
  eyebrow: string;
  /** 큰 제목. 비면 웨비나 이름. */
  title: string;
  /** 구분선 아래 본문. 비면 웨비나 설명. 줄바꿈을 보존해 렌더한다. */
  body: string;
}

export interface WebinarWaitingFollowUpConfig {
  enabled: boolean;
  /**
   * 카드 제목. 형제인 "이 웨비나는" 패널에는 제목이 있는데 이 카드만 없어서 본문 덩어리로 보였다.
   * 빈 문자열이면 제목 줄을 아예 그리지 않는다 — 기존 웨비나의 화면이 바뀌지 않게(기본값 없음).
   */
  title: string;
  /** 제목 아래 안내 문단. 줄바꿈을 보존해 렌더한다. */
  text: string;
  /**
   * 나열할 항목. text 안에 줄바꿈으로 넣던 목록을 행 단위로 분리한 것 —
   * 한 덩어리 텍스트일 때는 항목이 나열로 안 읽혀 정렬에만 기대야 했다.
   * 비어 있으면 목록을 그리지 않는다(기존 웨비나는 text 만으로 그대로 렌더된다).
   */
  items: string[];
  ctaLabel: string;
  ctaUrl: string;
}

export interface WebinarRegistrationFormConfig {
  fields: WebinarRegistrationField[];
  privacyText: string;
  marketingText: string;
  /** 동의 문구 클릭 시 팝업으로 보여줄 약관 전문 — 비어 있으면 팝업 없음 */
  privacyBody: string;
  marketingBody: string;
  privacyBodyMode: "text" | "link";
  marketingBodyMode: "text" | "link";
  privacyLinkUrl: string;
  marketingLinkUrl: string;
  /** 폼 진입 시 동의 체크박스를 기본으로 체크해둘지 — 사용자가 직접 만지면 그 값이 우선한다 */
  privacyDefaultChecked: boolean;
  marketingDefaultChecked: boolean;
  submitLabel: string;
  successCta: WebinarLinkCtaConfig;
  /**
   * 완료 모달의 **확인 버튼이 이동할 주소**. 비면 그냥 모달을 닫는다(기존 동작).
   *
   * successCta 와 다른 자리다 — 그쪽은 "덤으로 하나 더" 라 새 탭으로 열고 안 눌러도 그만이지만,
   * 이 값은 등록 다음 걸음을 아예 다른 페이지로 넘기는 것이라 같은 탭에서 이동한다.
   */
  successRedirectUrl: string;
}

/** 항목 형식의 단일 출처 — 사전등록 빌더(collect-form-config)도 이걸 import 한다. */
export const FIELD_TYPES: readonly WebinarFieldType[] = ["text", "email", "tel", "number", "select", "checkbox", "multiple"];

/**
 * 복수 선택 답변을 한 문자열로 합친다 / 되읽는다.
 *
 * 왜 배열이 아니라 문자열인가: 등록 답변은 customFields JSON 에 들어가고 register 라우트가
 * 중첩 객체·배열을 거부한다(임의 구조가 그대로 직렬화돼 저장된 전례가 있어 막아 뒀다).
 * 그리고 CSV export·등록자 상세·임베드 로더가 전부 값을 문자열로 다룬다. 그 계약을 깨지 않고
 * 복수 선택을 담으려면 합친 문자열이 맞다.
 *
 * 구분자는 ", " — 사람이 CSV 에서 그대로 읽을 수 있어야 한다. 선택지 자체에 쉼표가 들어가면
 * 되읽을 때 쪼개지지만, 그건 **개수 검증에만** 쓰이고 저장된 원문은 그대로 보존된다.
 */
export const MULTI_VALUE_SEPARATOR = ", ";

export function joinMultiValue(values: readonly string[]): string {
  return values.map((v) => v.trim()).filter(Boolean).join(MULTI_VALUE_SEPARATOR);
}

export function splitMultiValue(value: unknown): string[] {
  return typeof value === "string"
    ? value.split(",").map((v) => v.trim()).filter(Boolean)
    : [];
}

/** 선택지를 쓰는 유형 — 옵션 0개 게이트·기타 허용·최대 개수가 여기 걸린다. */
export const CHOICE_FIELD_TYPES: readonly WebinarFieldType[] = ["select", "multiple"];

/** 선택지를 몇 개까지 고를 수 있나. 무제한이면 null. */
export function maxSelectFor(field: Pick<WebinarRegistrationField, "type" | "maxSelect" | "options">): number | null {
  if (field.type !== "multiple") return null;
  const n = Number(field.maxSelect);
  return Number.isInteger(n) && n >= 1 && n < field.options.length ? n : null;
}

// ── 연락처 정규화·유효성 — 등록/중복확인/입장확인/임베드 로더의 단일 규칙 ──
// 레이어마다 임계값이 달라지는 드리프트 방지: 규칙 변경은 반드시 여기서만.
export const PHONE_MIN_DIGITS = 10;
export const PHONE_MAX_DIGITS = 15;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  return digits || null;
}

export function normalizeEmail(value: unknown): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  return text || null;
}

export function isValidPhone(digits: string): boolean {
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email) && email.length <= 320;
}

// ── Q&A 공개 범위 ──
// components.qaMode 에 저장(chatEnabled 와 같은 자리 — 라이브 중에도 콘솔에서 바꾸는 운영 스위치라서).
//  open   = 시청자끼리 올라온 질문을 서로 보고 추천할 수 있다 (기존 동작)
//  closed = 질문은 주최자만 본다. 시청자에겐 질문하기 입력만 남는다.
// 기본값은 open — 기존 웨비나의 동작이 조용히 바뀌면 안 된다.
export type QaMode = "open" | "closed";

/**
 * 폐쇄형은 **서버에서** 막아야 한다. 뷰어에서 목록만 숨기면 /live-state 응답과 공개 GET /qa 에
 * 남의 질문이 그대로 실려 나가므로(개발자도구로 그대로 보인다) UI 게이팅은 게이팅이 아니다.
 */
export function normalizeQaMode(components: unknown): QaMode {
  const c = components && typeof components === "object" && !Array.isArray(components)
    ? (components as Record<string, unknown>)
    : {};
  return c.qaMode === "closed" ? "closed" : "open";
}

// ── 라이브 페이지 화면(대기·입장·종료) 구성 — 섹션별 on/off + 자료·넥스트 데이터 ──
// config.livePage 에 저장(JSON blob, 마이그레이션 불필요). 데이터가 없으면 토글이 켜져 있어도 뷰어에서 자동 숨김.
export interface LiveResource {
  title: string;
  meta: string;
  url: string;
  /**
   * 이 자료를 받기 전에 **끝내야 하는 설문**. 빈 문자열이면 조건 없이 받는다.
   *
   * 자료마다 따로 두는 이유: 만족도 설문을 낸 사람에게 발표자료를, 사전조사를 낸 사람에게
   * 다음 행사 자료를 주는 식으로 자료별 대가가 다른 게 실제 운영이다. 종료 화면에 걸린
   * 설문 중 하나를 고른다.
   *
   * 주의 — 이건 **화면에서만 가리는 장치**다. url 은 공개 config 에 그대로 실려 나가므로
   * 개발자도구로 config 를 보면 설문 없이도 주소를 알 수 있다. 진짜로 막아야 하는 파일이면
   * 자료 URL 자체를 서명 링크로 바꾸는 별도 작업이 필요하다.
   */
  surveyId: string;
}
export interface LiveNextWebinar { title: string; when: string; url: string }

/** 종료 화면 기본 문구 — 어드민이 비워 두면 이 값이 쓰인다(뷰어·미리보기 공통). */
export const DEFAULT_ENDED_TITLE = "함께해주셔서\n감사합니다";
export const DEFAULT_ENDED_DESCRIPTION =
  "오늘 라이브는 마무리됐어요. 다시보기와 자료를 준비해 등록하신 이메일로 보내드릴게요.";

export interface LivePageConfig {
  waiting: {
    agenda: boolean;
    social: boolean;
    calendar: boolean;
    share: boolean;
    notify: boolean;
    about: WebinarWaitingAboutConfig;
    followUp: WebinarWaitingFollowUpConfig;
  };
  entry: { viewerCount: boolean };
  ended: {
    replay: boolean; survey: boolean; resources: boolean; nextWebinar: boolean; share: boolean;
    /** 종료 화면 인사말. 빈 문자열이면 DEFAULT_ENDED_TITLE. 줄바꿈을 그대로 살려 렌더한다. */
    title: string;
    /** 인사말 아래 설명. 빈 문자열이면 DEFAULT_ENDED_DESCRIPTION. */
    description: string;
  };
  resources: LiveResource[];
  nextWebinar: LiveNextWebinar | null;
}

export function normalizeLivePageConfig(config: unknown): LivePageConfig {
  const c = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const lp = c.livePage && typeof c.livePage === "object" ? (c.livePage as Record<string, unknown>) : {};
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  const w = obj(lp.waiting), e = obj(lp.entry), en = obj(lp.ended);
  const followUp = obj(w.followUp);
  const about = obj(w.about);
  const text = (v: unknown) => (typeof v === "string" ? v : "");

  const resources: LiveResource[] = Array.isArray(lp.resources)
    ? (lp.resources as unknown[])
        .map((r) => obj(r))
        .filter((r) => typeof r.url === "string" && (r.url as string).trim())
        .map((r) => ({
          title: String(r.title ?? "자료"),
          meta: String(r.meta ?? ""),
          url: String(r.url),
          surveyId: typeof r.surveyId === "string" ? r.surveyId : "",
        }))
    : [];

  const nwRaw = obj(lp.nextWebinar);
  const nextWebinar: LiveNextWebinar | null =
    typeof nwRaw.title === "string" && (nwRaw.title as string).trim()
      ? { title: String(nwRaw.title), when: String(nwRaw.when ?? ""), url: String(nwRaw.url ?? "") }
      : null;

  return {
    waiting: {
      agenda: bool(w.agenda, true),
      social: bool(w.social, true),
      calendar: bool(w.calendar, true),
      share: bool(w.share, true),
      notify: bool(w.notify, true),
      about: {
        eyebrow: text(about.eyebrow),
        title: text(about.title),
        body: text(about.body),
      },
      followUp: {
        enabled: bool(followUp.enabled, false),
        title: typeof followUp.title === "string" ? followUp.title : "",
        text: typeof followUp.text === "string" ? followUp.text : "",
        // 빈 줄은 버린다 — 어드민이 행을 추가해 두고 안 채우면 목록에 빈 칸이 생긴다.
        items: Array.isArray(followUp.items)
          ? (followUp.items as unknown[]).map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
          : [],
        ctaLabel: typeof followUp.ctaLabel === "string" ? followUp.ctaLabel : "",
        ctaUrl: typeof followUp.ctaUrl === "string" ? followUp.ctaUrl : "",
      },
    },
    entry: { viewerCount: bool(e.viewerCount, true) },
    ended: {
      replay: bool(en.replay, true),
      survey: bool(en.survey, true),
      resources: bool(en.resources, false), // 자료는 파일이 없을 수 있어 기본 OFF
      nextWebinar: bool(en.nextWebinar, false), // 다음 웨비나 없을 수 있어 기본 OFF
      share: bool(en.share, true),
      // 문구는 기본값을 여기서 채우지 않는다. 빈 값을 그대로 통과시켜 뷰어가 기본 문구를 쓰게 해야,
      // 나중에 기본 문구를 고치면 "저장 안 한 웨비나"에도 같이 반영된다(저장 시점 값이 굳지 않게).
      title: typeof en.title === "string" ? en.title : "",
      description: typeof en.description === "string" ? en.description : "",
    },
    resources,
    nextWebinar,
  };
}

// ── 랜딩 페이지(외부 사이트 임베드용 상세페이지) — config.landingPage ──
// 섹션은 "토글 ON + 실제 데이터 있음" 이중 게이트로만 노출된다(빈 껍데기 금지).
// 세션·타임테이블 데이터는 여기 저장하지 않고 실제 세션(webinar.sessions)에서 파생한다.
export interface LandingProgramItem { icon: string; title: string; description: string }
/**
 * "이런 분들께 추천합니다" 한 줄. 방문자가 **자기 얘기인지** 3초 안에 판별하게 하는 섹션이라
 * 제목(대상)이 필수고 설명은 부연이다 — 제목이 비면 그 줄은 공개되지 않는다.
 * icon 은 선택 — 비우면 뷰가 체크 표시를 그린다.
 */
export interface LandingAudienceItem { icon: string; title: string; description: string }
export interface LandingHighlightItem { title: string; description: string }
export interface LandingJoinStep { title: string; description: string }
export interface LandingFaqItem { category: string; question: string; answer: string }
/**
 * 스폰서 한 줄 — 페이지 **최하단**의 로고 벽에 들어간다.
 *
 * · name  : 필수. 공개 노출을 가르는 값이고, 로고 이미지의 alt 이기도 하다(로고만 있고
 *           이름이 없으면 스크린리더에는 아무것도 남지 않는다).
 * · logoUrl: 선택. 비면 이름을 글자 칩으로 그린다 — 로고를 아직 못 받은 파트너도
 *            먼저 올릴 수 있고, 빈 껍데기가 아니라 실제 크레딧이라 이중 게이트에 어긋나지 않는다.
 * · url   : 선택. 파트너 홈페이지. http(s)만 통과한다(safeHttpUrl).
 * · tier  : 선택. "주최"·"주관"·"후원" 처럼 **묶음 라벨**이다. 한국 행사 페이지는 이 구분이
 *           로고 자체보다 중요할 때가 많다(주최와 후원을 같은 줄에 섞으면 사실이 틀려진다).
 *           비우면 라벨 없는 한 덩어리 — 구분이 필요 없는 페이지는 안 써도 된다.
 */
export interface LandingSponsorItem { tier: string; name: string; logoUrl: string; url: string }
export type LandingHeroMedia = { type: "image" | "video"; url: string } | null;

/** 섹션 배경 모드. 섹션마다 라이트/다크를 따로 고른다. */
export type LandingSectionBg = "light" | "dark";

/**
 * 모드를 고를 수 있는 섹션 — 순서는 랜딩 렌더 순서 그대로(편집 UI 도 이 순서를 쓴다).
 *
 * `sessions` 는 세션·타임테이블 구간의 **바탕**이다. 이 구간은 화면 중앙에 걸리면 배경이
 * 웨비나 키컬러로 바뀌므로(`.accent-zone` + attachAccentZone) 섹션이 자기 배경을 칠할 수
 * 없다 — 대신 루트가 칠하고, 전환이 걸리지 않은 동안 보이는 색이 이 값이다.
 */
export const LANDING_BG_SECTIONS = [
  { key: "hero", label: "히어로", note: "미디어를 넣으면 글자는 항상 밝게 나갑니다" },
  { key: "intro", label: "About (소개)", note: "" },
  /* 세션·타임테이블만 키컬러 구간이라 자기 배경을 칠하지 않는다 — 이 값은 그 **전후**에
     보이는 루트 바탕색이다. 혜택은 예전에 여기 묶여 있었지만 일반 섹션으로 되돌렸다. */
  { key: "sessions", label: "세션 · 타임테이블", note: "스크롤이 이 구간에 걸리면 키컬러로 바뀝니다 — 그 전후에 보이는 바탕색" },
  { key: "programs", label: "Programs", note: "" },
  /* 렌더 순서와 같아야 한다 — Audience 다음이 혜택이고 그 다음이 Join 이다(mount 주석). */
  { key: "audience", label: "이런 분들께 추천합니다", note: "" },
  { key: "highlights", label: "혜택", note: "" },
  { key: "join", label: "How to Join", note: "" },
  { key: "faq", label: "FAQ", note: "" },
  /* 최하단 — FAQ 아래가 끝이다. 로고 벽은 어느 모드에서도 흰 판 위에 그려지므로
     여기 값은 판 **주변** 여백의 색이다. */
  { key: "sponsors", label: "스폰서", note: "로고는 어느 모드에서든 흰 판 위에 올라갑니다" },
] as const;

export type LandingBgSectionKey = (typeof LANDING_BG_SECTIONS)[number]["key"];
export type LandingSectionBgMap = Record<LandingBgSectionKey, LandingSectionBg>;

/**
 * 배경 키컬러 두 개. 글자·카드·선 색은 이 값에서 파생한다(css.ts 의 color-mix) —
 * 운영자가 색을 6개 고르게 하면 대비가 깨진 조합이 반드시 나온다. 두 개만 받는다.
 */
export interface LandingColors { lightBg: string; darkBg: string }

/** 현재 랜딩과 같은 색 — 기본값을 바꾸면 저장 안 한 웨비나의 외관이 바뀐다. */
export const DEFAULT_LANDING_COLORS: LandingColors = { lightBg: "#f6f8ff", darkBg: "#06080d" };

/** 기본은 전부 다크 — 이 기능이 들어오기 전과 같은 외관이어야 한다. */
export const DEFAULT_LANDING_SECTION_BG: LandingSectionBgMap = {
  hero: "dark", intro: "dark", sessions: "dark", programs: "dark",
  audience: "dark", highlights: "dark", join: "dark", faq: "dark", sponsors: "dark",
};

/**
 * 배경 칸이 **나중에 생긴** 섹션들 — 기존 웨비나에는 저장값이 없다.
 * 전역 기본값("전부 다크")으로 떨어지면 나머지가 화이트인 페이지에서 이 섹션만 검은 띠가 된다.
 * 저장값이 없을 때는 FAQ 를 따른다 — 둘 다 FAQ 의 이웃이라 색 경계가 자연스럽고,
 * 운영자가 칸을 직접 고르면 그 값이 이긴다.
 */
const BG_FOLLOWS_FAQ: ReadonlySet<string> = new Set(["highlights", "sponsors"]);

/** 6자리 hex 만 통과 — 공개 페이지 CSS 에 그대로 들어가는 값이라 문자열을 믿지 않는다. */
const LANDING_HEX = /^#[0-9a-fA-F]{6}$/;

export interface LandingPageConfig {
  enabled: boolean;
  heroMedia: LandingHeroMedia;
  /** 히어로 상단 작은 브랜드 라벨 — 비우면 웨비나 이름 */
  brand: string;
  /** 히어로 대형 타이틀(줄 단위) — 비우면 웨비나 이름 한 줄 */
  titleLines: string[];
  /** 히어로 부제 — 비우면 웨비나 설명 첫 줄 */
  subtitle: string;
  /** 일시 옆 라벨 (예: ONLINE LIVE) */
  venue: string;
  ctaLabel: string;
  /** 라이트·다크 두 모드의 배경 키컬러 */
  colors: LandingColors;
  /** 섹션별 배경 모드 */
  sectionBg: LandingSectionBgMap;
  intro: {
    enabled: boolean;
    title: string;
    body: string;
    /** 모바일 전용 제목 — 비우면 title 을 그대로 쓴다(PC·모바일 줄바꿈 위치가 달라야 할 때만 채운다). */
    titleMobile: string;
    /** 모바일 전용 본문 — 비우면 body 를 그대로 쓴다. */
    bodyMobile: string;
  };
  /** detailPopup: 세션 카드 클릭 시 연사 상세(주제·내용·사진·소속·약력) 팝업 열기 */
  sessions: { enabled: boolean; detailPopup: boolean };
  timetable: { enabled: boolean };
  /**
   * 이런 분들께 추천합니다 — 제목 문구까지 편집 가능하다.
   * 다른 섹션 머리글은 "Programs"·"FAQ" 처럼 고정 영문인데 이것만 한국어 문장인 이유:
   * 이 섹션의 머리글 자체가 카피다("이런 분들께 추천합니다" / "이런 고민이 있다면").
   * 비우면 DEFAULT_LANDING_AUDIENCE_TITLE 이 나간다(저장 시점 값이 굳지 않게).
   */
  audience: { enabled: boolean; title: string; items: LandingAudienceItem[] };
  programs: { enabled: boolean; items: LandingProgramItem[] };
  /** 혜택 — 머리글이 곧 카피라 편집 가능하다(audience 와 같은 이유). 비우면 기본 문구. */
  highlights: { enabled: boolean; title: string; items: LandingHighlightItem[] };
  join: { enabled: boolean; steps: LandingJoinStep[] };
  faq: { enabled: boolean; items: LandingFaqItem[] };
  /**
   * 스폰서 — 페이지 최하단의 로고 벽. 머리글은 편집 가능하고(후원사·주최 및 후원 등
   * 행사마다 부르는 말이 다르다) 비우면 DEFAULT_LANDING_SPONSORS_TITLE 이 나간다.
   */
  sponsors: { enabled: boolean; title: string; items: LandingSponsorItem[] };
}

/** 이런 분들께 추천합니다 — 머리글 기본 문구. 어드민이 비우면 이 값이 나간다. */
export const DEFAULT_LANDING_AUDIENCE_TITLE = "이런 분들께 추천합니다";
/** 혜택 섹션 기본 머리글. 비우면 이 값이 나간다(저장 시점 값이 굳지 않게). */
export const DEFAULT_LANDING_HIGHLIGHTS_TITLE = "참여하면 얻어가는 것";
/**
 * 스폰서 섹션 기본 머리글.
 *
 * audience·highlights 와 달리 **영문 라벨**이다 — 그 둘의 머리글은 설득 카피지만
 * 이건 분류 라벨이고, 한국 행사에서 실제 구분(주최·주관·후원)은 항목별 tier 가 진다.
 * 다르게 부르는 페이지는 이 값을 그냥 덮어쓰면 된다.
 */
export const DEFAULT_LANDING_SPONSORS_TITLE = "Sponsors";
/** 일시 옆 라벨 기본값. 비우면 이 값이 나간다(저장 시점 값이 굳지 않게). */
export const DEFAULT_LANDING_VENUE = "ONLINE LIVE";
/** 히어로 등록 버튼 기본 문구. 비우면 이 값이 나간다. */
export const DEFAULT_LANDING_CTA_LABEL = "사전 등록하기";

/** 온라인 웨비나 공통 참여 절차 — 사실 기반 기본값(어드민이 자유 수정) */
export const DEFAULT_LANDING_JOIN_STEPS: LandingJoinStep[] = [
  { title: "사전 등록", description: "이름과 연락처만 남기면 등록 완료.\n시작 전 입장 안내를 보내드려요." },
  { title: "입장 확인", description: "라이브 당일 등록한 연락처로\n본인 확인 후 바로 입장할 수 있어요." },
  { title: "라이브 시청", description: "실시간 Q&A와 채팅으로\n궁금한 점을 그 자리에서 해결하세요." },
];

/**
 * 이 값이 통과하는가 — **어드민 입력 검증이 이 함수를 쓴다.**
 *
 * safeHttpUrl 과 같은 규칙을 쓰는 게 핵심이다. 화면이 "괜찮다" 고 판정한 값이 저장 경로에서
 * 버려지면(또는 그 반대면) 운영자는 원인을 알 수 없다 — 실측된 사고가 정확히 그것이었다.
 * 판정을 복제하지 말고 이 함수를 부를 것.
 */
export function isHttpUrl(value: unknown): boolean {
  return safeHttpUrl(value) !== "";
}

/**
 * http(s) **또는 사이트 내부 경로**(`/files/deck.pdf`)를 통과시킨다.
 *
 * 어떤 칸이 이걸 쓰는가: 뷰어가 값을 **safeHttpUrl 로 걸러내지 않고 href 에 그대로 넣는** 칸들 —
 * 종료 화면 자료 다운로드·다음 웨비나, 라이브 CTA 카드 버튼, 팝업 버튼. 그 면에서는 우리
 * 도메인의 내부 경로가 실제로 동작하는 정상 값이라, http(s) 만 통과시키면 화면이 **거짓으로**
 * "지금 값은 저장되지 않아요" 라고 말한다(저장도 되고 링크도 먹는다).
 *
 * 반대로 대기 CTA·히어로 배경·스폰서·연사 홈페이지·종료 설문 URL·배포 사이트 주소는
 * 뷰어나 라우트가 safeHttpUrl 로 거르므로 isHttpUrl 을 써야 한다 — 그쪽에서 내부 경로를
 * 통과시키면 저장 단계에서 조용히 버려지는 값을 화면이 승인하게 된다.
 *
 * `javascript:`·`data:` 는 여기서도 막힌다(스킴이 있고 http(s) 가 아니며 `/` 로 시작하지 않는다).
 */
export function isHttpUrlOrSitePath(value: unknown): boolean {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("/")) {
    // `//evil.com` 은 프로토콜 상대 URL 이라 외부로 나간다 — 내부 경로가 아니다.
    return !raw.startsWith("//");
  }
  return isHttpUrl(raw);
}

// 공개 페이지에 들어가는 URL 은 http(s)만 — javascript: 등 스킴이 임베드된 외부 사이트에서 실행되는 것을 차단.
export function safeHttpUrl(value: unknown): string {
  const url = String(value ?? "").trim();
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

export function normalizeLandingPageConfig(
  config: unknown,
  opts?: { keepEmptyRows?: boolean },
): LandingPageConfig {
  const c = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const lp = c.landingPage && typeof c.landingPage === "object" && !Array.isArray(c.landingPage)
    ? (c.landingPage as Record<string, unknown>)
    : {};
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  // keep 필터는 **공개 렌더용**이다(제목 없는 행을 시청자에게 그리지 않는다).
  // 어드민 편집에서 이걸 그대로 쓰면, 아직 제목을 안 쓴 행이 리마운트 때 사라지고
  // 다음 자동저장이 그 배열을 그대로 덮어써 DB 에서도 영구 소실된다 → keepEmptyRows 로 끈다.
  const keepEmpty = opts?.keepEmptyRows === true;
  const rows = <T>(v: unknown, map: (r: Record<string, unknown>) => T, keep: (t: T) => boolean): T[] =>
    Array.isArray(v) ? (v as unknown[]).map((r) => map(obj(r))).filter((t) => keepEmpty || keep(t)) : [];

  const mediaRaw = obj(lp.heroMedia);
  const mediaUrl = safeHttpUrl(mediaRaw.url);
  const heroMedia: LandingHeroMedia = mediaUrl
    ? { type: mediaRaw.type === "video" ? "video" : "image", url: mediaUrl }
    : null;

  const hex = (v: unknown, def: string) => (typeof v === "string" && LANDING_HEX.test(v.trim()) ? v.trim().toLowerCase() : def);
  const colors = obj(lp.colors);
  const sectionBg = obj(lp.sectionBg) as Partial<LandingSectionBgMap>;

  const intro = obj(lp.intro);
  const audience = obj(lp.audience);
  const programs = obj(lp.programs);
  const highlights = obj(lp.highlights);
  const join = obj(lp.join);
  const faq = obj(lp.faq);
  const sponsors = obj(lp.sponsors);

  return {
    enabled: bool(lp.enabled, false),
    heroMedia,
    brand: str(lp.brand),
    titleLines: Array.isArray(lp.titleLines) ? (lp.titleLines as unknown[]).map(String).filter((s) => s.trim() !== "") : [],
    subtitle: str(lp.subtitle),
    /* 빈 값을 **그대로 통과**시킨다 — 폴백은 모델에서 한 번(audience·highlights 머리글과 같은 규칙).
       예전엔 여기서 기본값을 채웠고, 그래서 운영자가 칸을 비우면 리마운트 때 기본 문구가 칸에
       되살아나 다음 자동저장이 그 문구를 **DB 에 굳혔다**(실측). 굳으면 나중에 기본값을 고쳐도
       그 웨비나엔 반영되지 않는다 — 이 파일이 종료 화면 문구에 대해 이미 적어 둔 규칙과 같다. */
    venue: str(lp.venue),
    ctaLabel: str(lp.ctaLabel),
    colors: {
      lightBg: hex(colors.lightBg, DEFAULT_LANDING_COLORS.lightBg),
      darkBg: hex(colors.darkBg, DEFAULT_LANDING_COLORS.darkBg),
    },
    sectionBg: LANDING_BG_SECTIONS.reduce((acc, s) => {
      // 나중에 생긴 칸(혜택·스폰서)은 저장값이 없으면 FAQ 를 따른다 — BG_FOLLOWS_FAQ 주석 참고.
      const fallback = BG_FOLLOWS_FAQ.has(s.key) && sectionBg[s.key] === undefined
        ? (sectionBg.faq === "light" ? "light" : DEFAULT_LANDING_SECTION_BG.faq)
        : DEFAULT_LANDING_SECTION_BG[s.key];
      acc[s.key] = sectionBg[s.key] === "light" ? "light" : fallback;
      return acc;
    }, {} as LandingSectionBgMap),
    intro: {
      enabled: bool(intro.enabled, true),
      title: str(intro.title),
      body: str(intro.body),
      titleMobile: str(intro.titleMobile),
      bodyMobile: str(intro.bodyMobile),
    },
    sessions: { enabled: bool(obj(lp.sessions).enabled, true), detailPopup: bool(obj(lp.sessions).detailPopup, true) },
    timetable: { enabled: bool(obj(lp.timetable).enabled, true) },
    audience: {
      enabled: bool(audience.enabled, true),
      // 머리글은 빈 값을 그대로 통과 — 뷰가 기본 문구를 쓴다(기본 문구를 나중에 고치면 같이 반영)
      title: str(audience.title),
      items: rows(
        audience.items,
        (r) => ({ icon: str(r.icon), title: str(r.title), description: str(r.description) }),
        (r) => r.title.trim() !== "",
      ),
    },
    programs: {
      enabled: bool(programs.enabled, true),
      items: rows(
        programs.items,
        (r) => ({ icon: str(r.icon), title: str(r.title), description: str(r.description) }),
        (r) => r.title.trim() !== "",
      ),
    },
    highlights: {
      enabled: bool(highlights.enabled, true),
      title: str(highlights.title),
      items: rows(
        highlights.items,
        (r) => ({ title: str(r.title), description: str(r.description) }),
        (r) => r.title.trim() !== "",
      ),
    },
    join: {
      enabled: bool(join.enabled, true),
      steps: Array.isArray(join.steps)
        ? rows(join.steps, (r) => ({ title: str(r.title), description: str(r.description) }), (r) => r.title.trim() !== "")
        : DEFAULT_LANDING_JOIN_STEPS,
    },
    faq: {
      enabled: bool(faq.enabled, true),
      items: rows(
        faq.items,
        (r) => ({ category: str(r.category).trim() || "일반", question: str(r.question), answer: str(r.answer) }),
        (r) => r.question.trim() !== "",
      ),
    },
    sponsors: {
      /**
       * 다른 섹션과 달리 **기본 OFF** 다. 이 섹션은 랜딩 기능이 출시된 **뒤에** 생겼기 때문이다.
       *
       * intro·audience·programs 등이 기본 ON 이어도 소급 경고가 없었던 이유: 그들이 나올 때는
       * 랜딩을 켠 웨비나가 0개였고(landingPage.enabled 기본 false), 노출 점검 표는 랜딩이 꺼져
       * 있으면 모든 랜딩 행을 off 로 본다. 스폰서는 다르다 — 이미 랜딩을 켜고 다 채워 둔 웨비나가
       * 있고, 기본 ON 이면 그 웨비나들이 **아무 조작도 안 했는데** "스폰서를 켰지만 항목이
       * 없어요" 라는 거짓 경고를 받는다(실측: 준비 상태 확인할 것 +1). 그건 이 표가 예전에
       * 고친 바로 그 결함이다(webinar-exposure.ts 의 sectionOn/hasContent 분리 주석).
       *
       * 새 웨비나에서 "추가했는데 안 나온다" 가 되지 않도록, 편집기가 **첫 행을 추가할 때**
       * 토글을 같이 켠다(LandingPageTab). 시청자 쪽 결론은 어느 기본값이든 같다 — 이중 게이트가
       * 항목 1개 이상을 요구하므로 빈 섹션은 애초에 렌더되지 않는다.
       */
      enabled: bool(sponsors.enabled, false),
      title: str(sponsors.title),
      items: rows(
        sponsors.items,
        // 두 URL 은 공개 페이지 마크업에 그대로 들어간다(로고 src · 링크 href) →
        // 다른 URL 값(히어로 미디어·연사 홈페이지)과 같이 http(s) 만 통과시킨다.
        (r) => ({ tier: str(r.tier), name: str(r.name), logoUrl: safeHttpUrl(r.logoUrl), url: safeHttpUrl(r.url) }),
        // 이름이 공개 노출을 가른다 — 로고만 있고 이름이 없으면 alt 가 비어 스크린리더에 안 남는다.
        (r) => r.name.trim() !== "",
      ),
    },
  };
}

export const DEFAULT_REGISTRATION_FIELDS: WebinarRegistrationField[] = [
  { id: "name", key: "name", label: "이름", type: "text", placeholder: "홍길동", required: true, enabled: true, options: [], system: true },
  { id: "phone", key: "phone", label: "연락처", type: "tel", placeholder: "01012345678", required: false, enabled: true, options: [], system: true },
  { id: "email", key: "email", label: "이메일", type: "email", placeholder: "hong@example.com", required: false, enabled: true, options: [], system: true },
  { id: "company", key: "company", label: "회사명", type: "text", placeholder: "", required: false, enabled: true, options: [], system: true },
  { id: "department", key: "department", label: "부서", type: "text", placeholder: "", required: false, enabled: true, options: [], system: true },
  { id: "jobTitle", key: "jobTitle", label: "직함", type: "text", placeholder: "", required: false, enabled: true, options: [], system: true },
  { id: "industry", key: "industry", label: "업종", type: "text", placeholder: "", required: false, enabled: true, options: [], system: true },
];

/**
 * 선택형 필드의 부가 값(maxSelect·allowOther)만 따로 정규화한다.
 *
 * maxSelect 는 옵션 수보다 작을 때만 저장한다 — 옵션 전체 이상이면 "최대 3개" 라고 적혀 있는데
 * 실제로는 아무 제한이 없는 상태가 되고, 그 문구가 화면에 그대로 나간다(설문과 같은 규칙).
 * 두 값 모두 없으면 키를 아예 넣지 않는다 — config JSON 에 undefined 를 남기지 않으려고.
 */
function normalizeChoiceExtras(
  saved: { maxSelect?: unknown; allowOther?: unknown } | undefined,
  optionCount: number,
): { maxSelect?: number; allowOther?: boolean } {
  const out: { maxSelect?: number; allowOther?: boolean } = {};
  const raw = Number(saved?.maxSelect);
  if (Number.isInteger(raw) && raw >= 1 && raw < optionCount) out.maxSelect = raw;
  if (saved?.allowOther === true) out.allowOther = true;
  return out;
}

function normalizeFieldType(value: unknown): WebinarFieldType {
  return FIELD_TYPES.includes(value as WebinarFieldType) ? (value as WebinarFieldType) : "text";
}

export function normalizeRegistrationForm(
  config: unknown,
  opts?: { includeDisabled?: boolean },
): WebinarRegistrationFormConfig {
  const configRaw =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const raw = configRaw.registrationForm as Partial<WebinarRegistrationFormConfig> | undefined;
  const successCtaRaw =
    raw?.successCta && typeof raw.successCta === "object" && !Array.isArray(raw.successCta)
      ? raw.successCta as Partial<WebinarLinkCtaConfig>
      : {};
  const savedFields = Array.isArray(raw?.fields) ? (raw.fields as Array<Partial<WebinarRegistrationField> & { key?: unknown }>) : [];

  const merged = DEFAULT_REGISTRATION_FIELDS.map((field) => {
    const saved = savedFields.find((item) => item && item.key === field.key);
    return {
      ...field,
      ...(saved ?? {}),
      id: field.id,
      key: field.key,
      type: saved?.type != null ? normalizeFieldType(saved.type) : field.type,
      // 빈 옵션은 그릴 수 없다 — 편집 중 자동저장으로 빈 행이 저장돼도 읽기에서 걸러
      // 공개 폼에 빈 드롭다운 항목이 뜨거나(중복 key) 필수 검증이 등록을 막는 일을 방지.
      options: Array.isArray(saved?.options) ? saved.options.map(String).filter((s) => s.trim() !== "") : field.options,
      ...normalizeChoiceExtras(saved, Array.isArray(saved?.options) ? saved.options.length : field.options.length),
      system: true,
    } satisfies WebinarRegistrationField;
  });

  const customFields = savedFields
    .filter((item) => item && !DEFAULT_REGISTRATION_FIELDS.some((field) => field.key === item.key))
    .map((item, index) => ({
      id: String(item.id ?? item.key ?? `custom_${index}`),
      key: String(item.key ?? `custom_${index}`),
      label: String(item.label ?? item.key ?? "커스텀 필드"),
      type: normalizeFieldType(item.type),
      placeholder: String(item.placeholder ?? ""),
      required: Boolean(item.required),
      enabled: item.enabled !== false,
      options: Array.isArray(item.options) ? item.options.map(String).filter((s) => s.trim() !== "") : [],
      ...normalizeChoiceExtras(item, Array.isArray(item.options) ? item.options.length : 0),
      system: false,
    } satisfies WebinarRegistrationField));

  // 레거시 기본 placeholder 만 새 기본 예시로 교체 — "01000000000" 은 옛 기본값("010-0000-0000")이
  // 과거 읽기시점 정규화로 손상돼 재저장된 값(전부 0이라 실제 안내 문구일 수 없음).
  // 커스텀 안내 문구는 어드민이 정한 그대로 보존한다 — 하이픈 제거는 입력 '값'에만 적용되는 규칙이다.
  const fields = [...merged, ...customFields].map((field) =>
    field.key === "phone" && (field.placeholder === "010-0000-0000" || field.placeholder === "01000000000")
      ? { ...field, placeholder: "01012345678" }
      : field,
  );

  // 저장된 배열 순서를 존중(어드민에서 드래그로 변경). 저장에 없는 필드는 기본 순서대로 뒤에.
  const savedOrder = new Map(savedFields.map((item, index) => [item?.key, index]));
  fields.sort(
    (a, b) =>
      ((savedOrder.get(a.key) as number | undefined) ?? Number.MAX_SAFE_INTEGER) -
      ((savedOrder.get(b.key) as number | undefined) ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    /**
     * 공개 화면에서는 비활성 필드와 **선택지 0개인 선택형**을 제외한다.
     * 그릴 수 없는 항목을 필수로 두면 등록 자체가 막히기 때문이다(드롭다운·복수 선택 공통).
     * 단, '기타(직접입력)' 이 켜져 있으면 선택지가 없어도 자유 입력으로 답할 수 있으므로 남긴다.
     */
    fields: opts?.includeDisabled
      ? fields
      : fields.filter((field) =>
          field.enabled !== false
          && !(CHOICE_FIELD_TYPES.includes(field.type) && !(field.options ?? []).length && field.allowOther !== true)),
    privacyText: typeof raw?.privacyText === "string" ? raw.privacyText : "[필수] 개인정보 수집 및 이용에 동의합니다",
    marketingText: typeof raw?.marketingText === "string" ? raw.marketingText : "[선택] 마케팅 정보 수신에 동의합니다",
    privacyBody: typeof raw?.privacyBody === "string" ? raw.privacyBody : "",
    marketingBody: typeof raw?.marketingBody === "string" ? raw.marketingBody : "",
    privacyBodyMode: raw?.privacyBodyMode === "link" ? "link" : "text",
    marketingBodyMode: raw?.marketingBodyMode === "link" ? "link" : "text",
    privacyLinkUrl: typeof raw?.privacyLinkUrl === "string" ? raw.privacyLinkUrl : "",
    marketingLinkUrl: typeof raw?.marketingLinkUrl === "string" ? raw.marketingLinkUrl : "",
    privacyDefaultChecked: raw?.privacyDefaultChecked === true,
    marketingDefaultChecked: raw?.marketingDefaultChecked === true,
    submitLabel: typeof raw?.submitLabel === "string" ? raw.submitLabel : "사전 등록하기",
    successCta: {
      enabled: successCtaRaw.enabled === true,
      label: typeof successCtaRaw.label === "string" ? successCtaRaw.label : "",
      url: typeof successCtaRaw.url === "string" ? successCtaRaw.url : "",
    },
    successRedirectUrl: typeof raw?.successRedirectUrl === "string" ? raw.successRedirectUrl : "",
  };
}
