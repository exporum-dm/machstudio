// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceInfoEditor } from "../SourceInfoEditor";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/**
 * 등록 폼 정보 수정(2026-11-03) — 만들 때 적은 설명·사이트 주소를 그 뒤로 고칠 곳이 없었다.
 */
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let host: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null; root = null;
  vi.unstubAllGlobals();
});

const SOURCE = { id: "s1", name: "2026 서울 인디뷰티쇼 등록", description: "일반·바이어 통합 등록 자료", siteUrl: "https://www.indiebeautyshow.com/" };

async function render(onSaved = vi.fn(), onCancel = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(<SourceInfoEditor source={SOURCE} onSaved={onSaved} onCancel={onCancel} />); });
  return host;
}

/** React 가 관리하는 입력칸에 값 넣기 */
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("등록 폼 정보 수정", () => {
  it("설명(줄바꿈 포함)과 사이트 주소를 고쳐 저장한다", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const el = await render(onSaved);
    await act(async () => { type(el.querySelector("textarea")!, "일반 8,251건\n바이어 1,015건"); });
    await act(async () => { type(el.querySelector('input[type="url"]') as HTMLInputElement, "https://indiebeauty.kr/"); });
    await act(async () => { el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("/api/collect-sources/s1");
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ name: SOURCE.name, description: "일반 8,251건\n바이어 1,015건", siteUrl: "https://indiebeauty.kr/" });
    expect(onSaved).toHaveBeenCalledWith({ ...SOURCE, description: "일반 8,251건\n바이어 1,015건", siteUrl: "https://indiebeauty.kr/" });
  });

  it("사이트 주소를 비우면 지운다 · 잘못된 주소면 저장 버튼이 잠긴다", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const el = await render();
    const url = el.querySelector('input[type="url"]') as HTMLInputElement;
    await act(async () => { type(url, "indie beauty"); });
    const submit = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("저장")) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await act(async () => { type(url, ""); });
    expect(submit.disabled).toBe(false);
    await act(async () => { el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(calls[0][1].body)).siteUrl).toBe("");
  });

  it("바꾼 게 없으면 저장하지 않고 닫는다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onCancel = vi.fn();
    const el = await render(vi.fn(), onCancel);
    await act(async () => { el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
