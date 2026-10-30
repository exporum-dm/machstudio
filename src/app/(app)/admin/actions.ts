"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdminEmail, isRootSuperAdmin } from "@/lib/super-admin";
import { checkSuperAdminAccess } from "@/lib/super-admin-server";

async function requireSuperAdminUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) throw new Error("슈퍼어드민 권한이 필요합니다.");
  const allowed = await checkSuperAdminAccess({ id: user.id, email: user.email });
  if (!allowed) throw new Error("슈퍼어드민 권한이 필요합니다.");

  return { id: user.id, email: user.email };
}

function getString(formData: FormData, key: string, maxLength = 120) {
  const value = formData.get(key);
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function getRequiredString(formData: FormData, key: string, label: string, maxLength = 120) {
  const value = getString(formData, key, maxLength);
  if (!value) throw new Error(`${label}을 입력해주세요.`);
  return value;
}

function finishAdminAction(message: string) {
  revalidatePath("/admin");
  redirect(`/admin?message=${encodeURIComponent(message)}`);
}

async function createAdminLog(args: {
  workspaceId: string;
  sourceId?: string | null;
  userId?: string | null;
  action: string;
  meta?: Record<string, unknown>;
}) {
  await prisma.activityLog.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.userId ?? null,
      sourceId: args.sourceId ?? null,
      action: args.action,
      meta: (args.meta ?? null) as never,
    },
  });
}

export async function renameWorkspaceAction(formData: FormData) {
  const user = await requireSuperAdminUser();
  const workspaceId = getRequiredString(formData, "workspaceId", "워크스페이스 ID");
  const name = getRequiredString(formData, "name", "워크스페이스 이름", 80);
  const reason = getString(formData, "reason", 240);

  const previous = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true },
  });
  if (!previous) throw new Error("워크스페이스를 찾을 수 없습니다.");

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { name },
  });
  await createAdminLog({
    workspaceId,
    userId: user.id,
    action: "admin.workspace_renamed",
    meta: { before: previous.name, after: name, reason },
  });

  finishAdminAction("워크스페이스 이름을 변경했습니다.");
}

export async function setWorkspaceArchivedAction(formData: FormData) {
  const user = await requireSuperAdminUser();
  const workspaceId = getRequiredString(formData, "workspaceId", "워크스페이스 ID");
  const mode = getRequiredString(formData, "mode", "처리 방식");
  const reason = getRequiredString(formData, "reason", "처리 사유", 240);
  const deletedAt = mode === "restore" ? null : new Date();

  const workspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { deletedAt },
    select: { id: true, name: true },
  });
  await createAdminLog({
    workspaceId,
    userId: user.id,
    action: mode === "restore" ? "admin.workspace_restored" : "admin.workspace_archived",
    meta: { workspaceName: workspace.name, reason },
  });

  finishAdminAction(mode === "restore" ? "워크스페이스를 복구했습니다." : "워크스페이스를 보관 처리했습니다.");
}

export async function renameProjectAction(formData: FormData) {
  const user = await requireSuperAdminUser();
  const projectId = getRequiredString(formData, "projectId", "프로젝트 ID");
  const name = getRequiredString(formData, "name", "프로젝트 이름", 80);
  const description = getString(formData, "description", 240);
  const reason = getString(formData, "reason", 240);

  const previous = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, description: true, workspaceId: true },
  });
  if (!previous) throw new Error("프로젝트를 찾을 수 없습니다.");

  await prisma.project.update({
    where: { id: projectId },
    data: { name, description: description || null },
  });
  await createAdminLog({
    workspaceId: previous.workspaceId,
    userId: user.id,
    action: "admin.project_updated",
    meta: {
      projectId,
      before: { name: previous.name, description: previous.description },
      after: { name, description: description || null },
      reason,
    },
  });

  finishAdminAction("프로젝트 정보를 변경했습니다.");
}

export async function setProjectArchivedAction(formData: FormData) {
  const user = await requireSuperAdminUser();
  const projectId = getRequiredString(formData, "projectId", "프로젝트 ID");
  const mode = getRequiredString(formData, "mode", "처리 방식");
  const reason = getRequiredString(formData, "reason", "처리 사유", 240);
  const deletedAt = mode === "restore" ? null : new Date();

  const project = await prisma.project.update({
    where: { id: projectId },
    data: { deletedAt },
    select: { id: true, name: true, workspaceId: true },
  });
  await createAdminLog({
    workspaceId: project.workspaceId,
    userId: user.id,
    action: mode === "restore" ? "admin.project_restored" : "admin.project_archived",
    meta: { projectId, projectName: project.name, reason },
  });

  finishAdminAction(mode === "restore" ? "프로젝트를 복구했습니다." : "프로젝트를 보관 처리했습니다.");
}

export async function setCollectSourceActiveAction(formData: FormData) {
  const user = await requireSuperAdminUser();
  const sourceId = getRequiredString(formData, "sourceId", "수집 소스 ID");
  const mode = getRequiredString(formData, "mode", "처리 방식");
  const reason = getRequiredString(formData, "reason", "처리 사유", 240);
  const isActive = mode === "activate";

  const source = await prisma.collectSource.update({
    where: { id: sourceId },
    data: { isActive },
    select: { id: true, name: true, workspaceId: true, projectId: true },
  });
  await createAdminLog({
    workspaceId: source.workspaceId,
    sourceId: source.id,
    userId: user.id,
    action: isActive ? "admin.source_activated" : "admin.source_paused",
    meta: { sourceId, sourceName: source.name, projectId: source.projectId, reason },
  });

  finishAdminAction(isActive ? "수집 소스를 활성화했습니다." : "수집 소스를 일시중지했습니다.");
}

export async function deleteWorkspacePermanentlyAction(formData: FormData) {
  const admin = await requireSuperAdminUser();
  const workspaceId = getRequiredString(formData, "workspaceId", "워크스페이스 ID");
  const confirmName = getRequiredString(formData, "confirmName", "확인용 워크스페이스 이름", 80);
  const reason = getRequiredString(formData, "reason", "삭제 사유", 240);

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true },
  });
  if (!workspace) throw new Error("워크스페이스를 찾을 수 없습니다.");
  if (workspace.name !== confirmName) {
    throw new Error("워크스페이스 이름이 일치하지 않습니다.");
  }

  // 영구 삭제 — 모든 관련 데이터 cascade. ActivityLog는 다른 워크스페이스에 기록.
  // 단, 활동 로그를 위해 정보를 미리 저장.
  const snapshot = {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceSlug: workspace.slug,
    reason,
    deletedBy: admin.email,
  };

  await prisma.workspace.delete({ where: { id: workspaceId } });

  // 관리자 본인의 다른 워크스페이스에 기록 (cascade로 사라지지 않게)
  const adminMembership = await prisma.workspaceMember.findFirst({
    where: { userId: admin.id, workspace: { deletedAt: null } },
  });
  if (adminMembership) {
    await createAdminLog({
      workspaceId: adminMembership.workspaceId,
      userId: admin.id,
      action: "admin.workspace_permanently_deleted",
      meta: snapshot,
    });
  }

  finishAdminAction(`워크스페이스 '${workspace.name}'을(를) 영구 삭제했습니다.`);
}

export async function deleteUserAction(formData: FormData) {
  const admin = await requireSuperAdminUser();
  const targetUserId = getRequiredString(formData, "userId", "사용자 ID");
  const confirmEmail = getRequiredString(formData, "confirmEmail", "확인 이메일", 200).toLowerCase();
  const reason = getRequiredString(formData, "reason", "삭제 사유", 240);

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      name: true,
      isSuperAdmin: true,
      memberships: {
        select: {
          role: true,
          workspaceId: true,
          workspace: { select: { name: true, deletedAt: true } },
        },
      },
      _count: {
        select: {
          apiTokens: true,
          projectMemberships: true,
          utmLinks: true,
          shortLinks: true,
          activityLogs: true,
        },
      },
    },
  });

  if (!targetUser) throw new Error("사용자를 찾을 수 없습니다.");
  if (isSuperAdminEmail(targetUser.email) || targetUser.isSuperAdmin) {
    throw new Error("슈퍼어드민 계정은 삭제할 수 없습니다. 권한을 먼저 회수해주세요.");
  }
  if (confirmEmail !== targetUser.email.toLowerCase()) throw new Error("확인 이메일이 일치하지 않습니다.");

  const ownedActiveWorkspaces = targetUser.memberships.filter((membership) => (
    membership.role === "OWNER" && !membership.workspace.deletedAt
  ));
  if (ownedActiveWorkspaces.length > 0) {
    throw new Error("소유 중인 활성 워크스페이스가 있어 삭제할 수 없습니다. 먼저 소유권을 이전하거나 워크스페이스를 보관하세요.");
  }

  const workspaceIds = Array.from(new Set(targetUser.memberships.map((membership) => membership.workspaceId)));
  const logWrites = workspaceIds.map((workspaceId) => prisma.activityLog.create({
    data: {
      workspaceId,
      userId: admin.id,
      sourceId: null,
      action: "admin.user_deleted",
      meta: {
        targetUserId,
        targetEmail: targetUser.email,
        targetName: targetUser.name,
        reason,
        impact: targetUser._count,
      } as never,
    },
  }));

  await prisma.$transaction([
    ...logWrites,
    // 업무일지는 계정과 함께 지우지 않는다 — 칸에 보일 이름만 지금 이름으로 맞춰 두고 남긴다(2026-10-30).
    prisma.workEntry.updateMany({
      where: { authorId: targetUserId },
      data: { authorName: targetUser.name || targetUser.email.split("@")[0] },
    }),
    prisma.user.delete({ where: { id: targetUserId } }),
  ]);

  // Supabase Auth 계정 삭제 — service role 사용. 실패해도 DB 삭제는 이미 완료된 상태.
  let authMessage = "";
  try {
    const supabaseAdmin = createAdminClient();
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
    if (authError) {
      authMessage = ` (단, Supabase Auth 계정은 수동 삭제 필요: ${authError.message})`;
      console.error("[admin] Supabase Auth deletion failed:", authError.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    authMessage = ` (단, Supabase Auth 계정은 수동 삭제 필요: ${message})`;
    console.error("[admin] Supabase admin client error:", message);
  }

  finishAdminAction(`사용자를 삭제했습니다.${authMessage}`);
}

export async function grantSuperAdminAction(formData: FormData) {
  const admin = await requireSuperAdminUser();
  const targetUserId = getRequiredString(formData, "userId", "사용자 ID");
  const reason = getRequiredString(formData, "reason", "권한 부여 사유", 240);

  if (targetUserId === admin.id) throw new Error("자기 자신의 권한은 변경할 수 없습니다.");

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, name: true, isSuperAdmin: true },
  });
  if (!target) throw new Error("사용자를 찾을 수 없습니다.");
  if (isRootSuperAdmin(target.email)) throw new Error("환경변수로 부여된 root 어드민은 UI에서 변경할 수 없습니다.");
  if (target.isSuperAdmin) throw new Error("이미 슈퍼어드민입니다.");

  await prisma.user.update({ where: { id: targetUserId }, data: { isSuperAdmin: true } });

  const adminMembership = await prisma.workspaceMember.findFirst({
    where: { userId: admin.id, workspace: { deletedAt: null } },
  });
  if (adminMembership) {
    await createAdminLog({
      workspaceId: adminMembership.workspaceId,
      userId: admin.id,
      action: "admin.super_admin_granted",
      meta: { targetUserId, targetEmail: target.email, targetName: target.name, reason },
    });
  }

  finishAdminAction(`${target.email}에게 슈퍼어드민 권한을 부여했습니다.`);
}

export async function revokeSuperAdminAction(formData: FormData) {
  const admin = await requireSuperAdminUser();
  const targetUserId = getRequiredString(formData, "userId", "사용자 ID");
  const reason = getRequiredString(formData, "reason", "권한 회수 사유", 240);

  if (targetUserId === admin.id) throw new Error("자기 자신의 권한은 회수할 수 없습니다.");

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, name: true, isSuperAdmin: true },
  });
  if (!target) throw new Error("사용자를 찾을 수 없습니다.");
  if (isRootSuperAdmin(target.email)) throw new Error("환경변수로 부여된 root 어드민은 UI에서 회수할 수 없습니다.");
  if (!target.isSuperAdmin) throw new Error("슈퍼어드민이 아닙니다.");

  await prisma.user.update({ where: { id: targetUserId }, data: { isSuperAdmin: false } });

  const adminMembership = await prisma.workspaceMember.findFirst({
    where: { userId: admin.id, workspace: { deletedAt: null } },
  });
  if (adminMembership) {
    await createAdminLog({
      workspaceId: adminMembership.workspaceId,
      userId: admin.id,
      action: "admin.super_admin_revoked",
      meta: { targetUserId, targetEmail: target.email, targetName: target.name, reason },
    });
  }

  finishAdminAction(`${target.email}의 슈퍼어드민 권한을 회수했습니다.`);
}
