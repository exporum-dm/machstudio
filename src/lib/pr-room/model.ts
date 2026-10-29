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
}

export interface PressRelease {
  id: string;
  type: "advance" | "opening" | "closing" | "statement";
  title: string;
  body: string;
  updatedAt: string;
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
