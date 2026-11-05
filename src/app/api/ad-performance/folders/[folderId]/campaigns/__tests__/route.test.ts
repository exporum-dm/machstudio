import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), campaigns: vi.fn(), records: vi.fn(), update: vi.fn(), current: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/ad-folder-access", () => ({ getAdFolderAccess: mocks.access }));
vi.mock("@/lib/ad-campaigns", () => ({ fetchAccountCampaigns: mocks.campaigns }));
vi.mock("@/lib/prisma", () => ({ prisma: { adPerformanceRecord: { findMany: mocks.records }, $transaction: mocks.transaction } }));
import { GET, PATCH } from "../route";
const accounts = [{ platform: "META", accountId: "act_1", accountName: "A" }];
const context = { params: Promise.resolve({ folderId: "folder" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ user: { id: "user" }, folder: { id: "folder", projectId: "url-project", mediaAccounts: accounts } });
  mocks.campaigns.mockResolvedValue([{ id: "10", name: "같은 이름" }, { id: "20", name: "같은 이름" }]);
  mocks.records.mockResolvedValue([]);
  mocks.current.mockResolvedValue({ mediaAccounts: [...accounts, { platform: "GOOGLE", accountId: "2", accountName: "동시 추가", campaignIds: ["30"] }] });
  mocks.update.mockImplementation(async ({ data }) => data);
  mocks.transaction.mockImplementation(async fn => fn({ $queryRaw: vi.fn(), adPerformanceFolder: { findUniqueOrThrow: mocks.current, update: mocks.update } }));
});
const patch = (campaignIds: unknown) => PATCH(new Request("https://example.com", { method: "PATCH", body: JSON.stringify({ platform: "META", accountId: "act_1", campaignIds }) }), context);

it("rejects accounts outside the URL folder before touching provider credentials", async () => {
  const response = await GET(new Request("https://example.com?platform=META&accountId=act_999"), context);
  expect(response.status).toBe(400); expect(mocks.campaigns).not.toHaveBeenCalled();
});
it("validates campaign membership with the URL project's connection", async () => {
  const response = await patch(["999"]);
  expect(response.status).toBe(400);
  expect(mocks.campaigns).toHaveBeenCalledWith("url-project", "user", accounts[0]);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("saves one ID despite duplicate names and retains concurrent changes to other accounts", async () => {
  const response = await patch(["10"]);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.mediaAccounts).toEqual([{ ...accounts[0], campaignIds: ["10"] }, { platform: "GOOGLE", accountId: "2", accountName: "동시 추가", campaignIds: ["30"] }]);
});
it("preserves the difference between none and all without making unnecessary provider calls", async () => {
  const none = await patch([]); expect((await none.json()).mediaAccounts[0].campaignIds).toEqual([]);
  const all = await patch(null); expect((await all.json()).mediaAccounts[0]).not.toHaveProperty("campaignIds");
  expect(mocks.campaigns).not.toHaveBeenCalled();
});
