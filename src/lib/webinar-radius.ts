// 웨비나 테마의 테두리 둥글기(theme.borderRadius) → 공개 화면 배율.
//
// 공개 화면의 카드·버튼은 곳마다 크기에 맞는 둥글기를 따로 갖고 있어서(카드 20px, 버튼 11px …)
// 값 하나를 그대로 넣으면 위계가 무너진다. 그래서 편집기 기본값 16px 을 배율 1 로 두고 모두 같은
// 비율로 늘이고 줄인다 — "기본"을 고른 웨비나와 값을 저장한 적 없는 웨비나의 화면은 그대로다.

export const DEFAULT_WEBINAR_RADIUS_PX = 16;

/** "8px" → 0.5, "0px" → 0. 없거나 px 로 읽을 수 없는 값은 1(디자인 기본값). */
export function webinarRadiusScale(value: unknown): number {
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(String(value ?? "").trim());
  return match ? Number(match[1]) / DEFAULT_WEBINAR_RADIUS_PX : 1;
}
