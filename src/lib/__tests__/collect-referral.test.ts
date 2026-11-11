import { describe, expect, it } from "vitest";
import {
  buildInviteUrl,
  isRewarded,
  normalizeReferral,
  rankReferrers,
  referralDisplayName,
  referralLabel,
  samePersonName,
} from "@/lib/collect-referral";
import { mergeFormConfigUpdate, normalizeCollectForm } from "@/lib/collect-form-config";

describe("지인 초대 이름표", () => {
  it("한글은 가운데를 가리고, 영문은 이름 첫 글자 + 성", () => {
    expect(referralLabel("이창환", "+821012341198")).toBe("이*환 · 1198");
    expect(referralLabel("Changhwan Lee", "+12025551198")).toBe("C. Lee · 1198");
    expect(referralDisplayName("남궁민수")).toBe("남**수");
    expect(referralLabel("김민", null)).toBe("김*");
  });
});

describe("내 순위 찾기 — 이름 비교", () => {
  it("띄어쓰기·대소문자·성과 이름 순서와 상관없이 같은 사람", () => {
    expect(samePersonName("Changhwan Lee", "lee changhwan")).toBe(true);
    expect(samePersonName("Changhwan Lee", "Lee, Changhwan")).toBe(true);
    expect(samePersonName("Changhwan Lee", "changhwanlee")).toBe(true);
    expect(samePersonName("Changhwan Lee", "LeeChanghwan")).toBe(true);
    expect(samePersonName("이창환", "이 창환")).toBe(true);
    expect(samePersonName("이창환", "이창수")).toBe(false);
    expect(samePersonName("Changhwan Lee", "Changhwan")).toBe(false);
  });
});

describe("추천 순위", () => {
  const rows = [
    { recordId: "a", count: 5, label: "A", lastReferredAt: 3 },
    { recordId: "b", count: 7, label: "B", lastReferredAt: 2 },
    { recordId: "c", count: 5, label: "C", lastReferredAt: 1 },
    { recordId: "d", count: 1, label: "D", lastReferredAt: 4 },
    { recordId: "z", count: 0, label: "Z", lastReferredAt: 0 },
  ];

  it("같은 인원은 같은 순위, 같은 인원 안에서는 먼저 도달한 사람이 위", () => {
    const ranked = rankReferrers(rows, { rewardMode: "none", rewardValue: 0 });
    expect(ranked.map((r) => [r.recordId, r.rank])).toEqual([["b", 1], ["c", 2], ["a", 2], ["d", 4]]);
  });

  it("혜택 기준 — 상위 N명·상위 N%·N명 이상", () => {
    expect(rankReferrers(rows, { rewardMode: "topN", rewardValue: 2 }).filter((r) => r.rewarded).map((r) => r.recordId)).toEqual(["b", "c", "a"]);
    expect(isRewarded(1, 3, 10, { rewardMode: "topPercent", rewardValue: 10 })).toBe(true);
    expect(isRewarded(2, 3, 10, { rewardMode: "topPercent", rewardValue: 10 })).toBe(false);
    expect(isRewarded(9, 5, 10, { rewardMode: "minCount", rewardValue: 5 })).toBe(true);
    expect(isRewarded(1, 5, 10, { rewardMode: "none", rewardValue: 5 })).toBe(false);
  });
});

describe("초대 링크", () => {
  it("추천 코드를 붙이고, 보낸 사람의 광고 UTM 은 지운다", () => {
    const url = new URL(buildInviteUrl("https://k-expo.org/register?utm_source=meta&utm_campaign=x&lang=ja#form", "K7mQ2xPa3d"));
    expect(url.searchParams.get("ref")).toBe("K7mQ2xPa3d");
    expect(url.searchParams.get("utm_source")).toBe("referral");
    expect(url.searchParams.get("utm_medium")).toBe("invite");
    expect(url.searchParams.get("utm_campaign")).toBeNull();
    expect(url.searchParams.get("lang")).toBe("ja");
    expect(url.hash).toBe("");
  });
});

describe("추천 설정", () => {
  it("기본은 꺼짐이고, 이상한 값은 바로잡는다", () => {
    expect(normalizeCollectForm({}).referral.enabled).toBe(false);
    expect(normalizeReferral({ enabled: true, rewardMode: "topPercent", rewardValue: 250 }, () => ({})).rewardValue).toBe(100);
    expect(normalizeReferral({ rewardMode: "bogus", rewardValue: 5 }, () => ({})).rewardMode).toBe("none");
  });

  it("폼 빌더 자동 저장이 추천 설정을 덮지 않는다", () => {
    const current = { referral: { enabled: true, rewardMode: "topN", rewardValue: 10 } };
    const merged = mergeFormConfigUpdate(current, { fields: [], referral: { enabled: false } }, undefined);
    expect(merged?.referral.enabled).toBe(true);
    const changed = mergeFormConfigUpdate(current, undefined, undefined, undefined, { enabled: false });
    expect(changed?.referral.enabled).toBe(false);
  });
});
