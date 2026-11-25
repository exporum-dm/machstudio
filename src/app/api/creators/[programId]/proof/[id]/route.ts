import { NextResponse } from "next/server";
import { downloadProof } from "@/lib/creator/portal";
import { errorResponse, getCreatorProgram } from "@/lib/creator/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; programId: string }> }) {
  try {
    const { id, programId } = await params;
    // 증빙은 이 회차의 것만 — 같은 전시의 다른 회차 파일도 건너갈 수 없게 programId 로 묶는다.
    await getCreatorProgram(programId);
    const destination = await downloadProof({
      id,
      assignment: { participant: { programId }, mission: { programId } },
    });
    return NextResponse.redirect(destination, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
