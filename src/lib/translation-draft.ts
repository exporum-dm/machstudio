/**
 * 번역 **초안**의 계약과 응답 파싱 — 순수 모듈.
 *
 * 모델을 부르는 쪽은 `translation-draft-server.ts` 다. 둘로 나눈 이유: 파싱은 이 기능에서
 * 가장 비싼 실패("번역이 엉뚱한 칸에 들어간다")를 막는 자리라 **모델 없이 테스트돼야** 한다.
 * 서버 전용 모듈(`server-only`)은 테스트 런너가 로드할 수 없다.
 *
 * ── 초안이지 번역이 아니다 ────────────────────────────────────────────
 * 결과는 운영자가 검토해 고치는 출발점이다. 그래서 두 가지를 지킨다:
 *  · **빈 칸만** 채운다 — 사람이 적어 둔 글은 절대 덮지 않는다(화면이 지킨다).
 *  · 돌려줄 때 어느 칸이 초안인지 알려 준다(화면이 배지를 달아 검토를 유도한다).
 */

/** 한 칸 — 호출부가 `TranslationEntry` 에서 뽑아 넘긴다. */
export interface DraftRequestItem {
  id: string;
  /** 이 칸이 무엇인지 — "브랜드 라벨", "바이어 · 설명". 모델이 말투·길이를 맞추는 단서다. */
  context: string;
  /** 번역할 원문. */
  base: string;
}

export interface DraftResultItem {
  id: string;
  text: string;
}

/** 한 번에 보낼 칸 수 상한 — 모델 출력이 길어지면 뒤쪽이 잘려 통째로 버려진다. */
export const DRAFT_MAX_ITEMS = 80;

/**
 * 모델 응답에서 초안을 꺼낸다. **보낸 id 와 짝이 맞는 것만** 남긴다(머리말의 "순서·개수 검증").
 *
 * 순수 함수로 떼어 둔 이유: 모델을 부르지 않고 테스트할 수 있어야 한다 — 여기서 틀리면
 * 번역이 엉뚱한 칸에 들어가고, 그게 이 기능에서 가장 비싼 실패다.
 */
export function parseDraftResponse(text: string, sent: DraftRequestItem[]): DraftResultItem[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const rows = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(rows)) return [];

  // 보낸 칸만 받는다 — 모델이 지어낸 id 는 어디에도 들어갈 자리가 없다.
  const wanted = new Map(sent.map((i) => [i.id, i.base]));
  const seen = new Set<string>();
  const out: DraftResultItem[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const value = typeof r.text === "string" ? r.text : "";
    if (!id || !wanted.has(id) || seen.has(id)) continue;
    // 빈 번역은 초안이 아니다 — 칸을 비워 두면 진행률이 그 사실을 알려 준다.
    if (!value.trim()) continue;
    seen.add(id);
    out.push({ id, text: value });
  }
  return out;
}
