// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 폼 부트의 **두 경로**.
 *
 * 지정 자리(홈페이지 Shadow)와 문서 탐색(단독 /f)은 생존 판정부터 다르다.
 * Shadow 안의 폼에 `document.contains` 를 쓰면 **항상 false** 라 재마운트가 끝없이 돌고
 * 타이핑 중인 입력이 계속 날아간다. 그래서 경로별로 다른 신호를 본다.
 *
 * 그리고 단독 /f 는 아무것도 달라지지 않아야 한다 — 9/1 오픈이 그 경로 위에 있다.
 */

/**
 * 진짜 마운트처럼 `.msf` 를 심는다.
 *
 * 문서 탐색 경로의 재렌더 감시는 "마운트 안에 `.msf` 가 살아 있나" 로 판단한다.
 * 빈 목을 쓰면 그 검사가 늘 실패해 **모든 DOM 변경마다** 재마운트가 돌고, 정작 보려던
 * "한 번만 다시 붙는다" 를 볼 수 없다.
 */
const mountImpl = (opts: { mount: HTMLElement }) => {
  const root = document.createElement("div");
  root.className = "msf";
  opts.mount.appendChild(root);
  return { destroy: vi.fn(() => root.remove()) };
};
const mountForm = vi.fn(mountImpl);
const mountLookup = vi.fn((_opts: { mount: HTMLElement }) => ({ destroy: vi.fn() }));

vi.mock("@/lib/collect-form/mount", () => ({ mountCollectForm: (o: unknown) => mountForm(o as never) }));
vi.mock("@/lib/collect-form/lookup-mount", () => ({ mountCollectLookup: (o: unknown) => mountLookup(o as never) }));

const CFG = {
  sourceId: "s1",
  origin: "https://mach.example.com",
  formConfig: { fields: [] },
  serverNow: new Date().toISOString(),
  active: true,
};

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * 이 jsdom 에는 `CSS.escape` 가 없다(실제 브라우저에는 있다). 없으면 문서 탐색 경로가
 * 시작하자마자 던져서, 정작 확인하려는 "단독 /f 는 그대로다" 를 못 본다.
 */
if (typeof (globalThis as { CSS?: unknown }).CSS === "undefined") {
  (globalThis as { CSS?: unknown }).CSS = {
    escape: (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c),
  };
}

async function load() {
  return import("@/embed/form-entry");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // clearAllMocks 는 호출 기록만 지운다 — 구현은 남는다. 매번 기본 구현으로 되돌린다.
  mountForm.mockImplementation(mountImpl);
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  delete (globalThis as Record<string, unknown>).__MACH_FORM_TARGETS_V1__;
  delete (window as unknown as Record<string, unknown>).__MACH_FORM__;
});

/** 홈페이지 섹션 흉내 — 자리를 예약하고 열쇠를 실은 스크립트를 만든다. */
async function reserved(mode: "live" | "preview-draft" = "live") {
  const { registerFormTarget, formTargetKey } = await import("@/lib/collect-form/target-registry");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  shadow.appendChild(container);

  const controller = new AbortController();
  const key = formTargetKey({ sourceId: "s1", view: "form", mode, instanceKey: "sec1" });
  registerFormTarget(key, { container, styleRoot: shadow, mode, disposeSignal: controller.signal });

  const script = document.createElement("script");
  script.dataset.msFormTarget = key;
  document.head.appendChild(script);
  return { host, shadow, container, key, script, controller };
}

describe("지정 자리 경로", () => {
  it("탐색하지 않고 예약된 자리에 붙는다", async () => {
    const { container, shadow, script } = await reserved();
    const { boot } = await load();

    boot(CFG, script);
    expect(mountForm).toHaveBeenCalledTimes(1);
    const opts = mountForm.mock.calls[0][0] as unknown as { mount: HTMLElement; styleRoot: unknown; preview: boolean };
    expect(opts.mount).toBe(container);
    // 스타일은 그 Shadow 안에 넣는다 — 문서 head 에 넣으면 Shadow 까지 닿지 않는다.
    expect(opts.styleRoot).toBe(shadow);
    expect(opts.preview).toBe(false);
  });

  /**
   * payload 는 캐시된 스크립트에 실려 오고 그 스크립트는 라이브와 **같은 파일**이다.
   * 그래서 부작용 판정은 예약 정보에서만 온다.
   */
  it("미리보기 자리는 부작용을 끈다", async () => {
    const { script } = await reserved("preview-draft");
    const { boot } = await load();

    boot(CFG, script);
    expect((mountForm.mock.calls[0][0] as unknown as { preview: boolean }).preview).toBe(true);
  });

  /** 예약이 이미 정리됐다면 **문서 탐색으로 떨어지지 않는다** — 엉뚱한 자리에 앉는다. */
  it("죽은 예약이면 아무 데도 붙지 않는다", async () => {
    const { script, controller } = await reserved();
    const stray = document.createElement("div");
    stray.setAttribute("data-mach-form", "");
    document.body.appendChild(stray);

    controller.abort();
    const { boot } = await load();
    boot(CFG, script);

    expect(mountForm).not.toHaveBeenCalled();
  });

  it("bootInto 로도 같은 결과다", async () => {
    const { container, shadow, key } = await reserved();
    const { bootInto } = await load();

    bootInto(CFG, { container, styleRoot: shadow, mode: "live" }, key);
    expect((mountForm.mock.calls[0][0] as unknown as { mount: HTMLElement }).mount).toBe(container);
  });

  it("등록 확인도 같은 경로를 탄다", async () => {
    const { registerFormTarget, formTargetKey } = await import("@/lib/collect-form/target-registry");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const key = formTargetKey({ sourceId: "s1", view: "check", mode: "live", instanceKey: "sec1" });
    registerFormTarget(key, { container, styleRoot: document, mode: "live" });

    const script = document.createElement("script");
    script.dataset.msFormTarget = key;
    document.head.appendChild(script);

    const { boot } = await load();
    container.setAttribute("data-mach-lang", "jp");
    boot({
      ...CFG,
      formConfig: { ...CFG.formConfig, submitLabel: { en: "Register", ja: "登録" } },
      view: "check",
    }, script);
    expect(mountLookup).toHaveBeenCalledTimes(1);
    expect(mountLookup).toHaveBeenCalledWith(expect.objectContaining({ locale: "ja" }));
    expect(mountForm).not.toHaveBeenCalled();
  });
});

describe("지정 자리의 생존 판정", () => {
  /**
   * **핵심.** Shadow 안의 루트는 `document.contains` 가 항상 false 다. 문서 기준으로 보면
   * 호스트가 무엇을 하든 재마운트가 돌고, 재마운트마다 입력이 날아간다.
   */
  it("문서가 바뀌어도 다시 붙지 않는다", async () => {
    const { script } = await reserved();
    const { boot } = await load();
    boot(CFG, script);
    expect(mountForm).toHaveBeenCalledTimes(1);

    // 호스트 페이지가 자기 DOM 을 마구 바꾼다.
    for (let i = 0; i < 10; i++) document.body.appendChild(document.createElement("div"));
    await tick();
    await tick();

    expect(mountForm).toHaveBeenCalledTimes(1);
  });

  it("자리가 실제로 떨어지면 한 번만 정리한다", async () => {
    const { container, key } = await reserved();
    const { boot } = await load();
    const { getFormTarget } = await import("@/lib/collect-form/target-registry");
    boot(CFG, document.head.querySelector("script"));
    const destroy = mountForm.mock.results[0].value.destroy;

    container.remove();
    await tick();
    await tick();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(getFormTarget(key)).toBeNull();
    // 다시 붙이지 않는다 — 다시 그리는 것은 홈페이지 쪽의 일이다.
    expect(mountForm).toHaveBeenCalledTimes(1);
  });

  it("예약한 쪽이 끊어도 정리한다", async () => {
    const { script, controller } = await reserved();
    const { boot } = await load();
    boot(CFG, script);
    const destroy = mountForm.mock.results[0].value.destroy;

    controller.abort();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("부트된 이전 폼의 abort 정리는 staged 후속 예약을 지우지 않는다", async () => {
    const { script, controller, key } = await reserved();
    const { boot } = await load();
    boot(CFG, script);

    const { getFormTarget, leaseFormTarget } = await import("@/lib/collect-form/target-registry");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    shadow.appendChild(container);
    const successor = { container, styleRoot: shadow, mode: "live" as const };
    const lease = leaseFormTarget(key, successor);

    controller.abort();

    expect(getFormTarget(key)).toBe(successor);
    lease.release();
  });
});

describe("단독 /f 경로는 그대로다", () => {
  it("열쇠가 없으면 문서에서 마운트 지점을 찾는다", async () => {
    // 감시자가 body 를 직접 보지 않도록 한 겹 감싼다 — 다음 테스트의 DOM 변경에
    // 앞 테스트의 감시자가 반응해 재마운트가 하나 더 세어진다(실측).
    const wrap = document.createElement("div");
    const slot = document.createElement("div");
    slot.setAttribute("data-mach-form", "");
    wrap.appendChild(slot);
    document.body.appendChild(wrap);

    const { boot } = await load();
    boot(CFG, null);

    const opts = mountForm.mock.calls[0][0] as unknown as { mount: HTMLElement; styleRoot: unknown; preview: boolean };
    expect(opts.mount).toBe(slot);
    // 문서에 넣는다(지금까지와 같다) — styleRoot 를 주지 않는다.
    expect(opts.styleRoot).toBeUndefined();
    expect(opts.preview).toBe(false);
    expect(slot.getAttribute("data-mach-form-claimed")).toBe("s1");
  });

  /** 호스트가 위젯을 다시 그리면 우리 폼이 지워진다 — 그 경로는 그대로 살아 있어야 한다. */
  it("호스트가 폼을 지우면 다시 붙인다", async () => {
    const wrap = document.createElement("div");
    const slot = document.createElement("div");
    slot.setAttribute("data-mach-form", "");
    wrap.appendChild(slot);
    document.body.appendChild(wrap);

    const { boot } = await load();
    boot(CFG, null);
    expect(mountForm).toHaveBeenCalledTimes(1);

    // 호스트가 위젯을 통째로 다시 그린다.
    wrap.innerHTML = "";
    const fresh = document.createElement("div");
    fresh.setAttribute("data-mach-form", "");
    wrap.appendChild(fresh);
    await new Promise((r) => setTimeout(r, 300));

    expect(mountForm).toHaveBeenCalledTimes(2);
  });

  it("스크립트가 currentScript 를 안 넘겨도 동작한다", async () => {
    const wrap = document.createElement("div");
    const slot = document.createElement("div");
    slot.setAttribute("data-mach-form", "");
    wrap.appendChild(slot);
    document.body.appendChild(wrap);

    const { boot } = await load();
    boot(CFG);
    expect(mountForm).toHaveBeenCalledTimes(1);
  });
});
