import { createHmac, timingSafeEqual } from "node:crypto";
import { decryptMetaToken, encryptMetaToken } from "@/lib/meta-ads";

export const GOOGLE_ADS_API_VERSION = "v25";
export const googleCustomerId = (value: string) => value.replace(/\D/g, "");
export const encryptGoogleToken = encryptMetaToken;
export const decryptGoogleToken = decryptMetaToken;

function stateSecret() {
  const value = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!value) throw new Error("GOOGLE_ADS_CLIENT_SECRET이 설정되지 않았습니다.");
  return value;
}
export function signGoogleState(payload: object) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", stateSecret()).update(encoded).digest("base64url")}`;
}
export function verifyGoogleState<T>(state: string): T | null {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", stateSecret()).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T; } catch { return null; }
}
export async function googleAccessToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_ADS_CLIENT_ID || "", client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || "", refresh_token: refreshToken, grant_type: "refresh_token" }), cache: "no-store" });
  const data = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Google 액세스 토큰을 갱신하지 못했습니다.");
  return data.access_token;
}
export async function googleAdsRequest<T>(path: string, accessToken: string, init?: RequestInit) {
  const loginCustomerId = googleCustomerId(process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID || "");
  if (!loginCustomerId) throw new Error("GOOGLE_ADS_MANAGER_CUSTOMER_ID 환경변수가 설정되지 않았습니다.");
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "", "login-customer-id": loginCustomerId, "Content-Type": "application/json", ...(init?.headers || {}) }, cache: "no-store" });
  const raw = await response.text();
  let data: (T & { error?: { message?: string; status?: string; details?: Array<{ errors?: Array<{ message?: string; errorCode?: Record<string, string> }> }> } }) | null = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* 본문이 JSON 이 아님 — raw 를 그대로 메시지에 붙인다 */ }
  if (!response.ok || !data) {
    const detail = data?.error?.details?.flatMap((item) => item.errors ?? []).find((item) => item.message);
    const code = detail?.errorCode ? Object.values(detail.errorCode)[0] : undefined;
    const summary = [code, detail?.message || data?.error?.message || `Google Ads API 요청 실패 (${response.status})`].filter(Boolean).join(": ");
    // detail(구조화된 GoogleAdsFailure)이 없으면 원문을 그대로 붙인다 — status 필드도 details 도 없는
    // 맨 "Bad Request" 만 올 때가 있어, 그럴 땐 원문이 유일한 단서다.
    const extra = [data?.error?.status, !detail && raw ? raw.slice(0, 500) : null].filter(Boolean).join(" · ");
    throw new Error(extra ? `${summary} (${extra})` : summary);
  }
  return data;
}
