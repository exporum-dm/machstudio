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
  const expectedUpdatedAt = typeof body?.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : current.updatedAt;
  if (Number.isNaN(expectedUpdatedAt.getTime())) return NextResponse.json({ error: "저장 버전을 확인해 주세요" }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (typeof body?.lastCollectedAt === "string" && !Number.isNaN(new Date(body.lastCollectedAt).getTime())) data.lastCollectedAt = new Date(body.lastCollectedAt);
  if (Array.isArray(body?.keywords)) data.keywords = body.keywords.filter((x) => typeof x === "string").slice(0, 20);
  if (Array.isArray(body?.referenceUrls)) data.referenceUrls = body.referenceUrls.filter((x) => typeof x === "string").slice(0, 20);
  if (Array.isArray(body?.ownChannelUrls)) data.ownChannelUrls = body.ownChannelUrls.filter((x) => typeof x === "string").slice(0, 50);
  if (Array.isArray(body?.mentions)) data.mentions = body.mentions.slice(0, 5000);
  if (Array.isArray(body?.excludedMentionUrls)) data.excludedMentionUrls = body.excludedMentionUrls.filter((x) => typeof x === "string").slice(0, 5000);
  if (Array.isArray(body?.excludedMentionRules)) data.excludedMentionRules = body.excludedMentionRules.filter((x) => x && typeof x === "object").slice(0, 5000);
  if (Array.isArray(body?.pressReleases)) data.pressReleases = body.pressReleases.slice(0, 50);
  const result = await prisma.prRoom.updateMany({ where: { id: current.id, updatedAt: expectedUpdatedAt }, data });
  if (!result.count) return NextResponse.json({ error: "다른 창에서 내용이 바뀌었어요. 최신 내용을 불러온 뒤 다시 시도해 주세요." }, { status: 409 });
  const room = await prisma.prRoom.findUnique({ where: { id: current.id }, include: { project: { select: { name: true } } } });
  return NextResponse.json({ room, canWrite: true });
}
