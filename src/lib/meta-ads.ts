import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { classifyMetaError } from "@/lib/ad-connection-health";

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v25.0";

export const META_METRICS = [
  { key: "spend", label: "지출", defaultOn: true },
  { key: "impressions", label: "노출", defaultOn: true },
  { key: "reach", label: "도달", defaultOn: true },
  { key: "frequency", label: "빈도", defaultOn: true },
  { key: "cpm", label: "CPM", defaultOn: true },
  { key: "outbound_clicks", label: "아웃바운드 클릭", defaultOn: true },
  { key: "inline_link_clicks", label: "링크 클릭", defaultOn: true },
  { key: "cpc", label: "CPC", defaultOn: true },
  { key: "ctr", label: "CTR", defaultOn: true },
  { key: "actions", label: "전환·행동", defaultOn: true },
  { key: "cost_per_action_type", label: "CPA", defaultOn: true },
  { key: "conversion_rate", label: "CVR", defaultOn: true },
  { key: "action_values", label: "전환 가치", defaultOn: true },
  { key: "purchase_roas", label: "구매 ROAS", defaultOn: true },
  { key: "website_purchase_roas", label: "웹 구매 ROAS", defaultOn: true },
  { key: "video_play_actions", label: "영상 재생", defaultOn: false },
  { key: "video_p25_watched_actions", label: "영상 25%", defaultOn: false },
  { key: "video_p50_watched_actions", label: "영상 50%", defaultOn: false },
  { key: "video_p75_watched_actions", label: "영상 75%", defaultOn: false },
  { key: "video_p100_watched_actions", label: "영상 100%", defaultOn: false },
] as const;

export const DEFAULT_META_METRICS = META_METRICS.filter((metric) => metric.defaultOn).map((metric) => metric.key);

function secretKey() {
  const raw = process.env.META_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("META_TOKEN_ENCRYPTION_KEY가 설정되지 않았습니다.");
  return createHash("sha256").update(raw).digest();
}

export function encryptMetaToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptMetaToken(value: string) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted) throw new Error("Meta 토큰 형식이 올바르지 않습니다.");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function signMetaState(payload: object) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = process.env.META_APP_SECRET?.trim();
  if (!secret) throw new Error("META_APP_SECRET이 설정되지 않았습니다.");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

export function verifyMetaState<T>(state: string): T | null {
  const [encoded, signature] = state.split(".");
  const secret = process.env.META_APP_SECRET?.trim();
  if (!encoded || !signature || !secret) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T; } catch { return null; }
}

/**
 * Meta 가 적어 준 오류 코드를 **들고 다니는** 예외.
 *
 * 전에는 메시지 문자열만 남겨서, 호출부가 "토큰이 죽은 것" 과 "속도 제한에 걸린 것" 을
 * 구별할 수 없었다. 그래서 잠깐 실패한 연결을 끊긴 것으로 적고, 운영자는 멀쩡한 연결을
 * 다시 맺었다(ad-connection-health.ts 머리말).
 */
export class MetaApiError extends Error {
  readonly code: number | null;
  readonly subcode: number | null;
  readonly status: number | null;

  constructor(message: string, meta: { code?: number | null; subcode?: number | null; status?: number | null } = {}) {
    super(message);
    this.name = "MetaApiError";
    this.code = meta.code ?? null;
    this.subcode = meta.subcode ?? null;
    this.status = meta.status ?? null;
  }
}

/** 일시적 실패를 몇 번까지 다시 눌러 볼지. 속도 제한·Meta 쪽 일시 장애가 대부분 여기서 걷힌다. */
const META_RETRIES = 2;
const META_RETRY_DELAY_MS = 700;

type MetaErrorBody = { error?: { message?: string; code?: number; error_subcode?: number } };

/** 응답 → 예외. 코드가 없으면 HTTP 상태만이라도 실어 보낸다. */
export function metaErrorFrom(body: unknown, status: number) {
  const error = (body as MetaErrorBody | null)?.error;
  return new MetaApiError(error?.message || `Meta API 요청 실패 (${status})`, {
    code: error?.code ?? null,
    subcode: error?.error_subcode ?? null,
    status,
  });
}

/**
 * 이미 만들어진 Graph URL 을 **재시도와 함께** 읽는다 — 페이지 넘기기(`paging.next`)처럼
 * 우리가 URL 을 조립하지 않는 경우에 쓴다.
 *
 * 동기화는 광고 계정마다 수십 페이지를 넘기므로 속도 제한에 걸릴 확률이 가장 높은 자리다.
 * 한 페이지에서 멈추면 그 폴더의 밤 동기화가 통째로 날아가고, 운영자는 다음 날 아침에
 * "또 안 됐다" 를 본다. 같은 URL 을 다시 읽는 건 안전하다(커서가 URL 안에 들어 있다).
 */
export async function metaFetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: (T & MetaErrorBody) | null }> {
  let thrown: unknown;
  for (let attempt = 0; attempt <= META_RETRIES; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, META_RETRY_DELAY_MS * attempt));
    let response: Response;
    try {
      response = await fetch(url, { cache: "no-store" });
    } catch (error) {
      thrown = error; // 네트워크 실패 — 다시 시도한다.
      continue;
    }
    const data = (await response.json().catch(() => null)) as (T & MetaErrorBody) | null;
    if (response.ok && data && !data.error) return { ok: true, status: response.status, data };
    // 인증·권한 오류는 기다려도 낫지 않는다 — 마지막 시도까지 갈 이유가 없다.
    if (classifyMetaError(metaErrorFrom(data, response.status)) !== "TRANSIENT") {
      return { ok: false, status: response.status, data };
    }
    if (attempt === META_RETRIES) return { ok: false, status: response.status, data };
  }
  throw thrown instanceof Error ? thrown : new MetaApiError("Meta API 요청 실패");
}

/**
 * Graph API 호출. **일시적 실패는 조용히 다시 시도한다.**
 *
 * 재시도를 여기 둔 이유: 속도 제한(코드 4·17·80000번대)과 Meta 쪽 일시 오류(1·2)는
 * 몇백 밀리초 뒤면 대개 통과한다. 호출부마다 재시도를 짜면 금방 갈라진다.
 * 인증 오류는 **다시 시도하지 않는다** — 토큰이 죽은 건 기다려도 낫지 않는다.
 */
export async function metaGraph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let lastError: unknown;
  for (let attempt = 0; attempt <= META_RETRIES; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, META_RETRY_DELAY_MS * attempt));
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json().catch(() => null) as (T & MetaErrorBody) | null;
      if (response.ok && data && !data.error) return data;
      const error = metaErrorFrom(data, response.status);
      if (classifyMetaError(error) !== "TRANSIENT") throw error;
      lastError = error;
    } catch (error) {
      // fetch 자체가 터진 경우(네트워크)도 일시적으로 본다 — 아니면 그대로 올린다.
      if (error instanceof MetaApiError && classifyMetaError(error) !== "TRANSIENT") throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new MetaApiError("Meta API 요청 실패");
}

export function metricValue(value: unknown, actionType?: string) {
  if (typeof value === "string" || typeof value === "number") return Number(value) || 0;
  if (!Array.isArray(value)) return 0;
  const rows = value as Array<{ action_type?: string; value?: string }>;
  const picked = actionType ? rows.find((row) => row.action_type === actionType) : rows[0];
  return Number(picked?.value) || 0;
}
