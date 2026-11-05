import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ source: vi.fn(), copies: vi.fn(), create: vi.fn(), access: vi.fn(), project: vi.fn(), members: vi.fn(), users: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceMember: mocks.access }));
vi.mock("@/lib/prisma", () => ({ prisma: { contentItem: { findUnique: mocks.source, findMany: mocks.copies, createManyAndReturn: mocks.create }, project: { findFirst: mocks.project }, workspaceMember: { findMany: mocks.members }, user: { findMany: mocks.users } } }));
import { POST } from "../route";
const now = new Date("2026-11-05T00:00:00Z");
const source = { id: "source", workspaceId: "source-workspace", projectId: "project", title: "원본", date: new Date("2026-11-05T00:00:00Z"), time: "09:00", status: "done", channels: ["블로그"], formats: ["텍스트"], campaign: "브랜딩", assignees: [{ id: null, name: "외부 담당자" }], body: "카피\n내용", link: "https://example.com/published", sourceUrl: "https://notion.so/original", notionId: "notion", recurrenceKey: "reminder:2026-11", createdAt: now, updatedAt: now };
const request = (over: Record<string, unknown> = {}) => new Request("https://example.com/api/content-calendar/items", { method: "POST", body: JSON.stringify({ copyFromId: "source", requestId: "11111111-1111-4111-8111-111111111111", ...over }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.source.mockResolvedValue(source); mocks.access.mockResolvedValue({ userId: "creator" }); mocks.project.mockResolvedValue({ id: "project" }); mocks.members.mockResolvedValue([]); mocks.users.mockResolvedValue([]); mocks.copies.mockResolvedValue([]);
  mocks.create.mockImplementation(async ({ data }) => data.map((row: object, i: number) => ({ ...row, id: `new-${i}`, createdAt: now, updatedAt: now })));
});
it("copies content and historical assignees using the source workspace, with fresh publication state", async () => {
  const response = await POST(request({ workspaceId: "wrong-sidebar-workspace" })); const data = await response.json();
  expect(response.status).toBe(201); expect(mocks.access).toHaveBeenCalledWith("source-workspace");
  expect(data.items[0]).toMatchObject({ title: "원본 (복사)", date: "2026-11-05", time: "09:00", status: "waiting", link: "", body: "카피\n내용", assignees: source.assignees });
  expect(mocks.create.mock.calls[0][0].data[0]).not.toHaveProperty("notionId");
});
it("creates the complete repeat batch with consistent fields", async () => {
  const response = await POST(request({ repeat: { unit: "week", interval: 1, end: "count", count: 2 } })); const data = await response.json();
  expect(data.created.map((i: { date: string }) => i.date)).toEqual(["2026-11-12", "2026-11-19"]);
  expect(mocks.create.mock.calls[0][0].data.every((i: { title: string; status: string }) => i.title === "원본" && i.status === "waiting")).toBe(true);
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("returns existing copies on retry instead of creating another batch", async () => {
  mocks.copies.mockResolvedValue([{ ...source, id: "existing-copy" }]);
  const response = await POST(request()); expect((await response.json()).items[0].id).toBe("existing-copy"); expect(mocks.create).not.toHaveBeenCalled();
});
it("rejects workspace access, invalid repetition and cross-workspace projects before creation", async () => {
  mocks.access.mockResolvedValueOnce({ error: "접근 불가", status: 403 }); expect((await POST(request())).status).toBe(403);
  expect((await POST(request({ repeat: { unit: "day", interval: 0, end: "count", count: 2 } }))).status).toBe(400);
  mocks.project.mockResolvedValueOnce(null); expect((await POST(request({ projectId: "foreign" }))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
