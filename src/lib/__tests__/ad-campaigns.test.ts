import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ meta: vi.fn(), google: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { googleAdConnection: { findUnique: async () => ({ encryptedRefreshToken: "encrypted" }) } } }));
vi.mock("@/lib/meta-connection", () => ({ findMetaConnection: async () => ({ encryptedAccessToken: "encrypted" }) }));
vi.mock("@/lib/meta-ads", () => ({ decryptMetaToken: () => "test-token", metaGraph: mocks.meta }));
vi.mock("@/lib/google-ads", () => ({ decryptGoogleToken: () => "refresh", googleAccessToken: async () => "test-token", googleAdsRequest: mocks.google }));
import { fetchAccountCampaigns } from "@/lib/ad-campaigns";

it("reads every Meta campaign page without a performance-period filter", async () => {
  mocks.meta.mockResolvedValueOnce({ data: [{ id: "10", name: "지난 행사", effective_status: "PAUSED" }], paging: { next: "more", cursors: { after: "cursor" } } }).mockResolvedValueOnce({ data: [{ id: "20", name: "새 행사" }] });
  const campaigns = await fetchAccountCampaigns("project", "user", { platform: "META", accountId: "act_1", accountName: "A" }, true);
  expect(campaigns.map(c => c.id)).toEqual(["10", "20"]);
  expect(mocks.meta.mock.calls[1][2]).toMatchObject({ after: "cursor" });
  expect(mocks.meta.mock.calls[0][2]).not.toHaveProperty("time_range");
});

it("reads Google pages from the selected customer, independently of report dates", async () => {
  mocks.google.mockResolvedValueOnce({ results: [{ campaign: { id: "10", name: "같은 이름", status: "PAUSED" } }], nextPageToken: "page2" }).mockResolvedValueOnce({ results: [{ campaign: { id: "20", name: "같은 이름" } }] });
  const campaigns = await fetchAccountCampaigns("project", "user", { platform: "GOOGLE", accountId: "123-456", accountName: "A" }, true);
  expect(campaigns.map(c => c.id)).toEqual(["10", "20"]);
  expect(mocks.google.mock.calls[0][0]).toBe("customers/123456/googleAds:search");
  expect(JSON.parse(mocks.google.mock.calls[1][2].body)).toMatchObject({ pageToken: "page2" });
  expect(JSON.parse(mocks.google.mock.calls[0][2].body).query).not.toContain("segments.date");
});
