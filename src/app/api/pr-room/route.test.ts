import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { prRoom: { findUnique: mocks.find, updateMany: mocks.update } } }));
vi.mock("@/lib/brief/server", () => ({ guardProject: mocks.guard }));
import { PATCH } from "./route";
const version = "2026-11-02T00:00:00.000Z";
const request = () => new Request("https://example.test/api/pr-room", { method: "PATCH", body: JSON.stringify({ projectId: "p1", expectedUpdatedAt: version, mentions: [] }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, canWrite: true });
  mocks.find.mockResolvedValue({ id: "r1", updatedAt: new Date(version) });
  mocks.update.mockResolvedValue({ count: 1 });
});

it("conditions the database write on the version the editor actually read", async () => {
  expect((await PATCH(request())).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "r1", updatedAt: new Date(version) }, data: { mentions: [] } });
});

it("rejects a stale editor instead of overwriting a concurrent change", async () => {
  mocks.update.mockResolvedValue({ count: 0 });
  expect((await PATCH(request())).status).toBe(409);
  expect(mocks.find).toHaveBeenCalledTimes(1);
});
