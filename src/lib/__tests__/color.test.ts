import { describe, expect, it } from "vitest";
import {
  contrastRatio, isHexColor, normalizeHexColor, onAccentColor, paperFor,
  readableTextOn, relativeLuminance, withAlpha,
} from "@/lib/color";

/**
 * 색 계산의 **공용 계약**.
 *
 * ── 왜 이 테스트가 먼저인가 ───────────────────────────────────────────
 * 같은 계산이 지금 저장소에 **세 벌** 있다: 라이브 시청 화면(LiveContentStk 의 onAccentColor),
 * 랜딩 런타임(landing/mount 의 paperFor), 대회 공고(notice/mount 의 paperFor — 주석에
 * "랜딩과 같은 계산" 이라고 적혀 있다). 홈페이지 빌더가 네 번째를 만들기 전에 한 곳으로 모은다.
 *
 * 여기 박아 둔 기대값은 **기존 구현에서 그대로 옮긴 것**이다. 나중에 라이브 화면들을
 * 이 모듈 import 로 갈아끼울 때, 그 교체가 화면 색을 바꾸지 않는다는 것을 이 표가 증명한다.
 * 임계값은 취향이 아니라 **실사고에서 나온 값**이라 함부로 못 바꾼다:
 *  · 흰 글자 유지 하한 2.0:1 — 2026-11 형광 키컬러 사고(아래 onAccentColor 주석).
 *  · paperFor 의 상대휘도 0.45.
 *  · readableTextOn 의 3.0:1 — 운영자가 고른 글자색을 뒤집는 "분명히 안 보인다"의 선.
 */

describe("normalizeHexColor", () => {
  it("6자리로 펴고 소문자로 맞춘다", () => {
    expect(normalizeHexColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHexColor("aabbcc")).toBe("#aabbcc");
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor("  #FF8500  ")).toBe("#ff8500");
  });

  /** 저장된 값은 무엇이든 올 수 있다 — 던지지 않고 null 로 답한다. */
  it("hex 가 아니면 null", () => {
    for (const bad of ["", "   ", "rgb(0,0,0)", "red", "#12", "#12345", "#1234567", "#gggggg", "#-12345"]) {
      expect(normalizeHexColor(bad)).toBeNull();
    }
  });

  it("문자열이 아닌 값도 안전하다", () => {
    for (const bad of [null, undefined, 123, {}, []]) {
      expect(normalizeHexColor(bad as unknown as string)).toBeNull();
    }
  });

  it("isHexColor 는 같은 판정을 boolean 으로 준다", () => {
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#AABBCC")).toBe(true);
    expect(isHexColor("rgb(0,0,0)")).toBe(false);
    expect(isHexColor(null as unknown as string)).toBe(false);
  });
});

describe("onAccentColor — 키컬러 위 글자색", () => {
  /**
   * ── 2026-11 형광 키컬러 사고 ────────────────────────────────────────
   * 예전 규칙은 YIQ 체감밝기 0.78 임계였다. YIQ 는 sRGB 감마를 안 펴서 **형광색을
   * 과소평가**한다 — 네온그린(YIQ 0.663)·순초록(0.587)·시안(0.701)이 전부 "밝지 않다"로
   * 분류돼 흰 글자를 받았고, 실제 대비는 1.25~1.37:1 이라 글자가 배경에 녹았다.
   * 운영자가 웨비나 상세페이지에 형광색을 쓰면서 그대로 드러났다.
   *
   * 지금은 **흰 글자의 실제 대비**를 재서 2.0:1 미만일 때만 진한 글자로 내린다.
   * 이 표의 핵심은 "형광 계열만 바뀌고 브랜드 색은 안 바뀐다" 는 것이다.
   */
  it("브랜드 색은 흰 글자를 지킨다 — 규칙을 바꿔도 여기는 안 움직인다", () => {
    const cases: Array<[string, string]> = [
      ["#ff8500", "#ffffff"], // 주황 2.44:1 — 흰 글자를 쓰기로 한 브랜드 결정
      ["#fe5816", "#ffffff"], // 시청 화면 기본 키컬러 3.17:1
      ["#6d28d9", "#ffffff"], // 대기·종료 화면 기본 키컬러 7.10:1
      ["#1f3a5f", "#ffffff"], // 진한 네이비(사전등록 기본색) 11.48:1
      ["#000000", "#ffffff"],
      ["#ff0000", "#ffffff"], // 4.00:1
      ["#008000", "#ffffff"], // 5.14:1
    ];
    for (const [accent, expected] of cases) {
      expect(`${accent} → ${onAccentColor(accent)}`).toBe(`${accent} → ${expected}`);
    }
  });

  it("흰 글자가 녹는 색은 진한 글자로 내린다", () => {
    const cases: Array<[string, string]> = [
      ["#ffffff", "#1a1a1f"],
      ["#ffff00", "#1a1a1f"], // 노랑 1.07:1 — 예전 규칙도 잡던 색
      ["#f0f0f0", "#1a1a1f"], // 연회색 1.14:1 — 예전 규칙도 잡던 색
      ["#39ff14", "#1a1a1f"], // 네온그린 1.36:1 — **예전 규칙은 흰 글자를 줬다**
      ["#00ff00", "#1a1a1f"], // 순초록 1.37:1 — 예전 규칙은 흰 글자
      ["#00ffff", "#1a1a1f"], // 시안 1.25:1 — 예전 규칙은 흰 글자
      ["#ccff00", "#1a1a1f"], // 형광 라임 1.18:1 — 예전 규칙은 흰 글자
      ["#00e5ff", "#1a1a1f"], // 형광 하늘 1.54:1 — 예전 규칙은 흰 글자
    ];
    for (const [accent, expected] of cases) {
      expect(`${accent} → ${onAccentColor(accent)}`).toBe(`${accent} → ${expected}`);
    }
  });

  /** 고른 글자색의 대비가 2.0:1 이상이면 흰색을 유지한다 — 경계 양쪽을 못 박는다. */
  it("경계 2.0:1 양쪽", () => {
    expect(contrastRatio("#ffffff", "#ff9500")).toBeGreaterThanOrEqual(2);
    expect(onAccentColor("#ff9500")).toBe("#ffffff");
    expect(contrastRatio("#ffffff", "#00e5ff")).toBeLessThan(2);
    expect(onAccentColor("#00e5ff")).toBe("#1a1a1f");
  });

  it("3자리 축약과 대문자도 같은 결과", () => {
    expect(onAccentColor("#FFF")).toBe(onAccentColor("#ffffff"));
    expect(onAccentColor("#000")).toBe(onAccentColor("#000000"));
    expect(onAccentColor("#FF8500")).toBe(onAccentColor("#ff8500"));
  });

  /** hex 가 아니면(rgb·named) 기존 동작 유지 — 흰 글자. */
  it("hex 가 아니면 흰 글자로 떨어진다", () => {
    for (const v of ["rgb(255,133,0)", "orange", "", "  "]) {
      expect(onAccentColor(v)).toBe("#ffffff");
    }
  });
});

describe("paperFor — 배경 위 글자색", () => {
  /**
   * 상대휘도(WCAG 선형화) 0.45 기준. 상수로 두지 않는 이유는 편집 UI 가 "글자색은 배경에서
   * 자동으로 따라옵니다" 라고 안내하기 때문이다 — 운영자가 다크 배경에 흰색을 고르면
   * 상수로는 대비 1.06:1 백지가 된다.
   */
  it("기존 구현과 같은 값을 낸다", () => {
    const cases: Array<[string, string]> = [
      ["#ffffff", "#101828"],
      ["#f6f8ff", "#101828"],
      ["#111318", "#f6f8ff"], // 설계가 쓰는 다크 배경
      ["#000000", "#f6f8ff"],
      ["#1f3a5f", "#f6f8ff"],
      ["#ffff00", "#101828"], // 노랑은 휘도가 높아 잉크색
      ["#808080", "#f6f8ff"], // 중간 회색은 선형화 뒤 0.216 이라 종이색
      ["#cccccc", "#101828"],
    ];
    for (const [bg, expected] of cases) {
      expect(`${bg} → ${paperFor(bg)}`).toBe(`${bg} → ${expected}`);
    }
  });

  it("# 없이 넣어도, 대문자여도 같다", () => {
    expect(paperFor("ffffff")).toBe(paperFor("#ffffff"));
    expect(paperFor("#FFFFFF")).toBe(paperFor("#ffffff"));
  });

  /**
   * 기존 두 구현은 `bg.replace("#","")` 뒤 곧바로 파싱해서, hex 가 아니면 NaN 이 나와
   * `luminance > 0.45` 가 false → 종이색을 냈다. 그 동작을 유지한다 —
   * 다크 배경 기본값이라 무해한 쪽이다.
   */
  it("hex 가 아니면 종이색으로 떨어진다", () => {
    for (const v of ["", "rgb(0,0,0)", "transparent", "#12"]) {
      expect(paperFor(v)).toBe("#f6f8ff");
    }
  });

  /**
   * **기존 구현과 의도적으로 다른 유일한 지점.**
   *
   * 원본 두 벌은 3자리를 펴지 않고 곧바로 잘라 파싱해서 `#fff` 가 NaN → 종이색(#f6f8ff)이
   * 됐다 — 흰 배경에 흰 글자, 이 함수가 막으려던 바로 그 1.06:1 백지다. 여기서는 편다.
   *
   * 라이브 화면 교체(계획 Task 20) 때 이 차이를 알고 넘어가야 한다. 실사용에서는 색 선택
   * UI 가 6자리로 저장하므로 3자리가 들어올 경로는 운영자가 손으로 타이핑하는 경우뿐이다.
   */
  it("3자리 축약을 편다 — 원본은 안 펴서 흰 배경에 흰 글자가 됐다", () => {
    expect(paperFor("#fff")).toBe("#101828");
    expect(paperFor("#fff")).toBe(paperFor("#ffffff"));
    expect(paperFor("#000")).toBe(paperFor("#000000"));
  });
});

describe("contrastRatio · relativeLuminance", () => {
  it("WCAG 기준값을 낸다", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // 순서가 바뀌어도 같은 값 — 밝은 쪽을 분자로 올린다.
    expect(contrastRatio("#ff8500", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#ff8500"), 10);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
  });

  /** 모르는 색을 "괜찮다"로 통과시키지 않는다 — 대비 1(= 없음)로 본다. */
  it("hex 가 아니면 대비 1", () => {
    expect(relativeLuminance("rgb(0,0,0)")).toBeNull();
    expect(contrastRatio("rgb(0,0,0)", "#ffffff")).toBe(1);
    expect(contrastRatio("#ffffff", "var(--x)")).toBe(1);
  });
});

describe("readableTextOn — 고른 글자색을 지키되 사고만 막는다", () => {
  /** 운영자의 선택이 읽히면 **그대로 둔다**. 이 쪽이 기본 동작이다. */
  it("대비가 충분하면 고른 색을 그대로 쓴다", () => {
    expect(readableTextOn("#ffffff", "#141320")).toBe("#141320");
    expect(readableTextOn("#121216", "#f0f0f2")).toBe("#f0f0f2");
    // 흑백 극단이 아닌 의도적 색도 지킨다(진회색 본문 — 흰 배경에서 7.0:1).
    expect(readableTextOn("#ffffff", "#525a69")).toBe("#525a69");
  });

  it("안 읽히는 조합은 배경에서 뒤집는다", () => {
    expect(readableTextOn("#ffffff", "#ffffff")).toBe("#101828"); // 흰 배경에 흰 글자
    expect(readableTextOn("#111318", "#1a1a1f")).toBe("#f6f8ff"); // 다크 배경에 검은 글자
    expect(readableTextOn("#39ff14", "#ffffff")).toBe("#101828"); // 형광 배경에 흰 글자
    expect(readableTextOn("#ffff00", "#ffffff")).toBe("#101828");
  });

  /** 3:1 은 "분명히 안 보인다"의 선 — AA(4.5:1)로 잡으면 의도적 저대비까지 갈아엎는다. */
  it("경계 3.0:1 양쪽", () => {
    expect(contrastRatio("#949494", "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(readableTextOn("#ffffff", "#949494")).toBe("#949494");
    expect(contrastRatio("#959595", "#ffffff")).toBeLessThan(3);
    expect(readableTextOn("#ffffff", "#959595")).toBe("#101828");
  });

  it("표기를 펴고, hex 가 아닌 입력에도 답을 낸다", () => {
    expect(readableTextOn("#FFF", "#141320")).toBe("#141320");
    expect(readableTextOn("#ffffff", "#000")).toBe("#000000");
    // 배경을 모르면 고른 색을 건드리지 않는다 — 색을 지어내지 않는다.
    expect(readableTextOn("var(--bg)", "#141320")).toBe("#141320");
    expect(readableTextOn("var(--bg)", "currentColor")).toBe("currentColor");
    // 글자색만 모르면 배경에서 정한다(paperFor 와 같은 답).
    expect(readableTextOn("#ffffff", "currentColor")).toBe("#101828");
  });
});

describe("withAlpha", () => {
  it("hex 를 rgba 로 편다", () => {
    expect(withAlpha("#101828", 0.68)).toBe("rgba(16, 24, 40, 0.68)");
    expect(withAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  });

  it("알파를 0~1 로 가둔다", () => {
    expect(withAlpha("#000000", -1)).toBe("rgba(0, 0, 0, 0)");
    expect(withAlpha("#000000", 5)).toBe("rgba(0, 0, 0, 1)");
  });

  /** 색을 지어내지 않는다 — 못 읽으면 받은 값을 그대로 돌려준다. */
  it("hex 가 아니면 원래 값을 그대로 준다", () => {
    expect(withAlpha("rebeccapurple", 0.5)).toBe("rebeccapurple");
    expect(withAlpha("var(--x)", 0.5)).toBe("var(--x)");
  });
});
