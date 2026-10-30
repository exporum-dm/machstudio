import { handleMcpRequest } from "@/lib/mcp-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return handleMcpRequest(request, projectId);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
