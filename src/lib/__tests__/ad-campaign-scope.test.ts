import { expect, it } from "vitest";
import { adCampaignScope, normalizeMediaAccounts, projectAdCampaignScope } from "@/lib/ad-campaign-scope";

it("keeps legacy accounts unrestricted but treats an empty selection as no campaigns", () => {
  const account = { platform: "META", accountId: "act_123", accountName: "행사 계정" };
  expect(JSON.stringify(adCampaignScope([account]))).not.toContain("campaignId");
  const scoped = adCampaignScope([{ ...account, campaignIds: [] }]);
  expect(JSON.stringify(scoped)).toContain('"campaignId":{"in":[]}');
  expect(JSON.stringify(scoped)).toContain('"accountId":{"in":["act_123","123"]}');
});

it("scopes IDs to their account and preserves other platforms and unrestricted linked accounts", () => {
  const scope = adCampaignScope([{ platform: "GOOGLE", accountId: "123-456-7890", accountName: "A", campaignIds: ["111"] }, { platform: "GOOGLE", accountId: "999", accountName: "B" }]);
  expect((scope.AND as Array<unknown>)[1]).toMatchObject({ AND: [{ OR: [{ sourceType: { not: "GOOGLE" } }, { sourceType: "GOOGLE", accountId: { in: ["123-456-7890", "1234567890"] }, campaignId: { in: ["111"] } }, { sourceType: "GOOGLE", accountId: { in: ["999"] } }] }] });
});

it("validates numeric campaign IDs, deduplicates selection and accepts explicit all", () => {
  const account = { platform: "GOOGLE", accountId: "123", accountName: "A" };
  expect(normalizeMediaAccounts([{ ...account, campaignIds: null }])).toEqual([account]);
  expect(normalizeMediaAccounts([{ ...account, campaignIds: ["111", "111"] }])[0].campaignIds).toEqual(["111"]);
  expect(() => normalizeMediaAccounts([{ ...account, campaignIds: ["111) OR 1=1"] }])).toThrow();
  expect(() => normalizeMediaAccounts([{ ...account, campaignIds: "all" }])).toThrow();
});

it("keeps folderless uploads and other folders outside a folder-specific restriction", () => {
  expect(JSON.stringify(projectAdCampaignScope([{ id: "a", mediaAccounts: [] }]))).not.toContain("folderId");
  const scope = projectAdCampaignScope([{ id: "a", mediaAccounts: [{ platform: "META", accountId: "1", accountName: "A", campaignIds: ["11"] }] }, { id: "b", mediaAccounts: [] }]);
  expect((scope.AND as Array<{ OR?: unknown }>)[1].OR).toEqual(expect.arrayContaining([{ folderId: null }, { folderId: { notIn: ["a"] } }, expect.objectContaining({ folderId: "a", AND: expect.any(Array) })]));
});

it("excludes only explicitly marked duplicates while keeping null and provider statuses", () => {
  expect((adCampaignScope([]).AND as unknown[])[0]).toEqual({ OR: [{ status: null }, { status: { not: "EXCLUDED_DUPLICATE" } }] });
});
