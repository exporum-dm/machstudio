/**
 * 번역 한 칸의 **공용 모양** — 수집 빌더와 웨비나 등록 폼이 같은 표를 쓰게 한다.
 *
 * 두 제품의 저장 구조는 다르다: 수집은 문구마다 로케일 맵(`{ko: "…", en: "…"}`)을 들고,
 * 웨비나는 원문 위에 **언어별 덮개**를 얹는다(문구가 전부 `string` 이고 읽는 곳이 네 군데라
 * 타입을 바꿀 수 없었다 — `webinar-config.ts` 의 WebinarFormTranslation 주석).
 *
 * 저장이 다르다고 **편집 화면까지 두 벌**이 되면, 한쪽에만 들어가는 개선이 생긴다
 * (진행률·"원문 그대로"·묶음 순서). 그래서 "원문 / 번역 / 쓰는 법" 이라는 공통 모양만
 * 여기 두고, 그 모양을 만드는 일은 각 제품의 i18n 모듈이 한다.
 */
export interface TranslationEntry<TConfig> {
  /** React key·포커스 유지용 안정 식별자. */
  id: string;
  /** 표를 끊어 읽게 하는 묶음 이름. */
  group: string;
  /** 이 칸이 무엇인지 — "이름 · 라벨", "안내 1 · 본문". */
  context: string;
  /** 기본 언어 원문. 비어 있으면 번역할 것도 없다(목록에서 제외된다). */
  base: string;
  /** 지금 언어의 번역(폴백 없음 — 비면 빈 문자열). */
  value: string;
  /** 번역을 적용한 새 설정. 원본을 건드리지 않는다(자동저장이 직전 값과 비교한다). */
  write: (config: TConfig, next: string) => TConfig;
  /** 여러 줄 입력으로 그릴지(동의 전문·안내 본문). */
  multiline: boolean;
}

/** 번역 진행률 — "12 / 18" 을 그리는 데 쓴다. */
export function translationProgress<TConfig>(
  entries: readonly TranslationEntry<TConfig>[],
): { done: number; total: number } {
  return { done: entries.filter((e) => e.value.trim()).length, total: entries.length };
}
