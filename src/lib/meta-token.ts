/**
 * Meta 토큰의 수명 관리 — **연동이 저절로 풀리지 않게** 하는 자리.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────
 * OAuth 로 받은 Meta 장기 사용자 토큰은 **60일**이다. 지금까지 우리는 받은 토큰을 그대로
 * 넣어 두고 아무도 연장하지 않았다. 그래서 연결한 지 두 달이 되면 반드시 끊긴다 —
 * 운영자가 뭘 잘못한 게 아니다.
 *
 * Meta 는 장기 토큰을 다시 `fb_exchange_token` 에 넣으면 **새 60일 토큰**을 돌려준다.
 * 만료 25일 전부터 매일 시도하면 창이 계속 앞으로 밀려 사실상 끊기지 않는다.
 *
 * ── 그래도 남는 두 가지 ──────────────────────────────────────────────
 * · **데이터 접근 만료(90일)** — 토큰 연장으로 늘어나지 않고 사용자가 한 번 다시 로그인해야
 *   한다. 그래서 남은 날을 읽어 두고(`debug_token`) 화면이 미리 예고한다.
 * · **시스템 사용자 토큰** — 비즈니스 관리자에서 발급하면 **만료가 없다**. 대행사가 "안 풀리게"
 *   쓰는 방식이 이것이다. 붙여 넣으면 연장 시도를 아예 하지 않는다(`tokenKind`).
 *
 * 만료 시각은 운영자 말이 아니라 **Meta 가 말해 주는 값**을 쓴다(`debug_token`) — 교환
 * 응답의 `expires_in` 은 빠지는 경우가 있고, 시스템 사용자 토큰은 0(무기한)으로 온다.
 */
import { prisma } from "@/lib/prisma";
import { META_GRAPH_VERSION, decryptMetaToken, encryptMetaToken, MetaApiError } from "@/lib/meta-ads";
import {
  classifyMetaError,
  shouldRenewMetaToken,
  statusForErrorKind,
  type AdConnectionSnapshot,
} from "@/lib/ad-connection-health";

/** `debug_token` 이 돌려주는, 우리가 쓰는 것만. */
export interface MetaTokenInfo {
  valid: boolean;
  /** 만료 시각. **무기한이면 null**(시스템 사용자 토큰은 expires_at = 0 으로 온다). */
  expiresAt: Date | null;
  /** 데이터 접근 만료(90일). 없으면 null. */
  dataAccessExpiresAt: Date | null;
  /** "USER" | "SYSTEM_USER" | "PAGE" | "APP" — Meta 가 알려 주는 종류를 그대로 쓴다. */
  tokenKind: string;
  scopes: string[];
  userId: string | null;
  /** 유효하지 않을 때 Meta 가 적어 준 이유. */
  error: { code: number | null; subcode: number | null; message: string } | null;
}

function appToken() {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error("META_APP_ID 또는 META_APP_SECRET 이 설정되지 않았습니다.");
  return { appId, appSecret, value: `${appId}|${appSecret}` };
}

/** Meta 의 초 단위 시각 → Date. 0·없음은 "만료 없음" 이라 null 로 올린다. */
function fromUnixSeconds(value: unknown): Date | null {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/**
 * 토큰의 진짜 상태를 Meta 에 물어본다.
 *
 * 앱 토큰(`APP_ID|APP_SECRET`)으로 조회하므로 **죽은 토큰도 조회된다** — 그래서
 * "왜 죽었는지" 를 알 수 있다. 토큰 자신으로 아무 API 나 때려 보는 것보다 정확하다.
 */
export async function debugMetaToken(token: string): Promise<MetaTokenInfo> {
  const app = appToken();
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/debug_token`);
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", app.value);

  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as {
    data?: {
      is_valid?: boolean;
      expires_at?: number;
      data_access_expires_at?: number;
      type?: string;
      scopes?: string[];
      user_id?: string;
      error?: { code?: number; subcode?: number; message?: string };
    };
    error?: { message?: string; code?: number; error_subcode?: number };
  } | null;

  if (!response.ok || !body?.data) {
    throw new MetaApiError(
      body?.error?.message || `Meta 토큰 상태를 확인하지 못했습니다 (${response.status})`,
      { code: body?.error?.code ?? null, subcode: body?.error?.error_subcode ?? null, status: response.status },
    );
  }

  const data = body.data;
  return {
    valid: data.is_valid === true,
    expiresAt: fromUnixSeconds(data.expires_at),
    dataAccessExpiresAt: fromUnixSeconds(data.data_access_expires_at),
    tokenKind: data.type || "USER",
    scopes: Array.isArray(data.scopes) ? data.scopes : [],
    userId: data.user_id ?? null,
    error: data.error
      ? { code: data.error.code ?? null, subcode: data.error.subcode ?? null, message: data.error.message || "" }
      : null,
  };
}

/**
 * 장기 토큰을 **새 장기 토큰으로 교환**한다(60일 창을 앞으로 민다).
 *
 * Meta 가 같은 토큰을 그대로 돌려줄 수도 있다. 그래서 성공 여부는 돌아온 문자열이 아니라
 * **만료가 실제로 뒤로 갔는지**로 판단한다(`renewMetaConnectionToken`).
 */
export async function extendMetaToken(token: string): Promise<string> {
  const app = appToken();
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", app.appId);
  url.searchParams.set("client_secret", app.appSecret);
  url.searchParams.set("fb_exchange_token", token);

  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    error?: { message?: string; code?: number; error_subcode?: number };
  } | null;

  if (!response.ok || !body?.access_token) {
    throw new MetaApiError(body?.error?.message || `Meta 토큰 연장 실패 (${response.status})`, {
      code: body?.error?.code ?? null,
      subcode: body?.error?.error_subcode ?? null,
      status: response.status,
    });
  }
  return body.access_token;
}

/** 연장·점검 결과. 호출부는 `token` 만 쓰면 되고, 나머지는 기록·보고용이다. */
export interface MetaTokenRenewal {
  /** 지금 써야 하는 토큰 — 연장에 실패해도 **기존 토큰**이 들어온다(아직 살아 있을 수 있다). */
  token: string;
  /** 만료가 실제로 뒤로 밀렸나. */
  renewed: boolean;
  /** 점검을 돌렸나(네트워크를 탔나). */
  checked: boolean;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  /** 토큰이 죽어 있었다면 그 이유. */
  authError: string | null;
}

type RenewableConnection = AdConnectionSnapshot & {
  id: string;
  encryptedAccessToken: string;
};

/**
 * 연결의 토큰을 **필요할 때만** 연장·점검하고 DB 에 기록한다.
 *
 * 설계에서 지킨 세 가지:
 *  · **필요할 때만 네트워크를 탄다** — 만료가 넉넉하면 즉시 기존 토큰을 돌려준다(`force` 로 강제).
 *  · **실패해도 동기화를 막지 않는다** — 연장이 안 돼도 기존 토큰은 아직 살아 있다.
 *    여기서 예외를 던지면 "연장 실패" 가 "동기화 실패" 로 번진다.
 *  · 죽은 게 **확실할 때만** 상태를 EXPIRED 로 내린다(일시 장애로 연결을 끊지 않는다).
 */
export async function ensureFreshMetaToken(
  connection: RenewableConnection,
  options: { force?: boolean; now?: Date } = {},
): Promise<MetaTokenRenewal> {
  const now = options.now ?? new Date();
  const current = decryptMetaToken(connection.encryptedAccessToken);
  const idle: MetaTokenRenewal = {
    token: current,
    renewed: false,
    checked: false,
    expiresAt: connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null,
    dataAccessExpiresAt: connection.dataAccessExpiresAt ? new Date(connection.dataAccessExpiresAt) : null,
    authError: null,
  };

  if (!options.force && !shouldRenewMetaToken(connection, now)) return idle;

  // 1) 지금 상태를 먼저 읽는다 — 연장을 시도할 가치가 있는지, 종류가 뭔지 알아야 한다.
  let info: MetaTokenInfo;
  try {
    info = await debugMetaToken(current);
  } catch (error) {
    // 점검 자체가 실패했다(네트워크·앱 설정). 토큰 상태를 추정할 근거가 없으니 아무것도 바꾸지 않는다.
    const kind = classifyMetaError(error instanceof MetaApiError ? error : { message: String(error) });
    if (kind === "AUTH") {
      await markMetaTokenExpired(connection.id, error instanceof Error ? error.message : "토큰이 만료됐습니다");
      return { ...idle, checked: true, authError: error instanceof Error ? error.message : "토큰이 만료됐습니다" };
    }
    return idle;
  }

  if (!info.valid) {
    const reason = info.error?.message || "Meta 토큰이 더 이상 유효하지 않습니다";
    await markMetaTokenExpired(connection.id, reason, info);
    return { ...idle, checked: true, authError: reason };
  }

  // 2) 시스템 사용자 토큰은 만료가 없다 — 종류만 적어 두고 연장은 건너뛴다.
  if (info.tokenKind === "SYSTEM_USER" || !info.expiresAt) {
    await prisma.metaAdConnection.update({
      where: { id: connection.id },
      data: {
        tokenKind: info.tokenKind,
        tokenExpiresAt: null,
        dataAccessExpiresAt: info.dataAccessExpiresAt,
        tokenCheckedAt: now,
        ...(connection.status === "EXPIRED" ? { status: "CONNECTED", lastSyncError: null } : {}),
      },
    });
    return { token: current, renewed: false, checked: true, expiresAt: null, dataAccessExpiresAt: info.dataAccessExpiresAt, authError: null };
  }

  // 3) 연장 시도. 실패는 기록만 하고 넘어간다 — 기존 토큰이 아직 살아 있다.
  let nextToken = current;
  let nextInfo = info;
  try {
    const exchanged = await extendMetaToken(current);
    const exchangedInfo = await debugMetaToken(exchanged);
    if (exchangedInfo.valid && exchangedInfo.expiresAt && (!info.expiresAt || exchangedInfo.expiresAt > info.expiresAt)) {
      nextToken = exchanged;
      nextInfo = exchangedInfo;
    }
  } catch (error) {
    const kind = classifyMetaError(error instanceof MetaApiError ? error : { message: String(error) });
    if (kind === "AUTH") {
      const reason = error instanceof Error ? error.message : "토큰 연장이 거부됐습니다";
      await markMetaTokenExpired(connection.id, reason, info);
      return { ...idle, checked: true, authError: reason };
    }
    // 일시 실패 — 만료는 아직 남았다. 다음 점검에서 다시 시도한다.
  }

  const renewed = nextToken !== current;
  await prisma.metaAdConnection.update({
    where: { id: connection.id },
    data: {
      ...(renewed ? { encryptedAccessToken: encryptMetaToken(nextToken), tokenRefreshedAt: now } : {}),
      tokenKind: nextInfo.tokenKind,
      tokenExpiresAt: nextInfo.expiresAt,
      dataAccessExpiresAt: nextInfo.dataAccessExpiresAt,
      tokenCheckedAt: now,
      // 멀쩡한 걸 확인했으니 전에 끊겼다고 적어 둔 건 거둔다.
      ...(connection.status === "EXPIRED" ? { status: "CONNECTED", lastSyncError: null } : {}),
    },
  });

  return {
    token: nextToken,
    renewed,
    checked: true,
    expiresAt: nextInfo.expiresAt,
    dataAccessExpiresAt: nextInfo.dataAccessExpiresAt,
    authError: null,
  };
}

async function markMetaTokenExpired(id: string, reason: string, info?: MetaTokenInfo) {
  await prisma.metaAdConnection.update({
    where: { id },
    data: {
      status: "EXPIRED",
      lastSyncError: reason.slice(0, 500),
      tokenCheckedAt: new Date(),
      ...(info ? { tokenExpiresAt: info.expiresAt, dataAccessExpiresAt: info.dataAccessExpiresAt, tokenKind: info.tokenKind } : {}),
    },
  });
}

/**
 * 동기화·조회가 실패했을 때 연결 상태를 어떻게 적을지.
 *
 * **일시적 실패에는 상태를 건드리지 않는다** — 그게 "멀쩡한 연결이 풀린 것처럼 보이는"
 * 체감 고장의 원인이었다. 메시지는 남겨 화면이 무슨 일이 있었는지 보여 줄 수 있게 한다.
 */
export async function recordMetaFailure(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const kind = classifyMetaError(error instanceof MetaApiError ? error : { message });
  const status = statusForErrorKind(kind);
  await prisma.metaAdConnection.update({
    where: { id },
    data: { lastSyncError: message.slice(0, 500), ...(status ? { status } : {}) },
  });
  return kind;
}
