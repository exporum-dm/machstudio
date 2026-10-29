/**
 * 사전등록 연동 만족도 조사 — 설정 스키마·정규화·보이는 문항·검증·집계(2026-10-20).
 *
 * 왜 사전등록에 붙이나: 인구통계(성별·연령·거주지·관심 분야·인지 경로·유형)는 사전등록 때 이미 받았다.
 * 참관객은 이메일/전화 하나로 본인 확인만 하면 **만족도 문항만** 답한다 — 조사 시간이 절반 이하로 준다.
 * 결과는 등록 정보와 이어져서 "만족도 × 연령/유형/관심 분야" 를 문항 없이도 나눠 본다.
 *
 * 구조
 *  - sections: 섹션마다 대상 유형(audiences, 비면 전원) · 문항들.
 *    대상 유형은 등록 폼의 유형 항목(audienceFieldKey, 예: visitor_type = General/Buyer/Press) 값이다.
 *  - 문항의 showIf: 같은 조사 안의 다른 문항 답에 따라 보이기(예: 메인무대 관람 = Yes 일 때만 무대 문항).
 *  - walkIn: 등록 없이 참여한 사람에게만 묻는 섹션(유형·연령 등 — 등록이 대신 해 주던 것).
 *
 * DB 를 모른다 — 화면·API·테스트가 같은 규칙을 쓴다.
 */
import { localize, toLocalized, type CollectField, type CollectFormConfig, type Localized } from "@/lib/collect-form-config";
import type { Insight } from "@/lib/registration-analysis";

export type SurveyQuestionType = "single" | "multiple" | "scale" | "nps" | "grid" | "short" | "long";
export const SURVEY_QUESTION_TYPES: SurveyQuestionType[] = ["single", "multiple", "scale", "nps", "grid", "short", "long"];
export const SURVEY_QUESTION_TYPE_LABEL: Record<SurveyQuestionType, string> = {
  single: "단일 선택",
  multiple: "복수 선택",
  scale: "점수(1~5)",
  nps: "추천 점수(0~10)",
  grid: "항목별 점수표",
  short: "짧은 답",
  long: "긴 답",
};

export interface SurveyQuestion {
  id: string;
  /** 응답 저장 키 — 한 번 받은 뒤로 바꾸지 않는다(이미 들어온 응답과 어긋난다). */
  key: string;
  type: SurveyQuestionType;
  title: Localized;
  description: Localized;
  required: boolean;
  /** single·multiple 의 선택지 */
  options: Localized[];
  /** single·multiple — "기타(직접 입력)" */
  allowOther: boolean;
  /** scale·nps 양 끝 설명 */
  minLabel: Localized;
  maxLabel: Localized;
  /** scale 범위(기본 1~5) */
  scaleMax: number;
  /** grid — 행(평가 항목). 열은 1~5 점 + (naOption 이면) 해당 없음 */
  rows: Localized[];
  naOption: boolean;
  /** 다른 문항 답이 이 값일 때만 보인다 */
  showIf: { key: string; value: string } | null;
  /**
   * 등록 폼 항목과 연결(그 항목의 key). 연결된 문항은 질문·선택지·유형을 **등록 폼에서 그대로** 가져온다 —
   * 사전등록 안 한 사람(walk-in)의 인구통계를 등록자와 같은 조건으로 받기 위해서다(2026-10-20).
   * 저장 key 도 등록 폼 key 와 같아서 결과에서 등록자와 한 열로 합쳐 본다.
   */
  linkKey: string;
}

export interface SurveySection {
  id: string;
  title: Localized;
  description: Localized;
  /** 대상 유형(등록 폼 유형 값). 비면 전원. */
  audiences: string[];
  questions: SurveyQuestion[];
}

export interface SurveyConfig {
  title: Localized;
  intro: Localized;
  /** 본인 확인 수단 — 등록 폼의 등록 확인과 같은 이메일/전화 */
  identifyFields: Array<"email" | "phone">;
  /** 등록 폼의 유형 항목 key(예: visitor_type). 비면 유형 구분 없음. */
  audienceFieldKey: string;
  /** 유형 값 → 화면에 보일 이름(예: Press → Media / Press) */
  audienceLabels: Record<string, string>;
  /** 등록 없이 참여 허용 */
  allowWalkIn: boolean;
  /** walk-in 에게만 묻는 섹션. 이 섹션에 audienceFieldKey 와 같은 key 의 문항이 있으면 그 답이 유형이 된다. */
  walkIn: SurveySection;
  sections: SurveySection[];
  completion: { title: Localized; body: Localized };
  privacyNote: Localized;
  accentColor: string;
  defaultLocale: string;
}

export interface SurveyAnswerMap {
  [key: string]: string | string[] | number | Record<string, string | number> | undefined;
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const bool = (v: unknown, d = false) => (typeof v === "boolean" ? v : d);
const KEY_RE = /^[A-Za-z0-9_]{1,60}$/;
let seq = 0;
const genId = (p: string) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}`;

function normalizeQuestion(raw: unknown, locale: string): SurveyQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = (SURVEY_QUESTION_TYPES as string[]).includes(o.type as string) ? (o.type as SurveyQuestionType) : "single";
  const linkKey = typeof o.linkKey === "string" && KEY_RE.test(o.linkKey) ? o.linkKey : "";
  const key = linkKey || (typeof o.key === "string" && KEY_RE.test(o.key) ? o.key : "");
  if (!key) return null;
  const loc = (v: unknown) => toLocalized(v, locale);
  const showIf = o.showIf && typeof o.showIf === "object"
    ? (() => { const s = o.showIf as Record<string, unknown>; return typeof s.key === "string" && s.key && typeof s.value === "string" ? { key: s.key, value: s.value } : null; })()
    : null;
  return {
    id: typeof o.id === "string" && o.id ? o.id : genId("q"),
    key,
    type,
    title: loc(o.title),
    description: loc(o.description),
    required: bool(o.required, true),
    options: Array.isArray(o.options) ? o.options.map(loc).filter((x) => Object.values(x).some((v) => v.trim())).slice(0, 60) : [],
    allowOther: bool(o.allowOther),
    minLabel: loc(o.minLabel),
    maxLabel: loc(o.maxLabel),
    scaleMax: type === "scale" ? Math.min(10, Math.max(3, Number(o.scaleMax) || 5)) : 5,
    rows: Array.isArray(o.rows) ? o.rows.map(loc).filter((x) => Object.values(x).some((v) => v.trim())).slice(0, 30) : [],
    naOption: bool(o.naOption, true),
    showIf,
    linkKey,
  };
}

function normalizeSection(raw: unknown, locale: string): SurveySection {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const questions = (Array.isArray(o.questions) ? o.questions : [])
    .map((q) => normalizeQuestion(q, locale))
    .filter((q): q is SurveyQuestion => !!q && !seen.has(q.key) && !!seen.add(q.key))
    .slice(0, 80);
  return {
    id: typeof o.id === "string" && o.id ? o.id : genId("s"),
    title: toLocalized(o.title, locale),
    description: toLocalized(o.description, locale),
    audiences: Array.isArray(o.audiences) ? o.audiences.filter((a): a is string => typeof a === "string" && !!a.trim()).slice(0, 20) : [],
    questions,
  };
}

export function normalizeSurveyConfig(raw: unknown): SurveyConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const locale = typeof o.defaultLocale === "string" && o.defaultLocale ? o.defaultLocale : "en";
  const loc = (v: unknown) => toLocalized(v, locale);
  const comp = (o.completion && typeof o.completion === "object" ? o.completion : {}) as Record<string, unknown>;
  const fields = Array.isArray(o.identifyFields) ? o.identifyFields.filter((f): f is "email" | "phone" => f === "email" || f === "phone") : [];
  const labels: Record<string, string> = {};
  if (o.audienceLabels && typeof o.audienceLabels === "object") {
    for (const [k, v] of Object.entries(o.audienceLabels as Record<string, unknown>)) if (typeof v === "string") labels[k] = v.slice(0, 60);
  }
  return {
    title: loc(o.title),
    intro: loc(o.intro),
    identifyFields: fields.length ? fields : ["email", "phone"],
    audienceFieldKey: typeof o.audienceFieldKey === "string" ? o.audienceFieldKey : "",
    audienceLabels: labels,
    allowWalkIn: bool(o.allowWalkIn, true),
    walkIn: normalizeSection(o.walkIn, locale),
    sections: (Array.isArray(o.sections) ? o.sections : []).map((s) => normalizeSection(s, locale)).slice(0, 30),
    completion: { title: loc(comp.title), body: loc(comp.body) },
    privacyNote: loc(o.privacyNote),
    accentColor: /^#[0-9a-fA-F]{6}$/.test(str(o.accentColor)) ? str(o.accentColor) : "#7C3AED",
    defaultLocale: locale,
  };
}

/** 빈 조사(처음 만들 때) — 문항은 넣지 않는다. 섹션 하나와 기본 완료 문구만. */
export function emptySurveyConfig(input: { title: string; audienceFieldKey: string; locale: string }): SurveyConfig {
  return normalizeSurveyConfig({
    title: { [input.locale]: input.title },
    intro: { [input.locale]: input.locale === "ko" ? "참여해 주셔서 감사합니다. 1~2분이면 끝나요." : "Thank you for visiting! This takes about 2 minutes." },
    audienceFieldKey: input.audienceFieldKey,
    sections: [{ title: { [input.locale]: input.locale === "ko" ? "만족도" : "Your experience" }, questions: [] }],
    completion: {
      title: { [input.locale]: input.locale === "ko" ? "참여해 주셔서 감사합니다" : "Thank you!" },
      body: { [input.locale]: "" },
    },
    defaultLocale: input.locale,
  });
}

// ── 등록 폼 연결 ──────────────────────────────────────────────────────

/** 등록 폼의 항목 전부(유형 분기 그룹 항목 포함) — 연결 문항이 고를 수 있는 것. */
export function registrationFields(form: CollectFormConfig): Array<CollectField & { group: string }> {
  const out: Array<CollectField & { group: string }> = [];
  const seen = new Set<string>();
  for (const f of form.fields) if (f.enabled && !seen.has(f.key)) { seen.add(f.key); out.push({ ...f, group: "" }); }
  for (const g of form.branch.groups) for (const f of g.fields) if (f.enabled && !seen.has(f.key)) { seen.add(f.key); out.push({ ...f, group: g.value }); }
  return out;
}

/** 등록 폼 항목 → 조사 문항 유형. 동의 체크박스처럼 맞는 게 없으면 null. */
export function linkedQuestionType(field: Pick<CollectField, "type">): SurveyQuestionType | null {
  if (field.type === "radio" || field.type === "select") return "single";
  if (field.type === "multiple") return "multiple";
  if (field.type === "text" || field.type === "email" || field.type === "tel" || field.type === "number") return "short";
  return null;
}

/**
 * 연결 문항을 등록 폼 항목으로 채운다(질문·선택지·유형·필수·기타). 등록 폼에서 항목이 사라졌으면 그 문항은 뺀다.
 * 공개 화면·검증이 이 결과를 쓴다 — 등록 폼을 고치면 조사도 따라 바뀐다.
 */
export function resolveLinkedQuestions(config: SurveyConfig, form: CollectFormConfig): SurveyConfig {
  const fields = new Map(registrationFields(form).map((f) => [f.key, f]));
  const fill = (section: SurveySection): SurveySection => ({
    ...section,
    questions: section.questions.flatMap((q) => {
      if (!q.linkKey) return [q];
      const field = fields.get(q.linkKey);
      const type = field ? linkedQuestionType(field) : null;
      if (!field || !type) return [];
      return [{
        ...q,
        key: field.key,
        type,
        title: field.label,
        description: field.placeholder && type === "short" ? field.placeholder : q.description,
        required: field.required,
        options: field.options,
        allowOther: !!field.allowOther,
      }];
    }),
  });
  return { ...config, walkIn: fill(config.walkIn), sections: config.sections.map(fill) };
}

// ── 보이는 문항 · 검증 ─────────────────────────────────────────────────

const answerMatches = (answer: SurveyAnswerMap[string], value: string) =>
  Array.isArray(answer) ? answer.includes(value) : answer !== undefined && String(answer) === value;

/** 응답자 유형·지금까지의 답으로 보이는 섹션(문항까지 거른 것). walk-in 이면 walkIn 섹션이 맨 앞. */
export function visibleSections(config: SurveyConfig, audience: string, answers: SurveyAnswerMap, walkIn = false): SurveySection[] {
  const base = config.sections.filter((s) => s.audiences.length === 0 || (audience && s.audiences.includes(audience)));
  const all = walkIn && config.allowWalkIn ? [config.walkIn, ...base] : base;
  return all
    .map((s) => ({ ...s, questions: s.questions.filter((q) => !q.showIf || answerMatches(answers[q.showIf.key], q.showIf.value)) }))
    .filter((s) => s.questions.length > 0);
}

export interface SurveyIssue { key: string; message: string }

/** 제출 검증 — 보이는 문항만, 필수·형식. 통과하면 보이는 문항의 답만 남긴 깨끗한 답을 돌려준다. */
export function validateSurveyAnswers(
  config: SurveyConfig,
  audience: string,
  raw: unknown,
  walkIn = false,
): { ok: true; answers: SurveyAnswerMap } | { ok: false; issues: SurveyIssue[] } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const issues: SurveyIssue[] = [];
  const clean: SurveyAnswerMap = {};
  // 보이기 조건이 답에 기대므로 입력 그대로 한 번 보고, 거른 결과로 검증한다.
  const sections = visibleSections(config, audience, input as SurveyAnswerMap, walkIn);
  for (const q of sections.flatMap((s) => s.questions)) {
    const v = input[q.key];
    const optionValues = q.options.map((o) => localize(o, config.defaultLocale));
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
    if (empty) {
      if (q.required) issues.push({ key: q.key, message: "required" });
      continue;
    }
    switch (q.type) {
      case "single": {
        const s = str(v, 500).trim();
        if (!optionValues.includes(s) && !q.allowOther) { issues.push({ key: q.key, message: "invalid" }); break; }
        clean[q.key] = s;
        break;
      }
      case "multiple": {
        const arr = (Array.isArray(v) ? v : [v]).map((x) => str(x, 500).trim()).filter(Boolean);
        const bad = arr.filter((x) => !optionValues.includes(x));
        if (bad.length > (q.allowOther ? 1 : 0)) { issues.push({ key: q.key, message: "invalid" }); break; }
        clean[q.key] = [...new Set(arr)];
        break;
      }
      case "scale":
      case "nps": {
        const n = Number(v);
        const [min, max] = q.type === "nps" ? [0, 10] : [1, q.scaleMax];
        if (!Number.isInteger(n) || n < min || n > max) { issues.push({ key: q.key, message: "invalid" }); break; }
        clean[q.key] = n;
        break;
      }
      case "grid": {
        const obj = (typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
        const out: Record<string, string | number> = {};
        q.rows.forEach((_, i) => {
          const cell = obj[String(i)];
          if (cell === "na" && q.naOption) out[String(i)] = "na";
          else if (Number.isInteger(Number(cell)) && Number(cell) >= 1 && Number(cell) <= 5) out[String(i)] = Number(cell);
        });
        if (q.required && Object.keys(out).length < q.rows.length) { issues.push({ key: q.key, message: "required" }); break; }
        clean[q.key] = out;
        break;
      }
      case "short":
      case "long":
        clean[q.key] = str(v, q.type === "short" ? 300 : 3000).trim();
        break;
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, answers: clean };
}

// ── 집계 ──────────────────────────────────────────────────────────────

export interface QuestionSummary {
  key: string;
  type: SurveyQuestionType;
  title: string;
  answered: number;
  /** scale·nps 평균, grid 는 행별 평균 */
  average?: number;
  /** nps = 추천(9~10)% − 비추천(0~6)% */
  nps?: number;
  /** single·multiple·scale·nps — 값별 개수 */
  counts?: Array<{ label: string; count: number }>;
  /** grid — 행별 평균·응답 수 */
  rows?: Array<{ label: string; average: number | null; answered: number; na: number }>;
  /** short·long — 최근 답 */
  texts?: string[];
}

export function summarizeSurvey(config: SurveyConfig, responses: Array<{ answers: unknown }>): QuestionSummary[] {
  const L = (x: Localized) => localize(x, config.defaultLocale);
  const questions = [...config.walkIn.questions, ...config.sections.flatMap((s) => s.questions)];
  return questions.map((q) => {
    const values = responses.map((r) => ((r.answers ?? {}) as SurveyAnswerMap)[q.key]).filter((v) => v !== undefined && v !== "");
    const base: QuestionSummary = { key: q.key, type: q.type, title: L(q.title), answered: values.length };
    if (q.type === "single" || q.type === "multiple") {
      const map = new Map<string, number>(q.options.map((o) => [L(o), 0]));
      for (const v of values) for (const x of Array.isArray(v) ? v : [v]) map.set(String(x), (map.get(String(x)) ?? 0) + 1);
      return { ...base, counts: [...map.entries()].map(([label, count]) => ({ label, count })) };
    }
    if (q.type === "scale" || q.type === "nps") {
      const nums = values.map(Number).filter((n) => Number.isFinite(n));
      const [min, max] = q.type === "nps" ? [0, 10] : [1, q.scaleMax];
      const counts = Array.from({ length: max - min + 1 }, (_, i) => ({ label: String(min + i), count: nums.filter((n) => n === min + i).length }));
      const average = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : undefined;
      const nps = q.type === "nps" && nums.length
        ? Math.round(((nums.filter((n) => n >= 9).length - nums.filter((n) => n <= 6).length) / nums.length) * 100)
        : undefined;
      return { ...base, counts, average, nps };
    }
    if (q.type === "grid") {
      const rows = q.rows.map((row, i) => {
        const cells = values.map((v) => (v as Record<string, unknown>)?.[String(i)]);
        const nums = cells.map(Number).filter((n) => Number.isFinite(n) && n >= 1);
        return {
          label: L(row),
          average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null,
          answered: nums.length,
          na: cells.filter((c) => c === "na").length,
        };
      });
      return { ...base, rows };
    }
    return { ...base, texts: values.map(String).filter((t) => t.trim()).slice(-200).reverse() };
  });
}

/** 엑셀 칸에 넣을 답 문자열. */
export function answerText(q: SurveyQuestion, value: SurveyAnswerMap[string], locale: string): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (q.type === "grid" && typeof value === "object") {
    return q.rows.map((r, i) => `${localize(r, locale)}: ${(value as Record<string, unknown>)[String(i)] ?? ""}`).join(" / ");
  }
  return String(value);
}

// ── 인사이트 — "결과 분석" 탭에 등록 인사이트와 같은 자리·같은 말투로 붙는다 ────────────
const SURVEY_MIN_N = 20;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const num = (x: number) => x.toLocaleString("ko-KR");

export interface SurveyInsightInput {
  surveyName: string;
  total: number;
  registered: number;
  registrantsTotal: number;
  summaries: QuestionSummary[];
}

/** 응답률 + 점수형 문항(scale·nps) 레벨 — 표본이 작은 만족도 조사 특성상 등록 분석보다 낮은 기준(20명)을 쓴다. */
export function surveyInsights(input: SurveyInsightInput): Insight[] {
  const out: Insight[] = [];
  if (input.total === 0) return out;

  if (input.registrantsTotal >= SURVEY_MIN_N) {
    const rate = input.registrantsTotal ? input.registered / input.registrantsTotal : 0;
    const walkIn = input.total - input.registered;
    out.push({
      tone: rate >= 0.3 ? "good" : "info",
      title: `${input.surveyName}: 등록자의 ${pct(rate)}가 만족도 조사에 응답했어요`,
      detail: `등록자 ${num(input.registrantsTotal)}명 중 ${num(input.registered)}명이 응답했어요${walkIn > 0 ? ` · 등록 없이 참여 ${num(walkIn)}명` : ""}.`,
    });
  }

  for (const q of input.summaries) {
    if (q.answered < SURVEY_MIN_N) continue;
    if (q.type === "nps" && q.nps !== undefined) {
      out.push({
        tone: q.nps >= 30 ? "good" : q.nps < 0 ? "warn" : "info",
        title: `${q.title}: NPS ${q.nps}점`,
        detail: `응답 ${num(q.answered)}명 기준 — 추천(9~10점) 비율에서 비추천(0~6점) 비율을 뺀 값이에요.`,
      });
    } else if (q.type === "scale" && q.average !== undefined) {
      const scaleMax = q.counts?.length ?? 5;
      const ratio = scaleMax > 1 ? (q.average - 1) / (scaleMax - 1) : 1;
      out.push({
        tone: ratio >= 0.75 ? "good" : ratio < 0.5 ? "warn" : "info",
        title: `${q.title}: 평균 ${q.average}/${scaleMax}점`,
        detail: `응답 ${num(q.answered)}명 기준.`,
      });
    }
  }
  return out;
}

export function isSurveyStatus(v: unknown): v is "draft" | "open" | "closed" {
  return v === "draft" || v === "open" || v === "closed";
}
