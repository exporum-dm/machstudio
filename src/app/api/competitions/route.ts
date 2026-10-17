import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import {
  DEFAULT_COMPETITION_THEME,
  normalizeCompetitionConfig,
} from "@/lib/competition-config";
import { DEFAULT_ROUND_NAME } from "@/lib/competition-status";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const projectId = searchParams.get("projectId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId 필요" }, { status: 400 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const competitions = await prisma.competition.findMany({
    where: { workspaceId, ...(projectId ? { projectId } : {}) },
    include: {
      _count: { select: { entries: true } },
      project: { select: { id: true, name: true } },
      // 목록 배지의 단계도 라운드 일정까지 보고 정한다(본선 투표가 열렸으면 본선).
      rounds: { select: { kind: true, voteEnabled: true, voteOpenAt: true, voteCloseAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ competitions });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const body = await request.json();
  const { workspaceId, projectId, name, slug, description } = body;

  if (!workspaceId || !projectId || !name || !slug) {
    return NextResponse.json({ error: "필수 항목이 누락됐어요" }, { status: 400 });
  }
  // 웨비나 슬러그와 같은 규칙 — 한글 이름을 자동 변환하면 "-"·"--" 로 뭉개지므로 형식을 본다.
  if (!/^[a-z0-9-]{2,}$/.test(slug) || /^-+$/.test(slug)) {
    return NextResponse.json(
      { error: "주소(슬러그)가 올바르지 않아요 — 소문자·숫자·하이픈만 쓸 수 있고 하이픈만으로는 만들 수 없어요" },
      { status: 400 },
    );
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null } });
  if (!project) return NextResponse.json({ error: "프로젝트 없음" }, { status: 404 });

  const exists = await prisma.competition.findUnique({ where: { slug } });
  if (exists) return NextResponse.json({ error: "이미 사용 중인 주소예요" }, { status: 409 });

  try {
    const competition = await prisma.competition.create({
      data: {
        workspaceId,
        projectId,
        name: String(name).trim(),
        slug,
        description: typeof description === "string" && description.trim() ? description.trim() : null,
        theme: DEFAULT_COMPETITION_THEME,
        // 기본값으로 완전한 config 를 넣어 둔다 — 빈 객체로 두면 편집 화면이 매번 기본값을
        // 다시 만들어 내야 하고, 그러면 "저장 안 했는데 값이 있다"는 상태가 생긴다.
        config: JSON.parse(JSON.stringify(normalizeCompetitionConfig({}, { includeDisabled: true }))),
        previewToken: randomBytes(16).toString("base64url"),
      },
    });

    // 예선·본선 라운드를 함께 만든다. 라운드가 없으면 투표 설정 화면이 빈 껍데기가 된다.
    await prisma.competitionRound.createMany({
      data: [
        { competitionId: competition.id, kind: "prelim", name: DEFAULT_ROUND_NAME.prelim, sortOrder: 0, entryOrder: "random" },
        { competitionId: competition.id, kind: "final", name: DEFAULT_ROUND_NAME.final, sortOrder: 1, entryOrder: "submitted" },
      ],
    });

    await logActivity({
      workspaceId,
      userId: user.id,
      action: "competition.created",
      meta: { competitionId: competition.id, name: competition.name },
    });

    return NextResponse.json({ competition }, { status: 201 });
  } catch (error) {
    console.error("[competition] create failed", error);
    return NextResponse.json({ error: "대회 생성에 실패했어요" }, { status: 500 });
  }
}
