import "server-only";
/** 만족도 조사 어드민 API 권한 — 조사가 속한 워크스페이스 멤버만. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMember } from "@/lib/workspace-access";

export async function authorizeSurvey(surveyId: string) {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    select: { id: true, name: true, token: true, status: true, config: true, sourceId: true, workspaceId: true, updatedAt: true },
  });
  if (!survey) return { error: NextResponse.json({ error: "조사를 찾을 수 없어요" }, { status: 404 }) } as const;
  const access = await requireWorkspaceMember(survey.workspaceId);
  if ("error" in access) return { error: NextResponse.json({ error: access.error }, { status: access.status }) } as const;
  return { survey, access } as const;
}
