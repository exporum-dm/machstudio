/**
 * 콘텐츠 캘린더 항목 — GET ?workspaceId&from&to · POST · PATCH · DELETE ?id
 *
 * GET 은 기간(from~to) 안의 항목 + 날짜 미정 항목을 함께 준다. 프로젝트·상태·채널 필터는 화면이 한다.
 * 워크스페이스 멤버 누구나 보고 고친다(2026-11-02 권한 정책 — 프로젝트 배정 없음).
 * 담당자 이름: 계정이 살아 있으면 지금 이름, 지워졌으면 항목에 적어 둔 assigneeName.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import { isContentStatus, isValidDay, isValidTime, normalizeChannels } from "@/lib/content-calendar";

const toDateValue = (v: unknown) => (isValidDay(v) ? new Date(`${v}T00:00:00Z`) : null);
const toDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const displayName = (u: { name: string | null; email: string }) => u.name || u.email.split("@")[0];

type ItemRow = {
  id: string; projectId: string | null; title: string; date: Date | null; time: string; status: string; channels: string[]; format: string;
  assigneeId: string | null; assigneeName: string; body: string; link: string; createdAt: Date; updatedAt: Date;
};

function serialize(i: ItemRow, names: Map<string, string>) {
  return {
    id: i.id, projectId: i.projectId, title: i.title, date: toDay(i.date), time: i.time,
    status: isContentStatus(i.status) ? i.status : "idea", channels: i.channels, format: i.format,
    assigneeId: i.assigneeId,
    assigneeName: i.assigneeId ? names.get(i.assigneeId) ?? (i.assigneeName || "떠난 팀원") : "",
    body: i.body, link: i.link, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString(),
  };
}

async function memberNames(workspaceId: string) {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true, user: { select: { name: true, email: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return members.map((m) => ({ id: m.userId, name: displayName(m.user) }));
}

/** 멤버가 아닌 담당자(떠난 팀원)의 이름도 계정이 남아 있으면 지금 이름으로. */
async function liveNames(ids: (string | null)[], members: { id: string; name: string }[]) {
  const names = new Map(members.map((m) => [m.id, m.name]));
  const missing = [...new Set(ids.filter((id): id is string => !!id && !names.has(id)))];
  if (missing.length) {
    const users = await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, email: true } });
    for (const u of users) names.set(u.id, displayName(u));
  }
  return names;
}

/** 링크는 http(s) 만 저장한다 — 화면이 그대로 <a href> 로 연다. */
function safeLink(v: unknown): string | "invalid" {
  const raw = text(v, 1000);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : "invalid";
  } catch { return "invalid"; }
}

async function projectInWorkspace(projectId: unknown, workspaceId: string): Promise<string | null | "invalid"> {
  if (projectId === null || projectId === "" || projectId === undefined) return null;
  if (typeof projectId !== "string") return "invalid";
  const p = await prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null }, select: { id: true } });
  return p ? p.id : "invalid";
}

/** 담당자는 그 워크스페이스 멤버만. 이름을 같이 돌려준다(항목에 적어 둘 이름). */
async function assigneeInWorkspace(assigneeId: unknown, workspaceId: string): Promise<{ id: string | null; name: string } | "invalid"> {
  if (assigneeId === null || assigneeId === "" || assigneeId === undefined) return { id: null, name: "" };
  if (typeof assigneeId !== "string") return "invalid";
  const m = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: assigneeId, workspaceId } },
    select: { user: { select: { name: true, email: true } } },
  });
  return m ? { id: assigneeId, name: displayName(m.user) } : "invalid";
}

type Fields = Partial<{
  projectId: string | null; title: string; date: Date | null; time: string; status: string; channels: string[]; format: string;
  assigneeId: string | null; assigneeName: string; body: string; link: string;
}>;

/** 들어온 값 중 있는 것만 검사해서 고칠 칸으로. 잘못된 값은 오류 문구. */
async function readFields(body: Record<string, unknown>, workspaceId: string): Promise<Fields | { error: string }> {
  const out: Fields = {};
  if ("title" in body) {
    const title = text(body.title, 200);
    if (!title) return { error: "제목을 입력해주세요" };
    out.title = title;
  }
  if ("date" in body) {
    if (body.date === null || body.date === "") out.date = null;
    else {
      const d = toDateValue(body.date);
      if (!d) return { error: "날짜 형식이 올바르지 않아요" };
      out.date = d;
    }
  }
  if ("time" in body) {
    const t = typeof body.time === "string" ? body.time.trim() : "";
    if (!isValidTime(t)) return { error: "시간 형식이 올바르지 않아요" };
    out.time = t;
  }
  if ("status" in body) {
    if (!isContentStatus(body.status)) return { error: "상태가 올바르지 않아요" };
    out.status = body.status;
  }
  if ("channels" in body) out.channels = normalizeChannels(body.channels);
  if ("format" in body) out.format = text(body.format, 40);
  if ("body" in body) out.body = typeof body.body === "string" ? body.body.slice(0, 20_000) : "";
  if ("link" in body) {
    const link = safeLink(body.link);
    if (link === "invalid") return { error: "링크는 https:// 로 시작하는 주소만 저장돼요" };
    out.link = link;
  }
  if ("projectId" in body) {
    const projectId = await projectInWorkspace(body.projectId, workspaceId);
    if (projectId === "invalid") return { error: "프로젝트를 찾을 수 없어요" };
    out.projectId = projectId;
  }
  if ("assigneeId" in body) {
    const a = await assigneeInWorkspace(body.assigneeId, workspaceId);
    if (a === "invalid") return { error: "담당자를 찾을 수 없어요" };
    out.assigneeId = a.id;
    out.assigneeName = a.name;
  }
  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const from = toDateValue(searchParams.get("from"));
  const to = toDateValue(searchParams.get("to"));
  if (!from || !to || to < from) return NextResponse.json({ error: "from·to(YYYY-MM-DD) 필요" }, { status: 400 });
  if (to.getTime() - from.getTime() > 400 * 86_400_000) return NextResponse.json({ error: "기간이 너무 길어요" }, { status: 400 });
  const [items, members] = await Promise.all([
    prisma.contentItem.findMany({
      where: {
        workspaceId: workspaceId!,
        OR: [{ date: { gte: from, lte: to } }, { date: null }],
        // 지운 프로젝트(소프트 삭제)의 항목은 숨긴다 — 프로젝트를 되살리면 다시 보인다.
        AND: [{ OR: [{ projectId: null }, { project: { deletedAt: null } }] }],
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: 3000,
    }),
    memberNames(workspaceId!),
  ]);
  const names = await liveNames(items.map((i) => i.assigneeId), members);
  return NextResponse.json({ items: items.map((i) => serialize(i, names)), members, me: access.userId });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!("title" in body)) return NextResponse.json({ error: "제목을 입력해주세요" }, { status: 400 });
  const fields = await readFields(body, workspaceId!);
  if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });
  const item = await prisma.contentItem.create({
    data: { ...fields, title: fields.title!, workspaceId: workspaceId!, createdById: access.userId },
  });
  const names = new Map(item.assigneeId ? [[item.assigneeId, item.assigneeName]] : []);
  return NextResponse.json({ item: serialize(item, names) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const existing = id ? await prisma.contentItem.findUnique({ where: { id }, select: { workspaceId: true } }) : null;
  if (!existing) return NextResponse.json({ error: "항목을 찾을 수 없어요" }, { status: 404 });
  const access = await requireWorkspaceMember(existing.workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const fields = await readFields(body, existing.workspaceId);
  if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });
  const item = await prisma.contentItem.update({ where: { id }, data: fields });
  const names = await liveNames([item.assigneeId], []);
  return NextResponse.json({ item: serialize(item, names) });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const existing = id ? await prisma.contentItem.findUnique({ where: { id }, select: { workspaceId: true } }) : null;
  if (!existing) return NextResponse.json({ ok: true });
  const access = await requireWorkspaceMember(existing.workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  await prisma.contentItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
