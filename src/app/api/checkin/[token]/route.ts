/** 스캔 화면 첫 조회 — 행사 이름, PIN 통과 여부, 오늘 집계. 명단은 내려주지 않는다. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { eventDateIn } from "@/lib/collect-checkin";
import { hasCheckinSession, loadCheckinSource } from "@/lib/collect-checkin-server";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const source = await loadCheckinSource(token);
  if (!source) return NextResponse.json({ error: "체크인 링크가 없거나 꺼져 있어요" }, { status: 404 });

  const authed = await hasCheckinSession(token, source.checkinPinHash);
  const base = { sourceName: source.name, timezone: source.checkinTimezone, pinSet: Boolean(source.checkinPinHash), authed };
  if (!authed) return NextResponse.json(base);

  const today = eventDateIn(source.checkinTimezone);
  const [scans, people] = await Promise.all([
    prisma.collectCheckIn.count({ where: { sourceId: source.id, eventDate: today } }),
    prisma.collectCheckIn.groupBy({ by: ["recordId"], where: { sourceId: source.id, eventDate: today } }),
  ]);
  return NextResponse.json({ ...base, today: { date: today, scans, unique: people.length } });
}
