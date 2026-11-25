import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { localize, normalizeCollectForm } from "@/lib/collect-form-config";
import { buildPublication, creatorColumns, normalizeCell, removePublishedCreator, reviewState, webUrl, type Cells, type CreatorAction, type HistoryEntry } from "./model";

export class CreatorError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export const missing = () => new CreatorError("찾을 수 없어요.", 404);
export const conflict = () => new CreatorError("다른 변경이 먼저 저장됐어요. 새로고침 후 다시 시도해 주세요.", 409);
export function errorResponse(error: unknown) {
  if (error instanceof CreatorError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025", "P2034"].includes(error.code)) {
    return errorResponse(conflict());
  }
  if (error instanceof SyntaxError) return errorResponse(new CreatorError("요청 형식을 확인해 주세요."));
  console.error("[creator]", error instanceof Error ? error.name : "unknown error");
  return NextResponse.json({ error: "처리하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
}

export const code = (prefix: string) => prefix + randomBytes(24).toString("base64url");
export const jsonHistory = <T>(raw: unknown): T[] => Array.isArray(raw) ? raw as T[] : [];

export async function getCreatorProject(projectId: string) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) throw new CreatorError("로그인이 필요해요.", 401);
  const project = await prisma.project.findFirst({
    where: {
      id: projectId, deletedAt: null,
      workspace: { deletedAt: null, members: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN", "MEMBER"] } } } },
    },
    select: {
      id: true, name: true, workspaceId: true,
      workspace: { select: { members: { where: { userId: user.id }, select: { role: true }, take: 1 } } },
    },
  });
  if (!project) throw missing();
  const { workspace, ...rest } = project;
  return { userId: user.id, project: rest, role: workspace.members[0]?.role ?? "MEMBER" };
}

export async function loadCreator(projectId: string) {
  const [sources, program] = await Promise.all([
    prisma.collectSource.findMany({
      where: { projectId, deletedAt: null, isActive: true },
      select: { id: true, name: true, mode: true, siteUrl: true, dedupKeyFields: true }, orderBy: { name: "asc" },
    }),
    prisma.creatorProgram.findUnique({
      where: { projectId },
      include: {
        applicationSource: { select: { formConfig: true } },
        _count: { select: { participants: true } },
        candidates: { orderBy: { createdAt: "asc" } },
        missions: { orderBy: { dueAt: "asc" } },
        participants: {
          where: { withdrawnAt: null },
          orderBy: { name: "asc" },
          include: { links: true, assignments: { include: { uploads: { select: { id: true, name: true } } } } },
        },
      },
    }),
  ]);
  if (!program) return { sources, program: null, applications: [], applicationLabels: {}, registrations: [] };
  const { applicationSource, ...programView } = program;
  const form = normalizeCollectForm(applicationSource?.formConfig);
  const applicationLabels = Object.fromEntries([...form.fields, ...form.branch.groups.flatMap((group) => group.fields)]
    .map(({ key, label }) => [key, localize(label, form.defaultLocale) || key]));
  const [applications, registrations] = await Promise.all([
    program.applicationSourceId ? prisma.collectRecord.findMany({
      where: { projectId, sourceId: program.applicationSourceId },
      select: { id: true, createdAt: true, utmId: true, data: true, emailNormalized: true, phoneE164: true },
      orderBy: { createdAt: "desc" },
    }) : [],
    program.registrationSourceId ? prisma.$queryRaw<{ utmId: string; day: string; count: number }[]>`
      SELECT r."utmId", to_char(r."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "CollectRecord" r
      JOIN "CreatorLink" l ON l.code = r."utmId"
      JOIN "CreatorParticipant" p ON p.id = l."participantId"
      WHERE r."projectId" = ${projectId} AND r."sourceId" = ${program.registrationSourceId} AND p."programId" = ${program.id} AND p."withdrawnAt" IS NULL
      GROUP BY r."utmId", day
    ` : [],
  ]);
  return { sources, program: programView, applications, applicationLabels, registrations };
}

export type CreatorData = Awaited<ReturnType<typeof loadCreator>>;
export type ContactEntry = { at: string; userId: string; channel: string };

function candidateCells(columns: ReturnType<typeof creatorColumns>, row: Cells): Cells {
  try {
    return Object.fromEntries(columns.filter(({ key }) => Object.hasOwn(row, key))
      .map((column) => [column.key, normalizeCell(column, row[column.key])]));
  } catch (error) {
    throw new CreatorError(error instanceof Error ? error.message : "셀 값을 확인해 주세요.");
  }
}

async function ensureLinks(tx: Prisma.TransactionClient, participantId: string, channels: Record<string, string>) {
  const entries = Object.entries(channels).filter(([, handle]) => Boolean(handle));
  if (entries.length) await tx.creatorLink.createMany({
    data: entries.map(([platform]) => ({ code: code("cr_"), participantId, platform })), skipDuplicates: true,
  });
}

export async function applyCreatorAction(auth: Awaited<ReturnType<typeof getCreatorProject>>, action: CreatorAction) {
  const { project, userId } = auth;
  if (action.action === "create") {
    await prisma.creatorProgram.upsert({
      where: { projectId: project.id }, create: { projectId: project.id, name: project.name }, update: {},
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const program = await tx.creatorProgram.findUnique({ where: { projectId: project.id } });
    if (!program) throw missing();
    const programId = program.id;

    switch (action.action) {
      case "createApplicationForm": {
        if (program.applicationSourceId) throw new CreatorError("이미 모집 폼이 연결돼 있어요.");
        const name = (program.name + " 크리에이터 모집").slice(0, 160);
        const formConfig = normalizeCollectForm({
          title: { ko: name }, defaultLocale: "ko",
          fields: [
            { id: "name", key: "name", label: { ko: "이름" }, type: "text", required: true, enabled: true },
            { id: "email", key: "email", label: { ko: "이메일" }, type: "email", required: true, enabled: true },
            { id: "social", key: "social", label: { ko: "주요 SNS 계정 링크" }, type: "text", required: true, enabled: true },
          ],
        });
        const source = await tx.collectSource.create({
          data: { name, projectId: project.id, workspaceId: project.workspaceId, mode: "builder", formConfig: formConfig as unknown as Prisma.InputJsonValue },
          select: { id: true },
        });
        const update = await tx.creatorProgram.updateMany({
          where: { id: programId, version: program.version, applicationSourceId: null },
          data: { applicationSourceId: source.id, version: { increment: 1 } },
        });
        if (!update.count) throw conflict();
        break;
      }
      case "settings": {
        const { applicationSourceId, registrationSourceId } = action;
        if (applicationSourceId && registrationSourceId === applicationSourceId) throw new CreatorError("크리에이터 모집과 방문객 등록에 서로 다른 폼을 선택해 주세요.");
        if (program.applicationSourceId !== applicationSourceId && await tx.creatorParticipant.count({ where: { programId } })) {
          throw new CreatorError("선발 기록이 있는 프로그램은 모집 폼을 변경할 수 없어요.");
        }
        const ids = [applicationSourceId, registrationSourceId].filter((value): value is string => Boolean(value));
        const sources = await tx.collectSource.findMany({ where: { id: { in: ids }, projectId: project.id, deletedAt: null, isActive: true } });
        if (ids.some((id) => !sources.some((source) => source.id === id) && id !== program.applicationSourceId && id !== program.registrationSourceId)) throw missing();
        if (sources.find(({ id }) => id === applicationSourceId)?.mode === "capture") throw new CreatorError("크리에이터 모집에는 등록 폼 빌더를 선택해 주세요.");
        const registration = sources.find(({ id }) => id === registrationSourceId);
        if (registration?.mode === "capture" && !webUrl.safeParse(registration.siteUrl).success) throw new CreatorError("외부 등록 폼에 사이트 주소를 설정해 주세요.");
        const updated = await tx.creatorProgram.updateMany({
          where: { id: programId, version: program.version },
          data: { name: action.name, applicationSourceId, registrationSourceId, utm: action.utm, version: { increment: 1 } },
        });
        if (!updated.count) throw conflict();
        break;
      }
      case "columns": {
        if (new Set(action.columns.map(({ key }) => key)).size !== action.columns.length) throw new CreatorError("같은 열이 두 번 들어 있어요.");
        const columns = creatorColumns(action.columns);
        if (columns.some((column) => column.type === "select" && (!column.options?.length || new Set(column.options).size !== column.options.length))) {
          throw new CreatorError("선택형 열의 선택지를 확인해 주세요.");
        }
        if (new Set(columns.map(({ label }) => label)).size !== columns.length) throw new CreatorError("열 이름을 서로 다르게 입력해 주세요.");
        const keys = new Set(columns.map(({ key }) => key));
        const removed = creatorColumns(program.columns).map(({ key }) => key).filter((key) => !keys.has(key));
        await tx.creatorProgram.update({ where: { id: programId }, data: { columns, version: { increment: 1 } } });
        if (removed.length) {
          await tx.$executeRaw`
            UPDATE "CreatorCandidate" SET cells = cells - ${removed}::text[]
            WHERE "programId" = ${programId}
          `;
        }
        break;
      }
      case "candidateAdd": {
        const columns = creatorColumns(program.columns);
        await tx.creatorCandidate.createMany({
          data: action.rows.map((row) => ({ programId, invite: code("ca_"), cells: candidateCells(columns, row) })),
        });
        break;
      }
      case "candidateEdit": {
        const column = creatorColumns(program.columns).find(({ key }) => key === action.key);
        if (!column) throw missing();
        const value = candidateCells([column], { [column.key]: action.value })[column.key];
        const count = await tx.$executeRaw`
          UPDATE "CreatorCandidate"
          SET cells = jsonb_set(cells, ARRAY[${column.key}]::text[], ${JSON.stringify(value)}::jsonb, true)
          WHERE id = ${action.id} AND "programId" = ${programId}
        `;
        if (!count) throw missing();
        break;
      }
      case "candidateDelete": {
        const result = await tx.creatorCandidate.deleteMany({ where: { id: action.id, programId } });
        if (!result.count) throw missing();
        break;
      }
      case "select": {
        if (!program.applicationSourceId) throw new CreatorError("모집 폼을 연결해 주세요.");
        const application = await tx.collectRecord.findFirst({
          where: { id: action.applicationId, projectId: project.id, sourceId: program.applicationSourceId },
        });
        if (!application) throw missing();
        const locked = await tx.creatorProgram.updateMany({
          where: { id: programId, applicationSourceId: application.sourceId }, data: { version: { increment: 1 } },
        });
        if (!locked.count) throw conflict();
        const candidate = application.utmId?.startsWith("ca_") ? await tx.creatorCandidate.findFirst({
          where: { invite: application.utmId, programId }, select: { cells: true },
        }) : null;
        const ownerCell = (candidate?.cells as Cells | undefined)?.owner;
        const owner = typeof ownerCell === "string" ? ownerCell.slice(0, 160) : "";
        const where = { programId_applicationId: { programId, applicationId: action.applicationId } };
        const previous = await tx.creatorParticipant.findUnique({ where });
        const participant = await tx.creatorParticipant.upsert({
          where,
          create: { programId, applicationId: action.applicationId, token: code("cp_"), name: action.name, channels: action.channels, owner },
          update: previous?.withdrawnAt ? {
            withdrawnAt: null,
            name: action.name,
            channels: { ...(previous.channels as Record<string, string>), ...action.channels },
          } : {},
        });
        await ensureLinks(tx, participant.id, participant.channels as Record<string, string>);
        const missions = await tx.creatorMission.findMany({ where: { programId }, select: { id: true, draft: true } });
        await tx.creatorAssignment.createMany({
          data: missions.map((mission) => ({ participantId: participant.id, missionId: mission.id, stage: mission.draft ? "draft" : "final" })),
          skipDuplicates: true,
        });
        break;
      }
      case "unselect": {
        const locked = await tx.creatorProgram.update({
          where: { id: programId }, data: { version: { increment: 1 } },
          select: { roster: true, awards: true, applicationSourceId: true },
        });
        const person = await tx.creatorParticipant.findFirst({
          where: { id: action.id, programId, withdrawnAt: null, application: { sourceId: locked.applicationSourceId ?? "", projectId: project.id } },
          select: { id: true, name: true, profile: true, award: true },
        });
        if (!person) throw missing();
        const result = await tx.creatorParticipant.updateMany({
          where: { id: person.id, token: action.token, withdrawnAt: null },
          data: { withdrawnAt: new Date(), confirmed: false, token: code("cp_") },
        });
        if (!result.count) throw conflict();
        const roster = removePublishedCreator(locked.roster, person);
        const awards = removePublishedCreator(locked.awards, person);
        if (roster || awards) await tx.creatorProgram.update({
          where: { id: programId }, data: { roster, awards },
        });
        break;
      }
      case "participant": {
        const result = await tx.creatorParticipant.updateMany({ where: { id: action.id, programId, withdrawnAt: null }, data: action.patch });
        if (!result.count) throw missing();
        if (action.patch.channels) await ensureLinks(tx, action.id, action.patch.channels);
        break;
      }
      case "rotateAccess": {
        const result = await tx.creatorParticipant.updateMany({ where: { id: action.id, programId, withdrawnAt: null }, data: { token: code("cp_") } });
        if (!result.count) throw missing();
        break;
      }
      case "mission": {
        await tx.creatorProgram.update({ where: { id: programId }, data: { version: { increment: 1 } } });
        const mission = action.id
          ? await tx.creatorMission.update({ where: { id: action.id, programId }, data: action.mission })
          : await tx.creatorMission.create({ data: { ...action.mission, programId } });
        if (action.id) {
          await tx.creatorAssignment.updateMany({
            where: { missionId: mission.id, status: "todo", history: { equals: [] }, stage: mission.draft ? "final" : "draft" },
            data: { stage: mission.draft ? "draft" : "final" },
          });
          await tx.creatorAssignment.updateMany({
            where: { missionId: mission.id, status: { in: ["todo", "revision"] } }, data: { version: { increment: 1 } },
          });
          break;
        }
        const participants = await tx.creatorParticipant.findMany({ where: { programId, withdrawnAt: null }, select: { id: true } });
        await tx.creatorAssignment.createMany({
          data: participants.map(({ id }) => ({ participantId: id, missionId: mission.id, stage: mission.draft ? "draft" : "final" })),
          skipDuplicates: true,
        });
        break;
      }
      case "contact": {
        const contacts: ContactEntry[] = [{ at: new Date().toISOString(), userId, channel: action.channel }];
        const count = await tx.$executeRaw`
          UPDATE "CreatorAssignment" a
          SET contacts = a.contacts || ${JSON.stringify(contacts)}::jsonb
          FROM "CreatorMission" m, "CreatorParticipant" p
          WHERE a.id = ${action.id} AND a."missionId" = m.id AND a."participantId" = p.id
            AND m."programId" = ${programId} AND p."programId" = ${programId} AND p."withdrawnAt" IS NULL
        `;
        if (!count) throw missing();
        break;
      }
      case "review": {
        const assignment = await tx.creatorAssignment.findFirst({
          where: { id: action.id, mission: { programId }, participant: { programId, withdrawnAt: null } },
        });
        if (!assignment) throw missing();
        const at = new Date().toISOString();
        const state = reviewState(assignment, action.approved);
        if (!state || assignment.version !== action.version) throw conflict();
        if (!action.approved && !action.feedback.trim()) throw new CreatorError("수정할 내용을 입력해 주세요.");
        const result = await tx.creatorAssignment.updateMany({
          where: { id: assignment.id, version: assignment.version, participant: { withdrawnAt: null } },
          data: { ...state, version: { increment: 1 }, history: [
            ...jsonHistory<HistoryEntry>(assignment.history),
            { kind: action.approved ? "approved" : "revision", stage: assignment.stage, at, feedback: action.feedback.trim() },
          ] },
        });
        if (!result.count) throw conflict();
        break;
      }
      case "publish": {
        await tx.creatorProgram.update({ where: { id: programId }, data: { version: { increment: 1 } } });
        const people = action.theme ? await tx.creatorParticipant.findMany({
          where: { programId, withdrawnAt: null }, select: { id: true, name: true, award: true, awardOrder: true, profile: true },
        }) : [];
        const snapshot = action.theme ? buildPublication(action.kind, action.theme, people) : null;
        if (snapshot && !snapshot.entries.length) throw new CreatorError("공개할 크리에이터를 먼저 추가해 주세요.");
        await tx.creatorProgram.update({ where: { id: programId }, data: { [action.kind]: snapshot ?? Prisma.DbNull } });
        break;
      }
    }
  });
}

export function isPreviewUrl(url: URL) {
  return url.searchParams.has("preview");
}
