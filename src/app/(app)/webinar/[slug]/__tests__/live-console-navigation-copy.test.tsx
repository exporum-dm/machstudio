// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiveConsoleTab from "../LiveConsoleTab";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement | null = null;
let root: Root | null = null;

const dashboard = {
  status: "registration",
  isOverridden: false,
  summary: {
    totalRegistered: 0,
    attended: 0,
    activeViewers: 0,
    presenceViewers: 0,
    marketingAgreed: 0,
    pendingQuestions: 0,
    answeredQuestions: 0,
    dismissedQuestions: 0,
    totalQuestions: 0,
    attendRate: 0,
    marketingRate: 0,
    avgStayMinutes: 0,
    maxStayMinutes: 0,
    stay30: 0,
    stay60: 0,
    stay30Rate: 0,
    stay60Rate: 0,
  },
  currentViewers: [],
  latestQuestions: [],
  generatedAt: "2026-08-21T00:00:00.000Z",
};

const responsesByUrl: Record<string, unknown> = {
  "/api/webinars/webinar-navigation-copy/dashboard": dashboard,
  "/api/webinars/webinar-navigation-copy/analytics/attendance-curve?range=all": {
    points: [], peak: 0, avg: 0, hasData: false, clamped: false,
  },
  "/api/webinars/webinar-navigation-copy/activity": { items: [] },
  "/api/webinars/webinar-navigation-copy/survey-responses": {
    total: 0, counts: {}, surveyOrder: [], surveys: {}, responses: [],
  },
  "/api/webinars/webinar-navigation-copy/chat": {
    messages: [],
    settings: { chatEnabled: false, hideLinks: true, slowSec: 0, bannedWords: [], bannedCount: 0 },
  },
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clickDisclosure(label: string) {
  const button = [...host!.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.includes(label));
  expect(button).toBeTruthy();
  act(() => { button?.click(); });
}

type ConsoleProps = ComponentProps<typeof LiveConsoleTab>;

function render(
  webinar: ConsoleProps["webinar"] = { config: {}, components: { chatEnabled: false }, sessions: [], _count: { registrations: 0 } },
  onSilentUpdate?: ConsoleProps["onSilentUpdate"],
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <ConfirmProvider>
        <LiveConsoleTab
          webinarId="webinar-navigation-copy"
          webinar={webinar}
          onSilentUpdate={onSilentUpdate}
        />
      </ConfirmProvider>,
    );
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("운영 콘솔 안내는 현재 만들기 메뉴를 가리킨다", () => {
  it("폼 응답과 채팅 안내가 현행 시청 화면 경로를 표시한다", async () => {
    // jsdom에는 차트 캔버스 구현이 없다. 실제 콘솔 렌더와 fetch 경계는 유지하고, 없는 브라우저
    // 그리기 API만 null로 둬 OverviewChart가 그리기를 건너뛰게 한다.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const body = responsesByUrl[url];
      if (!body) throw new Error(`Unexpected fetch: ${url}`);
      return Promise.resolve({ ok: true, json: async () => body });
    }));

    render();
    await flush();

    clickDisclosure("문의·폼 응답");
    await flush();
    expect(host?.textContent).toContain("만들기 → 시청 화면 → 라이브의 CTA 버튼에 폼을 연결하면");

    clickDisclosure("실시간 채팅");
    await flush();
    expect(host?.textContent).toContain("만들기 → 시청 화면 → 라이브 → 참여 구성에서 채팅을 켜야 시청 화면에 보여요");
    expect(host?.textContent).toContain("만들기 → 시청 화면 → 라이브 → 참여 구성에서 채팅을 켜야 보여요");
    expect(host?.textContent).not.toContain("만들기 → 라이브 페이지");
  });
});

it("saves a manual session selection and refreshes the parent webinar", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "PATCH") return { ok: true };
    return { ok: true, json: async () => responsesByUrl[url] };
  });
  vi.stubGlobal("fetch", fetchMock);
  const onSilentUpdate = vi.fn(async () => {});
  render({
    config: {},
    components: { liveNextSession: "next" },
    sessions: [
      { id: "current", number: 1, type: "session", title: "Current speaker", startTime: "14:00", endTime: "14:20" },
      { id: "next", number: 2, type: "session", title: "Next speaker", startTime: "14:20", endTime: "14:40" },
    ],
    _count: { registrations: 0 },
  }, onSilentUpdate);
  await flush();

  const selects = host!.querySelectorAll<HTMLSelectElement>("select");
  const current = [...selects].find((select) => select.closest("label")?.textContent?.includes("현재 세션 표시"));
  expect(current?.value).toBe("auto");
  expect(current?.querySelector<HTMLOptionElement>("option[value='next']")?.disabled).toBe(true);
  await act(async () => {
    current!.value = "current";
    current!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(fetchMock).toHaveBeenCalledWith("/api/webinars/webinar-navigation-copy", expect.objectContaining({
    method: "PATCH",
    body: JSON.stringify({ components: { liveCurrentSession: "current" } }),
  }));
  expect(current?.value).toBe("current");
  expect(onSilentUpdate).toHaveBeenCalledOnce();
});
