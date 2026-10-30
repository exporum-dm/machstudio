// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingPageTab from "../LandingPageTab";

/**
 * 만들기 › 랜딩 페이지 › **스폰서** 편집기.
 *
 * 어드민 화면은 로그인 벽 때문에 브라우저로 못 본다 — 렌더 테스트가 유일한 확인 경로다.
 * 여기서 붙잡는 것 두 가지:
 *
 * 1) **행 하나에 값 네 개가 전부 보이고 그 자리에서 고쳐진다**(테이블형 인라인 편집 원칙).
 *    이름·구분·로고 URL·홈페이지 링크가 접힘·모달 뒤에 있으면 안 된다.
 *
 * 2) **업로드가 누른 행에 꽂힌다.** 파일 입력은 섹션에 하나뿐이고 대상은 ROW_KEY 로 기억한다.
 *    인덱스로 기억하면 응답이 오는 동안 드래그·삭제가 일어났을 때 다른 스폰서 로고가 덮인다 —
 *    그래서 "2번 행을 누르고 그 사이에 목록이 바뀌어도 2번 행에 꽂히는가"를 실제로 태운다.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const sponsors = {
  enabled: true,
  title: "",
  items: [
    { tier: "주최", name: "엑스포럼", logoUrl: "https://cdn.io/a.png", url: "https://www.exporum.com" },
    { tier: "후원", name: "ACME", logoUrl: "", url: "" },
  ],
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render(config: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <LandingPageTab
        webinar={{ id: "w1", slug: "s1", name: "테스트", description: null, config, liveStartAt: "2026-08-11T05:00:00.000Z" }}
        onSilentUpdate={() => {}}
      />,
    );
  });
  return host;
}

beforeEach(() => {
  // crypto.randomUUID 는 makeItem 이 쓴다(jsdom 에 없을 수 있다).
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, "crypto", {
      value: { ...globalThis.crypto, randomUUID: () => `id-${Math.random().toString(36).slice(2)}` },
      configurable: true,
    });
  }
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.restoreAllMocks();
});

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 이름"]')];

describe("행 = 항목, 열 = 속성 — 네 값이 모두 보이고 인라인으로 고쳐진다", () => {
  it("저장된 스폰서가 값이 채워진 입력으로 나온다", () => {
    const el = render({ landingPage: { enabled: true, sponsors } });
    expect(rows(el).map((i) => i.value)).toEqual(["엑스포럼", "ACME"]);
    expect([...el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 구분"]')].map((i) => i.value))
      .toEqual(["주최", "후원"]);
    expect([...el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 로고 URL"]')].map((i) => i.value))
      .toEqual(["https://cdn.io/a.png", ""]);
    expect([...el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 홈페이지 링크"]')].map((i) => i.value))
      .toEqual(["https://www.exporum.com", ""]);
  });

  it("로고가 있으면 미리보기 이미지, 없으면 '로고' 올리기 버튼", () => {
    const el = render({ landingPage: { enabled: true, sponsors } });
    const tiles = [...el.querySelectorAll("button")].filter((b) => b.title?.includes("로고"));
    expect(tiles).toHaveLength(2);
    expect(tiles[0].querySelector("img")).not.toBeNull();
    expect(tiles[1].querySelector("img")).toBeNull();
    expect(tiles[1].textContent).toContain("로고");
    // 이미 로고가 있으면 '바꾸기', 없으면 '올리기' — 무엇이 일어날지 툴팁이 말한다
    expect(tiles[0].title).toContain("바꾸기");
    expect(tiles[1].title).toContain("올리기");
  });

  it("스폰서가 없으면 빈 상태 안내가 나온다(빈 표가 아니라)", () => {
    const el = render({ landingPage: { enabled: true } });
    expect(rows(el)).toHaveLength(0);
    expect(el.textContent).toContain("아직 스폰서가 없어요");
  });
});

describe("URL 은 입력 시점에 강제한다", () => {
  /**
   * normalizeLandingPageConfig 가 http(s) 아닌 URL 을 빈 값으로 만든다(파트너 사이트에
   * 마운트되는 마크업이라 이 방어는 유지해야 한다). 그래서 스킴 없이 적으면 **공개 페이지에서
   * 링크가 죽고**, 다음 리마운트 때 칸이 비면서 그 다음 자동저장이 빈 값을 영구 저장한다.
   * 실측으로 확인한 경로다 — 그래서 blur 에서 스킴을 붙여 정상 입력을 그냥 통과시킨다.
   */
  const blur = (input: HTMLInputElement, value: string) => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React 17+ 는 onBlur 를 루트에서 **focusout** 으로 위임받는다 — 네이티브 "blur" 는
    // 버블링하지 않아 핸들러에 닿지 않는다(닿는 것처럼 보이면 그게 오히려 함정).
    act(() => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  };

  it("스킴 없이 적으면 https:// 를 붙여 살린다", () => {
    const el = render({ landingPage: { enabled: true, sponsors } });
    const url = el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 홈페이지 링크"]')[1];
    blur(url, "www.acme.co.kr");
    expect(
      el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 홈페이지 링크"]')[1].value,
    ).toBe("https://www.acme.co.kr");
  });

  it("이미 스킴이 있으면 건드리지 않는다", () => {
    const el = render({ landingPage: { enabled: true, sponsors } });
    const url = el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 홈페이지 링크"]')[1];
    blur(url, "http://acme.co.kr");
    expect(
      el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 홈페이지 링크"]')[1].value,
    ).toBe("http://acme.co.kr");
  });

  it("붙여도 안 되는 값은 그 자리에서 인라인으로 알린다 — 저장 후 조용히 비면 이유를 알 수 없다", () => {
    const el = render({ landingPage: { enabled: true, sponsors } });
    const url = el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 홈페이지 링크"]')[1];
    blur(url, "javascript:alert(1)");
    expect(el.textContent).toContain("지금 값은 저장되지 않아요");
  });

  it("정상 값에는 경고를 띄우지 않는다", () => {
    const el = render({ landingPage: { enabled: true, sponsors } });
    expect(el.textContent).not.toContain("지금 값은 저장되지 않아요");
  });

  /**
   * 히어로 배경 미디어 칸도 **같은 결함**이었다 — 스폰서 칸을 고치면서 발견됐고,
   * 실측으로 재현했다: heroMedia.url 이 "cdn.io/hero.jpg" 면 normalizeLandingPageConfig 가
   * (keepEmptyRows 로도) heroMedia 를 통째로 null 로 만든다 → 배경이 조용히 안 나오고
   * 리마운트 때 칸이 비면서 자동저장이 빈 값을 영구 저장한다.
   */
  it("히어로 배경 미디어 URL 도 같은 보호를 받는다", () => {
    const el = render({ landingPage: { enabled: true, heroMedia: { type: "image", url: "https://cdn.io/a.png" } } });
    const hero = el.querySelector<HTMLInputElement>('input[aria-label="히어로 배경 미디어 URL"]')!;
    expect(hero.type).toBe("url");
    blur(hero, "cdn.io/hero.jpg");
    expect(
      el.querySelector<HTMLInputElement>('input[aria-label="히어로 배경 미디어 URL"]')!.value,
    ).toBe("https://cdn.io/hero.jpg");
  });

  it("히어로 칸도 못 살리는 값이면 인라인으로 알린다", () => {
    const el = render({ landingPage: { enabled: true, heroMedia: { type: "image", url: "https://cdn.io/a.png" } } });
    const hero = el.querySelector<HTMLInputElement>('input[aria-label="히어로 배경 미디어 URL"]')!;
    blur(hero, "javascript:alert(1)");
    expect(el.textContent).toContain("지금 값은 저장되지 않아요");
  });
});

describe("첫 스폰서를 추가하면 토글도 같이 켜진다", () => {
  /** 이 섹션만 기본 OFF 라(기존 웨비나 거짓 경고 방지), 안 켜 주면 "추가했는데 안 나온다" 가 된다. */
  it("0 → 1 일 때 표시가 켜진다", () => {
    const el = render({ landingPage: { enabled: true } });
    const toggle = [...el.querySelectorAll<HTMLElement>('[role="switch"], input[type="checkbox"]')]
      .find((n) => (n.getAttribute("aria-label") ?? "").includes("스폰서"));
    expect(toggle).toBeDefined();
    expect(toggle!.getAttribute("aria-checked") ?? String((toggle as HTMLInputElement).checked)).toBe("false");

    const add = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("스폰서 추가"));
    act(() => { add!.click(); });

    expect(rows(el)).toHaveLength(1);
    const after = [...el.querySelectorAll<HTMLElement>('[role="switch"], input[type="checkbox"]')]
      .find((n) => (n.getAttribute("aria-label") ?? "").includes("스폰서"));
    expect(after!.getAttribute("aria-checked") ?? String((after as HTMLInputElement).checked)).toBe("true");
  });
});

describe("업로드는 **누른 행**에 꽂힌다", () => {
  /** 파일 입력은 섹션에 하나. 대상은 ROW_KEY 로 기억하므로 목록이 바뀌어도 안 흔들린다. */
  it("두 번째 행에서 올린 로고가 두 번째 행에만 들어간다", async () => {
    const el = render({ landingPage: { enabled: true, sponsors } });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://cdn.io/uploaded.png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const tiles = [...el.querySelectorAll("button")].filter((b) => b.title?.includes("로고"));
    // 로고 칸을 누르면 숨은 파일 입력이 열린다 — jsdom 에서는 click 만 확인하고 change 를 직접 쏜다
    const fileInput = el.querySelector<HTMLInputElement>('input[type="file"][accept*="image/png"]');
    expect(fileInput).not.toBeNull();
    act(() => { tiles[1].click(); });

    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
    Object.defineProperty(fileInput!, "files", { value: [file], configurable: true });
    await act(async () => {
      fileInput!.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    const logoUrls = [...el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 로고 URL"]')].map((i) => i.value);
    expect(logoUrls).toEqual(["https://cdn.io/a.png", "https://cdn.io/uploaded.png"]);

    // 세션 로고 라우트를 재사용한다 — 형식·한도·저장 경로가 완전히 같아 네 번째 복제를 만들지 않는다
    expect(fetchMock.mock.calls[0][0]).toBe("/api/webinars/w1/session-logo");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("업로드가 실패해도 기존 값은 그대로다 — 실패가 저장된 로고를 지우지 않는다", async () => {
    const el = render({ landingPage: { enabled: true, sponsors } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "실패" }) }));

    const tiles = [...el.querySelectorAll("button")].filter((b) => b.title?.includes("로고"));
    const fileInput = el.querySelector<HTMLInputElement>('input[type="file"][accept*="image/png"]')!;
    act(() => { tiles[0].click(); });
    const file = new File([new Uint8Array([1])], "logo.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect([...el.querySelectorAll<HTMLInputElement>('input[aria-label="스폰서 로고 URL"]')].map((i) => i.value))
      .toEqual(["https://cdn.io/a.png", ""]);
  });
});
