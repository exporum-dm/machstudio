import { afterEach, describe, expect, it, vi } from "vitest";
import { googleAdsRequest, googleCustomerId, signGoogleState, verifyGoogleState } from "@/lib/google-ads";

const previous = process.env.GOOGLE_ADS_CLIENT_SECRET;
const previousManagerId = process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID;
afterEach(() => {
  process.env.GOOGLE_ADS_CLIENT_SECRET = previous;
  process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID = previousManagerId;
  vi.unstubAllGlobals();
});

describe("Google Ads helpers", () => {
  it("normalizes Google customer ids", () => {
    expect(googleCustomerId("customers/123-456-7890")).toBe("1234567890");
  });
  it("signs and verifies OAuth state", () => {
    process.env.GOOGLE_ADS_CLIENT_SECRET = "test-secret";
    const state = signGoogleState({ projectId: "p1" });
    expect(verifyGoogleState<{ projectId: string }>(state)).toEqual({ projectId: "p1" });
    expect(verifyGoogleState(`${state}x`)).toBeNull();
  });

  it("googleAdsRequest 는 login-customer-id(GOOGLE_ADS_MANAGER_CUSTOMER_ID)가 없으면 바로 실패한다 — 호출조차 하지 않는다", async () => {
    delete process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(googleAdsRequest("customers/1/googleAds:search", "token")).rejects.toThrow("GOOGLE_ADS_MANAGER_CUSTOMER_ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("googleAdsRequest 는 구조화된 오류가 없는 400 응답도 status·원문을 담아 메시지를 만든다", async () => {
    process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID = "1234567890";
    const body = JSON.stringify({ error: { code: 400, message: "Bad Request", status: "INVALID_ARGUMENT" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 400 })));
    await expect(googleAdsRequest("customers/1/googleAds:search", "token")).rejects.toThrow(/Bad Request.*INVALID_ARGUMENT/);
  });
});
