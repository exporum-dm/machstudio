// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import LandingPageTab from "../LandingPageTab";

/**
 * 히어로 "자간" 입력 칸 — 음수·소수를 직접 타이핑할 수 있는가.
 *
 * 왜 이 테스트가 있나: type="number" + value={state 숫자} 로 직접 묶으면 음수 입력이 막힌다.
 * "-" 한 글자만 친 시점의 문자열은 유효한 숫자가 아니라서, number input 의 value IDL 이
 * 스펙상 그 글자를 빈 문자열로 되돌리고 React 가 그 빈 값을 즉시 되그린다 — 사용자 눈에는
 * 지운 숫자(예: 0)가 바로 되살아나 직접 타이핑이 안 되고 스피너로만 조절되는 것처럼 보인다
 * (실사용 리포트). LandingPageTab.tsx 는 화면에 보이는 글자(trackingDraft)를 실제 값과
 * 분리해 들고, 글자가 완성된 숫자로 읽힐 때만 실제 값을 갱신한다.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <LandingPageTab
        webinar={{ id: "w1", slug: "s1", name: "테스트", description: null, config: {}, liveStartAt: "2026-08-11T05:00:00.000Z" }}
        onSilentUpdate={() => {}}
      />,
    );
  });
  return host;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  host = null;
  root = null;
});

function trackingInput(el: HTMLElement): HTMLInputElement {
  return el.querySelector('input[id$="-title-tracking"]') as HTMLInputElement;
}

/** 실제 타이핑처럼 한 글자씩 — nativeInputValueSetter + input 이벤트. */
function typeChar(input: HTMLInputElement, nextValue: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(input: HTMLInputElement) {
  act(() => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
}

describe("자간 입력 — 음수·소수를 한 글자씩 쳐도 지워지지 않는다", () => {
  it("'-' 한 글자만 쳐도 화면 글자가 유지된다 — 바로 이전 값으로 되돌아가지 않는다", () => {
    const el = render();
    const input = trackingInput(el);
    expect(input.value).toBe("-5.5"); // 기본값

    typeChar(input, "-");
    expect(input.value).toBe("-"); // 예전엔 여기서 빈 문자열/이전 값으로 되돌아갔다
  });

  it("'-5.5' 를 한 글자씩 완성하면 화면·실제 값이 모두 -5.5 가 된다", () => {
    const el = render();
    const input = trackingInput(el);

    for (const partial of ["-", "-5", "-5.", "-5.5"]) {
      typeChar(input, partial);
      expect(input.value, partial).toBe(partial);
    }
    // 완성된 순간(각 단계)마다 미리보기용 실제 값도 같이 갱신돼야 한다 — "-5" 단계에서 이미 반영.
    blur(input);
    expect(input.value).toBe("-5.5");
  });

  it("0을 지우면 빈 칸이 되고, 그 자리에 바로 새 숫자를 칠 수 있다", () => {
    const el = render();
    const input = trackingInput(el);

    typeChar(input, "0");
    expect(input.value).toBe("0");
    typeChar(input, "");
    expect(input.value).toBe(""); // 예전엔 지우자마자 0으로 되돌아와 지워지지 않았다
    typeChar(input, "-8");
    expect(input.value).toBe("-8");
    blur(input);
    expect(input.value).toBe("-8");
  });

  it("포커스를 떠날 때 '-'만 남아 있으면 마지막 실제 값으로 되돌아간다", () => {
    const el = render();
    const input = trackingInput(el);

    typeChar(input, "3");
    blur(input);
    expect(input.value).toBe("3");

    typeChar(input, "-");
    expect(input.value).toBe("-");
    blur(input);
    expect(input.value).toBe("3"); // 미완성 상태를 남기고 떠나면 직전 유효 값으로 정리
  });

  it("범위(-20~20)를 넘는 값은 미리보기에는 잘려 반영되지만, blur 전까지 화면 글자는 그대로 둔다", () => {
    const el = render();
    const input = trackingInput(el);

    typeChar(input, "50");
    expect(input.value).toBe("50"); // 타이핑 중엔 글자를 그대로 보여준다
    blur(input);
    expect(input.value).toBe("20"); // 실제 값(20으로 잘림)으로 정리된다
  });
});
