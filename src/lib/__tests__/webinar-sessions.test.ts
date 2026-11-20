import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_TYPE,
  SESSION_TYPES,
  SESSION_TYPE_VALUES,
  buildSessionNumbering,
  cleanSessionText,
  isRealSession,
  resolveLiveSessionHighlights,
  resolveSessionRef,
  sessionHasSpeaker,
  sessionKicker,
  sessionTypeLabel,
} from "../webinar-sessions";

describe("live session highlights", () => {
  const sessions = [{ id: "one", status: "done" }, { id: "two", status: "now" }, { id: "three", status: "upcoming" }];

  it("uses the schedule by default and lets the operator hold an earlier session", () => {
    expect(resolveLiveSessionHighlights(sessions, { liveCurrentSession: "auto", liveNextSession: "auto" }))
      .toEqual({ activeSession: sessions[1], nextSession: sessions[2] });
    expect(resolveLiveSessionHighlights(sessions, { liveCurrentSession: "one", liveNextSession: "auto" }))
      .toEqual({ activeSession: sessions[0], nextSession: sessions[1] });
  });

  it("hides either highlight without removing the agenda", () => {
    expect(resolveLiveSessionHighlights(sessions, { liveCurrentSession: "hidden", liveNextSession: "one" }))
      .toEqual({ activeSession: null, nextSession: sessions[0] });
    expect(resolveLiveSessionHighlights(sessions, { liveCurrentSession: "two", liveNextSession: "hidden" }))
      .toEqual({ activeSession: sessions[1], nextSession: null });
    expect(resolveLiveSessionHighlights(sessions, { liveCurrentSession: "deleted-id", liveNextSession: "hidden" }))
      .toEqual({ activeSession: null, nextSession: null });
  });
});

/**
 * 이 파일에 테스트가 없던 상태로 유형을 2종 늘렸다. isRealSession 하나가 표시 순번·세션 개수·
 * Q&A 칩·랜딩 세션 카드·운영 준비도 5개 화면을 결정하므로, 여기서 규칙을 못 박는다.
 */

describe("SESSION_TYPES 표", () => {
  it("기본 유형이 표에 있고 스키마 @default 와 같다", () => {
    expect(DEFAULT_SESSION_TYPE).toBe("session");
    expect(SESSION_TYPE_VALUES).toContain(DEFAULT_SESSION_TYPE);
  });

  it("유형 5종 — 오프닝·세션·Q&A·휴식·클로징", () => {
    expect(SESSION_TYPE_VALUES).toEqual(["opening", "session", "qa", "break", "closing"]);
  });

  it("값이 중복되지 않는다 — 중복되면 Map 조회가 뒤 항목으로 조용히 덮인다", () => {
    expect(new Set(SESSION_TYPE_VALUES).size).toBe(SESSION_TYPE_VALUES.length);
  });

  it("세션만 카운트에 든다 — 오프닝·클로징을 세면 기존 웨비나의 세션 번호가 밀린다", () => {
    expect(SESSION_TYPES.filter((t) => t.counts).map((t) => t.value)).toEqual(["session"]);
  });

  it("휴식만 연사가 없다", () => {
    expect(SESSION_TYPES.filter((t) => !t.hasSpeaker).map((t) => t.value)).toEqual(["break"]);
  });

  it("모든 유형에 한국어 라벨이 있다 — 없으면 화면에 영문 value 가 새어 나간다", () => {
    for (const t of SESSION_TYPES) {
      expect(t.label, t.value).toBeTruthy();
      expect(/^[a-z]+$/.test(t.label), `${t.value} 라벨이 영문 원문`).toBe(false);
    }
  });
});

describe("sessionTypeLabel", () => {
  it("아는 유형은 한국어로", () => {
    expect(sessionTypeLabel("opening")).toBe("오프닝");
    expect(sessionTypeLabel("closing")).toBe("클로징");
    expect(sessionTypeLabel("break")).toBe("휴식");
  });

  it("빈 값은 기본 유형(세션)으로 읽는다 — 레거시 행", () => {
    expect(sessionTypeLabel(null)).toBe("세션");
    expect(sessionTypeLabel(undefined)).toBe("세션");
  });

  it("모르는 유형은 null — 영문 원문을 시청자에게 보여 주지 않는다", () => {
    expect(sessionTypeLabel("keynote")).toBeNull();
    expect(sessionTypeLabel("null")).toBeNull();
  });
});

describe("sessionHasSpeaker", () => {
  it("휴식만 false", () => {
    expect(sessionHasSpeaker("break")).toBe(false);
    for (const v of ["opening", "session", "qa", "closing"]) {
      expect(sessionHasSpeaker(v), v).toBe(true);
    }
  });

  it("모르는 유형은 true — 이미 입력된 연사를 숨기지 않는다", () => {
    expect(sessionHasSpeaker("keynote")).toBe(true);
  });
});

describe("isRealSession", () => {
  it("세션만 센다", () => {
    expect(isRealSession({ number: 1, type: "session" })).toBe(true);
    for (const t of ["opening", "qa", "break", "closing"]) {
      expect(isRealSession({ number: 1, type: t }), t).toBe(false);
    }
  });

  it("type 이 비어 있는 레거시 행은 세션", () => {
    expect(isRealSession({ number: 1 })).toBe(true);
    expect(isRealSession({ number: 1, type: null })).toBe(true);
  });
});

describe("buildSessionNumbering", () => {
  // 오프닝(1) · 세션(2) · 휴식(3) · 세션(4) · Q&A(5) · 클로징(6)
  const rows = [
    { number: 1, type: "opening" },
    { number: 2, type: "session" },
    { number: 3, type: "break" },
    { number: 4, type: "session" },
    { number: 5, type: "qa" },
    { number: 6, type: "closing" },
  ];

  it("실제 세션만 1..N 으로 다시 센다", () => {
    const n = buildSessionNumbering(rows);
    expect(n.realCount).toBe(2);
    expect(n.displayNumber(2)).toBe(1);
    expect(n.displayNumber(4)).toBe(2);
  });

  it("세션이 아닌 행은 표시번호가 없다 — 오프닝이 'Session 1' 로 중복되지 않는 근거", () => {
    const n = buildSessionNumbering(rows);
    expect(n.displayNumber(1)).toBeNull(); // 오프닝
    expect(n.displayNumber(6)).toBeNull(); // 클로징
  });

  it("입력 순서가 뒤섞여도 number 로 정렬해 센다", () => {
    const shuffled = [rows[4], rows[1], rows[5], rows[3], rows[0], rows[2]];
    const n = buildSessionNumbering(shuffled);
    expect(n.displayNumber(2)).toBe(1);
    expect(n.displayNumber(4)).toBe(2);
  });

  it("없는 번호는 null", () => {
    expect(buildSessionNumbering(rows).displayNumber(99)).toBeNull();
  });
});

describe("sessionKicker", () => {
  it("유형별 영문 종류를 쓴다", () => {
    expect(sessionKicker("opening", null)).toBe("Opening");
    expect(sessionKicker("closing", null)).toBe("Closing");
    expect(sessionKicker("break", null)).toBe("Break");
    expect(sessionKicker("qa", null)).toBe("Q&A");
  });

  it("실제 세션은 표시번호를 붙인다", () => {
    expect(sessionKicker("session", 3)).toBe("Session 3");
  });

  it("표시번호가 없으면 번호를 안 붙인다 — DB 원본 number 폴백이 중복 'Session 1' 을 만들었다", () => {
    expect(sessionKicker("session", null)).toBe("Session");
    expect(sessionKicker("keynote", null)).toBe("Session");
  });
});

/**
 * 2026-08-11 실제 웨비나(K-Brand LA) 구성을 그대로 태운다. 문의 목록·CSV 가 참조 키를 그대로
 * 찍어서, 세션이 4개인데 "세션 5·6" 이 보였다 — 오프닝(1)·휴식(4)이 진행 순서 번호를 차지한 만큼
 * 어긋난 값이다. 저장된 데이터는 정상이었고 표시만 틀렸다.
 */
describe("resolveSessionRef — 참조 키를 표시번호로 (오프닝·휴식·클로징은 세션이 아니다)", () => {
  const REAL_AGENDA = [
    { number: 1, type: "opening" },
    { number: 2, type: "session" },
    { number: 3, type: "session" },
    { number: 4, type: "break" },
    { number: 5, type: "session" },
    { number: 6, type: "session" },
    { number: 7, type: "closing" },
  ];
  const numbering = buildSessionNumbering(REAL_AGENDA);

  it("실제 세션 4개는 1..4 로 다시 센다 — 참조 키 2·3·5·6 이 세션 1·2·3·4 가 된다", () => {
    expect(numbering.realCount).toBe(4);
    expect(resolveSessionRef(numbering, 2)).toBe(1);
    expect(resolveSessionRef(numbering, 3)).toBe(2);
    expect(resolveSessionRef(numbering, 5)).toBe(3);
    expect(resolveSessionRef(numbering, 6)).toBe(4);
  });

  it("오프닝·휴식·클로징을 가리키면 null — 세션 배지를 그리지 않는다", () => {
    expect(resolveSessionRef(numbering, 1)).toBeNull(); // 오프닝
    expect(resolveSessionRef(numbering, 4)).toBeNull(); // 휴식
    expect(resolveSessionRef(numbering, 7)).toBeNull(); // 클로징
  });

  it("세션 미지정·삭제된 행은 null — 원본 번호로 폴백하지 않는다", () => {
    expect(resolveSessionRef(numbering, null)).toBeNull();
    expect(resolveSessionRef(numbering, undefined)).toBeNull();
    expect(resolveSessionRef(numbering, 99)).toBeNull(); // 가리키던 세션이 삭제됨
  });

  it("세션만 있는 웨비나는 참조 키와 표시번호가 같다 — 기존 웨비나 회귀 없음", () => {
    const plain = buildSessionNumbering([
      { number: 1, type: "session" },
      { number: 2, type: "session" },
    ]);
    expect(resolveSessionRef(plain, 1)).toBe(1);
    expect(resolveSessionRef(plain, 2)).toBe(2);
  });
});

describe("cleanSessionText", () => {
  it("String(null) 오염값을 걸러낸다", () => {
    expect(cleanSessionText("null")).toBe("");
    expect(cleanSessionText("undefined")).toBe("");
    expect(cleanSessionText("  null  ")).toBe("");
  });

  it("정상 값은 트림만", () => {
    expect(cleanSessionText("  홍길동 ")).toBe("홍길동");
    expect(cleanSessionText(null)).toBe("");
  });
});
