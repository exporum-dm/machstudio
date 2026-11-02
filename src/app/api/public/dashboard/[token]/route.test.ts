import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { dashboard: { findUnique: mocks.find } } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/share-password", () => ({ verifySharePassword: () => false }));
import { GET } from "./route";
beforeEach(() => vi.clearAllMocks());

it("allows anonymous read-only viewing of an enabled share link", async () => {
  mocks.find.mockResolvedValue({ id: "d1", name: "Report", shareEnabled: true, sharePasswordHash: null, widgets: [], project: { name: "Project" } });
  const response = await GET(new Request("https://example.test/share/report"), { params: Promise.resolve({ token: "a".repeat(32) }) });
  expect(response.status).toBe(200);
  expect((await response.json()).dashboard.name).toBe("Report");
});

it("keeps revoked share links unavailable without redirecting to login", async () => {
  mocks.find.mockResolvedValue({ shareEnabled: false });
  const response = await GET(new Request("https://example.test/share/report"), { params: Promise.resolve({ token: "a".repeat(32) }) });
  expect(response.status).toBe(404);
  expect(response.headers.get("location")).toBeNull();
});
