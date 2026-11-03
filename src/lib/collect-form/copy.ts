/**
 * 등록 폼 기본 문구 — 한국어·영어(2026-11-03). "기본 정보 › 폼 언어"(formConfig.defaultLocale)로 고른다.
 *
 * 운영자가 적은 항목 이름·선택지·안내는 여기 없다 — 적은 그대로 나간다.
 * 여기는 운영자가 안 적었을 때 쓰는 문구(버튼·상태 안내·오류·동의 기본 문구)다.
 * 빌더의 입력칸 placeholder("비우면: …")도 같은 표를 읽는다 — 화면과 안내가 어긋나지 않게.
 */

const EN = {
  before: { title: "Registration hasn't opened yet", body: "The form will appear here once registration opens." },
  closed: { title: "Registration is closed", body: "On-site registration is available at the venue." },
  /** 운영 일정 — 사전등록 마감 뒤, 다음 현장등록 전. {next} 자리에 현지 시각이 들어간다(운영자가 문구를 바꿀 수 있다) */
  between: { title: "Pre-registration is closed", body: "On-site registration opens {next}. Please register at the venue." },
  /** 미리보기 "사전 마감"에서 현장등록 시각을 아직 안 적었을 때 {next} 자리 */
  nextSample: "(on-site registration time)",
  submit: "Register",
  submitting: "Submitting…",
  empty: "This form has no fields yet.",
  required: "Required",
  invalidEmail: "Check the email format",
  invalidPhone: "This number isn't valid for the selected country",
  invalidNumber: "Numbers only",
  unknownKey: "Not part of this form",
  tooMany: "Too many selected",
  notAnOption: "Not one of the options",
  consentRequired: "Please agree to continue",
  duplicate: "This email is already registered.",
  networkError: "Couldn't submit. Please try again.",
  closedNow: "Registration just closed.",
  notOpenYet: "Registration hasn't opened yet.",
  doneTitle: "You're registered",
  checkinTitle: "Show this QR code at the check-in desk",
  checkinBodyWithEmail: "You can also find the same QR code in your confirmation email.",
  regNoLabel: "Registration number — show this at the venue",
  previewFlag: "Preview — nothing is saved",
  ticketLink: "Open my ticket page →",
  saveImage: "Save as Image",
  saveHint: "* If the button doesn't work, please take a screenshot.",
  previewDone: "Sample number — nothing was saved.",
  more: "Details",
  less: "Hide",
  close: "Close",
  agree: "I agree",
  period: "Period",
  venue: "Venue",
  openingHours: "Opening Hours",
  select: "Select",
  noOptions: "No options configured",
  chooseUpTo: "Choose up to {n}",
  other: "Other",
  otherPlaceholder: "Please specify",
  phone: "Phone",
  email: "E-mail",
  qrAlt: "Registration QR for {regNo}",
  consentPrivacy: "I agree to the privacy policy",
  consentMarketing: "Send me updates",
  consentThirdParty: "Share my information with event partners",
};

export type FormCopy = typeof EN;

const KO: FormCopy = {
  before: { title: "아직 등록 기간이 아니에요", body: "등록이 시작되면 이곳에 신청서가 열려요." },
  closed: { title: "등록이 마감됐어요", body: "현장에서 등록하실 수 있어요." },
  between: { title: "사전등록이 마감됐어요", body: "현장등록은 {next}부터 시작돼요. 행사장에서 등록해 주세요." },
  nextSample: "(현장등록 시작 시각)",
  submit: "등록하기",
  submitting: "등록 중…",
  empty: "아직 항목이 없어요.",
  required: "필수 항목이에요",
  invalidEmail: "이메일 형식을 확인해 주세요",
  invalidPhone: "선택한 국가의 전화번호 형식이 아니에요",
  invalidNumber: "숫자만 입력해 주세요",
  unknownKey: "이 폼에 없는 항목이에요",
  tooMany: "선택할 수 있는 개수를 넘었어요",
  notAnOption: "선택지에 없는 값이에요",
  consentRequired: "동의해야 등록할 수 있어요",
  duplicate: "이미 등록된 이메일이에요.",
  networkError: "등록하지 못했어요. 다시 시도해 주세요.",
  closedNow: "방금 등록이 마감됐어요.",
  notOpenYet: "아직 등록 기간이 아니에요.",
  doneTitle: "등록이 완료됐어요",
  checkinTitle: "입장할 때 이 QR 코드를 보여 주세요",
  checkinBodyWithEmail: "확인 메일에서도 같은 QR 코드를 볼 수 있어요.",
  regNoLabel: "등록번호 — 현장에서 보여 주세요",
  previewFlag: "미리보기 — 저장되지 않아요",
  ticketLink: "내 입장권 페이지 열기 →",
  saveImage: "이미지로 저장",
  saveHint: "* 버튼이 안 되면 화면을 캡처해 주세요.",
  previewDone: "예시 번호예요 — 저장되지 않았어요.",
  more: "자세히",
  less: "접기",
  close: "닫기",
  agree: "동의합니다",
  period: "기간",
  venue: "장소",
  openingHours: "운영 시간",
  select: "선택해 주세요",
  noOptions: "선택지가 없어요",
  chooseUpTo: "최대 {n}개까지 선택할 수 있어요",
  other: "기타",
  otherPlaceholder: "직접 입력",
  phone: "연락처",
  email: "이메일",
  qrAlt: "{regNo} 등록 QR",
  consentPrivacy: "개인정보 수집·이용에 동의합니다",
  consentMarketing: "행사 소식을 받아볼게요",
  consentThirdParty: "행사 협력사에 정보 제공하는 것에 동의합니다",
};

const LOOKUP_EN = {
  title: "Find my QR",
  desc: "Enter what you registered with.",
  email: "Email",
  phone: "Phone",
  submit: "Find my registration",
  searching: "Searching…",
  /** 못 찾았을 때는 **이 문구 하나로만** 끝낸다(§10.2) — 이유를 나누면 열거 힌트가 된다. */
  notFound: "We couldn't find a registration with that information.",
  needSomething: "Enter your email or phone number first.",
  networkError: "Something went wrong. Please try again.",
  saveImage: "Save as Image",
  saveHint: "* If the button doesn't work, please take a screenshot.",
  searchAgain: "Search Again",
  tooMany: "Too many attempts. Please try again in a few minutes.",
  regNoLabel: "Show this at the venue",
  noQr: "Your registration was found. We'll email your ticket again.",
  needBoth: "Enter both your email and phone number.",
  needEmail: "Your email is missing.",
  needPhone: "Your phone number is missing.",
  ticketLink: "Open my ticket page →",
  previewFlag: "Preview — nothing is saved",
};

export type LookupCopy = typeof LOOKUP_EN;

const LOOKUP_KO: LookupCopy = {
  title: "내 QR 찾기",
  desc: "등록할 때 적은 정보를 입력해 주세요.",
  email: "이메일",
  phone: "연락처",
  submit: "내 등록 찾기",
  searching: "찾는 중…",
  notFound: "입력한 정보로 등록 내역을 찾지 못했어요.",
  needSomething: "이메일이나 연락처를 먼저 입력해 주세요.",
  networkError: "문제가 생겼어요. 다시 시도해 주세요.",
  saveImage: "이미지로 저장",
  saveHint: "* 버튼이 안 되면 화면을 캡처해 주세요.",
  searchAgain: "다시 찾기",
  tooMany: "시도가 너무 많아요. 몇 분 뒤에 다시 해 주세요.",
  regNoLabel: "현장에서 보여 주세요",
  noQr: "등록 내역을 찾았어요. 입장권을 메일로 다시 보내 드릴게요.",
  needBoth: "이메일과 연락처를 모두 입력해 주세요.",
  needEmail: "이메일을 입력해 주세요.",
  needPhone: "연락처를 입력해 주세요.",
  ticketLink: "내 입장권 페이지 열기 →",
  previewFlag: "미리보기 — 저장되지 않아요",
};

/** 언어 코드("ko", "ko-KR", "en" …) → 문구. 모르는 언어는 영어. */
export function formCopy(locale: string | undefined): FormCopy {
  return (locale ?? "").toLowerCase().startsWith("ko") ? KO : EN;
}

export function lookupCopy(locale: string | undefined): LookupCopy {
  return (locale ?? "").toLowerCase().startsWith("ko") ? LOOKUP_KO : LOOKUP_EN;
}

/** "{n}" 같은 자리 채우기 */
export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
