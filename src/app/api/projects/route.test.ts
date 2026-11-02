import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ membership: vi.fn(), create: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { workspaceMember: { findFirst: mocks.membership }, project: { create: mocks.create } } }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.log }));
import { POST } from "./route";

const request = (body: unknown) => new Request("https://example.test/api/projects", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.membership.mockResolvedValue({ workspaceId: "selected-workspace" }); mocks.create.mockResolvedValue({ id: "p1", name: "Project" }); });

it("creates in the explicitly selected workspace rather than the first membership", async () => {
  expect((await POST(request({ name: " Project ", workspaceId: "selected-workspace" }))).status).toBe(200);
  expect(mocks.membership).toHaveBeenCalledWith({ where: { userId: "u1", workspaceId: "selected-workspace", workspace: { deletedAt: null } } });
  expect(mocks.create).toHaveBeenCalledWith({ data: { name: "Project", description: null, workspaceId: "selected-workspace" } });
});

it("does not create if the selected workspace is missing or inaccessible", async () => {
  expect((await POST(request({ name: "Project" }))).status).toBe(400);
  mocks.membership.mockResolvedValue(null);
  expect((await POST(request({ name: "Project", workspaceId: "other" }))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
