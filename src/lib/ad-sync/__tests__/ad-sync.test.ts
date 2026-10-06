import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { folderPlatforms, isDueForNightlySync } from "@/lib/ad-sync/shared";
import { assetRefs } from "@/lib/ad-sync/google";

const kst = (day: string) => new Date(`${day}T00:00:00+09:00`);

describe("매일 밤 자동 동기화 대상", () => {
  const folder = { reportStart: kst("2026-08-31"), reportEnd: kst("2026-10-23") };

  it("보고 기간 안이면 대상", () => {
    expect(isDueForNightlySync(folder, kst("2026-10-07"))).toBe(true);
    expect(isDueForNightlySync(folder, kst("2026-08-31"))).toBe(true);
  });

  it("끝난 뒤 3일까지는 늦은 전환을 받으려고 계속, 그 뒤엔 멈춘다", () => {
    expect(isDueForNightlySync(folder, kst("2026-10-26"))).toBe(true);
    expect(isDueForNightlySync(folder, kst("2026-10-27"))).toBe(false);
  });

  it("아직 시작 안 한 폴더는 건너뛴다", () => {
    expect(isDueForNightlySync(folder, kst("2026-08-30"))).toBe(false);
  });

  it("KST 자정 직후(UTC 전날 15시)도 KST 날짜로 판단한다", () => {
    expect(isDueForNightlySync(folder, new Date("2026-10-26T15:00:00Z"))).toBe(false); // KST 10-27 00:00
  });

  it("폴더에 붙은 매체를 고른다", () => {
    expect(folderPlatforms({ mediaAccounts: [{ platform: "META", accountId: "act_1" }, { platform: "GOOGLE", accountId: "" }] }))
      .toEqual({ meta: true, google: false });
  });
});

describe("Google 소재 에셋", () => {
  it("디맨드젠 이미지·영상 광고의 에셋도 썸네일 후보로 읽는다", () => {
    expect(assetRefs({
      type: "DEMAND_GEN_MULTI_ASSET_AD",
      demandGenMultiAssetAd: {
        marketingImages: [{ asset: "customers/1/assets/10" }],
        portraitMarketingImages: [{ asset: "customers/1/assets/11" }],
      },
    })).toEqual(["customers/1/assets/10", "customers/1/assets/11"]);
    expect(assetRefs({
      type: "DEMAND_GEN_VIDEO_RESPONSIVE_AD",
      demandGenVideoResponsiveAd: { videos: [{ asset: "customers/1/assets/20" }] },
    })).toEqual(["customers/1/assets/20"]);
  });

  it("검색 광고는 이미지가 없다", () => {
    expect(assetRefs({ type: "RESPONSIVE_SEARCH_AD" })).toEqual([]);
  });
});
