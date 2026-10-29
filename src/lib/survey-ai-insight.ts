import "server-only";
/**
 * 만족도 조사 AI 해석 — "결과 분석" 탭의 규칙 기반 인사이트(survey-config.ts 의 surveyInsights)로는
 * 못 잡는 것을 채운다. 규칙 기반은 미리 정한 몇 가지 축(유형별·워크인 vs 등록자·응답률)만 비교해서
 * 패턴이 다 비슷한 모양이 된다 — 실제 분석가는 문항 전체·주관식 답변·채널까지 같이 읽고 "이번 조사가
 * 전체적으로 무엇을 말하는지"를 한 번에 판단한다. 그 역할을 여기서 AI 에게 맡긴다.
 *
 * ANTHROPIC_API_KEY 가 있을 때만 켜진다(worklog-ai.ts 와 같은 패턴). 저장하지 않고 매번 새로 해석한다
 * — 등록·응답이 계속 쌓이므로 캐시하면 "어제 해석"이 오늘도 걸려 있게 된다.
 */
import { localize, type Localized } from "@/lib/collect-form-config";
import type { AudienceRow, Insight } from "@/lib/registration-analysis";
import { avgScore, scoreQuestions, summarizeSurvey, type SurveyConfig, type SurveyInsightResponse } from "@/lib/survey-config";

export function surveyAiAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface SurveyAiResponse extends SurveyInsightResponse {
  /** 들어온 경로(?src=qr / newsletter …) — SurveyResponse.channel */
  channel: string;
}

export interface SurveyAiInput {
  surveyName: string;
  registrantsTotal: number;
  config: SurveyConfig;
  responses: SurveyAiResponse[];
  /** 등록 분석이 이미 계산한 유형별 등록·방문율 — AI 가 교차해서 읽는다. */
  audienceRows: AudienceRow[];
  /** 등록 분석의 "내년에 써먹을 인사이트" 상위 몇 개 — 이미 알려진 사실을 또 말하지 않게 맥락으로 준다. */
  registrationInsights: Insight[];
}

export interface SurveyAiResult {
  /** 2~4문장 총평 — 이번 조사가 전체적으로 뜻하는 것. */
  summary: string;
  insights: Insight[];
}

function groupScores(
  responses: SurveyAiResponse[],
  keyOf: (r: SurveyAiResponse) => string,
  qs: ReturnType<typeof scoreQuestions>,
  questionLabel: (q: ReturnType<typeof scoreQuestions>[number]) => string,
) {
  const groups = new Map<string, SurveyAiResponse[]>();
  for (const r of responses) {
    const k = (keyOf(r) || "").trim() || "(없음)";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([group, rs]) => ({
      group,
      count: rs.length,
      scores: qs.map((q) => ({ question: questionLabel(q), average: avgScore(rs, q) })).filter((s) => s.average !== null),
    }))
    .filter((g) => g.count > 0);
}

const SYSTEM = `너는 전시회·행사 운영 데이터를 읽고 사장님께 보고하는 분석가다. "결과 분석" 탭에 들어갈
만족도 조사 해석을 쓴다. 문항별 숫자(분포·평균·NPS)는 다른 화면에 이미 있다 — 그 숫자를 그대로
옮기지 말고, 여러 자료를 엮어서 **이게 무엇을 뜻하는지**와 **내년에 뭘 다르게 하면 되는지**를 써라.

원칙
1. summary 는 2~4문장으로 이번 조사 전체가 말하는 한 가지 핵심 줄거리를 짚는다(예: "전반적으로 만족도는
   높지만 특정 집단만 낮다" 또는 "만족도는 높은데 추천 의향은 낮다" 처럼 숫자들을 엮은 하나의 그림).
2. insights 는 3~6개. **서로 다른 종류의 관찰을 섞어라** — 같은 모양("A 유형이 B보다 높다/낮다")을
   두 번 이상 쓰지 않는다. 쓸 수 있는 관점: 전체 총평과 그 이유 추정, 유형·채널별 격차(등록 데이터와
   교차), 주관식 답변에서 반복되는 주제나 구체적인 인용, 문항 사이의 관계(예: 특정 문항 점수가 낮은데
   다른 문항은 높다면 그 괴리가 뜻하는 것), 응답 신뢰도(응답률·표본). 데이터에 없는 관점은 억지로
   채우지 말고 건너뛴다 — 억지로 6개를 채우는 것보다 진짜 의미 있는 3개가 낫다.
3. 모든 insight 는 "숫자 → 그래서 무슨 뜻인지(추정이면 '~일 수 있다') → 내년에 할 일" 흐름을 담는다.
   그래프를 그대로 서술하는 문장(예: "NPS가 60점이에요")으로 끝내지 않는다.
4. 표본이 적은 비교는 쓰지 않는다. count 가 20 미만인 그룹은 비교에 쓰지 말고, 애매하면 단정 대신
   "표본이 적어 단정하기는 어렵지만" 으로 조건을 단다.
5. 숫자를 지어내지 않는다 — 준 데이터에 있는 값만 인용한다. 주관식 인용은 texts 배열에 있는 문장을
   그대로 짧게 발췌한다(지어내지 않는다).
6. 한국어, 사장님이 바로 읽을 수 있는 말투(개조식 아님, 짧은 문장).

출력은 JSON 하나만(설명·코드블록 없이):
{"summary":"...", "insights":[{"tone":"good"|"warn"|"info","title":"한 줄 결론","detail":"근거+해석+다음 해 액션"}]}`;

export async function interpretSurveyWithAi(input: SurveyAiInput): Promise<SurveyAiResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI 키가 없어요");
  const { surveyName, registrantsTotal, config, responses, audienceRows, registrationInsights } = input;
  if (responses.length === 0) return { summary: "", insights: [] };

  const loc = (x: Localized) => localize(x, config.defaultLocale);
  const qs = scoreQuestions(config);
  const summaries = summarizeSurvey(config, responses).filter((q) => q.answered > 0);
  const registered = responses.filter((r) => r.recordId).length;

  const payload = {
    survey: surveyName,
    totalResponses: responses.length,
    registeredResponses: registered,
    walkInResponses: responses.length - registered,
    registrantsTotal,
    responseRatePercent: registrantsTotal ? Math.round((registered / registrantsTotal) * 1000) / 10 : null,
    // 문항 전체 — 점수형(평균·NPS·분포)뿐 아니라 단일·복수선택 분포, 주관식 최근 답(이미 PII 제외됨)까지.
    questionSummaries: summaries,
    byAudience: groupScores(responses, (r) => r.audience, qs, (q) => loc(q.title)),
    byChannel: groupScores(responses, (r) => r.channel, qs, (q) => loc(q.title)),
    registrationSideContext: {
      audienceVisitRates: audienceRows.map((r) => ({
        audience: r.value,
        registrants: r.regs,
        preRegVisitRatePercent: Math.round(r.showUpPre.rate * 1000) / 10,
      })),
      // 등록 분석이 이미 찾아낸 것 — AI 가 같은 말을 또 하지 않게.
      alreadyKnown: registrationInsights.slice(0, 8).map((i) => i.title),
    },
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.SURVEY_AI_MODEL || "claude-sonnet-5-5",
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: "user", content: `다음은 "${surveyName}" 만족도 조사 결과와 등록 분석 데이터야. 위 원칙대로 JSON 하나로 해석해줘.\n\n${JSON.stringify(payload)}` }],
    }),
    signal: AbortSignal.timeout(55_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? `AI 응답 오류(${res.status})`);
  const text: string = (data?.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("AI 응답을 읽지 못했어요");
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { summary?: unknown; insights?: unknown };

  const insights: Insight[] = Array.isArray(parsed.insights)
    ? (parsed.insights as Array<Record<string, unknown>>)
        .filter((i) => typeof i.title === "string" && typeof i.detail === "string")
        .slice(0, 8)
        .map((i) => ({
          tone: i.tone === "good" || i.tone === "warn" ? (i.tone as "good" | "warn") : "info",
          title: (i.title as string).slice(0, 200),
          detail: (i.detail as string).slice(0, 700),
        }))
    : [];
  return { summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 800) : "", insights };
}
