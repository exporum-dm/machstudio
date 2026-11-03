// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RegistrantsTab from "../RegistrantsTab";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/**
 * 등록자 명단 열 선택·너비 조절(2026-11-03).
 *
 * 왜 생겼나: 화면 열이 고정이라 CSV 를 받아야만 부서·UTM·커스텀 항목을 볼 수 있었다.
 * 그 값들은 이미 명단 API 로 오고 있으니 화면에서 골라 켤 수 있어야 한다. 고른 열·너비는
 * 이 브라우저에 남아서 다음에 열어도 그대로여야 한다.
 */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "r1", name: "김철수", phone: "01011112222", email: "kim@example.com", company: "아웃컴",
    department: "마케팅팀", jobTitle: null, industry: null, agreeMarketing: true, agreePrivacy: true, agreeThirdParty: false,
    memo: JSON.stringify({ memo: "", customFields: { size: "50인 이상" } }),
    stayMinutes: 0, connectedSeconds: 0, focusSeconds: 0, isActive: false, isLive: false,
    submittedAt: "2026-08-01T00:00:00Z", enteredAt: null, lastPingAt: null,
    utmSource: "naver", utmMedium: "cpc", utmCampaign: null, firstUtmSource: null, firstUtmMedium: null, firstUtmCampaign: null, referrer: null,
    score: 0, segment: "noShow", scoreBreakdown: null,
    ...over,
  };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mockFetch() {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({
      registrations: [row()],
      total: 1,
      stats: { registered: 1, entered: 0, active: 0, surveyResponded: 0 },
      scoring: { phase: "before", liveMinutes: 0, scheduledMinutes: 60 },
      surveys: [],
      surveyResponses: [],
      qaItems: [],
      customFields: [{ key: "size", label: "회사 규모" }],
    }),
  }) as unknown as Response));
}

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(<ConfirmProvider><RegistrantsTab webinarId="w1" /></ConfirmProvider>); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

const headers = (el: HTMLElement) => [...el.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
const click = async (node: Element | undefined | null) => {
  expect(node).toBeTruthy();
  await act(async () => { node?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};
const buttonByText = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith(text));

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mockFetch();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null; root = null;
  vi.unstubAllGlobals();
});

describe("열 선택", () => {
  it("기본은 예전 화면의 열 — 부서·UTM·커스텀 항목은 꺼져 있다", async () => {
    const el = await render();
    const h = headers(el);
    expect(h).toContain("이메일");
    expect(h).not.toContain("부서");
    expect(h).not.toContain("회사 규모");
    expect(h).not.toContain("UTM 소스(마지막 유입)");
  });

  it("열 선택에서 켜면 값이 보이고, 다시 열어도 남아 있다", async () => {
    const el = await render();
    await click(buttonByText(el, "열 선택"));
    await click([...el.querySelectorAll('[role="menuitemcheckbox"]')].find((b) => b.textContent?.includes("회사 규모")));
    await click([...el.querySelectorAll('[role="menuitemcheckbox"]')].find((b) => b.textContent?.includes("부서")));
    expect(headers(el)).toContain("회사 규모");
    expect(el.textContent).toContain("50인 이상");
    expect(el.textContent).toContain("마케팅팀");

    // 다시 그려도(다음 방문) 같은 열
    act(() => root?.unmount());
    host?.remove();
    const again = await render();
    expect(headers(again)).toContain("회사 규모");
    expect(headers(again)).toContain("부서");
  });

  it("이름 열은 끌 수 없다 — 목록에 없다", async () => {
    const el = await render();
    await click(buttonByText(el, "열 선택"));
    const items = [...el.querySelectorAll('[role="menuitemcheckbox"]')].map((b) => b.textContent ?? "");
    expect(items.some((t) => t.trim() === "이름")).toBe(false);
  });
});

describe("열 너비", () => {
  it("키보드로 넓히면 저장되고, 두 번 누르면 기본 너비로", async () => {
    const el = await render();
    const handle = el.querySelector('[role="separator"][aria-label="이메일 열 너비"]') as HTMLElement;
    expect(handle).toBeTruthy();
    expect(handle.getAttribute("aria-valuenow")).toBe("190");
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(handle.getAttribute("aria-valuenow")).toBe("206");
    expect(JSON.parse(window.localStorage.getItem("machstudio:webinar-registrant-columns:v1") ?? "{}").widths.email).toBe(206);
    await act(async () => { handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(handle.getAttribute("aria-valuenow")).toBe("190");
  });
});
