/**
 * 등록 확인 (Find My QR) — 설계 §10.
 *
 * 이메일 연동 전에는 등록자가 QR 을 되찾는 **유일한 경로**다(§2). 그래서 이건 편의 기능이
 * 아니라 등록 흐름의 일부다.
 *
 * ── 남용 방지(§10.2) ──────────────────────────────────────────────────
 * `or` 로 열어 두는 만큼 기계적 조회는 막는다:
 *  · 레이트리밋을 **IP 와 입력값 양쪽**에 건다. IP 만 걸면 봇넷이 한 이메일을 수천 IP 로
 *    돌려 볼 수 있고, 입력값만 걸면 한 IP 가 이메일을 바꿔 가며 명단을 훑을 수 있다.
 *  · 못 찾으면 **"찾을 수 없습니다" 로만 끝낸다.** "그 이메일은 있는데 전화가 다릅니다"
 *    같은 힌트를 주면 그게 곧 열거 창구다.
 *  · 내보내는 정보는 이름·유형·등록번호·QR 뿐(buildLookupView 가 강제한다).
 */
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { buildLookupCriteria, buildLookupView } from "@/lib/collect-lookup";

function normalizeOrigin(s: string): string {
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return s.trim().toLowerCase();
  }
}

const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
} as const;

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const allowAll = allowed.length === 0;
  let allowOrigin = "*";
  if (!allowAll) {
    const o = origin ? normalizeOrigin(origin) : "";
    allowOrigin = o && allowed.includes(o) ? o : "null";
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...PREFLIGHT_HEADERS, "Access-Control-Max-Age": "86400" },
  });
}

/**
 * 입력값 기준 한도의 키. 원문을 로그·Redis 에 남기지 않으려고 해시로 만든다.
 *
 * **식별자마다 따로 센다.** 예전에는 (이메일,전화) 튜플 하나를 키로 썼는데, 그러면
 * 표적 이메일은 고정한 채 전화만 한 자리씩 바꿔 던지는 것으로 버킷이 매번 새로 생겨
 * 한도가 통째로 무력화된다 — 이 라우트가 막겠다고 적어 둔 바로 그 남용이다.
 */
function valueKey(kind: "e" | "p", id: string, value: string): string {
  return `collect-lookup-${kind}:${createHash("sha256").update(`${id}|${value}`).digest("base64url").slice(0, 22)}`;
}

/** 못 찾음 — **한 가지 응답으로만** 끝낸다. 이유를 나눠 주면 그게 열거 힌트다. */
function notFound(headers: Record<string, string>) {
  return NextResponse.json({ found: false }, { status: 200, headers });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  /**
   * IP 한도가 먼저다 — 인증 없이 DB 를 여는 경로다.
   *
   * 다만 값을 넉넉히 잡는다. 현장 와이파이·통신사 CGNAT 뒤에서는 수백 명이 한 IP 를
   * 공유하는데, 등록 확인은 **QR 을 잃어버린 사람이 쓰는 화면**이라 여기서 막히면
   * 그 사람은 스태프 줄로 간다. 표적 한 명을 반복 조회하는 진짜 남용은 아래 식별자별
   * 한도(10회/10분)가 막고, 이건 무차별 스캔의 상한일 뿐이다.
   */
  const ip = getClientIp(request);
  const ipRl = await rateLimitAsync(`collect-lookup-ip:${ip}`, { limit: 120, windowMs: 60_000 });
  if (!ipRl.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 잦아요. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { ...PREFLIGHT_HEADERS, "Retry-After": Math.ceil(ipRl.retryAfterMs / 1000).toString() } },
    );
  }

  let body: { email?: unknown; phone?: unknown; phoneCountry?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; phone?: unknown; phoneCountry?: unknown };
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400, headers: PREFLIGHT_HEADERS });
  }

  const source = await prisma.collectSource.findUnique({
    where: { id },
    select: { id: true, isActive: true, mode: true, deletedAt: true, allowedOrigins: true, formConfig: true },
  });
  if (!source || !source.isActive || source.mode !== "builder" || source.deletedAt) {
    return notFound(PREFLIGHT_HEADERS);
  }

  const headers = corsHeaders(request.headers.get("origin"), source.allowedOrigins ?? []);
  if (source.allowedOrigins && source.allowedOrigins.length > 0) {
    const o = request.headers.get("origin");
    const norm = o ? normalizeOrigin(o) : "";
    if (!norm || !source.allowedOrigins.includes(norm)) {
      return NextResponse.json({ error: "허용되지 않은 출처" }, { status: 403, headers });
    }
  }

  const config = normalizeCollectForm(source.formConfig);
  // 운영자가 켜지 않았으면 조회 자체가 없다 — 켜면 이메일 하나만 아는 사람에게 QR 을
  // 보여 주는 화면이라, 의식적으로 켜야 한다(정규화의 기본값도 꺼짐이다).
  if (!config.lookup.enabled) return notFound(headers);

  const criteria = buildLookupCriteria(config, body);
  if (!criteria) return notFound(headers);

  // 입력값 기준 한도 — 같은 사람을 반복 조회하는 봇넷을 막는다(IP 한도로는 못 막는다).
  for (const [kind, value] of [["e", criteria.emailNormalized], ["p", criteria.phoneE164]] as const) {
    if (!value) continue;
    const rl = await rateLimitAsync(valueKey(kind, source.id, value), { limit: 10, windowMs: 10 * 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "요청이 너무 잦아요. 잠시 후 다시 시도해주세요." },
        { status: 429, headers: { ...headers, "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() } },
      );
    }
  }

  /**
   * ── 누구의 레코드인가 ────────────────────────────────────────────────
   *
   * 예전에는 `OR:[이메일, 전화]` 를 한 번에 던지고 `createdAt asc` 로 첫 건을 집었다.
   * 그러면 **전화 끝자리 오타 하나로 남의 티켓이 나온다** — 내 이메일은 정확한데 오타 난
   * 번호가 먼저 등록한 사람과 맞으면, 더 오래된 그 사람의 이름·유형·등록번호·QR 이
   * 내 화면에 뜬다. 전화는 유니크가 아니라 부부·회사 대표번호로도 같은 일이 생긴다.
   *
   * 그래서 **이메일을 먼저 보고, 없을 때만 전화로 내려간다.** 이메일은 (sourceId,
   * emailNormalized) 부분 유니크라 한 사람을 정확히 가리킨다.
   * 전화로 내려갔는데 **여러 건이 맞으면 아무것도 돌려주지 않는다** — 그중 하나를 고르는
   * 것은 곧 절반의 확률로 남의 티켓을 주는 일이다.
   */
  const pick = (rows: { id?: string; registrationNo: string | null; data: unknown }[]) => rows[0] ?? null;
  const SELECT = { id: true, registrationNo: true, data: true } as const;

  let record: { id?: string; registrationNo: string | null; data: unknown } | null = null;

  if (criteria.logic === "and") {
    // and 는 buildLookupCriteria 가 둘 다 있을 때만 통과시킨다 — 그대로 AND 로 옮긴다.
    record = await prisma.collectRecord.findFirst({
      where: { sourceId: source.id, emailNormalized: criteria.emailNormalized, phoneE164: criteria.phoneE164 },
      select: SELECT,
    });
  } else {
    if (criteria.emailNormalized) {
      record = await prisma.collectRecord.findFirst({
        where: { sourceId: source.id, emailNormalized: criteria.emailNormalized },
        select: SELECT,
      });
    }
    if (!record && criteria.phoneE164) {
      // 두 건까지만 읽으면 "여럿인가" 를 판정할 수 있다 — 전체를 세지 않는다.
      const byPhone = await prisma.collectRecord.findMany({
        where: { sourceId: source.id, phoneE164: criteria.phoneE164 },
        select: SELECT,
        take: 2,
      });
      // 여럿이면 못 찾은 것으로 답한다. 아무거나 주는 것보다 "못 찾았다" 가 낫다.
      record = byPhone.length === 1 ? pick(byPhone) : null;
    }
  }
  if (!record) return notFound(headers);

  const view = buildLookupView(config, record);
  if (!view) return notFound(headers);

  return NextResponse.json({ found: true, ...view }, { headers });
}
