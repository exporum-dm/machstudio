import { NextResponse } from "next/server";
import { downloadProof } from "@/lib/creator/portal";
import { errorResponse, getCreatorProject } from "@/lib/creator/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; projectId: string }> }) {
  try {
    const { id, projectId } = await params;
    await getCreatorProject(projectId);
    const destination = await downloadProof({ id, assignment: { participant: { program: { projectId } }, mission: { program: { projectId } } } });
    return NextResponse.redirect(destination, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
