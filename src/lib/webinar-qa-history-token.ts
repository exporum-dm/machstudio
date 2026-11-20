import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

function signature(slug: string, registrationId: string, expiresAt: number) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.DATABASE_URL;
  return secret
    ? createHmac("sha256", secret).update(JSON.stringify(["webinar-qa-history", slug, registrationId, expiresAt])).digest()
    : null;
}

const DAY_MS = 24 * 60 * 60_000;

export function createQaHistoryToken(slug: string, registrationId: string, liveEndAt?: Date | null): string | null {
  const expiresAt = Math.max(Date.now() + 7 * DAY_MS, (liveEndAt?.getTime() ?? 0) + DAY_MS);
  const signed = signature(slug, registrationId, expiresAt);
  return signed ? `${expiresAt}.${signed.toString("base64url")}` : null;
}

export function verifyQaHistoryToken(header: string | null, slug: string, registrationId: string): boolean {
  const match = header?.match(/^Bearer (\d{13})\.([\w-]{43})$/);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (expiresAt < Date.now()) return false;
  const expected = signature(slug, registrationId, expiresAt);
  const supplied = Buffer.from(match[2], "base64url");
  return expected !== null && expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
