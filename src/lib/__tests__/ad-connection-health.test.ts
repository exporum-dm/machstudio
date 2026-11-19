// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  META_TOKEN_RENEW_WINDOW_DAYS,
  adConnectionHealth,
  classifyGoogleError,
  classifyMetaError,
  needsReconnect,
  shouldRenewMetaToken,
  statusForErrorKind,
} from "@/lib/ad-connection-health";

/**
 * **"연동이 자꾸 풀린다" 의 두 원인을 가르는 규칙.**
 *
 * 토큰이 정말 죽은 것과, 그 순간 호출이 실패한 것. 둘을 섞으면 속도 제한 한 번에 연결이
 * 끊긴 것으로 적히고, 운영자는 멀쩡한 연결을 끊고 다시 맺는다 — 재연결은 성공하니
 * 원인은 끝까지 안 드러난다. 그래서 분류가 이 기능의 전부다.
 */

const NOW = new Date("2026-11-19T00:30:00Z");
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

describe("Meta 오류 분류", () => {
  it("190·467·102 는 토큰이 죽은 것", () => {
    expect(classifyMetaError({ code: 190 })).toBe("AUTH");
    expect(classifyMetaError({ code: 467 })).toBe("AUTH");
    expect(classifyMetaError({ code: 102 })).toBe("AUTH");
  });

  /** code 가 빠지고 subcode 만 오는 응답이 있다 — 463 만료, 460 비밀번호 변경 등. */
  it("subcode 만 와도 끊김으로 본다", () => {
    for (const subcode of [458, 459, 460, 463, 464, 467]) {
      expect(classifyMetaError({ code: null, subcode })).toBe("AUTH");
    }
  });

  it("메시지만 있어도 만료를 읽는다", () => {
    expect(classifyMetaError({ message: "Error validating access token: Session has expired" })).toBe("AUTH");
  });

  /**
   * **이게 핵심이다.** 속도 제한·Meta 일시 장애는 토큰이 멀쩡하다 —
   * 여기서 AUTH 로 새면 운영자가 재연결을 반복하게 된다.
   */
  it("속도 제한·일시 장애는 토큰 문제가 아니다", () => {
    for (const code of [1, 2, 4, 17, 32, 341, 613, 80000, 80004]) {
      expect(classifyMetaError({ code })).toBe("TRANSIENT");
    }
    expect(classifyMetaError({ status: 500 })).toBe("TRANSIENT");
    expect(classifyMetaError({ status: 503, message: "Service temporarily unavailable" })).toBe("TRANSIENT");
    expect(classifyMetaError({ message: "User request limit reached, please try again later" })).toBe("TRANSIENT");
    expect(classifyMetaError({ message: "fetch failed" })).toBe("TRANSIENT");
  });

  it("200번대는 광고 계정 권한 문제", () => {
    expect(classifyMetaError({ code: 200 })).toBe("PERMISSION");
    expect(classifyMetaError({ code: 272 })).toBe("PERMISSION");
  });

  it("모르는 오류는 상태를 건드리지 않는다", () => {
    expect(classifyMetaError({ code: 33, message: "Unsupported get request" })).toBe("OTHER");
    expect(statusForErrorKind(classifyMetaError({ code: 33 }))).toBeNull();
  });
});

describe("Google 오류 분류", () => {
  it("invalid_grant 이 유일하게 확실한 끊김", () => {
    expect(classifyGoogleError("invalid_grant (Token has been expired or revoked.)")).toBe("AUTH");
    expect(classifyGoogleError("unauthorized_client")).toBe("AUTH");
  });

  it("우리 쪽 설정 문제는 따로 본다", () => {
    expect(classifyGoogleError("invalid_client")).toBe("CONFIG");
    expect(classifyGoogleError("DEVELOPER_TOKEN_NOT_APPROVED: ...")).toBe("CONFIG");
  });

  it("권한·일시 실패로는 연결을 끊지 않는다", () => {
    expect(statusForErrorKind(classifyGoogleError("USER_PERMISSION_DENIED"))).toBe("PERMISSION");
    for (const message of [
      "INTERNAL_ERROR: something broke",
      "RESOURCE_EXHAUSTED",
      "DEADLINE_EXCEEDED",
      "503 Service Unavailable",
      "Too Many Requests",
      "fetch failed",
    ]) {
      expect(statusForErrorKind(classifyGoogleError(message))).toBeNull();
    }
  });

  it("빈 메시지는 분류하지 않는다", () => {
    expect(classifyGoogleError("")).toBe("OTHER");
    expect(classifyGoogleError(null)).toBe("OTHER");
  });
});

describe("오류 → 연결 상태", () => {
  /** 한 줄 요약: **일시적 실패에는 null** — 상태를 그대로 둔다. */
  it("끊김만 상태를 바꾼다", () => {
    expect(statusForErrorKind("AUTH")).toBe("EXPIRED");
    expect(statusForErrorKind("PERMISSION")).toBe("PERMISSION");
    expect(statusForErrorKind("TRANSIENT")).toBeNull();
    expect(statusForErrorKind("CONFIG")).toBeNull();
    expect(statusForErrorKind("OTHER")).toBeNull();
  });

  it("다시 연결이 필요한 상태", () => {
    expect(needsReconnect("EXPIRED")).toBe(true);
    expect(needsReconnect("PERMISSION")).toBe(true);
    expect(needsReconnect("CONNECTED")).toBe(false);
    // 옛 코드가 남긴 "ERROR" 는 끊김이 아니다 — 일시 실패에도 적혔던 값이라 믿을 수 없다.
    expect(needsReconnect("ERROR")).toBe(false);
    expect(needsReconnect(null)).toBe(false);
  });
});

describe("연결 건강 상태", () => {
  it("끊긴 게 가장 급하다", () => {
    const health = adConnectionHealth({ status: "EXPIRED", tokenExpiresAt: inDays(40) }, NOW);
    expect(health.level).toBe("broken");
    expect(health.hint).toContain("다시 연결");
  });

  it("권한 문제는 다른 안내를 준다", () => {
    const health = adConnectionHealth({ status: "PERMISSION" }, NOW);
    expect(health.level).toBe("broken");
    expect(health.headline).toContain("권한");
  });

  /** 시스템 사용자 토큰 — 이 플랫폼에서 가장 안 풀리는 연결이다. */
  it("만료 없는 토큰은 언제나 괜찮다", () => {
    const health = adConnectionHealth({ status: "CONNECTED", tokenKind: "SYSTEM_USER", tokenExpiresAt: null }, NOW);
    expect(health.level).toBe("ok");
    expect(health.daysLeft).toBeNull();
    expect(health.headline).toContain("만료 없는");
  });

  /**
   * 데이터 접근 만료(90일)가 토큰 만료보다 **먼저** 걸린다. 토큰 연장으로는 안 늘어나니
   * 운영자가 할 일이 다르다 — 순서를 뒤집으면 "자동 연장 중" 이라고 안심시키다 끊긴다.
   */
  it("데이터 접근 만료를 토큰 만료보다 먼저 알린다", () => {
    const health = adConnectionHealth(
      { status: "CONNECTED", tokenExpiresAt: inDays(55), dataAccessExpiresAt: inDays(9) },
      NOW,
    );
    expect(health.level).toBe("warn");
    expect(health.headline).toBe("데이터 접근 만료 D-9");
    expect(health.daysLeft).toBe(9);
  });

  it("데이터 접근 기간이 지나면 끊긴 것으로 본다", () => {
    const health = adConnectionHealth({ status: "CONNECTED", dataAccessExpiresAt: inDays(-1) }, NOW);
    expect(health.level).toBe("broken");
  });

  it("토큰 만료가 임박하면 경고 — 자동 연장이 안 듣고 있다는 뜻", () => {
    const health = adConnectionHealth({ status: "CONNECTED", tokenExpiresAt: inDays(5) }, NOW);
    expect(health.level).toBe("warn");
    expect(health.headline).toBe("토큰 만료 D-5");
  });

  it("넉넉하면 남은 날을 조용히 알려 준다", () => {
    const health = adConnectionHealth({ status: "CONNECTED", tokenExpiresAt: inDays(52) }, NOW);
    expect(health.level).toBe("ok");
    expect(health.daysLeft).toBe(52);
    expect(health.hint).toBe("");
  });

  /** 이 기능이 생기기 전에 맺은 연결 — 만료를 모른다. 겁주지 않는다(첫 점검이 채운다). */
  it("만료를 모르는 연결은 괜찮은 쪽으로 둔다", () => {
    expect(adConnectionHealth({ status: "CONNECTED" }, NOW).level).toBe("ok");
  });
});

describe("언제 연장할까", () => {
  it("만료가 넉넉하면 네트워크를 타지 않는다", () => {
    expect(shouldRenewMetaToken({ tokenExpiresAt: inDays(META_TOKEN_RENEW_WINDOW_DAYS + 5) }, NOW)).toBe(false);
  });

  it("창 안에 들어오면 매일 시도한다", () => {
    expect(shouldRenewMetaToken({ tokenExpiresAt: inDays(META_TOKEN_RENEW_WINDOW_DAYS) }, NOW)).toBe(true);
    expect(shouldRenewMetaToken({ tokenExpiresAt: inDays(1) }, NOW)).toBe(true);
    // 이미 지난 것도 시도한다 — 되살아날 수 있고, 아니면 상태를 정확히 적게 된다.
    expect(shouldRenewMetaToken({ tokenExpiresAt: inDays(-3) }, NOW)).toBe(true);
  });

  it("만료를 모르면 한 번 확인한다", () => {
    expect(shouldRenewMetaToken({}, NOW)).toBe(true);
  });

  it("만료 없는 토큰은 건드리지 않는다", () => {
    expect(shouldRenewMetaToken({ tokenKind: "SYSTEM_USER", tokenExpiresAt: null }, NOW)).toBe(false);
  });

  /**
   * 25일은 **실패할 여유**다. 만료 직전에 처음 시도하면 실패가 곧 고장이지만,
   * 25일 전부터 매일 시도하면 안 되는 경우에도 운영자에게 3주 넘는 예고가 생긴다.
   */
  it("경고 시점보다 연장 시점이 먼저 와야 한다", async () => {
    const { META_TOKEN_WARN_DAYS } = await import("@/lib/ad-connection-health");
    expect(META_TOKEN_RENEW_WINDOW_DAYS).toBeGreaterThan(META_TOKEN_WARN_DAYS);
  });
});
