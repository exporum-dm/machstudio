import { NextResponse } from "next/server";
import { actionSchema } from "@/lib/creator/model";
import {
  applyCreatorAction, CreatorError, deleteCreatorProgram, errorResponse, getCreatorProgram, loadCreator,
} from "@/lib/creator/server";

type Context = { params: Promise<{ programId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const auth = await getCreatorProgram((await params).programId);
    return NextResponse.json(await loadCreator(auth.project.id, auth.programId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const auth = await getCreatorProgram((await params).programId);
    const input = actionSchema.safeParse(await request.json());
    if (!input.success) throw new CreatorError(input.error.issues[0]?.message ?? "입력값을 확인해 주세요.");
    await applyCreatorAction(auth, input.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

// 회차 삭제 — 명단 내보내기와 같은 등급으로 관리자 이상만. 행은 남기고 목록에서만 감춘다.
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const auth = await getCreatorProgram((await params).programId);
    if (auth.role === "MEMBER") throw new CreatorError("회차를 지울 권한이 없어요. 관리자에게 문의하세요.", 403);
    await deleteCreatorProgram(auth);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
