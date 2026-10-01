/**
 * 현장 체크인 운영요원 세션 — 링크(토큰) + 4자리 PIN 을 통과한 뒤 유지되는 서명 쿠키.
 *
 * 심사위원 세션(competition-judge-session)과 같은 방식이다. 스캔은 수백 번 오가므로 매번 PIN 을
 * 물을 수 없고, 반대로 영구 쿠키면 잃어버린 휴대폰으로 계속 입장 처리가 된다.
 *  · 수명 14시간 — 하루 운영을 덮고 다음 날 다시 PIN 을 묻는다
 *  · 서명 비밀은 PIN 해시 — 운영자가 PIN 을 바꾸면 기존 세션이 전부 끊긴다(분실 대응)
 *  · 토큰별 쿠키 — 링크를 새로 만들면 예전 링크 쿠키는 쓸모가 없다
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import "server-only";

const MAX_AGE_SECONDS = 14 * 60 * 60;

export function checkinCookieName(token: string): string {
  // 운영자가 정한 짧은 주소는 앞부분이 겹칠 수 있다(la2026-a / la2026-b) — 해시로 이름을 나눈다.
  return `mc_checkin_${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
}

function sign(token: string, secret: string, expiresAt: number): string {
  return createHmac("sha256", secret).update(`checkin.${token}.${expiresAt}`).digest("base64url");
}

export function createCheckinSession(token: string, pinHash: string): { value: string; maxAge: number } {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000;
  return { value: `${expiresAt}.${sign(token, pinHash, expiresAt)}`, maxAge: MAX_AGE_SECONDS };
}

export function verifyCheckinSession(cookieValue: string | undefined, token: string, pinHash: string | null): boolean {
  // PIN 이 없으면 아무도 못 들어온다 — "PIN 미설정 = 누구나" 가 되면 비밀 링크 하나에 다 걸린다.
  if (!cookieValue || !pinHash) return false;
  const [expiresRaw, signature] = cookieValue.split(".");
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || !signature || Date.now() > expiresAt) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(token, pinHash, expiresAt));
  return a.length === b.length && timingSafeEqual(a, b);
}
