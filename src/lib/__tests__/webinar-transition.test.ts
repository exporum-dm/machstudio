// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENTRY_OPEN_BEFORE_MINUTES,
  entryOpenAtOf,
  nextWebinarTransition,
  parseEntryOpenSetting,
  webinarFace,
  type WebinarStatusInput,
} from "@/lib/webinar-status";

/**
 * **"언제 뭐가 바뀌나" 를 운영자에게 알려 주는 계산.**
 *
 * 배포 탭의 배너 설정은 네 상태의 문구·버튼을 고르게 하는데, 정작 **지금 어떤 상태이고
 * 언제 다음으로 넘어가는지**가 안 보였다. 그래서 "각 상황을 수동으로 켜거나 시간을 지정할
 * 수 있어야 하지 않나" 라는 질문이 나왔다 — 둘 다 이미 있는데 그 자리에서 안 보였을 뿐이다.
 *
 * 여기서 틀리면 **조용히 거짓말**을 한다(엉뚱한 시각을 알려 줘도 에러가 안 난다).
 */

const HOUR = 3_600_000;
const NOW = new Date("2026-11-20T00:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

/** 기본 배치: 마감(+10h) → 입장 오픈(+23h) → 시작(+24h) → 종료(+26h) */
const base: WebinarStatusInput = {
  signupDeadline: at(10).toISOString(),
  liveStartAt: at(24).toISOString(),
  liveEndAt: at(26).toISOString(),
  statusOverride: null,
  components: {},
};

describe("지금 보여 주는 모습", () => {
  it("마감 전이면 사전등록", () => {
    expect(webinarFace(base, NOW)).toBe("registration");
  });

  /** 마감은 지났고 입장 오픈은 아직 — 캘린더만 남는 구간. */
  it("마감과 입장 오픈 사이는 시작 전", () => {
    expect(webinarFace(base, at(12))).toBe("upcoming");
  });

  /** 입장은 **시작보다 먼저** 열린다(기본 60분 전) — 방송 전이라도 입장 버튼이 뜬다. */
  it("입장 오픈 시각부터 입장 중", () => {
    expect(webinarFace(base, at(23))).toBe("entryOpen");
    expect(webinarFace(base, at(24.5))).toBe("entryOpen");
  });

  it("종료 시각부터 종료 후", () => {
    expect(webinarFace(base, at(26))).toBe("ended");
  });

  it("입장 오픈 기본값은 시작 60분 전", () => {
    expect(DEFAULT_ENTRY_OPEN_BEFORE_MINUTES).toBe(60);
    // 61분 전은 아직, 59분 전은 열려 있다.
    expect(webinarFace(base, at(24 - 61 / 60))).toBe("upcoming");
    expect(webinarFace(base, at(24 - 59 / 60))).toBe("entryOpen");
  });
});

describe("다음 전환", () => {
  it("사전등록 중에는 마감 시각을 알린다", () => {
    const next = nextWebinarTransition(base, NOW);
    expect(next?.at.toISOString()).toBe(at(10).toISOString());
    expect(next?.to).toBe("upcoming");
  });

  it("마감 뒤에는 입장 오픈 시각을 알린다", () => {
    const next = nextWebinarTransition(base, at(12));
    expect(next?.at.toISOString()).toBe(at(23).toISOString());
    expect(next?.to).toBe("entryOpen");
  });

  it("입장 중에는 종료 시각을 알린다", () => {
    const next = nextWebinarTransition(base, at(23.5));
    expect(next?.at.toISOString()).toBe(at(26).toISOString());
    expect(next?.to).toBe("ended");
  });

  it("끝나면 더 알릴 게 없다", () => {
    expect(nextWebinarTransition(base, at(27))).toBeNull();
  });

  /**
   * **순서만 보고 고르면 틀리는 자리.** 마감이 입장 오픈보다 뒤인 웨비나(라이브 중에도
   * 등록을 받는 흔한 설정)에서는, 마감을 지나도 화면이 그대로다 — 이미 입장 중이라서.
   * 그런데 다음 후보를 시각 순으로만 집으면 "곧 시작 전으로 바뀝니다" 라고 거짓말한다.
   */
  it("화면이 안 바뀌는 경계는 건너뛴다", () => {
    const lateDeadline: WebinarStatusInput = {
      ...base,
      // 마감이 입장 오픈(+23h)보다 뒤 — 시작 30분 뒤까지 접수.
      signupDeadline: at(24.5).toISOString(),
    };
    expect(webinarFace(lateDeadline, at(23.5))).toBe("entryOpen");

    const next = nextWebinarTransition(lateDeadline, at(23.5));
    // 마감(+24.5h)이 더 가깝지만 그때도 화면은 '입장 중' 이다 → 종료를 알려야 한다.
    expect(next?.at.toISOString()).toBe(at(26).toISOString());
    expect(next?.to).toBe("ended");
  });

  /** 수동 전환 중에는 일정이 화면을 움직이지 않는다 — 시각을 알려 주면 거짓말이 된다. */
  it("수동 전환 중에는 알리지 않는다", () => {
    for (const statusOverride of ["registration", "live", "ended"]) {
      expect(nextWebinarTransition({ ...base, statusOverride }, NOW)).toBeNull();
    }
  });

  it("입장 오픈 시점을 바꾸면 전환 시각도 따라온다", () => {
    const early = { ...base, components: { entryOpenBeforeMinutes: 180 } };
    const next = nextWebinarTransition(early, at(12));
    expect(next?.at.toISOString()).toBe(at(21).toISOString());
    expect(next?.to).toBe("entryOpen");
  });
});

/**
 * **입장 오픈 시점 — 두 모양만 인정한다.**
 *
 * 전까지 "시작 60분 전" 이 코드에 박혀 있어 아무도 못 바꿨다. 이제 프리셋은 `before`
 * (시작 기준)로, '직접 지정' 은 `at`(절대 시각)으로 저장한다.
 *
 * 둘을 나눈 이유가 이 테스트의 핵심이다: 프리셋을 절대 시각으로 굳혀 저장하면 나중에
 * 방송을 미뤘을 때 **입장만 어제 열린다.**
 */
describe("입장 오픈 시점", () => {
  const withComponents = (components: unknown) => ({ ...base, components });

  it("설정이 없으면 시작 60분 전", () => {
    expect(parseEntryOpenSetting({})).toEqual({ mode: "before", minutes: 60 });
    expect(entryOpenAtOf(base.liveStartAt, {}).toISOString()).toBe(at(23).toISOString());
  });

  /** 이 기능이 생기기 전에 저장된 값 — 계속 읽는다. */
  it("옛 키도 읽는다", () => {
    expect(parseEntryOpenSetting({ entryOpenBeforeMinutes: 30 })).toEqual({ mode: "before", minutes: 30 });
    expect(entryOpenAtOf(base.liveStartAt, { entryOpenBeforeMinutes: 30 }).toISOString()).toBe(at(23.5).toISOString());
  });

  it("시작과 동시에(0분)도 유효하다", () => {
    const c = { entryOpen: { mode: "before", minutes: 0 } };
    expect(entryOpenAtOf(base.liveStartAt, c).toISOString()).toBe(at(24).toISOString());
  });

  /** 상대 모드의 존재 이유 — 방송을 옮기면 입장도 따라온다. */
  it("시작 기준은 방송 시각을 따라 움직인다", () => {
    const c = { entryOpen: { mode: "before", minutes: 60 } };
    expect(entryOpenAtOf(at(24).toISOString(), c).toISOString()).toBe(at(23).toISOString());
    // 방송을 하루 미뤘다 → 입장도 하루 미뤄진다.
    expect(entryOpenAtOf(at(48).toISOString(), c).toISOString()).toBe(at(47).toISOString());
  });

  /** 예약의 존재 이유 — 적어 둔 시각은 움직이지 않는다. */
  it("예약한 시각은 방송 시각을 옮겨도 그대로", () => {
    const c = { entryOpen: { mode: "at", at: at(20).toISOString() } };
    expect(entryOpenAtOf(at(24).toISOString(), c).toISOString()).toBe(at(20).toISOString());
    expect(entryOpenAtOf(at(48).toISOString(), c).toISOString()).toBe(at(20).toISOString());
  });

  it("예약 시각이 상태 판정에 그대로 쓰인다", () => {
    const reserved = withComponents({ entryOpen: { mode: "at", at: at(20).toISOString() } });
    expect(webinarFace(reserved, at(19.5))).toBe("upcoming");
    expect(webinarFace(reserved, at(20))).toBe("entryOpen");

    const next = nextWebinarTransition(reserved, at(12));
    expect(next?.at.toISOString()).toBe(at(20).toISOString());
    expect(next?.to).toBe("entryOpen");
  });

  /** 입장 시점 하나 때문에 상태 판정이 통째로 멈출 이유가 없다 — 전부 기본값으로. */
  it("못 읽는 값은 기본값으로 떨어진다", () => {
    for (const components of [
      null,
      undefined,
      "nope",
      { entryOpen: null },
      { entryOpen: "1시간" },
      { entryOpen: [] },
      { entryOpen: { mode: "at" } },
      { entryOpen: { mode: "at", at: "어제" } },
      { entryOpen: { mode: "before" } },
      { entryOpen: { mode: "before", minutes: -5 } },
      { entryOpen: { mode: "before", minutes: 25 * 60 } },
      { entryOpen: { mode: "weird", minutes: 10 } },
      { entryOpenBeforeMinutes: -1 },
    ]) {
      expect(parseEntryOpenSetting(components)).toEqual({ mode: "before", minutes: 60 });
    }
  });

  /** 저장 모양으로 왕복한다 — 화면이 읽어 그대로 돌려보내도 값이 변하지 않아야 한다. */
  it("왕복한다", () => {
    for (const setting of [
      { mode: "before", minutes: 0 },
      { mode: "before", minutes: 90 },
      { mode: "at", at: at(20).toISOString() },
    ]) {
      expect(parseEntryOpenSetting({ entryOpen: setting })).toEqual(setting);
    }
  });
});
