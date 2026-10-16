/**
 * 이벤트 택소노미 — 워크스페이스 공통 이벤트 이름 규칙(GA4/GTM).
 * GET ?workspaceId · POST { workspaceId, name, ... } · PATCH { id, ... } · DELETE ?id
 */
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import { normalizeTaxonomyInput, type TaxonomyData } from "@/lib/event-taxonomy";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const events = await prisma.eventTaxonomy.findMany({
    where: { workspaceId: workspaceId! },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const access = await requireWorkspaceMember(body.workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = normalizeTaxonomyInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const last = await prisma.eventTaxonomy.findFirst({ where: { workspaceId: body.workspaceId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  try {
    const d = parsed.data as TaxonomyData; // partial 아님 — 모든 키가 채워져 있다
    const event = await prisma.eventTaxonomy.create({
      data: { ...d, parameters: d.parameters as unknown as Prisma.InputJsonValue, workspaceId: body.workspaceId, sortOrder: (last?.sortOrder ?? 0) + 1 },
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
      return NextResponse.json({ error: "이미 있는 이벤트 이름이에요" }, { status: 409 });
    }
    throw e;
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const target = id ? await prisma.eventTaxonomy.findUnique({ where: { id }, select: { workspaceId: true } }) : null;
  if (!target) return NextResponse.json({ error: "이벤트를 찾을 수 없어요" }, { status: 404 });
  const access = await requireWorkspaceMember(target.workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  // 순서 바꾸기 — { id, sortOrder }
  if (typeof body.sortOrder === "number" && Object.keys(body).length === 2) {
    const event = await prisma.eventTaxonomy.update({ where: { id }, data: { sortOrder: Math.round(body.sortOrder) } });
    return NextResponse.json({ event });
  }
  const parsed = normalizeTaxonomyInput(body, { partial: true });
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const event = await prisma.eventTaxonomy.update({
      where: { id },
      data: { ...parsed.data, parameters: parsed.data.parameters ? (parsed.data.parameters as unknown as Prisma.InputJsonValue) : undefined },
    });
    return NextResponse.json({ event });
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
      return NextResponse.json({ error: "이미 있는 이벤트 이름이에요" }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const target = id ? await prisma.eventTaxonomy.findUnique({ where: { id }, select: { workspaceId: true } }) : null;
  if (!target) return NextResponse.json({ error: "이벤트를 찾을 수 없어요" }, { status: 404 });
  const access = await requireWorkspaceMember(target.workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  await prisma.eventTaxonomy.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
