import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decryptMetaToken, META_METRICS, metaGraph } from "@/lib/meta-ads";
import { ensureFreshMetaToken, recordMetaFailure } from "@/lib/meta-token";
import { adConnectionHealth } from "@/lib/ad-connection-health";

async function context(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") || "";
  const projectId = url.searchParams.get("projectId") || "";
  if (!user) return null;
  const [membership, project] = await Promise.all([
    prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId } } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } }),
  ]);
  if (!membership || project?.workspaceId !== workspaceId) return null;
  return { user, membership, workspaceId, projectId };
}

export async function GET(request: Request) {
  const ctx = await context(request);
  if (!ctx) return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  const connection = await prisma.metaAdConnection.findUnique({ where: { projectId: ctx.projectId } });
  if (!connection) return NextResponse.json({ connection: null, metrics: META_METRICS });
  let accounts: Array<{ id: string; name: string; currency?: string; timezone_name?: string }> = [];
  let accountsError: string | null = null;
  // 열 때마다 토큰 창을 앞으로 민다. 만료가 넉넉하면 네트워크를 타지 않는다.
  const renewal = await ensureFreshMetaToken(connection).catch(() => null);
  const token = renewal?.token ?? (() => { try { return decryptMetaToken(connection.encryptedAccessToken); } catch { return null; } })();
  if (renewal?.authError) accountsError = renewal.authError;
  else if (!token) accountsError = "저장된 Meta 토큰을 읽을 수 없어요 — 다시 연결해주세요.";
  else {
    try {
      const result = await metaGraph<{ data: typeof accounts }>("me/adaccounts", token, { fields: "id,name,currency,timezone_name,account_status", limit: "100" });
      accounts = result.data;
    } catch (error) {
      // **분류해 적는다.** 전에는 어떤 실패든 status 를 ERROR 로 내려서 멀쩡한 연결이
      // 끊긴 것처럼 보였다(src/lib/ad-connection-health.ts 머리말).
      await recordMetaFailure(connection.id, error);
      accountsError = error instanceof Error ? error.message : "Meta 계정 조회 실패";
    }
  }
  const current = (await prisma.metaAdConnection.findUnique({ where: { id: connection.id } })) ?? connection;
  return NextResponse.json({ connection: { id: current.id, status: current.status, adAccountId: current.adAccountId, adAccountName: current.adAccountName, enabledMetrics: current.enabledMetrics, lastSyncedAt: current.lastSyncedAt, lastSyncError: current.lastSyncError, health: adConnectionHealth(current), tokenKind: current.tokenKind, tokenExpiresAt: current.tokenExpiresAt, dataAccessExpiresAt: current.dataAccessExpiresAt }, accounts, accountsError, metrics: META_METRICS, canEdit: ctx.membership.role !== "MEMBER" });
}

export async function PATCH(request: Request) {
  const ctx = await context(request);
  if (!ctx || ctx.membership.role === "MEMBER") return NextResponse.json({ error: "설정 권한이 없습니다." }, { status: 403 });
  const body = await request.json() as { adAccountId?: string; enabledMetrics?: string[] };
  const connection = await prisma.metaAdConnection.findUnique({ where: { projectId: ctx.projectId } });
  if (!connection) return NextResponse.json({ error: "Meta 연결이 없습니다." }, { status: 404 });
  const allowed = new Set(META_METRICS.map((metric) => metric.key));
  const metrics = Array.isArray(body.enabledMetrics) ? body.enabledMetrics.filter((key) => allowed.has(key as never)) : undefined;
  let accountData = {};
  if (body.adAccountId) {
    const renewal = await ensureFreshMetaToken(connection).catch(() => null);
    const result = await metaGraph<{ data: Array<{ id: string; name: string; currency?: string; timezone_name?: string }> }>("me/adaccounts", renewal?.token ?? decryptMetaToken(connection.encryptedAccessToken), { fields: "id,name,currency,timezone_name", limit: "100" });
    const account = result.data.find((item) => item.id === body.adAccountId);
    if (!account) return NextResponse.json({ error: "접근할 수 없는 광고 계정입니다." }, { status: 400 });
    accountData = { adAccountId: account.id, adAccountName: account.name, currency: account.currency, timezoneName: account.timezone_name };
  }
  const updated = await prisma.metaAdConnection.update({ where: { id: connection.id }, data: { ...accountData, ...(metrics ? { enabledMetrics: metrics } : {}), status: "CONNECTED", lastSyncError: null } });
  return NextResponse.json({ connection: updated });
}
