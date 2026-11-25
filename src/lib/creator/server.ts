import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { localize, normalizeCollectForm } from "@/lib/collect-form-config";
import { creatorEmailMatch } from "./entry";
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

/**
 * 회차 하나를 열 권한 확인. 프로그램 → 프로젝트 → 워크스페이스 멤버십까지 **서버에서** 거슬러 본다.
 * 화면이 보낸 projectId 를 믿지 않고 URL 의 회차가 실제로 어느 전시 소속인지로 판단한다.
 */
export async function getCreatorProgram(programId: string) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) throw new CreatorError("로그인이 필요해요.", 401);
  const program = await prisma.creatorProgram.findFirst({
    where: {
      id: programId, deletedAt: null,
      project: {
        deletedAt: null,
        workspace: { deletedAt: null, members: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN", "MEMBER"] } } } },
      },
    },
    select: {
      id: true, name: true, version: true,
      project: {
        select: {
          id: true, name: true, workspaceId: true,
          workspace: { select: { members: { where: { userId: user.id }, select: { role: true }, take: 1 } } },
        },
      },
    },
  });
  if (!program) throw missing();
  const { workspace, ...project } = program.project;
  return { userId: user.id, project, role: workspace.members[0]?.role ?? "MEMBER", programId: program.id };
}

/** 한 전시의 회차 목록 — 등록 메뉴가 폼 목록을 보여 주는 자리와 같다. */
export async function listCreatorPrograms(projectId: string) {
  const programs = await prisma.creatorProgram.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, createdAt: true, applicationSourceId: true, registrationSourceId: true,
      _count: { select: { candidates: true, missions: { where: { archivedAt: null } } } },
    },
  });
  const counts = await prisma.creatorParticipant.groupBy({
    by: ["programId"],
    where: { programId: { in: programs.map(({ id }) => id) }, withdrawnAt: null },
    _count: { _all: true },
  });
  const people = new Map(counts.map((row) => [row.programId, row._count._all]));
  return programs.map((program) => ({ ...program, participants: people.get(program.id) ?? 0 }));
}

function creatorApplicationLabels(config: unknown) {
  const form = normalizeCollectForm(config);
  return Object.fromEntries([...form.fields, ...form.branch.groups.flatMap((group) => group.fields)]
    .filter(({ key }) => !key.startsWith("__"))
    .map(({ key, label }) => [key, localize(label, form.defaultLocale) || key]));
}

export async function loadCreator(projectId: string, programId: string) {
  const [sources, program] = await Promise.all([
    prisma.collectSource.findMany({
      where: { projectId, deletedAt: null, isActive: true },
      select: { id: true, name: true, mode: true, siteUrl: true, dedupKeyFields: true }, orderBy: { name: "asc" },
    }),
    prisma.creatorProgram.findFirst({
      where: { id: programId, deletedAt: null },
      include: {
        applicationSource: { select: { formConfig: true } },
        _count: { select: { participants: true } },
        candidates: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
        missions: { orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }] },
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
  const applicationLabels = creatorApplicationLabels(applicationSource?.formConfig);
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

export async function applyCreatorAction(auth: Awaited<ReturnType<typeof getCreatorProgram>>, action: CreatorAction) {
  const { project, userId, programId: scoped } = auth;

  await prisma.$transaction(async (tx) => {
    const program = await tx.creatorProgram.findFirst({ where: { id: scoped, projectId: project.id, deletedAt: null } });
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
        // 새 행은 표 맨 아래로 — 끌어서 정해 둔 순서 위로 끼어들지 않게 한다.
        const last = await tx.creatorCandidate.aggregate({ where: { programId }, _max: { position: true } });
        const start = (last._max.position ?? 0) + 1;
        await tx.creatorCandidate.createMany({
          data: action.rows.map((row, index) => ({
            programId, invite: code("ca_"), position: start + index, cells: candidateCells(columns, row),
          })),
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
      case "gridLayout": {
        if (new Set(action.layout.map(({ key }) => key)).size !== action.layout.length) throw new CreatorError("같은 열이 두 번 들어 있어요.");
        // 화면마다 따로 저장한다. 다른 화면 배치를 덮어쓰지 않도록 기존 값 위에 얹는다.
        const stored = program.tableLayout && typeof program.tableLayout === "object" && !Array.isArray(program.tableLayout)
          ? program.tableLayout as Record<string, unknown> : {};
        await tx.creatorProgram.update({
          where: { id: programId },
          data: { tableLayout: { ...stored, [action.table]: action.layout } as Prisma.InputJsonValue },
        });
        break;
      }
      case "candidateReorder": {
        // 화면이 보낸 순서대로 자리를 매긴다. 이 회차의 행만 — 남의 회차 id 가 섞여 와도 건너뛴다.
        const mine = await tx.creatorCandidate.findMany({ where: { programId, id: { in: action.ids } }, select: { id: true } });
        const allowed = new Set(mine.map(({ id }) => id));
        const ordered = action.ids.filter((id) => allowed.has(id));
        if (!ordered.length) throw missing();
        await Promise.all(ordered.map((id, index) =>
          tx.creatorCandidate.update({ where: { id }, data: { position: index + 1 } })));
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
        const missions = await tx.creatorMission.findMany({ where: { programId, archivedAt: null }, select: { id: true, draft: true } });
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
        if (action.patch.accessEmail) {
          await tx.creatorProgram.update({ where: { id: programId }, data: { version: { increment: 1 } } });
          const duplicate = await tx.creatorParticipant.findFirst({
            where: { ...creatorEmailMatch(programId, action.patch.accessEmail), id: { not: action.id } },
            select: { id: true },
          });
          if (duplicate) throw new CreatorError("같은 이메일을 쓰는 선발자가 있어요. 다른 이메일을 지정해 주세요.");
        }
        const where = { id: action.id, programId, withdrawnAt: null };
        const current = action.patch.accessEmail === undefined ? null : await tx.creatorParticipant.findFirst({
          where, select: { accessEmail: true },
        });
        const result = await tx.creatorParticipant.updateMany({
          where,
          data: { ...action.patch, ...(current && current.accessEmail !== action.patch.accessEmail ? { token: code("cp_") } : {}) },
        });
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
          ? await tx.creatorMission.update({ where: { id: action.id, programId, archivedAt: null }, data: action.mission })
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
      case "archiveMission": {
        await tx.creatorProgram.update({ where: { id: programId }, data: { version: { increment: 1 } } });
        const result = await tx.creatorMission.updateMany({
          where: { id: action.id, programId, archivedAt: action.archived ? null : { not: null } },
          data: { archivedAt: action.archived ? new Date() : null },
        });
        if (!result.count) throw missing();
        if (!action.archived) {
          const active = await tx.creatorParticipant.findMany({ where: { programId, withdrawnAt: null }, select: { id: true } });
          const mission = await tx.creatorMission.findUniqueOrThrow({ where: { id: action.id }, select: { draft: true } });
          await tx.creatorAssignment.createMany({
            data: active.map(({ id }) => ({ participantId: id, missionId: action.id, stage: mission.draft ? "draft" : "final" })),
            skipDuplicates: true,
          });
        }
        break;
      }
      case "contact": {
        const contacts: ContactEntry[] = [{ at: new Date().toISOString(), userId, channel: action.channel }];
        const count = await tx.$executeRaw`
          UPDATE "CreatorAssignment" a
          SET contacts = a.contacts || ${JSON.stringify(contacts)}::jsonb
          FROM "CreatorMission" m, "CreatorParticipant" p
          WHERE a.id = ${action.id} AND a."missionId" = m.id AND a."participantId" = p.id
            AND m."programId" = ${programId} AND m."archivedAt" IS NULL AND m.published AND p."programId" = ${programId} AND p."withdrawnAt" IS NULL
        `;
        if (!count) throw missing();
        break;
      }
      case "review": {
        const assignment = await tx.creatorAssignment.findFirst({
          where: { id: action.id, mission: { programId, archivedAt: null, published: true }, participant: { programId, withdrawnAt: null } },
        });
        if (!assignment) throw missing();
        const at = new Date().toISOString();
        const state = reviewState(assignment, action.approved);
        if (!state || assignment.version !== action.version) throw conflict();
        if (!action.approved && !action.feedback.trim()) throw new CreatorError("수정할 내용을 입력해 주세요.");
        const result = await tx.creatorAssignment.updateMany({
          where: { id: assignment.id, version: assignment.version, mission: { archivedAt: null, published: true }, participant: { withdrawnAt: null } },
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
          where: { programId, withdrawnAt: null },
          select: { id: true, name: true, award: true, awardSelected: true, awardOrder: true, profile: true, applicationId: true,
            application: { select: { sourceId: true, projectId: true, data: true } } },
        }) : [];
        const source = action.theme && program.applicationSourceId ? await tx.collectSource.findFirst({
          where: { id: program.applicationSourceId, projectId: project.id, deletedAt: null },
          select: { formConfig: true },
        }) : null;
        const labels = source ? creatorApplicationLabels(source.formConfig) : {};
        const scopedPeople = people.map(({ application, ...person }) => ({
          ...person, applicationData: application && application.sourceId === program.applicationSourceId &&
            application.projectId === project.id ? application.data : undefined,
        }));
        const snapshot = action.theme ? buildPublication(action.kind, action.theme, scopedPeople, action.applicationFields, labels) : null;
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

/**
 * 새 회차를 연다. `copyFrom` 을 주면 **짜 둔 틀만** 가져온다 — 표 열 구성·UTM 규칙·미션·발표 색.
 * 후보·선발자·제출 이력은 새 해의 것이므로 비운 채 시작한다.
 *
 * 모집 폼과 등록 폼 연결은 **일부러 가져오지 않는다.** 그대로 복사하면 올해 후보가 작년 폼으로
 * 접수되고, 작년 등록 실적에 올해 클릭이 섞인다. 새 회차에서 폼을 새로 고르게 한다.
 */
export async function createCreatorProgram(
  auth: Awaited<ReturnType<typeof getCreatorProject>>,
  input: { name: string; copyFrom?: string | null },
) {
  const { project } = auth;
  const source = input.copyFrom
    ? await prisma.creatorProgram.findFirst({
        where: { id: input.copyFrom, projectId: project.id, deletedAt: null },
        include: { missions: { where: { archivedAt: null }, orderBy: { dueAt: "asc" } } },
      })
    : null;
  if (input.copyFrom && !source) throw missing();

  return prisma.$transaction(async (tx) => {
    const created = await tx.creatorProgram.create({
      data: {
        projectId: project.id,
        name: input.name,
        columns: (source?.columns ?? []) as Prisma.InputJsonValue,
        utm: (source?.utm ?? {}) as Prisma.InputJsonValue,
        // 발표 화면은 색만 물려받는다 — 사람 목록은 새 회차에서 다시 쌓인다.
        roster: Prisma.DbNull,
        awards: Prisma.DbNull,
      },
      select: { id: true, name: true },
    });
    if (source?.missions.length) {
      await tx.creatorMission.createMany({
        data: source.missions.map((mission) => ({
          programId: created.id, title: mission.title, guide: mission.guide,
          startsAt: mission.startsAt, dueAt: mission.dueAt, platforms: mission.platforms,
          driveProof: mission.driveProof, published: mission.published,
          linkCount: mission.linkCount, proof: mission.proof, draft: mission.draft,
        })),
      });
    }
    return { ...created, copiedMissions: source?.missions.length ?? 0 };
  });
}

/** 회차를 목록에서 감춘다. 후보·선발자·제출 이력은 남긴다 — 지난 회차 실적을 지워 버리지 않기 위해서다. */
export async function deleteCreatorProgram(auth: Awaited<ReturnType<typeof getCreatorProgram>>) {
  const result = await prisma.creatorProgram.updateMany({
    where: { id: auth.programId, projectId: auth.project.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!result.count) throw missing();
}
