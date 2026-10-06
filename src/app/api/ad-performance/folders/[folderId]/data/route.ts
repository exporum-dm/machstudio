import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdFolderAccess } from "@/lib/ad-folder-access";
import { decryptMetaToken } from "@/lib/meta-ads";
import { findMetaConnection } from "@/lib/meta-connection";
import { fetchAdCreatives, isMetaThumbnailStale } from "@/lib/meta-ad-creatives";

type Context = { params: Promise<{ folderId: string }> };
type Level = "campaign" | "adGroup" | "ad";

/** 한 번에 다시 받을 최대 광고 수 — Graph 배치 50개 단위로 4번이면 화면이 크게 늦어지지 않는다. */
const MAX_THUMBNAIL_REFRESH = 200;

/**
 * 만료된 Meta 썸네일을 새로 받아 응답 행과 DB 둘 다 고친다(meta-ad-creatives.ts 머리말 참고).
 * 실패해도 표는 그대로 내려간다 — 썸네일은 부가 정보다.
 */
async function refreshStaleMetaThumbnails(
  folderId: string,
  projectId: string,
  userId: string,
  rows: Array<{ sourceType: string; adId: string | null; thumbnailUrl: string | null }>,
) {
  const stale = [...new Set(rows
    .filter(row => row.sourceType === "META" && row.adId && isMetaThumbnailStale(row.thumbnailUrl))
    .map(row => row.adId as string))].slice(0, MAX_THUMBNAIL_REFRESH);
  if (!stale.length) return;
  try {
    const connection = await findMetaConnection(projectId, userId);
    if (!connection) return;
    const token = decryptMetaToken(connection.encryptedAccessToken);
    const creatives = await fetchAdCreatives(token, process.env.META_GRAPH_VERSION || "v25.0", stale);
    const fresh = stale.flatMap(adId => {
      const url = creatives.get(adId)?.thumbnailUrl;
      return url ? [{ adId, url }] : [];
    });
    if (!fresh.length) return;
    const byAd = new Map(fresh.map(item => [item.adId, item.url]));
    for (const row of rows) {
      const url = row.sourceType === "META" && row.adId ? byAd.get(row.adId) : undefined;
      if (url) row.thumbnailUrl = url;
    }
    await prisma.$executeRaw`
      UPDATE "AdPerformanceRecord" AS r SET "thumbnailUrl" = v.url
      FROM unnest(${fresh.map(item => item.adId)}::text[], ${fresh.map(item => item.url)}::text[]) AS v(ad_id, url)
      WHERE r."folderId" = ${folderId} AND r."sourceType" = 'META' AND r."adId" = v.ad_id`;
  } catch (error) {
    console.warn("[ad-performance] 썸네일 갱신 실패", error instanceof Error ? error.message : error);
  }
}

export async function GET(request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { searchParams } = new URL(request.url);
  const level: Level = searchParams.get("level") === "ad" ? "ad" : searchParams.get("level") === "adGroup" ? "adGroup" : "campaign";
  const sourceType = searchParams.get("sourceType");
  const campaignId = searchParams.get("campaignId");
  const adGroupId = searchParams.get("adGroupId");
  const records = await prisma.adPerformanceRecord.findMany({
    where: {
      folderId,
      ...(sourceType && sourceType !== "ALL" ? { sourceType } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(adGroupId ? { adGroupId } : {}),
    },
    select: {
      sourceType: true, campaignId: true, campaignName: true, adGroupId: true, adGroupName: true,
      adId: true, adName: true, creativeId: true, creativeName: true, thumbnailUrl: true, creativeType: true, status: true,
      cost: true, impressions: true, reach: true, clicks: true, conversions: true,
    },
    take: 50_000,
  });

  const grouped = new Map<string, {
    id: string; sourceType: string; name: string; campaignId: string | null; campaignName: string;
    adGroupId: string | null; adGroupName: string | null; adId: string | null; creativeId: string | null; creativeName: string | null;
    thumbnailUrl: string | null; creativeType: string | null; status: string | null; cost: number; impressions: number; reach: number; clicks: number; conversions: number;
  }>();
  for (const row of records) {
    const id = level === "campaign" ? row.campaignId || row.campaignName : level === "adGroup" ? row.adGroupId || row.adGroupName || "-" : row.adId || row.adName || row.creativeId || "-";
    const key = `${row.sourceType}:${id}`;
    const current = grouped.get(key) ?? {
      id, sourceType: row.sourceType,
      name: level === "campaign" ? row.campaignName : level === "adGroup" ? row.adGroupName || "이름 없는 광고 세트" : row.adName || row.creativeName || "이름 없는 광고",
      campaignId: row.campaignId, campaignName: row.campaignName, adGroupId: row.adGroupId, adGroupName: row.adGroupName, adId: row.adId,
      creativeId: row.creativeId, creativeName: row.creativeName, thumbnailUrl: row.thumbnailUrl, creativeType: row.creativeType, status: row.status,
      cost: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0,
    };
    current.cost += row.cost ?? 0; current.impressions += row.impressions ?? 0; current.reach += row.reach ?? 0;
    current.clicks += row.clicks ?? 0; current.conversions += row.conversions ?? 0;
    grouped.set(key, current);
  }
  if (level === "ad") await refreshStaleMetaThumbnails(folderId, access.folder.projectId, access.user.id, [...grouped.values()]);
  const rows = [...grouped.values()].map(row => ({
    ...row,
    ctr: row.impressions ? row.clicks / row.impressions * 100 : 0,
    cpc: row.clicks ? row.cost / row.clicks : 0,
    cpm: row.impressions ? row.cost / row.impressions * 1000 : 0,
    costPerConversion: row.conversions ? row.cost / row.conversions : 0,
  })).sort((a,b) => b.cost - a.cost);
  return NextResponse.json({ level, rows, truncated: records.length === 50_000 });
}
