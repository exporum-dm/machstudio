import { after, NextResponse } from "next/server";
import { signalLive } from "@/lib/webinar-live-signal";
import { prisma } from "@/lib/prisma";
import { rateLimitAsync } from "@/lib/ratelimit";
import { resolveWebinarStatus } from "@/lib/webinar-status";
import { normalizeQaMode } from "@/lib/webinar-config";
import { maskName } from "@/lib/mask";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const webinar = await prisma.webinar.findUnique({ where: { slug }, select: { id: true, components: true } });
  if (!webinar) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 });

  // 폐쇄형이면 질문은 주최자만 본다 → 목록을 내보내지 않는다.
  // live-state 만 막아선 안 된다. 이 라우트는 Q&A 모달이 1회 로드하는 별도 경로이고
  // 인증도 없어서(CORS *) 열어 두면 폐쇄형이 이름만 폐쇄형이 된다.
  const qaMode = normalizeQaMode(webinar.components);
  if (qaMode === "closed") {
    return NextResponse.json({ questions: [], qaMode }, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // 등록자 게이트 — live-state 와 같은 규칙. Q&A 보드는 등록자 전용 콘텐츠인데
  // 이 GET 만 게이트가 없어서, live-state 를 막아 둔 의미가 이 경로로 무효화됐다.
  const registrationId = new URL(request.url).searchParams.get("registrationId");
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
  const rl = await rateLimitAsync(`webinar-qa:${slug}:${ip}`, { limit: 30, windowMs: 60_000 });
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

  if (!question?.trim()) {
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
  const displayName = reg.name || nameValue;

  const qa = await prisma.webinarQA.create({
    data: {
      webinarId: webinar.id,
      question: questionValue,
      sessionNumber: sessionNumber ?? null,
      name: displayName,
      company: companyValue,
      phone: phoneValue,
      email: emailValue,
    },
  });

  after(() => signalLive(webinar.id, "qa"));
  return NextResponse.json({ qa: { id: qa.id } }, {
    status: 201,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
