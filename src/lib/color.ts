/**
 * 색 계산의 **공용 계약** — 브라우저·서버·임베드 번들 어디서나 쓴다.
 *
 * ── 왜 모으나 ─────────────────────────────────────────────────────────
 * 같은 계산이 저장소에 **네 벌** 있었다: 라이브 시청 화면, 랜딩 런타임, 대회 공고,
 * 그리고 랜딩 모델(`landing/model.onPrimaryFor`). 네 번째가 조용히 틀린 채 남아 있던 것이
 * 2026-11 형광 키컬러 사고의 원인이다 — 다른 세 곳을 고쳐도 웨비나 상세페이지는 그대로였다.
 * 지금은 전부 이 파일을 재수출한다(이름은 호출부 편의상 각자 유지).
 *
 * ── 남은 사본 하나 ────────────────────────────────────────────────────
 * `color-embed-js.ts` 의 문자열 판만 예외다. 웨비나 로더는 번들이 아니라 서버가 만든
 * 문자열이라 import 를 할 수 없다. 그 사본은 임계값을 여기서 **가져다 쓰고**,
 * `__tests__/color-embed-js.test.ts` 가 69,632 색에서 정본과 차등 비교해 묶어 둔다.
 *
 * React 를 쓰지 않고 DOM 도 만지지 않는다 — 임베드 번들에 들어갈 수 있어야 한다.
 */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * `#rrggbb` 소문자로 편다. hex 가 아니면 null — 저장된 값은 무엇이든 올 수 있으므로 던지지 않는다.
 */
export function normalizeHexColor(value: string): string | null {
  if (typeof value !== "string") return null;
  const m = HEX.exec(value.trim());
  if (!m) return null;
  const hex = m[1].toLowerCase();
  return "#" + (hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex);
}

export function isHexColor(value: string): boolean {
  return normalizeHexColor(value) !== null;
}

/**
 * **상대휘도**(WCAG 2.x) — 0(검정) ~ 1(흰색). hex 가 아니면 null.
 *
 * YIQ 체감밝기(0.299R+0.587G+0.114B)와 다르다. YIQ 는 감마를 안 펴서 **형광색을 과소평가**한다:
 * 네온 그린(#39ff14)은 YIQ 0.663 인데 상대휘도는 0.724 다. 그 차이가 아래 `onAccentColor` 가
 * 오래 틀렸던 이유다(2026-11 웨비나 상세페이지 — 형광 키컬러에 흰 글자가 안 보였다).
 */
export function relativeLuminance(color: string): number | null {
  const normalized = normalizeHexColor(color);
  if (!normalized) return null;
  const hex = normalized.slice(1);
  const linear = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/**
 * 두 색의 **대비비**(1 ~ 21). 한쪽이라도 hex 가 아니면 1(= 대비 없음)로 본다 —
 * 모르는 색을 "괜찮다"고 통과시키지 않는 방향이다.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return 1;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 키컬러 위에 쓰는 두 글자색. 순백/순검 대신 살짝 눕힌 값이다. */
const ON_LIGHT = "#1a1a1f";
const ON_DARK = "#ffffff";

/**
 * 흰 글자를 유지할 **최소 대비**. 이 아래면 글자의 형태조차 안 보인다고 본다.
 *
 * 2.0 이라는 값은 두 사실 사이에서 나왔다:
 *  · 브랜드 주황(#ff8500)에 흰 글자는 2.44:1 로, **흰 글자를 쓰기로 한 결정**이다(AA 미달이지만
 *    대비를 올리려면 글자색이 아니라 버튼 배경을 낮추는 쪽이 맞다 — 아래 긴 주석 참고).
 *  · 사고를 낸 형광색들은 전부 1.4:1 아래다: 네온그린 1.36, 순초록 1.37, 시안 1.25, 노랑 1.07.
 * 2.0 은 그 사이의 넓은 빈 구간이라, 브랜드 색을 건드리지 않고 형광색만 뒤집는다.
 */
export const WHITE_KEEP_MIN = 2.0;

/**
 * 키컬러 **위에 얹을 글자색**.
 *
 * 흰색이 기본이다(브랜드 결정). 진한 글자는 **흰 글자가 형태조차 안 보이는** 키컬러에서만
 * 쓰는 안전장치다.
 *
 * ── 왜 YIQ 임계값에서 대비비로 바꿨나 ─────────────────────────────────
 * 예전 규칙은 "YIQ 체감밝기 ≥ 0.78 이면 진한 글자" 였다. YIQ 는 sRGB 감마를 펴지 않아
 * **형광색의 밝기를 실제보다 낮게** 센다. 그래서 네온 그린(#39ff14, YIQ 0.663)·순초록
 * (#00ff00, 0.587)·시안(#00ffff, 0.701)이 전부 임계값 아래로 떨어져 흰 글자를 받았고,
 * 그 조합의 실제 대비는 1.25~1.37:1 — 글자가 배경에 녹아 사라진다. 2026-11 웨비나
 * 상세페이지에서 형광 키컬러를 쓴 운영자가 겪은 게 정확히 이것이다.
 *
 * 지금 규칙은 **흰 글자의 실제 대비를 재서** 2.0:1 미만일 때만 진한 글자로 내린다.
 * 노랑·연회색처럼 예전에도 진한 글자를 받던 색은 그대로고(1.07·1.14), 주황·네이비·빨강처럼
 * 흰 글자를 받던 브랜드 색도 그대로다(2.44·12.6·4.00). 바뀌는 것은 형광 계열뿐이다.
 *
 * 흰 글자의 대비가 주황에서 2.44:1 로 AA(4.5:1)에 못 미치는 것은 여전하다 — 흰색을 쓰기로 한
 * 브랜드 판단을 따르되, 대비를 올리려면 글자색이 아니라 **버튼 배경을 키컬러의 66% 쯤으로
 * 낮추는** 쪽이 맞다(그때 흰 글자가 4.58:1 이 된다).
 */
export function onAccentColor(accent: string): string {
  const normalized = normalizeHexColor(accent);
  if (!normalized) return ON_DARK; // hex 가 아니면(rgb·named) 기존 동작 유지
  return contrastRatio(ON_DARK, normalized) < WHITE_KEEP_MIN ? ON_LIGHT : ON_DARK;
}

/**
 * 배경 위에서 읽히는 **본문 글자색**.
 *
 * 상수로 두지 않는 이유: 편집 UI 가 "글자색은 배경에서 자동으로 따라옵니다" 라고 안내하는데,
 * 운영자가 다크 배경에 흰색을 고르면 상수로는 대비 1.06:1 백지가 된다.
 * 순백/순검 대신 배경 계열로 살짝 눕힌다.
 *
 * hex 가 아니면 **종이색**으로 떨어진다 — 기존 두 구현이 파싱 실패 시 NaN 비교로 그렇게
 * 동작했고(`luminance > 0.45` 가 false), 다크 배경 기본값이라 무해한 쪽이라 그대로 둔다.
 */
export function paperFor(bg: string): string {
  const luminance = relativeLuminance(bg);
  if (luminance === null) return "#f6f8ff";
  return luminance > 0.45 ? "#101828" : "#f6f8ff";
}

/**
 * 운영자가 **고른 글자색을 그대로 쓰되, 안 읽히면 배경에서 자동으로 뒤집는다.**
 *
 * `paperFor` 는 "배경만 보고 글자색을 정한다" 이고 이건 "운영자의 선택을 존중하되 사고만
 * 막는다" 다. 두 개가 필요한 이유: 테마 편집기는 글자색을 **따로 고르게** 해 두었는데
 * (진회색 본문·크림색 본문 같은 선택이 실제로 쓰인다), 그 자유 때문에 흰 배경에 흰 글자,
 * 형광 배경에 흰 글자 같은 조합이 저장될 수 있다.
 *
 * 기준 3.0:1 은 **"분명히 안 보인다"의 선**이다. AA 본문 기준(4.5:1)으로 잡으면 4.4:1 짜리
 * 의도적인 저대비 디자인까지 말없이 갈아엎게 된다 — 운영자가 고른 값을 뒤집는 일은
 * 되돌릴 수 없을 만큼 명백할 때만 한다.
 */
export const READABLE_MIN_CONTRAST = 3.0;

export function readableTextOn(bg: string, preferred: string): string {
  const wanted = normalizeHexColor(preferred);
  if (!isHexColor(bg)) return wanted ?? preferred;
  if (!wanted) return paperFor(bg);
  return contrastRatio(wanted, bg) >= READABLE_MIN_CONTRAST ? wanted : paperFor(bg);
}

/**
 * 같은 색을 **흐리게** 쓴다 — 보조 문구용.
 *
 * 별도의 회색을 상수로 두지 않는 이유: 다크 배경에서는 회색이 안 읽히고, 밝은 배경에서는
 * 너무 튄다. 본문 색에 알파를 얹으면 어느 배경에서든 같은 관계가 유지된다.
 * hex 가 아니면 원래 값을 그대로 돌려준다 — 색을 지어내지 않는다.
 */
export function withAlpha(color: string, alpha: number): string {
  const normalized = normalizeHexColor(color);
  if (!normalized) return color;
  const hex = normalized.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
