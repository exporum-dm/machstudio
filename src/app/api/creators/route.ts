import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createCreatorProgram, CreatorError, errorResponse, getCreatorProject, listCreatorPrograms,
} from "@/lib/creator/server";

const createSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, "회차 이름을 입력해 주세요.").max(160),
  copyFrom: z.string().min(1).nullable().optional(),
});

// 한 전시의 회차 목록. projectId 는 화면이 보내지만 소속·권한은 서버가 다시 본다.
export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) throw new CreatorError("프로젝트를 찾을 수 없어요.", 400);
    const auth = await getCreatorProject(projectId);
    return NextResponse.json(
      { programs: await listCreatorPrograms(auth.project.id), projectName: auth.project.name },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createSchema.safeParse(await request.json());
    if (!input.success) throw new CreatorError(input.error.issues[0]?.message ?? "입력값을 확인해 주세요.");
    const auth = await getCreatorProject(input.data.projectId);
    const program = await createCreatorProgram(auth, { name: input.data.name, copyFrom: input.data.copyFrom ?? null });
    return NextResponse.json(program, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
