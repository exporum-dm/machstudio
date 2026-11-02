import { afterEach, describe, expect, it, vi } from "vitest";
import { googleAccessToken, googleAdsRequest, googleCustomerId, signGoogleState, verifyGoogleState } from "@/lib/google-ads";

const previous = process.env.GOOGLE_ADS_CLIENT_SECRET;
const previousManagerId = process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID;
const previousClientId = process.env.GOOGLE_ADS_CLIENT_ID;
afterEach(() => {
  process.env.GOOGLE_ADS_CLIENT_SECRET = previous;
  process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID = previousManagerId;
  process.env.GOOGLE_ADS_CLIENT_ID = previousClientId;
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

  it("status·details 도 없는 맨 Bad Request 는 원문을 그대로 메시지에 붙인다", async () => {
    process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID = "1234567890";
    const body = JSON.stringify({ error: { code: 400, message: "Bad Request" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 400 })));
    await expect(googleAdsRequest("customers/1/googleAds:search", "token")).rejects.toThrow(/Bad Request.*\{"error":\{"code":400/);
  });

  it("details 가 있어도 errorCode 없이 메시지가 그대로 반복되면 원문을 여전히 붙인다 — 실측 버그", async () => {
    // 실제로 받은 모양: details[].errors[].message 가 상위 message 와 똑같이 "Bad Request" 뿐이라,
    // detail 이 "있다"는 이유만으로 원문을 생략하면 여전히 "Bad Request" 한 마디만 남는다.
    process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID = "1234567890";
    const body = JSON.stringify({ error: { code: 400, message: "Bad Request", details: [{ errors: [{ message: "Bad Request" }] }] } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 400 })));
    await expect(googleAdsRequest("customers/1/googleAds:search", "token")).rejects.toThrow(/Bad Request.*\{"error":\{"code":400/);
  });

  it("googleAccessToken 은 CLIENT_ID/CLIENT_SECRET 이 없으면 바로 실패한다 — 호출조차 하지 않는다", async () => {
    delete process.env.GOOGLE_ADS_CLIENT_ID;
    process.env.GOOGLE_ADS_CLIENT_SECRET = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(googleAccessToken("refresh-token")).rejects.toThrow(/GOOGLE_ADS_CLIENT_ID|GOOGLE_ADS_CLIENT_SECRET/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("googleAccessToken 은 OAuth 실패 응답의 원문도 메시지에 담는다 — error_description 이 없는 모양도 포함", async () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
    process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
    const body = JSON.stringify({ error: { code: 400, message: "Bad Request", status: "INVALID_ARGUMENT" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 400 })));
    await expect(googleAccessToken("refresh-token")).rejects.toThrow(/\{"error":\{"code":400/);
  });
});
