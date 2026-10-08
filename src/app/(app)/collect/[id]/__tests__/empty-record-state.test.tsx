// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CollectDetailPage from "../page";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const replace = vi.fn();
let container: HTMLDivElement;
let root: Root;

vi.mock("@/contexts/workspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "workspace-1" },
    currentProject: { id: "project-1" },
    projects: [{ id: "project-1" }],
    setCurrentProject: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  // 기본 탭이 현황이 됐다(2026-10-08) — 이 테스트는 등록자 DB 탭의 빈 상태를 본다.
  useSearchParams: () => new URLSearchParams("tab=records"),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("@/app/(app)/collect/_components/ActiveToggle", () => ({
  default: () => null,
}));

const source = (mode: string) => ({
  id: "source-1",
  mode,
  previewToken: null,
  formConfig: null,
  name: "등록 폼",
  description: null,
  apiKey: "key-1",
  siteUrl: null,
  successTrigger: "",
  redirectUrl: null,
  isActive: true,
  projectId: "project-1",
  workspaceId: "workspace-1",
  webhookUrl: null,
  notifyOnSubmit: false,
  allowedOrigins: [],
  formPagePatterns: [],
  dedupKeyFields: [],
  fieldMappings: [],
  discoveredFields: null,
  _count: { records: 0 },
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/collect-sources/source-1") {
      return Response.json({ source: source(currentMode) });
    }
    if (url.startsWith("/api/collect-sources/source-1/records?")) {
      return Response.json({ records: [], total: 0 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  replace.mockReset();
});

let currentMode = "capture";

async function renderDetail(mode: string) {
  currentMode = mode;
  await act(async () => {
    root.render(<CollectDetailPage params={Promise.resolve({ id: "source-1" })} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("아직 수집된 데이터가 없어요");
}

describe("수집 데이터 빈 상태", () => {
  it("빌더형은 등록 폼 탭에서 만든 폼의 데이터가 쌓인다고 안내한다", async () => {
    await renderDetail("builder");

    expect(container.textContent).toContain("등록 폼 탭에서 폼을 만들고 코드를 붙이면 여기 쌓여요");
    expect(container.textContent).not.toContain("스크립트를 설치하면 폼 제출 시 자동으로 수집돼요");
  });

  it("연동형은 기존 스크립트 설치 안내를 유지한다", async () => {
    await renderDetail("capture");

    expect(container.textContent).toContain("스크립트를 설치하면 폼 제출 시 자동으로 수집돼요");
  });
});
