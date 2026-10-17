import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { normalizeCompetitionConfig } from "@/lib/competition-config";
import { isCompetitionPhaseOverride } from "@/lib/competition-status";
import { normalizeShowConfig } from "@/lib/competition-show";

/** 워크스페이스 멤버면 접근 가능 — 웨비나 라우트와 같은 기준. */
async function authorize(competitionId: string, userId: string) {
  const competition = await prisma.competition.findUnique({ where: { id: competitionId } });
  if (!competition) return null;
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: competition.workspaceId } },
  });
  return membership ? competition : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const competition = await authorize(id, user.id);
  if (!competition) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const [rounds, entryCount] = await Promise.all([
    prisma.competitionRound.findMany({ where: { competitionId: id }, orderBy: { sortOrder: "asc" } }),
    prisma.competitionEntry.count({ where: { competitionId: id } }),
  ]);

  return NextResponse.json({
    competition: {
      ...competition,
      // 어드민 화면은 꺼 둔 블록·항목도 봐야 편집할 수 있다.
      config: normalizeCompetitionConfig(competition.config, { includeDisabled: true }),
    },
    rounds,
    entryCount,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const competition = await authorize(id, user.id);
  if (!competition) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json();
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "대회 이름을 입력해주세요" }, { status: 400 });
    data.name = name;
  }
  if (body.description !== undefined) {
    data.description =
      typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  }
  if (typeof body.slug === "string") {
    const slug = body.slug.trim();
    if (!/^[a-z0-9-]{2,}$/.test(slug) || /^-+$/.test(slug)) {
      return NextResponse.json({ error: "주소(슬러그)가 올바르지 않아요" }, { status: 400 });
    }
    if (slug !== competition.slug) {
      const dup = await prisma.competition.findUnique({ where: { slug } });
      if (dup) return NextResponse.json({ error: "이미 사용 중인 주소예요" }, { status: 409 });
      data.slug = slug;
    }
  }

  // 접수 기간 — 순서를 검증한다. 마감이 시작보다 앞서면 단계 판정이 영구히 '접수 마감'이 된다.
  const openAt = body.recruitOpenAt === null ? null : body.recruitOpenAt ? new Date(body.recruitOpenAt) : undefined;
  const closeAt = body.recruitCloseAt === null ? null : body.recruitCloseAt ? new Date(body.recruitCloseAt) : undefined;
  if (openAt !== undefined) {
    if (openAt && Number.isNaN(openAt.getTime())) return NextResponse.json({ error: "접수 시작 일시가 올바르지 않아요" }, { status: 400 });
    data.recruitOpenAt = openAt;
  }
  if (closeAt !== undefined) {
    if (closeAt && Number.isNaN(closeAt.getTime())) return NextResponse.json({ error: "접수 마감 일시가 올바르지 않아요" }, { status: 400 });
    data.recruitCloseAt = closeAt;
  }
  const finalOpen = (openAt !== undefined ? openAt : competition.recruitOpenAt) ?? null;
  const finalClose = (closeAt !== undefined ? closeAt : competition.recruitCloseAt) ?? null;
  if (finalOpen && finalClose && finalOpen.getTime() > finalClose.getTime()) {
    return NextResponse.json({ error: "접수 마감이 시작보다 빠를 수 없어요" }, { status: 400 });
  }

  if (body.phaseOverride !== undefined) {
    if (body.phaseOverride === null) data.phaseOverride = null;
    else if (isCompetitionPhaseOverride(body.phaseOverride)) data.phaseOverride = body.phaseOverride;
    else return NextResponse.json({ error: "알 수 없는 단계예요" }, { status: 400 });
  }

  if (body.theme !== undefined && body.theme && typeof body.theme === "object") {
    data.theme = body.theme;
  }
  if (body.config !== undefined) {
    // 저장 시에도 정규화한다 — 화면이 보낸 값이 부분적이어도 완전한 형태로 굳는다.
    data.config = JSON.parse(JSON.stringify(normalizeCompetitionConfig(body.config, { includeDisabled: true })));
  }
  if (typeof body.maxEntriesPerApplicant === "number" && body.maxEntriesPerApplicant >= 1) {
    data.maxEntriesPerApplicant = Math.floor(body.maxEntriesPerApplicant);
  }
  if (body.rotatePreviewToken === true) {
    data.previewToken = randomBytes(16).toString("base64url");
  }
  // 발표 화면 링크. 무대 노트북에 미리 열어 두는 링크라, 새면 결과가 새는 것과 같다 —
  // 재발급으로 옛 링크를 즉시 죽일 수 있어야 한다.
  if (body.rotateShowToken === true) {
    data.showToken = randomBytes(16).toString("base64url");
  }
  if (body.showConfig !== undefined) {
    data.showConfig = JSON.parse(JSON.stringify(normalizeShowConfig(body.showConfig)));
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "변경할 내용이 없어요" }, { status: 400 });

  const updated = await prisma.competition.update({ where: { id }, data });

  // 대표 이름 항목을 바꾸면 이미 들어온 참가작도 그 항목 값으로 다시 쓴다 — 안 그러면 새 신청만 바뀌고
  // 기존 참가작은 투표·진출·결과 화면에 예전 이름(예: 인스타 ID)으로 남는다. 값이 빈 참가작은 그대로.
  if (body.config !== undefined) {
    const prevKey = normalizeCompetitionConfig(competition.config, { includeDisabled: true }).form.displayNameKey;
    const nextKey = normalizeCompetitionConfig(updated.config, { includeDisabled: true }).form.displayNameKey;
    if (prevKey !== nextKey) {
      await prisma.$executeRaw`
        UPDATE "CompetitionEntry"
        SET "title" = btrim("data"->>${nextKey}), "updatedAt" = now()
        WHERE "competitionId" = ${id} AND COALESCE(btrim("data"->>${nextKey}), '') <> ''`;
    }
  }

  await logActivity({
    workspaceId: competition.workspaceId,
    userId: user.id,
    action: body.rotatePreviewToken === true ? "competition.preview_token_rotated" : "competition.updated",
    meta: { competitionId: id, name: updated.name },
  });

  return NextResponse.json({
    competition: { ...updated, config: normalizeCompetitionConfig(updated.config, { includeDisabled: true }) },
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const competition = await authorize(id, user.id);
  if (!competition) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  await prisma.competition.delete({ where: { id } });

  await logActivity({
    workspaceId: competition.workspaceId,
    userId: user.id,
    action: "competition.deleted",
    meta: { competitionId: id, name: competition.name },
  });

  return NextResponse.json({ ok: true });
}
