/**
 * PIN 확인 → 운영요원 세션 쿠키. 4자리라 경우의 수가 1만 개뿐이므로 시도 횟수를 묶는다:
 * 같은 기기(IP)는 10분에 10번, 링크 전체로는 10분에 40번 — 운영자가 짧은 주소를 정하면 링크가
 * 짐작될 수 있으므로 PIN 이 진짜 문이다.
 */
import { NextResponse } from "next/server";
import { verifySharePassword } from "@/lib/share-password";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { normalizePin } from "@/lib/collect-checkin";
import { checkinCookieName, createCheckinSession } from "@/lib/collect-checkin-session";
import { loadCheckinSource } from "@/lib/collect-checkin-server";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const source = await loadCheckinSource(token);
  if (!source) return NextResponse.json({ error: "체크인 링크가 없거나 꺼져 있어요" }, { status: 404 });
  if (!source.checkinPinHash) {
    return NextResponse.json({ error: "아직 PIN이 설정되지 않았어요. 관리자에게 문의해 주세요" }, { status: 409 });
  }

  const ip = getClientIp(request);
  const perIp = await rateLimitAsync(`checkin-pin:${token}:${ip}`, { limit: 10, windowMs: 10 * 60_000 });
  const perLink = await rateLimitAsync(`checkin-pin:${token}`, { limit: 40, windowMs: 10 * 60_000 });
  if (!perIp.allowed || !perLink.allowed) {
    return NextResponse.json({ error: "시도가 너무 많아요. 10분 뒤에 다시 해 주세요" }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { pin?: unknown };
  const pin = normalizePin(body.pin);
  if (!verifySharePassword(pin, source.checkinPinHash)) {
    return NextResponse.json({ error: "PIN이 맞지 않아요" }, { status: 401 });
  }

  const session = createCheckinSession(token, source.checkinPinHash);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(checkinCookieName(token), session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return res;
}
