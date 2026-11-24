import { NextResponse } from "next/server";
import { actionSchema } from "@/lib/creator/model";
import { applyCreatorAction, CreatorError, errorResponse, getCreatorProject, loadCreator } from "@/lib/creator/server";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const auth = await getCreatorProject((await params).projectId);
    return NextResponse.json(await loadCreator(auth.project.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const auth = await getCreatorProject((await params).projectId);
    const input = actionSchema.safeParse(await request.json());
    if (!input.success) throw new CreatorError(input.error.issues[0]?.message ?? "입력값을 확인해 주세요.");
    await applyCreatorAction(auth, input.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
