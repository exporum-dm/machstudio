import { NextResponse } from "next/server";
import { getAdFolderAccess } from "@/lib/ad-folder-access";
import { decryptMetaToken, metaGraph } from "@/lib/meta-ads";
import { findMetaConnection } from "@/lib/meta-connection";
import { ensureFreshMetaToken, recordMetaFailure } from "@/lib/meta-token";
import { adConnectionHealth } from "@/lib/ad-connection-health";

type Context = { params: Promise<{ folderId: string }> };
type Account = { id: string; name: string; currency?: string; timezone_name?: string; account_status?: number };

/**
 * 폴더 연결 화면이 읽는 Meta 상태.
 *
 * ── 여기서 고친 체감 고장 ────────────────────────────────────────────
 * 전에는 광고 계정 목록 조회가 **어떤 이유로든** 실패하면 502 를 돌려줬다. 화면은 응답이
 * 실패하면 `connected` 를 세우지 않으니(초기값 false), 속도 제한 한 번·Meta 쪽 일시 장애
 * 한 번에 "Meta 계정 연결" 버튼이 다시 나타났다 — 운영자에게는 **연동이 풀린 것**이다.
 * 그래서 멀쩡한 연결을 끊고 다시 맺었고, 재연결은 성공하니 원인이 안 드러났다.
 *
 * 이제 연결 행이 있으면 `connected: true` 를 **항상** 내려보내고, 이번 호출이 실패한 이유는
 * `accountsError` 로 따로 알린다(Google 쪽이 이미 쓰던 방식과 같게 맞췄다).
 * 끊긴 게 확실한지는 `health.level` 이 말해 준다.
 */
export async function GET(_request: Request, context: Context) {
  const { folderId } = await context.params;
  const access = await getAdFolderAccess(folderId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const connection = await findMetaConnection(access.folder.projectId, access.user.id);
  if (!connection) return NextResponse.json({ connected: false, accounts: [] });

  // 화면을 열 때마다 토큰 창을 앞으로 민다 — 만료가 넉넉하면 네트워크를 타지 않는다.
  let token: string | null = null;
  let authError: string | null = null;
  try {
    const renewal = await ensureFreshMetaToken(connection);
    token = renewal.token;
    authError = renewal.authError;
  } catch {
    // 연장 경로가 터져도 저장된 토큰은 아직 쓸 수 있다 — 조회를 포기하지 않는다.
    try { token = decryptMetaToken(connection.encryptedAccessToken); } catch { token = null; }
  }

  // 연장이 DB 를 고쳤을 수 있어 다시 읽는다 — 화면이 보는 상태와 실제가 어긋나지 않게.
  const current = (await findMetaConnection(access.folder.projectId, access.user.id)) ?? connection;
  const base = {
    connected: true,
    status: current.status,
    health: adConnectionHealth(current),
    tokenKind: current.tokenKind,
    tokenExpiresAt: current.tokenExpiresAt,
    dataAccessExpiresAt: current.dataAccessExpiresAt,
    lastSyncedAt: current.lastSyncedAt,
    lastSyncError: current.lastSyncError,
  };

  if (!token) {
    return NextResponse.json({
      ...base,
      accounts: [],
      accountsError: "저장된 Meta 토큰을 읽을 수 없어요 — \"다시 연결\"을 눌러주세요.",
    });
  }
  // 토큰이 죽은 걸 이미 확인했다면 Graph 를 때려 볼 이유가 없다(상태는 연장 쪽이 적어 뒀다).
  if (authError) return NextResponse.json({ ...base, accounts: [], accountsError: authError });

  try {
    const result = await metaGraph<{ data: Account[] }>("me/adaccounts", token, {
      fields: "id,name,currency,timezone_name,account_status",
      limit: "100",
    });
    return NextResponse.json({ ...base, accounts: result.data });
  } catch (error) {
    const kind = await recordMetaFailure(current.id, error);
    const message = error instanceof Error ? error.message : "Meta 광고 계정을 불러오지 못했습니다.";
    const status = kind === "AUTH" ? "EXPIRED" : kind === "PERMISSION" ? "PERMISSION" : current.status;
    return NextResponse.json({
      ...base,
      status,
      // 상태가 방금 바뀌었을 수 있다 — 화면이 한 번 더 읽지 않아도 되게 다시 계산해 준다.
      health: adConnectionHealth({ ...current, status }),
      accounts: [],
      accountsError: message,
    });
  }
}
