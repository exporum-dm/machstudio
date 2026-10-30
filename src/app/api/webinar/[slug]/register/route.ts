import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimitAsync } from "@/lib/ratelimit";
import { resolveWebinarStatus } from "@/lib/webinar-status";
import {
  CHOICE_FIELD_TYPES,
  isValidEmail,
  isValidPhone,
  maxSelectFor,
  normalizeEmail,
  normalizePhone,
  normalizeRegistrationForm,
  splitMultiValue,
} from "@/lib/webinar-config";
import { parseUtmEnvelope } from "@/lib/webinar-attribution";
import { generateShareCode, normalizeShareCode } from "@/lib/webinar-share";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const rl = await rateLimitAsync(`webinar-register:${slug}:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 잦아요. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { ...CORS_HEADERS, "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() } },
    );
  }

  const webinar = await prisma.webinar.findUnique({
    where: { slug },
    include: { project: { select: { deletedAt: true } } },
  });
  // project.deletedAt 이 있으면 그 프로젝트가 삭제 유예(30일) 중 — 파기 예정 데이터에
  // 새 등록이 쌓이는 것을 막기 위해 못 찾은 웨비나와 동일하게 응답한다.
  if (!webinar || webinar.project.deletedAt !== null) {
    return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404, headers: CORS_HEADERS });
  }

  // 상태 머신 단일 판정 — signupDeadline 직접 비교 제거.
  // registration 이면 허용, live 중에는 components.allowLiveRegistration(미설정 시 기존 마감 규칙) 을 따른다.
  const statusInfo = resolveWebinarStatus(webinar);
  if (!statusInfo.canRegister) {
    return NextResponse.json({ error: "사전등록이 마감됐어요" }, { status: 400, headers: CORS_HEADERS });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않아요" }, { status: 400, headers: CORS_HEADERS });
  }

  // 허니팟 — 봇이 자동완성하는 hidden 필드. 값이 들어오면 봇으로 간주.
  // 200 응답으로 봇이 재시도하지 못하게.
  const honeypot = (body?._hp ?? body?.honeypot ?? body?.website) as string | undefined;
  if (honeypot && String(honeypot).trim() !== "") {
    return NextResponse.json(
      { registration: { id: "skipped", name: "", email: null, phone: null } },
      { status: 201, headers: CORS_HEADERS },
    );
  }
  const { name, phone, email, company, department, jobTitle, industry, agreeMarketing, agreePrivacy, agreeThirdParty, memo, customFields } = body;

  // 길이 상한 — 예전엔 사용자 입력만 무캡이라 IP 하나로 분당 수십 MB 를 DB 에 밀어넣을 수 있었고
  // 등록자 목록·CSV 도 함께 망가졌다(userAgent·UTM 은 이미 캡이 있었다).
  const TEXT_MAX = 200;
  const MEMO_MAX = 2000;
  const tooLong = (v: unknown, max: number) => typeof v === "string" && v.length > max;
  if (
    tooLong(name, TEXT_MAX) || tooLong(phone, 50) || tooLong(email, 320) ||
    tooLong(company, TEXT_MAX) || tooLong(department, TEXT_MAX) ||
    tooLong(jobTitle, TEXT_MAX) || tooLong(industry, TEXT_MAX) || tooLong(memo, MEMO_MAX)
  ) {
    return NextResponse.json({ error: "입력이 너무 길어요" }, { status: 400, headers: CORS_HEADERS });
  }
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);
  const fields = normalizeRegistrationForm(webinar.config).fields;
  const customAnswersRaw = typeof customFields === "object" && customFields !== null && !Array.isArray(customFields)
    ? (customFields as Record<string, unknown>)
    : {};
  // config 에 정의된 키만 받는다 — 예전엔 임의 키·중첩 객체가 그대로 memo 컬럼에 직렬화됐다.
  const allowedCustomKeys = new Set(fields.filter((f) => !f.system).map((f) => f.key));
  const customAnswers: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(customAnswersRaw)) {
    if (!allowedCustomKeys.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue; // 중첩 객체·배열 거부
    const text = String(value);
    customAnswers[key] = text.length > MEMO_MAX ? text.slice(0, MEMO_MAX) : text;
  }

  for (const field of fields) {
    if (!field.required) continue;
    // 선택지가 없어 그릴 수 없는 선택형은 필수로 둬도 건너뛴다(등록 자체가 막히므로).
    // normalizeRegistrationForm 의 공개 필터와 같은 조건이어야 한다 — 어긋나면 화면에 없는
    // 항목을 서버가 요구해 등록이 영구히 막힌다.
    if (CHOICE_FIELD_TYPES.includes(field.type) && !(field.options ?? []).length && field.allowOther !== true) continue;
    const value = field.system ? body[field.key] : customAnswers[field.key];
    if (field.type === "checkbox") {
      if (!value) return NextResponse.json({ error: `${field.label} 항목에 동의해주세요` }, { status: 400, headers: CORS_HEADERS });
    } else if (String(value ?? "").trim() === "") {
      return NextResponse.json({ error: `${field.label} 항목을 입력해주세요` }, { status: 400, headers: CORS_HEADERS });
    }
  }

  /**
   * 복수 선택의 최대 개수 — 클라이언트가 막지만 서버도 센다(임베드 로더·직접 호출 경로가 있다).
   *
   * 값 자체를 선택지 목록과 대조하지는 않는다: '기타(직접입력)' 을 켜면 사용자가 쓴 문장이
   * 그대로 들어오므로 목록 검증은 그 답을 전부 막는다. 개수만 본다.
   * required 루프와 분리한 이유 — 선택하지 않은 것(빈 값)은 위에서 이미 걸렀고,
   * 여기서는 "너무 많이 골랐나" 만 판단한다.
   */
  for (const field of fields) {
    const max = maxSelectFor(field);
    if (max === null) continue;
    const raw = field.system ? body[field.key] : customAnswers[field.key];
    const picked = splitMultiValue(raw);
    if (picked.length > max) {
      return NextResponse.json(
        { error: `${field.label} 항목은 최대 ${max}개까지 선택할 수 있어요` },
        { status: 400, headers: CORS_HEADERS },
      );
    }
  }

  // 개인정보 동의는 config.fields 가 아니라 privacyText 별도 키라 위 필수 루프에 걸리지 않는다.
  // 서버에서 명시적으로 요구한다 — 예전엔 미검증 + `?? true` 라서 동의 없이 들어온 등록이
  // "동의함" 으로 기록됐다(두 렌더러 모두 이 값을 보낸다).
  if (agreePrivacy !== true) {
    return NextResponse.json(
      { error: "개인정보 수집 및 이용에 동의해주세요" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  if (!name?.trim()) {
    return NextResponse.json({ error: "이름을 입력해주세요" }, { status: 400, headers: CORS_HEADERS });
  }
  if (!normalizedPhone && !normalizedEmail) {
    return NextResponse.json({ error: "입장 확인을 위해 연락처 또는 이메일 중 하나를 입력해주세요" }, { status: 400, headers: CORS_HEADERS });
  }
  // 형식 검증 — 클라이언트 중복확인(check)과 같은 규칙. 서버에 규칙이 없으면 중복확인이 영영 잡지 못하는
  // 등록(예: 16자리 번호)이 생긴다.
  if (normalizedPhone && !isValidPhone(normalizedPhone)) {
    return NextResponse.json({ error: "올바른 연락처를 입력해주세요" }, { status: 400, headers: CORS_HEADERS });
  }
  if (normalizedEmail && !isValidEmail(normalizedEmail)) {
    return NextResponse.json({ error: "올바른 이메일을 입력해주세요" }, { status: 400, headers: CORS_HEADERS });
  }

  const memoPayload = {
    ...(memo?.trim() ? { memo: memo.trim() } : {}),
    ...(Object.keys(customAnswers).length ? { customFields: customAnswers } : {}),
  };

  // UTM 어트리뷰션 봉투 (_utm) — 로더/폼 위젯이 동봉. 없으면 전부 null 로 두고 기존 동작 유지.
  const utm = parseUtmEnvelope(body?._utm);
  const utmData = utm
    ? {
        utmSource: utm.utmSource,
        utmMedium: utm.utmMedium,
        utmCampaign: utm.utmCampaign,
        utmTerm: utm.utmTerm,
        utmContent: utm.utmContent,
        utmId: utm.utmId,
        firstUtmSource: utm.firstUtmSource,
        firstUtmMedium: utm.firstUtmMedium,
        firstUtmCampaign: utm.firstUtmCampaign,
        firstUtmTerm: utm.firstUtmTerm,
        firstUtmContent: utm.firstUtmContent,
        firstUtmId: utm.firstUtmId,
        firstReferrer: utm.firstReferrer,
        firstSeenAt: utm.firstSeenAt,
        journey: (utm.journey ?? null) as never,
        referrer: utm.referrer,
      }
    : {};
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

  /* 추천 링크로 들어온 등록 — `?ref=` 코드를 폼이 함께 보낸다(_ref).
     코드로 같은 웨비나의 추천인을 찾는다. 다른 웨비나의 코드나 없는 코드는 조용히 무시한다
     (실패시키면 링크를 잘못 복사한 시청자가 등록 자체를 못 한다). */
  const refCode = normalizeShareCode(body?._ref);
  const referrer = refCode
    ? await prisma.webinarRegistration.findFirst({
        where: { webinarId: webinar.id, shareCode: refCode },
        select: { id: true },
      })
    : null;
  // 등록 완료자에게 영상 ID 전달 (공개 /info 에서는 제거됨 — 라이브 페이지 signup→live 경로용)
  const videoId = typeof (webinar.config as Record<string, unknown>)?.youtubeId === "string"
    ? (webinar.config as Record<string, unknown>).youtubeId
    : undefined;

  const duplicate = await prisma.webinarRegistration.findFirst({
    where: {
      webinarId: webinar.id,
      OR: [
        ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        // 실시간 확인과 같은 기준으로, 과거의 대문자 포함 이메일도 중복으로 차단한다.
        ...(normalizedEmail ? [{ email: { equals: normalizedEmail, mode: "insensitive" as const } }] : []),
      ],
    },
    orderBy: { submittedAt: "asc" },
  });

  if (duplicate) {
    // 중복 제출은 차단한다(새 등록 생성 금지) — 단, 재제출이 담은 "업그레이드-안전" 신호는 보존:
    // - 동의: 명시적으로 체크한 경우에만 true 로 승격(다운그레이드 없음)
    // - 어트리뷰션: 기존 레코드가 비어 있을 때만 백필 (재방문 캠페인 성과 유실 방지)
    // 프로필 필드(회사·직함 등)는 소유권 증명이 없으므로 덮어쓰지 않는다.
    // 중복 제출은 차단만 한다. 예전엔 여기서 기존 레코드의 동의·어트리뷰션을 "업그레이드" 했는데,
    // 소유권 증명이 없어서 **남의 전화번호만 알면 그 사람의 마케팅 동의를 켤 수 있었다**
    // (409 를 받기 전에 update 가 실행됐다). 마케팅 수신 동의는 법적 효력이 있는 값이므로
    // 본인 확인 없는 변경 경로를 없앤다. 어트리뷰션 백필도 같은 이유로 제거(캠페인 성과 위조 가능).
    const dupField = normalizedPhone && duplicate.phone === normalizedPhone ? "연락처" : "이메일";
    return NextResponse.json(
      {
        error: `이미 사전등록된 ${dupField}예요. 웨비나 당일 이 ${dupField}로 바로 입장할 수 있어요.`,
        duplicateField: dupField === "연락처" ? "phone" : "email",
        alreadyRegistered: true,
      },
      { status: 409, headers: CORS_HEADERS },
    );
  }

  // DB 부분 유니크 인덱스(webinarId+phone / webinarId+lower(email))가 경쟁 조건을 막는다.
  // 위 findFirst 는 같은 순간의 동시 제출을 못 잡으므로(읽고-쓰기 사이 틈), P2002 를 중복으로 처리한다.
  // 추천 코드는 등록 시점에 발급한다 — 공유 버튼이 클릭 순간 서버 응답을 기다리지 않게 한다
  // (사용자 제스처가 끊기면 iOS 에서 공유 시트·클립보드 쓰기가 차단된다).
  const createData = (shareCode: string) => ({
    webinarId: webinar.id,
    name: name.trim(),
    phone: normalizedPhone,
    email: normalizedEmail,
    company: clean(company),
    department: clean(department),
    jobTitle: clean(jobTitle),
    industry: clean(industry),
    agreeMarketing: Boolean(agreeMarketing),
    agreeThirdParty: Boolean(agreeThirdParty),
    agreePrivacy: true, // 위에서 === true 를 강제했다
    memo: Object.keys(memoPayload).length ? JSON.stringify(memoPayload, null, 2) : null,
    ...utmData,
    userAgent,
    registeredStatus: statusInfo.status,
    shareCode,
    referredById: referrer?.id ?? null,
  });

  let registration;
  try {
    registration = await prisma.webinarRegistration.create({ data: createData(generateShareCode()) });
  } catch (e) {
    const code = (e as { code?: string }).code;
    /* 추천 코드 충돌(58비트라 사실상 없지만 유니크 제약이 있으므로) — 한 번 다시 뽑는다.
       이걸 구분하지 않으면 "이미 등록된 연락처예요" 라는 엉뚱한 오류가 나간다. */
    const target = (e as { meta?: { target?: unknown } }).meta?.target;
    const hitShareCode = Array.isArray(target)
      ? target.includes("shareCode")
      : typeof target === "string" && target.includes("shareCode");
    if (code === "P2002" && hitShareCode) {
      registration = await prisma.webinarRegistration.create({ data: createData(generateShareCode()) });
    } else if (code === "P2002") {
      const dupField = normalizedPhone ? "연락처" : "이메일";
      return NextResponse.json(
        {
          error: `이미 사전등록된 ${dupField}예요. 웨비나 당일 이 ${dupField}로 바로 입장할 수 있어요.`,
          duplicateField: normalizedPhone ? "phone" : "email",
          alreadyRegistered: true,
        },
        { status: 409, headers: CORS_HEADERS },
      );
    } else {
      throw e;
    }
  }

  return NextResponse.json(
    {
      // shareCode 는 이 등록자 본인에게만 준다 — 공유 버튼이 이 값으로 링크를 만든다.
      registration: { id: registration.id, name: registration.name, shareCode: registration.shareCode },
      ...(videoId ? { youtubeId: videoId } : {}),
    },
    { status: 201, headers: CORS_HEADERS },
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
