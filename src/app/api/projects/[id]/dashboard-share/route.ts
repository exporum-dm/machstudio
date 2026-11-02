import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { hashSharePassword } from "@/lib/share-password";

async function authorize(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "인증 필요" }, { status: 401 }) };

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.deletedAt) {
    return { error: NextResponse.json({ error: "프로젝트 없음" }, { status: 404 }) };
  }

  const [workspaceMember, projectMember] = await Promise.all([
    prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: project.workspaceId } },
    }),
    prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: user.id, projectId } },
    }),
  ]);

  // 워크스페이스 멤버면 누구나 공유 링크를 관리한다(2026-11-02 — 프로젝트 배정 구분을 없앴다).
  void projectMember;
  const canManage = !!workspaceMember;

  if (!canManage) {
    return { error: NextResponse.json({ error: "공유 관리 권한 없음" }, { status: 403 }) };
  }

  return { project, userId: user.id };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;
  const { project } = auth;
  return NextResponse.json({
    shareToken: project.dashboardShareToken,
    shareEnabled: project.dashboardShareEnabled,
    hasPassword: !!project.dashboardSharePasswordHash,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;
  const { project, userId } = auth;

  const body = await request.json().catch(() => ({}));
  const { shareEnabled, sharePassword, clearSharePassword, rotate } = body as {
    shareEnabled?: boolean;
    sharePassword?: string;
    clearSharePassword?: boolean;
    rotate?: boolean;
  };

  const data: Record<string, unknown> = {};
  const activityActions: Array<
    | "dashboard.realtime_share_enabled"
    | "dashboard.realtime_share_disabled"
    | "dashboard.realtime_share_token_rotated"
    | "dashboard.realtime_share_password_set"
    | "dashboard.realtime_share_password_removed"
  > = [];

  if (shareEnabled !== undefined) {
    const next = !!shareEnabled;
    data.dashboardShareEnabled = next;
    if (next && !project.dashboardShareToken) {
      data.dashboardShareToken = randomBytes(24).toString("base64url");
    }
    if (next !== project.dashboardShareEnabled) {
      activityActions.push(next ? "dashboard.realtime_share_enabled" : "dashboard.realtime_share_disabled");
    }
  }

  if (rotate === true) {
    data.dashboardShareToken = randomBytes(24).toString("base64url");
    data.dashboardShareEnabled = true;
    activityActions.push("dashboard.realtime_share_token_rotated");
  }

  if (typeof sharePassword === "string" && sharePassword.length > 0) {
    if (sharePassword.length > 200) {
      return NextResponse.json({ error: "비밀번호가 너무 길어요" }, { status: 400 });
    }
    data.dashboardSharePasswordHash = hashSharePassword(sharePassword);
    activityActions.push("dashboard.realtime_share_password_set");
  } else if (clearSharePassword === true) {
    data.dashboardSharePasswordHash = null;
    activityActions.push("dashboard.realtime_share_password_removed");
  }

  const updated = await prisma.project.update({ where: { id }, data });

  for (const action of activityActions) {
    await logActivity({
      workspaceId: project.workspaceId,
      userId,
      action,
      meta: { projectId: id, projectName: project.name },
    });
  }

  return NextResponse.json({
    shareToken: updated.dashboardShareToken,
    shareEnabled: updated.dashboardShareEnabled,
    hasPassword: !!updated.dashboardSharePasswordHash,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;
  const { project, userId } = auth;

  await prisma.project.update({
    where: { id },
    data: { dashboardShareEnabled: false, dashboardShareToken: null, dashboardSharePasswordHash: null },
  });

  await logActivity({
    workspaceId: project.workspaceId,
    userId,
    action: "dashboard.realtime_share_disabled",
    meta: { projectId: id, projectName: project.name },
  });

  return NextResponse.json({ ok: true });
}
