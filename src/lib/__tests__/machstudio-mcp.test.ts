import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

vi.mock("@/lib/external-api-data", () => ({
  listApiProjects: vi.fn(async () => [{ id: "project-1", name: "Korea Expo", counts: { registrations: 12 } }]),
  requireApiProject: vi.fn(async () => ({ id: "project-1", name: "Korea Expo", workspaceId: "workspace-1" })),
  parseApiDateRange: vi.fn(() => ({ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-19T00:00:00Z") })),
  getApiDashboard: vi.fn(async () => ({
    generatedAt: "2026-09-19T00:00:00Z",
    project: { id: "project-1", name: "Korea Expo" },
    range: {}, performance: {}, cumulativeTrend: [], fieldStats: [], dedup: {}, anomaly: null,
    utmTop: [], utmBySource: [], utmByMedium: [], utmBySourceMedium: [], ambassadorTotal: 0, ambassadorRanking: [],
  })),
  getApiAdPerformance: vi.fn(async () => ({ totals: { cost: 100, cpm: 10, cpc: 2, cpa: 5, roas: 3 } })),
}));

vi.mock("@/lib/content-calendar-api", () => ({
  MAX_API_CONTENT_ITEMS: 300,
  isWorkspaceMember: vi.fn(async () => true),
  listApiContentItems: vi.fn(async () => ({ items: [], count: 0, teamMembers: ["이창환"], statuses: [] })),
  createApiContentItems: vi.fn(async (_ctx: unknown, items: unknown[]) => ({ created: items, count: items.length })),
  updateApiContentItem: vi.fn(async () => ({ item: { id: "c1" } })),
}));

import { createMachstudioMcpServer } from "@/lib/machstudio-mcp";
import { createApiContentItems } from "@/lib/content-calendar-api";
import { getApiDashboard } from "@/lib/external-api-data";

const servers: Array<{ close(): Promise<void> }> = [];
const clients: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
});

async function connect(scopes: string[], lockProjectId?: string) {
  const server = createMachstudioMcpServer({ workspaceId: "workspace-1", userId: "user-1", tokenId: "token-1", scopes }, lockProjectId);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  servers.push(server);
  clients.push(client);
  return client;
}

describe("Machstudio MCP", () => {
  it("lists the read-only analysis tools", async () => {
    const client = await connect(["dashboards:read", "ads:read"]);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "list_projects", "get_dashboard_summary", "get_registration_trend", "get_utm_performance", "get_ambassador_ranking", "get_ad_performance",
    ]));
    expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("returns structured project data and enforces scopes", async () => {
    const client = await connect(["dashboards:read"]);
    const projects = await client.callTool({ name: "list_projects", arguments: {} });
    expect(projects.structuredContent).toMatchObject({ count: 1 });
    const ads = await client.callTool({ name: "get_ad_performance", arguments: { projectId: "project-1" } });
    expect(ads.isError).toBe(true);
    expect(ads.content).toContainEqual(expect.objectContaining({ text: expect.stringContaining("ads:read") }));
  });

  it("locked to one project — list_projects only shows it and other projectIds are ignored", async () => {
    const client = await connect(["dashboards:read"], "project-1");
    const projects = await client.callTool({ name: "list_projects", arguments: {} });
    expect(projects.structuredContent).toMatchObject({ count: 1, projects: [{ id: "project-1" }] });

    await client.callTool({ name: "get_dashboard_summary", arguments: { projectId: "some-other-project" } });
    expect(vi.mocked(getApiDashboard)).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1" }));
  });

  it("content tools — 조회 전용 토큰에는 안 보이고, content:write 면 추가가 된다(프로젝트 잠금 전달)", async () => {
    const readOnly = await connect(["dashboards:read"]);
    const names = (await readOnly.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("create_content_items");
    expect(names).not.toContain("list_content_items");

    const writer = await connect(["content:write"], "project-1");
    const writerNames = (await writer.listTools()).tools.map((t) => t.name);
    expect(writerNames).toEqual(expect.arrayContaining(["list_content_items", "create_content_items", "update_content_item"]));
    const out = await writer.callTool({ name: "create_content_items", arguments: { items: [{ title: "카드뉴스 1", date: "2026-12-01", channels: ["인스타그램"] }] } });
    expect(out.isError).toBeFalsy();
    expect(out.structuredContent).toMatchObject({ count: 1 });
    expect(vi.mocked(createApiContentItems)).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", userId: "user-1", lockProjectId: "project-1" },
      [expect.objectContaining({ title: "카드뉴스 1" })],
    );
  });
});
