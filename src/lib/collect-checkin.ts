/**
 * 사전등록 현장 체크인 — 순수 로직(시간대·일자·표시 정보·판정).
 *
 * 설계 §12 는 "전용 스캐너 + 오프라인 노트북" 을 전제로 했지만, 운영 결정(2026-10-01)으로
 * **운영요원 휴대폰 + 온라인** 으로 간다. 그래서 판정은 서버에서 하고, 이 파일은 서버·화면이
 * 같이 쓰는 계산만 둔다(DB·네트워크 없음 → 테스트가 직접 찌른다).
 *
 * ── 운영 결정(2026-10-01) ─────────────────────────────────────────────
 *  · 접근: 비밀 링크 + 4자리 PIN
 *  · 화면에 보이는 것: 이름 · 유형 · 회사 (+ 운영자가 티켓에 보이라고 켠 항목). 연락처는 안 보인다
 *  · 재스캔: **스캔할 때마다 전부 기록**한다. 막지 않는다. 그날 첫 스캔은 초록, 이후는 노랑으로
 *    "N번째 · 첫 입장 10:12" 를 보여 준다 — 순방문 집계는 (record, 날짜) 로 거른다
 *  · 온라인 전용
 */
import type { CollectFormConfig, Localized } from "@/lib/collect-form-config";

/** 행사가 열리는 곳의 시간대. "하루" 와 화면 시각이 이걸 따른다 — LA 전시를 서울 시간으로 자르면 날짜가 밀린다. */
export const CHECKIN_TIMEZONES = [
  { value: "Asia/Seoul", label: "서울 (KST)" },
  { value: "America/Los_Angeles", label: "로스앤젤레스 (PT)" },
  { value: "America/New_York", label: "뉴욕 (ET)" },
  { value: "Europe/Paris", label: "파리 (CET)" },
  { value: "Europe/London", label: "런던 (GMT)" },
  { value: "Asia/Tokyo", label: "도쿄 (JST)" },
  { value: "Asia/Singapore", label: "싱가포르 (SGT)" },
  { value: "Asia/Ho_Chi_Minh", label: "호치민 (ICT)" },
] as const;

export function isCheckinTimezone(v: unknown): v is string {
  return typeof v === "string" && CHECKIN_TIMEZONES.some((t) => t.value === v);
}

export function normalizeCheckinTimezone(v: unknown): string {
  return isCheckinTimezone(v) ? v : "Asia/Seoul";
}

/** 그 시간대의 달력 날짜 "YYYY-MM-DD". */
export function eventDateIn(timezone: string, at: Date = new Date()): string {
  // en-CA 는 YYYY-MM-DD 로 찍는다.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeCheckinTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** 화면용 "오전 10:12" — 그 시간대 기준. */
export function timeIn(timezone: string, at: Date | string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: normalizeCheckinTimezone(timezone),
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

/** "10/22 오전 10:12" */
export function dateTimeIn(timezone: string, at: Date | string): string {
  const d = new Date(at);
  const md = new Intl.DateTimeFormat("ko-KR", {
    timeZone: normalizeCheckinTimezone(timezone),
    month: "numeric",
    day: "numeric",
  })
    .formatToParts(d)
    .filter((p) => p.type === "month" || p.type === "day")
    .map((p) => p.value)
    .join("/");
  return `${md} ${timeIn(timezone, d)}`;
}

/**
 * 운영요원 링크 끝부분(/checkin/{slug}) — 운영자가 직접 정한다(예: "la2026").
 *
 * 기억하기 쉬운 주소는 남이 짐작하기도 쉽다. 그래서 링크만으로는 아무것도 안 열리고 **PIN 이 진짜 문**이다
 * (PIN 시도는 기기·링크 단위로 묶여 있다). 영문 소문자·숫자·하이픈만, 4~40자.
 * 입력은 소스에서 정규화한다 — 대문자는 소문자로, 공백·밑줄은 하이픈으로, 그 밖의 글자는 버린다.
 */
export function normalizeCheckinSlug(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40);
}

export function checkinSlugError(slug: string): string {
  if (slug.length < 4) return "4자 이상으로 정해 주세요";
  if (slug.startsWith("-") || slug.endsWith("-")) return "하이픈(-)으로 시작하거나 끝날 수 없어요";
  return "";
}

/** PIN 은 숫자 4자리. 입력은 소스에서 정규화한다 — 숫자 아닌 건 버린다. */
export function normalizePin(input: unknown): string {
  return typeof input === "string" ? input.replace(/\D/g, "").slice(0, 4) : "";
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export const CHECKIN_METHODS = ["camera", "scanner", "manual"] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

export function normalizeMethod(v: unknown): CheckinMethod {
  return CHECKIN_METHODS.includes(v as CheckinMethod) ? (v as CheckinMethod) : "camera";
}

// ─── 화면에 보일 정보 ──────────────────────────────────────────────────

const COMPANY_PATTERNS = [/^(company|organi[sz]ation|affiliation|employer|firm|business)([_-]?name)?$/i, /회사|소속|기업|기관|업체/];

function looksLikeCompany(field: { key: string; label: Localized }): boolean {
  const candidates = [field.key, ...Object.values(field.label ?? {})].map((v) => String(v).trim().replace(/\s+/g, "_"));
  return candidates.some((c) => COMPANY_PATTERNS.some((re) => re.test(c)));
}

/** 회사 칸이 있는 폼에서만 값이 나온다(일반 관람객 폼에는 없다 — 그러면 빈 문자열). */
export function pickCompany(config: CollectFormConfig, data: Record<string, unknown>): string {
  const field = config.fields.find((f) => looksLikeCompany(f));
  const v = field ? data[field.key] : undefined;
  return typeof v === "string" ? v.trim() : "";
}

// ─── 판정 ──────────────────────────────────────────────────────────────

export type ScanStatus = "first" | "repeat" | "not_found" | "other_event" | "invalid";

export interface ScanPerson {
  registrationNo: string;
  name: string;
  visitorType: string;
  company: string;
  extras: Array<{ label: string; value: string }>;
}

export interface ScanResult {
  status: ScanStatus;
  person?: ScanPerson;
  /** 오늘 이 사람의 몇 번째 스캔인지(방금 것 포함) */
  todayCount?: number;
  /** 오늘 첫 스캔 시각(ISO) */
  firstAtToday?: string;
  scannedAt?: string;
}

/**
 * 방금 스캔을 저장한 뒤, 오늘 이 사람의 스캔 시각들로 판정한다.
 * 오늘 처음이면 first(초록), 이미 있었으면 repeat(노랑). 막지는 않는다.
 */
export function judgeScan(person: ScanPerson, todayScansAsc: Date[], scannedAt: Date): ScanResult {
  const count = Math.max(1, todayScansAsc.length);
  return {
    status: count <= 1 ? "first" : "repeat",
    person,
    todayCount: count,
    firstAtToday: (todayScansAsc[0] ?? scannedAt).toISOString(),
    scannedAt: scannedAt.toISOString(),
  };
}

/**
 * 같은 QR 을 카메라 앞에 들고 있으면 1초에 수십 번 읽힌다. 화면은 이 간격 안의 같은 코드를
 * 한 번으로 친다 — 서버까지 가면 "스캔 N번" 이 부풀어 집계가 거짓말을 한다.
 */
export const SAME_CODE_COOLDOWN_MS = 4000;

export function shouldSubmitScan(code: string, last: { code: string; at: number } | null, now: number): boolean {
  if (!code) return false;
  if (!last) return true;
  return !(last.code === code && now - last.at < SAME_CODE_COOLDOWN_MS);
}
