/**
 * 업무일지 "행사"(주간 보고의 줄) — GET ?workspaceId · POST · PATCH · DELETE ?id
 * POST { workspaceId, seed: true } 는 비어 있을 때 DM 주간업무보고 양식의 행사 목록을 넣는다.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import { isValidDay } from "@/lib/worklog";

const dayOrNull = (v: unknown) => (isValidDay(v) ? new Date(`${v}T00:00:00Z`) : null);
const toDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** dm-report-weekly-2026 시트(2026-10-16)의 행사 줄 — 프로젝트는 이름이 분명한 것만 잇는다. */
// aliases = DM 업무 현황 시트에서 쓰던 머리표(빈도순으로 확인, 2026-10-18).
const SEED: Array<{ name: string; start: string | null; end: string | null; project?: string; aliases: string[] }> = [
  { name: "X-Space 2026", start: "2026-10-13", end: "2026-10-16", project: "X-Space", aliases: ["xspace", "x-space", "x-spce", "xsapce", "엑스스페이스"] },
  { name: "코리아 엑스포 LA", start: "2026-10-22", end: "2026-10-24", project: "Korea Expo", aliases: ["코엑", "LA", "코엑LA"] },
  { name: "대한민국 교육박람회", start: "2027-01-27", end: "2027-01-29", aliases: ["교박"] },
  { name: "THE MINT SEOUL", start: "2027-04-15", end: "2027-04-16", aliases: ["더민트", "민트"] },
  { name: "코리아 엑스포 도쿄", start: "2027-04-02", end: "2027-04-04", project: "Korea Expo", aliases: ["도쿄", "코엑도쿄"] },
  { name: "인디뷰티 서울", start: "2027-04-08", end: "2027-04-10", project: "Indie Beauty Seoul", aliases: ["IB", "IBS", "인디뷰티"] },
  { name: "STK", start: "2027-06-02", end: "2027-06-04", project: "STK", aliases: ["STK", "스마트테크"] },
  { name: "코리아 엑스포 파리", start: "2027-06-17", end: "2027-06-19", project: "Korea Expo", aliases: ["파리", "코엑파리"] },
  { name: "서울 국제 주얼리 & 액세서리 쇼", start: "2027-08-13", end: "2027-08-15", project: "The MOST", aliases: ["주얼리", "더모스트", "더모", "THE MOST"] },
  { name: "에듀테크 코리아 페어", start: null, end: null, project: "Edtech Korea Fair", aliases: ["에듀", "에듀테크"] },
  { name: "서울바앤스피릿쇼", start: "2027-11-12", end: "2027-11-14", project: "Seoul Bar & Spirits Show", aliases: ["바쇼"] },
];
const aliasList = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 20) : [];

function serialize(g: { id: string; name: string; projectId: string | null; startDate: Date | null; endDate: Date | null; archived: boolean; sortOrder: number; aliases: string[] }) {
  return { id: g.id, name: g.name, projectId: g.projectId, startDate: toDay(g.startDate), endDate: toDay(g.endDate), archived: g.archived, sortOrder: g.sortOrder, aliases: g.aliases };
}

async function projectInWorkspace(projectId: unknown, workspaceId: string): Promise<string | null | "invalid"> {
  if (projectId === null || projectId === "" || projectId === undefined) return null;
  if (typeof projectId !== "string") return "invalid";
  const p = await prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null }, select: { id: true } });
  return p ? p.id : "invalid";
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const groups = await prisma.workGroup.findMany({ where: { workspaceId: workspaceId! }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ groups: groups.map(serialize) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const access = await requireWorkspaceMember(workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  if (body.seed === true) {
    const existing = await prisma.workGroup.count({ where: { workspaceId: workspaceId! } });
    if (existing > 0) return NextResponse.json({ error: "이미 행사가 있어요" }, { status: 409 });
    const projects = await prisma.project.findMany({ where: { workspaceId: workspaceId!, deletedAt: null }, select: { id: true, name: true } });
    await prisma.workGroup.createMany({
      data: SEED.map((s, i) => ({
        workspaceId: workspaceId!,
        name: s.name,
        startDate: dayOrNull(s.start),
        endDate: dayOrNull(s.end),
        projectId: projects.find((p) => p.name === s.project)?.id ?? null,
        sortOrder: i + 1,
        aliases: s.aliases,
      })),
    });
    const groups = await prisma.workGroup.findMany({ where: { workspaceId: workspaceId! }, orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ groups: groups.map(serialize) }, { status: 201 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "행사 이름을 입력해주세요" }, { status: 400 });
  const projectId = await projectInWorkspace(body.projectId, workspaceId!);
  if (projectId === "invalid") return NextResponse.json({ error: "프로젝트를 찾을 수 없어요" }, { status: 400 });
  const last = await prisma.workGroup.findFirst({ where: { workspaceId: workspaceId! }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const group = await prisma.workGroup.create({
    data: { workspaceId: workspaceId!, name, projectId, startDate: dayOrNull(body.startDate), endDate: dayOrNull(body.endDate), sortOrder: (last?.sortOrder ?? 0) + 1, aliases: aliasList(body.aliases) },
  });
  return NextResponse.json({ group: serialize(group) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const target = id ? await prisma.workGroup.findUnique({ where: { id }, select: { workspaceId: true } }) : null;
  if (!target) return NextResponse.json({ error: "행사를 찾을 수 없어요" }, { status: 404 });
  const access = await requireWorkspaceMember(target.workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "행사 이름을 입력해주세요" }, { status: 400 });
    data.name = name;
  }
  // 비우기(null·"")는 지우고, 잘못된 날짜는 거절한다 — 조용히 null 로 바꾸면 기존 날짜가 사라진다.
  if ("startDate" in body) {
    if (typeof body.startDate === "string" && body.startDate !== "" && !isValidDay(body.startDate)) {
      return NextResponse.json({ error: "시작일을 확인해주세요" }, { status: 400 });
    }
    data.startDate = dayOrNull(body.startDate);
  }
  if ("endDate" in body) {
    if (typeof body.endDate === "string" && body.endDate !== "" && !isValidDay(body.endDate)) {
      return NextResponse.json({ error: "종료일을 확인해주세요" }, { status: 400 });
    }
    data.endDate = dayOrNull(body.endDate);
  }
  if ("projectId" in body) {
    const projectId = await projectInWorkspace(body.projectId, target.workspaceId);
    if (projectId === "invalid") return NextResponse.json({ error: "프로젝트를 찾을 수 없어요" }, { status: 400 });
    data.projectId = projectId;
  }
  if (typeof body.archived === "boolean") data.archived = body.archived;
  if ("aliases" in body) data.aliases = aliasList(body.aliases);
  if (typeof body.sortOrder === "number") data.sortOrder = Math.round(body.sortOrder);
  const group = await prisma.workGroup.update({ where: { id }, data });
  return NextResponse.json({ group: serialize(group) });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const target = id ? await prisma.workGroup.findUnique({ where: { id }, select: { workspaceId: true } }) : null;
  if (!target) return NextResponse.json({ error: "행사를 찾을 수 없어요" }, { status: 404 });
  const access = await requireWorkspaceMember(target.workspaceId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  // 일지 줄은 남는다(행사만 비워져 "기타" 로 간다) — 지난 기록이 사라지면 안 된다.
  await prisma.workGroup.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
