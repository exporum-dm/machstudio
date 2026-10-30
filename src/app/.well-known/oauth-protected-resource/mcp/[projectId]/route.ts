import { oauthOrigin } from "@/lib/oauth";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const origin = oauthOrigin(request);
  return Response.json({ resource: `${origin}/mcp/${projectId}`, authorization_servers: [origin], scopes_supported: ["dashboards:read", "ads:read"], bearer_methods_supported: ["header"] });
}
