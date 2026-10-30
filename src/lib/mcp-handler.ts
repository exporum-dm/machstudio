import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { authenticateApiRequest, bearerToken, type ApiPrincipal } from "@/lib/api-auth";
import { createMachstudioMcpServer } from "@/lib/machstudio-mcp";
import { requireApiProject } from "@/lib/external-api-data";

const handler = createMcpHandler(({ authInfo }) => {
  const principal = authInfo?.extra?.principal;
  if (!principal || typeof principal !== "object") throw new Error("Missing authenticated principal");
  const lockProjectId = typeof authInfo?.extra?.projectId === "string" ? authInfo.extra.projectId : undefined;
  return createMachstudioMcpServer(principal as ApiPrincipal, lockProjectId);
}, { responseMode: "auto" });

/** lockProjectId 가 있으면 이 요청의 MCP 서버는 그 프로젝트 하나로만 범위가 묶인다(URL `/mcp/[projectId]`). */
export async function handleMcpRequest(request: Request, lockProjectId?: string) {
  const auth = await authenticateApiRequest(request);
  if ("response" in auth) return auth.response;
  if (lockProjectId && !await requireApiProject(auth.principal.workspaceId, lockProjectId)) {
    return new Response("Not Found", { status: 404 });
  }
  const authInfo: AuthInfo = {
    token: bearerToken(request),
    clientId: auth.principal.tokenId,
    scopes: auth.principal.scopes,
    extra: { principal: auth.principal, projectId: lockProjectId },
  };
  return handler.fetch(request, { authInfo });
}
