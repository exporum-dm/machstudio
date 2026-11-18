/**
 * 방문 비콘(자체 호스팅 면) — 랜딩 단독 페이지·라이브 페이지가 세션당 1회 sendBeacon.
 *
 * 왜 필요한가: 방문(WebinarVisitStat)을 쓰는 곳이 **임베드 seen 비콘 한 곳뿐**이었다. 그래서
 * 공유 링크·QR·카카오로 들어와 자체 페이지에서 등록한 채널은 분석 표에서 visits=0 · registered>0
 * 이 되어 등록률이 0% 로 표시됐다 — 실제로는 가장 잘 전환된 채널이 가장 나빠 보였다.
 * (임베드 경로는 seen 라우트가 그대로 담당한다. 이 라우트는 그 규칙을 자체 면에 확장한 것이고,
 *  키 정규화·일자 규약·봇 제외를 seen 과 동일하게 맞춰야 두 경로가 같은 행에 합쳐진다.)
 *
 * 폴러가 아니다 — 클라이언트가 sessionStorage 로 세션당 1회만 보낸다(새 폴링 금지 규약 준수).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimitAsync } from "@/lib/ratelimit";
import { normalizeUtmKey } from "@/lib/attribution-normalize";
import { normalizeShareCode } from "@/lib/webinar-share";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

const BOT_UA = /bot|crawl|spider|slurp|googlebot|bingbot|facebookexternalhit|whatsapp|telegram|twitterbot|linkedinbot|headlesschrome/i;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  });
}

/** KST 기준 일자 — seen 라우트와 **같은 규약**(그 날 00:00 을 UTC 자정 마커로 저장). */
function kstDate(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  return new Date(`${kst.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (BOT_UA.test(request.headers.get("user-agent") ?? "")) {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  // 무인증 비콘이 퍼널 분모를 갱신하므로 한도는 공유 스토어(Redis)로 강제한다 — seen 과 동일.
  // 방문 비콘 — 페이지를 여는 사람마다 1건. 슬러그 구분 없이 IP 하나로 세고 있었으므로
  // 사내망 뒤 500명이 동시에 열면 60/분을 즉시 넘겨 유입 통계가 통째로 비었다.
  const rl = await rateLimitAsync(`webinar-visit:${ip}`, { limit: 1200, windowMs: 60_000 });
  if (!rl.allowed) return new NextResponse(null, { status: 429, headers: CORS_HEADERS });

  const body = await request.json().catch(async () => {
    // sendBeacon 이 text/plain 으로 보내는 브라우저 대비(seen 과 동일한 폴백)
    const text = await request.text().catch(() => "");
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  });

  const webinar = await prisma.webinar.findUnique({
    where: { slug },
    select: { id: true, project: { select: { deletedAt: true } } },
  });
  // 삭제 유예 중 프로젝트는 공개 면에서 없는 것으로 다룬다(다른 공개 라우트와 같은 규칙).
  if (!webinar || webinar.project.deletedAt !== null) {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  const now = new Date();

  /* 추천 링크(`?ref=`)로 들어온 방문 — 같은 비콘에 얹는다. 별도 비콘을 만들면 요청이 두 배가 되고
     "새 폴러 금지" 규약과도 어긋난다. 코드가 이 웨비나의 것이 아니면(오래된 링크·오타) 무시한다. */
  const refCode = normalizeShareCode(body?.ref);
  if (refCode) {
    const owner = await prisma.webinarRegistration.findFirst({
      where: { webinarId: webinar.id, shareCode: refCode },
      select: { id: true },
    });
    if (owner) {
      await prisma.webinarShareClick
        .upsert({
          where: { webinarId_shareCode_date: { webinarId: webinar.id, shareCode: refCode, date: kstDate(now) } },
          update: { clicks: { increment: 1 } },
          create: { webinarId: webinar.id, shareCode: refCode, date: kstDate(now), clicks: 1 },
        })
        .catch(() => {});
    }
  }

  await prisma.webinarVisitStat
    .upsert({
      where: {
        webinarId_date_utmSource_utmMedium: {
          webinarId: webinar.id,
          date: kstDate(now),
          utmSource: normalizeUtmKey(body?.utmSource),
          utmMedium: normalizeUtmKey(body?.utmMedium),
        },
      },
      update: { visits: { increment: 1 } },
      create: {
        webinarId: webinar.id,
        date: kstDate(now),
        utmSource: normalizeUtmKey(body?.utmSource),
        utmMedium: normalizeUtmKey(body?.utmMedium),
        visits: 1,
      },
    })
    .catch(() => {});

  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
