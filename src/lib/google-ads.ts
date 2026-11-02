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
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("GOOGLE_ADS_CLIENT_ID 또는 GOOGLE_ADS_CLIENT_SECRET 환경변수가 설정되지 않았습니다.");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }), cache: "no-store" });
  const raw = await response.text();
  let data: { access_token?: string; error?: string; error_description?: string } | null = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* 본문이 JSON 이 아님 — raw 를 그대로 메시지에 붙인다 */ }
  if (!response.ok || !data?.access_token) {
    const summary = data?.error_description || data?.error || `Google 액세스 토큰을 갱신하지 못했습니다 (${response.status})`;
    throw new Error(raw ? `${summary} (${raw.slice(0, 500)})` : summary);
  }
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
    // details 가 있어도 그 안의 메시지가 요약과 똑같을 수 있다(errorCode 없이 "Bad Request" 만 반복되는
    // 경우가 실제로 있었다) — 그래서 원문은 detail 유무와 상관없이 항상 붙인다.
    const extra = [data?.error?.status, raw ? raw.slice(0, 500) : null].filter(Boolean).join(" · ");
    throw new Error(extra ? `${summary} (${extra})` : summary);
  }
  return data;
}
