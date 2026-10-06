import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getAdFolderAccess } from "@/lib/ad-folder-access";
import { decryptMetaToken } from "@/lib/meta-ads";
import { metaReportedCostPerResult, metaReportedResult } from "@/lib/meta-result-metrics";
import { findMetaConnection } from "@/lib/meta-connection";
import { fetchAdCreatives, type CreativeInfo } from "@/lib/meta-ad-creatives";

type Context = { params: Promise<{ folderId: string }> };
type MetaAccount = { platform: string; accountId: string; accountName?: string };
type MetaInsight = {
  date_start: string; date_stop: string; account_id?: string; account_name?: string;
  campaign_id?: string; campaign_name?: string; adset_id?: string; adset_name?: string;
  ad_id?: string; ad_name?: string; spend?: string; impressions?: string; reach?: string;
  inline_link_clicks?: string; inline_link_click_ctr?: string; cost_per_inline_link_click?: string; cpm?: string;
  results?: Array<{ action_type?: string; indicator?: string; name?: string; title?: string; value?: string; values?: Array<{ value?: string }> }>;
  objective_results?: Array<{ action_type?: string; indicator?: string; name?: string; title?: string; value?: string; values?: Array<{ value?: string }> }>;
  cost_per_result?: Array<{ value?: string; values?: Array<{ value?: string }> }>;
  actions?: Array<{ action_type: string; value: string }>;
};

// DB에는 UTC로 저장되지만 폴더 기간은 KST 달력일 기준 — naive toISOString().slice(0,10)은 자정 부근에 하루 밀려 Meta 조회 구간이 어긋난다.
function kstDateOnly(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

export async function POST(_request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId, true);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const connection = await findMetaConnection(access.folder.projectId, access.user.id);
  if (!connection) return NextResponse.json({ error: "연결된 Meta 계정이 없습니다." }, { status: 400 });
  const token = decryptMetaToken(connection.encryptedAccessToken);
  const accounts = (Array.isArray(access.folder.mediaAccounts) ? access.folder.mediaAccounts : []) as MetaAccount[];
  const metaAccounts = accounts.filter(account => account.platform === "META" && account.accountId);
  if (!metaAccounts.length) return NextResponse.json({ error: "먼저 Meta 광고 계정을 연결해주세요." }, { status: 400 });
  const version = process.env.META_GRAPH_VERSION || "v25.0";
  const since = kstDateOnly(access.folder.reportStart);
  const until = kstDateOnly(access.folder.reportEnd);
  const insights: MetaInsight[] = [];

  for (const account of metaAccounts) {
    const act = account.accountId.startsWith("act_") ? account.accountId : `act_${account.accountId}`;
    const fields = "date_start,date_stop,account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,inline_link_click_ctr,cost_per_inline_link_click,cpm,results,objective_results,cost_per_result,actions";
    let next: string | null = `https://graph.facebook.com/${version}/${act}/insights?level=ad&time_increment=1&limit=500&use_unified_attribution_setting=true&fields=${fields}&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&access_token=${encodeURIComponent(token)}`;
    while (next) {
      const response: Response = await fetch(next, { cache: "no-store" });
      const data: { data?: MetaInsight[]; paging?: { next?: string }; error?: { message?: string } } = await response.json();
      if (!response.ok) return NextResponse.json({ error: data?.error?.message || "Meta 데이터를 가져오지 못했습니다." }, { status: 502 });
      insights.push(...(data.data ?? []));
      next = data.paging?.next ?? null;
    }
  }

  const uniqueAdIds = [...new Set(insights.map(row => row.ad_id).filter((id): id is string => Boolean(id)))];
  const creativeMap = uniqueAdIds.length ? await fetchAdCreatives(token, version, uniqueAdIds) : new Map<string, CreativeInfo>();

  const batch = await prisma.$transaction(async tx => {
    await tx.adPerformanceImportBatch.deleteMany({ where: { folderId, sourceType: "META", fileName: "meta-api-sync" } });
    const created = await tx.adPerformanceImportBatch.create({ data: {
      workspaceId: access.folder.workspaceId, projectId: access.folder.projectId, folderId,
      uploadedById: access.user.id, sourceType: "META", sourceName: "Meta Ads", fileName: "meta-api-sync",
      rowCount: insights.length, reportStart: access.folder.reportStart, reportEnd: access.folder.reportEnd,
    }});
    for (let offset = 0; offset < insights.length; offset += 1000) {
      await tx.adPerformanceRecord.createMany({ data: insights.slice(offset, offset + 1000).map(row => {
        const cost = Number(row.spend || 0);
        const reportedResult = metaReportedResult(row.results, row.objective_results);
        const conversions = reportedResult.value;
        const linkClicks = Number(row.inline_link_clicks || 0);
        const creative = row.ad_id ? creativeMap.get(row.ad_id) : undefined;
        return {
          id: crypto.randomUUID(), batchId: created.id, workspaceId: access.folder.workspaceId, projectId: access.folder.projectId, folderId,
          sourceType: "META", accountId: row.account_id ?? null, accountName: row.account_name ?? null,
          campaignId: row.campaign_id ?? null, campaignName: row.campaign_name || "이름 없는 캠페인",
          adGroupId: row.adset_id ?? null, adGroupName: row.adset_name ?? null, adId: row.ad_id ?? null, adName: row.ad_name ?? null,
          creativeId: creative?.creativeId ?? null, creativeName: creative?.creativeName ?? row.ad_name ?? null,
          thumbnailUrl: creative?.thumbnailUrl ?? null, creativeType: creative?.creativeType ?? null,
          reportDate: new Date(`${row.date_start}T00:00:00+09:00`), reportStart: new Date(`${row.date_start}T00:00:00+09:00`), reportEnd: new Date(`${row.date_stop}T23:59:59+09:00`),
          currency: access.folder.currency, cost, impressions: Number(row.impressions || 0), reach: Number(row.reach || 0), clicks: linkClicks,
          ctr: Number(row.inline_link_click_ctr || 0), cpc: Number(row.cost_per_inline_link_click || 0), cpm: Number(row.cpm || 0), conversions,
          costPerConversion: metaReportedCostPerResult(row.cost_per_result, cost, conversions), conversionRate: linkClicks ? conversions / linkClicks * 100 : null,
          resultType: reportedResult.type, resultBucket: "result", raw: row as unknown as Prisma.InputJsonValue,
        };
      }) });
    }
    await tx.adPerformanceFolder.update({ where: { id: folderId }, data: { lastSyncedAt: new Date() } });
    return created;
  });
  return NextResponse.json({ ok: true, batchId: batch.id, rowCount: insights.length });
}
