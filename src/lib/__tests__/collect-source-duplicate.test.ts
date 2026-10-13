import { describe, expect, it } from "vitest";
import { duplicateName, duplicateSourceData, type DuplicateSourceInput } from "@/lib/collect-source-duplicate";

const source: DuplicateSourceInput & { webhookUrl: string; checkinToken: string; checkinPinHash: string } = {
  name: "2026 Korea Expo LA Oneday Class",
  description: "댄스 원데이 클래스 신청",
  siteUrl: null,
  successTrigger: "정상적으로 접수되었습니다",
  redirectUrl: null,
  allowedOrigins: ["https://en.usa.k-expo.org"],
  formPagePatterns: [],
  dedupKeyFields: ["email"],
  fieldGroupSelector: ".form-group",
  mode: "builder",
  formConfig: { fields: [{ key: "email", type: "email" }], eventInfo: { registrationWindow: { closesAt: "2026-10-12T07:00:00Z" } } },
  emailConfig: null,
  venueConfig: { venue: "Magic Box" },
  checkinTimezone: "Asia/Seoul",
  webhookUrl: "https://hooks.example.com/x",
  checkinToken: "onedayclass",
  checkinPinHash: "salt:hash",
};

describe("사전등록 폼 복제", () => {
  it("폼 항목·문구·설정은 그대로 가져가고, 원본과 객체를 공유하지 않는다", () => {
    const data = duplicateSourceData(source, "Random Dance Play");
    expect(data.name).toBe("Random Dance Play");
    expect(data.mode).toBe("builder");
    expect(data.formConfig).toEqual(source.formConfig);
    expect(data.formConfig).not.toBe(source.formConfig);
    expect(data.venueConfig).toEqual(source.venueConfig);
    expect(data.allowedOrigins).toEqual(source.allowedOrigins);
    expect(data.allowedOrigins).not.toBe(source.allowedOrigins);
  });

  it("그 폼만의 열쇠와 연동처는 새로 둔다 — 체크인 링크·PIN, 웹훅", () => {
    const data = duplicateSourceData(source, "Random Dance Play");
    expect(data.checkinEnabled).toBe(false);
    expect(data.checkinToken).toBeNull();
    expect(data.checkinPinHash).toBeNull();
    expect(data.webhookUrl).toBeNull();
    expect(data.notifyOnSubmit).toBe(false);
    expect(data.isActive).toBe(true);
  });

  it("기본 이름은 '(복사본)' 을 붙인다", () => {
    expect(duplicateName("Oneday Class")).toBe("Oneday Class (복사본)");
  });
});
