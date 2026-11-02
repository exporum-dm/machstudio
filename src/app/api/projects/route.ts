import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!name || !workspaceId) return NextResponse.json({ error: "프로젝트 이름과 워크스페이스가 필요해요" }, { status: 400 });

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: user.id, workspaceId, workspace: { deletedAt: null } },
  });
  if (!membership) return NextResponse.json({ error: "워크스페이스 없음" }, { status: 400 });

  const project = await prisma.project.create({
    data: { name, description: description || null, workspaceId: membership.workspaceId },
  });

  await logActivity({
    workspaceId: membership.workspaceId,
    userId: user.id,
    action: "project.created",
    meta: { projectId: project.id, name: project.name },
  });

  return NextResponse.json({ project });
}
