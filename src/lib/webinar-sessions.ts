/**
 * 세션 유형 규칙 한 곳 — 뷰어·어드민·랜딩이 같은 결론을 내야 한다.
 *
 * WebinarSession.type 은 DB 에서 제약 없는 String(기본값 "session")이다. enum 도 CHECK 도 없어서
 * **유형의 무결성을 지키는 건 이 파일과 CRUD 라우트의 화이트리스트뿐이다.** 유형을 늘릴 때
 * 마이그레이션은 필요 없지만, 아래 표에 넣지 않으면 라우트가 조용히 "session" 으로 강제한다.
 *
 * 두 축을 분리한다:
 *  - number      : DB 의 진행 순서. 정렬과 Q&A 참조(WebinarQA.sessionNumber)의 키. 절대 바꾸지 않는다.
 *  - 표시 순번    : 실제 세션만 1..N 으로 다시 센 값. 화면에 보이는 "세션 n" 은 이것을 쓴다.
 * number 를 renumber 하지 않는 이유: 이미 저장된 Q&A 의 sessionNumber 참조가 끊긴다.
 *
 * ── 오프닝·클로징을 추가할 때 내린 두 결정 ──────────────────────────────────
 *
 * 1. **세션으로 세지 않는다**(counts: false). "세션 n" 은 콘텐츠 세션의 번호다. 오프닝을 세션으로
 *    세면 기존 웨비나 전부의 세션 번호가 1씩 밀리고, 이미 저장된 WebinarQA.sessionNumber 가
 *    가리키는 대상의 의미가 바뀐다. 진행 순서(number)에는 당연히 자리를 차지한다.
 *
 * 2. **연사는 있다**(hasSpeaker: true). 휴식만 연사가 없다. 오프닝은 대표 인사말, 클로징은 마무리
 *    발언처럼 사람이 서는 순서다. 이전에는 "연사 있음" 이 isBreak 하나에 묶여 있었고, 게다가
 *    화면마다 극성이 반대였다 — 시청 화면은 `type !== "break"`(부정형), 랜딩은 `type === "session"`
 *    (긍정형). 그래서 **Q&A 의 연사("전체 연사")가 라이브에는 보이고 랜딩에서는 안 보였다.**
 *    이 파일의 hasSpeaker 로 둘을 합쳐 그 불일치까지 없앤다.
 */

/** 유형 하나의 규칙. 화면이 유형을 보고 분기하려면 반드시 여기 필드를 읽어야 한다. */
export interface SessionTypeMeta {
  value: string;
  /** 한국어 라벨 — 어드민 칩·목록 배지·시청 화면 배지가 공유한다. */
  label: string;
  /** 사람이 서는 순서인가. 아니면 연사 이름·소속·약력·사진 입력과 표시를 전부 감춘다. */
  hasSpeaker: boolean;
  /** "세션 n" 번호와 "N개 세션" 카운트에 포함되는가 (= isRealSession). */
  counts: boolean;
  /**
   * 대기 화면 아젠다의 영문 종류 표기. null 이면 `Session {표시번호}` 를 쓴다(실제 세션만).
   * 이 화면은 영문 키커로 디자인돼 있어 한국어 label 과 따로 둔다.
   */
  kicker: string | null;
  /** 랜딩 타임테이블 행에 붙는 태그. null 이면 태그 없음. */
  landingTag: string | null;
  /**
   * "아무것도 진행되지 않는 시간" 인가 — 휴식만 true.
   *
   * counts(=세션인가)와 **다른 축**이다. 오프닝·클로징·Q&A 는 세션으로 세지 않지만 콘텐츠이고,
   * 휴식만 빈 시간이다. 이 구분을 안 두고 "세션이 아니면 톤다운" 으로 묶으면 랜딩 타임테이블에서
   * 오프닝·Q&A 행까지 어둡게 반전된다(기존 Q&A 행의 시각 회귀).
   */
  isPause: boolean;
}

/**
 * 유형 표 — **어드민 칩의 순서가 이 배열 순서다.** 진행 순서대로 읽히게 배치했다
 * (오프닝 → 세션 → Q&A → 휴식 → 클로징). 기본값은 순서와 무관하게 "session" 이다.
 */
export const SESSION_TYPES: readonly SessionTypeMeta[] = [
  { value: "opening", label: "오프닝", hasSpeaker: true, counts: false, kicker: "Opening", landingTag: "Opening", isPause: false },
  { value: "session", label: "세션", hasSpeaker: true, counts: true, kicker: null, landingTag: null, isPause: false },
  { value: "qa", label: "Q&A", hasSpeaker: true, counts: false, kicker: "Q&A", landingTag: "Live Q&A", isPause: false },
  { value: "break", label: "휴식", hasSpeaker: false, counts: false, kicker: "Break", landingTag: null, isPause: true },
  { value: "closing", label: "클로징", hasSpeaker: true, counts: false, kicker: "Closing", landingTag: "Closing", isPause: false },
] as const;

/** 기본 유형 — 스키마의 @default 와 같아야 한다. type 이 비어 있는 레거시 행도 이걸로 읽는다. */
export const DEFAULT_SESSION_TYPE = "session";

/** 라우트 검증용. `SESSION_TYPE_VALUES.includes(x)` 가 유형의 유일한 관문이다. */
export const SESSION_TYPE_VALUES: readonly string[] = SESSION_TYPES.map((t) => t.value);

const BY_VALUE = new Map(SESSION_TYPES.map((t) => [t.value, t]));

/** 표에 없는 값(레거시 오염·직접 API 호출)이면 undefined. 호출부가 폴백을 정한다. */
export function sessionTypeMeta(type: string | null | undefined): SessionTypeMeta | undefined {
  return BY_VALUE.get(type ?? DEFAULT_SESSION_TYPE);
}

/**
 * 배지에 쓸 한국어 라벨. 모르는 유형이면 **null** 이다 — 예전엔 `?? s.type` 폴백이라
 * 표에 없는 값이 들어오면 시청자 화면에 영문 원문("opening")이 그대로 찍혔다.
 * 모르면 배지를 안 그리는 게 영문을 보여 주는 것보다 낫다.
 */
export function sessionTypeLabel(type: string | null | undefined): string | null {
  return sessionTypeMeta(type)?.label ?? null;
}

/** 연사 입력·표시를 켜는가. 모르는 유형은 보수적으로 true(입력된 값을 숨기지 않는다). */
export function sessionHasSpeaker(type: string | null | undefined): boolean {
  return sessionTypeMeta(type)?.hasSpeaker ?? true;
}

/** 빈 시간(휴식)인가 — 진행 순서에서 톤을 낮춰 그리는 유일한 근거. */
export function isPauseSession(type: string | null | undefined): boolean {
  return sessionTypeMeta(type)?.isPause ?? false;
}

export interface SessionLike {
  number: number;
  type?: string | null;
}

/**
 * "세션 n" 과 "N개 세션" 에 들어가는 행인가.
 *
 * 표를 읽는 방식으로 바꿨다(예전엔 `type === "session"` 리터럴). 모르는 유형은 세션으로 본다 —
 * 스키마 기본값이 "session" 이고, type 이 비어 있는 레거시 행이 세션이기 때문이다.
 */
export function isRealSession(s: SessionLike): boolean {
  return sessionTypeMeta(s.type)?.counts ?? true;
}

/**
 * 레거시 오염값 정리. PATCH 라우트의 String(null) 버그로 문자열 "null" 이 저장된 행이 있었다.
 * 그 버그는 고쳤지만 이미 저장된 값이 남아 있을 수 있어 읽는 쪽에서도 한 번 걸러 준다
 * (해당 행을 어드민에서 다시 저장하면 자연히 사라진다).
 */
export function cleanSessionText(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s === "null" || s === "undefined" ? "" : s;
}

export interface SessionNumbering {
  /** 실제 세션 개수 (오프닝·Q&A·휴식·클로징 제외) — "N개 세션", "n/N" 의 N. */
  realCount: number;
  /** DB number → 표시 순번(1-based). 실제 세션이 아니면 null. */
  displayNumber(number: number): number | null;
}

/**
 * 진행 순서(number 오름차순)를 기준으로 실제 세션만 1..N 으로 다시 센다.
 * 입력 순서에 의존하지 않도록 내부에서 number 로 정렬한다.
 */
export function buildSessionNumbering(rows: readonly SessionLike[]): SessionNumbering {
  const map = new Map<number, number>();
  let n = 0;
  for (const s of [...rows].sort((a, b) => a.number - b.number)) {
    if (!isRealSession(s)) continue;
    map.set(s.number, ++n);
  }
  return {
    realCount: n,
    displayNumber: (number: number) => map.get(number) ?? null,
  };
}

/**
 * 저장된 참조 키(WebinarQA.sessionNumber)를 **화면에 쓸 표시번호**로 바꾼다.
 *
 * null 을 돌려주는 경우가 셋이고 셋 다 "세션 배지를 그리지 않는다" 로 끝난다:
 *  - 애초에 세션을 고르지 않은 질문(sessionNumber == null)
 *  - 오프닝·Q&A·휴식·클로징을 가리키는 질문 — **이들은 세션이 아니다**
 *  - 가리키던 행이 삭제된 질문
 *
 * 원본 번호로 폴백하지 않는 것이 이 함수의 요점이다. 폴백하면 진행 순서 원본이 그대로 새어
 * 나가서, 세션 4개인 웨비나의 문의 목록에 "세션 5·6" 이 찍힌다(오프닝·휴식이 번호를 차지한 만큼
 * 어긋난 값). 참조 키와 표시번호를 나눠 둔 이유가 파일 상단 "두 축" 설명에 있다.
 */
export function resolveSessionRef(
  numbering: SessionNumbering,
  sessionNumber: number | null | undefined,
): number | null {
  if (sessionNumber == null) return null;
  return numbering.displayNumber(sessionNumber);
}

/**
 * 대기 화면 아젠다 한 행의 영문 종류 표기.
 *
 * 여기 있는 이유: 예전엔 호출부에서 `brk ? "Break" : qa ? "Q&A" : \`Session ${displayNumber ?? number}\``
 * 였다. 새 유형은 else 로 떨어지는데 실제 세션이 아니라 displayNumber 가 null 이고, 그러면
 * 폴백이 **DB 진행 순서 원본**을 찍어서 오프닝(number 1)과 첫 세션(표시번호 1)이 한 화면에
 * 둘 다 "Session 1" 로 나온다. 표시번호가 없으면 번호를 아예 안 붙이는 게 맞다.
 */
export function sessionKicker(type: string | null | undefined, displayNumber: number | null): string {
  const meta = sessionTypeMeta(type);
  if (meta?.kicker) return meta.kicker;
  return displayNumber === null ? "Session" : `Session ${displayNumber}`;
}

/**
 * 연사 표기 분리 — 새 데이터는 speakerCompany 컬럼, 레거시는 speaker 의 "이름 | 회사" 결합형.
 *
 * 왜 공용인가: 같은 연사를 그리는 곳이 네 군데다(랜딩 타임테이블 · 랜딩 상세 팝업 ·
 * 대기 화면 세션 순서 · 라이브 세션 목록). 각자 raw speaker 를 쓰면 레거시 결합형에서
 * 구분자가 두 번 나오거나 소속이 이름 안에 박혀 나온다 — 실제로 랜딩만 파싱하고 대기·라이브는
 * raw 를 쓰고 있었다.
 */
export function parseSpeaker(
  speaker: string | null | undefined,
  company: string | null | undefined,
): { name: string; company: string } {
  const raw = (speaker ?? "").trim();
  const co = (company ?? "").trim();
  if (co) return { name: raw, company: co };
  const idx = raw.indexOf("|");
  if (idx >= 0) return { name: raw.slice(0, idx).trim(), company: raw.slice(idx + 1).trim() };
  return { name: raw, company: "" };
}
import type { LiveSessionDisplay } from "./webinar-config";

export function resolveLiveSessionHighlights<T extends { id: string; status: string }>(
  sessions: T[],
  display: LiveSessionDisplay,
) {
  const { liveCurrentSession: current, liveNextSession: next } = display;
  const activeSession = sessions.find((session) => current === "auto"
    ? session.status === "now" && session.id !== next
    : session.id === current) ?? null;
  const manualCurrent = current !== "auto" ? activeSession : null;
  const nextSession = next === "auto" && manualCurrent
    ? sessions[sessions.indexOf(manualCurrent) + 1] ?? null
    : sessions.find((session) => session !== activeSession && (next === "auto"
      ? session.status === "upcoming"
      : session.id === next)) ?? null;
  return { activeSession, nextSession };
}
