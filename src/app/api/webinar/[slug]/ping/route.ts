import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { getWebinarLiveSnapshot } from "@/lib/webinar-live-snapshot";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

// 시청 구간(WebinarAttendanceSegment): 마지막 ping 후 90초 내면 열린 구간을 연장,
// 그보다 오래 끊겼다 돌아오면 새 구간을 만든다. 시청 곡선("몇 분 지점에 몇 명")의 원천.
const SEGMENT_GAP_MS = 90_000;

/**
 * 등록 건당 한도. heartbeat 는 60±10초 주기라 분당 1회가 정상이고, 탭 여러 개·재접속·
 * enter/leave 가 겹쳐도 분당 12회면 넉넉하다.
 */
const PER_REGISTRATION_LIMIT = 12;

/**
 * IP 백스톱. **등록 건당 한도가 주 방어선이고 이쪽은 보조**다.
 *
 * 예전에는 IP 하나당 120/분이 유일한 한도였다. 사내망·VPN 뒤에서는 시청자 수백 명이
 * **같은 출구 IP** 를 쓰므로, 500명 규모 사내 웨비나에서 분당 500건이 한 키로 몰려
 * 380명분의 heartbeat 가 429 로 버려진다 — 시청자 수·시청 시간·시청 곡선이 전부 과소
 * 집계되고, 정작 막으려던 남용은 등록 id 를 바꿔 가며 그대로 통과한다.
 * 한도를 등록 건당으로 옮기고, IP 는 **단일 호스트의 맹목적 폭주**만 자르는 높은 선으로 둔다.
 */
const PER_IP_LIMIT = 3000;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ip = getClientIp(request);

  if (!(await rateLimitAsync(`webinar-ping-ip:${slug}:${ip}`, { limit: PER_IP_LIMIT, windowMs: 60_000 })).allowed) {
    return new NextResponse(null, { status: 429, headers: CORS_HEADERS });
  }

  /**
   * 웨비나 행은 **live-state 와 같은 5초 스냅샷**에서 읽는다(lib/webinar-live-snapshot).
   * heartbeat 는 시청자당 분당 1회라 500명이면 초당 8요청인데, 그때마다 같은 행을 다시
   * 읽을 이유가 없다 — 이 라우트에서 꼭 지금 값이어야 하는 것은 아래 쓰기뿐이다.
   */
  const snap = await getWebinarLiveSnapshot(slug);
  if (!snap.webinar || !snap.status) {
    return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404, headers: CORS_HEADERS });
  }
  const webinar = snap.webinar;
  // 상태를 응답에 동봉 — live 페이지가 별도 요청 없이 상태 전환을 감지할 수 있게
  const statusInfo = snap.status;

  const body = await request.json().catch(async () => {
    const text = await request.text().catch(() => "");
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  });
  const { registrationId, event, hidden } = body;

  if (!registrationId || typeof registrationId !== "string") {
    return NextResponse.json({ ok: true, status: statusInfo.status }, { headers: CORS_HEADERS });
  }

  // 주 한도 — 자칭 등록 id 기준. 위조 id 로 우회해도 아래 UPDATE 가 0행이라 얻는 게 없고,
  // 그 폭주는 IP 백스톱이 자른다.
  if (!(await rateLimitAsync(`webinar-ping-reg:${registrationId}`, { limit: PER_REGISTRATION_LIMIT, windowMs: 60_000 })).allowed) {
    return new NextResponse(null, { status: 429, headers: CORS_HEADERS });
  }

  const now = new Date();

  /**
   * 대기 화면 프레즌스 — "N명이 함께 기다려요" 밴드의 근거.
   *
   * heartbeat 와 **반드시 갈라야** 한다. heartbeat 는 isActive 를 세우고 connectedSeconds 를
   * 누적하는데, 대기 시간이 거기 섞이면 접속 시간·입장률·시청 곡선이 전부 부풀어 오른다
   * (방송을 안 봤는데 30분 시청한 사람이 된다). 그래서 여기서 찍는 것은 presencePingAt 하나뿐이고,
   * 아래 시간 누적·구간 기록 블록에 닿기 전에 돌려보낸다.
   *
   * 라이브 시청자 수(live-state)는 `isActive: true` + 최근 프레즌스로 세므로 이 값이 새지 않는다.
   */
  if (event === "wait") {
    const waited = await prisma.webinarRegistration.updateMany({
      where: { id: registrationId, webinarId: webinar.id },
      data: { presencePingAt: now },
    });
    return NextResponse.json(
      { ok: waited.count > 0, status: statusInfo.status },
      { headers: CORS_HEADERS },
    );
  }

  let updatedCount = 0;
  // 직전 ping 이후 경과분을 접속 시간에 더한다. 90초(SEGMENT_GAP_MS)를 넘으면 그 사이엔
  // 자리를 비운 것이므로 더하지 않는다 — 구간 합산과 같은 규칙이되, 겹침 이중계산이 불가능하다.
  // 탭이 보였던 경우(hidden !== true)만 포커스 시간에도 함께 더한다.
  // ⚠ lastPingAt 을 갱신하기 전에 실행해야 직전 간격을 읽을 수 있다.
  const GAP = Math.floor(SEGMENT_GAP_MS / 1000);
  const visibleFactor = hidden === true ? 0 : 1;
  await prisma.$executeRaw`
    UPDATE "WebinarRegistration"
    SET "connectedSeconds" = "connectedSeconds" + LEAST(${GAP}, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${now}::timestamptz - "lastPingAt")))::int)),
        "focusSeconds" = "focusSeconds" + ${visibleFactor} * LEAST(${GAP}, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${now}::timestamptz - "lastPingAt")))::int))
    WHERE "id" = ${registrationId} AND "webinarId" = ${webinar.id} AND "lastPingAt" IS NOT NULL
  `;

  if (event === "enter") {
    // enteredAt 은 최초 입장 시각만 유지 — 새로고침/재입장이 덮어써 체류 시간이 리셋되지 않게 COALESCE.
    updatedCount = await prisma.$executeRaw`
      UPDATE "WebinarRegistration"
      SET "enteredAt" = COALESCE("enteredAt", ${now}), "isActive" = true, "lastPingAt" = ${now}, "presencePingAt" = ${now}
      WHERE "id" = ${registrationId} AND "webinarId" = ${webinar.id}
    `;
  } else if (event === "leave") {
    // stayMinutes 는 enteredAt 기준 재계산 — 기존 조회+갱신 2쿼리를 단일 UPDATE 로.
    // (timestamp 컬럼은 UTC 저장이므로 epoch 연산이 정확하다)
    const nowEpoch = Math.floor(now.getTime() / 1000);
    updatedCount = await prisma.$executeRaw`
      UPDATE "WebinarRegistration"
      SET "leftAt" = ${now}, "isActive" = false, "lastPingAt" = ${now}, "presencePingAt" = ${now},
          "stayMinutes" = GREATEST(0, FLOOR((${nowEpoch} - EXTRACT(EPOCH FROM "enteredAt")) / 60))::int
      WHERE "id" = ${registrationId} AND "webinarId" = ${webinar.id} AND "enteredAt" IS NOT NULL
    `;
  } else {
    // heartbeat
    updatedCount = (
      await prisma.webinarRegistration.updateMany({
        where: { id: registrationId, webinarId: webinar.id },
        data: { lastPingAt: now, presencePingAt: now, isActive: true },
      })
    ).count;
  }

  // 등록 검증(updatedCount>0)을 통과한 경우에만 구간 기록
  if (updatedCount > 0) {
    const extended = await prisma.webinarAttendanceSegment.updateMany({
      where: {
        registrationId,
        webinarId: webinar.id,
        endedAt: { gte: new Date(now.getTime() - SEGMENT_GAP_MS) },
      },
      data: { endedAt: now },
    });
    // leave 는 열린 구간 연장만 — 끊긴 지 오래면 유령 구간을 만들지 않는다
    if (extended.count === 0 && event !== "leave") {
      await prisma.webinarAttendanceSegment
        .create({ data: { webinarId: webinar.id, registrationId, startedAt: now, endedAt: now } })
        .catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, status: statusInfo.status }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
