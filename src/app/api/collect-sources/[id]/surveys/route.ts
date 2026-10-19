/**
 * 사전등록 폼의 만족도 조사 — GET 목록(응답 수 포함) · POST { name } 새 조사
 * 새 조사는 빈 문항으로 시작한다(유형 기준은 등록 폼의 유형 분기 항목). 공개 주소 토큰은 짧은 무작위.
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { emptySurveyConfig } from "@/lib/survey-config";

async function authorize(id: string) {
  const source = await prisma.collectSource.findUnique({ where: { id }, select: { id: true, workspaceId: true, projectId: true, name: true, formConfig: true, deletedAt: true } });
  if (!source || source.deletedAt) return { error: NextResponse.json({ error: "폼을 찾을 수 없어요" }, { status: 404 }) } as const;
  const access = await requireWorkspaceMember(source.workspaceId);
  if ("error" in access) return { error: NextResponse.json({ error: access.error }, { status: access.status }) } as const;
  return { source } as const;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;
  const surveys = await prisma.survey.findMany({
    where: { sourceId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, token: true, status: true, createdAt: true, _count: { select: { responses: true } } },
  });
  return NextResponse.json({ surveys: surveys.map((s) => ({ ...s, responses: s._count.responses, _count: undefined })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : `${auth.source.name} 만족도 조사`;
  const form = normalizeCollectForm(auth.source.formConfig);
  const config = emptySurveyConfig({ title: name, audienceFieldKey: form.branch.enabled ? form.branch.fieldKey : "", locale: form.defaultLocale || "en" });
  const survey = await prisma.survey.create({
    data: {
      sourceId: id, projectId: auth.source.projectId, workspaceId: auth.source.workspaceId, name,
      token: randomBytes(5).toString("base64url").replace(/[^A-Za-z0-9]/g, "x"),
      config: config as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, name: true, token: true, status: true, createdAt: true },
  });
  return NextResponse.json({ survey: { ...survey, responses: 0 } }, { status: 201 });
}
