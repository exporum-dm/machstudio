import { onAccentColor, WHITE_KEEP_MIN } from "./color";

/**
 * `onAccentColor` 의 **브라우저 문자열 판.**
 *
 * ── 왜 사본이 남나 ────────────────────────────────────────────────────
 * 웨비나 로더(`/w/{id}`)는 번들이 아니다. 서버 라우트가 `buildWebinarLoaderScript()` 가
 * 만든 문자열을 `application/javascript` 로 **그대로** 내려보낸다 — 트랜스파일도 번들링도
 * 개입하지 않는다. 그래서 그 안에서 `@/lib/color` 를 `import` 할 수 없다.
 * 결과 값을 미리 박아 넣을 수도 없다: accent 는 런타임에 config 를 받아 와야 알 수 있다.
 *
 * ── 그래서 어떻게 하나 ────────────────────────────────────────────────
 * 사본이 하나 남되 **혼자 표류하지 못하게 묶는다**:
 *  · 파싱을 `color.ts` 와 **같은 앵커링 정규식**으로 맞췄다(옛 `.replace("#","")` 는 후행 `#`
 *    같은 입력에서 정본과 갈렸다).
 *  · 두 출력색은 빌드 시점에 `onAccentColor` 를 **실제로 호출해** 뽑는다 — 색 리터럴이
 *    이 파일에 손으로 적히지 않는다.
 *  · 임계값(`WHITE_KEEP_MIN`)도 **정본에서 import** 한다 — 숫자가 두 벌 존재하지 않는다.
 *  · `__tests__/color-embed-js.test.ts` 가 이 문자열을 실행해 정본과 **차등 비교**한다.
 *    계산식을 한쪽만 옮기면 그 테스트가 69,632 색 중 어딘가에서 빨개진다.
 *
 * 내보내는 클라이언트 코드에 백틱도 `${}` 도 없다(로더 파일 머리말의 이스케이프 규칙).
 */

const LIGHT = JSON.stringify(onAccentColor("#000000"));
const DARK = JSON.stringify(onAccentColor("#ffffff"));

/**
 * 임계값은 **정본에서 그대로 가져온다** — 이 파일에 숫자가 손으로 적히지 않는다.
 * 두 출력색(LIGHT·DARK)을 `onAccentColor` 를 실제로 호출해 뽑는 것과 같은 이유다.
 */
export const ON_ACCENT_JS = `  function publicFormOnAccent(value) {
    if (typeof value !== "string") return ${LIGHT};
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (!m) return ${LIGHT};
    var hex = m[1].toLowerCase();
    if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    var ch = [0, 2, 4].map(function (i) {
      var v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    return 1.05 / (lum + 0.05) < ${JSON.stringify(WHITE_KEEP_MIN)} ? ${DARK} : ${LIGHT};
  }
`;
