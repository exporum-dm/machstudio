import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AdSyncError, folderPlatforms, isDueForNightlySync } from "@/lib/ad-sync/shared";
import { syncMetaFolder } from "@/lib/ad-sync/meta";
import { syncGoogleFolder } from "@/lib/ad-sync/google";
import { GET as runReports } from "../run-reports/route";

/**
 * 매일 KST 00:00 (UTC 15:00) — 광고 성과 폴더 전체 매체 자동 동기화 + 예약 리포트.
 *
 * Vercel Hobby cron 한도(2개) 때문에 새 cron 을 늘리지 않고 run-reports 자리를 이어받았다
 * (uptime-check 를 3번째로 넣었다 빌드가 깨진 적 있음 — f91748c). 예약 리포트도 여기서 그대로 돈다.
 *
 * 누구 이름으로 저장하나: 그 폴더에 마지막으로 성과를 올린 사람(배치 uploadedById).
 * 한 번도 동기화·업로드한 적 없는 폴더는 연결 상태를 알 수 없어 건너뛴다.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const folders = (await prisma.adPerformanceFolder.findMany({
    where: { project: { deletedAt: null }, workspace: { deletedAt: null } },
  })).filter((folder) => isDueForNightlySync(folder, now));

  // 폴더끼리, 매체끼리 병렬 — 하나가 실패해도 나머지는 계속 간다.
  const adSync = await Promise.all(folders.map(async (folder) => {
    const last = await prisma.adPerformanceImportBatch.findFirst({
      where: { folderId: folder.id, uploadedById: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { uploadedById: true },
    });
    const userId = last?.uploadedById;
    if (!userId) return { folderId: folder.id, name: folder.name, skipped: "동기화 이력 없음" };
    const platforms = folderPlatforms(folder);
    const run = async (enabled: boolean, sync: typeof syncMetaFolder) => {
      if (!enabled) return undefined;
      try {
        const result = await sync(folder, userId);
        return { ok: true, rowCount: result.rowCount };
      } catch (error) {
        const message = error instanceof AdSyncError || error instanceof Error ? error.message : String(error);
        console.warn(`[cron/nightly] ${folder.name} 동기화 실패`, message);
        return { ok: false, error: message };
      }
    };
    const [meta, google] = await Promise.all([run(platforms.meta, syncMetaFolder), run(platforms.google, syncGoogleFolder)]);
    return { folderId: folder.id, name: folder.name, meta, google };
  }));

  let reports: unknown;
  try {
    reports = await (await runReports(request)).json();
  } catch (error) {
    reports = { error: error instanceof Error ? error.message : String(error) };
  }

  return NextResponse.json({ ok: true, adSync, reports });
}
