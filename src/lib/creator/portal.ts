import { getPublicAppOrigin } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimitAsync } from "@/lib/ratelimit";
import type { Prisma } from "@/generated/prisma";
import { code, conflict, CreatorError, jsonHistory, missing } from "./server";
import { creatorPromotionUrl, missionSubmissionFields, validateMissionSubmission, type HistoryEntry, type submissionSchema } from "./model";
import type { z } from "zod";

export const PROOF_BUCKET = "creator-proof";
export const MAX_PROOF_SIZE = 50 * 1024 * 1024;
export const proofTypes = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm", "application/pdf"];

const activeProgram = { deletedAt: null, project: { deletedAt: null, workspace: { deletedAt: null } } };
const visibleMission = { archivedAt: null, published: true };
const assignmentSelect = {
  id: true, stage: true, status: true, version: true, history: true,
  mission: { select: { title: true, guide: true, startsAt: true, dueAt: true, draft: true, platforms: true, linkCount: true, proof: true, driveProof: true } },
  uploads: { select: { id: true, name: true } },
} satisfies Prisma.CreatorAssignmentSelect;

export async function loadPortal(token: string, programId?: string) {
  if (!/^cp_[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const person = await prisma.creatorParticipant.findFirst({
    where: { token, programId, withdrawnAt: null, program: activeProgram },
    select: {
      name: true, confirmed: true, feeStatus: true, paidOn: true, channels: true, driveFolder: true,
      program: { select: { name: true, utm: true, registrationSource: { select: { isActive: true, deletedAt: true } } } },
      links: { select: { code: true, platform: true } },
      assignments: { where: { mission: visibleMission }, select: assignmentSelect, orderBy: { mission: { dueAt: "asc" } } },
    },
  });
  if (!person) return null;
  const { program, channels, links, ...view } = person;
  const origin = getPublicAppOrigin();
  const form = program.registrationSource;
  const promotionLinks = links.flatMap((link) => {
    const handle = (channels as Record<string, string>)[link.platform];
    if (!handle) return [];
    const legacyUrl = origin && form?.isActive && !form.deletedAt ? origin + "/creator-go/" + link.code : "";
    const url = creatorPromotionUrl(program.utm, { ...link, creator: person.name, program: program.name, handle }, legacyUrl);
    return url ? [{ platform: link.platform, url }] : [];
  });
  return { ...view, program: { name: program.name }, promotionLinks, serverNow: Date.now() };
}

export type PortalData = NonNullable<Awaited<ReturnType<typeof loadPortal>>>;

function secureAssignment(token: string, assignmentId: string) {
  return prisma.creatorAssignment.findFirst({
    where: { id: assignmentId, mission: visibleMission, participant: { token, confirmed: true, withdrawnAt: null, program: activeProgram } },
    include: { mission: true, participant: { select: { driveFolder: true } } },
  });
}

function canSubmit(assignment: { stage: string; status: string; mission: { startsAt: Date | null } }) {
  if (!["todo", "revision"].includes(assignment.status)) throw conflict();
  if (assignment.stage === "final" && assignment.mission.startsAt && assignment.mission.startsAt > new Date()) {
    throw new CreatorError("게시 기간이 시작되면 최종 제출할 수 있어요.");
  }
}

export async function confirmParticipation(token: string) {
  const updated = await prisma.creatorParticipant.updateMany({
    where: { token, withdrawnAt: null, program: activeProgram }, data: { confirmed: true },
  });
  if (!updated.count) throw missing();
}

export async function submitCreatorWork(token: string, assignmentId: string, input: z.infer<typeof submissionSchema>) {
  const assignment = await secureAssignment(token, assignmentId);
  if (!assignment) throw missing();
  canSubmit(assignment);
  if (assignment.version !== input.version) throw conflict();
  const mission = assignment.mission;
  const links = [...new Set(input.links)];
  const files = [...new Set(input.files)];
  if (!mission.platforms.includes(input.platform)) throw new CreatorError("게시 채널을 확인해 주세요.");
  if (input.driveUrl && !assignment.participant?.driveFolder) throw new CreatorError("운영자에게 원본 업로드 폴더를 요청해 주세요.");
  const errors = validateMissionSubmission(missionSubmissionFields(assignment.stage, mission, assignment.history), input);
  const invalid = Object.values(errors)[0];
  if (invalid) throw new CreatorError(invalid);
  if (files.length) {
    const uploads = await prisma.creatorUpload.findMany({ where: { id: { in: files }, assignmentId } });
    if (uploads.length !== files.length) throw missing();
    const storage = createAdminClient().storage.from(PROOF_BUCKET);
    const verified = await Promise.all(uploads.map(({ path }) => storage.info(path)));
    if (verified.some(({ data, error }) => error || !data || !proofTypes.includes(data.contentType ?? "") || !data.size || data.size > MAX_PROOF_SIZE)) {
      throw new CreatorError("첨부를 확인하지 못했어요. 파일 형식과 크기를 확인한 후 다시 올려 주세요.");
    }
  }
  const update = await prisma.creatorAssignment.updateMany({
    where: { id: assignment.id, version: assignment.version, mission: visibleMission, participant: { token, confirmed: true, withdrawnAt: null, program: activeProgram } },
    data: { status: "review", version: { increment: 1 }, history: [
      ...jsonHistory<HistoryEntry>(assignment.history),
      { kind: "submission", at: new Date().toISOString(), stage: assignment.stage, platform: input.platform, links, driveUrl: input.driveUrl, files, note: input.note },
    ] },
  });
  if (!update.count) throw conflict();
}

export async function withdrawCreatorWork(token: string, assignmentId: string, version: number) {
  const assignment = await secureAssignment(token, assignmentId);
  if (!assignment) throw missing();
  if (assignment.status !== "review" || assignment.version !== version) throw conflict();
  const result = await prisma.creatorAssignment.updateMany({
    where: { id: assignmentId, version, status: "review", mission: visibleMission,
      participant: { token, confirmed: true, withdrawnAt: null, program: activeProgram } },
    data: { status: "todo", version: { increment: 1 }, history: [
      ...jsonHistory<HistoryEntry>(assignment.history),
      { kind: "withdrawn", stage: assignment.stage, at: new Date().toISOString(), feedback: "" },
    ] },
  });
  if (!result.count) throw conflict();
}

export async function signCreatorUpload(token: string, assignmentId: string, input: { name: string; size: number; type: string }) {
  const assignment = await secureAssignment(token, assignmentId);
  if (!assignment) throw missing();
  canSubmit(assignment);
  if (missionSubmissionFields(assignment.stage, assignment.mission, assignment.history).proof === "off") throw missing();
  if (!proofTypes.includes(input.type) || input.size < 1 || input.size > MAX_PROOF_SIZE) throw new CreatorError("지원하는 50MB 이하 파일을 선택해 주세요.");
  const limit = await rateLimitAsync("creator-upload:" + assignment.id, { limit: 15, windowMs: 600000 });
  if (!limit.allowed) throw new CreatorError("잠시 후에 파일을 다시 올려 주세요.", 429);
  const path = assignment.id + "/" + code("");
  const { data, error } = await createAdminClient().storage.from(PROOF_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new CreatorError("파일 업로드를 준비하지 못했어요.", 503);
  const upload = await prisma.creatorUpload.create({ data: { assignmentId, path, name: input.name } });
  return { id: upload.id, path, token: data.token };
}

export async function downloadProof(where: Prisma.CreatorUploadWhereInput) {
  const proof = await prisma.creatorUpload.findFirst({
    where, select: { name: true, path: true, assignment: { select: { history: true } }, id: true },
  });
  if (!proof || !jsonHistory<HistoryEntry>(proof.assignment.history).some((entry) => entry.kind === "submission" && entry.files.includes(proof.id))) throw missing();
  const { data, error } = await createAdminClient().storage.from(PROOF_BUCKET).createSignedUrl(proof.path, 60, { download: proof.name });
  if (error || !data) throw missing();
  return data.signedUrl;
}
