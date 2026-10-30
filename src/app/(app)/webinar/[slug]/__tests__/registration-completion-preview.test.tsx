// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RegistrationFormTab, { RegistrationFormPreview } from "../RegistrationFormTab";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const props = {
  fields: [],
  privacyText: "[필수] 개인정보 수집 및 이용에 동의합니다",
  marketingText: "[선택] 마케팅 정보 수신에 동의합니다",
  privacyBody: "",
  marketingBody: "",
  privacyDefaultChecked: false,
  marketingDefaultChecked: false,
  thirdPartyEnabled: false,
  thirdPartyText: "[선택] 개인정보 제3자 제공에 동의합니다",
  thirdPartyBody: "",
  thirdPartyDefaultChecked: false,
  submitLabel: "사전 등록하기",
  theme: { accent: "#6D28D9", text: "#141320", surface: "#FFFFFF" },
  slug: "preview-test",
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function renderPreview(successCta: { enabled: boolean; label: string; url: string }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<RegistrationFormPreview {...props} successCta={successCta} />);
  });
  return host;
}

function renderEditor() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <RegistrationFormTab
        webinar={{
          id: "webinar-editor-test",
          slug: "editor-test",
          config: {},
          liveStartAt: "2026-08-01T01:00:00.000Z",
          signupDeadline: "2026-08-01T00:00:00.000Z",
        }}
        onSilentUpdate={vi.fn()}
      />,
    );
  });
  return host;
}

function changeInput(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(host: HTMLElement, label: string) {
  const target = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === label);
  expect(target, `button “${label}”`).toBeTruthy();
  return target!;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe("등록 완료 미리보기", () => {
  it("유효하고 완전한 CTA만 완료 화면에 보이고 닫기로 폼 미리보기로 돌아온다", () => {
    const view = renderPreview({ enabled: true, label: "오픈채팅 입장", url: "https://example.com/chat" });

    act(() => button(view, "완료").click());

    expect(view.textContent).toContain("사전등록이 완료됐어요");
    expect(button(view, "오픈채팅 입장").className).toContain("rp-submit");
    expect(button(view, "닫기").className).toContain("rp-close");
    expect(view.querySelectorAll(".rp-done button")).toHaveLength(2);

    act(() => button(view, "닫기").click());

    expect(view.querySelector(".rp-title")?.textContent).toBe("사전 등록");
    expect(view.textContent).not.toContain("사전등록이 완료됐어요");
  });

  it("비어 있거나 안전하지 않은 CTA는 하나의 primary 확인으로 폴백하고 폼으로 돌아온다", () => {
    const view = renderPreview({ enabled: true, label: "오픈채팅 입장", url: "javascript:alert(1)" });

    act(() => button(view, "완료").click());

    expect(view.textContent).not.toContain("오픈채팅 입장");
    expect(button(view, "확인").className).toContain("rp-submit");
    expect(view.querySelectorAll(".rp-done button")).toHaveLength(1);
    expect(view.querySelector(".rp-close")).toBeNull();

    act(() => button(view, "확인").click());
    expect(view.querySelector(".rp-title")?.textContent).toBe("사전 등록");
  });

  it("문구가 비어 있으면 안전한 URL이 있어도 primary 확인으로 폴백한다", () => {
    const view = renderPreview({ enabled: true, label: "", url: "https://example.com/chat" });

    act(() => button(view, "완료").click());

    expect(button(view, "확인").className).toContain("rp-submit");
    expect(view.querySelectorAll(".rp-done button")).toHaveLength(1);
  });
});

describe("등록 완료 CTA 자동저장", () => {
  it("편집한 CTA를 기존 디바운스 뒤에 다듬은 PATCH payload로 저장한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const editor = renderEditor();
    const toggle = editor.querySelector<HTMLButtonElement>('[role="switch"][aria-label="등록 완료 CTA 표시"]');
    const label = editor.querySelector<HTMLInputElement>('[aria-label="완료 CTA 버튼 문구"]');
    const url = editor.querySelector<HTMLInputElement>('[aria-label="완료 CTA 연결 URL"]');

    expect(toggle).toBeTruthy();
    expect(label).toBeTruthy();
    expect(url).toBeTruthy();

    act(() => {
      toggle?.click();
      changeInput(label!, "  오픈채팅 입장  ");
      changeInput(url!, "  https://example.com/chat  ");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    });

    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(patch).toBeTruthy();
    const body = JSON.parse((patch![1] as RequestInit).body as string);
    expect(body.config.registrationForm.successCta).toEqual({
      enabled: true,
      label: "오픈채팅 입장",
      url: "https://example.com/chat",
    });
  });
});
