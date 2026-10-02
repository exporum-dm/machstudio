// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FormBuilderTab from "../FormBuilderTab";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

/**
 * 등록 폼 자동저장 — 저장 성공 값이 **상위(페이지 source 상태)로 올라가야** 한다.
 *
 * 2026-10-02 현장: 등록 폼을 고치고 다른 탭(수집 데이터·현장 체크인)에 갔다 오면 이 탭이 페이지를 처음
 * 열 때 받은 낡은 formConfig 로 다시 그려졌다. 운영자에게는 "자동저장이 안 됐다" 로 보였고, 그 화면에서
 * 하나라도 고치면 낡은 설정 + 그 수정이 저장돼 앞서 저장한 변경이 지워졌다.
 * InfoTab 은 같은 이유로 onSaved 를 이미 올린다(info-tab-autosave.test.tsx).
 */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom 에 없는 브라우저 API — 드래그·크기 관찰을 쓰는 하위 컴포넌트가 부른다
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const INITIAL = {
  fields: [
    { key: "first_name", type: "text", label: { en: "First Name" } },
    { key: "email", type: "text", label: { en: "Email" } },
  ],
};

function render(onSaved: (config: unknown) => void, initialConfig: unknown = INITIAL) {
  act(() => {
    root.render(
      <ConfirmProvider>
        <FormBuilderTab sourceId="source_1" initialConfig={initialConfig} previewToken={null} onSaved={onSaved} />
      </ConfirmProvider>,
    );
  });
}

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** "First Name" 이 들어 있는 첫 입력칸 — 항목 라벨 편집칸 */
function labelInput(): HTMLInputElement {
  const el = [...container.querySelectorAll("input")].find((i) => (i as HTMLInputElement).value === "First Name");
  if (!el) throw new Error("라벨 입력칸을 찾지 못했어요");
  return el as HTMLInputElement;
}

describe("FormBuilderTab autosave", () => {
  it("PATCH 성공한 설정을 상위 source 상태로 올린다", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(onSaved);

    act(() => type(labelInput(), "Given Name"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(fetchMock).toHaveBeenCalledWith("/api/collect-sources/source_1", expect.objectContaining({ method: "PATCH" }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    const saved = onSaved.mock.calls[0][0] as { fields: Array<{ label: Record<string, string> }> };
    expect(saved.fields[0].label.en).toBe("Given Name");
  });

  it("PATCH 실패한 설정은 저장된 것으로 올리지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const onSaved = vi.fn();
    render(onSaved);

    act(() => type(labelInput(), "Will Fail"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(onSaved).not.toHaveBeenCalled();
  });

  /** 탭을 떠나며 보낸 저장이 돌아온 뒤 상위 값이 바뀌면, 다시 연 탭이 그 값을 따라간다(편집 중이 아닐 때). */
  it("상위 formConfig 가 바뀌면 편집 중이 아닐 때 따라간다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const onSaved = vi.fn();
    render(onSaved);
    expect(labelInput().value).toBe("First Name");

    const newer = { fields: [{ key: "first_name", type: "text", label: { en: "Updated Elsewhere" } }, INITIAL.fields[1]] };
    render(onSaved, newer);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    const el = [...container.querySelectorAll("input")].find((i) => (i as HTMLInputElement).value === "Updated Elsewhere");
    expect(el).toBeTruthy();
  });
});
