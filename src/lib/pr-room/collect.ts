import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { safeFetchText } from "@/lib/brief/link-preview";
import { googleNewsUrl, parseFeed } from "@/lib/brief/sources";
import { analyzeMention, isCollectionDue, type ExcludedMentionRule, type PrMention } from "./model";

const SOCIAL_SOURCES = [
  { domain: "instagram.com", channel: "sns" as const, label: "Instagram" },
  { domain: "x.com", channel: "sns" as const, label: "X" },
  { domain: "linkedin.com", channel: "sns" as const, label: "LinkedIn" },
  { domain: "threads.net", channel: "sns" as const, label: "Threads" },
  { domain: "facebook.com", channel: "sns" as const, label: "Facebook" },
  { domain: "tiktok.com", channel: "sns" as const, label: "TikTok" },
];

interface Found {
  title: string;
  url: string;
  source: string;
  channel: PrMention["channel"];
  publishedAt: Date | null;
  excerpt: string;
  author?: string;
  metrics?: PrMention["metrics"];
  comments?: PrMention["comments"];
  origin?: PrMention["origin"];
}

function cleanText(value: string) {
  return value
    .replace(/<\/?(?:mark|b|strong|em)[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp;)?#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&(?:amp;)?#(\d+);/g, (_, x) => String.fromCodePoint(Number(x)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/\s*새 창 열림\s*/g, " ")
    .trim();
}
function decodeText(value: string) {
  return cleanText(
    value
      .replace(/&#x([0-9a-f]+);/gi, (_, x) =>
        String.fromCodePoint(parseInt(x, 16)),
      )
      .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(Number(x))),
  );
}
const compact = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9가-힣]/g, "");
export function isRelevantMention(title: string, queries: string[]) {
  const haystack = compact(title);
  return queries.some((query) => {
    const needle = compact(query);
    return needle.length >= 4 && haystack.includes(needle);
  });
}
const stopWords=new Set(["그리고","대한","관련","이번","행사","개최","뉴스","기자","에서","으로","the","and","for","with"]);
function topicTokens(value:string,queries:string[]){const ignored=new Set(queries.flatMap(q=>q.toLowerCase().normalize("NFKC").match(/[a-z0-9가-힣]+/g)??[]));return new Set((value.toLowerCase().normalize("NFKC").match(/[a-z0-9가-힣]+/g)??[]).filter(x=>x.length>1&&!/^20\d\d$/.test(x)&&!ignored.has(x)&&!stopWords.has(x)))}
export function isSimilarToExcluded(row:Pick<Found,"title"|"excerpt"|"channel">,rules:ExcludedMentionRule[],queries:string[]){const a=topicTokens(`${row.title} ${row.excerpt}`,queries);if(a.size<2)return false;return rules.some(rule=>{if(rule.channel!==row.channel)return false;const b=topicTokens(`${rule.title} ${rule.excerpt}`,queries);const common=[...a].filter(x=>b.has(x)).length,ratio=common/Math.min(a.size,b.size);return common>=3&&ratio>=.4||common>=2&&ratio>=.65})}
function metaDescription(html: string) {
  return (
    html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i,
    )?.[1] ??
    html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description/i,
    )?.[1] ??
    ""
  );
}
function meta(html:string,key:string){return decodeText(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)`,"i"))?.[1]??html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`,"i"))?.[1]??"")}
export function publicComments(html:string){const rows:NonNullable<PrMention["comments"]>=[];const seen=new Set<string>();for(const m of html.matchAll(/"text":"((?:\\.|[^"\\]){2,500})"[\s\S]{0,500}?"(?:username|uniqueId)":"([^"\\]+)"[\s\S]{0,180}?"(?:comment_like_count|diggCount)":(\d+)/g)){let text=m[1];try{text=JSON.parse(`"${text}"`)}catch{}text=cleanText(text);if(text&&!seen.has(text)){seen.add(text);rows.push({text,author:m[2],likes:Number(m[3])})}if(rows.length===20)break}return rows}
export function parseSocialPage(url: string, html: string): Found | null {
  const host = new URL(url).hostname;
  const raw = decodeText(metaDescription(html));
  if (host.includes("instagram.com")) {
    const m = raw.match(
      /^([\d,]+) likes, ([\d,]+) comments - (.+?) on (.+?):\s*["“]?([\s\S]*)/i,
    );
    const caption = (m?.[5] || raw).replace(/["”]\.?\s*$/, " ").trim();
    const date = m?.[4] ? new Date(m[4]) : null;
    return {
      title: caption.slice(0, 300) || "Instagram 게시물",
      excerpt: caption.slice(0, 2000),
      url,
      source: "Instagram",
      channel: "sns",
      publishedAt: date && !Number.isNaN(date.getTime()) ? date : null,
      author: m?.[3],
      metrics: m
        ? {
            likes: Number(m[1].replace(/,/g, "")),
            comments: Number(m[2].replace(/,/g, "")),
          }
        : undefined,
      comments: publicComments(html),
    };
  }
  if (host.includes("tiktok.com")) {
    const number = (key: string) =>
      Number(html.match(new RegExp(`"${key}":(\\d+)`))?.[1] || 0) || undefined;
    const desc = decodeText(
      (html.match(/"desc":"((?:\\.|[^"\\])*)"/)?.[1] || "")
        .replace(/\\n/g, " ")
        .replace(/\\"/g, '"'),
    );
    const created = number("createTime");
    return {
      title: desc.slice(0, 300) || "TikTok 게시물",
      excerpt: desc.slice(0, 2000),
      url,
      source: "TikTok",
      channel: "sns",
      publishedAt: created ? new Date(created * 1000) : null,
      metrics: {
        views: number("playCount"),
        likes: number("diggCount"),
        comments: number("commentCount"),
        shares: number("shareCount"),
      },
      comments: publicComments(html),
    };
  }
  return {
    title: raw.slice(0, 300) || `${host} 게시물`,
    excerpt: raw.slice(0, 2000),
    url,
    source: host.replace(/^www\./, ""),
    channel: "sns",
    publishedAt: null,
  };
}

async function enrichRows(rows:Found[]){const enriched:Found[]=[];for(let i=0;i<rows.length;i+=24){const batch=await Promise.all(rows.slice(i,i+24).map(async row=>{const r=await safeFetchText(row.url,{maxBytes:1_200_000,timeoutMs:8_000});if(!r)return row;const social=parseSocialPage(r.finalUrl,r.text);if(/instagram\.com|tiktok\.com/i.test(r.finalUrl)&&social)return{...row,...social,publishedAt:social.publishedAt??row.publishedAt};const source=meta(r.text,"og:site_name")||row.source;const author=meta(r.text,"author")||meta(r.text,"article:author")||decodeText(r.text.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i)?.[1]??"");const title=meta(r.text,"og:title")||meta(r.text,"twitter:title")||row.title;return{...row,title:cleanText(title),url:r.finalUrl,source,author:author||row.author,excerpt:metaDescription(r.text)||row.excerpt}}));enriched.push(...batch)}return enriched}

export function parseNaverNews(html: string, query = ""): Found[] {
  const rows: Found[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1], inner = match[2];
    const url = attrs.match(/href="(https?:\/\/[^"#]+)"/i)?.[1];
    const headline = inner.match(/<span[^>]+class="[^"]*(?:sds-comps-text-type-headline1|news_tit|n_title)[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? (/data-heatmap-target="\.tit"/i.test(attrs) ? inner : "");
    if (!url || !headline) continue;
    const title = cleanText(headline);
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((x) => x.length > 1);
    const relevant =
      !terms.length || terms.some((x) => title.toLowerCase().includes(x));
    if (
      !relevant ||
      title.length < 12 ||
      title.length > 300 ||
      seen.has(url) ||
      /search\.naver\.com|help\.naver\.com/.test(url)
    )
      continue;
    seen.add(url);
    rows.push({
      title,
      url,
      source: "네이버 뉴스",
      channel: "press",
      publishedAt: null,
      excerpt: "",
    });
  }
  return rows.slice(0, 50);
}

async function googleRows(
  query: string,
  channel: PrMention["channel"],
  source: string,
  days: number,
): Promise<Found[]> {
  const result = await safeFetchText(googleNewsUrl({ query, days }), {
    accept: "application/rss+xml,text/xml",
    maxBytes: 2_000_000,
    timeoutMs: 15_000,
    allow: (ct) => /xml|rss|atom/i.test(ct),
  });
  return result
    ? parseFeed(result.text, "news").map((row) => ({
        title: row.title,
        url: row.url,
        source: source === "Google 뉴스" ? row.org || source : source,
        channel,
        publishedAt: row.publishedAt,
        excerpt: "",
      }))
    : [];
}

export async function collectPrRoom(roomId: string, now = new Date()) {
  const room = await prisma.prRoom.findUnique({
    where: { id: roomId },
    include: { project: { select: { name: true } } },
  });
  if (!room) throw new Error("홍보실을 찾을 수 없어요");
  const keywords = Array.isArray(room.keywords)
    ? room.keywords.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      )
    : [];
  const queries = keywords.length ? keywords : [room.project.name];
  const excluded = new Set(Array.isArray(room.excludedMentionUrls) ? room.excludedMentionUrls.filter((x):x is string=>typeof x==="string") : []);
  const excludedRules=Array.isArray(room.excludedMentionRules)?room.excludedMentionRules.filter((x):x is ExcludedMentionRule=>Boolean(x)&&typeof x==="object"&&typeof (x as ExcludedMentionRule).title==="string"):[];
  const days = Math.max(7, room.collectEveryDays + 4);
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const tasks = queries.slice(0, 5).flatMap((query) => [
    {
      label: "Google 뉴스",
      run: () => googleRows(`"${query}"`, "press", "Google 뉴스", days),
    },
    {
      label: "네이버 뉴스",
      run: async () => {
        const url = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(query)}`;
        const r = await safeFetchText(url, {
          maxBytes: 2_000_000,
          timeoutMs: 15_000,
        });
        return r ? parseNaverNews(r.text, query) : [];
      },
    },
    ...SOCIAL_SOURCES.map((s) => ({
      label: s.label,
      run: () =>
        googleRows(`site:${s.domain} "${query}"`, s.channel, s.label, days),
    })),
  ]);
  const settled = await Promise.all(
    tasks.map(async (task) => {
      try {
        const found = (await task.run()).filter((row) =>
          isRelevantMention(row.title, queries),
        );
        counts[task.label] = (counts[task.label] ?? 0) + found.length;
        return found;
      } catch (e) {
        errors.push(
          `${task.label}: ${e instanceof Error ? e.message : String(e)}`,
        );
        return [];
      }
    }),
  );
  const rows = (await enrichRows(settled.flat())).filter(row=>!excluded.has(row.url)&&!isSimilarToExcluded(row,excludedRules,queries));
  const previous = (
    Array.isArray(room.mentions)
      ? (room.mentions as unknown as PrMention[])
      : []
  ).filter((row) => !excluded.has(row.url) && !isSimilarToExcluded(row,excludedRules,queries) && row.origin !== "reference" && isRelevantMention(`${row.title} ${row.excerpt}`, queries));
  const currentByUrl = new Map(rows.map((row) => [row.url, row]));
  const refreshed = previous.map((item) => {
    const row = currentByUrl.get(item.url);
    return row
      ? {
          ...item,
          title: row.title || item.title,
          excerpt: row.excerpt || item.excerpt,
          source: row.source,
          author: row.author ?? item.author,
          metrics: row.metrics ?? item.metrics,
          comments: row.comments?.length ? row.comments : item.comments,
          publishedAt: row.publishedAt?.toISOString() ?? item.publishedAt,
        }
      : { ...item, title: cleanText(item.title) };
  });
  const known = new Set(previous.map((x) => x.url));
  const added: PrMention[] = [];
  for (const row of rows) {
    if (known.has(row.url)) continue;
    known.add(row.url);
    added.push({
      id: randomUUID(),
      title: row.title,
      url: row.url,
      source: row.source,
      channel: row.channel,
      ...analyzeMention(`${row.title} ${row.excerpt}`),
      excerpt: row.excerpt,
      author: row.author,
      metrics: row.metrics,
      comments: row.comments,
      origin: row.origin ?? "search",
      responseNote: "",
      publishedAt: row.publishedAt?.toISOString() ?? null,
      collectedAt: now.toISOString(),
    });
  }
  const mentions = JSON.parse(
    JSON.stringify([...added, ...refreshed]),
  ) as Prisma.InputJsonValue;
  await prisma.prRoom.update({
    where: { id: room.id },
    data: { mentions, lastCollectedAt: now },
  });
  return { roomId, added: added.length, counts, errors };
}

export async function collectDuePrRooms(now = new Date()) {
  const rooms = await prisma.prRoom.findMany({
    select: { id: true, collectEveryDays: true, lastCollectedAt: true },
  });
  const results = [];
  for (const room of rooms)
    if (isCollectionDue(room, now))
      results.push(await collectPrRoom(room.id, now));
  return results;
}
