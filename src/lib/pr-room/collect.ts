import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { safeFetchText } from "@/lib/brief/link-preview";
import { googleNewsUrl, parseFeed } from "@/lib/brief/sources";
import { analyzeMention, isCollectionDue, type PrMention } from "./model";

export async function collectPrRoom(roomId: string, now = new Date()) {
  const room = await prisma.prRoom.findUnique({ where: { id: roomId }, include: { project: { select: { name: true } } } });
  if (!room) throw new Error("홍보실을 찾을 수 없어요");
  const keywords = Array.isArray(room.keywords) ? room.keywords.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
  const queries = keywords.length ? keywords : [room.project.name];
  const rows = (await Promise.all(queries.slice(0, 5).map(async (query) => {
    const result = await safeFetchText(googleNewsUrl({ query, days: Math.max(3, room.collectEveryDays + 1) }), { accept: "application/rss+xml,text/xml", maxBytes: 1_500_000, timeoutMs: 12_000 });
    return result ? parseFeed(result.text, "news") : [];
  }))).flat();
  const previous = Array.isArray(room.mentions) ? room.mentions as unknown as PrMention[] : [];
  const known = new Set(previous.map((x) => x.url));
  const added: PrMention[] = [];
  for (const row of rows) {
    if (known.has(row.url)) continue;
    known.add(row.url);
    added.push({ id: randomUUID(), title: row.title, url: row.url, source: row.org || "Google 뉴스", channel: "press", ...analyzeMention(row.title), excerpt: "", responseNote: "", publishedAt: row.publishedAt?.toISOString() ?? null, collectedAt: now.toISOString() });
  }
  const mentions = [...added, ...previous].slice(0, 500) as unknown as Prisma.InputJsonValue;
  await prisma.prRoom.update({ where: { id: room.id }, data: { mentions, lastCollectedAt: now } });
  return { roomId, added: added.length };
}

export async function collectDuePrRooms(now = new Date()) {
  const rooms = await prisma.prRoom.findMany({ select: { id: true, collectEveryDays: true, lastCollectedAt: true } });
  const results = [];
  for (const room of rooms) if (isCollectionDue(room, now)) results.push(await collectPrRoom(room.id, now));
  return results;
}
