import "server-only";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/** 로그인 + 그 워크스페이스 멤버인지. 업무일지·택소노미처럼 워크스페이스 단위 기능이 같이 쓴다. */
export async function requireWorkspaceMember(workspaceId: string | null | undefined) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "인증 필요", status: 401 } as const;
  if (!workspaceId) return { error: "workspaceId 필요", status: 400 } as const;
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
    select: { role: true },
  });
  if (!membership) return { error: "접근 권한 없음", status: 403 } as const;
  return { userId: user.id, role: membership.role, isAdmin: membership.role !== "MEMBER" } as const;
}
