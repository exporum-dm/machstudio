import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

import { activityDetails, activityLabel } from "@/lib/activity-labels";

// 운영 콘솔 "운영 로그" — 이 웨비나에 대한 최근 활동을 사람이 읽는 라벨로 반환.
// logActivity 가 meta.webinarId 로 기록하므로 그걸로 스코프한다(읽기 전용, 어드민 인증).
// 라벨·세부 문장은 관리자 활동 로그와 같은 곳(activity-labels)에서 만든다.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await prisma.webinar.findUnique({ where: { id }, select: { workspaceId: true } });
  if (!webinar) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: webinar.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const rows = await prisma.activityLog.findMany({
    where: { workspaceId: webinar.workspaceId, meta: { path: ["webinarId"], equals: id } },
    orderBy: { createdAt: "desc" },
    take: 24,
    include: { user: { select: { name: true } } },
  });

  const items = rows.map((r) => ({
    id: r.id,
    action: r.action,
    // 라벨 없는 액션이 raw 문자열("webinar.foo_bar")로 그대로 노출되지 않게 한글 폴백을 둔다.
    label: activityLabel(r.action),
    details: activityDetails(r.action, r.meta),
    at: r.createdAt,
    actor: r.user?.name ?? null,
  }));

  return NextResponse.json({ items });
}
