import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { hashSharePassword } from "@/lib/share-password";
import { formatShareRange, parseShareRange, shareRangeLabel, shareRangeWindow, type ShareRange } from "@/lib/share-range";

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

function shareState(project: {
  analyticsShareToken: string | null;
  analyticsShareEnabled: boolean;
  analyticsSharePasswordHash: string | null;
  analyticsShareRange: string | null;
}) {
  const range = parseShareRange(project.analyticsShareRange);
  const win = shareRangeWindow(range);
  return {
    shareToken: project.analyticsShareToken,
    shareEnabled: project.analyticsShareEnabled,
    hasPassword: !!project.analyticsSharePasswordHash,
    // 저장 문자열과 **풀어 놓은 값**을 같이 준다 — 모달이 기간 계산을 또 하지 않게.
    shareRange: formatShareRange(range),
    rangeKind: range.kind,
    rangeLabel: shareRangeLabel(range),
    rangeFrom: win.fromDate,
    rangeTo: win.toDate,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;
  const { project } = auth;
  return NextResponse.json(shareState(project));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;
  const { project, userId } = auth;

  const body = await request.json().catch(() => ({}));
  const { shareEnabled, sharePassword, clearSharePassword, rotate, shareRange } = body as {
    shareEnabled?: boolean;
    sharePassword?: string;
    clearSharePassword?: boolean;
    rotate?: boolean;
    shareRange?: string;
  };

  const data: Record<string, unknown> = {};
  const activityActions: Array<"analytics.share_enabled" | "analytics.share_disabled" | "analytics.share_token_rotated" | "analytics.share_range_changed" | "analytics.share_password_set" | "analytics.share_password_removed"> = [];

  if (shareEnabled !== undefined) {
    const next = !!shareEnabled;
    data.analyticsShareEnabled = next;
    if (next && !project.analyticsShareToken) {
      data.analyticsShareToken = randomBytes(24).toString("base64url");
    }
    if (next !== project.analyticsShareEnabled) {
      activityActions.push(next ? "analytics.share_enabled" : "analytics.share_disabled");
    }
  }

  if (typeof shareRange === "string") {
    // 보낸 문자열을 그대로 넣지 않는다 — 풀었다 다시 적어 **정규형만** 저장된다.
    // ("30일", "2026-10-1~…" 같은 변형이 DB 에 섞이면 읽는 쪽이 전부 방어해야 한다.)
    const parsed: ShareRange = parseShareRange(shareRange);
    if (formatShareRange(parsed) !== shareRange.trim()) {
      return NextResponse.json({ error: "공유 기간을 알아볼 수 없어요" }, { status: 400 });
    }
    data.analyticsShareRange = formatShareRange(parsed);
    if (data.analyticsShareRange !== project.analyticsShareRange) {
      activityActions.push("analytics.share_range_changed");
    }
  }

  if (rotate === true) {
    data.analyticsShareToken = randomBytes(24).toString("base64url");
    data.analyticsShareEnabled = true;
    activityActions.push("analytics.share_token_rotated");
  }

  if (typeof sharePassword === "string" && sharePassword.length > 0) {
    if (sharePassword.length > 200) {
      return NextResponse.json({ error: "비밀번호가 너무 길어요" }, { status: 400 });
    }
    data.analyticsSharePasswordHash = hashSharePassword(sharePassword);
    activityActions.push("analytics.share_password_set");
  } else if (clearSharePassword === true) {
    data.analyticsSharePasswordHash = null;
    activityActions.push("analytics.share_password_removed");
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

  return NextResponse.json(shareState(updated));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;
  const { project, userId } = auth;

  await prisma.project.update({
    where: { id },
    data: { analyticsShareEnabled: false, analyticsShareToken: null, analyticsSharePasswordHash: null },
  });

  await logActivity({
    workspaceId: project.workspaceId,
    userId,
    action: "analytics.share_disabled",
    meta: { projectId: id, projectName: project.name },
  });

  return NextResponse.json({ ok: true });
}
