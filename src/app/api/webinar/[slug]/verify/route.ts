import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimitAsync, rateLimitPeekAsync } from "@/lib/ratelimit";
import { normalizePhone, normalizeEmail } from "@/lib/webinar-config";
import { generateShareCode } from "@/lib/webinar-share";

// found=false 전용 한도 — 미스만 기록해 5분에 5회 넘는 실패 조회를 차단 (명단 enumeration 방지).
// 성공 조회는 미스 버킷에 기록하지 않으므로 정상 참가자의 오타 1~2회는 영향 없음.
// 열거 방어용. 조회 **전에** 차단해야 found 여부가 새지 않으므로 IP 단위를 유지하되,
// 한도가 5회면 같은 IP 를 쓰는 사내망·모바일 CGNAT 에서 누군가의 오타 몇 번으로 무고한
// 등록자까지 5분간 입장 불가가 됐다(웨비나는 정시에 몰리는 서비스라 최악의 순간에 걸린다).
// 30회/5분 이면 실사용자는 사실상 걸리지 않고, 번호 공간 열거에는 여전히 비현실적으로 느리다.
const MISS_LIMIT = { limit: 30, windowMs: 300_000 };

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // 공개 엔드포인트 — 전화번호/이메일 무차별 대입으로 명단 enumeration 방지
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  // 웨비나는 정시에 트래픽이 몰린다. 사내망·모바일 CGNAT 처럼 IP 를 공유하는 정상 시청자가
  // 최악의 순간에 막히던 문제 → 성공 경로 한도를 크게 올린다(무한은 아니되 단체 입장을 막지 않게).
  // 성공 경로 한도. 500명이 정시에 한 사무실에서 입장하면 첫 1분에 수백 건이 한 키로 몰린다 —
  // 120/분은 그 순간을 못 버틴다(입장 자체가 막히는, 가장 비싼 실패다).
  // 열거 방어는 이 값이 아니라 아래 `verify-miss` 버킷이 맡는다 — 성공 한도를 올려도 안 약해진다.
  const rl = await rateLimitAsync(`verify:${slug}:${ip}`, { limit: 600, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 잦아요. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString(),
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  // 미스 한도 초과 상태면 조회 자체를 막는다 (found 여부 노출 차단)
  if ((await rateLimitPeekAsync(`verify-miss:${slug}:${ip}`, MISS_LIMIT)).blocked) {
    return NextResponse.json(
      { error: "확인 실패가 반복됐어요. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Retry-After": "300", "Access-Control-Allow-Origin": "*" } },
    );
  }

  const webinar = await prisma.webinar.findUnique({ where: { slug }, select: { id: true, config: true } });
  if (!webinar) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 });

  const body = await request.json();
  const { type, value } = body;

  if (!type || !value) {
    return NextResponse.json({ found: false, registration: null }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const normalizedValue = type === "phone" ? normalizePhone(value) : normalizeEmail(value);
  if (!normalizedValue) {
    return NextResponse.json({ found: false, registration: null }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const where =
    type === "phone"
      ? { webinarId: webinar.id, phone: normalizedValue }
      // 중복 확인·등록 차단과 같은 기준. 기존 대문자 포함 이메일도 입장 확인이 가능해야 한다.
      : { webinarId: webinar.id, email: { equals: normalizedValue, mode: "insensitive" as const } };

  // 입장 확인엔 이름만 있으면 충분 — PII(email/phone/company/department/jobTitle/industry) 미반환
  // shareCode 는 본인 것이라 함께 준다: 공유 버튼이 클릭 순간 서버를 기다리지 않고 링크를 만든다.
  const registration = await prisma.webinarRegistration.findFirst({
    where,
    select: { id: true, name: true, shareCode: true },
  });

  /* 추천 코드 지연 발급 — 이 기능이 생기기 전에 등록한 사람은 코드가 없다. 입장 확인은 POST 라
     여기서 한 번 채워도 안전하다(백필 마이그레이션 없이 자연히 메워진다). 충돌은 유니크 제약이
     잡아주므로 실패하면 그냥 코드 없이 진행한다 — 공유 버튼이 없어질 뿐, 입장은 막지 않는다. */
  if (registration && !registration.shareCode) {
    try {
      const issued = await prisma.webinarRegistration.update({
        where: { id: registration.id },
        data: { shareCode: generateShareCode() },
        select: { shareCode: true },
      });
      registration.shareCode = issued.shareCode;
    } catch {
      /* 코드 발급 실패는 입장을 막지 않는다 */
    }
  }

  // 미스만 기록 — 다음 요청부터 peek 이 차단 판정에 사용
  if (!registration) {
    await rateLimitAsync(`verify-miss:${slug}:${ip}`, MISS_LIMIT);
  }

  // 인증 통과자에게만 영상 ID 전달 (공개 /info 에서는 제거됨)
  const youtubeId = registration && webinar.config && typeof (webinar.config as Record<string, unknown>).youtubeId === "string"
    ? (webinar.config as Record<string, unknown>).youtubeId
    : undefined;

  // 알림 스위치 초기 상태 복원용 — 이 등록자가 이미 구독 중인지
  const reminderSubscribed = registration
    ? !!(await prisma.webinarReminder.findFirst({ where: { webinarId: webinar.id, registrationId: registration.id }, select: { id: true } }))
    : false;

  return NextResponse.json(
    { found: !!registration, registration: registration ?? null, reminderSubscribed, ...(youtubeId ? { youtubeId } : {}) },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
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
