import "server-only";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/** 상세페이지 접근 — 워크스페이스 멤버면 된다(대회·웨비나 라우트와 같은 기준). 지운 페이지는 없는 것으로 본다. */
export async function getDetailPageAccess(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "인증 필요", status: 401 } as const;
  const page = await prisma.detailPage.findFirst({ where: { id, deletedAt: null } });
  if (!page) return { error: "상세페이지를 찾을 수 없어요", status: 404 } as const;
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: page.workspaceId } },
  });
  if (!membership) return { error: "접근 권한 없음", status: 403 } as const;
  return { user, page, membership } as const;
}

/** 목록·생성 — 워크스페이스 멤버인지. */
export async function getWorkspaceMemberAccess(workspaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "인증 필요", status: 401 } as const;
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (!membership) return { error: "접근 권한 없음", status: 403 } as const;
  return { user } as const;
}
