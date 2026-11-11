import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardProject } from "@/lib/brief/server";
import { collectPrRoom } from "@/lib/pr-room/collect";
import { parseRange } from "@/lib/pr-room/range";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const g = await guardProject(projectId, { write: true });
  if (!g.ok) return g.response;
  const room = await prisma.prRoom.findUnique({ where: { projectId }, select: { id: true } });
  if (!room) return NextResponse.json({ error: "홍보실을 찾을 수 없어요" }, { status: 404 });
  try {
    // 조사 기간(선택) — 없으면 수집기 기본값(최근 30일)
    return NextResponse.json(await collectPrRoom(room.id, new Date(), parseRange(body?.range)));
  } catch (error) {
    if (error instanceof Error && error.message === "PR_ROOM_CHANGED") {
      return NextResponse.json({ error: "조사 중 다른 창에서 내용이 바뀌었어요. 최신 내용을 불러온 뒤 다시 조사해 주세요." }, { status: 409 });
    }
    throw error;
  }
}
