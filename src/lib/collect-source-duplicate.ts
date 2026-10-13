/**
 * 사전등록 폼 복제 — 무엇을 가져가고 무엇을 새로 두는가.
 *
 * 쓰임: 같은 행사의 비슷한 프로그램(원데이 클래스 → 랜덤 플레이 댄스)을 폼 항목은 그대로 두고
 * 내용만 바꿔 새로 연다(2026-10-13 요청). 그래서 **설정은 전부 복사**하되, 등록 데이터와
 * "그 폼만의 열쇠"(API 키·미리보기 링크·체크인 링크/PIN)는 새로 둔다 — 열쇠를 복사하면
 * 두 폼이 같은 링크로 열리거나, 운영요원이 원본 폼의 PIN 으로 새 폼에 들어간다.
 *
 * 웹훅은 복사하지 않는다 — 새 폼의 등록이 원본 폼의 연동처(시트·슬랙)로 조용히 섞여 들어간다.
 */
export interface DuplicateSourceInput {
  name: string;
  description: string | null;
  siteUrl: string | null;
  successTrigger: string;
  redirectUrl: string | null;
  allowedOrigins: string[];
  formPagePatterns: string[];
  dedupKeyFields: string[];
  fieldGroupSelector: string;
  mode: string;
  formConfig: unknown;
  emailConfig: unknown;
  venueConfig: unknown;
  checkinTimezone: string;
}

/** 복사본 기본 이름 — 목록에서 원본과 바로 구분되게. */
export function duplicateName(name: string): string {
  return `${name} (복사본)`.slice(0, 200);
}

/** JSON 값을 통째로 새 객체로 — 원본과 참조를 공유하지 않게. */
function cloneJson<T>(value: T): T {
  return value === null || value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** 새 CollectSource 의 data(프로젝트·워크스페이스·토큰은 호출부가 채운다). */
export function duplicateSourceData(source: DuplicateSourceInput, name: string) {
  return {
    name,
    description: source.description,
    siteUrl: source.siteUrl,
    successTrigger: source.successTrigger,
    redirectUrl: source.redirectUrl,
    allowedOrigins: [...source.allowedOrigins],
    formPagePatterns: [...source.formPagePatterns],
    dedupKeyFields: [...source.dedupKeyFields],
    fieldGroupSelector: source.fieldGroupSelector,
    mode: source.mode,
    formConfig: cloneJson(source.formConfig),
    emailConfig: cloneJson(source.emailConfig),
    venueConfig: cloneJson(source.venueConfig),
    checkinTimezone: source.checkinTimezone,
    // 새로 두는 것 — 위 머리말 참고
    isActive: true,
    webhookUrl: null,
    notifyOnSubmit: false,
    checkinEnabled: false,
    checkinToken: null,
    checkinPinHash: null,
  };
}
