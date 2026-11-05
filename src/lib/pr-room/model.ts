import JSON5 from "json5";

export interface PrMention {
  id: string;
  title: string;
  url: string;
  source: string;
  channel: "press" | "sns" | "comment" | "community" | "web";
  sentiment: "positive" | "neutral" | "negative";
  status: "new" | "reviewed" | "issue" | "archived";
  riskLevel: "watch" | "attention" | "urgent" | "crisis";
  excerpt: string;
  responseNote: string;
  publishedAt: string | null;
  collectedAt: string;
  author?: string;
  metrics?: { views?:number; likes?:number; comments?:number; shares?:number; saves?:number };
  comments?: { author?:string; text:string; likes?:number }[];
  origin?: "search" | "reference" | "naver-api" | "claude" | "manual";
}

export interface ExcludedMentionRule { title:string; excerpt:string; source:string; channel:PrMention["channel"] }

/**
 * 조직이 직접 운영하는 채널(홈페이지·SNS·행사 플랫폼 등록글)인지 — "언급·반응 조사"는 제3자
 * 반응을 보는 도구라 우리가 직접 올린 글은 대상이 아니다(그건 우리가 직접 본다). URL 접두사로
 * 매칭한다 — "instagram.com/koreaexpo" 는 그 계정 글만 걸리고 "instagram.com/koreaexpo_fan"
 * 같은 남의 계정은 안 걸리도록 경계(끝 또는 "/")를 확인한다. 서버(수집기)·클라이언트(Claude
 * 조사 가져오기) 양쪽에서 쓰여서 이 파일(순수 로직, 서버 전용 의존성 없음)에 둔다.
 */
export function isOwnChannel(url: string, ownChannels: string[]): boolean {
  if (!ownChannels.length) return false;
  const normalize = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  const target = normalize(url);
  if (!target) return false;
  return ownChannels.some((c) => {
    const prefix = normalize(c);
    return !!prefix && (target === prefix || target.startsWith(`${prefix}/`));
  });
}

export interface PressRelease {
  id: string;
  /** archived = 실제로 배포·게재된 원고를 그대로 보관(생성기를 거치지 않음). */
  type: "advance" | "opening" | "closing" | "statement" | "archived";
  title: string;
  body: string;
  updatedAt: string;
  /** 언급 조사 결과에서 가져왔을 때의 출처 — 직접 작성·붙여넣기면 비워 둔다. */
  sourceUrl?: string;
  sourceOutlet?: string;
}

export interface PressAnswers {
  eventName:string; datePlace:string; organizers:string; purpose:string; highlights:string;
  audience:string; figures:string; quote:string; contact:string; nextStep:string;
}

export type ClaudeResearchMention = Pick<
  PrMention,
  "title" | "url" | "source" | "channel" | "excerpt" | "publishedAt" | "author" | "metrics" | "comments"
> & { sentiment?: PrMention["sentiment"] };

export function buildClaudeResearchPrompt({
  eventNames,
  lastCollectedAt,
  knownUrls = [],
  excludedRules = [],
  ownChannels = [],
}: {
  eventNames: string[];
  lastCollectedAt: string | null;
  knownUrls?: string[];
  excludedRules?: ExcludedMentionRule[];
  ownChannels?: string[];
}) {
  const names = eventNames.map((x) => x.trim()).filter(Boolean);
  const since = lastCollectedAt ? new Date(lastCollectedAt).toISOString().slice(0, 10) : "행사 관련 자료가 검색되는 전체 기간";
  return `웹 검색을 사용해 아래 행사의 온라인 언급을 조사해 주세요. 이 조사는 제3자(우리가 아닌 다른 사람·매체)의 반응만 찾는 것입니다.

행사명과 검색어: ${names.join(" / ")}
조사 범위: 행사 관련 자료가 검색되는 전체 기간. 마지막 수집 기준(${since}) 이전에 놓친 자료도 포함하세요.

행사명의 한글·영문·약칭·띄어쓰기 변형과 공식 해시태그를 각각 검색하고, 개최 도시·연도·주최자와 조합해 동명이벤트를 구분하세요. 뉴스, 블로그·커뮤니티, SNS·동영상 채널별로 나누어 여러 검색어로 조사하세요. 참가사·참관객·기자 등 제3자의 게시물을 찾으세요. 제목에 행사명이 없더라도 본문에서 해당 행사와의 직접 관련성을 확인하면 포함하세요.
가능하면 검증된 고유 URL 50건 이상을 목표로 하되 개수를 채우려고 자료를 만들지 마세요. 10~20건의 대표 사례에서 멈추지 말고 검색어와 채널을 바꿔 추가 조사하세요. 응답 길이가 부족하면 선택 필드와 요약을 줄이고, 배열이 잘리지 않게 완성한 뒤 다음 응답에서 기존 URL을 제외하고 계속 조사할 수 있게 하세요.

뉴스·보도자료와 공개된 Instagram, Facebook, Threads, X, LinkedIn, TikTok, YouTube, 블로그·커뮤니티를 행사명 정확 일치 위주로 검색하세요. 행사와 직접 관련되지 않은 동명이벤트와 일반적인 엑스포·축제 자료는 제외하세요. 검색 결과 페이지가 아니라 실제 원문 URL만 사용하고, 확인하지 못한 제목·작성자·날짜·수치는 만들지 마세요. 같은 원문의 재게시와 중복 URL은 하나만 남기세요.

**절대 포함하지 마세요 — 우리(주최 측)가 직접 올린 내용은 대상이 아닙니다:**
- 아래 "우리 채널" 목록에 해당하는 홈페이지·SNS 계정의 게시물
- 주최 측이 직접 행사를 등록한 행사 소개·티켓 플랫폼 페이지(Eventbrite, 온오프믹스, 이벤터스, tradeKorea 전시 안내 등) — 제3자가 쓴 후기·댓글이 아니라 행사 등록 정보 자체라면 제외
이미 포함했더라도 위 두 경우에 해당하면 결과에서 빼주세요.

우리 채널 목록(이 URL들과 그 하위 게시물은 전부 제외):
${ownChannels.slice(0, 50).join("\n") || "없음 — 행사 공식 홈페이지·공식 SNS 계정이 있다면 '조사 설정'에 등록해 두면 더 정확히 걸러져요."}

이미 저장된 URL(다시 내보내지 않기):
${knownUrls.slice(0, 300).join("\n") || "없음"}

이전에 무관하다고 제외한 사례(비슷한 내용도 제외):
${excludedRules.slice(0, 50).map((x) => `- [${x.channel}] ${x.title} / ${x.excerpt}`).join("\n") || "없음"}

설명이나 마크다운 없이 유효한 JSON 배열만 출력하세요. 속성명과 문자열은 반드시 큰따옴표로 감싸고, 마지막 항목 뒤에 쉼표를 넣지 마세요. 각 항목은 아래 형식입니다. channel과 sentiment는 |로 연결된 예시 중 하나의 값만 사용하세요. 날짜를 모르면 문자열이 아닌 null을 쓰고, 확인하지 못한 수치와 선택 필드는 생략하세요.
[{"title":"원문 제목","url":"https://...","source":"매체 또는 플랫폼","channel":"press|sns|comment|community|web","excerpt":"확인한 내용 요약","author":"작성자 또는 기자","publishedAt":"YYYY-MM-DD 또는 null","sentiment":"positive|neutral|negative","metrics":{"views":0,"likes":0,"comments":0,"shares":0,"saves":0},"comments":[{"author":"작성자","text":"댓글 원문","likes":0}]}]`;
}

export function parseClaudeResearch(value: string): ClaudeResearchMention[] {
  const text = value.trim();
  const fenced = [...text.matchAll(/```(?:json5?|javascript|js)?\s*\n?([\s\S]*?)```/gi)];
  const candidates = fenced.length ? fenced.map((match) => match[1].trim()) : [text];
  let parsed: unknown;
  try {
    const values = candidates.map((candidate): unknown => JSON5.parse(candidate));
    parsed = values.flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        for (const key of ["mentions", "results", "items", "data"]) {
          if (Array.isArray(object[key])) return object[key];
        }
        if (typeof object.url === "string") return [object];
      }
      throw new Error("array required");
    });
  } catch {
    throw new Error("조사 결과 형식을 읽지 못했어요. Claude의 JSON 코드 블록 전체를 복사해 주세요. 내용이 잘렸다면 Claude에 완전한 JSON 배열로 다시 출력해 달라고 요청해 주세요.");
  }
  if (!Array.isArray(parsed)) throw new Error("JSON 배열 형식이 아닙니다.");
  const rows: ClaudeResearchMention[] = [];
  const seen = new Set<string>();
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const source = typeof item.source === "string" ? item.source.trim() : "";
    const url = typeof item.url === "string" ? item.url.trim() : "";
    try {
      const parsedUrl = new URL(url);
      if (!/^https?:$/.test(parsedUrl.protocol) || seen.has(parsedUrl.href) || !title || !source) continue;
      seen.add(parsedUrl.href);
      const channels = new Set<PrMention["channel"]>(["press", "sns", "comment", "community", "web"]);
      const channel = channels.has(item.channel as PrMention["channel"]) ? item.channel as PrMention["channel"] : "web";
      const sentiment = ["positive", "neutral", "negative"].includes(String(item.sentiment)) ? item.sentiment as PrMention["sentiment"] : undefined;
      const published = typeof item.publishedAt === "string" && !Number.isNaN(new Date(item.publishedAt).getTime()) ? new Date(item.publishedAt).toISOString() : null;
      const metrics = item.metrics && typeof item.metrics === "object"
        ? Object.fromEntries(Object.entries(item.metrics).filter(([key, n]) => ["views", "likes", "comments", "shares", "saves"].includes(key) && typeof n === "number" && n >= 0))
        : undefined;
      const comments = Array.isArray(item.comments) ? item.comments.flatMap((comment) => {
        if (!comment || typeof comment !== "object" || typeof (comment as Record<string, unknown>).text !== "string") return [];
        const row = comment as Record<string, unknown>;
        return [{ text: String(row.text).trim(), ...(typeof row.author === "string" ? { author: row.author } : {}), ...(typeof row.likes === "number" && row.likes >= 0 ? { likes: row.likes } : {}) }];
      }).filter((x) => x.text).slice(0, 50) : undefined;
      rows.push({ title, url: parsedUrl.href, source, channel, excerpt: typeof item.excerpt === "string" ? item.excerpt.trim() : "", publishedAt: published, ...(typeof item.author === "string" ? { author: item.author.trim() } : {}), ...(sentiment ? { sentiment } : {}), ...(metrics && Object.keys(metrics).length ? { metrics } : {}), ...(comments?.length ? { comments } : {}) });
    } catch { continue; }
  }
  if (parsed.length && !rows.length) throw new Error("가져올 수 있는 항목이 없어요. 각 항목의 title(제목), url(원문 주소), source(매체)를 확인해 주세요.");
  return rows;
}

export const releaseLabel:Record<PressRelease["type"],string>={advance:"개최 예정",opening:"개막",closing:"성료",statement:"공식 입장",archived:"아카이브"};

/**
 * 질문 답변을 바로 문장 틀에 끼워 맞추는 매드리브스 생성기였던 buildPressRelease 를 대체한다.
 * MACH 서버에는 LLM 호출이 전혀 없어서(Resend 같은 외부 API만 연동돼 있다) 그 함수는 AI 글쓰기가
 * 아니라 고정 문장 조합이었다 — 품질이 기계적일 수밖에 없었다. "AI 웹 조사" 탭과 같은 패턴으로,
 * 여기서는 프롬프트만 만들고 실제 집필은 사용자가 연 Claude 세션에 맡긴다.
 */
export function buildPressReleasePrompt({
  type,
  answers,
  references,
}: {
  type: PressRelease["type"];
  answers: PressAnswers;
  references: PressRelease[];
}) {
  const label = releaseLabel[type];
  const facts = [
    `행사명: ${answers.eventName.trim()}`,
    `일시·장소: ${answers.datePlace.trim()}`,
    `주최·주관: ${answers.organizers.trim()}`,
    `핵심 메시지: ${answers.purpose.trim()}`,
    answers.highlights.trim() && `주요 프로그램·내용: ${answers.highlights.trim()}`,
    answers.audience.trim() && `대상: ${answers.audience.trim()}`,
    answers.figures.trim() && `공개 가능한 수치·성과: ${answers.figures.trim()}`,
    answers.quote.trim() && `인용할 관계자 발언: ${answers.quote.trim()}`,
    answers.nextStep.trim() && `향후 계획: ${answers.nextStep.trim()}`,
    answers.contact.trim() && `언론 문의처: ${answers.contact.trim()}`,
  ].filter(Boolean).join("\n");
  const refText = references.length
    ? references.slice(0, 3).map((r, i) => `--- 참고 보도자료 ${i + 1}${r.sourceOutlet ? ` (${r.sourceOutlet} 게재)` : ""} ---\n${r.body.slice(0, 1500)}`).join("\n\n")
    : "없음 — 일반적인 국문 보도자료 형식(제목, 리드 문단, 본문, 문의처)을 따르세요.";
  return `아래 사실관계로 ${label} 보도자료를 작성해 주세요. 확인된 사실만 쓰고, 추측이나 과장된 수식어는 넣지 마세요.

[사실관계]
${facts}

[참고 — 과거에 실제로 배포한 보도자료. 톤·문장 구조만 참고하고 사실관계는 반드시 위 것만 쓰세요]
${refText}

제목 한 줄, 빈 줄, 그다음 본문 순서로 평문만 출력하세요. 마크다운 기호나 설명 문구 없이 보도자료 본문만 주세요.`;
}

export function analyzeMention(title: string) {
  const negative = /(논란|비판|항의|불만|환불|취소|사고|피해|오류|중단|사과|위기|부실)/i.test(title);
  const positive = /(호평|성황|성료|수상|돌파|성공|확대|최대|기대|인기)/i.test(title);
  return {
    sentiment: negative ? "negative" : positive ? "positive" : "neutral",
    status: negative ? "issue" : "new",
    riskLevel: negative ? "attention" : "watch",
  } as const;
}
