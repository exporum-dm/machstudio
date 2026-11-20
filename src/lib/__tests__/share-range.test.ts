// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHARE_RANGE,
  MAX_ROLLING_DAYS,
  formatCampaignPeriod,
  formatShareRange,
  parseShareRange,
  shareRangeDays,
  shareRangeFromPicker,
  shareRangeLabel,
  shareRangeWindow,
  type ShareRange,
} from "@/lib/share-range";

/**
 * **공유 기간의 계약.**
 *
 * 세 가지를 못 박는다:
 *  · 저장 문자열은 왕복한다 — 못 읽는 값은 기본값(최근 30일)으로 떨어져 보고서가 열린다.
 *  · 경계는 KST 달력일 — 자정 부근에 하루 밀리면 공유 화면이 대시보드와 다른 숫자를 띄운다.
 *  · 구르는 기간은 날을 따라 움직이고, 고정 기간은 움직이지 않는다.
 */

/** 2026-11-19 09:30 KST = 2026-11-19 00:30 UTC */
const NOW = new Date("2026-11-19T00:30:00Z");

describe("저장 문자열 ↔ 기간", () => {
  it("구르는 기간을 왕복한다", () => {
    for (const days of [1, 7, 30, 90, 365, MAX_ROLLING_DAYS]) {
      const spec = `${days}d`;
      expect(parseShareRange(spec)).toEqual({ kind: "rolling", days });
      expect(formatShareRange({ kind: "rolling", days })).toBe(spec);
    }
  });

  it("고정 기간을 왕복한다", () => {
    const spec = "2026-10-01~2026-10-31";
    expect(parseShareRange(spec)).toEqual({ kind: "fixed", from: "2026-10-01", to: "2026-10-31" });
    expect(formatShareRange({ kind: "fixed", from: "2026-10-01", to: "2026-10-31" })).toBe(spec);
  });

  it("하루짜리 고정 기간도 유효하다", () => {
    expect(parseShareRange("2026-10-01~2026-10-01")).toEqual({
      kind: "fixed",
      from: "2026-10-01",
      to: "2026-10-01",
    });
  });

  /** 기간 하나 때문에 보고서 전체가 안 열릴 이유가 없다 — 전부 기본값으로 떨어진다. */
  it("못 읽는 값은 최근 30일", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      42,
      {},
      "30",
      "30일",
      "0d",
      "-5d",
      `${MAX_ROLLING_DAYS + 1}d`,
      "2026-10-31~2026-10-01", // 뒤집힘
      "2026-10-1~2026-10-31", // 자리수 부족
      "2026-10-01",
      "2026-10-01~",
      "~2026-10-31",
      "2026-10-01~2026-10-31~2026-11-01",
    ]) {
      expect(parseShareRange(bad)).toEqual(DEFAULT_SHARE_RANGE);
    }
  });

  it("저장 안 된 프로젝트(null)는 이 기능이 생기기 전과 같다", () => {
    expect(parseShareRange(null)).toEqual({ kind: "rolling", days: 30 });
  });
});

describe("조회 창", () => {
  /**
   * 대시보드의 `defaultRange()`·`DateRangePicker` 프리셋과 **같은 경계**다
   * (오늘 KST 00:00 기준 -N일 ~ 오늘 끝). 운영자는 두 화면을 나란히 비교한다.
   */
  it("구르는 기간은 오늘 끝까지, N일 전 자정부터", () => {
    const win = shareRangeWindow({ kind: "rolling", days: 30 }, NOW);
    expect(win.fromDate).toBe("2026-10-20");
    expect(win.toDate).toBe("2026-11-19");
    expect(win.from.toISOString()).toBe("2026-10-19T15:00:00.000Z"); // 10-20 00:00 KST
    expect(win.to.toISOString()).toBe("2026-11-19T14:59:59.999Z"); // 11-19 24:00 KST - 1ms
  });

  it("고정 기간은 적어 둔 날짜 그대로, 끝날의 끝까지", () => {
    const win = shareRangeWindow({ kind: "fixed", from: "2026-10-01", to: "2026-10-31" }, NOW);
    expect(win.fromDate).toBe("2026-10-01");
    expect(win.toDate).toBe("2026-10-31");
    expect(win.from.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    expect(win.to.toISOString()).toBe("2026-10-31T14:59:59.999Z");
  });

  /** KST 자정 직전·직후의 UTC 시각 — 여기서 밀리면 하루가 어긋난다. */
  it("KST 자정을 넘기면 창도 하루 넘어간다", () => {
    const beforeMidnightKst = new Date("2026-11-19T14:59:00Z"); // 11-19 23:59 KST
    const afterMidnightKst = new Date("2026-11-19T15:01:00Z"); // 11-20 00:01 KST
    expect(shareRangeWindow({ kind: "rolling", days: 7 }, beforeMidnightKst).toDate).toBe("2026-11-19");
    expect(shareRangeWindow({ kind: "rolling", days: 7 }, afterMidnightKst).toDate).toBe("2026-11-20");
  });

  it("구르는 기간은 날을 따라 움직이고, 고정 기간은 움직이지 않는다", () => {
    const rolling: ShareRange = { kind: "rolling", days: 30 };
    const fixed: ShareRange = { kind: "fixed", from: "2026-10-01", to: "2026-10-31" };
    const later = new Date("2027-02-01T00:30:00Z");

    expect(shareRangeWindow(rolling, later).toDate).not.toBe(shareRangeWindow(rolling, NOW).toDate);
    expect(shareRangeWindow(fixed, later)).toEqual(shareRangeWindow(fixed, NOW));
  });
});

describe("표시", () => {
  it("이름", () => {
    expect(shareRangeLabel({ kind: "rolling", days: 30 })).toBe("최근 30일");
    expect(shareRangeLabel({ kind: "fixed", from: "2026-10-01", to: "2026-10-31" })).toBe("2026-10-01 ~ 2026-10-31");
  });

  it("길이(일)", () => {
    expect(shareRangeDays({ kind: "rolling", days: 90 }, NOW)).toBe(90);
    expect(shareRangeDays({ kind: "fixed", from: "2026-10-01", to: "2026-10-31" }, NOW)).toBe(31);
    expect(shareRangeDays({ kind: "fixed", from: "2026-10-01", to: "2026-10-01" }, NOW)).toBe(1);
  });
});

describe("날짜 선택기 결과 → 저장 기간", () => {
  const win = (from: string, to: string) => ({
    from: new Date(`${from}T00:00:00+09:00`),
    to: new Date(`${to}T23:59:59+09:00`),
  });

  /** 프리셋을 고른 건 "계속 최근 N일" 이라는 뜻이다 — 그 날의 날짜로 굳히면 안 된다. */
  it("프리셋 라벨은 구르는 기간으로 굳는다", () => {
    expect(shareRangeFromPicker({ ...win("2026-10-20", "2026-11-19"), label: "최근 30일" })).toEqual({
      kind: "rolling",
      days: 30,
    });
  });

  it("직접 고른 구간은 고정 기간", () => {
    expect(shareRangeFromPicker({ ...win("2026-10-01", "2026-10-31"), label: "2026-10-01 ~ 2026-10-31" })).toEqual({
      kind: "fixed",
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  /** 라벨 문구가 바뀌어도 **틀린 구간**을 보여 주는 쪽으로는 깨지지 않는다(고정으로 떨어진다). */
  it("모르는 라벨은 보고 있던 날짜를 그대로 고정한다", () => {
    for (const label of ["오늘", "전체 기간", "폴더 기본 기간", "최근 0일", "최근 9999일"]) {
      const out = shareRangeFromPicker({ ...win("2026-11-19", "2026-11-19"), label });
      expect(out).toEqual({ kind: "fixed", from: "2026-11-19", to: "2026-11-19" });
    }
  });

  it("저장 문자열로 왕복한다", () => {
    const picked = { ...win("2026-10-20", "2026-11-19"), label: "최근 30일" };
    expect(parseShareRange(formatShareRange(shareRangeFromPicker(picked)))).toEqual({ kind: "rolling", days: 30 });
  });
});

describe("캠페인 집행 기간 표기", () => {
  it("같은 해면 연도를 뗀다", () => {
    expect(formatCampaignPeriod("2026-08-22", "2026-11-20")).toBe("08.22 ~ 11.20");
  });

  it("하루짜리는 한 번만 쓴다", () => {
    expect(formatCampaignPeriod("2026-11-20", "2026-11-20")).toBe("11.20");
  });

  /** 연도를 떼면 `12.28 ~ 01.05` 가 거꾸로 간 기간처럼 보인다. */
  it("해를 넘기면 연도를 붙인다", () => {
    expect(formatCampaignPeriod("2026-12-28", "2027-01-05")).toBe("2026.12.28 ~ 2027.01.05");
  });

  it("값이 없거나 모양이 깨졌으면 비워 둔다", () => {
    for (const [from, to] of [
      [null, null],
      [undefined, undefined],
      ["2026-08-22", null],
      [null, "2026-11-20"],
      ["", ""],
      ["2026-8-22", "2026-11-20"],
      ["어제", "오늘"],
    ] as Array<[string | null | undefined, string | null | undefined]>) {
      expect(formatCampaignPeriod(from, to)).toBe("—");
    }
  });

  /** 뒤집힌 값을 몰래 고치지 않는다 — 그대로 보여야 데이터가 이상한 걸 알아챈다. */
  it("뒤집힌 기간도 그대로 보여 준다", () => {
    expect(formatCampaignPeriod("2026-11-20", "2026-08-22")).toBe("11.20 ~ 08.22");
  });
});
