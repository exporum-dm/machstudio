import { describe, expect, it } from "vitest";
import { normalizeLandingPageConfig } from "@/lib/webinar-config";

/**
 * 히어로 스크림 불투명도·타이틀 자간, How to Join 꼬리 문구.
 *
 * 숫자 두 개(heroOverlayOpacity·heroTitleTracking)는 **공개 페이지 CSS 에 인라인으로
 * 그대로 들어간다**(mount.ts 가 --lnd-hero-overlay/--lnd-hero-tracking 으로 심는다) — 정규화가
 * 유일한 관문이라 범위를 벗어난 값이 그대로 새면 레이아웃이 깨진다.
 * 기본값은 지금까지의 고정 디자인(오버레이 .5~.82, 자간 -.055em)과 같아야 한다 —
 * 저장한 적 없는 웨비나 수백 개가 이 기본값으로 렌더된다.
 */

const lp = (landingPage: unknown) => normalizeLandingPageConfig({ landingPage });

describe("히어로 오버레이 불투명도 — 0~100, 기본 100(지금까지의 디자인)", () => {
  it("비어 있으면 100(= 예전 고정값 .5/.82와 같다)", () => {
    expect(lp({}).heroOverlayOpacity).toBe(100);
  });

  it("범위 안의 값은 그대로", () => {
    expect(lp({ heroOverlayOpacity: 40 }).heroOverlayOpacity).toBe(40);
    expect(lp({ heroOverlayOpacity: 0 }).heroOverlayOpacity).toBe(0);
  });

  it("범위를 벗어나면 잘린다 — 공개 CSS 로 그대로 나가는 값이라 안 믿는다", () => {
    expect(lp({ heroOverlayOpacity: -20 }).heroOverlayOpacity).toBe(0);
    expect(lp({ heroOverlayOpacity: 150 }).heroOverlayOpacity).toBe(100);
  });

  it("숫자가 아니면 기본값", () => {
    for (const bad of ["many", null, undefined, NaN, {}, []]) {
      expect(lp({ heroOverlayOpacity: bad }).heroOverlayOpacity, String(bad)).toBe(100);
    }
  });
});

describe("히어로 타이틀 자간 — 퍼센트, 기본 -5.5(= 예전 고정값 -.055em과 같다)", () => {
  it("비어 있으면 -5.5", () => {
    expect(lp({}).heroTitleTracking).toBe(-5.5);
  });

  it("범위 안의 값(음수·양수·소수)은 그대로", () => {
    expect(lp({ heroTitleTracking: -2 }).heroTitleTracking).toBe(-2);
    expect(lp({ heroTitleTracking: 3.5 }).heroTitleTracking).toBe(3.5);
  });

  it("범위(-20~20)를 벗어나면 잘린다", () => {
    expect(lp({ heroTitleTracking: -50 }).heroTitleTracking).toBe(-20);
    expect(lp({ heroTitleTracking: 50 }).heroTitleTracking).toBe(20);
  });

  it("숫자가 아니면 기본값", () => {
    for (const bad of ["tight", null, undefined, NaN, {}, []]) {
      expect(lp({ heroTitleTracking: bad }).heroTitleTracking, String(bad)).toBe(-5.5);
    }
  });
});

describe("How to Join 꼬리 문구 — 비우면 기본 문구, 채우면 그 웨비나만 바뀐다", () => {
  it("비어 있으면 빈 문자열을 그대로 돌려준다 — 폴백은 뷰(renderJoin)에서 한 번", () => {
    expect(lp({}).join.note).toBe("");
  });

  it("값이 있으면 그대로 통과한다", () => {
    expect(lp({ join: { note: "곧 안내 메일을 보내드려요" } }).join.note).toBe("곧 안내 메일을 보내드려요");
  });

  it("문자열이 아니면 빈 값으로 — 다른 웨비나의 타입 사고가 공개 페이지로 새지 않는다", () => {
    for (const bad of [42, null, undefined, {}, []]) {
      expect(lp({ join: { note: bad } }).join.note, String(bad)).toBe("");
    }
  });
});
