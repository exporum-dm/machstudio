/**
 * 콘텐츠 캘린더 — AI 커넥터(MCP)용 읽기·추가·수정.
 *
 * 왜 따로 있나: 팀원이 문서로 정리해 둔 콘텐츠 계획을 AI 대화창(Claude 등)에 주고 "캘린더에 넣어 줘"라고
 * 하면 커넥터가 대신 넣는다. 화면용 API(/api/content-calendar/items)는 로그인 쿠키로 동작해서
 * 토큰으로 들어오는 커넥터가 쓸 수 없다. 검사 규칙(제목·날짜·상태·링크·프로젝트)은 화면과 같다.
 *
 * - 토큰 주인이 **지금도** 워크스페이스 멤버여야 한다(토큰이 퇴사 후에도 남아 있을 수 있다).
 * - 담당자는 AI 가 이름으로 준다 → 워크스페이스 멤버 이름(또는 메일 앞부분)과 맞춰 본다.
 * - 지우기는 없다 — 실수로 지운 걸 AI 대화에서 되돌릴 방법이 없어서. 지우는 건 화면에서(되돌리기 있음).
 */
import { prisma } from "@/lib/prisma";
import {
  CONTENT_STATUSES, isContentStatus, isValidDay, isValidTime, normalizeTags, parseAssignees, type ContentAssignee,
} from "@/lib/content-calendar";

/**
 * 한 번에 넣는 최대 건수 — 1년 치 계획(주 5~6건)을 한 번에. 그보다 많으면 AI 가 나눠서 부른다.
 * 서버는 INSERT 한 번(createManyAndReturn)이라 300건도 가볍다.
 */
export const MAX_API_CONTENT_ITEMS = 300;

export interface ApiContentInput {
  title?: string;
  date?: string | null;
  time?: string;
  status?: string;
  channels?: string[];
  formats?: string[];
  campaign?: string;
  assignees?: string[];
  body?: string;
  link?: string;
  projectId?: string | null;
}

type Ctx = { workspaceId: string; userId: string; lockProjectId?: string };

const displayName = (u: { name: string | null; email: string }) => u.name || u.email.split("@")[0];
const nameKey = (v: string) => v.normalize("NFC").replace(/\s+/g, "").toLowerCase();
const toDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function isWorkspaceMember(workspaceId: string, userId: string) {
  const m = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId } }, select: { userId: true } });
  return !!m;
}

async function members(workspaceId: string) {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true, user: { select: { name: true, email: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((m) => ({ id: m.userId, name: displayName(m.user), emailLocal: m.user.email.split("@")[0] }));
}

type Member = Awaited<ReturnType<typeof members>>[number];

function serialize(i: {
  id: string; projectId: string | null; title: string; date: Date | null; time: string; status: string; channels: string[]; formats: string[];
  campaign: string; assignees: unknown; body: string; link: string;
}, names: Map<string, string>, projects: Map<string, string>) {
  return {
    id: i.id,
    title: i.title,
    date: toDay(i.date),
    time: i.time,
    status: i.status,
    channels: i.channels,
    formats: i.formats,
    campaign: i.campaign,
    assignees: parseAssignees(i.assignees).map((a) => (a.id && names.get(a.id)) || a.name || "떠난 팀원"),
    projectId: i.projectId,
    projectName: i.projectId ? projects.get(i.projectId) ?? null : null,
    body: i.body,
    link: i.link,
  };
}

async function projectNames(workspaceId: string) {
  const rows = await prisma.project.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, name: true } });
  return new Map(rows.map((p) => [p.id, p.name]));
}

/** 들어온 칸만 검사해 저장할 값으로. 잘못된 값은 사람이 읽을 오류 문구. */
function readFields(input: ApiContentInput, ctx: Ctx, team: Member[], projects: Map<string, string>, creating: boolean) {
  const out: Record<string, unknown> = {};
  if (creating || input.title !== undefined) {
    const title = typeof input.title === "string" ? input.title.trim().slice(0, 200) : "";
    if (!title) return { error: "제목(title)이 비어 있어요" };
    out.title = title;
  }
  if (input.date !== undefined) {
    if (input.date === null || input.date === "") out.date = null;
    else if (isValidDay(input.date)) out.date = new Date(`${input.date}T00:00:00Z`);
    else return { error: `날짜는 YYYY-MM-DD 형식이어야 해요: ${input.date}` };
  }
  if (input.time !== undefined) {
    const t = typeof input.time === "string" ? input.time.trim() : "";
    if (!isValidTime(t)) return { error: `시간은 HH:MM(24시간) 형식이어야 해요: ${input.time}` };
    out.time = t;
  }
  if (input.status !== undefined) {
    if (!isContentStatus(input.status)) return { error: `상태는 ${CONTENT_STATUSES.map((s) => `${s.id}(${s.label})`).join(", ")} 중 하나예요` };
    out.status = input.status;
  }
  if (input.channels !== undefined) out.channels = normalizeTags(input.channels);
  if (input.formats !== undefined) out.formats = normalizeTags(input.formats, 10);
  if (input.campaign !== undefined) out.campaign = typeof input.campaign === "string" ? input.campaign.trim().slice(0, 40) : "";
  if (input.body !== undefined) out.body = typeof input.body === "string" ? input.body.slice(0, 20_000) : "";
  if (input.link !== undefined) {
    const raw = typeof input.link === "string" ? input.link.trim().slice(0, 1000) : "";
    if (raw) {
      let ok = false;
      try { const u = new URL(raw); ok = u.protocol === "http:" || u.protocol === "https:"; } catch { ok = false; }
      if (!ok) return { error: `링크는 https:// 로 시작하는 주소만 저장돼요: ${raw}` };
    }
    out.link = raw;
  }
  if (ctx.lockProjectId) {
    // 프로젝트 하나에 묶인 커넥터 — 그 프로젝트로만 넣는다(모델이 다른 값을 보내도 무시).
    if (creating) out.projectId = ctx.lockProjectId;
  } else if (input.projectId !== undefined) {
    if (input.projectId === null || input.projectId === "") out.projectId = null;
    else if (projects.has(input.projectId)) out.projectId = input.projectId;
    else return { error: `프로젝트를 찾을 수 없어요(list_projects 의 id 를 쓰세요): ${input.projectId}` };
  }
  if (input.assignees !== undefined) {
    const list: ContentAssignee[] = [];
    for (const raw of (Array.isArray(input.assignees) ? input.assignees : []).slice(0, 10)) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const key = nameKey(raw);
      const m = team.find((t) => nameKey(t.name) === key || nameKey(t.emailLocal) === key);
      if (!m) return { error: `담당자 "${raw}" 를 팀원 중에서 찾지 못했어요. 팀원: ${team.map((t) => t.name).join(", ")}` };
      if (!list.some((a) => a.id === m.id)) list.push({ id: m.id, name: m.name });
    }
    out.assignees = list;
  }
  return { fields: out };
}

export async function listApiContentItems(ctx: Ctx, input: { from: string; to: string; projectId?: string }) {
  if (!isValidDay(input.from) || !isValidDay(input.to)) return { error: "from·to 는 YYYY-MM-DD 형식이어야 해요" } as const;
  const from = new Date(`${input.from}T00:00:00Z`);
  const to = new Date(`${input.to}T00:00:00Z`);
  if (to < from) return { error: "to 가 from 보다 앞이에요" } as const;
  if (to.getTime() - from.getTime() > 400 * 86_400_000) return { error: "기간은 최대 400일이에요" } as const;
  const projectId = ctx.lockProjectId ?? input.projectId;
  const [items, team, projects] = await Promise.all([
    prisma.contentItem.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        OR: [{ date: { gte: from, lte: to } }, { date: null }],
        AND: [projectId ? { projectId } : { OR: [{ projectId: null }, { project: { deletedAt: null } }] }],
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: 1000,
      select: { id: true, projectId: true, title: true, date: true, time: true, status: true, channels: true, formats: true, campaign: true, assignees: true, body: true, link: true },
    }),
    members(ctx.workspaceId),
    projectNames(ctx.workspaceId),
  ]);
  const names = new Map(team.map((m) => [m.id, m.name]));
  return {
    items: items.map((i) => serialize(i, names, projects)),
    count: items.length,
    teamMembers: team.map((m) => m.name),
    statuses: CONTENT_STATUSES.map((s) => ({ id: s.id, label: s.label })),
  } as const;
}

/**
 * 여러 건을 한 번에 — **하나라도 틀리면 아무것도 넣지 않는다**(반만 들어가 다시 넣을 때 겹치는 일을 막는다).
 */
export async function createApiContentItems(ctx: Ctx, inputs: ApiContentInput[]) {
  if (!inputs.length) return { error: "넣을 항목이 없어요" } as const;
  if (inputs.length > MAX_API_CONTENT_ITEMS) return { error: `한 번에 최대 ${MAX_API_CONTENT_ITEMS}건까지 넣을 수 있어요` } as const;
  const [team, projects] = await Promise.all([members(ctx.workspaceId), projectNames(ctx.workspaceId)]);
  const rows: Record<string, unknown>[] = [];
  for (const [index, input] of inputs.entries()) {
    const read = readFields(input, ctx, team, projects, true);
    if ("error" in read) return { error: `${index + 1}번째 항목: ${read.error}` } as const;
    rows.push(read.fields);
  }
  // INSERT 한 번 — 전부 들어가거나 하나도 안 들어간다.
  const created = await prisma.contentItem.createManyAndReturn({
    data: rows.map((fields) => ({ assignees: [], ...fields, title: fields.title as string, workspaceId: ctx.workspaceId, createdById: ctx.userId })),
    select: { id: true, title: true, date: true },
  });
  // 돌려줄 땐 확인용 요약만 — 본문까지 300건을 다시 보내면 AI 대화가 쓸데없이 길어진다.
  return { created: created.map((i) => ({ id: i.id, title: i.title, date: toDay(i.date) })), count: created.length } as const;
}

export async function updateApiContentItem(ctx: Ctx, id: string, input: ApiContentInput) {
  const existing = await prisma.contentItem.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { id: true, projectId: true } });
  if (!existing || (ctx.lockProjectId && existing.projectId !== ctx.lockProjectId)) return { error: "콘텐츠를 찾을 수 없어요" } as const;
  const [team, projects] = await Promise.all([members(ctx.workspaceId), projectNames(ctx.workspaceId)]);
  const read = readFields(input, ctx, team, projects, false);
  if ("error" in read) return { error: read.error } as const;
  if (!Object.keys(read.fields).length) return { error: "고칠 칸이 없어요" } as const;
  const item = await prisma.contentItem.update({
    where: { id },
    data: read.fields,
    select: { id: true, projectId: true, title: true, date: true, time: true, status: true, channels: true, formats: true, campaign: true, assignees: true, body: true, link: true },
  });
  return { item: serialize(item, new Map(team.map((m) => [m.id, m.name])), projects) } as const;
}
