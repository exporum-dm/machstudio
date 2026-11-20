// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWebinarLoaderScript } from "@/lib/webinar-loader-script";

/**
 * **플로팅 배너가 운영자가 바꾼 상태를 따라오는가.**
 *
 * 2026-11-20 신고: 사전등록 기간에 운영 콘솔에서 라이브로 전환했는데, 히어로는 "웨비나 입장"
 * 으로 바뀌었지만 **플로팅 배너는 계속 "사전등록"** 이었다.
 *
 * 그릴 때의 분기는 히어로와 배너가 똑같다 — 둘 다 status/entryOpen 으로 가른다. 갈린 건
 * **언제 다시 받아오느냐**였다. 폴링이 `liveStartAt ~ liveEndAt (±30분)` 안에서만 돌아서,
 * 예정 시각 **밖에서** 손으로 바꾼 전환은 이미 열려 있는 페이지에 영영 닿지 않았다.
 * 사전등록 기간의 사전 점검, 예정보다 이른 방송 시작, 종료 후 접수 재개가 전부 이 경우다.
 */

type LoaderWindow = Window & typeof globalThis & { __MACH_WEBINAR_LOADER__?: string };

const FAR_FUTURE = "2099-06-01T01:00:00.000Z";

function config(over: Record<string, unknown> = {}) {
  return {
    slug: "banner-test",
    name: "테스트 웨비나",
    status: "registration",
    statusOverride: null,
    serverNow: new Date().toISOString(),
    // 예정 방송은 한참 뒤 — "예정 시각 밖" 을 만드는 핵심 조건이다.
    entryOpenAt: FAR_FUTURE,
    liveStartAt: FAR_FUTURE,
    liveEndAt: "2099-06-01T02:00:00.000Z",
    signupDeadline: "2099-05-31T00:00:00.000Z",
    allowLiveRegistration: null,
    updatedKey: "k1",
    theme: { accentColor: "#6d28d9", textColor: "#21182b", surfaceColor: "#fbf7ef", borderRadius: "14px" },
    components: {},
    registrationForm: { fields: [], consents: [] },
    links: { livePageUrl: null, surveyUrl: null, calendarUrl: null },
    ics: "",
    bannerPagePatterns: [],
    ...over,
  };
}

function response(body: unknown) {
  return { ok: true, headers: { get: () => null }, json: async () => body };
}

async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

/** 현재 config 를 바꿔 끼울 수 있는 부팅 — 운영자가 콘솔에서 상태를 바꾸는 상황을 흉내낸다. */
async function boot(initial: Record<string, unknown> = {}) {
  let current = config(initial);
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/config")) return response({ ...current, serverNow: new Date().toISOString() });
    return response({});
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("scrollTo", vi.fn());
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = "";
  delete (window as LoaderWindow).__MACH_WEBINAR_LOADER__;
  window.eval(buildWebinarLoaderScript({ siteId: "site_banner", baseUrl: "https://mach.example" }));
  await settle();
  return {
    fetchMock,
    setConfig(next: Record<string, unknown>) {
      current = config({ ...initial, ...next });
    },
  };
}

const bannerText = () => document.getElementById("mw-banner")?.textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  sessionStorage.clear();
  localStorage.clear();
  delete (window as LoaderWindow).__MACH_WEBINAR_LOADER__;
  vi.unstubAllGlobals();
});

describe("배너가 보여 주는 상태", () => {
  it("사전등록 중에는 사전등록으로", async () => {
    await boot();
    expect(bannerText()).toContain("사전등록");
    expect(bannerText()).not.toContain("입장");
  });

  /**
   * 예정 시각이 한참 뒤여도 **수동 전환이 걸렸으면 라이브**다. 그리는 쪽은 원래 맞았다 —
   * 이 테스트는 "배너가 사전등록으로 남은 건 렌더 분기 탓이 아니다" 를 못 박아 둔다.
   */
  it("예정 시각 전이라도 라이브로 강제하면 입장으로", async () => {
    await boot({ statusOverride: "live" });
    expect(bannerText()).toContain("LIVE");
    expect(bannerText()).toContain("웨비나 입장하기");
  });

  it("종료로 강제하면 종료 안내로", async () => {
    await boot({ statusOverride: "ended" });
    expect(bannerText()).toContain("종료");
  });
});

it("transitions through all four scheduled banner phases on an already open page", async () => {
  const start = Date.now();
  const at = (seconds: number) => new Date(start + seconds * 1_000).toISOString();
  await boot({
    bannerSchedule: { registration: at(10), live: at(20), ended: at(30) },
    entryOpenAt: at(20),
    liveStartAt: at(35),
    liveEndAt: at(60),
    signupDeadline: at(19),
    components: { banner: { textByStatus: { upcoming: "UPCOMING", registration: "REGISTER", live: "ENTER", ended: "ENDED" } } },
  });
  expect(bannerText()).toContain("UPCOMING");
  await vi.advanceTimersByTimeAsync(11_100);
  expect(bannerText()).toContain("REGISTER");
  expect(bannerText()).toContain("웨비나 사전등록");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(bannerText()).toContain("ENTER");
  expect(bannerText()).toContain("웨비나 입장하기");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(bannerText()).toContain("ENDED");
  expect(bannerText()).not.toContain("웨비나 입장하기");
});

it("keeps the scheduled phase but hides entry until the webinar actually admits viewers", async () => {
  const start = Date.now();
  const at = (seconds: number) => new Date(start + seconds * 1_000).toISOString();
  await boot({
    bannerSchedule: { registration: at(-20), live: at(-10), ended: at(120) },
    entryOpenAt: at(40),
    liveStartAt: at(50),
  });
  expect(bannerText()).toContain("입장 안내");
  expect(bannerText()).not.toContain("웨비나 입장하기");
  await vi.advanceTimersByTimeAsync(41_100);
  expect(bannerText()).toContain("웨비나 입장하기");
});

describe("예정 시각 밖의 수동 전환이 이미 열린 페이지에 닿는가", () => {
  /** 이게 신고의 핵심 — 고치기 전에는 여기서 영영 다시 받아오지 않았다. */
  it("느린 하트비트가 전환을 데려온다", async () => {
    const { fetchMock, setConfig } = await boot();
    expect(bannerText()).toContain("사전등록");
    const afterBoot = fetchMock.mock.calls.length;

    // 운영자가 콘솔에서 라이브로 전환.
    setConfig({ statusOverride: "live", updatedKey: "k2" });

    // 2분(=라이브 폴링 주기)만으로는 아직 — 예정 시각 밖이라 느린 주기를 쓴다.
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1_000);
    await settle();
    expect(fetchMock.mock.calls.length).toBe(afterBoot);

    // 10분이 지나면 한 번 확인하고, 배너가 따라온다.
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    await settle();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterBoot);
    expect(bannerText()).toContain("웨비나 입장하기");
  });

  /**
   * 한 번 수동 전환을 알고 나면 **자주** 본다 — 운영자가 손으로 몰고 있다는 뜻이라
   * 다음 전환(종료·접수 재개)도 곧 올 수 있다.
   */
  it("수동 전환 중에는 2분마다 확인한다", async () => {
    const { fetchMock, setConfig } = await boot({ statusOverride: "live" });
    const afterBoot = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1_000);
    await settle();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterBoot);

    setConfig({ statusOverride: "ended", updatedKey: "k3" });
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1_000);
    await settle();
    expect(bannerText()).toContain("종료");
  });

  /** 끝난 웨비나는 더 바뀔 게 없다 — 남의 사이트에서 도는 스크립트라 빈 호출을 만들지 않는다. */
  it("종료된 뒤에는 하트비트를 멈춘다", async () => {
    const { fetchMock } = await boot({
      statusOverride: null,
      entryOpenAt: "2020-01-01T00:00:00.000Z",
      liveStartAt: "2020-01-01T00:00:00.000Z",
      liveEndAt: "2020-01-01T01:00:00.000Z",
      signupDeadline: "2019-12-31T00:00:00.000Z",
    });
    const afterBoot = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await settle();
    expect(fetchMock.mock.calls.length).toBe(afterBoot);
  });

  /** 배너도 마운트도 없는 페이지(사이트 전역에 붙는다)는 확인할 이유가 없다. */
  it("아무것도 그리지 않는 페이지는 확인하지 않는다", async () => {
    const { fetchMock } = await boot({ bannerPagePatterns: ["/webinar-only"] });
    expect(document.getElementById("mw-banner")).toBeNull();
    const afterBoot = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await settle();
    expect(fetchMock.mock.calls.length).toBe(afterBoot);
  });
});

/**
 * **배너 버튼 문구는 운영자가 정한다.**
 *
 * 히어로 버튼(heroButton.labelByStatus)은 진작 바꿀 수 있었는데 배너 버튼만 코드에 박혀 있었다.
 * 키를 상태가 아니라 **행동**으로 둔 이유: 캘린더는 '사전등록 중'·'시작 전' 양쪽에 같은 모습으로
 * 뜨고, 사전등록 버튼은 '입장 중' 에 보조로 한 번 더 뜬다. 상태로 쪼개면 같은 문구를 두 번 적는다.
 *
 * 제목이 아니라 **버튼만** 본다 — 기본 제목이 "…웨비나 사전등록이 진행 중입니다" 라서
 * 배너 전체 텍스트로 비교하면 버튼을 안 고쳐도 통과해 버린다. 순서까지 함께 못 박는다.
 */
describe("배너 버튼 문구", () => {
  const buttons = () =>
    Array.from(document.querySelectorAll("#mw-banner .mw-btn")).map((b) => b.textContent ?? "");
  const withLabels = (labels: Record<string, string>, over: Record<string, unknown> = {}) => ({
    components: { banner: { buttonLabels: labels } },
    ...over,
  });

  it("사전등록 중 — 캘린더와 주 버튼", async () => {
    await boot(withLabels({ registration: "지금 신청하기", calendar: "일정 담기" }));
    expect(buttons()).toEqual(["일정 담기", "지금 신청하기"]);
  });

  it("입장 중 — 보조 사전등록과 주 입장 버튼을 따로 바꾼다", async () => {
    await boot(withLabels({ live: "시청하러 가기", liveRegister: "아직 등록 전이에요" }, { statusOverride: "live" }));
    expect(buttons()).toEqual(["아직 등록 전이에요", "시청하러 가기"]);
  });

  it("종료 후 — 설문 버튼", async () => {
    await boot(
      withLabels({ survey: "후기 남기기" }, {
        statusOverride: "ended",
        links: { livePageUrl: null, surveyUrl: "https://example.test/survey", calendarUrl: null },
      }),
    );
    expect(buttons()).toEqual(["후기 남기기"]);
  });

  /** 캘린더 문구는 '사전등록 중'·'시작 전' 두 상태가 **같은 칸**을 쓴다. */
  it("시작 전 — 캘린더 문구를 함께 쓴다", async () => {
    await boot(
      withLabels({ calendar: "일정 담기" }, {
        // 마감이 지났고 방송은 아직 — upcoming 분기(캘린더만 뜨는 상태).
        signupDeadline: "2020-01-01T00:00:00.000Z",
      }),
    );
    expect(buttons()).toEqual(["일정 담기"]);
  });

  /** 비워 두면 기본 문구 — 운영자가 안 적어도 배너가 비어 보이면 안 된다. */
  it("비워 두거나 설정이 없으면 기본 문구", async () => {
    await boot(withLabels({ registration: "   ", calendar: "" }));
    expect(buttons()).toEqual(["캘린더 추가", "웨비나 사전등록"]);

    await boot();
    expect(buttons()).toEqual(["캘린더 추가", "웨비나 사전등록"]);
  });
});

describe("배너 표시 끄기", () => {
  /** 로더는 `enabled !== false` 로 읽는다 — 끈 경우에만 사라진다. */
  it("끄면 배너가 뜨지 않는다", async () => {
    await boot({ components: { banner: { enabled: false } } });
    expect(document.getElementById("mw-banner")).toBeNull();
  });

  it("명시하지 않으면 뜬다", async () => {
    await boot({ components: { banner: {} } });
    expect(document.getElementById("mw-banner")).not.toBeNull();
  });
});
