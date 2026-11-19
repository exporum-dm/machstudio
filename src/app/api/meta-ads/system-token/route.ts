/**
 * **만료 없는 Meta 토큰 붙여넣기** — 연동이 영구히 안 풀리게 하는 길.
 *
 * OAuth 로 받는 사용자 토큰은 아무리 연장해도 두 가지 시계를 못 피한다: 60일 만료(연장으로
 * 밀 수 있다)와 **90일 데이터 접근 만료**(연장으로 안 늘어나고 사람이 다시 로그인해야 한다).
 * 비즈니스 관리자에서 발급하는 **시스템 사용자 토큰**은 사람에 묶이지 않아 둘 다 없다 —
 * 대행사가 "안 풀리게" 운영하는 방식이 이것이다.
 *
 * 받은 문자열을 믿지 않는다. `debug_token` 으로 **Meta 에 물어** 유효한지·종류가 뭔지·만료가
 * 있는지 확인하고, `me/adaccounts` 로 실제 광고 계정을 읽을 수 있는지까지 본 다음 저장한다.
 * (붙여 넣은 토큰이 우리 앱으로 발급된 것이 아니면 debug_token 이 거부한다 — 그 경우를
 * 운영자가 알아볼 수 있는 문구로 돌려준다.)
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_META_METRICS, encryptMetaToken, metaGraph } from "@/lib/meta-ads";
import { debugMetaToken } from "@/lib/meta-token";
import { adConnectionHealth } from "@/lib/ad-connection-health";
import { getAdFolderAccess } from "@/lib/ad-folder-access";
import { logActivity } from "@/lib/activity";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { folderId?: string; token?: string };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!body.folderId || !token) return NextResponse.json({ error: "폴더와 토큰이 필요합니다." }, { status: 400 });
  if (token.length > 1000) return NextResponse.json({ error: "토큰이 너무 길어요 — 다시 복사해주세요." }, { status: 400 });

  // 소속은 화면이 보낸 값이 아니라 **폴더 id 로 서버가 찾는다**(AGENTS.md ②).
  const access = await getAdFolderAccess(body.folderId, true);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { workspaceId, projectId } = access.folder;

  // 1) Meta 에 물어본다 — 유효한지, 종류가 뭔지, 만료가 있는지.
  let info;
  try {
    info = await debugMetaToken(token);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          "이 토큰을 확인할 수 없어요. 비즈니스 관리자에서 **우리 앱을 선택해** 발급한 토큰인지 확인해주세요. " +
          (error instanceof Error ? `(${error.message})` : ""),
      },
      { status: 400 },
    );
  }
  if (!info.valid) {
    return NextResponse.json(
      { error: `Meta 가 이 토큰을 거부했어요. ${info.error?.message ?? ""}`.trim() },
      { status: 400 },
    );
  }
  if (!info.scopes.includes("ads_read")) {
    return NextResponse.json(
      { error: "토큰에 ads_read 권한이 없어요 — 발급할 때 ads_read 를 체크해주세요." },
      { status: 400 },
    );
  }

  // 2) 실제로 광고 계정을 읽을 수 있는지까지 확인한다 — 저장한 뒤 첫 동기화에서 알게 되면 늦다.
  try {
    await metaGraph<{ data: unknown[] }>("me/adaccounts", token, { fields: "id", limit: "1" });
  } catch (error) {
    return NextResponse.json(
      {
        error: `토큰은 유효하지만 광고 계정을 읽지 못했어요 — 시스템 사용자에게 광고 계정 권한을 주었는지 확인해주세요. ${
          error instanceof Error ? `(${error.message})` : ""
        }`,
      },
      { status: 400 },
    );
  }

  const lifecycle = {
    tokenKind: info.tokenKind,
    tokenExpiresAt: info.expiresAt,
    dataAccessExpiresAt: info.dataAccessExpiresAt,
    tokenCheckedAt: new Date(),
    tokenRefreshedAt: new Date(),
  };
  const saved = await prisma.metaAdConnection.upsert({
    where: { projectId },
    create: {
      workspaceId,
      projectId,
      encryptedAccessToken: encryptMetaToken(token),
      metaUserId: info.userId,
      connectedById: user.id,
      enabledMetrics: DEFAULT_META_METRICS,
      ...lifecycle,
    },
    update: {
      encryptedAccessToken: encryptMetaToken(token),
      metaUserId: info.userId,
      connectedById: user.id,
      status: "CONNECTED",
      lastSyncError: null,
      ...lifecycle,
    },
  });

  await logActivity({
    workspaceId,
    userId: user.id,
    action: "analytics.meta_system_token_set",
    meta: { projectId, tokenKind: info.tokenKind, expiresAt: info.expiresAt?.toISOString() ?? null },
  });

  return NextResponse.json({
    ok: true,
    tokenKind: info.tokenKind,
    health: adConnectionHealth(saved),
    // 만료가 없으면 이게 진짜 "안 풀리는" 연결이다 — 화면이 그 사실을 알려 준다.
    neverExpires: !info.expiresAt,
  });
}
