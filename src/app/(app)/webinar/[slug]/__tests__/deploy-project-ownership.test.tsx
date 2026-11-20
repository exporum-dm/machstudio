// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeployTab from "../DeployTab";
import { getPublicAppOrigin } from "@/lib/app-url";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const workspaceContext = {
  workspace: { id: "ws-1" },
  currentProject: { id: "sidebar-project" },
};

vi.mock("@/contexts/workspace", () => ({
  useWorkspace: () => workspaceContext,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/app-url", () => ({
  getPublicAppOrigin: vi.fn(),
}));

vi.mock("@/components/ui/use-autosave", () => ({
  useAutosave: () => ({ state: "saved", retry: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let siteResponse: { sites: unknown[] };

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function render({ projectId = "url-project" }: { projectId?: string } = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <DeployTab
        webinarId="webinar-1"
        projectId={projectId}
        slug="url-webinar"
        webinarName="URL 웨비나"
      />,
    );
  });
  return host;
}

beforeEach(() => {
  vi.mocked(getPublicAppOrigin).mockReturnValue("https://app.example.com");
  siteResponse = { sites: [] };
  window.scrollTo = vi.fn();
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: async () => url.startsWith("/api/webinar-embed-sites") ? siteResponse : { webinar: null },
  })));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("배포 탭은 URL 웨비나의 프로젝트에만 사이트를 연결한다", () => {
  it("목록과 생성 요청 모두 사이드바가 아닌 URL 웨비나 프로젝트를 쓴다", async () => {
    const el = render();
    const fetchMock = vi.mocked(fetch);
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/webinar-embed-sites?workspaceId=ws-1&projectId=url-project",
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("sidebar-project"))).toBe(false);

    const openCreate = [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("새 사이트 연결"));
    act(() => { openCreate?.click(); });
    const nameInput = el.querySelector<HTMLInputElement>('input[placeholder^="사이트 이름"]');
    expect(nameInput).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(nameInput, "행사 사이트");
      nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("이 웨비나로 연결하기"));
    act(() => { create?.click(); });
    await flush();

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      workspaceId: "ws-1",
      projectId: "url-project",
      activeWebinarId: "webinar-1",
    });
  });

  it("공개 주소가 없으면 상대 설치 코드·링크를 숨기고 설정 경고를 보인다", async () => {
    vi.mocked(getPublicAppOrigin).mockReturnValue("");
    siteResponse = {
      sites: [{
        id: "site-1",
        name: "행사 사이트",
        siteUrl: null,
        livePageUrl: null,
        bannerPagePatterns: [],
        lastSeenAt: null,
        lastSeenOrigin: null,
        isActive: true,
        activeWebinar: null,
      }],
    };
    const el = render();
    await flush();

    expect(el.textContent).toContain("공개 배포 주소가 설정되지 않아 랜딩 링크와 설치 코드를 복사할 수 없어요");
    expect(el.textContent).toContain("공개 배포 주소가 설정되지 않아 이 사이트의 설치 코드를 복사할 수 없어요");
    expect([...el.querySelectorAll("pre")].map((pre) => pre.textContent).join("\n")).not.toContain('src="/');
  });

  it("URL 웨비나에 프로젝트 소속이 없으면 목록 요청 없이 fail closed 상태를 보인다", async () => {
    const el = render({ projectId: "" });
    const fetchMock = vi.mocked(fetch);
    await flush();

    expect(el.textContent).toContain("프로젝트 정보를 확인할 수 없어요");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/webinar-embed-sites"))).toBe(false);
  });
});
