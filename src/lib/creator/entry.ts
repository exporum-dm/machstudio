import type { Prisma } from "@/generated/prisma";

export const creatorEntryCookie = "mach-creator-activity";
export const creatorEntryPath = (programId: string) => "/creator-entry/" + programId;

export function creatorEmailMatch(programId: string, email: string): Prisma.CreatorParticipantWhereInput {
  return {
    programId, withdrawnAt: null,
    OR: [{ accessEmail: email }, { accessEmail: null, application: { emailNormalized: email } }],
  };
}
