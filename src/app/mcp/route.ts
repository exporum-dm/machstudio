import { handleMcpRequest } from "@/lib/mcp-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = (request: Request) => handleMcpRequest(request);

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
