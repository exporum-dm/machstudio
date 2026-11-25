import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { creatorEmailMatch, creatorEntryCookie, creatorEntryPath } from "@/lib/creator/entry";
import { creatorAccessEmail } from "@/lib/creator/model";
import { CreatorError, errorResponse, isPreviewUrl } from "@/lib/creator/server";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enter"), email: creatorAccessEmail }),
  z.object({ action: z.literal("exit") }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const fromForm = request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded");
  const entryPath = creatorEntryPath(programId);
  try {
    if (!/^[\w-]{1,100}$/.test(programId) || isPreviewUrl(new URL(request.url))) throw new CreatorError("활동 링크를 확인해 주세요.", 404);
    const parsed = input.safeParse(fromForm ? Object.fromEntries(await request.formData()) : await request.json());
    if (!parsed.success) throw new CreatorError("등록한 이메일 주소를 입력해 주세요.");
    const response = fromForm
      ? new NextResponse(null, { status: 303, headers: { Location: entryPath } })
      : NextResponse.json({ ok: true });
    response.headers.set("Cache-Control", "private, no-store");
    const cookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: creatorEntryPath(programId) };
    if (parsed.data.action === "exit") {
      response.cookies.set(creatorEntryCookie, "", { ...cookie, maxAge: 0 });
      return response;
    }
    const limit = await rateLimitAsync("creator-entry:" + getClientIp(request), { limit: 20, windowMs: 300000 });
    if (!limit.allowed) throw new CreatorError("입력 횟수를 초과했어요. 잠시 후 다시 시도해 주세요.", 429);
    const people = await prisma.creatorParticipant.findMany({
      where: {
        ...creatorEmailMatch(programId, parsed.data.email),
        program: { deletedAt: null, project: { deletedAt: null, workspace: { deletedAt: null } } },
      },
      take: 2, select: { token: true },
    });
    if (people.length !== 1) throw new CreatorError("이 이메일로 활동 페이지를 열 수 없어요. 운영자에게 등록 주소를 확인해 주세요.", 404);
    const token = people[0].token;
    const entered = await prisma.creatorParticipant.updateMany({
      where: { ...creatorEmailMatch(programId, parsed.data.email), token, program: { deletedAt: null } },
      data: { confirmed: true },
    });
    if (!entered.count) throw new CreatorError("활동 정보를 새로고침한 뒤 다시 시도해 주세요.", 409);
    response.cookies.set(creatorEntryCookie, token, { ...cookie, maxAge: 8 * 3600 });
    return response;
  } catch (error) {
    if (fromForm && /^[\w-]{1,100}$/.test(programId) && !isPreviewUrl(new URL(request.url))) {
      const marker = error instanceof CreatorError && error.status === 429 ? "limit" : "1";
      return new NextResponse(null, { status: 303, headers: { Location: entryPath + "?entryError=" + marker, "Cache-Control": "private, no-store" } });
    }
    return errorResponse(error);
  }
}
