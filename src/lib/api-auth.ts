import { NextResponse } from "next/server";
import { verifyPat } from "@/lib/pat";
import { rateLimit } from "@/lib/ratelimit";
import { oauthOrigin } from "@/lib/oauth";

export type ApiPrincipal = NonNullable<Awaited<ReturnType<typeof verifyPat>>>;

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export async function authenticateApiRequest(
  request: Request,
  requiredScope?: string,
): Promise<{ principal: ApiPrincipal } | { response: NextResponse }> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
  const limited = rateLimit(`public-api:${ip}`, { limit: 120, windowMs: 60_000 });
  if (!limited.allowed) {
    return {
      response: NextResponse.json(
        { error: { code: "rate_limit_exceeded", message: "요청이 너무 많습니다." } },
        { status: 429, headers: { "Retry-After": Math.ceil(limited.retryAfterMs / 1000).toString() } },
      ),
    };
  }

  const principal = await verifyPat(bearerToken(request));
  if (!principal) {
    const resourcePath = new URL(request.url).pathname || "/mcp";
    return {
      response: NextResponse.json(
        { error: { code: "unauthorized", message: "유효한 Bearer API 토큰이 필요합니다." } },
        { status: 401, headers: { "WWW-Authenticate": `Bearer realm="Machstudio API", resource_metadata="${oauthOrigin(request)}/.well-known/oauth-protected-resource${resourcePath}"` } },
      ),
    };
  }
  if (requiredScope && !principal.scopes.includes(requiredScope)) {
    return {
      response: NextResponse.json(
        { error: { code: "insufficient_scope", message: `${requiredScope} 권한이 필요합니다.` } },
        { status: 403 },
      ),
    };
  }
  return { principal };
}

export function apiJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...init?.headers,
    },
  });
}
