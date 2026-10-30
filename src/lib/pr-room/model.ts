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
  origin?: "search" | "reference" | "naver-api" | "claude";
}

export interface ExcludedMentionRule { title:string; excerpt:string; source:string; channel:PrMention["channel"] }

export interface PressRelease {
  id: string;
  type: "advance" | "opening" | "closing" | "statement";
  title: string;
  body: string;
  updatedAt: string;
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
}: {
  eventNames: string[];
  lastCollectedAt: string | null;
  knownUrls?: string[];
  excludedRules?: ExcludedMentionRule[];
}) {
  const names = eventNames.map((x) => x.trim()).filter(Boolean);
  const since = lastCollectedAt ? new Date(lastCollectedAt).toISOString().slice(0, 10) : "행사 관련 자료가 검색되는 전체 기간";
  return `웹 검색을 사용해 아래 행사의 온라인 언급을 조사해 주세요.

행사명과 검색어: ${names.join(" / ")}
조사 시작 기준: ${since}

뉴스·보도자료와 공개된 Instagram, Facebook, Threads, X, LinkedIn, TikTok, YouTube, 블로그·커뮤니티를 행사명 정확 일치 위주로 검색하세요. 행사와 직접 관련되지 않은 동명이벤트와 일반적인 엑스포·축제 자료는 제외하세요. 검색 결과 페이지가 아니라 실제 원문 URL만 사용하고, 확인하지 못한 제목·작성자·날짜·수치는 만들지 마세요. 같은 원문의 재게시와 중복 URL은 하나만 남기세요.

이미 저장된 URL(다시 내보내지 않기):
${knownUrls.slice(0, 300).join("\n") || "없음"}

이전에 무관하다고 제외한 사례(비슷한 내용도 제외):
${excludedRules.slice(0, 50).map((x) => `- [${x.channel}] ${x.title} / ${x.excerpt}`).join("\n") || "없음"}

설명이나 마크다운 없이 JSON 배열만 출력하세요. 각 항목은 아래 형식입니다. 공개 확인이 안 되는 선택 필드는 생략하세요.
[{"title":"원문 제목","url":"https://...","source":"매체 또는 플랫폼","channel":"press|sns|comment|community|web","excerpt":"확인한 내용 요약","author":"작성자 또는 기자","publishedAt":"YYYY-MM-DD 또는 null","sentiment":"positive|neutral|negative","metrics":{"views":0,"likes":0,"comments":0,"shares":0,"saves":0},"comments":[{"author":"작성자","text":"댓글 원문","likes":0}]}]`;
}

export function parseClaudeResearch(value: string): ClaudeResearchMention[] {
  const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(text);
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
  return rows;
}

const releaseLabel:Record<PressRelease["type"],string>={advance:"개최 예정",opening:"개막",closing:"성료",statement:"공식 입장"};

export function buildPressRelease(type:PressRelease["type"],a:PressAnswers){
  const name=a.eventName.trim()||"행사";const label=releaseLabel[type];
  const title=type==="statement"?`${name}, 관련 공식 입장 발표`:`${name}, ${label}…${a.purpose.trim()||"주요 소식 공개"}`;
  const lead=type==="advance"?`${a.organizers}는 ${a.datePlace}에 ‘${name}’을 개최한다고 밝혔다.`:type==="opening"?`${a.organizers}가 주최하는 ‘${name}’이 ${a.datePlace}에 개막했다.`:type==="closing"?`‘${name}’이 ${a.datePlace} 일정을 마치고 성료했다.`:`${a.organizers}는 ‘${name}’과 관련해 다음과 같이 공식 입장을 밝혔다.`;
  const paragraphs=[lead,a.purpose&&`이번 ${type==="statement"?"입장 발표":"행사"}의 핵심은 ${a.purpose.trim()}이다.`,a.highlights&&`주요 내용은 ${a.highlights.trim()}이다. ${a.audience?`${a.audience.trim()}을 대상으로 마련됐다.`:""}`,a.figures&&`확인된 주요 성과와 수치는 ${a.figures.trim()}이다.`,a.quote&&`관계자는 “${a.quote.trim().replace(/^“|”$/g,"")}”라고 말했다.`,a.nextStep&&`향후 ${a.nextStep.trim()}을 추진할 계획이다.`,a.contact&&`문의: ${a.contact.trim()}`].filter(Boolean);
  return{title,body:`[보도자료] ${title}\n\n${paragraphs.join("\n\n")}`};
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
