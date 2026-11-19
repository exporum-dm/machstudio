/**
 * 광고 매체 연동이 **정말 끊긴 것**과 **잠깐 실패한 것**을 가른다 — 순수 모듈.
 *
 * ── 왜 이 구분이 전부인가 ─────────────────────────────────────────────
 * 운영자가 "연동이 자꾸 풀린다" 고 느끼는 상황은 거의 두 종류다:
 *
 *  1. 토큰이 **실제로** 죽었다. Meta 장기 토큰은 60일이고, 아무도 연장해 주지 않으면 죽는다.
 *     Google 갱신 토큰은 사용자가 권한을 거두거나 OAuth 앱이 "테스트" 상태면 죽는다.
 *  2. 토큰은 멀쩡한데 **그 순간 호출이 실패**했다(속도 제한, Meta 쪽 일시 장애, 네트워크).
 *     이때 화면이 "연결 안 됨" 으로 보이면 운영자는 멀쩡한 연결을 끊고 다시 맺는다.
 *     재연결은 성공하니 "풀렸다가 다시 붙었다" 로 기억되고, 이게 반복된다.
 *
 * 2번을 1번처럼 다루는 게 체감 고장의 대부분이다. 그래서 오류를 **분류**하고,
 * 일시적 실패에는 연결 상태를 건드리지 않는다.
 *
 * 이 모듈은 네트워크를 타지 않는다 — 분류 규칙이 이 기능에서 가장 비싼 판단이라
 * 매체 API 없이 테스트돼야 한다(실제 호출은 meta-token.ts).
 */

/** 오류의 성격. 상태를 바꿀지, 운영자에게 무엇을 시킬지가 여기서 갈린다. */
export type AdErrorKind =
  /** 토큰이 죽었다 — 운영자가 다시 연결해야 한다. */
  | "AUTH"
  /** 토큰은 살았지만 그 계정에 접근할 권한이 없다 — 매체 쪽 권한을 손봐야 한다. */
  | "PERMISSION"
  /** 우리 환경변수·앱 심사 문제 — 운영자가 할 수 있는 게 없다. */
  | "CONFIG"
  /** 잠깐 실패했다 — 다음 동기화에 저절로 낫는다. **연결 상태를 건드리면 안 된다.** */
  | "TRANSIENT"
  /** 분류 불가. 보수적으로 상태를 건드리지 않는다. */
  | "OTHER";

/**
 * Meta 오류 코드 분류.
 *
 * 190 은 "액세스 토큰이 유효하지 않음" 이고 subcode 가 왜인지 알려 준다(463 만료,
 * 460 비밀번호 변경, 458 앱 권한 해제, 459 체크포인트, 464 미확인 사용자).
 * 어느 쪽이든 운영자가 다시 연결해야 하는 건 같다.
 *
 * 4·17·32·341·613·80000번대는 **속도 제한**이다. 토큰은 멀쩡하다.
 * 1·2 는 Meta 쪽 일시 오류다 — 문서가 "같은 요청을 다시 보내라" 고 안내하는 코드다.
 */
export function classifyMetaError(error: {
  code?: number | null;
  subcode?: number | null;
  status?: number | null;
  message?: string | null;
}): AdErrorKind {
  const code = error.code ?? null;
  const message = (error.message ?? "").toLowerCase();

  if (code === 190 || code === 102 || code === 463 || code === 467) return "AUTH";
  // subcode 만 오는 응답도 있다(code 가 0 이거나 빠진 경우).
  if ([458, 459, 460, 463, 464, 467, 492].includes(error.subcode ?? -1)) return "AUTH";
  if (message.includes("access token") && (message.includes("expired") || message.includes("invalid"))) return "AUTH";

  // 권한: 200번대는 "이 작업을 할 권한이 없음". 토큰이 아니라 광고 계정 권한 문제다.
  if (code !== null && code >= 200 && code <= 299) return "PERMISSION";
  if (code === 10 || code === 272 || code === 278) return "PERMISSION";

  // 속도 제한·일시 장애 — 토큰은 멀쩡하다.
  if (code === 1 || code === 2 || code === 4 || code === 17 || code === 32 || code === 341 || code === 613) return "TRANSIENT";
  if (code !== null && code >= 80000 && code <= 80010) return "TRANSIENT";
  if ((error.status ?? 0) >= 500) return "TRANSIENT";
  if (message.includes("rate limit") || message.includes("try again") || message.includes("temporarily unavailable")) {
    return "TRANSIENT";
  }
  // 우리가 못 붙인 요청·네트워크 실패도 일시적으로 본다(토큰 상태를 추정할 근거가 없다).
  if (message.includes("fetch failed") || message.includes("etimedout") || message.includes("econnreset")) {
    return "TRANSIENT";
  }

  if (code === 2500) return "CONFIG"; // 잘못된 엔드포인트·앱 설정
  return "OTHER";
}

/**
 * Google 오류 분류 — 코드가 아니라 메시지로 가른다(OAuth 토큰 엔드포인트와 Ads API 가
 * 형태가 다르고, 둘 다 우리 쪽에서 문자열로 합쳐 던진다).
 *
 * `invalid_grant` 이 **유일하게 확실한 "끊김"** 이다. 그 밖의 실패는 토큰이 멀쩡한데도
 * 난 것일 수 있어서 상태를 건드리지 않는다.
 */
export function classifyGoogleError(messageRaw: string | null | undefined): AdErrorKind {
  const message = (messageRaw ?? "").toLowerCase();
  if (!message) return "OTHER";

  if (message.includes("invalid_grant") || message.includes("token has been expired or revoked")) return "AUTH";
  if (message.includes("unauthorized_client")) return "AUTH";

  if (message.includes("invalid_client") || message.includes("developer_token") || message.includes("developertoken")) {
    return "CONFIG";
  }
  if (message.includes("customer_not_enabled")) return "CONFIG";

  if (
    message.includes("user_permission_denied") ||
    message.includes("not_ads_user") ||
    message.includes("customer_not_found") ||
    message.includes("permission_denied")
  ) {
    return "PERMISSION";
  }

  if (
    message.includes("internal_error") ||
    message.includes("resource_exhausted") ||
    message.includes("deadline_exceeded") ||
    message.includes("unavailable") ||
    message.includes("too many requests") ||
    message.includes("rate") ||
    message.includes("fetch failed") ||
    message.includes("etimedout") ||
    message.includes("econnreset")
  ) {
    return "TRANSIENT";
  }
  return "OTHER";
}

/** 분류 → 연결 상태. `null` 이면 **상태를 바꾸지 않는다**(일시적 실패에 연결을 끊지 않는다). */
export function statusForErrorKind(kind: AdErrorKind): "EXPIRED" | "PERMISSION" | null {
  if (kind === "AUTH") return "EXPIRED";
  if (kind === "PERMISSION") return "PERMISSION";
  return null;
}

/** 운영자가 다시 연결해야 하는 상태인가 — 화면이 "다시 연결" 을 강조할 기준. */
export function needsReconnect(status: string | null | undefined): boolean {
  return status === "EXPIRED" || status === "PERMISSION";
}

/**
 * 토큰 연장을 시작할 시점. 만료까지 이만큼 남으면 매일 연장을 시도한다.
 *
 * 왜 이렇게 이른가: Meta 의 장기 토큰 재발급은 **실패할 수 있다**(앱 권한이 바뀐 경우 등).
 * 만료 직전에 처음 시도하면 실패가 곧 고장이다. 25일 전부터 매일 시도하면, 안 되는 경우에도
 * 운영자에게 **3주 넘는 예고**가 생긴다.
 */
export const META_TOKEN_RENEW_WINDOW_DAYS = 25;

/** 이 날짜 안쪽이면 화면에 경고를 띄운다 — 자동 연장이 안 듣고 있다는 뜻이다. */
export const META_TOKEN_WARN_DAYS = 14;

export interface AdConnectionSnapshot {
  status?: string | null;
  /** 시스템 사용자 토큰은 만료가 없다. */
  tokenKind?: string | null;
  tokenExpiresAt?: Date | string | null;
  /** Meta 의 **데이터 접근** 만료(90일) — 토큰 연장으로는 늘어나지 않고 재인증이 필요하다. */
  dataAccessExpiresAt?: Date | string | null;
  lastSyncedAt?: Date | string | null;
}

export type HealthLevel = "ok" | "warn" | "broken";

export interface AdConnectionHealth {
  level: HealthLevel;
  /** 한 줄 요약 — 배지에 그대로 쓴다. */
  headline: string;
  /** 운영자가 할 일. 없으면 빈 문자열. */
  hint: string;
  /** 토큰 만료까지 남은 날. 만료가 없으면 null. */
  daysLeft: number | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * 연결의 건강 상태 — 화면이 이 하나만 보고 그린다.
 *
 * 순서가 중요하다: **이미 끊긴 것**이 가장 급하고, 그다음이 재인증 예고(데이터 접근 만료),
 * 그다음이 토큰 만료 임박이다. 셋 다 아니면 괜찮은 것이고, 괜찮을 때는 남은 날을 조용히 알려 준다.
 */
export function adConnectionHealth(
  connection: AdConnectionSnapshot,
  now: Date = new Date(),
): AdConnectionHealth {
  if (needsReconnect(connection.status)) {
    return connection.status === "PERMISSION"
      ? {
          level: "broken",
          headline: "광고 계정 접근 권한 없음",
          hint: "매체에서 이 계정 권한을 다시 받은 뒤 새로고침해주세요.",
          daysLeft: null,
        }
      : {
          level: "broken",
          headline: "연결이 끊겼어요",
          hint: "\"다시 연결\"을 눌러 로그인해주세요.",
          daysLeft: null,
        };
  }

  // 시스템 사용자 토큰은 만료가 없다 — 이 플랫폼에서 가장 안 풀리는 연결이다.
  if (connection.tokenKind === "SYSTEM_USER") {
    return { level: "ok", headline: "연결됨 · 만료 없는 토큰", hint: "", daysLeft: null };
  }

  const reauth = toDate(connection.dataAccessExpiresAt);
  if (reauth) {
    const left = daysBetween(now, reauth);
    if (left <= 0) {
      return {
        level: "broken",
        headline: "데이터 접근 기간이 끝났어요",
        hint: "\"다시 연결\"을 눌러 Meta 로그인을 한 번 더 해주세요 — 토큰 연장으로는 늘어나지 않아요.",
        daysLeft: left,
      };
    }
    if (left <= META_TOKEN_WARN_DAYS) {
      return {
        level: "warn",
        headline: `데이터 접근 만료 D-${left}`,
        hint: "만료 전에 \"다시 연결\"을 한 번 눌러 두면 90일이 다시 늘어나요.",
        daysLeft: left,
      };
    }
  }

  const expires = toDate(connection.tokenExpiresAt);
  if (!expires) {
    // 만료를 모르는 연결(이 기능이 생기기 전에 맺은 것). 자동 점검이 돌면 채워진다.
    return { level: "ok", headline: "연결됨", hint: "", daysLeft: null };
  }

  const left = daysBetween(now, expires);
  if (left <= 0) {
    return {
      level: "broken",
      headline: "토큰이 만료됐어요",
      hint: "\"다시 연결\"을 눌러 로그인해주세요.",
      daysLeft: left,
    };
  }
  if (left <= META_TOKEN_WARN_DAYS) {
    return {
      level: "warn",
      headline: `토큰 만료 D-${left}`,
      hint: "자동 연장이 듣지 않고 있어요 — \"다시 연결\"을 한 번 눌러주세요.",
      daysLeft: left,
    };
  }
  return { level: "ok", headline: `연결됨 · 자동 연장 중 (D-${left})`, hint: "", daysLeft: left };
}

/** 지금 토큰을 연장해야 하나 — 자동 점검(매일)과 동기화 직전에 같이 쓴다. */
export function shouldRenewMetaToken(
  connection: AdConnectionSnapshot,
  now: Date = new Date(),
): boolean {
  if (connection.tokenKind === "SYSTEM_USER") return false;
  const expires = toDate(connection.tokenExpiresAt);
  // 만료를 모르면 한 번 확인해 봐야 한다 — 점검이 만료를 채워 준다.
  if (!expires) return true;
  return daysBetween(now, expires) <= META_TOKEN_RENEW_WINDOW_DAYS;
}
