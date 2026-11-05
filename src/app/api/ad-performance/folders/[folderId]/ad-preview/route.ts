import { adCampaignScope } from "@/lib/ad-campaign-scope";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdFolderAccess } from "@/lib/ad-folder-access";
import { decryptMetaToken, metaGraph } from "@/lib/meta-ads";
import { findMetaConnection } from "@/lib/meta-connection";

type Context = { params: Promise<{ folderId: string }> };

export async function GET(request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const { searchParams } = new URL(request.url);
  const adId = searchParams.get("adId")?.trim();
  if (!adId) return NextResponse.json({ error: "adId가 필요합니다." }, { status: 400 });

  // 폴더에 실제로 속한 광고인지 먼저 확인 — 다른 광고 계정의 소재를 이 폴더 권한으로 들여다볼 수 없게 막는다.
  const owned = await prisma.adPerformanceRecord.findFirst({ where: { folderId, adId, sourceType: "META", AND: [adCampaignScope(access.folder.mediaAccounts)] }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "이 폴더에 속한 광고가 아닙니다." }, { status: 404 });

  const connection = await findMetaConnection(access.folder.projectId, access.user.id);
  if (!connection) return NextResponse.json({ error: "연결된 Meta 계정이 없습니다." }, { status: 400 });

  try {
    const token = decryptMetaToken(connection.encryptedAccessToken);
    const result = await metaGraph<{ data: Array<{ body?: string }> }>(`${adId}/previews`, token, { ad_format: "DESKTOP_FEED_STANDARD" });
    const html = result.data?.[0]?.body;
    if (!html) return NextResponse.json({ error: "미리보기를 가져오지 못했습니다." }, { status: 502 });
    return NextResponse.json({ html });
  } catch (error) {
    const message = error instanceof Error ? error.message : "미리보기를 가져오지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
