import crypto from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  decryptGoogleToken,
  googleAccessToken,
  googleAdsRequest,
  googleCustomerId,
} from "@/lib/google-ads";
import { AdSyncError, kstDateOnly, type AdSyncFolder } from "@/lib/ad-sync/shared";

type Account = { platform: string; accountId: string; accountName?: string };
type AssetRef = { asset?: string };
type GoogleAd = {
  id?: string;
  name?: string;
  type?: string;
  imageAd?: { imageUrl?: string; previewImageUrl?: string; name?: string };
  responsiveDisplayAd?: {
    marketingImages?: AssetRef[];
    squareMarketingImages?: AssetRef[];
    youtubeVideos?: AssetRef[];
  };
  videoAd?: { video?: AssetRef };
  videoResponsiveAd?: { videos?: AssetRef[] };
  demandGenMultiAssetAd?: {
    marketingImages?: AssetRef[];
    squareMarketingImages?: AssetRef[];
    portraitMarketingImages?: AssetRef[];
  };
  demandGenVideoResponsiveAd?: { videos?: AssetRef[] };
};
type GoogleRow = {
  customer?: { id?: string; descriptiveName?: string; currencyCode?: string };
  campaign?: { id?: string; name?: string };
  adGroup?: { id?: string; name?: string };
  adGroupAd?: { status?: string; ad?: GoogleAd };
  segments?: { date?: string };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    ctr?: number;
    averageCpc?: string;
    averageCpm?: string;
    conversions?: number;
    costPerConversion?: string;
  };
};
type GoogleAsset = {
  asset?: {
    resourceName?: string;
    name?: string;
    type?: string;
    imageAsset?: { fullSize?: { url?: string } };
    youtubeVideoAsset?: { youtubeVideoId?: string };
  };
};
type Creative = {
  name?: string;
  url?: string;
  type?: string;
  videoId?: string;
};

const micros = (value: string | undefined) => Number(value || 0) / 1_000_000;

/**
 * 광고가 쓰는 이미지·영상 에셋 이름. 앞에 올수록 썸네일로 먼저 쓴다(가로 이미지 → 정사각 → 세로 → 영상).
 * 디맨드젠(DEMAND_GEN_*) 광고는 반응형 디스플레이와 필드가 달라 따로 읽는다 — 빠뜨리면 썸네일이
 * 하나도 안 잡힌다(2026-10-06 Korea Expo LA 디맨드젠 광고 전부 빈칸이던 원인).
 */
export function assetRefs(ad?: GoogleAd) {
  return [
    ...(ad?.responsiveDisplayAd?.marketingImages ?? []),
    ...(ad?.responsiveDisplayAd?.squareMarketingImages ?? []),
    ...(ad?.demandGenMultiAssetAd?.marketingImages ?? []),
    ...(ad?.demandGenMultiAssetAd?.squareMarketingImages ?? []),
    ...(ad?.demandGenMultiAssetAd?.portraitMarketingImages ?? []),
    ...(ad?.responsiveDisplayAd?.youtubeVideos ?? []),
    ...(ad?.videoResponsiveAd?.videos ?? []),
    ...(ad?.demandGenVideoResponsiveAd?.videos ?? []),
    ...(ad?.videoAd?.video ? [ad.videoAd.video] : []),
  ]
    .map((item) => item.asset)
    .filter((name): name is string => Boolean(name));
}

async function fetchAccountRows(
  customerId: string,
  token: string,
  query: string,
) {
  const rows: GoogleRow[] = [];
  let pageToken: string | undefined;
  do {
    const result = await googleAdsRequest<{
      results?: GoogleRow[];
      nextPageToken?: string;
    }>(`customers/${customerId}/googleAds:search`, token, {
      method: "POST",
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    });
    rows.push(...(result.results ?? []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return rows;
}

async function fetchAssets(customerId: string, token: string, names: string[]) {
  const assets = new Map<string, Creative>();
  for (let offset = 0; offset < names.length; offset += 100) {
    const list = names
      .slice(offset, offset + 100)
      .map((name) => `'${name.replaceAll("'", "\\'")}'`)
      .join(",");
    const query = `SELECT asset.resource_name, asset.name, asset.type, asset.image_asset.full_size.url, asset.youtube_video_asset.youtube_video_id FROM asset WHERE asset.resource_name IN (${list})`;
    const result = await googleAdsRequest<{ results?: GoogleAsset[] }>(
      `customers/${customerId}/googleAds:search`,
      token,
      { method: "POST", body: JSON.stringify({ query }) },
    );
    for (const row of result.results ?? []) {
      const asset = row.asset;
      if (!asset?.resourceName) continue;
      const videoId = asset.youtubeVideoAsset?.youtubeVideoId;
      assets.set(asset.resourceName, {
        name: asset.name,
        type: asset.type,
        videoId,
        url:
          asset.imageAsset?.fullSize?.url ||
          (videoId
            ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
            : undefined),
      });
    }
  }
  return assets;
}

/** 폴더의 Google Ads 계정 성과를 받아 기존 Google API 배치를 통째로 갈아 끼운다. */
export async function syncGoogleFolder(folder: AdSyncFolder, userId: string) {
  const connection = await prisma.googleAdConnection.findUnique({
    where: { projectId: folder.projectId },
  });
  if (!connection) throw new AdSyncError("Google Ads 계정이 연결되지 않았습니다.", 400);
  const accounts = (
    (Array.isArray(folder.mediaAccounts) ? folder.mediaAccounts : []) as Account[]
  ).filter((account) => account.platform === "GOOGLE" && account.accountId);
  if (!accounts.length)
    throw new AdSyncError("먼저 Google Ads 광고 계정을 폴더에 추가해주세요.", 400);

  try {
    const token = await googleAccessToken(
      decryptGoogleToken(connection.encryptedRefreshToken),
    );
    const since = kstDateOnly(folder.reportStart);
    const until = kstDateOnly(folder.reportEnd);
    const rows: GoogleRow[] = [];
    const creatives = new Map<string, Creative>();
    const query = `SELECT customer.id, customer.descriptive_name, customer.currency_code, campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.image_ad.name, ad_group_ad.ad.image_ad.image_url, ad_group_ad.ad.image_ad.preview_image_url, ad_group_ad.ad.responsive_display_ad.marketing_images, ad_group_ad.ad.responsive_display_ad.square_marketing_images, ad_group_ad.ad.responsive_display_ad.youtube_videos, ad_group_ad.ad.video_ad.video.asset, ad_group_ad.ad.video_responsive_ad.videos, ad_group_ad.ad.demand_gen_multi_asset_ad.marketing_images, ad_group_ad.ad.demand_gen_multi_asset_ad.square_marketing_images, ad_group_ad.ad.demand_gen_multi_asset_ad.portrait_marketing_images, ad_group_ad.ad.demand_gen_video_responsive_ad.videos, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.average_cpm, metrics.conversions, metrics.cost_per_conversion FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`;

    for (const account of accounts) {
      const customerId = googleCustomerId(account.accountId);
      const accountRows = await fetchAccountRows(customerId, token, query);
      rows.push(...accountRows);
      const names = [
        ...new Set(accountRows.flatMap((row) => assetRefs(row.adGroupAd?.ad))),
      ];
      if (names.length)
        for (const [name, asset] of await fetchAssets(customerId, token, names))
          creatives.set(name, asset);
    }

    const batch = await prisma.$transaction(async (tx) => {
      await tx.adPerformanceImportBatch.deleteMany({
        where: { folderId: folder.id, sourceType: "GOOGLE", fileName: "google-api-sync" },
      });
      const created = await tx.adPerformanceImportBatch.create({
        data: {
          workspaceId: folder.workspaceId,
          projectId: folder.projectId,
          folderId: folder.id,
          uploadedById: userId,
          sourceType: "GOOGLE",
          sourceName: "Google Ads",
          fileName: "google-api-sync",
          rowCount: rows.length,
          reportStart: folder.reportStart,
          reportEnd: folder.reportEnd,
        },
      });
      for (let offset = 0; offset < rows.length; offset += 1000) {
        await tx.adPerformanceRecord.createMany({
          data: rows.slice(offset, offset + 1000).map((row) => {
            const cost = micros(row.metrics?.costMicros);
            const conversions = Number(row.metrics?.conversions || 0);
            const clicks = Number(row.metrics?.clicks || 0);
            const day = row.segments?.date || since;
            const ad = row.adGroupAd?.ad;
            const refs = assetRefs(ad);
            const creative = refs
              .map((name) => creatives.get(name))
              .find((item) => item?.url);
            const isVideo = Boolean(
              ad?.type?.includes("VIDEO") ||
              refs.some((name) => creatives.get(name)?.videoId),
            );
            const adName =
              ad?.name ||
              ad?.imageAd?.name ||
              (ad?.id ? `Google 광고 ${ad.id}` : "이름 없는 광고");
            return {
              id: crypto.randomUUID(),
              batchId: created.id,
              workspaceId: folder.workspaceId,
              projectId: folder.projectId,
              folderId: folder.id,
              sourceType: "GOOGLE",
              accountId: row.customer?.id ?? null,
              accountName: row.customer?.descriptiveName ?? null,
              campaignId: row.campaign?.id ?? null,
              campaignName: row.campaign?.name || "이름 없는 캠페인",
              adGroupId: row.adGroup?.id ?? null,
              adGroupName: row.adGroup?.name ?? null,
              adId: ad?.id ?? null,
              adName,
              creativeId: refs[0] ?? ad?.id ?? null,
              creativeName: creative?.name ?? adName,
              thumbnailUrl:
                ad?.imageAd?.previewImageUrl ||
                ad?.imageAd?.imageUrl ||
                creative?.url ||
                null,
              creativeType: isVideo
                ? "VIDEO"
                : ad?.imageAd || creative?.url
                  ? "IMAGE"
                  : (ad?.type ?? null),
              status: row.adGroupAd?.status ?? null,
              reportDate: new Date(`${day}T00:00:00+09:00`),
              reportStart: new Date(`${day}T00:00:00+09:00`),
              reportEnd: new Date(`${day}T23:59:59+09:00`),
              currency: row.customer?.currencyCode || folder.currency,
              cost,
              impressions: Number(row.metrics?.impressions || 0),
              clicks,
              ctr: Number(row.metrics?.ctr || 0) * 100,
              cpc: micros(row.metrics?.averageCpc),
              cpm: micros(row.metrics?.averageCpm),
              conversions,
              costPerConversion:
                row.metrics?.costPerConversion == null
                  ? conversions
                    ? cost / conversions
                    : null
                  : micros(row.metrics.costPerConversion),
              conversionRate: clicks ? (conversions / clicks) * 100 : null,
              resultType: "conversions",
              resultBucket: "result",
              raw: row as unknown as Prisma.InputJsonValue,
            };
          }),
        });
      }
      await tx.googleAdConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncedAt: new Date(),
          status: "CONNECTED",
          lastSyncError: null,
        },
      });
      await tx.adPerformanceFolder.update({
        where: { id: folder.id },
        data: { lastSyncedAt: new Date() },
      });
      return created;
    });
    return { batchId: batch.id, rowCount: rows.length };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Google Ads 동기화에 실패했습니다.";
    await prisma.googleAdConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", lastSyncError: message },
    });
    throw new AdSyncError(message, 502);
  }
}
