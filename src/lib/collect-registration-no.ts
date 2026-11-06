/**
 * 등록번호 — 현장에서 QR 로 스캔되고, **손으로도 입력되는** 값(설계 §9.1).
 *
 * 국내형은 협력사 규격에 따라 8자리 순차 번호를 별도 발급한다. 공개 티켓은 별도 키로 보호한다.
 * ── 왜 순차 번호가 아닌가 ──────────────────────────────────────────────
 * 순차는 두 가지를 동시에 깨뜨린다. 1번을 받은 사람은 등록 규모를 알게 되고(경쟁 전시가
 * 우리 티켓 하나만 사면 참관객 수를 안다), 자기 번호 ±1 로 **남의 번호를 추측**할 수 있다.
 * 등록번호는 §10 등록 확인과 §12 현장 입장의 열쇠라 추측 가능하면 안 된다.
 *
 * ── 왜 체크digit 인가 ─────────────────────────────────────────────────
 * 현장에서 QR 이 안 읽히는 일은 **반드시 생긴다**(구김·지문·화면 밝기·프린터 번짐).
 * 그러면 스태프가 번호를 손으로 친다. 체크digit 없이는 오타 한 글자가 "없는 번호"가 아니라
 * **다른 사람의 번호**가 될 수 있고, 그 사람의 이름이 화면에 뜬다. Luhn 은 한 자리 오타와
 * 인접 자리 뒤바뀜(가장 흔한 두 가지)을 잡는다.
 *
 * 13자리 = 체크digit 1 + 무작위 12. 12자리 십진수는 약 1조 가지라 전시 하나(수만 건)에서
 * 생일 문제로 충돌할 확률이 무시할 만하고, 충돌해도 UNIQUE 제약이 최종 방어선이다.
 */
import { randomInt } from "node:crypto";

/** 등록번호 전체 길이(체크digit 포함). */
export const REGISTRATION_NO_LENGTH = 13;

/**
 * Luhn 체크digit. 카드번호와 같은 알고리즘 — 검증기가 어디에나 있고, 스태프가 쓰는
 * 스캐너·엑셀·다른 도구에서도 같은 판정이 나온다(직접 만든 규칙은 우리 코드에서만 통한다).
 *
 * payload 는 체크digit 을 **뺀** 숫자열이다. 반환값을 뒤에 붙이면 완성된 번호가 된다.
 */
export function luhnCheckDigit(payload: string): number {
  let sum = 0;
  // 체크digit 이 붙을 자리를 기준으로 오른쪽부터 홀/짝을 센다 —
  // payload 의 맨 오른쪽 자리가 "두 배로 만드는" 자리다.
  let double = true;
  for (let i = payload.length - 1; i >= 0; i--) {
    let d = payload.charCodeAt(i) - 48; // '0' = 48
    if (d < 0 || d > 9) throw new Error("등록번호 payload 는 숫자만 허용합니다");
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    double = !double;
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * 형식이 맞고 체크digit 이 유효한가. **DB 를 보지 않는다** — 오타를 조회 전에 걸러서
 * "없는 번호입니다" 와 "잘못 입력하셨어요" 를 구분해 주려는 것이다(현장 응대가 달라진다).
 */
export function isValidRegistrationNo(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (isDomesticRegistrationNo(s)) return true;
  if (s.length !== REGISTRATION_NO_LENGTH) return false;
  if (!/^\d+$/.test(s)) return false;
  return luhnCheckDigit(s.slice(0, -1)) === s.charCodeAt(s.length - 1) - 48;
}

/**
 * 새 등록번호 하나. **`crypto.randomInt` 를 쓴다** — `Math.random()` 은 예측 가능한 PRNG 라
 * 한 번호를 아는 사람이 다음 번호를 좁힐 수 있다(위 "추측 불가" 요건이 그대로 무너진다).
 */
export function generateRegistrationNo(): string {
  let payload = "";
  for (let i = 0; i < REGISTRATION_NO_LENGTH - 1; i++) payload += String(randomInt(10));
  return payload + String(luhnCheckDigit(payload));
}

/**
 * QR 이나 스캐너 입력에서 등록번호만 뽑아낸다.
 *
 * QR 에 번호만 굽더라도(§9.2 기본) 현장에는 **URL 이 담긴 QR 이 섞여 들어온다** — 과거 전시
 * 티켓, 다른 벤더 배지, 우리가 나중에 URL 형태로 바꿀 가능성. HID 스캐너는 읽은 문자열을
 * 그대로 키보드 입력으로 흘리므로 `https://…/t/1234567890123` 이 통째로 입력칸에 박힌다.
 * 그래서 **양쪽 다 받는다**(설계 §9.2 "우리 앱은 둘 다 인식하게 만든다").
 */
export function isDomesticRegistrationNo(value: string): boolean {
  return /^[0-9]{8}$/.test(value) && value.slice(2) !== "000000";
}

export function domesticRegistrationNo(prefix: string, sequence: number): string {
  if (!/^[0-9]{2}$/.test(prefix) || !Number.isInteger(sequence) || sequence < 1 || sequence > 999999) throw new Error("등록번호 발급 범위를 초과했어요");
  return prefix + String(sequence).padStart(6, "0");
}

export function extractRegistrationNo(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  // 그대로가 번호인 경우가 절대다수다 — 먼저 본다.
  if (isValidRegistrationNo(raw)) return raw;

  // URL·구분자가 섞인 경우: 13자리 숫자 덩어리를 훑어 **체크digit 이 맞는 것**만 받는다.
  // 길이만 보고 고르면 타임스탬프(13자리 밀리초!)를 등록번호로 착각한다 — 실제로 섞여 들어오는 값이다.
  for (const m of raw.matchAll(/\d{13}/g)) {
    if (isValidRegistrationNo(m[0])) return m[0];
  }
  for (const m of raw.matchAll(/(?:^|[^0-9])([0-9]{8})(?![0-9])/g)) {
    if (isDomesticRegistrationNo(m[1])) return m[1];
  }
  return null;
}
