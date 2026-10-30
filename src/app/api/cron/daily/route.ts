import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { collectAllBriefs } from "@/lib/brief/collect";

// 브리프 수집이 바깥 사이트 여러 곳을 읽으므로 기본 시간 제한보다 넉넉히.
export const maxDuration = 60;

// 매일 한 번 호출 — 모든 유지보수 작업을 묶음.
// Vercel Hobby cron 2개 한도 회피.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: Record<string, unknown> = {};

  // 1) 30일 지난 soft-deleted 영구 제거
  try {
    const cutoff = new Date(Date.now() - 30 * 86400_000);
    const [s, p, w] = await Promise.all([
      prisma.collectSource.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
      prisma.project.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
      prisma.workspace.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    ]);
    result.purgedSoftDeleted = { sources: s.count, projects: p.count, workspaces: w.count };
  } catch (e) {
    result.purgedSoftDeleted = { error: e instanceof Error ? e.message : String(e) };
  }

  // 2) 보관 정책 적용
  try {
    const policies = await prisma.collectRetentionPolicy.findMany();
    const retention: { sourceId: string; deleted: number }[] = [];
    for (const p of policies) {
      if (p.retainDays <= 0) continue;
      const cutoff = new Date(Date.now() - p.retainDays * 86400_000);
      const r = await prisma.collectRecord.deleteMany({
        where: { sourceId: p.sourceId, createdAt: { lt: cutoff } },
      });
      retention.push({ sourceId: p.sourceId, deleted: r.count });
    }
    result.retention = retention;
  } catch (e) {
    result.retention = { error: e instanceof Error ? e.message : String(e) };
  }

  // 3) 만료된 API 토큰 정리
  try {
    const expired = await prisma.apiToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    result.expiredTokens = expired.count;
  } catch (e) {
    result.expiredTokens = { error: e instanceof Error ? e.message : String(e) };
  }

  // 4) 브리프 자동 수집 — 기업마당·뉴스에서 새 후보를 긁어 온다(KST 09:00). 채택은 사람이 한다.
  try {
    const runs = await collectAllBriefs();
    result.briefCollect = runs.map((r) => ({
      briefId: r.briefId,
      added: r.added,
      errors: r.results.filter((x) => x.error).length,
    }));
  } catch (e) {
    result.briefCollect = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ ok: true, ...result });
}
