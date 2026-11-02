import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { ensureAppUser } from "@/lib/app-user";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { autoJoinCompanyWorkspace, ensureSuperAdminEverywhere } from "@/lib/auto-join";

// 현재 워크스페이스 + 프로젝트 목록
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  /* 여기가 DB User 행을 보장하는 자리다 — 앱 화면을 열면 WorkspaceProvider 가 이 라우트를
     반드시 부르고, 이미 user 행을 읽고 있었다(isSuperAdmin). 없을 때만 만들므로 평상시
     쿼리 수는 그대로다. 왜 로그인 시점에 만들어야 하는지는 ensureAppUser 주석 참고. */
  const loadMemberships = () => prisma.workspaceMember.findMany({
    where: { userId: user.id, workspace: { deletedAt: null } },
    include: { workspace: { include: { projects: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } } } },
    orderBy: { joinedAt: "asc" },
  });
  const [initialMemberships, dbUser] = await Promise.all([loadMemberships(), ensureAppUser(user)]);
  let memberships = initialMemberships;

  // env 기반 root 어드민 또는 DB 플래그
  // 이메일 목록은 super-admin.ts 한 곳에서만 정한다 — 여기 따로 적어 두면 사람이 바뀔 때 한쪽만 고쳐진다.
  const isSuperAdmin = isSuperAdminEmail(user.email) || dbUser?.isSuperAdmin === true;

  // 회사 메일(@exporum.com)로 처음 들어온 사람은 초대 없이 회사 워크스페이스에 넣는다(2026-11-02).
  if (memberships.length === 0 && dbUser && (await autoJoinCompanyWorkspace(user))) {
    memberships = await loadMemberships();
  }
  // 최고 관리자는 모든 워크스페이스에 들어간다 — 빠진 곳이 있으면 ADMIN 으로 넣는다(새 워크스페이스 포함).
  if (isSuperAdmin && dbUser && (await ensureSuperAdminEverywhere(user.id))) {
    memberships = await loadMemberships();
  }

  if (memberships.length === 0) return NextResponse.json({ workspace: null, workspaces: [], projects: [], isSuperAdmin });

  const all = memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    role: m.role,
  }));

  return NextResponse.json({
    workspace: all[0],
    workspaces: all,
    projects: memberships[0].workspace.projects,
    isSuperAdmin,
  });
}

// 새 워크스페이스 생성
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
    if (!user.email) return NextResponse.json({ error: "이메일 정보를 확인할 수 없습니다." }, { status: 400 });

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "워크스페이스 이름을 입력해주세요." }, { status: 400 });

    const slug = `${name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "ws"}-${Date.now()}`;
    const email = user.email.toLowerCase();

    // 같은 이메일이 다른 id로 이미 등록된 경우 명확한 에러 반환.
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail && existingByEmail.id !== user.id) {
      return NextResponse.json({
        error: "이 이메일로 이미 등록된 계정이 있습니다. 관리자에게 문의해주세요.",
      }, { status: 409 });
    }

    // User + Workspace + Member + 기본 Project를 트랜잭션으로.
    const result = await prisma.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { id: user.id },
        update: { email },
        create: { id: user.id, email, name: (user.user_metadata?.name as string | undefined) ?? user.email },
      });

      const workspace = await tx.workspace.create({ data: { name, slug } });

      await tx.workspaceMember.create({
        data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
      });

      await tx.project.create({
        data: { workspaceId: workspace.id, name: "기본 프로젝트" },
      });

      return workspace;
    });

    await logActivity({
      workspaceId: result.id,
      userId: user.id,
      action: "workspace.created",
      meta: { name: result.name, slug: result.slug },
    });

    return NextResponse.json({ workspace: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[워크스페이스 생성 오류]", message);
    return NextResponse.json({
      error: "워크스페이스 생성에 실패했습니다. 잠시 후 다시 시도해주세요.",
      ...(process.env.NODE_ENV === "development" ? { detail: message } : {}),
    }, { status: 500 });
  }
}
