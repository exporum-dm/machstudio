import "server-only";
/**
 * 번역 초안을 **모델에게 받아 온다.** 계약과 파싱은 `translation-draft.ts`(순수 모듈)에 있다.
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────
 * 상세페이지는 번역 칸이 50~100개다(히어로·소개·추천 대상·프로그램·혜택·참여 방법·FAQ·주최).
 * 언어를 하나 더할 때마다 그걸 전부 손으로 쓰는 건 현실적이지 않고, 그 부담 때문에 번역을
 * 미루면 "하나를 만들어 여러 언어에 쓴다" 는 기능이 그냥 안 쓰이게 된다.
 *
 * ── 왜 순서·개수를 검증하나 ───────────────────────────────────────────
 * 번역을 한 번에 묶어 보내고 배열로 받는다. 모델이 칸 하나를 빼먹거나 합치면 그 뒤가 **한 칸씩
 * 밀려** 엉뚱한 자리에 들어가고, 그건 화면에서 찾기 가장 어려운 종류의 오류다(제목 자리에
 * FAQ 답이 들어가 있어도 번역을 모르는 사람은 알 수 없다). 그래서 모델에 **id 를 함께 적게
 * 하고**, 돌아온 id 가 보낸 것과 다르면 그 칸을 버린다(`parseDraftResponse`).
 *
 * `ANTHROPIC_API_KEY` 가 있을 때만 켜진다(worklog-ai 와 같은 규칙). 키는 서버에서만 쓴다.
 */
import {
  DRAFT_MAX_ITEMS,
  parseDraftResponse,
  type DraftRequestItem,
  type DraftResultItem,
} from "@/lib/translation-draft";

export function translationDraftAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const LANGUAGE_NAMES: Record<string, string> = {
  ko: "Korean (한국어)",
  ja: "Japanese (日本語)",
  en: "English",
  fr: "French (Français)",
};

function languageName(locale: string): string {
  return LANGUAGE_NAMES[locale] ?? locale;
}

const SYSTEM = [
  "You translate marketing copy for event landing pages and registration forms.",
  "",
  "Rules:",
  "- Translate ONLY the text. Keep the meaning, tone, and register of the source.",
  "- These are UI strings on a live page. Keep them about the same length as the source —",
  "  a label that doubles in length breaks the layout. Button labels and field labels must stay short.",
  "- Preserve line breaks exactly. A field with 2 lines must come back with 2 lines.",
  "- Do NOT translate proper nouns (company names, brand names, product names, venue names).",
  "- Do NOT add explanations, quotes, or markdown. Return the translation only.",
  "- If a string is already in the target language or is a proper noun that needs no change,",
  "  return it unchanged.",
  "",
  'Return JSON: {"items":[{"id":"<the id you were given>","text":"<translation>"}]}',
  "Return one entry for EVERY id you were given, in the same order. The id must match exactly.",
].join("\n");

/**
 * 초안을 받아 온다. 실패하면 던진다 — 라우트가 사용자에게 보여 줄 문구로 바꾼다.
 *
 * 돌아온 값 중 **보낸 id 와 짝이 맞는 것만** 남긴다. 모델이 id 를 바꾸거나 빼먹으면 그 칸은
 * 비어 있는 채로 남고, 운영자는 진행률로 그 사실을 본다 — 엉뚱한 자리에 들어가는 쪽이
 * 훨씬 나쁘다.
 */
export async function draftTranslations(input: {
  items: DraftRequestItem[];
  /** 원문 언어. */
  from: string;
  /** 번역할 언어. */
  to: string;
  /** 이 산출물이 무엇인지 — "웨비나 상세페이지", "등록 폼". 말투를 맞추는 단서다. */
  subject?: string;
}): Promise<DraftResultItem[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("번역 초안 기능이 꺼져 있어요(ANTHROPIC_API_KEY 미설정).");

  const items = input.items.filter((i) => i.base.trim()).slice(0, DRAFT_MAX_ITEMS);
  if (items.length === 0) return [];

  const user = [
    `Translate from ${languageName(input.from)} to ${languageName(input.to)}.`,
    input.subject ? `These strings appear on: ${input.subject}.` : "",
    "",
    JSON.stringify({ items: items.map((i) => ({ id: i.id, context: i.context, text: i.base })) }, null, 1),
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.TRANSLATION_DRAFT_MODEL || "claude-sonnet-5-5",
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
    // 55초 — Vercel 함수 한도 안에서 끝나야 한다. 칸이 많으면 라우트가 나눠 부른다.
    signal: AbortSignal.timeout(55_000),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? `번역 초안 응답 오류(${res.status})`);

  const text: string = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");

  return parseDraftResponse(text, items);
}
