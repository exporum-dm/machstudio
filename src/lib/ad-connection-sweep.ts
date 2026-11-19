/**
 * 매일 한 번 돌아가는 **광고 연동 건강 점검**.
 *
 * ── 왜 야간 동기화로는 부족한가 ───────────────────────────────────────
 * 야간 자동 동기화(`/api/cron/nightly`)는 **보고 기간이 열린 폴더만** 돈다
 * (`isDueForNightlySync` — 끝난 캠페인을 매일 다시 받으면 숫자는 그대로인데 호출만 쌓인다).
 * 맞는 판단이지만, 그 덕에 캠페인 사이의 공백 동안 아무도 토큰을 건드리지 않는다.
 * Meta 장기 토큰은 60일이라 **행사 두 번 사이에 조용히 죽는다** — 그게 운영자가 느끼는
 * "또 풀렸다" 의 정체다.
 *
 * 그래서 이 점검은 폴더·캠페인과 **무관하게** 모든 연결을 본다:
 *  · Meta — 만료 25일 안쪽이면 창을 앞으로 민다(시스템 사용자 토큰은 만료가 없어 건너뜀).
 *  · Google — 액세스 토큰을 한 번 발급해 갱신 토큰이 살아 있는지 확인한다. 겸사겸사
 *    "6개월 미사용 시 폐기" 시계도 매일 0으로 돌아간다.
 *
 * 실패해도 던지지 않는다 — 한 워크스페이스의 끊긴 연결이 나머지 점검을 막으면 안 된다.
 */
import { prisma } from "@/lib/prisma";
import { ensureFreshMetaToken } from "@/lib/meta-token";
import { decryptGoogleToken, googleAccessToken } from "@/lib/google-ads";
import { classifyGoogleError, statusForErrorKind, shouldRenewMetaToken } from "@/lib/ad-connection-health";

export interface SweepResult {
  meta: { checked: number; renewed: number; expired: number; failed: number };
  google: { checked: number; alive: number; expired: number; failed: number };
}

export async function sweepAdConnections(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = {
    meta: { checked: 0, renewed: 0, expired: 0, failed: 0 },
    google: { checked: 0, alive: 0, expired: 0, failed: 0 },
  };

  const metaConnections = await prisma.metaAdConnection.findMany({
    where: { project: { deletedAt: null }, workspace: { deletedAt: null } },
  });
  for (const connection of metaConnections) {
    // 만료가 넉넉하면 네트워크를 타지 않는다 — 점검 자체가 호출 비용이다.
    if (!shouldRenewMetaToken(connection, now)) continue;
    result.meta.checked += 1;
    try {
      const renewal = await ensureFreshMetaToken(connection, { force: true, now });
      if (renewal.renewed) result.meta.renewed += 1;
      if (renewal.authError) result.meta.expired += 1;
    } catch (error) {
      result.meta.failed += 1;
      console.warn("[ad-connection-sweep] Meta 점검 실패", connection.id, error instanceof Error ? error.message : error);
    }
  }

  const googleConnections = await prisma.googleAdConnection.findMany({
    where: { project: { deletedAt: null }, workspace: { deletedAt: null } },
  });
  for (const connection of googleConnections) {
    result.google.checked += 1;
    try {
      await googleAccessToken(decryptGoogleToken(connection.encryptedRefreshToken));
      result.google.alive += 1;
      // 전에 끊겼다고 적어 둔 게 있으면 거둔다 — 살아 있는 걸 방금 확인했다.
      if (connection.status !== "CONNECTED") {
        await prisma.googleAdConnection.update({
          where: { id: connection.id },
          data: { status: "CONNECTED", lastSyncError: null },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = statusForErrorKind(classifyGoogleError(message));
      if (status) {
        result.google.expired += 1;
        await prisma.googleAdConnection.update({
          where: { id: connection.id },
          data: { status, lastSyncError: message.slice(0, 500) },
        });
      } else {
        // 일시적 실패 — 상태를 건드리지 않는다. 내일 다시 본다.
        result.google.failed += 1;
      }
    }
  }

  return result;
}
