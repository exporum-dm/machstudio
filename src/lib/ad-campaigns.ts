import { prisma } from "@/lib/prisma";
import { findMetaConnection } from "@/lib/meta-connection";
import { decryptMetaToken, metaGraph } from "@/lib/meta-ads";
import { decryptGoogleToken, googleAccessToken, googleAdsRequest } from "@/lib/google-ads";
import { campaignAccountId, type AccountCampaign, type MediaAccount } from "@/lib/ad-campaign-scope";
import { MemoryCache } from "@/lib/cache";
const campaignCache = new MemoryCache<AccountCampaign[]>(60_000);

/** 성과 발생 기간과 무관한 계정 캠페인 목록. 광고 계정은 호출 전에 URL 폴더의 연결 목록으로 검증한다. */
export async function fetchAccountCampaigns(projectId: string, userId: string, account: MediaAccount, refresh = false) {
  const id = campaignAccountId(account.platform, account.accountId);
  if (!/^\d+$/.test(id)) throw new Error("광고 계정 ID를 확인해주세요.");
  const cacheKey = JSON.stringify([projectId, userId, account.platform, id]);
  const cached = refresh ? null : campaignCache.get(cacheKey);
  if (cached) return cached;
  const campaigns: AccountCampaign[] = [];
  if (account.platform === "META") {
    const connection = await findMetaConnection(projectId, userId);
    if (!connection) throw new Error("Meta 계정을 먼저 연결해주세요.");
    const token = decryptMetaToken(connection.encryptedAccessToken);
    let after: string | undefined;
    do {
      const data = await metaGraph<{ data: Array<{ id: string; name: string; effective_status?: string }>; paging?: { next?: string; cursors?: { after?: string } } }>(`act_${id}/campaigns`, token, { fields: "id,name,effective_status", limit: "500", ...(after ? { after } : {}) });
      campaigns.push(...data.data.map(c => ({ id: c.id, name: c.name, status: c.effective_status })));
      const next = data.paging?.next ? data.paging.cursors?.after : undefined;
      if (data.paging?.next && (!next || next === after)) throw new Error("캠페인 목록을 끝까지 읽지 못했습니다. 다시 시도해주세요.");
      after = next;
      if (campaigns.length > 10000) throw new Error("캠페인 목록이 10,000개를 초과합니다.");
    } while (after);
  } else if (account.platform === "GOOGLE") {
    const connection = await prisma.googleAdConnection.findUnique({ where: { projectId } });
    if (!connection) throw new Error("Google Ads 계정을 먼저 연결해주세요.");
    const token = await googleAccessToken(decryptGoogleToken(connection.encryptedRefreshToken));
    let pageToken: string | undefined;
    do {
      const data = await googleAdsRequest<{ results?: Array<{ campaign?: { id?: string; name?: string; status?: string } }>; nextPageToken?: string }>(`customers/${id}/googleAds:search`, token, { method: "POST", body: JSON.stringify({ query: "SELECT campaign.id, campaign.name, campaign.status FROM campaign ORDER BY campaign.name", ...(pageToken ? { pageToken } : {}) }) });
      campaigns.push(...(data.results ?? []).flatMap(r => r.campaign?.id ? [{ id: r.campaign.id, name: r.campaign.name || r.campaign.id, status: r.campaign.status }] : []));
      if (data.nextPageToken && data.nextPageToken === pageToken) throw new Error("캠페인 목록을 끝까지 읽지 못했습니다.");
      pageToken = data.nextPageToken;
      if (campaigns.length > 10000) throw new Error("캠페인 목록이 10,000개를 초과합니다.");
    } while (pageToken);
  } else throw new Error("캠페인 선택은 Meta와 Google Ads에서 지원합니다.");
  campaignCache.set(cacheKey, campaigns);
  return campaigns;
}
