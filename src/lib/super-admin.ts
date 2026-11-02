// 슈퍼관리자 — 순수 환경변수 기반 체크 (클라이언트/서버 공통).
// DB 통합 체크는 super-admin-server.ts에서 import (서버 전용).

// 최고 관리자(2026-11-02 교체). Vercel 의 SUPER_ADMIN_EMAILS 가 있으면 그게 우선이다.
const FALLBACK_EMAIL = "hook2@exporum.com";

const ENV_VALUE = process.env.SUPER_ADMIN_EMAILS?.trim();
const ADMIN_EMAILS = (ENV_VALUE && ENV_VALUE.length > 0 ? ENV_VALUE : FALLBACK_EMAIL)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// 표시용 — 첫 번째 이메일.
export const SUPER_ADMIN_EMAIL = ADMIN_EMAILS[0] ?? FALLBACK_EMAIL;

// env 기반 root 슈퍼관리자 체크 (sync, 회수 불가).
export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

// 기존 alias 유지.
export const isSuperAdmin = isSuperAdminEmail;

// 이 이메일이 env-rooted 어드민인지 (DB 부여 어드민과 구분).
export function isRootSuperAdmin(email?: string | null): boolean {
  return isSuperAdminEmail(email);
}
