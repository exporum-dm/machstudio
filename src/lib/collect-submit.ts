/**
 * 빌더형 제출을 **저장 직전 모양**까지 만드는 순수 함수 (설계 §19).
 *
 * DB 를 보지 않는다. 그래서 두 곳이 같은 함수를 쓸 수 있다:
 *  · 서버 라우트 — 이 결과를 그대로 INSERT 한다.
 *  · 미리보기 — 여기까지 **똑같이 돌리고 저장만 안 한다**(설계 §16.1 "검증까지는 실제와 똑같이
 *    돌리고 저장 직전에 멈춘 뒤"). 미리보기 전용 검증 경로를 따로 두면 "미리보기는 통과했는데
 *    실제는 400" 이 생긴다.
 *
 * 중복 판정만은 여기서 못 한다(DB 가 필요하다). 그건 라우트가 P2002 로 받는다 — 조회 후
 * INSERT 만으로는 동시 제출을 못 막기 때문에 **DB 제약이 최종 방어선**이다(설계 §6.2).
 */
import { isValidCollectEmail, normalizeEmail } from "@/lib/collect-email";
import { isValidPhoneForCountry, toE164 } from "@/lib/collect-phone";
import { isKnownCountry } from "@/lib/collect-country";
import { generateRegistrationNo } from "@/lib/collect-registration-no";
import {
  entryChannelAt,
  resolveRegistrationStatus,
  validateSubmission,
  visibleFields,
  type CollectFormConfig,
  type SubmissionIssue,
} from "@/lib/collect-form-config";

/** 저장 직전의 레코드 조각 — 라우트가 공통 필드(utm·referrer 등)와 합쳐 INSERT 한다. */
export interface PreparedSubmission {
  /** CollectRecord.data 로 들어갈 값. **정의에 있는 키만** 남는다. */
  data: Record<string, unknown>;
  registrationNo: string;
  /** 소문자·trim. 이메일 항목이 없으면 null — 그러면 중복 차단도 걸리지 않는다. */
  emailNormalized: string | null;
  /**
   * 중복 판정에 쓴 이메일 항목의 저장 키.
   * 409 응답에 실어 보낸다 — 이메일 항목이 여러 개인 폼에서 클라이언트가 안내를
   * **엉뚱한 칸**(첫 항목)에 붙이지 않게 하기 위해서다.
   */
  emailKey: string | null;
  /** E.164. 파싱 실패면 null(원문은 data 에 남는다). */
  phoneE164: string | null;
  locale: string;
  /** "onsite" = 등록 운영 일정의 현장등록 시간에 들어온 등록(일정이 꺼져 있으면 늘 "online") */
  entryChannel: "online" | "onsite";
  /** 동의 기록 — data 안에 넣지 않는다. 항목 키와 섞이면 CSV 열이 뒤죽박죽이 된다. */
  consent: { privacy: boolean; marketing: boolean; thirdParty: boolean };
}

export type PrepareResult =
  | { ok: true; prepared: PreparedSubmission }
  /** 접수 창 밖 — 403. 클라이언트가 마감 화면으로 바꿔야 하므로 상태를 함께 준다. */
  | { ok: false; code: "closed"; status: "before" | "closed" }
  /** 형식 검증 실패 — 400. 항목별 인라인 표시에 그대로 쓴다. */
  | { ok: false; code: "invalid"; issues: SubmissionIssue[] };

export interface SubmissionInput {
  values: Record<string, unknown>;
  consent?: { privacy?: unknown; marketing?: unknown; thirdParty?: unknown };
  locale?: unknown;
  /**
   * 전화 항목별로 방문자가 고른 국가(§6.3). `{ phone: "KR" }`.
   *
   * 왜 값에 국가번호를 붙여 보내지 않나: 나라마다 **국내 표기의 앞 0** 규칙이 다르다.
   * 한국 `01012345678` 앞에 `+82` 를 그냥 붙이면 `+82010…` 이 되어 틀린 번호가 된다.
   * 앞 0 처리는 libphonenumber 가 "이 나라 번호로 읽어라" 를 알아야 할 수 있으므로,
   * 붙이지 않고 **어느 나라인지**를 보낸다.
   */
  phoneCountries?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * 한 항목에 담을 수 있는 최대 길이. 자유 서술(회사 소개 등)도 넉넉히 들어가되,
 * 인증 없는 쓰기 경로가 **DB 를 임의 크기로 부풀리지 못하게** 한다.
 */
const MAX_VALUE_LEN = 2000;
/** 복수 선택의 최대 항목 수 — 선택지가 아무리 많아도 이보다 많이 고를 수는 없다. */
const MAX_ARRAY_LEN = 100;

/**
 * 저장 가능한 모양으로 좁힌다. **문자열·불리언·숫자와 그 배열만** 남긴다.
 *
 * 없으면: `{"name":{"a":{"b":[...]}}}` 같은 중첩 객체가 검증을 통과해(빈 값이 아니므로)
 * CollectRecord.data 에 그대로 저장되고, data 를 문자열 맵으로 가정하는 소비처
 * (등록자 표·CSV 내보내기·웹훅 페이로드)가 등록 오픈 직후 한꺼번에 깨진다.
 * 그런 값은 **거절이 아니라 제거**한다 — 정상 항목까지 400 으로 막을 이유가 없다.
 */
function narrowValue(v: unknown): unknown {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") return v.slice(0, MAX_VALUE_LEN);
  if (Array.isArray(v)) {
    const out = v
      .slice(0, MAX_ARRAY_LEN)
      .map((x) => (typeof x === "string" ? x.slice(0, MAX_VALUE_LEN) : typeof x === "number" || typeof x === "boolean" ? x : undefined))
      .filter((x) => x !== undefined);
    return out;
  }
  return undefined;
}

/**
 * 이메일·전화의 **대표 항목**을 고른다.
 *
 * 정규화 컬럼(emailNormalized·phoneE164)은 하나씩뿐인데 폼에는 같은 유형이 여럿일 수 있다
 * (예: 본인 이메일 + 회사 대표 이메일). 규칙은 **값이 채워진 것 중 보이는 순서로 처음**이다.
 *
 * "값 유무를 보지 않고 순서상 첫 항목" 이면, 위칸이 선택 항목인 폼에서 그 칸을 비운 모든
 * 제출이 emailNormalized = null 로 저장된다. 부분 유니크는 `WHERE emailNormalized IS NOT NULL`
 * 이라 **중복 차단이 통째로 꺼진다** — 화면에는 "중복은 막습니다" 라고 적혀 있는 채로.
 * 값이 하나도 없으면 첫 항목 키를 돌려준다(그때는 어차피 null 이 맞다).
 */
export function primaryFieldKey(
  config: CollectFormConfig,
  values: Record<string, unknown>,
  type: "email" | "tel",
): string | null {
  const candidates = visibleFields(config, values).filter((x) => x.type === type);
  if (candidates.length === 0) return null;
  const filled = candidates.find((x) => str(values[x.key]).trim() !== "");
  return (filled ?? candidates[0]).key;
}

/**
 * 이메일 규칙은 `collect-email.ts` 한 곳에 있다 — 브라우저 런타임도 같은 함수를 써야
 * 하는데 이 파일은 `node:crypto`(등록번호 발급)를 끌고 다녀 번들에 못 들어간다.
 * 기존 호출부가 여기서 가져오고 있어 재수출한다.
 */
export { isValidCollectEmail, normalizeEmail } from "@/lib/collect-email";

/**
 * 요청 본문 → `SubmissionInput` 한 곳에서 만든다.
 *
 * **왜 함수로 뽑나.** 라우트가 손으로 필드를 골라 담고 있었는데, `SubmissionInput` 에
 * 항목을 하나 더해도 라우트를 같이 고치지 않으면 **조용히 떨어진다** — 타입 오류도 안 난다
 * (선택 필드라서). 실제로 phoneCountries 가 그렇게 빠졌다: 클라이언트는 보내고 순수
 * 함수는 받는데 라우트가 안 넘겨, 방문자가 고른 국가가 서버에서 무시됐다.
 * 단위 테스트가 있는 함수 하나로 모으면 그 실패가 다시 생기지 않는다.
 */
export function submissionInputFromBody(body: Record<string, unknown>): SubmissionInput {
  return {
    values: (body.values ?? {}) as Record<string, unknown>,
    consent: body.consent as SubmissionInput["consent"],
    locale: body.locale,
    phoneCountries: body.phoneCountries,
  };
}

export function prepareBuilderSubmission(
  config: CollectFormConfig,
  input: SubmissionInput,
  now: Date,
): PrepareResult {
  // ── 1. 접수 창 ─────────────────────────────────────────────────────
  // **서버에서도 반드시 본다.** 클라이언트만 막으면 마감 후 API 로 등록이 들어온다(§5.1).
  const status = resolveRegistrationStatus(config, now);
  if (status !== "open") return { ok: false, code: "closed", status };

  const rawValues = input.values && typeof input.values === "object" ? input.values : {};

  // ── 2. 정의에 있는 키만 남긴다 ──────────────────────────────────────
  // 검증은 unknown_key 로 거부하지만, 그 전에 **분기 밖 값**을 떨어내야 한다. 유형을 바꿔
  // 가며 채운 사람의 요청에는 지금 안 보이는 그룹의 값이 남아 있고(런타임이 공통 입력값을
  // 유지하므로 정상 동작이다), 그대로 넘기면 고칠 칸도 없는 오류로 등록이 영영 막힌다.
  const fields = visibleFields(config, rawValues);
  const allowed = new Set(fields.map((f) => f.key));
  for (const n of config.notices) {
    if (n.enabled && n.mode !== "notice") allowed.add(`notice_${n.id}`);
  }
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawValues)) {
    if (!allowed.has(k)) continue;
    const narrowed = narrowValue(v);
    if (narrowed !== undefined) values[k] = narrowed;
  }

  // ── 3. 형식 검증 — 런타임과 **같은 함수** ───────────────────────────
  const consent = {
    privacy: input.consent?.privacy === true,
    marketing: input.consent?.marketing === true,
    thirdParty: input.consent?.thirdParty === true,
  };
  /**
   * 방문자가 고른 국가는 **아는 코드만** 받는다. 아무 문자열이나 통과시키면 toE164 가
   * 전부 null 을 내고 그 폼의 전화가 통째로 무효가 된다 — 화면엔 이유가 안 뜬다.
   */
  const picked = input.phoneCountries;
  const countryFor = (key: string): string => {
    const v = picked && typeof picked === "object" ? (picked as Record<string, unknown>)[key] : null;
    return isKnownCountry(v) ? String(v).toUpperCase() : config.validation.defaultCountry;
  };

  const issues = validateSubmission(config, values, {
    isValidEmail: isValidCollectEmail,
    isValidPhone: (v, country) => isValidPhoneForCountry(v, country),
    countryFor,
    consent,
  });
  if (issues.length > 0) return { ok: false, code: "invalid", issues };

  // ── 4. 정규화 컬럼 ─────────────────────────────────────────────────
  const emailKey = primaryFieldKey(config, values, "email");
  const phoneKey = primaryFieldKey(config, values, "tel");
  const emailNormalized = emailKey ? normalizeEmail(values[emailKey]) : null;
  const phoneRaw = phoneKey ? str(values[phoneKey]).trim() : "";
  const phoneE164 = phoneRaw && phoneKey ? toE164(phoneRaw, countryFor(phoneKey)) : null;

  // 로케일은 뷰어가 보낸 값을 **폼이 아는 것 중에서만** 받는다. 아무 문자열이나 저장하면
  // 나중에 언어별 재발송이 그 값으로 갈라져 보낼 수 없는 언어가 생긴다.
  const known = new Set<string>([config.defaultLocale]);
  for (const f of config.fields) for (const k of Object.keys(f.label)) known.add(k);
  const asked = str(input.locale).trim();
  const locale = asked && known.has(asked) ? asked : config.defaultLocale;

  return {
    ok: true,
    prepared: {
      data: values,
      registrationNo: generateRegistrationNo(),
      emailNormalized,
      emailKey,
      phoneE164,
      locale,
      entryChannel: entryChannelAt(config, now),
      consent,
    },
  };
}
