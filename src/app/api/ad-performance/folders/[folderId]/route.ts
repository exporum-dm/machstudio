import { normalizeMediaAccounts } from "@/lib/ad-campaign-scope";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdFolderAccess } from "@/lib/ad-folder-access";
import { normalizeAdDetailColumns } from "@/lib/meta-result-metrics";

type Context = { params: Promise<{ folderId: string }> };

function dateOnly(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(_request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json({ folder: access.folder, project: access.project });
}

export async function PATCH(request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId, true);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null);
  const data: { name?: string; description?: string | null; mediaAccounts?: object[]; reportStart?: Date; reportEnd?: Date; detailColumns?: string[] } = {};
  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 100);
  if (typeof body?.description === "string") data.description = body.description.trim().slice(0, 500) || null;
  if (body?.mediaAccounts !== undefined) {
    try { data.mediaAccounts = normalizeMediaAccounts(body.mediaAccounts); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  }
  if (body?.detailColumns !== undefined) data.detailColumns = normalizeAdDetailColumns(body.detailColumns);
  if (body?.reportStart !== undefined || body?.reportEnd !== undefined) {
    const reportStart = dateOnly(body?.reportStart) ?? access.folder.reportStart;
    const reportEnd = dateOnly(body?.reportEnd) ?? access.folder.reportEnd;
    if (reportStart > reportEnd) return NextResponse.json({ error: "종료일은 시작일보다 빠를 수 없습니다." }, { status: 400 });
    data.reportStart = reportStart;
    data.reportEnd = reportEnd;
  }
  const folder = await prisma.$transaction(async tx => {
    if (data.mediaAccounts) {
      await tx.$queryRaw`SELECT id FROM "AdPerformanceFolder" WHERE id=${folderId} FOR UPDATE`;
      const current = await tx.adPerformanceFolder.findUniqueOrThrow({ where: { id: folderId } });
      const previous = normalizeMediaAccounts(current.mediaAccounts);
      // 계정 추가·삭제는 기존 캠페인 범위를 유지한다. 범위 변경은 검증된 전용 API만 담당한다.
      data.mediaAccounts = normalizeMediaAccounts(data.mediaAccounts).map(a => {
        const saved = previous.find(p => p.platform === a.platform && p.accountId === a.accountId);
        const base = { platform: a.platform, accountId: a.accountId, accountName: a.accountName };
        return saved?.campaignIds ? { ...base, campaignIds: saved.campaignIds } : base;
      });
    }
    return tx.adPerformanceFolder.update({ where: { id: folderId }, data });
  });
  return NextResponse.json({ folder });
}

export async function DELETE(_request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId, true);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  await prisma.adPerformanceFolder.delete({ where: { id: folderId } });
  return NextResponse.json({ ok: true });
}
