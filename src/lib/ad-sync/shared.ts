import type { AdPerformanceFolder } from "@/generated/prisma";

/** 동기화에 필요한 폴더 필드 — 화면 버튼(로그인 사용자)과 매일 밤 자동 동기화가 같이 쓴다. */
export type AdSyncFolder = Pick<
  AdPerformanceFolder,
  "id" | "workspaceId" | "projectId" | "mediaAccounts" | "reportStart" | "reportEnd" | "currency"
>;

/** 사용자에게 그대로 보여 줄 수 있는 동기화 실패. status 는 API 응답 코드. */
export class AdSyncError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "AdSyncError";
  }
}

// DB에는 UTC로 저장되지만 폴더 기간은 KST 달력일 기준 — naive toISOString().slice(0,10)은 자정 부근에 하루 밀려 조회 구간이 어긋난다.
export function kstDateOnly(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

/** 기간이 끝난 뒤에도 늦게 잡히는 전환을 받으려고 며칠 더 동기화한다. */
export const NIGHTLY_SYNC_GRACE_DAYS = 3;

/**
 * 매일 밤 자동 동기화 대상인가 — 보고 기간이 시작됐고, 끝난 지 NIGHTLY_SYNC_GRACE_DAYS 일이 안 지난 폴더.
 * 끝난 캠페인까지 매일 다시 받으면 숫자는 그대로인데 API 호출만 쌓인다(필요하면 화면에서 수동 동기화).
 */
export function isDueForNightlySync(folder: Pick<AdSyncFolder, "reportStart" | "reportEnd">, now = new Date()) {
  const today = kstDateOnly(now);
  const graceEnd = kstDateOnly(new Date(folder.reportEnd.getTime() + NIGHTLY_SYNC_GRACE_DAYS * 86_400_000));
  return kstDateOnly(folder.reportStart) <= today && today <= graceEnd;
}

export function folderPlatforms(folder: Pick<AdSyncFolder, "mediaAccounts">) {
  const accounts = (Array.isArray(folder.mediaAccounts) ? folder.mediaAccounts : []) as Array<{ platform?: string; accountId?: string }>;
  return {
    meta: accounts.some((account) => account.platform === "META" && account.accountId),
    google: accounts.some((account) => account.platform === "GOOGLE" && account.accountId),
  };
}
