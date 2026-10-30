/**
 * 세션 로고의 **표시 규격** 한 곳 — 랜딩·대기·입장·시청·상세 팝업이 같은 크기로 보이게.
 *
 * 왜 모듈로 뺐나: 같은 로고가 면마다 다른 크기로 나왔다(실측).
 *   랜딩 타임테이블 22px / 최대 140px  ·  대기 화면 22px / 132px  ·  라이브 세션 목록 20px / 120px
 * CSS 문자열이 파일마다 따로 살아서(landing/css.ts, PreLiveWaiting, LiveContentStk) 한 곳을 고쳐도
 * 나머지가 안 따라왔다. 이제 숫자는 여기 한 벌이고 각 CSS 는 이 함수로 규칙을 찍어 낸다.
 *
 * 규격 근거:
 *   · **폭·높이를 둘 다 고정한 슬롯** + object-fit:contain. 찌그러지지 않으면서
 *     (contain 이 비율을 지킨다) 모든 로고가 같은 자리에서 시작·끝난다.
 *     예전엔 width:auto 라 박스가 원본 비율대로 제각각이어서, 목록에서 로고들이
 *     들쭉날쭉하게 보였다 — 높이는 같은데 시작·끝 위치와 시각 무게가 달랐다.
 *   · 26×120: 타임테이블 한 줄(최소 62px)·대기 화면 세션 줄에 들어가는 크기.
 *     22px 이었는데 실물에서 작아 보여 26 으로 올렸다.
 *
 * ⚠ 남는 한계: 원본 이미지에 **내부 여백**이 있으면 같은 슬롯 안에서도 마크가 작게
 *   보인다(contain 은 여백까지 포함해 맞춘다). 그건 CSS 로 잘라낼 수 없다 —
 *   업로드 전에 이미지를 트림하는 것만이 답이다.
 */

/** 로고 슬롯 높이(px) — 모든 면 공통. */
export const SESSION_LOGO_HEIGHT = 26;
/**
 * 로고 슬롯 폭(px) — **고정**이다(max-width 가 아니다).
 *
 * width:auto 로 두면 박스 크기가 원본 비율에 따라 제각각이 되어, 목록에서 로고들이
 * 서로 다른 자리에서 시작·끝나고 세로 리듬이 깨진다("들쭉날쭉"). 폭을 고정하고
 * object-fit:contain 으로 안에 맞추면 **슬롯이 같아진다**.
 */
export const SESSION_LOGO_WIDTH = 120;
/**
 * fixedWidth:false 에서 쓰는 안전판 — 아주 가늘고 긴 원본(배너형 로고)이 height:26 으로
 * 커지면서 폭이 통제 불능으로 벌어지는 걸 막는다(실측 위험: 480×10 원본이 26px 높이로
 * 스케일되면 폭이 1200px 을 넘는다). 평소엔 닿지 않는 값이라 보통 로고의 모양에 영향이 없다.
 */
export const SESSION_LOGO_MAX_WIDTH = 220;

/**
 * 로고 표시 규칙을 CSS 로 찍는다.
 *
 * @param selector 규칙을 붙일 셀렉터(예: `.lnd .schedule-logo`)
 * @param opts.plate 흰 판을 깔지 — 어두운 배경 위에서는 필수다(투명 PNG 가 대부분이라
 *   판이 없으면 검은 글자 로고가 배경에 묻혀 사라진다). 밝은 배경에서는 판이 오히려
 *   네모난 테두리처럼 보여서 끈다.
 * @param opts.align object-position 의 가로 정렬 — 왼쪽 정렬이 기본(글의 흐름과 맞춘다).
 *   fixedWidth:false 면 폭이 자체 비율대로 좁혀져 평소엔 의미가 없다(SESSION_LOGO_MAX_WIDTH
 *   에 걸려 눌릴 때만 effect 가 보인다).
 * @param opts.fixedWidth 폭도 높이처럼 고정 슬롯(SESSION_LOGO_WIDTH)으로 둘지 — 기본 true.
 *   기준은 "여러 로고가 **같은 왼쪽 시작점**에서 줄을 맞춰야 하는가" 다. 그런 자리(예: 카드가
 *   나란한 그리드에서 각 칸이 로고+텍스트를 왼쪽 정렬로 쌓는 경우)는 고정 폭이 맞다 — 폭이
 *   제각각이면 그 옆 텍스트 시작점이 로고 모양 따라 들쭉날쭉해진다. 반대로 **오른쪽(또는
 *   가운데) 정렬로 끝 지점만 맞으면 되는 자리**(상세 팝업의 줄 끝, 타임테이블 각 줄의 오른쪽
 *   끝)에서는 고정 폭이 역효과다 — 슬롯 끝은 맞아도 슬롯 안에서 로고가 왼쪽 정렬이라
 *   **로고 모양 자체**는 줄마다 다른 자리에서 끝나 보인다(실측: 폭 다른 로고 네 개를 같은
 *   오른쪽 정렬 줄에 놓았더니 로고 끝이 들쭉날쭉했다). false 로 주면 높이만 고정하고 폭은
 *   로고 자체 비율대로 좁혀져, 흰 판과 로고 모양이 함께 같은 끝 지점에서 맞아떨어진다.
 */
export function sessionLogoCss(
  selector: string,
  opts?: { plate?: boolean; align?: "left" | "center"; fixedWidth?: boolean },
): string {
  const align = opts?.align ?? "left";
  const fixedWidth = opts?.fixedWidth ?? true;
  const plate = opts?.plate
    ? " background:#fff; border-radius:4px; padding:2px 4px;"
    : "";
  /**
   * box-sizing 을 **명시**한다 — 두 가지 이유로 생략할 수 없다.
   *
   * 1) 흰 판을 깐 로고가 작아진다. border-box 에서는 height:22px 안에 padding 4px 이 들어가서
   *    마크가 18px 로 줄고, 판 없는 면(22px)과 나란히 보면 다른 크기가 된다. 실측: 같은 로고가
   *    타임테이블 108px 폭 vs 팝업 97px 폭. content-box 면 판은 밖으로 자라고 마크는 22px 로 같다.
   * 2) 랜딩은 **남의 사이트에 직접 마운트**된다. 호스트의 리셋이 border-box 든 content-box 든
   *    같은 크기로 보여야 하므로 이 규칙이 호스트 리셋에 의존하면 안 된다.
   */
  const sizing = fixedWidth
    ? `width:${SESSION_LOGO_WIDTH}px; object-fit:contain; object-position:${align} center;`
    : `width:auto; max-width:${SESSION_LOGO_MAX_WIDTH}px; object-fit:contain; object-position:${align} center;`;
  return `${selector} { display:block; box-sizing:content-box; height:${SESSION_LOGO_HEIGHT}px; ${sizing}${plate} }`;
}
