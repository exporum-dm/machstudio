import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimitAsync } from "@/lib/ratelimit";
import { resolveWebinarStatus } from "@/lib/webinar-status";
import { normalizeQaMode } from "@/lib/webinar-config";
import { maskName } from "@/lib/mask";
import { verifyQaHistoryToken } from "@/lib/webinar-qa-history-token";

const historyHeaders = { "Cache-Control": "private, no-store" };
const receiptFields = { id: true, question: true, sessionNumber: true, createdAt: true } as const;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const query = new URL(request.url).searchParams;
  const registrationId = query.get("registrationId");
  const personalHistory = query.get("mine") === "1";
  if (personalHistory && (!registrationId || !verifyQaHistoryToken(request.headers.get("authorization"), slug, registrationId))) {
    return NextResponse.json({ error: "입장 정보를 다시 확인해주세요." }, { status: 403, headers: historyHeaders });
  }

  const webinar = await prisma.webinar.findUnique({ where: { slug }, select: { id: true, components: true } });
  if (!webinar) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 });
  if (personalHistory) {
    const viewer = await prisma.webinarRegistration.findFirst({
      where: { id: registrationId!, webinarId: webinar.id },
      select: { id: true },
    });
    if (!viewer) return NextResponse.json({ error: "입장 정보를 다시 확인해주세요." }, { status: 403, headers: historyHeaders });
    const questions = await prisma.webinarQA.findMany({
      where: { webinarId: webinar.id, registrationId: viewer.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: receiptFields,
    });
    return NextResponse.json({ questions }, { headers: historyHeaders });
  }

  // 폐쇄형이면 질문은 주최자만 본다 → 목록을 내보내지 않는다.
  // live-state 만 막아선 안 된다. 이 라우트는 Q&A 모달이 1회 로드하는 별도 경로이고
  // 인증도 없어서(CORS *) 열어 두면 폐쇄형이 이름만 폐쇄형이 된다.
  const qaMode = normalizeQaMode(webinar.components);
  if (qaMode === "closed") {
    return NextResponse.json({ questions: [], qaMode }, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // 등록자 게이트 — live-state 와 같은 규칙. Q&A 보드는 등록자 전용 콘텐츠인데
  // 이 GET 만 게이트가 없어서, live-state 를 막아 둔 의미가 이 경로로 무효화됐다.
  const viewer = registrationId
    ? await prisma.webinarRegistration.findFirst({
        where: { id: registrationId, webinarId: webinar.id },
        select: { id: true },
      })
    : null;
  if (!viewer) {
    return NextResponse.json({ questions: [], qaMode }, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // 미채택(dismissed) 제외한 질문을 추천순으로. 이름은 서버에서 가운데 마스킹한다.
  const rows = await prisma.webinarQA.findMany({
    where: { webinarId: webinar.id, status: { not: "dismissed" } },
    orderBy: [{ voteCount: "desc" }, { createdAt: "asc" }],
    take: 100,
    select: { id: true, question: true, sessionNumber: true, status: true, createdAt: true, name: true, voteCount: true },
  });
  const questions = rows.map((q) => ({ ...q, name: q.name ? maskName(q.name) : null }));

  return NextResponse.json({ questions, qaMode }, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  /**
   * 질문 등록 — Q&A 시간이 열리면 짧은 창에 몰린다.
   *
   * 한도를 30/분에서 600/분으로 올린다. 사내망·VPN 뒤에서는 시청자 수백 명이
   * **같은 출구 IP** 를 쓰므로 예전 값으로는 500명 규모 웨비나에서 정상 사용자가 막혔다.
   * 여기는 행을 만드는 경로라 IP 만으로 두지 않고, 아래 등록 확인 직후 **등록 건당 한도**를 한 번 더 건다.
   */
  const rl = await rateLimitAsync(`webinar-qa:${slug}:${ip}`, { limit: 600, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 잦아요. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() } },
    );
  }

  const webinar = await prisma.webinar.findUnique({ where: { slug } });
  if (!webinar) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 });

  // 라이브 여부는 상태머신으로 판정 — statusOverride(운영 콘솔 수동 전환) 반영
  if (resolveWebinarStatus(webinar).status !== "live") {
    return NextResponse.json({ error: "라이브 중에만 질문을 남길 수 있어요" }, { status: 400 });
  }

  const body = await request.json();
  const { question, sessionNumber, name, company, phone, email, registrationId } = body;

  // 허니팟 — 봇 차단. 200 으로 응답.
  const honeypot = (body?._hp ?? body?.honeypot ?? body?.website) as string | undefined;
  if (honeypot && String(honeypot).trim() !== "") {
    return NextResponse.json(
      { qa: { id: "skipped" } },
      { status: 201, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }

  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "질문 내용을 입력해주세요" }, { status: 400 });
  }

  // 필드 길이 상한 — 과도한 입력 차단(chat POST 의 slice 방식과 동일)
  const questionValue = question.trim().slice(0, 1000);
  const nameValue = name?.trim().slice(0, 100) || null;
  const companyValue = company?.trim().slice(0, 100) || null;
  const phoneValue = phone?.trim().slice(0, 200) || null;
  const emailValue = email?.trim().slice(0, 200) || null;

  // 등록 후 입장한 시청자만 질문 가능 — 익명 스팸·타인 PII 주입 차단(채팅·투표와 동일 정책). 표시명은 등록명 우선.
  const reg = registrationId
    ? await prisma.webinarRegistration.findFirst({ where: { id: String(registrationId), webinarId: webinar.id }, select: { name: true } })
    : null;
  if (!reg) {
    return NextResponse.json({ error: "등록 후 입장한 시청자만 질문할 수 있어요." }, { status: 403, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  // 등록 건당 한도 — 행을 만드는 경로의 **주 방어선**. 한 사람이 분당 10건이면 넉넉하다.
  const regRl = await rateLimitAsync(`webinar-qa-reg:${registrationId}`, { limit: 10, windowMs: 60_000 });
  if (!regRl.allowed) {
    return NextResponse.json(
      { error: "질문을 너무 자주 보내고 있어요. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Access-Control-Allow-Origin": "*", "Retry-After": Math.ceil(regRl.retryAfterMs / 1000).toString() } },
    );
  }

  const displayName = reg.name || nameValue;

  const qa = await prisma.webinarQA.create({
    data: {
      webinarId: webinar.id,
      ...(verifyQaHistoryToken(request.headers.get("authorization"), slug, String(registrationId)) && { registrationId: String(registrationId) }),
      question: questionValue,
      sessionNumber: sessionNumber ?? null,
      name: displayName,
      company: companyValue,
      phone: phoneValue,
      email: emailValue,
    },
    select: receiptFields,
  });

  return NextResponse.json({ qa }, {
    status: 201,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
