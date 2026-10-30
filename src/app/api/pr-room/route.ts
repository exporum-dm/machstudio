import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardProject } from "@/lib/brief/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const g = await guardProject(projectId, { write: false });
  if (!g.ok) return g.response;
  const room = await prisma.prRoom.upsert({ where: { projectId }, create: { projectId, workspaceId: g.workspaceId }, update: {}, include: { project: { select: { name: true } } } });
  return NextResponse.json({ room, canWrite: g.canWrite });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const g = await guardProject(projectId, { write: true });
  if (!g.ok) return g.response;
  const current = await prisma.prRoom.findUnique({ where: { projectId } });
  if (!current) return NextResponse.json({ error: "홍보실을 찾을 수 없어요" }, { status: 404 });
  const data: Record<string, unknown> = {};
  if (typeof body?.lastCollectedAt === "string" && !Number.isNaN(new Date(body.lastCollectedAt).getTime())) data.lastCollectedAt = new Date(body.lastCollectedAt);
  if (Array.isArray(body?.keywords)) data.keywords = body.keywords.filter((x) => typeof x === "string").slice(0, 20);
  if (Array.isArray(body?.referenceUrls)) data.referenceUrls = body.referenceUrls.filter((x) => typeof x === "string").slice(0, 20);
  if (Array.isArray(body?.mentions)) data.mentions = body.mentions.slice(0, 5000);
  if (Array.isArray(body?.excludedMentionUrls)) data.excludedMentionUrls = body.excludedMentionUrls.filter((x) => typeof x === "string").slice(0, 5000);
  if (Array.isArray(body?.excludedMentionRules)) data.excludedMentionRules = body.excludedMentionRules.filter((x) => x && typeof x === "object").slice(0, 5000);
  if (Array.isArray(body?.pressReleases)) data.pressReleases = body.pressReleases.slice(0, 50);
  const room = await prisma.prRoom.update({ where: { id: current.id }, data, include: { project: { select: { name: true } } } });
  return NextResponse.json({ room, canWrite: true });
}
