/**
 * 이벤트 택소노미 — 이벤트 이름 규칙의 모양과 검증.
 *
 * 시트에 둘 때는 "사람이 지키는 규칙" 이었다. 여기 두면 화면이 형식을 강제한다:
 * 이름은 GA4 규칙(소문자·숫자·밑줄, 문자로 시작, 40자)대로만 들어간다 — 대문자·띄어쓰기가 섞이면
 * GA4 에서 다른 이벤트로 갈라져 집계가 쪼개진다.
 *
 * machstudio 등록 폼은 이미 이벤트를 보낸다(lib/collect-form/mount.ts track). 그 목록을
 * BUILTIN_EVENTS 로 같이 보여 준다 — GTM 을 짜는 사람이 코드를 열어 보지 않아도 되게.
 */

export interface TaxonomyParameter {
  key: string;
  description: string;
  example: string;
}

export const TAXONOMY_PLATFORMS = ["GA4", "GTM", "Meta", "Google Ads", "LinkedIn", "TikTok"] as const;
export const TAXONOMY_STATUS_LABEL = { active: "사용 중", deprecated: "사용 안 함" } as const;

/** GA4 이벤트 이름 규칙 — 문자로 시작, 소문자·숫자·밑줄, 40자 이하. */
export const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** 사람이 친 이름을 규칙에 맞게 다듬는다(대문자→소문자, 공백·하이픈→밑줄). 그래도 안 맞으면 저장 거부. */
export function toEventName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normalizeParameters(raw: unknown): TaxonomyParameter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 25)
    .map((p) => {
      const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      return { key: toEventName(str(o.key, 40)), description: str(o.description, 300), example: str(o.example, 200) };
    })
    .filter((p) => p.key);
}

export interface TaxonomyData {
  name: string;
  category: string;
  description: string;
  trigger: string;
  parameters: TaxonomyParameter[];
  platforms: string[];
  status: "active" | "deprecated";
}

/** 입력 검증. partial 이면 들어온 키만 돌려준다(PATCH). */
export function normalizeTaxonomyInput(
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {},
): { data: Partial<TaxonomyData> } | { error: string } {
  const data: Partial<TaxonomyData> = {};
  if (!opts.partial || body.name !== undefined) {
    const name = toEventName(str(body.name, 60));
    if (!EVENT_NAME_RE.test(name)) return { error: "이벤트 이름은 영문 소문자로 시작하고 소문자·숫자·밑줄(_)만, 40자까지 쓸 수 있어요" };
    data.name = name;
  }
  if (!opts.partial || body.category !== undefined) data.category = str(body.category, 60);
  if (!opts.partial || body.description !== undefined) data.description = str(body.description, 1000);
  if (!opts.partial || body.trigger !== undefined) data.trigger = str(body.trigger, 500);
  if (!opts.partial || body.parameters !== undefined) data.parameters = normalizeParameters(body.parameters);
  if (!opts.partial || body.platforms !== undefined) {
    data.platforms = Array.isArray(body.platforms)
      ? [...new Set(body.platforms.map((p) => str(p, 30)).filter(Boolean))].slice(0, 10)
      : [];
  }
  if (!opts.partial || body.status !== undefined) data.status = body.status === "deprecated" ? "deprecated" : "active";
  return { data };
}

/** machstudio 등록 폼이 dataLayer 로 보내는 이벤트 — 읽기 전용(코드가 정한다). */
export const BUILTIN_EVENTS: Array<{ name: string; trigger: string; parameters: string[] }> = [
  { name: "ms_form_view", trigger: "등록 폼이 화면에 보였을 때", parameters: [] },
  { name: "ms_form_start", trigger: "첫 입력을 시작했을 때", parameters: [] },
  { name: "ms_visitor_type_selected", trigger: "방문 유형(분기)을 골랐을 때", parameters: ["visitor_type"] },
  { name: "ms_form_submit", trigger: "제출 버튼을 눌렀을 때(검증 전)", parameters: ["visitor_type"] },
  { name: "ms_form_error", trigger: "입력 오류·서버 거절", parameters: ["error_code"] },
  { name: "ms_form_duplicate", trigger: "이미 등록된 이메일·전화", parameters: [] },
  { name: "generate_lead", trigger: "등록 완료(서버 저장 성공) — 전환 이벤트", parameters: ["visitor_type", "transaction_id", "ms_consent"] },
  { name: "ms_lookup_request", trigger: "등록 확인(조회) 요청", parameters: [] },
];
