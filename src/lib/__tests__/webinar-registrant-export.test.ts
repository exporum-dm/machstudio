import { describe, expect, it } from "vitest";
import {
  formatSurveyAnswer,
  isEmptySurveyAnswer,
  normalizeSurveyQuestions,
  surveyQuestionColumnLabel,
  type SurveyAnswers,
  type SurveyQuestion,
} from "@/lib/webinar-survey";
import { asQAStatus, formatQAForCell, qaStatusLabel } from "@/lib/webinar-qa";
import {
  buildRegistrantCsvTable,
  csvCell,
  serializeCsv,
  type CsvEngagement,
  type CsvQAItem,
  type CsvRegistrant,
  type RegistrantCsvInput,
} from "@/lib/webinar-registrant-csv";

/**
 * 등록자 명단 CSV 에 설문 응답·문의를 붙이는 규칙.
 *
 * 왜 규칙을 따로 잠그나: 같은 값이 **두 곳**에 그려진다 — 등록자 상세 패널(화면)과 CSV(파일).
 * 갈라지면 화면에는 "4점" 인데 파일에는 "4" 로 적혀, 운영자가 같은 응답인지 대조할 수 없다.
 * 그래서 포맷터를 공용으로 두고, 그 계약을 여기서 고정한다.
 *
 * 모양이 다른 둘을 다르게 붙인다는 결정도 함께 잠근다:
 *   · 설문 — 문항 세트 고정 → 열로 편다
 *   · 문의 — 1인 N건, 가변 → 개수 열 + 본문 한 칸
 */

const q = (patch: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id: "q1", type: "text", title: "한 줄 평", required: false, options: [], ...patch,
});

describe("설문 답변 한 칸 — 화면과 파일이 같은 문자열", () => {
  it("별점·추천지수에는 '점' 이 붙는다 — 화면 배지와 같은 표기", () => {
    expect(formatSurveyAnswer(q({ type: "rating" }), 4)).toBe("4점");
    expect(formatSurveyAnswer(q({ type: "nps" }), 9)).toBe("9점");
  });

  it("복수응답은 ', ' 로 합친다 — 등록 폼의 joinMultiValue 와 같은 구분자", () => {
    expect(formatSurveyAnswer(q({ type: "multiple" }), ["기획", "개발"])).toBe("기획, 개발");
  });

  it("주관식·객관식은 값 그대로 — 숫자로 답한 주관식에 '점' 이 붙지 않는다", () => {
    expect(formatSurveyAnswer(q({ type: "text" }), "10")).toBe("10");
    expect(formatSurveyAnswer(q({ type: "single" }), "매우 만족")).toBe("매우 만족");
  });

  /**
   * CSV 는 미응답을 **빈 칸**으로 남긴다. "미응답" 같은 글자를 넣으면 엑셀에서 빈 칸 세기로
   * 응답률을 낼 수 없고, 실제로 그렇게 적어 낸 사람과 구별되지 않는다.
   */
  it("빈 답의 판정이 한 곳에 있다 — 화면은 문항을 건너뛰고 파일은 빈 칸을 남긴다", () => {
    for (const empty of [undefined, null, "", []]) {
      expect(isEmptySurveyAnswer(empty), JSON.stringify(empty)).toBe(true);
    }
    for (const filled of [0, "0", ["기획"], "내용"]) {
      expect(isEmptySurveyAnswer(filled), JSON.stringify(filled)).toBe(false);
    }
  });

  it("0 점·'0' 은 빈 답이 아니다 — NPS 0(전혀 추천하지 않음)이 미응답으로 사라지면 안 된다", () => {
    expect(isEmptySurveyAnswer(0)).toBe(false);
    expect(formatSurveyAnswer(q({ type: "nps" }), 0)).toBe("0점");
  });
});

describe("설문 열 이름 — 열이 사라지면 답변도 안 보인다", () => {
  it("제목이 빈 문항도 순번으로 자리를 얻는다 — 초안 문항에 이미 답이 있을 수 있다", () => {
    expect(surveyQuestionColumnLabel(q({ title: "" }), 2)).toBe("문항 3");
    expect(surveyQuestionColumnLabel(q({ title: "  " }), 0)).toBe("문항 1");
  });

  it("보관 문항은 '(보관)' 으로 구분한다 — 지운 문항의 지난 답과 현재 문항을 섞지 않게", () => {
    expect(surveyQuestionColumnLabel(q({ title: "만족도", retired: true }), 0)).toBe("만족도 (보관)");
    expect(surveyQuestionColumnLabel(q({ title: "만족도" }), 0)).toBe("만족도");
  });

  /**
   * 이게 CSV 가 includeHidden 을 쓰는 근거다. 뷰어 경로로 정규화하면 보관 문항이 빠지고,
   * 그러면 이미 수집된 답변이 파일에서 조용히 사라진다.
   */
  it("보관 문항은 어드민 정규화에서만 남는다 — CSV 가 includeHidden 을 써야 하는 이유", () => {
    const raw = [
      { id: "a", type: "text", title: "지금 문항" },
      { id: "b", type: "text", title: "지운 문항", retired: true },
    ];
    expect(normalizeSurveyQuestions(raw, { includeHidden: true }).map((x) => x.id)).toEqual(["a", "b"]);
    expect(normalizeSurveyQuestions(raw).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("문의 한 칸 — 개수가 가변이라 열로 펴지 않는다", () => {
  const item = (patch: Partial<{ question: string; status: string; sessionNo: number | null }> = {}) => ({
    question: "가격 정책이 궁금합니다", status: "pending", sessionNo: null, createdAt: "2026-08-20T05:10:00.000Z", ...patch,
  });

  it("문의가 없으면 빈 문자열 — 개수 열의 0 과 짝이 맞는다", () => {
    expect(formatQAForCell([])).toBe("");
  });

  /**
   * 번호를 붙이는 이유: 질문 본문 자체에 줄바꿈이 들어갈 수 있어서, 줄바꿈만으로는
   * 어디서 다음 질문이 시작되는지 알 수 없다.
   */
  it("여러 건은 번호로 경계를 만든다 — 본문에 줄바꿈이 있어도 구분된다", () => {
    const cell = formatQAForCell([item({ question: "첫 줄\n둘째 줄" }), item({ question: "두 번째 질문" })]);
    expect(cell).toBe("1. 첫 줄\n둘째 줄\n2. 두 번째 질문");
    expect(cell.split("\n").filter((l) => /^\d+\. /.test(l))).toHaveLength(2);
  });

  it("대기 중은 태그를 적지 않는다 — 대부분이 대기라서 칸이 상태로 뒤덮인다", () => {
    expect(formatQAForCell([item({ status: "pending" })])).toBe("1. 가격 정책이 궁금합니다");
    expect(formatQAForCell([item({ status: "answered" })])).toBe("1. [답변 완료] 가격 정책이 궁금합니다");
    expect(formatQAForCell([item({ status: "dismissed" })])).toBe("1. [미채택] 가격 정책이 궁금합니다");
  });

  it("세션 번호가 있으면 함께 적는다 — 어느 세션에 대한 질문인지가 답변 준비에 필요하다", () => {
    expect(formatQAForCell([item({ sessionNo: 2, status: "answered" })]))
      .toBe("1. [세션 2 · 답변 완료] 가격 정책이 궁금합니다");
  });

  /**
   * 받는 값은 **표시번호**다(진행 순서 참조 키가 아니다). 오프닝·휴식·클로징을 가리키는 질문은
   * 호출부에서 null 로 변환돼 오므로 세션 표기 없이 나가야 한다 — 실제 장애: 세션 4개인 웨비나의
   * 파일에 "세션 5·6" 이 찍혔다(오프닝·휴식이 진행 순서 번호를 차지한 만큼 어긋난 값).
   */
  it("표시번호가 없으면 세션 표기를 아예 붙이지 않는다 — 오프닝·휴식·클로징은 세션이 아니다", () => {
    expect(formatQAForCell([item({ sessionNo: null, status: "answered" })]))
      .toBe("1. [답변 완료] 가격 정책이 궁금합니다");
  });

  it("앞뒤 공백은 떨어뜨린다 — 붙여넣은 질문의 빈 줄이 칸을 벌리지 않게", () => {
    expect(formatQAForCell([item({ question: "  질문  \n" })])).toBe("1. 질문");
  });
});

describe("문의 상태 라벨 — 세 곳이 같은 문자열을 쓴다", () => {
  it("운영 콘솔·등록자 상세·CSV 가 같은 한글 라벨을 본다", () => {
    expect(qaStatusLabel("pending")).toBe("대기 중");
    expect(qaStatusLabel("answered")).toBe("답변 완료");
    expect(qaStatusLabel("dismissed")).toBe("미채택");
  });

  /** status 는 DB 에서 String 컬럼이라 모르는 값이 들어올 수 있다(옛 데이터·직접 수정). */
  it("모르는 상태는 대기로 좁히고, 라벨은 원문을 그대로 보여준다", () => {
    expect(asQAStatus("weird")).toBe("pending");
    expect(qaStatusLabel("weird")).toBe("weird");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   명단 표 조립 — 여기서 잡는 고장은 "열이 한 칸 밀리는" 것이다.
   헤더 목록과 행 만들기가 떨어져 있으면 한쪽에만 열을 추가했을 때 값이 다른 헤더 아래로
   가는데, 파일은 정상으로 열리고 숫자도 그럴싸해서 눈으로는 못 찾는다.
   ──────────────────────────────────────────────────────────────────────────── */

const reg = (patch: Partial<CsvRegistrant> = {}): CsvRegistrant => ({
  id: "r1", name: "엄재호", phone: "01012345678", email: "a@b.com",
  company: "엑스포럼", department: null, jobTitle: null, industry: null,
  agreeMarketing: true, agreeThirdParty: false, submittedAt: "2026-08-20T05:00:00.000Z", enteredAt: null,
  memo: null, utmSource: null, utmMedium: null, utmCampaign: null,
  firstUtmSource: null, firstUtmMedium: null, firstUtmCampaign: null, referrer: null, ...patch,
});

/** answersByRegistrant 를 손으로 쓰면 객체 리터럴이 유니온으로 좁혀져 SurveyAnswers 와 안 맞는다. */
const answerMap = (
  entries: Record<string, Record<string, SurveyAnswers>>,
): Map<string, Map<string, SurveyAnswers>> =>
  new Map(Object.entries(entries).map(([regId, perSurvey]) => [regId, new Map(Object.entries(perSurvey))]));

const input = (patch: Partial<RegistrantCsvInput> = {}): RegistrantCsvInput => ({
  registrants: [reg()],
  customFields: [],
  surveys: [],
  answersByRegistrant: new Map(),
  qaByRegistrant: new Map(),
  engagementByRegistrant: new Map(),
  ...patch,
});

describe("표 모양 — 한 사람 = 한 행, 모든 줄의 칸 수가 같다", () => {
  it("등록자 수 + 헤더 1줄 — 설문 응답이 여러 개여도 행이 늘지 않는다", () => {
    const survey = { id: "s1", title: "만족도", questions: [q({ id: "q1" }), q({ id: "q2" })] };
    const table = buildRegistrantCsvTable(input({
      registrants: [reg({ id: "r1" }), reg({ id: "r2" })],
      surveys: [survey, { id: "s2", title: "사전", questions: [q({ id: "q3" })] }],
      answersByRegistrant: answerMap({ r1: { s1: { q1: "좋아요", q2: "또 올게요" }, s2: { q3: "기대됩니다" } } }),
    }));
    expect(table).toHaveLength(3); // 헤더 + 2명
  });

  /** 이 테스트가 이 모듈이 존재하는 이유다. */
  it("모든 행의 칸 수가 헤더와 같다 — 열이 한 칸 밀리면 여기서 걸린다", () => {
    const table = buildRegistrantCsvTable(input({
      registrants: [reg({ id: "r1" }), reg({ id: "r2", memo: null })],
      customFields: [{ key: "job", label: "직무" }, { key: "topic", label: "관심 주제" }],
      surveys: [
        { id: "s1", title: "만족도", questions: [q({ id: "q1" }), q({ id: "q2", type: "rating" })] },
        { id: "s2", title: "사전", questions: [q({ id: "q3" })] },
      ],
      answersByRegistrant: answerMap({ r1: { s1: { q1: "좋아요" } } }),
      qaByRegistrant: new Map([["r2", [{ question: "가격이요", status: "pending", createdAt: "2026-08-20T05:10:00.000Z" } as CsvQAItem]]]),
      engagementByRegistrant: new Map([["r1", { score: 70, watchMinutes: 42, entered: true, segment: "hot" } as CsvEngagement]]),
    }));
    const width = table[0].length;
    for (const [i, row] of table.entries()) {
      expect(row.length, `${i}번째 줄`).toBe(width);
    }
  });

  it("헤더 이름이 겹치지 않는다 — 설문 두 개에 같은 문항 제목이 있어도 구분된다", () => {
    const headers = buildRegistrantCsvTable(input({
      surveys: [
        { id: "s1", title: "만족도", questions: [q({ id: "q1", title: "한 줄 평" })] },
        { id: "s2", title: "사전 조사", questions: [q({ id: "q2", title: "한 줄 평" })] },
      ],
    }))[0];
    expect(headers).toContain("[만족도] 한 줄 평");
    expect(headers).toContain("[사전 조사] 한 줄 평");
    expect(new Set(headers).size).toBe(headers.length);
  });
});

describe("값이 제 열에 들어간다", () => {
  const survey1 = { id: "s1", title: "만족도", questions: [q({ id: "q1", title: "점수", type: "rating" as const }), q({ id: "q2", title: "한 줄 평" })] };
  const survey2 = { id: "s2", title: "사전", questions: [q({ id: "q3", title: "관심사" })] };

  const table = buildRegistrantCsvTable(input({
    registrants: [reg({ id: "r1" })],
    surveys: [survey1, survey2],
    answersByRegistrant: answerMap({ r1: { s1: { q1: 5, q2: "최고" } } }),
    qaByRegistrant: new Map([["r1", [
      { question: "가격 정책이요", status: "answered", sessionNo: 2, createdAt: "2026-08-20T05:10:00.000Z" },
      { question: "자료 공유되나요", status: "pending", createdAt: "2026-08-20T05:20:00.000Z" },
    ] as CsvQAItem[]]]),
  }));
  const cell = (header: string) => table[1][table[0].indexOf(header)];

  it("설문별 답이 각자의 열에 — 응답 안 한 설문의 열은 빈 칸", () => {
    expect(cell("[만족도] 점수")).toBe("5점");
    expect(cell("[만족도] 한 줄 평")).toBe("최고");
    expect(cell("[사전] 관심사")).toBe("");
  });

  it("문의는 개수와 본문이 짝지어 들어간다", () => {
    expect(cell("문의수")).toBe("2");
    expect(cell("문의내용")).toBe("1. [세션 2 · 답변 완료] 가격 정책이요\n2. 자료 공유되나요");
  });

  it("문의가 없는 사람은 0 과 빈 칸 — 개수와 본문이 어긋나지 않는다", () => {
    const t = buildRegistrantCsvTable(input({ registrants: [reg({ id: "zzz" })] }));
    expect(t[1][t[0].indexOf("문의수")]).toBe("0");
    expect(t[1][t[0].indexOf("문의내용")]).toBe("");
  });
});

describe("셀 인용 — 등록자가 적은 값이 엑셀에서 수식이 되면 안 된다", () => {
  it("= + - @ 로 시작하는 값은 작은따옴표로 무력화한다", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("-1")).toBe(`"'-1"`);
  });

  it("따옴표는 두 번으로, 줄바꿈은 인용 안에 그대로 — 문의 본문이 행을 깨지 않는다", () => {
    expect(csvCell('그가 "좋다" 고 했다')).toBe('"그가 ""좋다"" 고 했다"');
    expect(csvCell("첫 줄\n둘째 줄")).toBe('"첫 줄\n둘째 줄"');
  });

  it("직렬화는 모든 칸을 인용한다 — 값에 쉼표가 있어도 열이 밀리지 않는다", () => {
    expect(serializeCsv([["a", "b,c"], ["1", "2"]])).toBe('"a","b,c"\n"1","2"');
  });
});
