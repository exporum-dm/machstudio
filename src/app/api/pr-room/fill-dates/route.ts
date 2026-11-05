import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardProject } from "@/lib/brief/server";
import { fillMissingPublishedDates } from "@/lib/pr-room/collect";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const g = await guardProject(projectId, { write: true });
  if (!g.ok) return g.response;
  const room = await prisma.prRoom.findUnique({ where: { projectId }, select: { id: true } });
  if (!room) return NextResponse.json({ error: "홍보실을 찾을 수 없어요" }, { status: 404 });
  try {
    return NextResponse.json(await fillMissingPublishedDates(room.id));
  } catch (error) {
    if (error instanceof Error && error.message === "PR_ROOM_CHANGED") {
      return NextResponse.json({ error: "다른 창에서 내용이 바뀌었어요. 최신 내용을 불러온 뒤 다시 시도해 주세요." }, { status: 409 });
    }
    throw error;
  }
}
