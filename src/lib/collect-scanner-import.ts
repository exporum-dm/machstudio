/**
 * 오프라인 바코드 스캐너 파일 가져오기 — 순수 로직(2026-10-28).
 *
 * 왜: LA 2026 현장은 인터넷이 안 되는 스캐너로 등록 QR 을 찍었다(온라인 체크인은 꺼 둠).
 * 행사가 끝난 뒤 스캐너가 저장한 줄 목록을 받아 CollectCheckIn 으로 **추가만** 한다 —
 * 등록 레코드는 건드리지 않는다.
 *
 * 스캐너 한 줄: "2026.10.22 09:32:49 00000 2728849208628 P044"
 *   = 현지 날짜 · 현지 시각 · (기계 필드) · 찍힌 값 · 기계 번호
 * 날짜 구분자(. - /)·초 생략·필드 사이 공백 수는 너그럽게 받는다. 시각은 **행사 현지 시각**이라
 * 소스의 체크인 시간대(checkinTimezone)로 UTC 로 바꾼다.
 */
import { extractRegistrationNo } from "@/lib/collect-registration-no";

export interface ScannerLine {
  /** 현지 날짜 "2026-10-22" — CollectCheckIn.eventDate 가 된다 */
  eventDate: string;
  /** 현지 시각 "2026-10-22T09:32:49" */
  local: string;
  /** 찍힌 값 그대로(매칭 실패 보고용) */
  raw: string;
  /** 체크digit 이 맞는 13자리 등록번호, 없으면 null */
  registrationNo: string | null;
  /** "P044" 같은 기계 번호 — 없으면 "" */
  device: string;
}

const LINE = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)$/;
const DEVICE = /^[A-Z]{1,3}\d{1,5}$/i;

/** 한 줄을 읽는다. 날짜·시각으로 시작하지 않으면 null(머리글·빈 줄 등). */
export function parseScannerLine(line: string): ScannerLine | null {
  const m = LINE.exec(line.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, rest] = m;
  const pad = (v: string) => v.padStart(2, "0");
  const eventDate = `${y}-${pad(mo)}-${pad(d)}`;
  const local = `${eventDate}T${pad(h)}:${mi}:${s ?? "00"}`;
  const tokens = rest.trim().split(/\s+/);
  const device = tokens.length > 1 && DEVICE.test(tokens[tokens.length - 1]) ? tokens.pop()! : "";
  // 기계 필드("00000")는 등록번호가 될 수 없다 — 토큰마다 보고, 없으면 나머지 전체에서 찾는다.
  let registrationNo: string | null = null;
  for (const t of tokens) {
    registrationNo = extractRegistrationNo(t);
    if (registrationNo) break;
  }
  const raw = registrationNo ?? tokens.filter((t) => !/^0+$/.test(t)).join(" ");
  return { eventDate, local, raw, registrationNo: registrationNo ?? extractRegistrationNo(raw), device };
}

/** 시트 행(셀 배열)이든 텍스트 줄이든 한 줄 문자열로 — 셀로 쪼개 저장된 파일도 받는다. */
export function scannerRowText(row: unknown): string {
  if (Array.isArray(row)) return row.map((c) => (c == null ? "" : String(c))).join(" ").trim();
  return typeof row === "string" ? row.trim() : "";
}

/** 그 시간대의 벽시계 시각 "YYYY-MM-DDTHH:mm:ss" → UTC Date. 서머타임 경계도 맞춘다. */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(local);
  if (!m) return new Date(NaN);
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  // 한 번 빼고, 그 시각의 오프셋으로 다시 맞춘다(경계 근처 보정).
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  return new Date(t);
}
