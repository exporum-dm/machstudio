import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ApiPrincipal } from "@/lib/api-auth";
import {
  getApiAdPerformance,
  getApiDashboard,
  listApiProjects,
  parseApiDateRange,
  requireApiProject,
} from "@/lib/external-api-data";

const rangeSchema = z.object({
  projectId: z.string().describe("Machstudio project ID. Ignored and overridden when this connector URL is locked to a single project."),
  from: z.string().optional().describe("ISO 8601 start. Defaults to 30 days before to"),
  to: z.string().optional().describe("ISO 8601 end. Defaults to now"),
});

function result(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function failure(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function hasScope(principal: ApiPrincipal, scope: string) {
  return principal.scopes.includes(scope);
}

async function dashboardFor(principal: ApiPrincipal, input: z.infer<typeof rangeSchema>, lockProjectId?: string) {
  if (!hasScope(principal, "dashboards:read")) return { error: "dashboards:read 권한이 필요합니다." } as const;
  const projectId = lockProjectId ?? input.projectId;
  if (!await requireApiProject(principal.workspaceId, projectId)) return { error: "프로젝트를 찾을 수 없습니다." } as const;
  try {
    const range = parseApiDateRange(input);
    const report = await getApiDashboard({ workspaceId: principal.workspaceId, projectId, range });
    return report ? { report } as const : { error: "데이터를 찾을 수 없습니다." } as const;
  } catch (error) {
    return { error: error instanceof Error && error.message === "date_range_too_large" ? "조회 기간은 최대 366일입니다." : "날짜 범위가 올바르지 않습니다." } as const;
  }
}

/** lockProjectId 가 있으면 이 커넥터는 그 프로젝트 하나로만 범위가 묶인다 — URL(/mcp/[projectId])로 결정되고, 모델이 다른 projectId 를 보내도 무시한다. */
export function createMachstudioMcpServer(principal: ApiPrincipal, lockProjectId?: string) {
  const server = new McpServer({ name: "machstudio", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.registerTool("list_projects", {
    title: "List Machstudio projects",
    description: lockProjectId
      ? "List the single project this connector is locked to, without personal registrant data."
      : "List projects available to this workspace token, without personal registrant data.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    if (!hasScope(principal, "dashboards:read")) return failure("dashboards:read 권한이 필요합니다.");
    const all = await listApiProjects(principal.workspaceId);
    const projects = lockProjectId ? all.filter((p) => p.id === lockProjectId) : all;
    return result({ projects, count: projects.length });
  });

  server.registerTool("get_dashboard_summary", {
    title: "Get dashboard summary",
    description: "Get aggregate registration, funnel, UTM and distribution metrics for a project.",
    inputSchema: rangeSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const found = await dashboardFor(principal, input, lockProjectId);
    return "error" in found ? failure(found.error ?? "데이터를 불러오지 못했습니다.") : result({ dashboard: found.report });
  });

  server.registerTool("get_registration_trend", {
    title: "Get registration trend",
    description: "Get registration totals, cumulative daily trend, field distributions and anomaly summary.",
    inputSchema: rangeSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const found = await dashboardFor(principal, input, lockProjectId);
    if ("error" in found) return failure(found.error ?? "데이터를 불러오지 못했습니다.");
    const report = found.report;
    return result({ generatedAt: report.generatedAt, project: report.project, range: report.range, performance: report.performance, trend: report.cumulativeTrend, fieldDistributions: report.fieldStats, duplicateSummary: report.dedup, anomaly: report.anomaly });
  });

  server.registerTool("get_utm_performance", {
    title: "Get UTM performance",
    description: "Get UTM source, medium, campaign combinations and daily attribution trend.",
    inputSchema: rangeSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const found = await dashboardFor(principal, input, lockProjectId);
    if ("error" in found) return failure(found.error ?? "데이터를 불러오지 못했습니다.");
    const report = found.report;
    return result({ generatedAt: report.generatedAt, project: report.project, range: report.range, topCombinations: report.utmTop, bySource: report.utmBySource, byMedium: report.utmByMedium, bySourceMedium: report.utmBySourceMedium, dailyTrend: report.dailyUtmTrend ?? null });
  });

  server.registerTool("get_ambassador_ranking", {
    title: "Get ambassador ranking",
    description: "Get ambassador registration ranking derived from UTM term where source is ambassador.",
    inputSchema: rangeSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const found = await dashboardFor(principal, input, lockProjectId);
    if ("error" in found) return failure(found.error ?? "데이터를 불러오지 못했습니다.");
    return result({ generatedAt: found.report.generatedAt, project: found.report.project, total: found.report.ambassadorTotal ?? 0, ranking: found.report.ambassadorRanking ?? [] });
  });

  server.registerTool("get_ad_performance", {
    title: "Get ad performance",
    description: "Get aggregate Meta, Google and other ad metrics including spend, CPM, CPC, CTR, CVR, CPA and ROAS.",
    inputSchema: rangeSchema.extend({ sourceType: z.enum(["ALL", "META", "GOOGLE", "TIKTOK", "LINKEDIN", "MANUAL"]).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    if (!hasScope(principal, "ads:read")) return failure("ads:read 권한이 필요합니다.");
    const projectId = lockProjectId ?? input.projectId;
    if (!await requireApiProject(principal.workspaceId, projectId)) return failure("프로젝트를 찾을 수 없습니다.");
    try {
      const range = parseApiDateRange(input);
      const ads = await getApiAdPerformance({ workspaceId: principal.workspaceId, projectId, range, sourceType: input.sourceType });
      return result({ ads });
    } catch (error) {
      return failure(error instanceof Error && error.message === "date_range_too_large" ? "조회 기간은 최대 366일입니다." : "날짜 범위가 올바르지 않습니다.");
    }
  });

  return server;
}
