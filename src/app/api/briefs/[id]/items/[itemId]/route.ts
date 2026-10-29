import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardBrief, shortBase, ensureShortLink } from "@/lib/brief/server";
import { briefItemInclude, toClientItem } from "@/lib/brief/queries";
import { isBriefCategory } from "@/lib/brief/model";
import { parseDueDate } from "@/lib/brief/input";

async function ownedItem(briefId: string, itemId: string) {
  // URL 이 지목한 브리프 안의 링크인지 — 다른 브리프의 링크 id 를 끼워 넣는 걸 막는다.
  return prisma.briefItem.findFirst({ where: { id: itemId, briefId } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const g = await guardBrief(id, { write: true });
  if (!g.ok) return g.response;
  const current = await ownedItem(id, itemId);
  if (!current) return NextResponse.json({ error: "찾을 수 없어요" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.adopted === "boolean") data.adopted = body.adopted;
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 300);
  if (typeof body.org === "string") data.org = body.org.trim().slice(0, 80);
  if (typeof body.dateLabel === "string") data.dateLabel = body.dateLabel.trim().slice(0, 40);
  if (typeof body.note === "string") data.note = body.note.slice(0, 300);
  if ("dueDate" in body) data.dueDate = parseDueDate(body.dueDate);
  if (isBriefCategory(body.category)) data.category = body.category;

  const updated = await prisma.briefItem.update({ where: { id: itemId }, data });
  // 채택하는 순간 단축링크를 만든다 — 카톡 텍스트를 복사할 때 기다리지 않게.
  if (updated.adopted) await ensureShortLink(updated, { workspaceId: g.workspaceId, userId: g.userId });

  const item = await prisma.briefItem.findUniqueOrThrow({ where: { id: itemId }, include: briefItemInclude });
  return NextResponse.json({ item: toClientItem(item, shortBase(request)) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const g = await guardBrief(id, { write: true });
  if (!g.ok) return g.response;
  const current = await ownedItem(id, itemId);
  if (!current) return NextResponse.json({ error: "찾을 수 없어요" }, { status: 404 });

  /*
    단축링크는 지우지 않는다. 이미 카톡에 나간 주소일 수 있다 — 지우면 참가사가 누른 링크가
    "찾을 수 없음" 이 된다. 링크 목록에서만 빠진다.
  */
  if (current.sourceId || current.source !== "manual") {
    // 자동 수집분은 행을 남기고 숨긴다 — 지우면 내일 수집에 같은 공고가 또 들어온다.
    await prisma.briefItem.update({ where: { id: itemId }, data: { dismissedAt: new Date(), adopted: false } });
  } else {
    await prisma.briefItem.delete({ where: { id: itemId } });
  }
  return NextResponse.json({ ok: true });
}
