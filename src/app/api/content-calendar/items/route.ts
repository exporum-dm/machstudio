/**
 * 콘텐츠 캘린더 항목 — GET ?workspaceId&from&to · POST · PATCH · DELETE ?id
 *
 * GET 은 기간(from~to) 안의 항목 + 날짜 미정 항목을 함께 준다. 프로젝트·상태·채널 필터는 화면이 한다.
 * 워크스페이스 멤버 누구나 보고 고친다(2026-11-02 권한 정책 — 프로젝트 배정 없음).
 * 담당자(여러 명): 계정이 살아 있으면 지금 이름, 지워졌거나 계정 없는 사람(노션에서 가져온 퇴사자 등)은 적어 둔 이름.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import {
  assigneeKey, contentRepeatDates, isContentStatus, isValidDay, isValidTime, normalizeTags, parseAssignees, type ContentAssignee,
} from "@/lib/content-calendar";

const toDateValue = (v: unknown) => (isValidDay(v) ? new Date(`${v}T00:00:00Z`) : null);
const toDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const displayName = (u: { name: string | null; email: string }) => u.name || u.email.split("@")[0];

type ItemRow = {
  id: string; projectId: string | null; title: string; date: Date | null; time: string; status: string; channels: string[]; formats: string[];
  campaign: string; assignees: unknown; body: string; link: string; sourceUrl: string; createdAt: Date; updatedAt: Date;
};

function serialize(i: ItemRow, names: Map<string, string>) {
  return {
    id: i.id, projectId: i.projectId, title: i.title, date: toDay(i.date), time: i.time,
    status: isContentStatus(i.status) ? i.status : "waiting", channels: i.channels, formats: i.formats, campaign: i.campaign,
    assignees: parseAssignees(i.assignees).map((a) => ({ id: a.id, name: (a.id && names.get(a.id)) || a.name || "떠난 팀원" })),
    body: i.body, link: i.link, sourceUrl: i.sourceUrl, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString(),
  };
}

const assigneeIds = (rows: { assignees: unknown }[]) => rows.flatMap((r) => parseAssignees(r.assignees).map((a) => a.id));

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

/**
 * 담당자 목록 검사. 새로 넣는 id 는 그 워크스페이스 멤버만(이름은 지금 이름으로 적어 둔다).
 * 이미 항목에 있던 사람(떠난 팀원·계정 없는 사람)은 멤버가 아니어도 그대로 둔다 — 빼는 건 화면에서 지운다.
 */
async function readAssignees(v: unknown, workspaceId: string, existing: ContentAssignee[]): Promise<ContentAssignee[] | "invalid"> {
  const list = parseAssignees(v);
  const ids = list.map((a) => a.id).filter((id): id is string => !!id);
  const members = ids.length
    ? await prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: ids } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    })
    : [];
  const memberName = new Map(members.map((m) => [m.userId, displayName(m.user)]));
  const out: ContentAssignee[] = [];
  for (const a of list) {
    if (a.id && memberName.has(a.id)) { out.push({ id: a.id, name: memberName.get(a.id)! }); continue; }
    const kept = existing.find((e) => assigneeKey(e) === assigneeKey(a));
    if (!kept) return "invalid";
    out.push(kept);
  }
  return out;
}

type Fields = Partial<{
  projectId: string | null; title: string; date: Date | null; time: string; status: string; channels: string[]; formats: string[];
  campaign: string; assignees: ContentAssignee[]; body: string; link: string;
}>;

/** 들어온 값 중 있는 것만 검사해서 고칠 칸으로. 잘못된 값은 오류 문구. */
async function readFields(body: Record<string, unknown>, workspaceId: string, existingAssignees: ContentAssignee[] = []): Promise<Fields | { error: string }> {
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
  if ("channels" in body) out.channels = normalizeTags(body.channels);
  if ("formats" in body) out.formats = normalizeTags(body.formats, 10);
  if ("campaign" in body) out.campaign = text(body.campaign, 40);
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
  if ("assignees" in body) {
    const a = await readAssignees(body.assignees, workspaceId, existingAssignees);
    if (a === "invalid") return { error: "담당자를 찾을 수 없어요" };
    out.assignees = a;
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
  const names = await liveNames(assigneeIds(items), members);
  return NextResponse.json({ items: items.map((i) => serialize(i, names)), members, me: access.userId });
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (typeof body.copyFromId === "string") return copyItems(body);
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!("title" in body)) return NextResponse.json({ error: "제목을 입력해주세요" }, { status: 400 });
  const fields = await readFields(body, workspaceId!);
  if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });
  const item = await prisma.contentItem.create({
    data: { ...fields, assignees: fields.assignees ?? [], title: fields.title!, workspaceId: workspaceId!, createdById: access.userId },
  });
  return NextResponse.json({ item: serialize(item, new Map()) }, { status: 201 });
}

async function copyItems(body: Record<string, unknown>) {
  const source = await prisma.contentItem.findUnique({ where: { id: body.copyFromId as string } });
  if (!source) return NextResponse.json({ error: "원본 콘텐츠를 찾을 수 없어요" }, { status: 404 });
  const access = await requireWorkspaceMember(source.workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.requestId)) return NextResponse.json({ error: "생성 요청을 다시 시도해주세요." }, { status: 400 });
  const fields = await readFields({ ...source, date: toDay(source.date), ...body, status: "waiting", link: "" }, source.workspaceId, parseAssignees(source.assignees));
  if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });
  let dates: Array<string | null>;
  try { dates = body.repeat ? contentRepeatDates(toDay(fields.date ?? null), body.repeat) : [toDay(fields.date ?? null)]; }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  const prefix = `content-copy:${source.id}:${body.requestId}:`;
  const existingCopies = () => prisma.contentItem.findMany({ where: { workspaceId: source.workspaceId, recurrenceKey: { startsWith: prefix } }, orderBy: [{ date: "asc" }, { id: "asc" }] });
  let items = await existingCopies();
  if (!items.length) {
    try {
      items = await prisma.contentItem.createManyAndReturn({ data: dates.map((date, i) => ({
        ...fields, title: body.repeat ? fields.title! : `${fields.title!.slice(0, 195).trimEnd()} (복사)`,
        date: toDateValue(date), status: "waiting", link: "", sourceUrl: source.sourceUrl,
        assignees: fields.assignees ?? [], workspaceId: source.workspaceId, createdById: access.userId,
        recurrenceKey: `${prefix}${i}`,
      })) });
    } catch (e) {
      // 같은 생성 요청이 동시에 재시도되어도 한 묶음만 남긴다.
      if (!(e && typeof e === "object" && "code" in e && e.code === "P2002")) throw e;
      items = await existingCopies();
      if (!items.length) throw e;
    }
  }
  if (body.repeat) return NextResponse.json({ created: items.map(i => ({ id: i.id, date: toDay(i.date) })), count: items.length }, { status: 201 });
  const names = await liveNames(assigneeIds(items), []);
  return NextResponse.json({ items: items.map(i => serialize(i, names)) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const existing = id ? await prisma.contentItem.findUnique({ where: { id }, select: { workspaceId: true, assignees: true } }) : null;
  if (!existing) return NextResponse.json({ error: "항목을 찾을 수 없어요" }, { status: 404 });
  const access = await requireWorkspaceMember(existing.workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const fields = await readFields(body, existing.workspaceId, parseAssignees(existing.assignees));
  if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });
  const item = await prisma.contentItem.update({ where: { id }, data: fields });
  const names = await liveNames(assigneeIds([item]), []);
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
