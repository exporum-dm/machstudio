import { beforeEach, expect, it, vi } from "vitest";
import { PATCH } from "./route";

const { countSessions, updateWebinar } = vi.hoisted(() => ({
  countSessions: vi.fn(),
  updateWebinar: vi.fn(),
}));

vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "operator" } } }) } }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webinar: {
      findUnique: async () => ({ workspaceId: "workspace", components: { chatEnabled: true, liveNextSession: "next-session" } }),
      update: updateWebinar,
    },
    workspaceMember: { findUnique: async () => ({ role: "owner" }) },
    webinarSession: { count: countSessions },
  },
}));

const patchCurrent = (value: string) => PATCH(new Request("https://example.test/api/webinars/webinar-a", {
  method: "PATCH",
  body: JSON.stringify({ components: { liveCurrentSession: value } }),
}), { params: Promise.resolve({ id: "webinar-a" }) });

beforeEach(() => vi.clearAllMocks());

it("rejects session IDs from another webinar, and prevents using the same session twice", async () => {
  countSessions.mockResolvedValue(0);
  expect((await patchCurrent("foreign-session")).status).toBe(400);
  expect(countSessions).toHaveBeenCalledWith({ where: { webinarId: "webinar-a", id: { in: ["foreign-session"] } } });
  expect((await patchCurrent("next-session")).status).toBe(400);
  expect(updateWebinar).not.toHaveBeenCalled();
});

it("updates one highlight while preserving the other live settings", async () => {
  countSessions.mockResolvedValue(1);
  updateWebinar.mockResolvedValue({ id: "webinar-a" });
  expect((await patchCurrent("current-session")).status).toBe(200);
  expect(updateWebinar).toHaveBeenCalledWith({
    where: { id: "webinar-a" },
    data: { components: { chatEnabled: true, liveNextSession: "next-session", liveCurrentSession: "current-session" } },
  });
});
