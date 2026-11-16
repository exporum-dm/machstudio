import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveWebinarStatus } from "@/lib/webinar-status";
import { SharedLoadCache } from "@/lib/shared-load-cache";

/**
 * 묶음 캐시(5초) — 시작 직전 대기 화면에 수백 명이 모여 30초마다 부른다. 대기 인원·등록자 수는
 * 모두에게 같은 값이라 인스턴스당 5초에 한 번만 센다. 상태(대기→라이브)는 요청마다 시각으로 계산하고,
 * 운영자가 상태를 직접 바꾸면 즉시 알림의 v 로 옛 값을 건너뛴다.
 */
const shared = new SharedLoadCache<Awaited<ReturnType<typeof loadStatus>>>(5_000);

async function loadStatus(slug: string) {
  const webinar = await prisma.webinar.findUnique({
    where: { slug },
    select: { id: true, statusOverride: true, liveStartAt: true, liveEndAt: true, signupDeadline: true, components: true },
  });
  if (!webinar) return null;
  const PRESENCE_WINDOW_MS = 5 * 60_000;
  const [waitingCount, registrantCount] = await Promise.all([
    prisma.webinarRegistration.count({
      where: { webinarId: webinar.id, presencePingAt: { gte: new Date(Date.now() - PRESENCE_WINDOW_MS) } },
    }),
    prisma.webinarRegistration.count({ where: { webinarId: webinar.id } }),
  ]);
  return { webinar, waitingCount, registrantCount };
}

// 경량 상태 전용 엔드포인트 — 라이브 전(사전등록·입장 대기) 폴링이 /info 전체(세션·테마·config)를
// 30초마다 다시 받지 않도록, 상태 전환 판정에 필요한 값만 반환한다.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const v = Number(new URL(request.url).searchParams.get("v"));
  const loaded = await shared.get(slug, () => loadStatus(slug), Number.isFinite(v) && v > 0 ? Math.min(v, Date.now()) : 0);
  if (!loaded) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });

  const statusInfo = resolveWebinarStatus(loaded.webinar);

  /**
   * 함께 기다리는 사람 수(waitingCount) — 대기 화면 밴드의 값. 라이브 중에는 보내지 않는다
   * (그때는 live-state 의 viewerCount 가 같은 자리를 맡는다). 창(5분)은 라이브 시청자 수와 같다.
   * isActive 를 보지 않는 이유: 대기 프레즌스(event: "wait")는 그 값을 건드리지 않는다.
   *
   * registrantCount — 사회적 증거용 **누적 사전등록자 수**(지금 접속 중인 몇 명이 아니라 총원).
   * 이 라우트에 얹는 이유: 라이브 전 폴러는 여기 하나뿐이다 — 뷰어 폴링은 창구를 늘리지 않는다(IA §10).
   */
  return NextResponse.json(
    {
      status: statusInfo.status,
      entryOpen: statusInfo.entryOpen,
      canRegister: statusInfo.canRegister,
      serverNow: new Date().toISOString(),
      waitingCount: statusInfo.status === "live" ? null : loaded.waitingCount,
      registrantCount: loaded.registrantCount,
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" } });
}
