/**
 * 빌더형 수집 소스(CollectSource.mode === "builder")의 폼 정의 한 곳.
 *
 * **이 파일은 임베드 런타임과 서버가 함께 읽는다.** 검증을 양쪽에 따로 쓰면 반드시 갈라진다 —
 * 브라우저에서는 통과하는데 서버가 400 을 주거나, 반대로 서버가 무르면 클라이언트만 믿게 된다.
 * 그래서 스키마·정규화·검증이 전부 여기 있고, 라우트와 번들이 같은 함수를 부른다(설계 §19).
 *
 * React·Next 에 의존하지 않는다(브라우저 번들에 그대로 들어간다).
 *
 * ── 정규화가 왜 필요한가 ──────────────────────────────────────────────
 * formConfig 는 JSONB 라 스키마 강제가 없다. 빌더가 자동저장하는 중간 상태, 예전 버전이 저장한
 * 모양, 손으로 고친 값이 전부 들어올 수 있다. 읽는 쪽에서 한 번 정규화해 **화면·검증이 항상
 * 같은 모양을 보게** 한다(웨비나 normalizeRegistrationForm 과 같은 계약).
 */
// 항목 형식·URL 판정은 **웨비나 쪽 단일 출처를 그대로 쓴다.** 사본을 두면 유형을 하나 늘릴 때
// 한쪽만 고쳐도 컴파일이 통과하고, 그 순간 빌더와 제출 경로가 서로 다른 목록을 보게 된다.
import { FIELD_TYPES as WEBINAR_FIELD_TYPES, safeHttpUrl, type WebinarFieldType } from "@/lib/webinar-config";
// 법률 문구 생성기(§legal)도 이 파일처럼 React·Next 에 의존하지 않는 순수 모듈이라 그대로 들여온다.
import { isLegalCountry, type Country, type ThirdParty, type OrgProfile } from "@/lib/legal-templates/types";
import { resolveOrgTokens } from "@/lib/legal-templates/tokens";

// ── 다국어 ────────────────────────────────────────────────────────────
/**
 * 라벨은 처음부터 로케일 맵으로 저장한다. 지금은 영어 단일이지만, 나중에 다국어를 얹을 때
 * 저장된 값을 통째로 마이그레이션하지 않아도 되게 하려는 것이다(설계 §11).
 * 예전 단일 문자열은 읽을 때 `{ [defaultLocale]: value }` 로 승격한다 — 아래 toLocalized.
 */
export type Localized = Record<string, string>;

export const DEFAULT_LOCALE = "en";

/** 문자열이든 로케일 맵이든 받아 맵으로 통일한다. 값이 없으면 빈 맵. */
export function toLocalized(value: unknown, locale: string = DEFAULT_LOCALE): Localized {
  // 문자열도 반드시 trim 한다 — 공백뿐인 값("  ")을 그냥 두면 truthy 라 살아남아서
  // 선택지 필터를 통과하고 공개 폼에 **빈 드롭다운 줄**이 생긴다(객체 분기와 규칙을 맞춘다).
  // 숫자·불리언도 라벨이 된다. 문자열만 받으면 JSON 의 `options: [2026, 2027]` 이 통째로
  // 사라져 **선택지 0개짜리 select** 가 되고, 그러면 선택지 대조가 꺼져서 아무 값이나 통과한다
  // (중첩 분기는 이미 safeStr 로 받고 있었다 — 두 갈래의 규칙이 달랐다).
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const s = safeStr(value).trim();
    return s ? { [locale]: s } : {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Localized = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = safeStr(v).trim();
      if (s) out[k] = s;
    }
    return out;
  }
  return {};
}

/**
 * 표시할 문자열 하나를 고른다. **폴백 사슬**: 요청 로케일 → 기본 로케일 → 채워진 첫 값.
 * 번역이 비었다고 화면이 비면 안 된다 — 빈 라벨은 사용자에게 "고장" 으로 보인다.
 */
export function localize(value: Localized | undefined, locale = DEFAULT_LOCALE): string {
  if (!value) return "";
  // **자기 속성만** 본다. 로케일은 뷰어가 정하는 값이고(`?lang=`), 맵은 객체 리터럴이라
  // Object.prototype 을 상속한다 — `?lang=constructor` 면 value["constructor"] 가 함수라서
  // ?? 사슬을 통과해 **함수가 라벨로 반환된다**(React 가 "Functions are not valid as a
  // React child" 로 죽거나 빈 라벨이 뜬다). 타입이 string 이라 컴파일도 잡아 주지 못한다.
  const own = (k: string) => (Object.prototype.hasOwnProperty.call(value, k) ? value[k] : undefined);
  const picked = own(locale) ?? own(DEFAULT_LOCALE) ?? Object.values(value)[0];
  return typeof picked === "string" ? picked : "";
}

// ── 항목 ──────────────────────────────────────────────────────────────
/** 웨비나 등록 폼과 **같은 유형 어휘**를 쓴다 — 빌더 컴포넌트를 공용화하기 위해서다. */
export type CollectFieldType = WebinarFieldType | "radio";

const FIELD_TYPES: readonly CollectFieldType[] = [...WEBINAR_FIELD_TYPES, "radio"];

export interface CollectField {
  id: string;
  /** 저장 키. CollectRecord.data 의 키가 된다 — 한 번 정하면 바꾸지 않는다(기존 레코드와 어긋난다). */
  key: string;
  label: Localized;
  type: CollectFieldType;
  placeholder: Localized;
  required: boolean;
  enabled: boolean;
  /** 프로젝트 대시보드에서 이 항목의 응답 분포 차트를 보여줄지. 기본값은 true. */
  showInDashboard?: boolean;
  /** select·radio·multiple 의 선택지. 빈 문자열은 걸러진다(빈 선택지 방지). */
  options: Localized[];
  /** multiple 전용 — 최대 선택 개수. 옵션 수 이상이면 무제한과 같아 저장하지 않는다. */
  maxSelect?: number;
  /** select·multiple 전용 — '기타(직접입력)'. 켜면 저장 값이 선택지 밖 자유 문장이 된다. */
  allowOther?: boolean;
  /**
   * 티켓 화면(`/t/{regNo}`)·완료 화면·QR 카드에도 이 항목의 답을 보여준다. 기본 꺼짐 —
   * 두 화면은 "다른 문항 답변은 절대 넣지 않는다"는 최소 노출 원칙(§10.2)이 있어서,
   * 노출은 운영자가 항목별로 명시적으로 켠 것만 예외로 둔다(예: 동반 인원 수 — 현장에서
   * 인원을 확인해야 하는 값). 선택지·연락처처럼 이미 최소 노출 규칙에 걸려 있는 값을
   * 굳이 다시 켜도 위험하지 않다 — 운영자 책임하에 켠 값이라 그대로 보여준다.
   */
  showOnTicket?: boolean;
}

/**
 * 유형 분기 — **폼당 하나**(설계 §16).
 *
 * 분기 기준은 별도 항목이 아니라 **일반 항목 중 하나**(보통 select·radio)다. 그 항목에서 값을 고르면
 * 해당 그룹의 문항이 **그 항목 바로 아래**에 삽입된다(§4). 유형을 바꾸면 이전 그룹 문항은
 * 사라지되 공통 입력값은 남는다 — 그 동작은 렌더러 몫이고 여기서는 정의만 든다.
 */
export interface CollectBranch {
  enabled: boolean;
  /** 기준이 되는 항목의 key. 비었거나 없는 key 면 분기가 꺼진 것으로 읽는다. */
  fieldKey: string;
  groups: Array<{ value: string; fields: CollectField[] }>;
}

/**
 * 저장된 응답값으로 기본 참가자 유형 배지의 문구를 바꾸는 규칙.
 * 특정 행사나 "Ambassador" 같은 단어를 코드에 넣지 않고 폼마다 운영자가 정의한다.
 */
export interface CollectBadgeRule {
  id: string;
  fieldKey: string;
  operator: "equals" | "contains";
  value: string;
  label: string;
  /** 비우면 배지 이름에서 안정적으로 자동 배정한다. */
  backgroundColor?: string;
}

// ── 행사 개요 ─────────────────────────────────────────────────────────
/**
 * 표시용이 아니라 **동작하는 데이터**(설계 §5.1). 개최 기간은 현장 체크인의 일자 판정에 쓰이고,
 * 사전등록 기간은 **폼을 자동으로 열고 닫는다.** 그래서 개요를 한 곳에 두고 폼·완료·티켓·이메일이
 * 같은 소스를 렌더한다 — 페이지마다 복사돼 있으면 날짜가 바뀔 때 또 여러 곳을 고친다.
 */
export interface CollectEventInfo {
  enabled: boolean;
  /** ["2026-10-22", "2026-10-23"] — 현장 체크인의 일자 판정 키. */
  eventDates: string[];
  openingHours: Array<{ date: string; open: string; close: string; lastEntrance: string }>;
  venue: Localized;
  /** ISO. null 이면 그 방향으로 제한 없음(열려 있음). */
  registrationWindow: { opensAt: string | null; closesAt: string | null };
  extraRows: Array<{ label: Localized; value: Localized }>;
}

// ── 안내 블록 ─────────────────────────────────────────────────────────
export type NoticePlacement = "top" | "above-consent" | "bottom" | "completion" | "email";
export type NoticeMode = "notice" | "checkbox-optional" | "checkbox-required";

const NOTICE_PLACEMENTS: readonly NoticePlacement[] = ["top", "above-consent", "bottom", "completion", "email"];
const NOTICE_MODES: readonly NoticeMode[] = ["notice", "checkbox-optional", "checkbox-required"];

/**
 * 초상권 안내 등. **mode 만 바꾸면 안내 → 동의로 승격**되게 설계했다 —
 * LA(미국)는 고지 + 사후 삭제 대응이 통상이지만, 파리는 droit à l'image 때문에 사전 동의가
 * 필요하다는 것이 통설이라 전시마다 갈린다(설계 §5.3). 코드를 고치지 않고 설정으로 넘긴다.
 */
export interface CollectNotice {
  id: string;
  enabled: boolean;
  placement: NoticePlacement;
  title: Localized;
  /** 줄바꿈을 보존해 표시한다(AGENTS.md). */
  body: Localized;
  /** 본문을 일반 텍스트 또는 안전하게 제한된 HTML로 표시한다. */
  bodyFormat: "text" | "html";
  mode: NoticeMode;
  /** 길면 접고 "자세히". */
  collapsible: boolean;
}

// ── 검증·동의·완료·등록 확인 ──────────────────────────────────────────
export interface CollectValidation {
  /** 연락처 기본 국가(ISO 3166-1 alpha-2). LA 파일럿은 "US". */
  defaultCountry: string;
  /** 이메일 중복이면 등록을 막는다. 지금은 block 만 쓴다 — allow 는 유료 전시에서 재검토. */
  onDuplicate: "block" | "allow";
}

export interface CollectConsentItem {
  enabled: boolean;
  label: Localized;
  /** "자세히" 팝업 본문. 줄바꿈 보존. */
  body: Localized;
  /** 본문을 일반 텍스트 또는 안전하게 제한된 HTML로 표시한다. */
  bodyFormat: "text" | "link";
  linkUrl: string;
  /**
   * 기본 체크. **기본값 false 다**(설계 §7).
   * 필수 동의는 어차피 체크해야 제출되므로 사전 체크의 실익이 없고, GDPR 관할(파리)에서는
   * 사전 체크가 유효한 동의로 인정되지 않는다. 빌더에서 켜면 경고를 띄운다.
   */
  defaultChecked: boolean;
}

export interface CollectCompletion {
  /**
   * 플레이스홀더 `{type}` `{regNo}` `{rid}` `{lang}`.
   * **비우면 이동하지 않고** 폼 자리에 완료 카드(QR 포함)를 그린다 — 이메일 연동 전에는
   * 이 화면이 등록자가 QR 을 받는 첫 경로다(설계 §2·§8).
   */
  redirectUrlTemplate: string;
  /** 완료 화면에 QR·등록번호를 보여준다. */
  showQr: boolean;
}

/** 확인 메일 QR 강조 박스의 기본 문구 — 운영자가 비워 두면 이걸 쓴다(빌더 칸의 placeholder 도 같은 값). */
export const DEFAULT_EMAIL_CALLOUT = {
  title: "Show this QR code at the registration desk",
  body: "to check in and enter the event.",
} as const;

/** 등록 저장 직후 보내는 거래성 확인 메일. API 키·발신 주소는 서버 환경변수에만 둔다. */
export interface CollectConfirmationEmail {
  enabled: boolean;
  subject: Localized;
  heading: Localized;
  /** 줄바꿈을 보존해 본문 첫머리에 표시한다. */
  body: Localized;
  buttonLabel: Localized;
  /** 비우면 답장 주소를 지정하지 않는다. 발신 주소와 별개다. */
  replyTo: string;
  showQr: boolean;
  /**
   * QR 위 강조 박스 문구. 비우면 기본("Show this QR code at the registration desk" / "to check in and enter
   * the event."). 행사마다 QR 을 보여 줄 곳이 다르다 — 예: 메인 스테이지 프로그램은 입구가 아니라 무대 앞
   * 접수대에서 한 번 더 확인한다(2026-10 원데이클래스).
   */
  calloutTitle: Localized;
  calloutBody: Localized;
  includeEventInfo: boolean;
  /** 메일 하단 팔로우 링크 — 비우면 그 항목을 아예 그리지 않는다. */
  instagramUrl: string;
  tiktokUrl: string;
}

/**
 * 등록 확인(Find My QR) — 설계 §10.
 * 무료 전시는 `or`(둘 중 하나만 맞아도 열림)가 합리적이다. 티켓에 금전 가치가 없어 남의 티켓을
 * 얻을 동기가 약한 반면 조회 편의가 문의 응대를 크게 줄인다. **유료로 전환하면 `and`** 로 올린다 —
 * 설정만 바꾸면 되고 코드 수정이 없다.
 */
export interface CollectLookup {
  enabled: boolean;
  fields: Array<"email" | "phone">;
  logic: "or" | "and";
  showQr: boolean;
}

/**
 * 법률 문구 생성기(§legal-templates)가 쓰는 "빈칸" — 국가·현장 촬영 여부·제3자 제공 대상 등
 * 소스마다 다시 채워야 하는 값만 둔다. eventDates·venue 는 `eventInfo`에 이미 있어 여기서
 * 중복으로 받지 않는다(생성기 호출부가 두 곳을 합쳐 넘긴다).
 */
export interface CollectEventLegal {
  country: Country;
  /** 문서에 쓸 행사명. 비면 생성기가 소스 이름으로 대신 채운다(호출부 책임). */
  eventName: string;
  onSitePhotography: boolean;
  thirdParties: ThirdParty[];
  dataRetentionNote: string;
  effectiveDate: string;
  /** 성인 전용 행사 여부 — 끄면(기본) 미성년자 참가를 전제로 한 법정대리인 동의 문단이 들어간다. */
  adultsOnly: boolean;
}

/**
 * 폼 색상 — 파트너 사이트(아임웹 등)의 브랜드 톤에 맞추는 용도. 비워 두면 CSS 기본값을
 * 그대로 쓴다(collect-form/css.ts 의 --msf-accent 등). 대회 시스템의 CompetitionTheme 와
 * 같은 개념이지만 CollectSource 는 항목이 여기 셋뿐이라 로고·모서리 반경은 아직 안 둔다 —
 * 필요해지면 그때 늘린다.
 */
export interface CollectTheme {
  accentColor: string;
  textColor: string;
  surfaceColor: string;
}

export interface CollectFormConfig {
  fields: CollectField[];
  branch: CollectBranch;
  badgeRules: CollectBadgeRule[];
  eventInfo: CollectEventInfo;
  notices: CollectNotice[];
  validation: CollectValidation;
  consent: { privacy: CollectConsentItem; marketing: CollectConsentItem; thirdParty: CollectConsentItem };
  completion: CollectCompletion;
  confirmationEmail: CollectConfirmationEmail;
  lookup: CollectLookup;
  legal: CollectEventLegal;
  theme: CollectTheme;
  /** 제출 버튼 문구. 비면 렌더러 기본 문구. */
  submitLabel: Localized;
  defaultLocale: string;
  /**
   * 접수 창 수동 전환. 시각 계산을 이기고 상태를 고정한다 — 마감을 앞당기거나 연장할 일이
   * 실제로 생긴다(웨비나 statusOverride 와 같은 이유). null 이면 시각으로 판정.
   */
  statusOverride: RegistrationStatus | null;
}

// ── 기본값 ────────────────────────────────────────────────────────────
/**
 * 빈 폼으로 시작한다 — **문항을 코드에 넣지 않는다**(설계 §23).
 * 전시마다 빌더에서 직접 채우는 것이 기본이고, 여기 기본 문항을 박으면 다음 전시에서
 * 지우는 일부터 하게 된다. 단 이름·이메일 없이 등록이 성립하지 않으므로 **신규 소스 생성 시**
 * 빌더가 씨앗 항목을 넣어 준다(그건 UI 몫이고 이 정규화의 기본값이 아니다).
 */
export const EMPTY_FORM_CONFIG: CollectFormConfig = {
  fields: [],
  branch: { enabled: false, fieldKey: "", groups: [] },
  badgeRules: [],
  eventInfo: {
    enabled: false,
    eventDates: [],
    openingHours: [],
    venue: {},
    registrationWindow: { opensAt: null, closesAt: null },
    extraRows: [],
  },
  notices: [],
  validation: { defaultCountry: "US", onDuplicate: "block" },
  consent: {
    privacy: { enabled: true, label: {}, body: {}, bodyFormat: "text", linkUrl: "", defaultChecked: false },
    marketing: { enabled: false, label: {}, body: {}, bodyFormat: "text", linkUrl: "", defaultChecked: false },
    // 마케팅과 같은 이유로 기본 꺼짐 — 모든 행사가 제3자에게 정보를 제공하는 건 아니다.
    thirdParty: { enabled: false, label: {}, body: {}, bodyFormat: "text", linkUrl: "", defaultChecked: false },
  },
  completion: { redirectUrlTemplate: "", showQr: true },
  confirmationEmail: {
    enabled: false,
    subject: {},
    heading: {},
    body: {},
    buttonLabel: {},
    replyTo: "",
    showQr: true,
    calloutTitle: {},
    calloutBody: {},
    includeEventInfo: true,
    instagramUrl: "",
    tiktokUrl: "",
  },
  /* 등록 확인은 **꺼진 채로 시작한다.** 켜면 이메일 하나만 아는 사람에게 남의 QR 티켓을
     보여 주는 화면이라, 운영자가 의식적으로 켜야 한다. 이 파일의 다른 토글도 전부 닫힘이 기본이다
     (eventInfo.enabled, consent.marketing.enabled, branch.enabled). or/showQr 은 켠 뒤의 기본값. */
  lookup: { enabled: false, fields: ["email", "phone"], logic: "or", showQr: true },
  legal: { country: "us", eventName: "", onSitePhotography: false, thirdParties: [], dataRetentionNote: "", effectiveDate: "", adultsOnly: false },
  theme: { accentColor: "", textColor: "", surfaceColor: "" },
  submitLabel: {},
  defaultLocale: DEFAULT_LOCALE,
  statusOverride: null,
};

// ── 정규화 ────────────────────────────────────────────────────────────
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 값 하나를 문자열로. **던지지 않는다.**
 *
 * 맨 `String(v)` 는 JSON 이 `{"toString":1,"valueOf":2}` 처럼 호출 불가능한 원시 변환기를
 * 들고 오면 `TypeError: Cannot convert object to primitive value` 를 던진다. 그러면
 * 정규화는 폼을 통째로 못 그리게 만들고, 검증은 400 으로 거를 요청에 500 을 낸다 —
 * 이 파일 머리말의 "어떤 입력이 와도 던지지 않는다" 가 바로 깨지는 지점이다.
 */
function safeStr(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return String(value);
  } catch {
    return "";
  }
}

function normalizeFieldType(value: unknown): CollectFieldType {
  const t = safeStr(value);
  return (FIELD_TYPES as readonly string[]).includes(t) ? (t as CollectFieldType) : "text";
}

/** 선택지 — 빈 값은 버린다. 빈 항목이 남으면 공개 폼에 빈 드롭다운 줄이 생기고 필수 검증이 꼬인다. */
function normalizeOptions(value: unknown, locale: string): Localized[] {
  if (!Array.isArray(value)) return [];
  return value.map((o) => toLocalized(o, locale)).filter((o) => Object.keys(o).length > 0);
}

function normalizeChoiceExtras(raw: Record<string, unknown>, optionCount: number) {
  const out: { maxSelect?: number; allowOther?: boolean } = {};
  // 정수만 받는다 — webinar-config 의 같은 함수(Number.isInteger)와 판정을 맞춘다. 예전엔
  // Number()+Math.floor 라 maxSelect: 2.7 이 한쪽에선 2, 다른 쪽에선 무제한이 됐고,
  // Number(true) === 1 이라 true 하나가 3지선다를 1개 제한으로 바꿔 놓기도 했다.
  const max = typeof raw.maxSelect === "number" ? raw.maxSelect : NaN;
  // 옵션 전체 이상이면 무제한과 같다 — 저장하지 않는다(웨비나 설문과 같은 계약).
  if (Number.isInteger(max) && max >= 1 && max < optionCount) out.maxSelect = max;
  if (raw.allowOther === true) out.allowOther = true;
  return out;
}

function normalizeField(raw: unknown, index: number, locale: string): CollectField | null {
  const r = obj(raw);
  const key = str(r.key);
  // key 없는 항목은 저장할 자리가 없다 — 그리면 값이 어디에도 안 들어간다.
  if (!key) return null;
  // `notice_` 는 안내 블록 체크박스의 예약 접두다. 운영자가 같은 key 의 항목을 만들면
  // 그 항목에 체크한 것만으로 **법적 필수 동의(초상권 등)가 충족된 것처럼 통과한다.**
  if (key.startsWith(NOTICE_KEY_PREFIX)) return null;
  const options = normalizeOptions(r.options, locale);
  return {
    id: str(r.id) || key || `field_${index}`,
    key,
    label: toLocalized(r.label, locale),
    type: normalizeFieldType(r.type),
    placeholder: toLocalized(r.placeholder, locale),
    required: r.required === true,
    enabled: r.enabled !== false,
    showInDashboard: r.showInDashboard !== false,
    options,
    ...normalizeChoiceExtras(r, options.length),
    // 기존 QR 표시 토글 값은 더 이상 사용하지 않는다.
    showOnTicket: false,
  };
}

function normalizeFields(raw: unknown, locale: string): CollectField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CollectField[] = [];
  raw.forEach((item, i) => {
    const f = normalizeField(item, i, locale);
    // 중복 key 는 뒤엣것을 버린다 — 같은 키가 둘이면 저장 값이 서로를 덮어쓴다.
    if (!f || seen.has(f.key)) return;
    seen.add(f.key);
    out.push(f);
  });
  return out;
}

function normalizeNotice(raw: unknown, index: number, locale: string): CollectNotice {
  const r = obj(raw);
  const placement = str(r.placement) as NoticePlacement;
  const mode = str(r.mode) as NoticeMode;
  return {
    id: str(r.id) || `n${index}`,
    enabled: r.enabled !== false,
    placement: NOTICE_PLACEMENTS.includes(placement) ? placement : "top",
    title: toLocalized(r.title, locale),
    body: toLocalized(r.body, locale),
    bodyFormat: r.bodyFormat === "html" ? "html" : "text",
    mode: NOTICE_MODES.includes(mode) ? mode : "notice",
    collapsible: r.collapsible === true,
  };
}

function normalizeConsentItem(raw: unknown, locale: string, fallback: CollectConsentItem): CollectConsentItem {
  const r = obj(raw);
  return {
    enabled: r.enabled === undefined ? fallback.enabled : r.enabled !== false,
    label: toLocalized(r.label, locale),
    body: toLocalized(r.body, locale),
    bodyFormat: r.bodyFormat === "link" ? "link" : "text",
    linkUrl: str(r.linkUrl),
    // 명시적으로 true 일 때만 사전 체크한다 — 기본은 항상 미체크(설계 §7).
    defaultChecked: r.defaultChecked === true,
  };
}

/**
 * ISO 문자열만 통과시킨다. 못 읽는 값은 null(= 그 방향 제한 없음)로 떨어뜨린다.
 *
 * **오프셋이 없는 값은 거부한다.** `Date.parse("2026-09-01T18:00")` 은 실행 환경의 로컬
 * 시간대로 해석된다 — 이 모듈은 서버(UTC)와 브라우저(KST)에서 **둘 다** 돌기 때문에 같은
 * 저장값이 9시간 어긋난 순간으로 풀린다. 그러면 접수 창이 한쪽에선 열려 보이고 다른 쪽에선
 * 마감이라 제출이 거부된다. `datetime-local` 입력이 바로 이 오프셋 없는 모양을 낸다.
 *
 * 느슨한 값("2026", "Dec 5")도 막는다 — Date.parse 는 그것들도 그럴싸한 시각으로 만들어
 * 오타 하나가 진짜 접수 창이 돼 버린다(의도는 null = 제한 없음이다).
 */
/** 숫자 항목(type: "number") 검증 — 자릿수만, 부호·소수점 없음(런타임이 타이핑 시점에 이미 걸러낸다). */
const NUMERIC_ONLY = /^[0-9]+$/;

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** datetime-local 이 내는 모양 — 오프셋이 없다. */
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function isoOrNull(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  if (ISO_WITH_OFFSET.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  /**
   * 오프셋이 없으면 **UTC 로 읽는다.**
   *
   * 두 가지를 동시에 피해야 한다. `Date.parse` 에 그냥 넘기면 실행 환경의 로컬 시간대로
   * 해석돼 서버(UTC)와 브라우저(KST)가 9시간 갈린다. 그렇다고 null(제한 없음)로 떨어뜨리면
   * **운영자가 입력한 마감이 조용히 "무제한"이 된다** — 화면엔 마감일이 그대로 보이는데
   * 폼은 계속 등록을 받는, 더 나쁜 실패다.
   * 이 저장소는 이미 "naive timestamp 는 UTC" 규약을 웨비나 일정에서 쓰고 있으므로 그걸 따른다.
   */
  if (NAIVE_DATETIME.test(s)) {
    const t = Date.parse(`${s.length === 16 ? `${s}:00` : s}Z`);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  // 그 외("2026", "Dec 5")는 거부한다 — Date.parse 가 그럴싸한 시각을 만들어 오타 하나가
  // 진짜 접수 창이 돼 버린다.
  return null;
}

/**
 * 저장된 formConfig 를 화면·검증이 믿고 쓸 수 있는 모양으로 만든다.
 * **어떤 입력이 와도 던지지 않는다** — 임베드 런타임에서 예외가 나면 폼이 통째로 안 그려진다.
 */
export function normalizeCollectForm(raw: unknown): CollectFormConfig {
  const c = obj(raw);
  const locale = str(c.defaultLocale) || DEFAULT_LOCALE;

  const branchRaw = obj(c.branch);
  const branchGroups = Array.isArray(branchRaw.groups) ? branchRaw.groups : [];
  const fields = normalizeFields(c.fields, locale);
  const fieldKey = str(branchRaw.fieldKey);
  const badgeRulesRaw = Array.isArray(c.badgeRules) ? c.badgeRules : [];

  const eventRaw = obj(c.eventInfo);
  const windowRaw = obj(eventRaw.registrationWindow);
  const validationRaw = obj(c.validation);
  const consentRaw = obj(c.consent);
  const completionRaw = obj(c.completion);
  const confirmationEmailRaw = obj(c.confirmationEmail);
  const lookupRaw = obj(c.lookup);
  const legalRaw = obj(c.legal);
  const thirdPartiesRaw = Array.isArray(legalRaw.thirdParties) ? legalRaw.thirdParties : [];
  const themeRaw = obj(c.theme);
  const hexOrEmpty = (value: unknown) => (/^#[0-9a-fA-F]{6}$/.test(str(value)) ? str(value) : "");

  // 기본값은 **복사해서** 준다. 모듈 상수 배열을 그대로 돌려주면 호출부가 push/splice 하는
  // 순간(조회 항목 토글이 딱 그 모양이다) 상수 자체가 오염돼, 웜 람다에서 뒤이어 정규화되는
  // 다른 워크스페이스의 소스까지 바뀐 기본값을 물려받는다.
  const lookupFields = Array.isArray(lookupRaw.fields)
    ? (lookupRaw.fields.map(safeStr).filter((f) => f === "email" || f === "phone") as Array<"email" | "phone">)
    : [...EMPTY_FORM_CONFIG.lookup.fields];

  const override = str(c.statusOverride);

  return {
    fields,
    branch: {
      // 기준 항목이 실제로 존재할 때만 분기를 켠다 — 항목을 지웠는데 분기가 남으면
      // 렌더러가 없는 key 를 기다리며 유형 문항을 영영 안 그린다.
      // 기준 항목이 **켜져 있을 때만** 분기를 켠다. 지우는 것뿐 아니라 "표시" 를 끄는 것도
      // 한 번의 토글이고, 끈 채로 분기가 살아 있으면 visibleFields 가 기준 항목을 못 찾아
      // 그룹을 맨 뒤에 붙이고(§4 위반) 어떤 제출도 통과하지 못한다.
      enabled: branchRaw.enabled === true && fields.some((f) => f.key === fieldKey && f.enabled),
      fieldKey,
      groups: branchGroups.map((g) => {
        const gr = obj(g);
        return { value: str(gr.value), fields: normalizeFields(gr.fields, locale) };
      }).filter((g) => g.value !== ""),
    },
    badgeRules: badgeRulesRaw.map((rule, index) => {
      const r = obj(rule);
      return {
        id: str(r.id) || `badge-rule-${index + 1}`,
        fieldKey: str(r.fieldKey),
        operator: r.operator === "equals" ? "equals" as const : "contains" as const,
        value: str(r.value).slice(0, 300),
        label: str(r.label).slice(0, 80),
        backgroundColor: /^#[0-9a-fA-F]{6}$/.test(str(r.backgroundColor)) ? str(r.backgroundColor) : "",
      };
    }).filter((rule) => rule.fieldKey && rule.value && rule.label).slice(0, 30),
    eventInfo: {
      enabled: eventRaw.enabled === true,
      eventDates: Array.isArray(eventRaw.eventDates) ? eventRaw.eventDates.map(safeStr).map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [],
      openingHours: Array.isArray(eventRaw.openingHours)
        ? eventRaw.openingHours.map((h) => {
            const hr = obj(h);
            return { date: str(hr.date), open: str(hr.open), close: str(hr.close), lastEntrance: str(hr.lastEntrance) };
          }).filter((h) => h.date !== "")
        : [],
      venue: toLocalized(eventRaw.venue, locale),
      registrationWindow: { opensAt: isoOrNull(windowRaw.opensAt), closesAt: isoOrNull(windowRaw.closesAt) },
      extraRows: Array.isArray(eventRaw.extraRows)
        ? eventRaw.extraRows.map((r) => {
            const rr = obj(r);
            return { label: toLocalized(rr.label, locale), value: toLocalized(rr.value, locale) };
          })
        : [],
    },
    // id 가 겹치면 뒤엣것을 버린다 — 같은 값 키(notice_x)를 두 블록이 나눠 쓰면 하나만 체크해도
    // 둘 다 충족되거나, 한 컨트롤에 오류가 두 번 붙는다(항목 key 중복을 거르는 이유와 같다).
    notices: Array.isArray(c.notices)
      ? c.notices.map((n, i) => normalizeNotice(n, i, locale))
          .filter((n, i, all) => all.findIndex((o) => o.id === n.id) === i)
      : [],
    validation: {
      // 대문자 2글자만 국가 코드로 인정한다 — 소문자·전체 이름이 들어오면 기본값으로.
      // 여기선 모양만 본다. **실재하는 코드인지**(UK 는 없다 — 영국은 GB)는 국가 목록이 필요해
      // collect-phone.isSupportedCountry 가 맡고, 빌더가 입력 시점에 거른다 —
      // 이 모듈은 임베드 번들에 들어가므로 국가 메타데이터를 들이지 않는다.
      defaultCountry: /^[A-Za-z]{2}$/.test(str(validationRaw.defaultCountry))
        ? str(validationRaw.defaultCountry).toUpperCase()
        : EMPTY_FORM_CONFIG.validation.defaultCountry,
      onDuplicate: validationRaw.onDuplicate === "allow" ? "allow" : "block",
    },
    consent: {
      privacy: normalizeConsentItem(consentRaw.privacy, locale, EMPTY_FORM_CONFIG.consent.privacy),
      marketing: normalizeConsentItem(consentRaw.marketing, locale, EMPTY_FORM_CONFIG.consent.marketing),
      thirdParty: normalizeConsentItem(consentRaw.thirdParty, locale, EMPTY_FORM_CONFIG.consent.thirdParty),
    },
    completion: {
      // 공개 완료 화면이 이 값으로 이동한다 — 저장소의 단일 URL 관문을 그대로 쓴다.
      // 맨 trim 만 하면 javascript:/data: 가 살아남아 시청자 화면에 심어진다. 비면 "이동 안 함"
      // 이라 안전한 쪽으로 닫힌다. {regNo} 같은 자리표시자는 경로·쿼리 문자로 문제없이 파싱된다.
      redirectUrlTemplate: safeHttpUrl(str(completionRaw.redirectUrlTemplate)),
      showQr: completionRaw.showQr !== false,
    },
    confirmationEmail: {
      enabled: confirmationEmailRaw.enabled === true,
      subject: toLocalized(confirmationEmailRaw.subject, locale),
      heading: toLocalized(confirmationEmailRaw.heading, locale),
      body: toLocalized(confirmationEmailRaw.body, locale),
      buttonLabel: toLocalized(confirmationEmailRaw.buttonLabel, locale),
      replyTo: str(confirmationEmailRaw.replyTo),
      showQr: confirmationEmailRaw.showQr !== false,
      calloutTitle: toLocalized(confirmationEmailRaw.calloutTitle, locale),
      calloutBody: toLocalized(confirmationEmailRaw.calloutBody, locale),
      includeEventInfo: confirmationEmailRaw.includeEventInfo !== false,
      instagramUrl: safeHttpUrl(confirmationEmailRaw.instagramUrl),
      tiktokUrl: safeHttpUrl(confirmationEmailRaw.tiktokUrl),
    },
    lookup: {
      enabled: lookupRaw.enabled === true,
      // 조회 항목이 하나도 없으면 열 수 없는 화면이 된다 — 기본으로 되돌린다.
      fields: lookupFields.length ? [...new Set(lookupFields)] : [...EMPTY_FORM_CONFIG.lookup.fields],
      logic: lookupRaw.logic === "and" ? "and" : "or",
      showQr: lookupRaw.showQr !== false,
    },
    legal: {
      country: isLegalCountry(legalRaw.country) ? legalRaw.country : EMPTY_FORM_CONFIG.legal.country,
      eventName: str(legalRaw.eventName),
      onSitePhotography: legalRaw.onSitePhotography === true,
      thirdParties: thirdPartiesRaw
        .map((t) => {
          const tr = obj(t);
          return { name: str(tr.name), purpose: str(tr.purpose) };
        })
        .filter((t) => t.name !== ""),
      dataRetentionNote: str(legalRaw.dataRetentionNote),
      effectiveDate: str(legalRaw.effectiveDate),
      adultsOnly: legalRaw.adultsOnly === true,
    },
    theme: {
      accentColor: hexOrEmpty(themeRaw.accentColor),
      textColor: hexOrEmpty(themeRaw.textColor),
      surfaceColor: hexOrEmpty(themeRaw.surfaceColor),
    },
    submitLabel: toLocalized(c.submitLabel, locale),
    defaultLocale: locale,
    statusOverride: REGISTRATION_STATUSES.includes(override as RegistrationStatus)
      ? (override as RegistrationStatus)
      : null,
  };
}

/**
 * 동의 전문에 남아 있는 조직 토큰({{ORG_ADDRESS}} 등, §legal-templates/tokens)을 지금 워크스페이스
 * 값으로 채운다. 공개 화면에 config 를 내보내기 **직전**(임베드 로더·미리보기 페이지)에 불러야
 * 방문자가 항상 최신 회사 정보를 본다 — 저장 시점에 풀어 버리면 나중에 주소가 바뀌어도
 * 이미 저장된 문서는 옛 값에 묶인다.
 */
export function resolveCollectFormConfigOrgTokens(
  config: CollectFormConfig,
  org: OrgProfile,
): CollectFormConfig {
  const locale = config.legal.country === "kr" ? "ko" : "en";
  const resolveLocalized = (value: Localized): Localized =>
    Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveOrgTokens(v, org, locale)]));
  return {
    ...config,
    consent: {
      privacy: { ...config.consent.privacy, body: resolveLocalized(config.consent.privacy.body) },
      marketing: { ...config.consent.marketing, body: resolveLocalized(config.consent.marketing.body) },
      thirdParty: { ...config.consent.thirdParty, body: resolveLocalized(config.consent.thirdParty.body) },
    },
  };
}

// ── 접수 창 ───────────────────────────────────────────────────────────
export type RegistrationStatus = "before" | "open" | "closed";

export const REGISTRATION_STATUSES: readonly RegistrationStatus[] = ["before", "open", "closed"];

/**
 * 지금 등록을 받는가. 웨비나 resolveWebinarStatus 와 같은 구조다 — 시각으로 판정하되
 * **수동 override 가 시각을 이긴다.**
 *
 * `now` 를 인자로 받는 이유: 서버와 클라이언트가 서로 다른 시계를 갖는다. 임베드 런타임은
 * 응답의 serverNow 로 보정한 값을 넣어 호출하고, 서버는 자기 시각을 넣는다. 여기서 new Date()
 * 를 부르면 그 보정이 무의미해진다.
 *
 * **서버에서도 반드시 부른다.** 클라이언트만 막으면 마감 후 API 로 등록이 들어온다(설계 §5.1).
 */
export function resolveRegistrationStatus(
  config: Pick<CollectFormConfig, "eventInfo" | "statusOverride">,
  now: Date,
): RegistrationStatus {
  if (config.statusOverride) return config.statusOverride;
  const { opensAt, closesAt } = config.eventInfo.registrationWindow;
  const t = now.getTime();
  if (opensAt && t < Date.parse(opensAt)) return "before";
  if (closesAt && t >= Date.parse(closesAt)) return "closed";
  return "open";
}

// ── 제출 검증 ─────────────────────────────────────────────────────────
/**
 * 안내 블록 체크박스가 values 에 실려 오는 키의 **예약 접두**.
 * 항목 key 가 이걸로 시작하면 정규화에서 버린다(normalizeField) — 겹치면 그 항목에 체크한 것만으로
 * 법적 필수 동의가 충족된 것처럼 통과한다.
 */
export const NOTICE_KEY_PREFIX = "notice_";

/** 안내 블록 체크박스가 values 에 실려 오는 키. 렌더러·검증이 같은 규칙을 쓰게 한 곳에 둔다. */
export function noticeValueKey(noticeId: string): string {
  return `${NOTICE_KEY_PREFIX}${noticeId}`;
}

/**
 * 이 배치의 안내가 **폼 위에 그려지는가.**
 * completion·email 에 놓인 안내는 폼에 컨트롤이 없다 — 그런 블록에 필수 체크를 요구하면
 * 누를 수 없는 동의를 요구하는 셈이라 어떤 제출도 통과하지 못하고, 오류를 붙일 필드도 없다.
 */
function isOnFormPlacement(placement: NoticePlacement): boolean {
  return placement === "top" || placement === "above-consent" || placement === "bottom";
}

export interface SubmissionIssue {
  /** 어느 항목의 문제인가. 폼이 이 key 아래에 인라인으로 붙인다(AGENTS.md). */
  key: string;
  code: "required" | "invalid_email" | "invalid_phone" | "invalid_number" | "unknown_key" | "too_many" | "not_an_option" | "consent_required";
}

/**
 * 분기 기준 항목에서 고른 값으로 그룹을 찾는다.
 *
 * 그룹 매칭은 **어느 로케일의 라벨로 골랐든** 같은 그룹을 찾아야 한다.
 *
 * group.value 는 평문 한 줄인데 선택지는 로케일 맵이다. 그대로 비교하면 한국어로 고른
 * 사람의 값("바이어")이 group.value("Buyer")와 안 맞아 **분기 문항이 통째로 사라진다** —
 * 선택지 검증(not_an_option)은 모든 로케일 라벨을 받아 주므로 제출은 통과하고, 필수 문항이
 * 검증 없이 지나가거나 채워 넣은 답이 unknown_key 로 거부된다(둘 다 조용히 잘못된다).
 * 그래서 고른 값이 속한 선택지를 먼저 찾아 그 **모든 번역**을 후보로 놓고 매칭한다.
 */
function resolveBranchGroup(
  config: CollectFormConfig,
  chosen: string,
): { value: string; fields: CollectField[] } | undefined {
  const trigger = config.fields.find((f) => f.key === config.branch.fieldKey);
  const picked = trigger?.options.find((o) => Object.values(o).includes(chosen));
  const aliases = new Set<string>(picked ? Object.values(picked) : []);
  aliases.add(chosen);
  return config.branch.groups.find((g) => aliases.has(g.value));
}

/** 분기 그룹까지 펼친 "지금 이 응답에 유효한 항목" 목록. */
export function visibleFields(config: CollectFormConfig, values: Record<string, unknown>): CollectField[] {
  const base = config.fields.filter((f) => f.enabled);
  if (!config.branch.enabled) return base;
  const chosen = safeStr(values[config.branch.fieldKey] ?? "");
  const group = resolveBranchGroup(config, chosen);
  if (!group) return base;

  // 기준 항목 **바로 아래**에 끼워 넣는다 — 화면 순서와 검증 순서가 같아야 한다(§4).
  const at = base.findIndex((f) => f.key === config.branch.fieldKey);
  // 공통 항목과 key 가 겹치는 그룹 항목은 버린다. 둘 다 그리면 입력칸 두 개가 같은 저장 키를
  // 물고 서로를 덮어쓰고, 같은 오류가 두 번 표시된다(중복 key 를 거르는 이유와 같다).
  const taken = new Set(base.map((f) => f.key));
  const extra = group.fields.filter((f) => f.enabled && !taken.has(f.key));
  if (at < 0) return [...base, ...extra];
  return [...base.slice(0, at + 1), ...extra, ...base.slice(at + 1)];
}

/**
 * 분기 선택값을 **로케일 무관 canonical 값**(group.value)으로 정규화한다.
 *
 * 분석 이벤트(ms_visitor_type_selected, generate_lead 등)에 로케일 화면 라벨을 그대로 실으면
 * 같은 세그먼트가 언어별로 다른 값("바이어" vs "Buyer")으로 갈라져, GTM 트리거가 언어마다
 * 따로 깨진다(설계 §18). 매칭되는 그룹이 없으면(분기 꺼짐·값 없음) 원본을 그대로 돌려준다 —
 * 이벤트가 최소한 뭔가는 싣게.
 */
export function canonicalBranchValue(config: CollectFormConfig, chosen: string): string {
  if (!config.branch.enabled || !chosen) return chosen;
  return resolveBranchGroup(config, chosen)?.value ?? chosen;
}

const COMPANION_FIELD_PATTERNS = [
  /companion/i,
  /accompany(?:ing|ied)?/i,
  /동반\s*(?:자|인원|아동|어린이)?\s*(?:수|인원)?/,
];

const COMPANION_COUNT_PATTERNS = [
  /how\s+many/i,
  /(?:number|count)\s+of/i,
  /companions?\s*(?:count|number)?$/i,
  /(?:동반|아동|어린이).*(?:몇\s*명|인원\s*수|명\s*수|수)/,
];

function companionFieldScore(field: CollectField): number {
  const candidates = [field.key, ...Object.values(field.label)].map(String);
  if (!candidates.some((value) => COMPANION_FIELD_PATTERNS.some((pattern) => pattern.test(value)))) return -1;

  // An explicit operator choice always wins. Otherwise prefer a question that asks for a count;
  // prose such as an age option's "must be accompanied by a companion" must not become the count.
  if (field.showOnTicket) return 3;
  if (candidates.some((value) => COMPANION_COUNT_PATTERNS.some((pattern) => pattern.test(value)))) return 2;
  if (field.type === "number") return 1;
  return 0;
}

/** 동반자 수 문항을 자동으로 찾아 1명 이상일 때만 티켓용 표시 값을 만든다. */
export function companionTicketExtras(
  config: CollectFormConfig,
  data: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const field = config.fields
    .map((candidate) => ({ candidate, score: companionFieldScore(candidate) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)[0]?.candidate;
  if (!field) return [];

  const raw = data[field.key];
  const count = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(count) || count < 1) return [];
  return [{ label: "Companions", value: String(Math.floor(count)) }];
}

/**
 * 런타임과 서버가 **같이** 부르는 검증. 서버는 이걸 통과한 뒤에도 접수 창과 중복을 따로 본다
 * (창은 시각, 중복은 DB 라 순수 함수로 못 본다).
 *
 * `isValidEmail`·`normalizePhoneToE164` 를 주입받는 이유: 전화 정규화는 libphonenumber-js 에
 * 의존하는데 그걸 이 순수 모듈에 묶으면 임베드 번들이 통째로 커진다. 호출부가 넣는다.
 */
export function validateSubmission(
  config: CollectFormConfig,
  values: Record<string, unknown>,
  deps: {
    isValidEmail: (v: string) => boolean;
    isValidPhone: (v: string, country: string) => boolean;
    /**
     * 그 전화 항목을 **어느 나라 번호로 읽을 것인가**.
     * 방문자가 폼에서 국가를 고를 수 있으므로(§6.3) 설정값 하나로는 부족하다 —
     * LA 폼(기본 US)에 한국 참관객이 오는 것이 파일럿의 기본 시나리오다.
     * 주지 않으면 설정의 기본 국가를 쓴다(옛 호출부 호환).
     */
    countryFor?: (fieldKey: string) => string;
    consent: { privacy?: boolean; marketing?: boolean };
  },
): SubmissionIssue[] {
  const issues: SubmissionIssue[] = [];
  const fields = visibleFields(config, values);
  const allowed = new Set(fields.map((f) => f.key));
  // 체크박스로 쓰이는 안내 블록도 **정당한 폼 입력**이다. 항목 key 만 허용하면 필수 안내에
  // 동의한 제출이 unknown_key 로 거부된다(등록이 통째로 막힌다).
  for (const n of config.notices) {
    if (n.enabled && n.mode !== "notice") allowed.add(noticeValueKey(n.id));
  }

  // 정의에 없는 키는 거부한다 — 받아 두면 CollectRecord.data 가 임의 입력으로 오염된다.
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) issues.push({ key, code: "unknown_key" });
  }

  for (const f of fields) {
    const raw = Object.prototype.hasOwnProperty.call(values, f.key) ? values[f.key] : undefined;

    /**
     * 체크박스는 **true 만 채워진 것**이다.
     *
     * 다른 유형과 같은 규칙(문자열로 바꿔 빈 문자열인가)을 쓰면 `String(false) === "false"` 라
     * 안 누른 체크박스가 "값이 있음" 으로 통과한다 — 필수 동의·확인이 서버까지 무사히 지나가고
     * data 에 false 가 정답처럼 저장된다. 아래 안내 블록 체크박스는 처음부터 `!== true` 였는데
     * 겉모습이 같은 두 컨트롤의 규칙이 반대였다.
     */
    const empty = f.type === "checkbox"
      ? raw !== true
      : raw == null || safeStr(raw).trim() === "" || (Array.isArray(raw) && raw.length === 0);

    if (f.required && empty) {
      issues.push({ key: f.key, code: "required" });
      continue;
    }
    if (empty) continue;

    if (f.type === "email" && !deps.isValidEmail(safeStr(raw).trim())) {
      issues.push({ key: f.key, code: "invalid_email" });
    }
    const telCountry = deps.countryFor?.(f.key) || config.validation.defaultCountry;
    if (f.type === "tel" && !deps.isValidPhone(safeStr(raw).trim(), telCountry)) {
      issues.push({ key: f.key, code: "invalid_phone" });
    }
    // 숫자만 — 국가별 규칙이 없는 단순 자릿수 검증이라 tel 처럼 의존성을 주입받지 않고 여기서 바로 본다.
    if (f.type === "number" && !NUMERIC_ONLY.test(safeStr(raw).trim())) {
      issues.push({ key: f.key, code: "invalid_number" });
    }
    if (f.type === "multiple") {
      const arr = Array.isArray(raw) ? raw : [raw];
      if (f.maxSelect != null && arr.length > f.maxSelect) issues.push({ key: f.key, code: "too_many" });
      // allowOther 면 선택지 대조를 하지 않는다 — 하면 '기타' 자유 입력이 전부 막힌다.
      if (!f.allowOther && f.options.length) {
        const labels = new Set(f.options.flatMap((o) => Object.values(o)));
        if (arr.some((v) => !labels.has(safeStr(v)))) issues.push({ key: f.key, code: "not_an_option" });
      }
    }
    if ((f.type === "select" || f.type === "radio") && !f.allowOther && f.options.length) {
      const labels = new Set(f.options.flatMap((o) => Object.values(o)));
      if (!labels.has(safeStr(raw))) issues.push({ key: f.key, code: "not_an_option" });
    }
  }

  if (config.consent.privacy.enabled && deps.consent.privacy !== true) {
    issues.push({ key: "consent_privacy", code: "consent_required" });
  }
  // 안내 블록 중 필수 체크로 승격된 것(파리의 초상권 등)도 같은 규칙으로 본다.
  // **폼 위에 그려지는 배치만** — 완료 화면·이메일에 놓인 안내는 체크할 컨트롤이 없어서
  // 요구해 봐야 누를 수 없는 동의가 되고, 그러면 어떤 제출도 통과하지 못한다.
  for (const n of config.notices) {
    if (!n.enabled || n.mode !== "checkbox-required" || !isOnFormPlacement(n.placement)) continue;
    const k = noticeValueKey(n.id);
    if (values[k] !== true) issues.push({ key: k, code: "consent_required" });
  }

  return issues;
}
