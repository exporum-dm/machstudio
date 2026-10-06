import { NextResponse } from "next/server";
import { getAdFolderAccess } from "@/lib/ad-folder-access";
import { AdSyncError } from "@/lib/ad-sync/shared";
import { syncMetaFolder } from "@/lib/ad-sync/meta";

type Context = { params: Promise<{ folderId: string }> };

// 실제 동기화는 lib/ad-sync/meta.ts — 매일 밤 자동 동기화(/api/cron/nightly)와 같은 코드를 쓴다.
export async function POST(_request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId, true);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const result = await syncMetaFolder(access.folder, access.user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AdSyncError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
