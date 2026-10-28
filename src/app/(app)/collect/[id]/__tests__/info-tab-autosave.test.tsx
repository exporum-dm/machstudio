// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InfoTab, { type VenueInfo } from "../InfoTab";
import { EMPTY_FORM_CONFIG } from "@/lib/collect-form-config";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render(onSaved: (value: VenueInfo) => void) {
  act(() => {
    root.render(<InfoTab sourceId="source_1" initial={{}} onSaved={onSaved} />);
  });
}

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("InfoTab autosave", () => {
  it("PATCH 성공 값을 상위 source 상태에도 반영한다", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(onSaved);

    const venueInput = container.querySelectorAll("input")[2] as HTMLInputElement;
    act(() => {
      type(venueInput, "코엑스 A홀");
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collect-sources/source_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ venueConfig: { venue: "코엑스 A홀" } }),
      }),
    );
    expect(onSaved).toHaveBeenCalledWith({ venue: "코엑스 A홀" });
  });

  it("PATCH 실패 값을 저장 완료로 상위 상태에 반영하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const onSaved = vi.fn();
    render(onSaved);

    const venueInput = container.querySelectorAll("input")[2] as HTMLInputElement;
    act(() => {
      type(venueInput, "실패할 장소");
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });

    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("InfoTab 등록 시간 (빌더형)", () => {
  it("연동형(formConfig 없음)에는 등록 시간 영역이 없다", () => {
    render(vi.fn());
    expect(container.textContent).not.toContain("등록 시간");
  });

  it("켜고 개최일로 채우면 registrationSchedule 만 따로 저장하고, 응답의 폼 정의를 상위로 올린다", async () => {
    const saved = { ...EMPTY_FORM_CONFIG, schedule: { ...EMPTY_FORM_CONFIG.schedule, enabled: true } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ source: { formConfig: saved } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onFormConfigSaved = vi.fn();
    act(() => {
      root.render(
        <InfoTab
          sourceId="source_1"
          initial={{ eventStart: "2026-10-22", eventEnd: "2026-10-24" }}
          formConfig={EMPTY_FORM_CONFIG}
          onFormConfigSaved={onFormConfigSaved}
        />,
      );
    });

    const toggle = container.querySelector('[role="switch"][aria-label="등록 시간대로 폼 열고 닫기"]') as HTMLButtonElement;
    const fill = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("개최일로 채우기")) as HTMLButtonElement;
    act(() => { toggle.click(); });
    act(() => { fill.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(Object.keys(body)).toEqual(["registrationSchedule"]);
    expect(body.registrationSchedule.enabled).toBe(true);
    expect(body.registrationSchedule.onsite).toEqual([
      { date: "2026-10-22", open: "08:00", close: "17:00" },
      { date: "2026-10-23", open: "08:00", close: "17:00" },
      { date: "2026-10-24", open: "08:00", close: "17:00" },
    ]);
    expect(onFormConfigSaved).toHaveBeenCalledWith(saved);
  });
});
