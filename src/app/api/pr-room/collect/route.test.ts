import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { prRoom: { findUnique: async () => ({ id: "room" }) } } }));
vi.mock("@/lib/brief/server", () => ({ guardProject: async () => ({ ok: true }) }));
vi.mock("@/lib/pr-room/collect", () => ({ collectPrRoom: mocks.collect }));
import { POST } from "./route";
beforeEach(() => vi.clearAllMocks());

it("reports concurrent collection conflicts as a recoverable conflict", async () => {
  mocks.collect.mockRejectedValue(new Error("PR_ROOM_CHANGED"));
  const response = await POST(new Request("https://example.test/api/pr-room/collect", { method: "POST", body: JSON.stringify({ projectId: "project" }) }));
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("다른 창");
});
