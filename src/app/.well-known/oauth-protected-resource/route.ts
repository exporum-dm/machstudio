import { OAUTH_SCOPES, oauthOrigin } from "@/lib/oauth";

export async function GET(request: Request) {
  const origin = oauthOrigin(request);
  return Response.json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: [...OAUTH_SCOPES], bearer_methods_supported: ["header"] });
}
