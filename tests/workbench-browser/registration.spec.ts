import { expect, test } from "@playwright/test";

const workspace = { id: "w1", name: "Test workspace", slug: "test", role: "OWNER" };
const sources = [
  { id: "s1", mode: "builder", name: "상담 신청", description: "제품 상담 접수", siteUrl: null, isActive: true, createdAt: "2026-11-02", _count: { records: 12 } },
  { id: "s2", mode: "capture", name: "자료 요청", description: "다운로드 문의", siteUrl: "https://example.com", isActive: false, createdAt: "2026-11-02", _count: { records: 3 } },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/workspace", route => route.fulfill({ json: { workspace, workspaces: [workspace], projects: [{ id: "p1", name: "Test project" }] } }));
  await page.route("**/api/heartbeat", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/collect-sources?*", route => route.fulfill({ json: { sources } }));
});

test("general-purpose forms can be searched, filtered, and created on desktop and mobile", async ({ page }, info) => {
  await page.goto("/dev/workbench-harness");
  await expect(page.getByRole("heading", { name: "등록", exact: true })).toBeVisible();
  await expect(page.getByText("상담 신청", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "등록 폼 상태" }).selectOption("inactive");
  await expect(page.getByText("상담 신청", { exact: true })).toHaveCount(0);
  await expect(page.getByText("자료 요청", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "등록 폼 검색" }).fill("없는 항목");
  await expect(page.getByText("조건에 맞는 등록 폼이 없어요.")).toBeVisible();
  await page.getByRole("button", { name: "검색·필터 초기화" }).click();
  await expect(page.getByText("상담 신청", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("registration.png"), fullPage: true });
  await page.getByRole("button", { name: "폼 만들기", exact: true }).click();
  await expect(page.getByRole("radio", { name: /직접 만들기/ })).toHaveAttribute("aria-checked", "true");
});

test("a failed list request offers retry instead of an empty state", async ({ page }) => {
  await page.route("**/api/collect-sources?*", route => route.fulfill({ status: 500, json: { error: "temporary" } }));
  await page.goto("/dev/workbench-harness");
  await expect(page.getByText("등록 폼 목록을 불러오지 못했어요")).toBeVisible();
  await expect(page.getByText("아직 등록 폼이 없어요")).toHaveCount(0);
  await page.route("**/api/collect-sources?*", route => route.fulfill({ json: { sources } }));
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByText("상담 신청", { exact: true })).toBeVisible();
});

test("failed activation keeps the switch state and does not show success", async ({ page }) => {
  await page.route("**/api/collect-sources/s1", route => route.fulfill({ status: 500, json: { error: "temporary" } }));
  await page.goto("/dev/workbench-harness");
  const toggle = page.getByRole("switch", { name: "상담 신청 접수" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(page.getByText("상태를 바꾸지 못했어요. 다시 시도해 주세요.")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("등록 폼이 비활성화됐어요")).toHaveCount(0);
});

test("other menus share searchable lists whose query survives reload", async ({ page }, info) => {
  await page.route("**/api/competitions?*", route => route.fulfill({ json: { competitions: [{ id: "c1", slug: "demo", name: "Demo competition", description: "", phaseOverride: null, recruitOpenAt: null, recruitCloseAt: null, createdAt: "2026-11-02", _count: { entries: 0 } }] } }));
  await page.route("**/api/detail-pages?*", route => route.fulfill({ json: { pages: [{ id: "d1", name: "Demo page", enabled: false, updatedAt: "2026-11-02" }] } }));
  await page.route("**/api/webinars**", route => route.fulfill({ json: { webinars: [{ id: "w1", slug: "demo", name: "Demo webinar", description: "", liveStartAt: "2027-01-01T00:00:00Z", liveEndAt: "2027-01-01T01:00:00Z", signupDeadline: "2027-01-01T00:00:00Z", createdAt: "2026-11-02", _count: { registrations: 0 } }] } }));
  await page.route("**/api/ad-performance/folders?*", route => route.fulfill({ json: { folders: [{ id: "a1", name: "Demo ads", description: "", reportStart: "2026-11-01", reportEnd: "2026-11-30", mediaAccounts: [] }] } }));
  for (const [view, label] of [["competition", "대회 검색"], ["detail", "상세페이지 검색"], ["webinar", "웨비나 검색"], ["analytics", "광고 폴더 검색"]]) {
    await page.goto(`/dev/workbench-harness?screen=${view}`);
    await page.getByRole("searchbox", { name: label }).fill("missing");
    await expect(page.getByText("검색 결과가 없어요.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`screen=${view}.*q=missing`));
    await page.reload();
    await expect(page.getByRole("searchbox", { name: label })).toHaveValue("missing");
    await page.getByRole("button", { name: "검색 초기화" }).click();
    await expect(page.getByText("검색 결과가 없어요.")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${view}.png`), fullPage: true });
  }
});

test("PR tabs restore from the URL and distinguish source platforms from import methods", async ({ page }, info) => {
  await page.route("**/api/pr-room", route => route.fulfill({ json: { canWrite: false, room: { id: "pr1", updatedAt: "2026-11-02T00:00:00Z", project: { name: "Test project" }, keywords: [], mentions: [{ id: "m1", title: "Community post", url: "https://www.instagram.com/p/demo/", source: "Google 뉴스", channel: "community", origin: "claude", sentiment: "neutral", status: "new", riskLevel: "watch", excerpt: "Example", publishedAt: null, collectedAt: "2026-11-02T00:00:00Z" }], pressReleases: [], excludedMentionUrls: [], excludedMentionRules: [], referenceUrls: [], lastCollectedAt: null } } }));
  await page.goto("/dev/workbench-harness?screen=pr&room=monitor&monitorTab=mentions");
  await expect(page.getByText("커뮤니티 · Instagram", { exact: false })).toBeVisible();
  await expect(page.getByText("Claude 가져오기")).toBeVisible();
  await page.getByRole("button", { name: "AI 웹 조사", exact: true }).click();
  await expect(page).toHaveURL(/monitorTab=ai/);
  await page.reload();
  await expect(page.getByLabel("조사 결과 JSON")).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Community post", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("pr.png"), fullPage: true });
});
