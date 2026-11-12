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
import {
  MAX_API_CONTENT_ITEMS, createApiContentItems, isWorkspaceMember, listApiContentItems, updateApiContentItem,
} from "@/lib/content-calendar-api";

const rangeSchema = z.object({
  projectId: z.string().describe("Machstudio project ID. Ignored and overridden when this connector URL is locked to a single project."),
  from: z.string().optional().describe("ISO 8601 start. Defaults to 30 days before to"),
  to: z.string().optional().describe("ISO 8601 end. Defaults to now"),
});

const contentFields = {
  title: z.string().describe("Content title"),
  date: z.string().nullable().optional().describe("Publish date YYYY-MM-DD (KST). null or omitted = date undecided"),
  time: z.string().optional().describe("Publish time HH:MM 24h, or empty"),
  status: z.enum(["waiting", "planning", "doing", "design", "confirm", "done", "stopped"]).optional()
    .describe("waiting=대기(default), planning=기획 중, doing=진행 중, design=디자인 중, confirm=컨펌 대기, done=완료, stopped=중단"),
  channels: z.array(z.string()).optional().describe("Channels, e.g. 인스타그램, 페이스북, 유튜브, 블로그, 스레드, X, 틱톡, 링크드인, 카카오톡, 홈페이지, 스티비, SMS, 노션"),
  formats: z.array(z.string()).optional().describe("Formats, e.g. 카드뉴스, 숏폼 비디오, 롱폼 비디오, 스토리, 리그램, 텍스트, 뉴스레터, 표지"),
  campaign: z.string().optional().describe("One campaign label, e.g. 사전등록 유도, 티켓 판매, 참가사 모집, 바이어 모집, 브랜딩, 웨비나, 보도자료, 정보 제공, 기타"),
  assignees: z.array(z.string()).optional().describe("Assignee names — must match workspace team member names (see list_content_items teamMembers)"),
  body: z.string().optional().describe("Copy / memo text"),
  link: z.string().optional().describe("Published post URL (https://)"),
  projectId: z.string().nullable().optional().describe("Machstudio project ID from list_projects. null = team-wide. Ignored when the connector is locked to a project."),
};

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

  /** 콘텐츠 캘린더 — 토큰 주인이 지금도 워크스페이스 멤버인지 먼저 본다. */
  const contentCtx = async (scope: "content:read" | "content:write") => {
    if (!hasScope(principal, scope) && !(scope === "content:read" && hasScope(principal, "content:write"))) {
      return { error: `${scope} 권한이 필요합니다. 커넥터를 끊고 다시 연결해 권한을 허용해 주세요.` } as const;
    }
    if (!await isWorkspaceMember(principal.workspaceId, principal.userId)) return { error: "워크스페이스 멤버가 아니에요." } as const;
    return { ctx: { workspaceId: principal.workspaceId, userId: principal.userId, lockProjectId } } as const;
  };

  const canReadContent = hasScope(principal, "content:read") || hasScope(principal, "content:write");
  const canWriteContent = hasScope(principal, "content:write");

  if (canReadContent) server.registerTool("list_content_items", {
    title: "List content calendar items",
    description: "List planned/published content in the Machstudio content calendar for a date range (plus undated ideas). Also returns team member names and status ids. Call this before adding, to avoid duplicates.",
    inputSchema: z.object({
      from: z.string().describe("Start date YYYY-MM-DD"),
      to: z.string().describe("End date YYYY-MM-DD (max 400 days after from)"),
      projectId: z.string().optional().describe("Only this project. Omit for all projects."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const c = await contentCtx("content:read");
    if ("error" in c) return failure(c.error ?? "권한을 확인하지 못했어요.");
    const found = await listApiContentItems(c.ctx, input);
    return "error" in found ? failure(found.error ?? "불러오지 못했어요.") : result({ ...found });
  });

  if (canWriteContent) server.registerTool("create_content_items", {
    title: "Add content to the content calendar",
    description: `Add up to ${MAX_API_CONTENT_ITEMS} content items to the Machstudio content calendar in one call (e.g. from a content plan document). All-or-nothing: if any item is invalid, nothing is added and the error says which one. Confirm the list with the user before calling.`,
    inputSchema: z.object({ items: z.array(z.object(contentFields)).min(1).max(MAX_API_CONTENT_ITEMS) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => {
    const c = await contentCtx("content:write");
    if ("error" in c) return failure(c.error ?? "권한을 확인하지 못했어요.");
    const done = await createApiContentItems(c.ctx, input.items);
    return "error" in done ? failure(done.error ?? "저장하지 못했어요.") : result({ ...done });
  });

  if (canWriteContent) server.registerTool("update_content_item", {
    title: "Update a content calendar item",
    description: "Change fields of one existing content item (id from list_content_items). Only the given fields change. Deleting is not available here — do it in the Machstudio app.",
    inputSchema: z.object({ id: z.string().describe("Content item id"), ...contentFields, title: contentFields.title.optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const c = await contentCtx("content:write");
    if ("error" in c) return failure(c.error ?? "권한을 확인하지 못했어요.");
    const { id, ...fields } = input;
    const done = await updateApiContentItem(c.ctx, id, fields);
    return "error" in done ? failure(done.error ?? "저장하지 못했어요.") : result({ ...done });
  });

  return server;
}
