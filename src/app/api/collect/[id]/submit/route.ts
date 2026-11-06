/**
 * 빌더형 등록 제출 (설계 §19).
 *
 * **연동형(`POST /api/collect`)과 라우트를 나눈다.** 그쪽은 외부 폼의 제출을 가로채는
 * 입구라 `data` 를 그대로 받는다 — 빌더형이 그 경로를 타면 formConfig 검증·접수 창·동의가
 * 전부 건너뛰어진다. 두 계약을 한 함수에 넣으면 한쪽을 고칠 때 다른 쪽이 조용히 열린다.
 *
 * ── API 키를 쓰지 않는 이유 ────────────────────────────────────────────
 * 빌더형 폼은 우리가 `/f/{id}` 로 배급하므로 **id 자체가 이미 공개값**이다. 여기에 apiKey 를
 * 요구해도 그 키는 같은 번들에 실려 브라우저로 나가고, 유출돼 재발급해도 공격자는 `/f/{id}` 를
 * 다시 열어 새 키를 얻는다 — 보호가 아니라 의식(儀式)이다. 실제 방어선은 Origin 검증,
 * 레이트리밋, 허니팟, 그리고 서버 검증이다.
 */
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { fireWebhook } from "@/lib/webhook";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { submissionInputFromBody, prepareBuilderSubmission } from "@/lib/collect-submit";
import { nextDomesticRegistrationNo } from "@/lib/collect-registration-counter";
import { generateRegistrationNo } from "@/lib/collect-registration-no";
import { buildCollectConfirmationEmail } from "@/lib/collect-confirmation-email";
import { sendEmail } from "@/lib/email";
import { qrPngBuffer } from "@/lib/collect-qr";

function normalizeOrigin(s: string): string {
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return s.trim().toLowerCase();
  }
}

/**
 * 임베드는 파트너 도메인에서 우리 오리진으로 POST 한다 — CORS 가 필수다.
 * allowedOrigins 가 비어 있으면 `*` 를 준다(연동형과 같은 기본값). 붙일 사이트가 정해지면
 * 설정에서 좁힌다 — 처음부터 잠그면 "붙였는데 안 됩니다" 문의가 오픈 직전에 몰린다.
 */
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

const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
} as const;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...PREFLIGHT_HEADERS, "Access-Control-Max-Age": "86400" },
  });
}

/**
 * 유니크 충돌인가. **어느 제약인지는 묻지 않는다** — 드라이버 어댑터(PrismaPg)를 쓰면
 * Prisma 가 `meta.target` 을 채우지 않는다(실측: meta 가 `{modelName, driverAdapterError}` 뿐).
 * 제약 이름으로 갈래를 타는 코드는 여기서 조용히 500 이 된다.
 *
 * instanceof 대신 code 를 본다 — 생성된 클라이언트가 여러 경로로 import 되면 클래스 동일성이
 * 깨질 수 있고, 그때도 code 는 그대로다.
 */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = request.headers.get("origin");

  /**
   * 레이트리밋을 **DB 조회보다 먼저** 건다. 연동형 라우트는 순서가 반대라 잘못된 키를
   * 난사해도 매 요청이 쿼리 한 번인데, 이 저장소는 커넥션 풀 고갈로 실제 장애를 겪었다.
   */
  const ip = getClientIp(request);
  /**
   * 키에 **id 를 넣지 않는다.** id 는 URL 세그먼트라 요청자가 매번 바꿀 수 있고, 그러면
   * 요청마다 새 버킷이 생겨 한도가 사실상 사라진다(그리고 매 요청이 소스 조회 한 번이다).
   * 소스별 한도가 필요해지면 소스를 로드한 **뒤에** 따로 건다.
   */
  const rl = await rateLimitAsync(`collect-submit:${ip}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 잦아요. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { ...PREFLIGHT_HEADERS, "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400, headers: PREFLIGHT_HEADERS });
  }

  const source = await prisma.collectSource.findUnique({ where: { id } });
  if (!source || !source.isActive || source.mode !== "builder" || source.deletedAt) {
    return NextResponse.json({ error: "등록을 받을 수 없어요" }, { status: 404, headers: PREFLIGHT_HEADERS });
  }

  const headers = corsHeaders(origin, source.allowedOrigins ?? []);
  if (source.allowedOrigins && source.allowedOrigins.length > 0) {
    const o = origin ? normalizeOrigin(origin) : "";
    if (!o || !source.allowedOrigins.includes(o)) {
      return NextResponse.json({ error: "허용되지 않은 출처" }, { status: 403, headers });
    }
  }

  // 허니팟 — 봇이 자동완성하는 hidden 필드. 봇에게는 성공처럼 답해 재시도를 막는다.
  const hp = body._hp ?? body.honeypot ?? body.website;
  if (typeof hp === "string" && hp.trim() !== "") {
    return NextResponse.json({ ok: true, registrationNo: null }, { status: 200, headers });
  }

  // ── 검증 — 런타임과 **같은 함수** ───────────────────────────────────
  const config = normalizeCollectForm(source.formConfig);
  // 본문 → 입력 변환은 collect-submit 한 곳에 있다. 여기서 손으로 고르면 항목이 늘 때 떨어진다.
  const prep = prepareBuilderSubmission(config, submissionInputFromBody(body), new Date());

  if (!prep.ok) {
    if (prep.code === "closed") {
      // 클라이언트가 화면을 마감으로 바꿔야 하므로 상태를 함께 준다.
      return NextResponse.json(
        { error: "지금은 등록을 받지 않아요", status: prep.status },
        { status: 403, headers },
      );
    }
    return NextResponse.json({ error: "입력을 확인해 주세요", issues: prep.issues }, { status: 400, headers });
  }

  const p = prep.prepared;
  const utm = (body._utm ?? null) as Record<string, unknown> | null;
  const pick = (k: string) => (utm && typeof utm[k] === "string" ? (utm[k] as string) : null);

  const base = {
    sourceId: source.id,
    projectId: source.projectId,
    workspaceId: source.workspaceId,
    // 동의는 항목 키와 섞지 않는다 — CSV 열이 뒤죽박죽이 되고, 나중에 필수 동의를 항목으로
    // 착각해 지우는 사고가 난다. 예약 접두를 붙여 한 칸에 같이 둔다.
    data: {
      ...p.data,
      __consent_privacy: p.consent.privacy,
      __consent_marketing: p.consent.marketing,
      __consent_thirdParty: p.consent.thirdParty,
    } as never,
    emailNormalized: p.emailNormalized,
    phoneE164: p.phoneE164,
    locale: p.locale,
    entryChannel: p.entryChannel,
    utmSource: pick("utmSource"),
    utmMedium: pick("utmMedium"),
    utmCampaign: pick("utmCampaign"),
    utmTerm: pick("utmTerm"),
    utmContent: pick("utmContent"),
    utmId: pick("utmId"),
    firstUtmSource: pick("firstUtmSource"),
    firstUtmMedium: pick("firstUtmMedium"),
    firstUtmCampaign: pick("firstUtmCampaign"),
    firstUtmTerm: pick("firstUtmTerm"),
    firstUtmContent: pick("firstUtmContent"),
    firstUtmId: pick("firstUtmId"),
    firstReferrer: pick("firstReferrer"),
    referrer: request.headers.get("referer"),
    userAgent: request.headers.get("user-agent"),
    ip: ip === "unknown" ? null : ip,
    emailStatus: config.confirmationEmail.enabled
      ? (p.emailNormalized ? "pending" : "missing_recipient")
      : null,
  };

  /**
   * 충돌은 두 제약에서 날 수 있다 — `registrationNo`(전역 유니크)와
   * `(sourceId, emailNormalized)`(부분 유니크). 어느 쪽인지 예외가 알려 주지 않으므로
   * **부딪힌 뒤에 되물어본다**: 그 이메일이 실제로 이미 있으면 중복이고(409), 없으면
   * 번호가 겹친 것이니 다시 뽑아 재시도한다(설계 §9.1, 최대 5회).
   *
   * 이 되물음은 **충돌한 요청에서만** 돈다 — 평상시 제출에는 쿼리가 늘지 않는다.
   * 미리 조회해서 거르는 방식은 동시 제출을 못 막기 때문에(둘 다 "없음" 을 읽는다) 쓰지 않는다.
   * **DB 제약이 최종 방어선**이라는 §6.2 의 결론이 그대로다.
   */
  let registrationNo = p.registrationNo;
  let recordId: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const record = config.builderVariant === "domestic"
        ? await prisma.$transaction(async tx => {
            const nextNo = await nextDomesticRegistrationNo(tx, config.registrationPrefix);
            return tx.collectRecord.create({ data: { ...base, registrationNo: nextNo } });
          })
        : await prisma.collectRecord.create({ data: { ...base, registrationNo } });
      registrationNo = record.registrationNo ?? registrationNo;
      recordId = record.id;
      break;
    } catch (e) {
      if (e instanceof Error && /등록번호 발급|check.*constraint/i.test(e.message)) {
        return NextResponse.json({ error: "등록번호 발급 한도에 도달했어요. 운영자에게 문의해 주세요." }, { status: 503, headers });
      }
      if (!isUniqueViolation(e)) throw e;

      if (p.emailNormalized) {
        const dup = await prisma.collectRecord.findFirst({
          where: { sourceId: source.id, emailNormalized: p.emailNormalized },
          select: { id: true },
        });
        if (dup) {
          return NextResponse.json(
            // duplicateKey — 어느 칸 밑에 안내를 붙일지. 이메일 항목이 여러 개인 폼에서
            // 클라이언트가 "첫 이메일 항목" 을 다시 추측하면 빈 칸에 붙는다.
            { error: "이미 등록된 이메일이에요", duplicateField: "email", duplicateKey: p.emailKey },
            { status: 409, headers },
          );
        }
      }
      registrationNo = generateRegistrationNo();
    }
  }

  if (!recordId) {
    // 5회 연속 번호 충돌 — 사실상 일어나지 않지만, 조용히 200 을 주면 등록이 사라진다.
    return NextResponse.json({ error: "등록번호를 발급하지 못했어요" }, { status: 503, headers });
  }
  const committedRecordId = recordId;

  /**
   * 응답 이후 작업은 `after()` 안에서 돈다. 그냥 떠 있는 프로미스로 두면 서버리스에서
   * 응답 직후 인스턴스가 얼어붙어 **웹훅과 알림이 무작위로 유실된다** — 등록은 저장됐는데
   * 파트너 시스템과 담당자에게는 아무것도 안 가는, 알아채기 어려운 실패다.
   */
  after(async () => {
    if (config.confirmationEmail.enabled && p.emailNormalized && registrationNo) {
      try {
        // 같은 후처리가 재진입해도 pending 한 작업 하나만 발송권을 얻는다.
        const claimed = await prisma.collectRecord.updateMany({
          where: { id: committedRecordId, emailStatus: "pending" },
          data: { emailStatus: "sending", emailError: null },
        });
        if (claimed.count === 1) {
          const message = buildCollectConfirmationEmail({
            config,
            sourceName: source.name,
            locale: p.locale,
            registrationNo,
            data: p.data,
          });
          const attachments = config.confirmationEmail.showQr
            ? [{
                content: (await qrPngBuffer(registrationNo)).toString("base64"),
                filename: `Korea-Expo-registration-${registrationNo}.png`,
                contentId: message.qrContentId,
              }]
            : undefined;
          const replyTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.confirmationEmail.replyTo)
            ? config.confirmationEmail.replyTo
            : undefined;
          const result = await sendEmail({
            to: p.emailNormalized,
            subject: message.subject,
            html: message.html,
            replyTo,
            idempotencyKey: `collect-confirmation/${committedRecordId}`,
            attachments,
          });
          await prisma.collectRecord.update({
            where: { id: committedRecordId },
            data: result.sent
              ? { emailStatus: "sent", emailSentAt: new Date(), emailError: null }
              : {
                  emailStatus: result.skipped ? "skipped" : "failed",
                  emailError: (result.error || "RESEND_API_KEY is not configured").slice(0, 500),
                },
          });
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : "confirmation email failed";
        console.warn("[collect-confirmation-email] failed:", error);
        await prisma.collectRecord.update({
          where: { id: committedRecordId },
          data: { emailStatus: "failed", emailError: error.slice(0, 500) },
        }).catch(() => undefined);
      }
    }

    if (source.webhookUrl) {
      fireWebhook(source.webhookUrl, {
      event: "record.created",
      sourceId: source.id,
      sourceName: source.name,
      recordId: committedRecordId,
        registrationNo,
        data: p.data,
        createdAt: new Date().toISOString(),
      });
    }

    if (source.notifyOnSubmit) {
      try {
        const members = await prisma.workspaceMember.findMany({
          where: { workspaceId: source.workspaceId },
          select: { userId: true },
        });
        if (members.length > 0) {
          await prisma.notification.createMany({
            data: members.map((m) => ({
              userId: m.userId,
              type: "COLLECT_SUBMITTED",
              data: { sourceId: source.id, sourceName: source.name, recordId: committedRecordId } as never,
            })),
          });
        }
      } catch (e) {
        console.warn("[notify] failed:", e);
      }
    }
  });

  /**
   * `rid` 는 전환 중복 집계를 막는 키다(설계 §8) — 완료 페이지 새로고침으로 태그가 다시
   * 발화해도 Meta eventID / GA4 transaction_id 가 같으면 자동 병합된다.
   * **등록번호를 그대로 쓰지 않는다** — 그 값은 입장에 쓰이는데 광고 플랫폼과 브라우저
   * 기록에 남게 되기 때문이다(§8 "{regNo}는 URL에 넣지 않기를 권한다").
   */
  return NextResponse.json({ ok: true, registrationNo, rid: recordId, ...(config.builderVariant === "domestic" ? { ticketKey: recordId } : {}) }, { status: 201, headers });
}
