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
  origin?: "search" | "reference" | "naver-api";
}

export interface ExcludedMentionRule { title:string; excerpt:string; source:string; channel:PrMention["channel"] }

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

export const releaseLabel:Record<PressRelease["type"],string>={advance:"개최 예정",opening:"개막",closing:"성료",statement:"공식 입장",archived:"아카이브"};

export function buildPressRelease(type:PressRelease["type"],a:PressAnswers){
  const name=a.eventName.trim()||"행사";const label=releaseLabel[type];
  const title=type==="statement"?`${name}, 관련 공식 입장 발표`:`${name}, ${label}…${a.purpose.trim()||"주요 소식 공개"}`;
  const lead=type==="advance"?`${a.organizers}는 ${a.datePlace}에 ‘${name}’을 개최한다고 밝혔다.`:type==="opening"?`${a.organizers}가 주최하는 ‘${name}’이 ${a.datePlace}에 개막했다.`:type==="closing"?`‘${name}’이 ${a.datePlace} 일정을 마치고 성료했다.`:`${a.organizers}는 ‘${name}’과 관련해 다음과 같이 공식 입장을 밝혔다.`;
  const paragraphs=[lead,a.purpose&&`이번 ${type==="statement"?"입장 발표":"행사"}의 핵심은 ${a.purpose.trim()}이다.`,a.highlights&&`주요 내용은 ${a.highlights.trim()}이다. ${a.audience?`${a.audience.trim()}을 대상으로 마련됐다.`:""}`,a.figures&&`확인된 주요 성과와 수치는 ${a.figures.trim()}이다.`,a.quote&&`관계자는 “${a.quote.trim().replace(/^“|”$/g,"")}”라고 말했다.`,a.nextStep&&`향후 ${a.nextStep.trim()}을 추진할 계획이다.`,a.contact&&`문의: ${a.contact.trim()}`].filter(Boolean);
  return{title,body:`[보도자료] ${title}\n\n${paragraphs.join("\n\n")}`};
}

export function isCollectionDue(room: { collectEveryDays: number; lastCollectedAt: Date | string | null }, now = new Date()) {
  if (!room.lastCollectedAt) return true;
  return now.getTime() - new Date(room.lastCollectedAt).getTime() >= Math.max(1, room.collectEveryDays) * 86_400_000;
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
