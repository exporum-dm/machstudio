// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ON_ACCENT_JS } from "@/lib/color-embed-js";
import { onAccentColor } from "@/lib/color";
import { buildWebinarLoaderScript } from "@/lib/webinar-loader-script";

/**
 * **문자열 사본이 정본과 같은 값을 내는가.**
 *
 * 웨비나 로더는 번들이 아니라 서버가 만든 문자열을 그대로 내려보내는 스크립트라
 * `@/lib/color` 를 import 할 수 없다(자세한 이유는 `color-embed-js.ts` 머리말).
 * 그래서 계산이 한 벌 더 존재하고, **이 파일이 그 사본을 정본에 묶는 유일한 끈이다.**
 * 임계값은 정본에서 import 하므로 갈라질 수 없지만 **계산식은 손으로 옮겨 적은 것**이라
 * (sRGB 선형화 + 대비비) 한쪽만 고치면 여기서 깨진다.
 */

/** 내보낸 문자열을 실제로 실행해 함수로 꺼낸다 — 눈으로 비교하지 않는다. */
const embedFn = new Function(`${ON_ACCENT_JS}\nreturn publicFormOnAccent;`)() as (v: unknown) => string;

describe("문자열 판이 정본과 같은 값을 낸다", () => {
  it("3자리 hex 전수 4,096건", () => {
    const bad: string[] = [];
    for (let v = 0; v < 0x1000; v++) {
      const hex = "#" + v.toString(16).padStart(3, "0");
      if (embedFn(hex) !== onAccentColor(hex)) bad.push(hex);
    }
    expect(bad).toEqual([]);
  });

  it("6자리 hex 결정적 표본 (65,536건)", () => {
    const bad: string[] = [];
    for (let v = 0; v < 0x1000000; v += 0x100) {
      const hex = "#" + v.toString(16).padStart(6, "0");
      if (embedFn(hex) !== onAccentColor(hex)) bad.push(hex);
    }
    expect(bad).toEqual([]);
  });

  it("임계값 근처와 실제 사고 색", () => {
    // #ff8500 은 임계값이 0.6 이었을 때 간신히 넘어 검은 글자를 받았던 실제 색이다.
    for (const hex of ["#ff8500", "#ffff00", "#c8c8c8", "#c9c9c9", "#7f7f7f", "#000000", "#ffffff", "#fefefe"]) {
      expect(`${hex} → ${embedFn(hex)}`).toBe(`${hex} → ${onAccentColor(hex)}`);
    }
  });

  it("표기 차이 — # 유무·대소문자·공백", () => {
    for (const v of ["ff8500", "#FF8500", "  #ff8500  ", "#FFF", "fff"]) {
      expect(`${v} → ${embedFn(v)}`).toBe(`${v} → ${onAccentColor(v)}`);
    }
  });

  /** 옛 사본은 `.replace("#","")` 라 후행 `#` 에서 정본과 갈렸다. 이제 안 갈린다. */
  it("비정상 입력에서도 같다 — 옛 사본이 갈리던 자리", () => {
    for (const v of ["", " ", "#", "##ffffff", "#ffffff#", "fff#", "ffff00#", "ab#cde",
                     "rgb(0,0,0)", "transparent", "#12", "#1234567", "red", "#ggg"]) {
      expect(`${JSON.stringify(v)} → ${embedFn(v)}`).toBe(`${JSON.stringify(v)} → ${onAccentColor(v)}`);
    }
  });

  it("문자열이 아닌 값도 던지지 않고 흰 글자로 떨어진다", () => {
    for (const v of [null, undefined, 0, 123456, {}, []]) {
      expect(() => embedFn(v)).not.toThrow();
      expect(embedFn(v)).toBe("#ffffff");
    }
  });
});

/**
 * 문자열이 **문법적으로 성한가.** 정규식 리터럴이 생성 문자열 안으로 들어가므로
 * 이스케이프 사고가 나면 로더 전체가 파싱 실패한다 — 그때 파트너 사이트에서
 * 조용히 아무 일도 안 일어난다.
 */
describe("로더 스크립트가 파싱된다", () => {
  it("생성된 로더 전체가 문법 오류 없이 파싱된다", () => {
    const script = buildWebinarLoaderScript({ siteId: "t", baseUrl: "https://x.example.com" });
    expect(() => new Function(script)).not.toThrow();
    // 사본이 실제로 그 안에 실려 나가는지도 본다 — 보간이 끊기면 조용히 사라진다.
    expect(script).toContain("function publicFormOnAccent");
  });
});
