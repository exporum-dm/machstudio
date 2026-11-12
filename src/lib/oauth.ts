import { createHash, randomBytes } from "node:crypto";
import { getPublicAppOrigin } from "@/lib/app-url";

export const OAUTH_SCOPES = ["dashboards:read", "ads:read", "content:read", "content:write"] as const;

export function oauthOrigin(request?: Request) {
  return getPublicAppOrigin() || (request ? new URL(request.url).origin : "");
}

export function opaqueToken(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeScopes(value: string | null | undefined) {
  const requested = new Set((value ?? "").split(/\s+/).filter(Boolean));
  return OAUTH_SCOPES.filter((scope) => requested.size === 0 || requested.has(scope));
}

export function validRedirectUri(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch { return false; }
}

export function oauthError(error: string, description: string, status = 400) {
  return Response.json({ error, error_description: description }, { status, headers: { "Cache-Control": "no-store" } });
}
