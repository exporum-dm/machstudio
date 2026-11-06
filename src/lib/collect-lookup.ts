/**
 * 등록 확인(Find My QR)의 **순수 판정** (설계 §10).
 *
 * "내가 등록했나?" 와 "QR 을 잃어버렸다" 를 홈페이지에서 바로 푸는 화면이고, 이메일 연동
 * 전에는 등록자가 QR 을 되찾는 **유일한 경로**다(§2). 그래서 부가 기능이 아니다.
 *
 * DB 를 보지 않는다 — 조회 조건을 만드는 일과, 찾은 레코드에서 **보여줄 것만 추리는** 일만
 * 한다. 그 둘이 라우트 안에 섞여 있으면 "무엇을 노출하는가" 를 나중에 아무도 못 읽는다.
 */
import { toE164, isSupportedCountry } from "@/lib/collect-phone";
import { isValidCollectEmail, normalizeEmail } from "@/lib/collect-submit";
import { companionTicketExtras, type CollectFormConfig, type Localized } from "@/lib/collect-form-config";
import { resolveVisitorBadgeLabel } from "@/lib/collect-badge";

/** 조회 입력 — 설정에 따라 둘 중 하나만 쓰일 수도 있다. */
export interface LookupInput {
  email?: unknown;
  phone?: unknown;
  /**
   * 등록 폼과 같은 국가 선택(§6.3). 등록자가 기본 국가가 아닌 나라를 골라 등록했다면
   * 저장된 번호도 그 나라 기준 E.164 다 — 조회도 같은 국가를 골라야 같은 값이 나온다.
   * 안 왔거나 모르는 코드면 `config.validation.defaultCountry` 로 되돌아간다.
   */
  phoneCountry?: unknown;
}

/** 정규화된 조회 조건. 둘 다 null 이면 조회 자체를 하지 않는다. */
export interface LookupCriteria {
  emailNormalized: string | null;
  phoneE164: string | null;
  /** `and` 면 둘 다 일치해야 한다(§10.1 — 유료 전시 전환 시 설정만 바꾼다). */
  logic: "or" | "and";
}

/**
 * 조회 조건을 만든다. **설정이 허용한 항목만** 본다 — `fields: ["email"]` 인데 전화로
 * 조회되면 운영자가 좁혀 놓은 것이 무의미해진다.
 *
 * 전화는 반드시 E.164 로 바꿔 비교한다(§10.1). `010-1234-5678` 로 친 사람과 `+8210…` 로
 * 저장된 값이 맞아야 하는데, 표기를 그대로 비교하면 **본인 번호로도 못 찾는다.**
 */
export function buildLookupCriteria(config: CollectFormConfig, input: LookupInput): LookupCriteria | null {
  const allowEmail = config.lookup.fields.includes("email");
  const allowPhone = config.lookup.fields.includes("phone");

  const rawEmail = allowEmail ? normalizeEmail(input.email) : null;
  const emailNormalized = rawEmail && isValidCollectEmail(rawEmail) ? rawEmail : null;

  const rawPhone = allowPhone ? String(input.phone ?? "").trim() : "";
  const phoneCountry = isSupportedCountry(input.phoneCountry)
    ? String(input.phoneCountry).toUpperCase()
    : config.validation.defaultCountry;
  const phoneE164 = rawPhone ? toE164(rawPhone, phoneCountry) : null;

  if (!emailNormalized && !phoneE164) return null;

  /**
   * `and` 인데 한쪽만 들어왔으면 **조회하지 않는다.**
   * 한쪽만으로 조회해 버리면 `and` 설정이 사실상 `or` 로 동작한다 — 유료 전시에서 남의
   * 티켓이 열리는 바로 그 실패다.
   */
  if (config.lookup.logic === "and" && !(emailNormalized && phoneE164)) return null;

  return { emailNormalized, phoneE164, logic: config.lookup.logic };
}

/**
 * 번호로 직접 연 티켓 화면이 쓰는 것.
 *
 * **연락처가 없다.** 이 화면은 번호만 알면 열리므로, 가려서라도 연락처를 얹으면
 * 번호를 주운 사람에게 단서를 준다. 조회 화면(LookupView)은 본인이 이메일이나 전화를
 * 직접 입력해 통과한 뒤라 사정이 다르다 — 그래서 타입을 분리한다.
 */
export interface TicketView {
  registrationNo: string;
  /** 본인 확인용 표시 이름. 못 고르면 빈 문자열(화면에서 생략한다). */
  name: string;
  /** 참관객 유형 — 분기 기준 항목의 값. 분기가 없으면 빈 문자열. */
  visitorType: string;
  /** 티켓을 주운 사람이 원문을 알 수 없도록 가린 본인 확인용 연락처. */
  maskedEmail: string;
  maskedPhone: string;
  /**
   * 운영자가 항목별로 `showOnTicket` 을 켠 답만 담는다(예: 동반 인원 수).
   * 기본은 빈 배열 — §10.2 최소 노출 원칙의 명시적 예외라 운영자가 켠 것만 나간다.
   * 값이 빈 항목은 빼서(§공통 "빈 껍데기 노출 금지") 화면에 빈 줄이 뜨지 않는다.
   */
  extras: Array<{ label: string; value: string }>;
}

/** 조회 화면에 내보내는 것 — **이게 전부다**(§10.2 "표시 정보는 최소화"). */
export interface LookupView {
  /** 순차 번호의 공개 티켓을 보호한다. 본인 확인 후에만 제공한다. */
  ticketKey?: string;
  /**
   * **showQr 이 꺼져 있으면 null 이다.**
   *
   * 번호가 곧 티켓이다 — `/t/{regNo}` 는 번호만 알면 이름·유형·QR 을 전부 연다.
   * `or` + `showQr:false` 는 "이메일 하나만 아는 사람에게 티켓을 주지 않겠다" 는
   * 설정인데, 응답에 번호를 실어 보내면 화면에서 감춰도 그 의도가 무너진다(§10.1·§10.2).
   */
  registrationNo: string | null;
  /** 본인 확인용 표시 이름. 못 고르면 빈 문자열(화면에서 생략한다). */
  name: string;
  /** 참관객 유형 — 분기 기준 항목의 값. 분기가 없으면 빈 문자열. */
  visitorType: string;
  /** QR 을 보여줄 것인가. false 면 "메일로 재발송" 만 안내한다(§10.1). */
  showQr: boolean;
  /**
   * 본인 확인용 **가려진** 연락처. 없으면 빈 문자열.
   *
   * §10.2 는 "연락처는 절대 넣지 않는다" 였다. 그런데 이름만으로는 동명이인이 흔하고,
   * 줄에 서서 "이게 내 거 맞나" 를 확인할 방법이 없다는 실제 불편이 있었다.
   * 그래서 **가려서** 내보낸다 — h•••@gmail.com / •••••••1198.
   *
   * 가리는 게 핵심이다. 조회는 `or` 로 열어 둘 수 있어서 **이메일 하나만 아는 사람에게도
   * 열린다.** 그대로 실어 보내면 그 사람이 남의 전화번호를 가져간다. 가려 두면 본인은
   * "내 거 맞네" 를 알아보고, 모르는 쪽 연락처는 여전히 새어 나가지 않는다.
   */
  maskedEmail: string;
  maskedPhone: string;
  /** 현장 확인용으로 티켓에 노출되는 동반 인원. 다른 제출 답변은 포함하지 않는다. */
  extras: Array<{ label: string; value: string }>;
}

/**
 * 이메일 가리기 — 첫 글자와 도메인만 남긴다(hajar…@gmail.com → h•••@gmail.com).
 * 도메인을 남기는 이유: 본인은 "지메일로 넣었지" 로 알아보는데, 도메인만으로는 사람을 못 찾는다.
 */
export function maskEmail(value: string): string {
  const raw = value.trim();
  const at = raw.lastIndexOf("@");
  if (at < 1) return "";
  return `${raw[0]}•••${raw.slice(at)}`;
}

/**
 * 전화 가리기 — **뒤 4자리만** 남긴다. 본인 확인은 뒷자리로 하고, 앞자리는 지역·통신사라
 * 정보량이 거의 없다. 4자리 미만이면 아예 안 보여 준다(가릴 게 없으면 가린 게 아니다).
 */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `•••••• ${digits.slice(-4)}`;
}

/**
 * 이름으로 쓸 만한 항목인가.
 *
 * **앵커를 건다.** 앵커 없는 정규식은 `family_members`(참관 인원수)나
 * `first_visit_company_name`(회사명)까지 잡아서 그 값이 티켓의 이름 자리에 인쇄된다 —
 * 최소 노출 원칙(§10.2)을 어기는 방향이다.
 *
 * key 와 **라벨을 함께 본다.** key 는 운영자가 손으로 적는 자유 문자열이고, 빌더가 주는
 * 기본값은 `field`·`field_2` 다(keyFromLabel 이 빈 라벨에 대해 그렇게 만든다). 라벨에
 * "First name" 이라고 적어 놓고 key 를 안 고친 폼이 기본 경로인데, key 만 보면 그런 폼은
 * **이름 줄이 통째로 사라진다** — 조회 결과가 내 것인지 확인할 유일한 표시다.
 */
const NAME_PATTERNS = [
  /^(first|last|given|family|full)[_-]?names?$/i,
  /^names?$/i,
  /^surnames?$/i,
  /^(first|last|given|family)$/i,
];
function looksLikeName(field: { key: string; label: Localized }): boolean {
  const candidates = [field.key, ...Object.values(field.label)]
    .map((v) => String(v).trim().replace(/\s+/g, "_"))
    .filter(Boolean);
  return candidates.some((c) => NAME_PATTERNS.some((re) => re.test(c)));
}

/**
 * 찾은 레코드에서 **보여줄 것만** 추린다.
 *
 * 연락처 전체·다른 문항 답변은 **절대 넣지 않는다**(§10.2). `or` 로 열어 둔 화면이라
 * 이메일 하나만 아는 사람에게도 열리는데, 거기에 회사·직함·응답이 딸려 나오면 그건
 * 명단 유출이다. 이름은 "본인이 맞구나" 를 확인할 최소치로만 쓴다.
 */
export function buildLookupView(
  config: CollectFormConfig,
  record: { id?: string; registrationNo: string | null; data: unknown },
): LookupView | null {
  const base = buildTicketView(config, record);
  if (!base) return null;

  const data = (record.data && typeof record.data === "object" ? record.data : {}) as Record<string, unknown>;
  const pick = (type: string) => {
    const field = config.fields.find((f) => f.type === type);
    const value = field ? data[field.key] : undefined;
    return typeof value === "string" ? value : "";
  };

  return {
    // base 를 통째로 펼치지 않는다 — base(TicketView)에는 운영자가 켠 extras 가 실릴 수 있는데,
    // 이 화면은 이메일 하나만 아는 사람에게도 `or` 로 열린다(§10.2). extras 는 번호를 이미
    // 손에 쥔 사람만 보는 티켓 화면(buildTicketView) 전용 예외라 여기까지 새면 안 된다.
    name: base.name,
    visitorType: base.visitorType,
    // 화면이 안 쓰는 값은 내보내지도 않는다(lookup-mount 는 showQr 가 false 면 번호를 그리지 않는다).
    registrationNo: config.lookup.showQr ? base.registrationNo : null,
    ...(config.lookup.showQr && base.registrationNo.length === 8 && record.id ? {ticketKey:record.id} : {}),
    showQr: config.lookup.showQr,
    maskedEmail: maskEmail(pick("email")),
    maskedPhone: maskPhone(pick("tel")),
    extras: base.extras,
  };
}

/**
 * 티켓 화면(`/t/{regNo}`)이 쓰는 표시 정보 — **번호를 이미 손에 쥔 사람**을 위한 것이라
 * 항상 번호가 들어 있다.
 *
 * 조회 화면과 정책이 다른 이유: `lookup.showQr` 는 "이메일 하나만 아는 사람에게 티켓을
 * 주지 않겠다" 는 설정이다. 번호로 직접 연 화면까지 그 설정으로 잠그면, 완료 화면에서
 * 이어지는 §2 의 **주 QR 전달 경로**가 조회 설정 하나로 같이 끊긴다.
 */
export function buildTicketView(
  config: CollectFormConfig,
  record: { registrationNo: string | null; data: unknown },
): TicketView | null {
  if (!record.registrationNo) return null;
  const data = (record.data && typeof record.data === "object" ? record.data : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  // 이름은 정의된 항목 중 이름처럼 생긴 것들을 **폼 순서대로** 이어 붙인다.
  const name = config.fields
    .filter((f) => looksLikeName(f))
    .map((f) => str(data[f.key]))
    .filter(Boolean)
    .join(" ");

  const baseVisitorType = config.branch.enabled ? str(data[config.branch.fieldKey]) : "";
  const visitorType = resolveVisitorBadgeLabel(config, data, baseVisitorType);

  const pick = (type: string) => {
    const field = config.fields.find((f) => f.type === type);
    return field ? str(data[field.key]) : "";
  };

  // showOnTicket 을 켠 항목만, 값이 있을 때만 — 빈 값을 그대로 보내면 화면에 빈 줄이 생긴다.
  const extras = companionTicketExtras(config, data);

  return {
    registrationNo: record.registrationNo,
    name,
    visitorType,
    maskedEmail: maskEmail(pick("email")),
    maskedPhone: maskPhone(pick("tel")),
    extras,
  };
}
