// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WS = { workspace: { id: "ws1" } };
vi.mock("@/contexts/workspace", () => ({ useWorkspace: () => WS }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => async () => true }));

import TaxonomyTab from "../TaxonomyTab";
import UtmPresetsPanel from "../../utm-builder/UtmPresetsPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
let urls: string[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  urls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.startsWith("/api/utm-presets") && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ presets: [{ id: "p1", field: "source", value: "meta", label: "메타" }] }), { status: 200 });
    }
    if (url.startsWith("/api/utm-presets") && init?.method === "POST") {
      return new Response(JSON.stringify({ preset: { id: "p2", field: "source", value: "naver", label: "" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ events: [] }), { status: 200 });
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

describe("이벤트 택소노미 탭", () => {
  it("UTM 값 대신 설계 안내를 보여 주고, UTM 선택지는 불러오지 않는다", async () => {
    const onOpenUtm = vi.fn();
    act(() => root.render(<TaxonomyTab onOpenUtm={onOpenUtm} />));
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("이벤트 택소노미 설계하기");
    expect(text).toContain("이름은 대상_동작");
    expect(text).not.toContain("utm_medium");
    expect(urls.some((u) => u.includes("/api/utm-presets"))).toBe(false);

    const link = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("선택지 관리"))!;
    act(() => link.click());
    expect(onOpenUtm).toHaveBeenCalledOnce();
  });
});

describe("UTM 선택지 관리", () => {
  it("값을 추가하면 빌더에 바뀌었다고 알린다", async () => {
    const onChanged = vi.fn();
    act(() => root.render(<UtmPresetsPanel onChanged={onChanged} />));
    await flush();
    expect(container.textContent).toContain("utm_source");
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("meta");

    const input = [...container.querySelectorAll("input")].find((i) => i.placeholder === "새 값")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "naver");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const add = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "추가")!;
    await act(async () => { add.click(); });
    await flush();
    expect(urls).toContain("POST /api/utm-presets");
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
