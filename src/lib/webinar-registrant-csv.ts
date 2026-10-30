/**
 * 등록자 명단 CSV 조립 — 열 정의와 행 만들기를 **한 곳에** 둔다.
 *
 * 왜 라우트에서 빼냈나: 열이 다섯 묶음(고정 · 커스텀 필드 · 설문 문항 · 문의 · UTM/점수)인데
 * 헤더 목록과 행 만들기가 떨어져 있어서, 한쪽에만 열을 추가하면 **값이 다른 헤더 아래로
 * 한 칸씩 밀린다**. 파일은 정상으로 열리고 숫자도 그럴싸해서 눈으로는 못 찾는다.
 * 여기서는 열마다 헤더와 값을 짝지어 정의하므로 어긋날 방법이 없고, 테스트가 그걸 지킨다.
 *
 * 값은 전부 문자열로 만든다 — 셀 인용(csvCell)은 호출부가 담당한다.
 */
import { formatKstDateTime } from "@/lib/datetime";
import { parseMemo } from "@/lib/webinar-memo";
import { SEGMENT_LABEL, type Segment } from "@/lib/webinar-scoring";
import {
  formatSurveyAnswer,
  isEmptySurveyAnswer,
  surveyQuestionColumnLabel,
  type SurveyAnswers,
  type SurveyQuestion,
} from "@/lib/webinar-survey";
import { formatQAForCell } from "@/lib/webinar-qa";

/** 명단에 실리는 등록자 — 라우트의 select 와 같은 모양(필요한 것만). */
export interface CsvRegistrant {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  department: string | null;
  jobTitle: string | null;
  industry: string | null;
  agreeMarketing: boolean;
  agreeThirdParty: boolean;
  submittedAt: Date | string;
  enteredAt: Date | string | null;
  memo: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmCampaign: string | null;
  referrer: string | null;
}

export interface CsvSurveyColumn {
  id: string;
  title: string;
  questions: SurveyQuestion[];
}

export interface CsvQAItem {
  question: string;
  status: string;
  /**
   * 표시번호(실제 세션만 1..N) — DB 의 진행 순서 참조 키가 아니다.
   * 호출부가 resolveSessionRef 로 변환해 넣는다. 오프닝·휴식·클로징이면 null(세션 표기 없음).
   */
  sessionNo?: number | null;
  createdAt: Date | string;
}

export interface CsvEngagement {
  score: number;
  watchMinutes: number;
  entered: boolean;
  segment: Segment;
  /** 공유 버튼을 누른 횟수 */
  shares: number;
  /** 이 사람의 추천 링크로 실제 등록한 사람 수 */
  referrals: number;
}

export interface RegistrantCsvInput {
  registrants: CsvRegistrant[];
  /** 등록폼 커스텀 필드 정의(시스템 필드 제외) — 헤더 순서를 정한다. */
  customFields: { key: string; label: string }[];
  /** 설문 정의. 문항은 보관(retired)까지 포함해야 이미 받은 답이 파일에서 사라지지 않는다. */
  surveys: CsvSurveyColumn[];
  /** registrationId → surveyId → answers */
  answersByRegistrant: Map<string, Map<string, SurveyAnswers>>;
  /** registrationId → 문의 목록(오래된 순) */
  qaByRegistrant: Map<string, CsvQAItem[]>;
  /** registrationId → 참여 점수·세그먼트 */
  engagementByRegistrant: Map<string, CsvEngagement>;
}

/** 한 열 = 헤더 하나 + 값 하나. 짝을 강제하는 게 이 타입의 존재 이유다. */
interface Column {
  header: string;
  value: (r: CsvRegistrant) => string;
}

function fixedColumns(engagementByRegistrant: Map<string, CsvEngagement>): Column[] {
  // KST 고정 — new Date().toLocaleString("ko-KR") 은 timeZone 이 없어 이 코드가 도는
  // 서버(Vercel, TZ=UTC) 기준 시각이 나온다. 화면(RegistrantsTab)은 formatKst 를 쓰므로
  // 같은 등록자의 등록일이 화면과 CSV 에서 9시간 어긋나 보였다.
  const localDateTime = (v: Date | string | null) => (v ? formatKstDateTime(v) : "");
  return [
    { header: "이름", value: (r) => r.name },
    { header: "연락처", value: (r) => r.phone ?? "" },
    { header: "이메일", value: (r) => r.email ?? "" },
    { header: "회사", value: (r) => r.company ?? "" },
    { header: "부서", value: (r) => r.department ?? "" },
    { header: "직함", value: (r) => r.jobTitle ?? "" },
    { header: "업종", value: (r) => r.industry ?? "" },
    { header: "마케팅동의", value: (r) => (r.agreeMarketing ? "Y" : "N") },
    // 쓰는 웨비나만 있는 항목이라 끈 웨비나에서는 전원 N 으로 나간다 — agreeMarketing 과
    // 같은 고정 열로 둔다(사용 여부로 열 자체를 뺐다 붙였다 하면 과거에 받은 동의가
    // 파일에서 조용히 사라진 것처럼 보인다).
    { header: "제3자제공동의", value: (r) => (r.agreeThirdParty ? "Y" : "N") },
    {
      // 참여점수와 같은 소스(실제 시청 구간 합)를 쓴다 — DB 원본 stayMinutes 는
      // leave 이벤트를 못 받은 시청자(탭 강제종료 등)에게 0 으로 남아 한 행 안에서 값이 어긋난다.
      header: "접속시간(분)",
      value: (r) => String(engagementByRegistrant.get(r.id)?.watchMinutes ?? 0),
    },
    { header: "등록일", value: (r) => localDateTime(r.submittedAt) },
    { header: "입장일", value: (r) => localDateTime(r.enteredAt) },
  ];
}

function surveyColumns(surveys: CsvSurveyColumn[], answersByRegistrant: RegistrantCsvInput["answersByRegistrant"]): Column[] {
  return surveys.flatMap((survey) =>
    survey.questions.map((question, index) => ({
      // 설문이 여러 개일 수 있어 열 이름에 설문 제목을 접두로 둔다 — 문항 제목만으로는
      // 만족도 설문의 "한 줄 평" 과 사전 설문의 "한 줄 평" 을 구분할 수 없다.
      header: `[${survey.title}] ${surveyQuestionColumnLabel(question, index)}`,
      value: (r: CsvRegistrant) => {
        const answers = answersByRegistrant.get(r.id)?.get(survey.id);
        if (!answers) return ""; // 이 설문에 응답 자체가 없음
        const answer = answers[question.id];
        // 미응답은 빈 칸으로 남긴다 — "미응답" 같은 글자를 넣으면 빈 칸 세기로 응답률을
        // 낼 수 없고, 실제로 그렇게 적어 낸 사람과 구별되지 않는다.
        return isEmptySurveyAnswer(answer) ? "" : formatSurveyAnswer(question, answer);
      },
    })),
  );
}

export function buildRegistrantCsvColumns(input: RegistrantCsvInput): Column[] {
  const { customFields, surveys, answersByRegistrant, qaByRegistrant, engagementByRegistrant } = input;
  return [
    ...fixedColumns(engagementByRegistrant),
    ...customFields.map((field) => ({
      header: field.label,
      value: (r: CsvRegistrant) => {
        const value = parseMemo(r.memo).customFields[field.key];
        return value == null ? "" : String(value);
      },
    })),
    { header: "사전질문", value: (r) => parseMemo(r.memo).note },
    ...surveyColumns(surveys, answersByRegistrant),
    // 문의는 1인 N건이라 열로 펼 수 없다(개수가 데이터에 따라 달라지면 지난달 파일과 열이
    // 어긋난다) — 개수는 별 열로, 본문은 한 칸에 번호를 붙여 합친다. formatQAForCell 참고.
    { header: "문의수", value: (r) => String(qaByRegistrant.get(r.id)?.length ?? 0) },
    { header: "문의내용", value: (r) => formatQAForCell(qaByRegistrant.get(r.id) ?? []) },
    /* 어트리뷰션 열 — 라벨에 last/first 를 **명시**한다. 예전엔 "UTM소스" 라고만 써서 그게
       마지막 유입인지 최초 유입인지 파일만 보고 알 수 없었고, 최초 유입은 캠페인도 빠져 있어
       first-touch 로 성과를 볼 수 없었다(저장은 하는데 파일에 안 나갔다). */
    { header: "UTM소스(마지막유입)", value: (r) => r.utmSource ?? "" },
    { header: "UTM매체(마지막유입)", value: (r) => r.utmMedium ?? "" },
    { header: "UTM캠페인(마지막유입)", value: (r) => r.utmCampaign ?? "" },
    { header: "최초UTM소스", value: (r) => r.firstUtmSource ?? "" },
    { header: "최초UTM매체", value: (r) => r.firstUtmMedium ?? "" },
    { header: "최초UTM캠페인", value: (r) => r.firstUtmCampaign ?? "" },
    { header: "유입경로(referrer)", value: (r) => r.referrer ?? "" },
    { header: "참여점수", value: (r) => { const e = engagementByRegistrant.get(r.id); return e ? String(e.score) : ""; } },
    {
      header: "세그먼트",
      value: (r) => {
        const e = engagementByRegistrant.get(r.id);
        return e ? (e.entered ? SEGMENT_LABEL[e.segment] : SEGMENT_LABEL.noShow) : "";
      },
    },
    /* 입소문 — "누가 우리 웨비나를 퍼뜨렸나". 화면(분석 탭)은 상위 8명만 보여주므로
       전수 명단은 이 두 열이 유일한 경로다. */
    { header: "공유횟수", value: (r) => { const e = engagementByRegistrant.get(r.id); return e ? String(e.shares) : ""; } },
    { header: "데려온등록자", value: (r) => { const e = engagementByRegistrant.get(r.id); return e ? String(e.referrals) : ""; } },
  ];
}

/** 헤더 한 줄 + 등록자 한 명당 한 줄. 모든 줄의 칸 수가 같다는 게 이 함수의 계약이다. */
export function buildRegistrantCsvTable(input: RegistrantCsvInput): string[][] {
  const columns = buildRegistrantCsvColumns(input);
  return [columns.map((c) => c.header), ...input.registrants.map((r) => columns.map((c) => c.value(r)))];
}

/**
 * CSV 수식 인젝션 방어 — 셀 첫 문자가 = + - @ 또는 선행 TAB/CR 이면 작은따옴표로 무력화한 뒤
 * 인용/이스케이프. 등록자가 적은 값(이름·문의 본문)이 엑셀에서 수식으로 실행되면 안 된다.
 */
export function csvCell(cell: unknown): string {
  const s = String(cell);
  const neutralized = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export function serializeCsv(table: string[][]): string {
  return table.map((row) => row.map(csvCell).join(",")).join("\n");
}
