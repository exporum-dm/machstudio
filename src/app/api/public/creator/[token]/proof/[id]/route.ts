import { NextResponse } from "next/server";
import { downloadProof } from "@/lib/creator/portal";
import { errorResponse } from "@/lib/creator/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  try {
    const { id, token } = await params;
    const destination = await downloadProof({ id, assignment: { participant: { token, program: { project: { deletedAt: null, workspace: { deletedAt: null } } } } } });
    return NextResponse.redirect(destination, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
