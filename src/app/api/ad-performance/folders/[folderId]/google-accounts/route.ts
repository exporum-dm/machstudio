import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdFolderAccess } from "@/lib/ad-folder-access";
import { decryptGoogleToken, googleAccessToken, googleAdsRequest, googleCustomerId } from "@/lib/google-ads";
import { adConnectionHealth, classifyGoogleError, statusForErrorKind } from "@/lib/ad-connection-health";

type Context = { params: Promise<{ folderId: string }> };
type Row = { customerClient?: { clientCustomer?: string; descriptiveName?: string; currencyCode?: string; timeZone?: string; manager?: boolean; status?: string } };
export async function GET(_request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const connection = await prisma.googleAdConnection.findUnique({ where: { projectId: access.folder.projectId } });
  if (!connection) return NextResponse.json({ connected: false, accounts: [] });
  const meta = {
    lastSyncedAt: connection.lastSyncedAt,
    lastSyncError: connection.lastSyncError,
    status: connection.status,
    health: adConnectionHealth(connection),
  };
  try {
    const token = await googleAccessToken(decryptGoogleToken(connection.encryptedRefreshToken));
    const managerId = googleCustomerId(process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID || "");
    const result = await googleAdsRequest<{ results?: Row[] }>(`customers/${managerId}/googleAds:search`, token, { method: "POST", body: JSON.stringify({ query: "SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level <= 1" }) });
    const accounts = (result.results ?? []).map((row) => row.customerClient).filter((item): item is NonNullable<typeof item> => Boolean(item?.clientCustomer && !item.manager)).map((item) => ({ id: googleCustomerId(item.clientCustomer || ""), name: item.descriptiveName || item.clientCustomer || "Google Ads", currency: item.currencyCode, timezone: item.timeZone, status: item.status }));
    return NextResponse.json({ connected: true, email: connection.email, accounts, ...meta });
  } catch (error) {
    // 계정 목록을 못 받아와도 이미 연결된 계정 카드는 계속 보여준다 — lastSyncError 와 별개로,
    // "지금 이 요청"이 실패한 이유도 같이 보여준다(둘이 다른 원인일 수 있다).
    const message = error instanceof Error ? error.message : "Google Ads 계정을 불러오지 못했습니다.";
    /**
     * 끊긴 게 **확실할 때만** 상태를 내린다. 전에는 이 실패가 상태를 바꾸지 않았는데,
     * 동기화 쪽은 어떤 실패든 "ERROR" 로 적어서 두 화면이 서로 다른 말을 했다.
     * 이제 양쪽이 같은 분류를 쓴다(src/lib/ad-connection-health.ts).
     */
    const nextStatus = statusForErrorKind(classifyGoogleError(message));
    if (nextStatus && nextStatus !== connection.status) {
      await prisma.googleAdConnection.update({ where: { id: connection.id }, data: { status: nextStatus, lastSyncError: message.slice(0, 500) } });
    }
    const status = nextStatus ?? connection.status;
    return NextResponse.json(
      { connected: true, email: connection.email, accounts: [], accountsError: message, ...meta, status, health: adConnectionHealth({ ...connection, status }) },
      { status: 200 },
    );
  }
}
