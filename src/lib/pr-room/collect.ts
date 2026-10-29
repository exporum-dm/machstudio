import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { safeFetchText } from "@/lib/brief/link-preview";
import { googleNewsUrl, parseFeed } from "@/lib/brief/sources";
import { analyzeMention, isCollectionDue, type PrMention } from "./model";

const SOCIAL_SOURCES = [
  { domain: "instagram.com", channel: "sns" as const, label: "Instagram" },
  { domain: "x.com", channel: "sns" as const, label: "X" },
  { domain: "linkedin.com", channel: "sns" as const, label: "LinkedIn" },
  { domain: "threads.net", channel: "sns" as const, label: "Threads" },
  { domain: "facebook.com", channel: "sns" as const, label: "Facebook" },
  { domain: "tiktok.com", channel: "sns" as const, label: "TikTok" },
];

interface Found { title:string; url:string; source:string; channel:PrMention["channel"]; publishedAt:Date|null; excerpt:string }

function cleanText(value:string){return value.replace(/<[^>]+>/g," ").replace(/&quot;/g,'"').replace(/&amp;/g,"&").replace(/\s+/g," ").replace(/새 창 열림$/," ").trim()}
const compact=(value:string)=>value.toLowerCase().normalize("NFKC").replace(/[^a-z0-9가-힣]/g,"");
export function isRelevantMention(title:string,queries:string[]){const haystack=compact(title);return queries.some(query=>{const needle=compact(query);return needle.length>=4&&haystack.includes(needle)})}

export function parseNaverNews(html:string,query=""):Found[]{
  const rows:Found[]=[];const seen=new Set<string>();
  for(const match of html.matchAll(/<a[^>]+href="(https?:\/\/[^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)){
    const url=match[1];const title=cleanText(match[2]);
    const terms=query.toLowerCase().split(/\s+/).filter(x=>x.length>1);const relevant=!terms.length||terms.some(x=>title.toLowerCase().includes(x));
    if(!relevant||title.length<12||title.length>300||seen.has(url)||/search\.naver\.com|help\.naver\.com/.test(url))continue;
    seen.add(url);rows.push({title,url,source:"네이버 뉴스",channel:"press",publishedAt:null,excerpt:""});
  }
  return rows.slice(0,50);
}

async function googleRows(query:string, channel:PrMention["channel"], source:string, days:number):Promise<Found[]>{
  const result=await safeFetchText(googleNewsUrl({query,days}),{accept:"application/rss+xml,text/xml",maxBytes:2_000_000,timeoutMs:15_000,allow:ct=>/xml|rss|atom/i.test(ct)});
  return result?parseFeed(result.text,"news").map(row=>({title:row.title,url:row.url,source:source==="Google 뉴스"?(row.org||source):source,channel,publishedAt:row.publishedAt,excerpt:""})):[];
}

export async function collectPrRoom(roomId: string, now = new Date()) {
  const room = await prisma.prRoom.findUnique({ where: { id: roomId }, include: { project: { select: { name: true } } } });
  if (!room) throw new Error("홍보실을 찾을 수 없어요");
  const keywords = Array.isArray(room.keywords) ? room.keywords.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
  const queries = keywords.length ? keywords : [room.project.name];
  const days=Math.max(7,room.collectEveryDays+4);const counts:Record<string,number>={};const errors:string[]=[];
  const tasks=queries.slice(0,5).flatMap(query=>[
    {label:"Google 뉴스",run:()=>googleRows(`"${query}"`,"press","Google 뉴스",days)},
    {label:"네이버 뉴스",run:async()=>{const url=`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(query)}`;const r=await safeFetchText(url,{maxBytes:2_000_000,timeoutMs:15_000});return r?parseNaverNews(r.text,query):[]}},
    ...SOCIAL_SOURCES.map(s=>({label:s.label,run:()=>googleRows(`site:${s.domain} "${query}"`,s.channel,s.label,days)})),
  ]);
  const settled=await Promise.all(tasks.map(async task=>{try{const found=(await task.run()).filter(row=>isRelevantMention(row.title,queries));counts[task.label]=(counts[task.label]??0)+found.length;return found}catch(e){errors.push(`${task.label}: ${e instanceof Error?e.message:String(e)}`);return []}}));
  const rows=settled.flat();
  const previous = (Array.isArray(room.mentions) ? room.mentions as unknown as PrMention[] : []).filter(row=>isRelevantMention(row.title,queries));
  const known = new Set(previous.map((x) => x.url));
  const added: PrMention[] = [];
  for (const row of rows) {
    if (known.has(row.url)) continue;
    known.add(row.url);
    added.push({ id: randomUUID(), title: row.title, url: row.url, source: row.source, channel: row.channel, ...analyzeMention(row.title), excerpt: row.excerpt, responseNote: "", publishedAt: row.publishedAt?.toISOString() ?? null, collectedAt: now.toISOString() });
  }
  const mentions = [...added, ...previous].slice(0, 500) as unknown as Prisma.InputJsonValue;
  await prisma.prRoom.update({ where: { id: room.id }, data: { mentions, lastCollectedAt: now } });
  return { roomId, added: added.length, counts, errors };
}

export async function collectDuePrRooms(now = new Date()) {
  const rooms = await prisma.prRoom.findMany({ select: { id: true, collectEveryDays: true, lastCollectedAt: true } });
  const results = [];
  for (const room of rooms) if (isCollectionDue(room, now)) results.push(await collectPrRoom(room.id, now));
  return results;
}
