/**
 * 업무일지 줄 — GET ?workspaceId&from&to[&mine=1] · POST · PATCH · DELETE ?id
 * 고치기·지우기는 쓴 사람 또는 관리자만.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import { isWorkStatus } from "@/lib/worklog";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDateValue = (v: unknown) => (typeof v === "string" && DAY_RE.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(`${v}T00:00:00Z`) : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

type EntryRow = {
  id: string; groupId: string | null; authorId: string; date: Date; category: string; content: string;
  status: string; result: string; note: string; updatedAt: Date; author: { name: string | null; email: string };
};
function serialize(e: EntryRow) {
  return {
    id: e.id, groupId: e.groupId, authorId: e.authorId, authorName: e.author.name || e.author.email.split("@")[0],
    date: e.date.toISOString().slice(0, 10), category: e.category, content: e.content, status: e.status,
    result: e.result, note: e.note, updatedAt: e.updatedAt.toISOString(),
  };
}
const include = { author: { select: { name: true, email: true } } } as const;

async function groupInWorkspace(groupId: unknown, workspaceId: string): Promise<string | null | "invalid"> {
  if (groupId === null || groupId === "" || groupId === undefined) return null;
  if (typeof groupId !== "string") return "invalid";
  const g = await prisma.workGroup.findFirst({ where: { id: groupId, workspaceId }, select: { id: true } });
  return g ? g.id : "invalid";
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
  const entries = await prisma.workEntry.findMany({
    where: { workspaceId: workspaceId!, date: { gte: from, lte: to }, ...(searchParams.get("mine") === "1" ? { authorId: access.userId } : {}) },
    include,
    orderBy: [{ date: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ entries: entries.map(serialize), me: access.userId, isAdmin: access.isAdmin });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const date = toDateValue(body.date);
  const content = text(body.content, 2000);
  if (!date) return NextResponse.json({ error: "날짜를 확인해주세요" }, { status: 400 });
  if (!content) return NextResponse.json({ error: "내역을 입력해주세요" }, { status: 400 });
  const groupId = await groupInWorkspace(body.groupId, workspaceId!);
  if (groupId === "invalid") return NextResponse.json({ error: "행사를 찾을 수 없어요" }, { status: 400 });
  const entry = await prisma.workEntry.create({
    data: {
      workspaceId: workspaceId!, authorId: access.userId, date, groupId, content,
      category: text(body.category, 40), status: isWorkStatus(body.status) ? body.status : "done",
      result: text(body.result, 1000), note: text(body.note, 1000),
    },
    include,
  });
  return NextResponse.json({ entry: serialize(entry) }, { status: 201 });
}

async function loadOwned(id: string) {
  const entry = id ? await prisma.workEntry.findUnique({ where: { id }, select: { workspaceId: true, authorId: true } }) : null;
  if (!entry) return { error: "일지를 찾을 수 없어요", status: 404 } as const;
  const access = await requireWorkspaceMember(entry.workspaceId);
  if ("error" in access) return { error: access.error, status: access.status } as const;
  if (entry.authorId !== access.userId && !access.isAdmin) return { error: "쓴 사람만 고칠 수 있어요", status: 403 } as const;
  return { entry, access } as const;
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const owned = await loadOwned(typeof body.id === "string" ? body.id : "");
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const data: Record<string, unknown> = {};
  if ("date" in body) {
    const date = toDateValue(body.date);
    if (!date) return NextResponse.json({ error: "날짜를 확인해주세요" }, { status: 400 });
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
  if ("category" in body) data.category = text(body.category, 40);
  if ("status" in body && isWorkStatus(body.status)) data.status = body.status;
  if ("result" in body) data.result = text(body.result, 1000);
  if ("note" in body) data.note = text(body.note, 1000);
  const entry = await prisma.workEntry.update({ where: { id: body.id }, data, include });
  return NextResponse.json({ entry: serialize(entry) });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const owned = await loadOwned(id);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });
  await prisma.workEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
