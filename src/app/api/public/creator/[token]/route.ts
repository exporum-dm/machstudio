import { NextResponse } from "next/server";
import { z } from "zod";
import { submissionSchema } from "@/lib/creator/model";
import { confirmParticipation, signCreatorUpload, submitCreatorWork } from "@/lib/creator/portal";
import { CreatorError, errorResponse, isPreviewUrl, missing } from "@/lib/creator/server";

type Context = { params: Promise<{ token: string }> };
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("submit"), assignmentId: z.string().max(100), submission: submissionSchema }),
  z.object({ action: z.literal("upload"), assignmentId: z.string().max(100), name: z.string().trim().min(1).max(255).regex(/^[^\u0000-\u001f/\\]+$/), type: z.string().max(120), size: z.number().int() }),
]);

export async function POST(request: Request, { params }: Context) {
  try {
    const { token } = await params;
    if (!/^cp_[A-Za-z0-9_-]{32}$/.test(token) || isPreviewUrl(new URL(request.url))) throw missing();
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) throw new CreatorError("제출 내용을 확인해 주세요.");
    const action = parsed.data;
    if (action.action === "upload") {
      return NextResponse.json(await signCreatorUpload(token, action.assignmentId, action), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (action.action === "confirm") await confirmParticipation(token);
    else await submitCreatorWork(token, action.assignmentId, action.submission);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
