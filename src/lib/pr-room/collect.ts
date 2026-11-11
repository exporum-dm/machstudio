import { rangeContains, type ResearchRange } from "./range";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { safeFetchText } from "@/lib/brief/link-preview";
import { googleNewsUrl, parseFeed } from "@/lib/brief/sources";
import { analyzeMention, isOwnChannel, type ExcludedMentionRule, type PrMention } from "./model";

const SOCIAL_SOURCES = [
  { domain: "instagram.com", channel: "sns" as const, label: "Instagram" },
  { domain: "x.com", channel: "sns" as const, label: "X" },
  { domain: "linkedin.com", channel: "sns" as const, label: "LinkedIn" },
  { domain: "threads.net", channel: "sns" as const, label: "Threads" },
  { domain: "facebook.com", channel: "sns" as const, label: "Facebook" },
  { domain: "tiktok.com", channel: "sns" as const, label: "TikTok" },
];

export interface Found {
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
/**
 * Claude 웹 조사가 날짜를 못 찾아 null 로 남긴 글의 원문 일자를, 페이지를 직접 받아 메타 태그·
 * JSON-LD 에서 찾아 채운다(국내 언론사 사이트는 바이라인 날짜가 눈에만 보이고 메타 태그가 없는
 * 경우도 많아 전부 채워지진 않는다 — 찾은 것만 채우고, 모르면 그대로 null 로 둔다).
 */
export function extractPublishedDate(html: string): Date | null {
  const candidates = [
    meta(html, "article:published_time"),
    meta(html, "og:article:published_time"),
    meta(html, "datePublished"),
    meta(html, "publishdate"),
    meta(html, "pubdate"),
    meta(html, "parsely-pub-date"),
  ].filter(Boolean);
  const jsonLd = html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1];
  if (jsonLd) candidates.push(jsonLd);
  for (const c of candidates) {
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}
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

// Google 뉴스 리다이렉트(news.google.com/rss/articles/...)는 스크립트 리다이렉트라 단순 fetch 로는
// 실제 기사로 못 따라갈 때가 있다 — 그러면 og 메타가 Google 뉴스 자체 설명("Google 뉴스가 전세계
// 매체로부터 종합한 최신 뉴스")으로 덮어써 제목이 깨진다. RSS 에서 이미 파싱한 제목·출처가 더
// 정확하니, 리다이렉트가 안 풀렸으면 그걸 덮어쓰지 않는다.
export function isUnresolvedGoogleNews(url: string) { try { return /(^|\.)news\.google\.com$/.test(new URL(url).hostname); } catch { return false; } }
// 같은 소식이 Google 뉴스 리다이렉트 URL만 바뀌어 재수집되는 경우가 많다 — 제목(공백·문장부호
// 차이는 무시)이 같으면 같은 글로 보고 더 정보가 많은 쪽만 남긴다. 완전히 같은 글자일 때만
// 합치므로, 내용이 다른 글이 제목만 비슷해서 잘못 합쳐질 위험은 없다.
function titleScore(row: Found) {
  return (row.excerpt?.length ?? 0) + (row.comments?.length ?? 0) * 50 + (row.metrics ? 20 : 0) + (isUnresolvedGoogleNews(row.url) ? -1000 : 0);
}
export function dedupeByTitle(rows: Found[]): Found[] {
  const byKey = new Map<string, Found>();
  const noKey: Found[] = [];
  for (const row of rows) {
    const key = compact(row.title);
    if (!key) { noKey.push(row); continue; }
    const existing = byKey.get(key);
    byKey.set(key, !existing || titleScore(row) > titleScore(existing) ? row : existing);
  }
  return [...byKey.values(), ...noKey];
}

async function enrichRows(rows:Found[]){const enriched:Found[]=[];for(let i=0;i<rows.length;i+=24){const batch=await Promise.all(rows.slice(i,i+24).map(async row=>{const r=await safeFetchText(row.url,{maxBytes:1_200_000,timeoutMs:8_000});if(!r)return row;if(isUnresolvedGoogleNews(r.finalUrl))return{...row,url:r.finalUrl};const social=parseSocialPage(r.finalUrl,r.text);if(/instagram\.com|tiktok\.com/i.test(r.finalUrl)&&social)return{...row,...social,publishedAt:social.publishedAt??row.publishedAt};const source=meta(r.text,"og:site_name")||row.source;const author=meta(r.text,"author")||meta(r.text,"article:author")||decodeText(r.text.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i)?.[1]??"");const title=meta(r.text,"og:title")||meta(r.text,"twitter:title")||row.title;return{...row,title:cleanText(title),url:r.finalUrl,source,author:author||row.author,excerpt:metaDescription(r.text)||row.excerpt}}));enriched.push(...batch)}return enriched}

/**
 * 사람이 직접 찾은 언급(로그인 뒤에만 보이는 Threads 글 등)을 URL 하나로 등록할 때, 제목·요약을
 * 최대한 자동으로 채워준다. 로그인 장벽·봇 차단 등으로 못 읽으면 null — 그땐 사람이 직접 입력한다.
 */
export async function previewMentionUrl(url: string): Promise<Found | null> {
  let host: string;
  try { host = new URL(url).hostname; } catch { return null; }
  const social = SOCIAL_SOURCES.find((s) => host.includes(s.domain));
  const r = await safeFetchText(url, { maxBytes: 1_200_000, timeoutMs: 8_000 });
  if (!r) return null;
  if (isUnresolvedGoogleNews(r.finalUrl)) return null;
  if (/instagram\.com|tiktok\.com/i.test(r.finalUrl)) {
    const parsed = parseSocialPage(r.finalUrl, r.text);
    if (parsed) return { ...parsed, url: r.finalUrl };
  }
  const source = meta(r.text, "og:site_name") || social?.label || host.replace(/^www\./, "");
  const author = meta(r.text, "author") || meta(r.text, "article:author") || decodeText(r.text.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i)?.[1] ?? "");
  const title = meta(r.text, "og:title") || meta(r.text, "twitter:title") || "";
  const excerpt = metaDescription(r.text);
  if (!title && !excerpt) return null;
  return {
    title: cleanText(title) || host,
    url: r.finalUrl,
    source,
    channel: social?.channel ?? "press",
    publishedAt: null,
    excerpt,
    author: author || undefined,
  };
}

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

interface NaverNewsResponse {
  items?: Array<{
    title?: string;
    originallink?: string;
    link?: string;
    description?: string;
    pubDate?: string;
  }>;
}

export function parseNaverApiNews(data: NaverNewsResponse): Found[] {
  return (data.items ?? []).flatMap((item) => {
    const url = item.originallink || item.link;
    if (!url) return [];
    let source = "NAVER 뉴스";
    try { source = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    const publishedAt = item.pubDate ? new Date(item.pubDate) : null;
    return [{
      title: cleanText(item.title ?? ""),
      url,
      source,
      channel: "press" as const,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      excerpt: cleanText(item.description ?? ""),
      origin: "naver-api" as const,
    }];
  });
}

async function naverApiNews(query: string): Promise<Found[]> {
  const clientId = process.env.NAVER_API_HUB_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVER_API_HUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("NAVER API HUB 인증정보가 설정되지 않았습니다.");
  const url = new URL("https://naverapihub.apigw.ntruss.com/search/v1/news");
  url.search = new URLSearchParams({ query, display: "100", start: "1", sort: "date", format: "json" }).toString();
  const response = await fetch(url, {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": clientId,
      "X-NCP-APIGW-API-KEY": clientSecret,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`NAVER API HUB ${response.status}`);
  return parseNaverApiNews(await response.json() as NaverNewsResponse);
}

/**
 * Google 뉴스 RSS 주소. 기간이 있으면 after:/before: 연산자로 그 기간만 묻는다(before 는 그날을 빼므로
 * 종료일 다음 날). 기간이 없으면 예전처럼 최근 N일(when:Nd).
 */
export function prRoomGoogleNewsUrl(query: string, days: number, range: ResearchRange | null): string {
  if (!range) return googleNewsUrl({ query, days });
  const before = new Date(Date.parse(`${range.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const q = `${query} after:${range.from} before:${before}`;
  return `https://news.google.com/rss/search?${new URLSearchParams({ q, hl: "ko", gl: "KR", ceid: "KR:ko" })}`;
}

async function googleRows(
  query: string,
  channel: PrMention["channel"],
  source: string,
  days: number,
  range: ResearchRange | null = null,
): Promise<Found[]> {
  const result = await safeFetchText(prRoomGoogleNewsUrl(query, days, range), {
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

export async function collectPrRoom(roomId: string, now = new Date(), range: ResearchRange | null = null) {
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
  const excludedRules=(Array.isArray(room.excludedMentionRules)?room.excludedMentionRules.filter((x)=>Boolean(x)&&typeof x==="object"&&typeof (x as unknown as ExcludedMentionRule).title==="string"):[]) as unknown as ExcludedMentionRule[];
  const ownChannels = Array.isArray(room.ownChannelUrls) ? room.ownChannelUrls.filter((x): x is string => typeof x === "string") : [];
  const days = 30;
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const tasks = queries.slice(0, 5).flatMap((query) => [
    {
      label: "Google 뉴스",
      run: () => googleRows(`"${query}"`, "press", "Google 뉴스", days, range),
    },
    {
      label: "네이버 뉴스",
      run: async () => {
        if (process.env.NAVER_API_HUB_CLIENT_ID && process.env.NAVER_API_HUB_CLIENT_SECRET)
          return naverApiNews(query);
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
        googleRows(`site:${s.domain} "${query}"`, s.channel, s.label, days, range),
    })),
  ]);
  const settled = await Promise.all(
    tasks.map(async (task) => {
      try {
        const found = (await task.run()).filter((row) =>
          isRelevantMention(row.title, queries) && (!range || rangeContains(range, row.publishedAt) !== false),
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
  const rows = dedupeByTitle((await enrichRows(settled.flat())).filter(row=>!excluded.has(row.url)&&!isSimilarToExcluded(row,excludedRules,queries)&&!isOwnChannel(row.url,ownChannels)));
  const naverRetentionCutoff = now.getTime() - 21 * 86_400_000;
  const previous = (
    Array.isArray(room.mentions)
      ? (room.mentions as unknown as PrMention[])
      : []
  ).filter((row) => !excluded.has(row.url) && !isSimilarToExcluded(row,excludedRules,queries) && !isOwnChannel(row.url,ownChannels) && row.origin !== "reference" && (row.origin !== "naver-api" || new Date(row.collectedAt).getTime() >= naverRetentionCutoff) && isRelevantMention(`${row.title} ${row.excerpt}`, queries));
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
  const knownTitles = new Set(previous.map((x) => compact(x.title)).filter(Boolean));
  const added: PrMention[] = [];
  for (const row of rows) {
    if (known.has(row.url)) continue;
    const titleKey = compact(row.title);
    // 같은 글이 Google 뉴스 리다이렉트 URL만 바뀌어 다시 걸렸다 — 새 글로 추가하지 않는다.
    if (titleKey && knownTitles.has(titleKey)) continue;
    known.add(row.url);
    if (titleKey) knownTitles.add(titleKey);
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
  const saved = await prisma.prRoom.updateMany({
    where: { id: room.id, updatedAt: room.updatedAt },
    data: { mentions, lastCollectedAt: now },
  });
  if (!saved.count) throw new Error("PR_ROOM_CHANGED");
  return { roomId, added: added.length, counts, errors };
}

/**
 * Claude 웹 조사는 날짜를 모르면 정직하게 null 로 둔다(지어내지 않음) — 그런데 실제로는 원문
 * 페이지에 메타 태그로 날짜가 있는데 Claude 가 요약하며 놓친 경우가 많다. publishedAt 이 없는
 * 글만 골라 페이지를 직접 받아 extractPublishedDate 로 다시 찾는다. 많으면 느려지니 한 번에
 * 40건까지만 — 나머지는 다음 클릭에서 이어 처리된다.
 */
export async function fillMissingPublishedDates(roomId: string): Promise<{ checked: number; filled: number }> {
  const room = await prisma.prRoom.findUnique({ where: { id: roomId } });
  if (!room) throw new Error("홍보실을 찾을 수 없어요");
  const mentions = Array.isArray(room.mentions) ? (room.mentions as unknown as PrMention[]) : [];
  const targets = mentions.filter((m) => !m.publishedAt).slice(0, 40);
  if (!targets.length) return { checked: 0, filled: 0 };
  const found = new Map<string, string>();
  for (let i = 0; i < targets.length; i += 24) {
    const batch = targets.slice(i, i + 24);
    await Promise.all(batch.map(async (m) => {
      const r = await safeFetchText(m.url, { maxBytes: 1_200_000, timeoutMs: 8_000 });
      if (!r) return;
      const d = extractPublishedDate(r.text);
      if (d) found.set(m.url, d.toISOString());
    }));
  }
  if (!found.size) return { checked: targets.length, filled: 0 };
  const updated = mentions.map((m) => (found.has(m.url) ? { ...m, publishedAt: found.get(m.url)! } : m));
  const saved = await prisma.prRoom.updateMany({
    where: { id: room.id, updatedAt: room.updatedAt },
    data: { mentions: JSON.parse(JSON.stringify(updated)) as Prisma.InputJsonValue },
  });
  if (!saved.count) throw new Error("PR_ROOM_CHANGED");
  return { checked: targets.length, filled: found.size };
}
