/**
 * 업무일지 줄 — GET ?workspaceId&from&to[&someday=1][&mine=1] · POST · PATCH · DELETE ?id
 *
 * 시트 모양(2026-10-18): 행 = 날짜(date, NULL 이면 "먼 미래"), 열 = 공통(common) 또는 쓴 사람.
 * 시트처럼 팀원 누구나 다른 사람 칸에도 적고 고친다(2026-10-21). 칸 주인 = authorId, 실제로 적은 사람 = createdById.
 * POST 는 { items: [...] } 로 여러 줄을 한 번에 — 시트 칸을 통째로 붙여 넣을 때.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import { isWorkStatus } from "@/lib/worklog";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDateValue = (v: unknown) => (typeof v === "string" && DAY_RE.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(`${v}T00:00:00Z`) : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

type EntryRow = {
  id: string; groupId: string | null; authorId: string; createdById: string | null; date: Date | null; common: boolean; sortOrder: number;
  category: string; content: string; status: string; result: string; note: string; createdAt: Date; updatedAt: Date;
  author: { name: string | null; email: string };
};
const displayName = (u: { name: string | null; email: string }) => u.name || u.email.split("@")[0];
function serialize(e: EntryRow) {
  return {
    id: e.id, groupId: e.groupId, authorId: e.authorId, authorName: displayName(e.author),
    createdById: e.createdById,
    date: e.date ? e.date.toISOString().slice(0, 10) : null, common: e.common, sortOrder: e.sortOrder,
    category: e.category, content: e.content, status: e.status,
    result: e.result, note: e.note, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString(),
  };
}
const include = { author: { select: { name: true, email: true } } } as const;

/** 칸 주인으로 지정할 사람 — 이 워크스페이스 멤버만. */
async function memberIn(userId: unknown, workspaceId: string): Promise<string | null> {
  if (typeof userId !== "string" || !userId) return null;
  const m = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId } }, select: { userId: true } });
  return m ? m.userId : null;
}

async function groupInWorkspace(groupId: unknown, workspaceId: string): Promise<string | null | "invalid"> {
  if (groupId === null || groupId === "" || groupId === undefined) return null;
  if (typeof groupId !== "string") return "invalid";
  const g = await prisma.workGroup.findFirst({ where: { id: groupId, workspaceId }, select: { id: true } });
  return g ? g.id : "invalid";
}

/** date 칸 — null 은 먼 미래, 문자열은 날짜, 그 밖은 잘못. */
function dateField(v: unknown): Date | null | "invalid" {
  if (v === null) return null;
  return toDateValue(v) ?? "invalid";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const from = toDateValue(searchParams.get("from"));
  const to = toDateValue(searchParams.get("to"));
  if (!from || !to) return NextResponse.json({ error: "from·to(YYYY-MM-DD) 필요" }, { status: 400 });
  if (to.getTime() - from.getTime() > 400 * 86_400_000) return NextResponse.json({ error: "기간이 너무 길어요" }, { status: 400 });
  const when = [{ date: { gte: from, lte: to } }, ...(searchParams.get("someday") === "1" ? [{ date: null }] : [])];
  const who = searchParams.get("mine") === "1" ? [{ OR: [{ authorId: access.userId }, { common: true }] }] : [];
  const [entries, members] = await Promise.all([
    prisma.workEntry.findMany({
      where: { workspaceId: workspaceId!, AND: [{ OR: when }, ...who] },
      include,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: workspaceId! },
      select: { userId: true, user: { select: { name: true, email: true } } },
      orderBy: { joinedAt: "asc" },
    }),
  ]);
  return NextResponse.json({
    entries: entries.map(serialize),
    members: members.map((m) => ({ id: m.userId, name: displayName(m.user) })),
    me: access.userId,
    isAdmin: access.isAdmin,
  });
}

type ItemInput = Record<string, unknown>;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const batch = Array.isArray(body.items);
  const items: ItemInput[] = batch ? (body.items as ItemInput[]).slice(0, 200) : [body];
  if (items.length === 0) return NextResponse.json({ entries: [] }, { status: 201 });

  const rows = [];
  for (const item of items) {
    const date = dateField(item.date);
    const content = text(item.content, 2000);
    if (date === "invalid") return NextResponse.json({ error: "날짜를 확인해주세요" }, { status: 400 });
    if (!content) return NextResponse.json({ error: "내역을 입력해주세요" }, { status: 400 });
    const groupId = await groupInWorkspace(item.groupId, workspaceId!);
    if (groupId === "invalid") return NextResponse.json({ error: "행사를 찾을 수 없어요" }, { status: 400 });
    // 다른 팀원 칸에 적으면 그 사람이 칸 주인 — 적은 사람은 createdById 로 남긴다.
    const owner = (await memberIn(item.authorId, workspaceId!)) ?? access.userId;
    rows.push({
      workspaceId: workspaceId!, authorId: owner, createdById: access.userId, date, groupId, content,
      common: item.common === true, sortOrder: num(item.sortOrder),
      category: text(item.category, 40), status: isWorkStatus(item.status) ? item.status : "planned",
      result: text(item.result, 1000), note: text(item.note, 1000),
    });
  }
  const created = await prisma.$transaction(rows.map((data) => prisma.workEntry.create({ data, include })));
  const entries = created.map(serialize);
  return NextResponse.json(batch ? { entries } : { entry: entries[0] }, { status: 201 });
}

async function loadEditable(id: string) {
  const entry = id ? await prisma.workEntry.findUnique({ where: { id }, select: { workspaceId: true, authorId: true, common: true } }) : null;
  if (!entry) return { error: "일지를 찾을 수 없어요", status: 404 } as const;
  const access = await requireWorkspaceMember(entry.workspaceId);
  if ("error" in access) return { error: access.error, status: access.status } as const;
  return { entry, access } as const;
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const owned = await loadEditable(typeof body.id === "string" ? body.id : "");
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const data: Record<string, unknown> = {};
  if ("date" in body) {
    const date = dateField(body.date);
    if (date === "invalid") return NextResponse.json({ error: "날짜를 확인해주세요" }, { status: 400 });
    data.date = date;
  }
  if ("content" in body) {
    const content = text(body.content, 2000);
    if (!content) return NextResponse.json({ error: "내역을 입력해주세요" }, { status: 400 });
    data.content = content;
  }
  if ("groupId" in body) {
    const groupId = await groupInWorkspace(body.groupId, owned.entry.workspaceId);
    if (groupId === "invalid") return NextResponse.json({ error: "행사를 찾을 수 없어요" }, { status: 400 });
    data.groupId = groupId;
  }
  if ("common" in body && typeof body.common === "boolean") {
    data.common = body.common;
    // 공통 칸에서 사람 칸으로 옮기는데 주인을 안 정했으면 옮긴 사람 칸으로.
    if (!body.common && owned.entry.common && !("authorId" in body)) data.authorId = owned.access.userId;
  }
  if ("authorId" in body) {
    const owner = await memberIn(body.authorId, owned.entry.workspaceId);
    if (!owner) return NextResponse.json({ error: "이 워크스페이스 멤버가 아니에요" }, { status: 400 });
    data.authorId = owner;
  }
  if ("sortOrder" in body) data.sortOrder = num(body.sortOrder);
  if ("category" in body) data.category = text(body.category, 40);
  if ("status" in body && isWorkStatus(body.status)) data.status = body.status;
  if ("result" in body) data.result = text(body.result, 1000);
  if ("note" in body) data.note = text(body.note, 1000);
  const entry = await prisma.workEntry.update({ where: { id: body.id }, data, include });
  return NextResponse.json({ entry: serialize(entry) });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const owned = await loadEditable(id);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });
  await prisma.workEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
