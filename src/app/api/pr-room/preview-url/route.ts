import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardProject } from "@/lib/brief/server";
import { previewMentionUrl } from "@/lib/pr-room/collect";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const g = await guardProject(projectId, { write: true });
  if (!g.ok) return g.response;
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: "올바른 URL이 아니에요" }, { status: 400 });
  const room = await prisma.prRoom.findUnique({ where: { projectId }, select: { id: true } });
  if (!room) return NextResponse.json({ error: "홍보실을 찾을 수 없어요" }, { status: 404 });
  const preview = await previewMentionUrl(url).catch(() => null);
  return NextResponse.json({ preview });
}
