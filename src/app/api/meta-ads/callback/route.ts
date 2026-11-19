import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getPublicAppOrigin } from "@/lib/app-url";
import { DEFAULT_META_METRICS, encryptMetaToken, metaGraph, verifyMetaState } from "@/lib/meta-ads";
import { debugMetaToken } from "@/lib/meta-token";

type State = { workspaceId: string; projectId: string; folderId?: string; userId: string; issuedAt: number };

export async function GET(request: Request) {
  const origin = getPublicAppOrigin();
  const url = new URL(request.url);
  const state = verifyMetaState<State>(url.searchParams.get("state") || "");
  const destination = state?.folderId ? `${origin}/analytics/${state.folderId}?tab=connections` : `${origin}/analytics`;
  const done = (status: string) => NextResponse.redirect(`${destination}${destination.includes("?") ? "&" : "?"}meta=${status}`);
  const code = url.searchParams.get("code");
  if (!state || !code || Date.now() - state.issuedAt > 10 * 60_000) return done("error");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== state.userId) return done("error");
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret || !origin) return done("config");
  try {
    const tokenUrl = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", `${origin}/api/meta-ads/callback`);
    tokenUrl.searchParams.set("code", code);
    const tokenResponse = await fetch(tokenUrl, { cache: "no-store" });
    const token = await tokenResponse.json() as { access_token?: string; error?: { message?: string } };
    if (!tokenResponse.ok || !token.access_token) throw new Error(token.error?.message || "토큰 교환 실패");
    const longLivedUrl = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
    longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
    longLivedUrl.searchParams.set("client_id", appId);
    longLivedUrl.searchParams.set("client_secret", appSecret);
    longLivedUrl.searchParams.set("fb_exchange_token", token.access_token);
    const longLivedResponse = await fetch(longLivedUrl, { cache: "no-store" });
    const longLived = await longLivedResponse.json() as { access_token?: string };
    const accessToken = longLivedResponse.ok && longLived.access_token ? longLived.access_token : token.access_token;
    const me = await metaGraph<{ id: string }>("me", accessToken, { fields: "id" });
    /**
     * 토큰 수명을 **Meta 에 물어서** 적어 둔다 — 교환 응답의 expires_in 은 빠지는 경우가 있고,
     * 데이터 접근 만료(90일)는 거기에 아예 없다. 이 값이 있어야 만료 전에 연장·예고할 수 있다.
     * 못 읽어도 연결 자체는 성공시킨다(첫 자동 점검이 채운다).
     */
    const info = await debugMetaToken(accessToken).catch(() => null);
    const lifecycle = {
      tokenKind: info?.tokenKind ?? "USER",
      tokenExpiresAt: info?.expiresAt ?? null,
      dataAccessExpiresAt: info?.dataAccessExpiresAt ?? null,
      tokenCheckedAt: info ? new Date() : null,
    };
    await prisma.metaAdConnection.upsert({
      where: { projectId: state.projectId },
      create: { workspaceId: state.workspaceId, projectId: state.projectId, encryptedAccessToken: encryptMetaToken(accessToken), metaUserId: me.id, connectedById: user.id, enabledMetrics: DEFAULT_META_METRICS, ...lifecycle },
      update: { encryptedAccessToken: encryptMetaToken(accessToken), metaUserId: me.id, connectedById: user.id, status: "CONNECTED", lastSyncError: null, tokenRefreshedAt: new Date(), ...lifecycle },
    });
    return done("connected");
  } catch (error) {
    console.error("[meta-ads callback]", error);
    return done("error");
  }
}
