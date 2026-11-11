/**
 * 관리자 추천 탭 — 추천 순위 전체(이름·연락처 포함). 워크스페이스 멤버만.
 * 공개 순위판과 같은 계산(collect-referral-server)을 써서 두 화면의 순위가 어긋나지 않는다.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { loadReferralRanking } from "@/lib/collect-referral-server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const source = await prisma.collectSource.findUnique({
    where: { id },
    select: { id: true, name: true, workspaceId: true, deletedAt: true, formConfig: true },
  });
  if (!source || source.deletedAt) return NextResponse.json({ error: "소스를 찾을 수 없어요" }, { status: 404 });
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: source.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const config = normalizeCollectForm(source.formConfig);
  // 꺼져 있어도 지난 기록은 보여 준다(끄고 나서 결과를 정리하는 경우).
  const { ranked, referredTotal } = await loadReferralRanking({ id: source.id, name: source.name, config });
  return NextResponse.json({
    referral: config.referral,
    defaultLocale: config.defaultLocale,
    ranked,
    referredTotal,
  }, { headers: { "Cache-Control": "no-store" } });
}
