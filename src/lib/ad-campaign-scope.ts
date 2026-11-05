import type { Prisma } from "@/generated/prisma";

export type MediaAccount = { platform: string; accountId: string; accountName: string; campaignIds?: string[] };
export type AccountCampaign = { id: string; name: string; status?: string };
export const campaignAccountId = (platform: string, id: string) => platform === "META" ? id.replace(/^act_/, "") : platform === "GOOGLE" ? id.replace(/-/g, "") : id;

export function normalizeMediaAccounts(value: unknown): MediaAccount[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("광고 계정은 최대 20개까지 연결할 수 있습니다.");
  const seen = new Set<string>();
  return value.map((v) => {
    if (!v || typeof v !== "object" || typeof v.platform !== "string" || typeof v.accountId !== "string" || !v.accountId.trim()) throw new Error("광고 계정 정보를 확인해주세요.");
    const account: MediaAccount = { platform: v.platform, accountId: v.accountId.trim().slice(0, 100), accountName: typeof v.accountName === "string" ? v.accountName.slice(0, 200) : v.accountId };
    const key = `${account.platform}:${campaignAccountId(account.platform, account.accountId)}`;
    if (seen.has(key)) throw new Error("같은 광고 계정을 중복으로 연결할 수 없습니다.");
    seen.add(key);
    if (v.campaignIds != null) {
      if (!Array.isArray(v.campaignIds) || v.campaignIds.length > 2000 || v.campaignIds.some((id: unknown) => typeof id !== "string" || !/^\d{1,30}$/.test(id))) throw new Error("캠페인 ID를 확인해주세요. 최대 2,000개까지 선택할 수 있습니다.");
      account.campaignIds = [...new Set<string>(v.campaignIds)];
    }
    return account;
  });
}

/** undefined = 전체(기존 동작), [] = 명시적으로 선택 없음. */
export function adCampaignScope(raw: unknown): Prisma.AdPerformanceRecordWhereInput {
  const accounts = (Array.isArray(raw) ? raw : []) as MediaAccount[];
  const platforms = [...new Set(accounts.filter(a => Array.isArray(a.campaignIds)).map(a => a.platform))];
  if (!platforms.length) return {};
  return { AND: platforms.map(platform => ({ OR: [
    { sourceType: { not: platform } },
    ...accounts.filter(a => a.platform === platform).map(a => ({
      sourceType: platform,
      accountId: { in: [...new Set([a.accountId, campaignAccountId(platform, a.accountId), ...(platform === "META" ? [`act_${campaignAccountId(platform, a.accountId)}`] : [])])] },
      ...(Array.isArray(a.campaignIds) ? { campaignId: { in: a.campaignIds } } : {}),
    })),
  ] })) };
}

export function projectAdCampaignScope(folders: Array<{ id: string; mediaAccounts: unknown }>): Prisma.AdPerformanceRecordWhereInput {
  const restricted = folders.map(f => ({ id: f.id, scope: adCampaignScope(f.mediaAccounts) })).filter(f => Object.keys(f.scope).length);
  return restricted.length ? { OR: [{ folderId: null }, { folderId: { notIn: restricted.map(f => f.id) } }, ...restricted.map(f => ({ folderId: f.id, ...f.scope }))] } : {};
}
