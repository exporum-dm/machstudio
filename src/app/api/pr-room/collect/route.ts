import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardProject } from "@/lib/brief/server";
import { collectPrRoom } from "@/lib/pr-room/collect";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const g = await guardProject(projectId, { write: true });
  if (!g.ok) return g.response;
  const room = await prisma.prRoom.findUnique({ where: { projectId }, select: { id: true } });
  if (!room) return NextResponse.json({ error: "홍보실을 찾을 수 없어요" }, { status: 404 });
  return NextResponse.json(await collectPrRoom(room.id));
}
