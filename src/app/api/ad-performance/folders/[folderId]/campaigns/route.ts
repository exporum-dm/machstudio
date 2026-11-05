import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdFolderAccess } from "@/lib/ad-folder-access";
import { campaignAccountId, normalizeMediaAccounts } from "@/lib/ad-campaign-scope";
import { fetchAccountCampaigns } from "@/lib/ad-campaigns";
type Context = { params: Promise<{ folderId: string }> };

export async function GET(request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const params = new URL(request.url).searchParams;
  const account = normalizeMediaAccounts(access.folder.mediaAccounts).find(a => a.platform === params.get("platform") && a.accountId === params.get("accountId"));
  if (!account) return NextResponse.json({ error: "이 폴더에 연결된 광고 계정을 선택해주세요." }, { status: 400 });
  try {
    const campaigns = await fetchAccountCampaigns(access.folder.projectId, access.user.id, account, true);
    const stored = await prisma.adPerformanceRecord.findMany({ where: { folderId, sourceType: account.platform, accountId: { in: [account.accountId, campaignAccountId(account.platform, account.accountId)] }, campaignId: { not: null } }, select: { campaignId: true, campaignName: true }, distinct: ["campaignId"], take: 10001 });
    const all = new Map(campaigns.map(c => [c.id, c]));
    stored.forEach(c => { if (c.campaignId && !all.has(c.campaignId)) all.set(c.campaignId, { id: c.campaignId, name: c.campaignName, status: "과거 수집 자료" }); });
    if (all.size > 10000) throw new Error("캠페인 목록이 10,000개를 초과합니다.");
    return NextResponse.json({ campaigns: [...all.values()].sort((a, b) => a.name.localeCompare(b.name)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "캠페인을 불러오지 못했습니다." }, { status: 502 }); }
}

export async function PATCH(request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId, true);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null);
  const accounts = normalizeMediaAccounts(access.folder.mediaAccounts);
  const account = accounts.find(a => a.platform === body?.platform && a.accountId === body?.accountId);
  if (!account) return NextResponse.json({ error: "이 폴더에 연결된 광고 계정을 선택해주세요." }, { status: 400 });
  let next;
  try { next = normalizeMediaAccounts([{ ...account, campaignIds: body.campaignIds }])[0]; }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  if (body.campaignIds === undefined) return NextResponse.json({ error: "캠페인 선택을 지정해주세요." }, { status: 400 });
  if (next.campaignIds?.some(id => !account.campaignIds?.includes(id))) {
    try {
      const available = new Set((await fetchAccountCampaigns(access.folder.projectId, access.user.id, account)).map(c => c.id));
      const stored = await prisma.adPerformanceRecord.findMany({ where: { folderId, sourceType: account.platform, accountId: { in: [account.accountId, campaignAccountId(account.platform, account.accountId)] }, campaignId: { in: next.campaignIds } }, select: { campaignId: true }, distinct: ["campaignId"] });
      stored.forEach(r => { if (r.campaignId) available.add(r.campaignId); });
      if (next.campaignIds.some(id => !available.has(id))) return NextResponse.json({ error: "선택한 계정에 없는 캠페인이 포함되어 있습니다." }, { status: 400 });
    } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  }
  // 다른 계정의 동시 편집을 덮어쓰지 않는다.
  const saved = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AdPerformanceFolder" WHERE id=${folderId} FOR UPDATE`;
    const current = await tx.adPerformanceFolder.findUniqueOrThrow({ where: { id: folderId } });
    const currentAccounts = normalizeMediaAccounts(current.mediaAccounts);
    if (!currentAccounts.some(a => a.platform === account.platform && a.accountId === account.accountId)) throw new Error("계정 연결이 변경됐습니다. 새로고침해주세요.");
    return tx.adPerformanceFolder.update({ where: { id: folderId }, data: { mediaAccounts: JSON.parse(JSON.stringify(currentAccounts.map(a => a.platform === account.platform && a.accountId === account.accountId ? { ...a, campaignIds: next.campaignIds ?? undefined } : a))) } });
  });
  return NextResponse.json({ mediaAccounts: saved.mediaAccounts });
}
