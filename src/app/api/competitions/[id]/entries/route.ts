import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import {
  extractYoutubeId,
  normalizeCompetitionConfig,
  normalizeMedia,
  normalizeRepeaterSubmission,
  type CompetitionMediaItem,
} from "@/lib/competition-config";
import { resolveCompetitionStatus } from "@/lib/competition-status";
import { toE164 } from "@/lib/collect-phone";
import { competitionFormStrings } from "@/lib/competition-strings";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });
}

/** 운영자용 목록 — 로그인 + 워크스페이스 멤버십 필요. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const competition = await prisma.competition.findUnique({ where: { id } });
  if (!competition) return NextResponse.json({ error: "대회 없음" }, { status: 404 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: competition.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const entries = await prisma.competitionEntry.findMany({
    where: { competitionId: id },
    orderBy: [{ sortOrder: "asc" }, { submittedAt: "asc" }],
  });

  return NextResponse.json({ entries });
}

/** 참가 신청 — 공개 엔드포인트(로그인 없음). 단계·중복·형식을 서버가 검증한다. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ip = getClientIp(request);
  const limited = rateLimit(`competition-entry:${id}:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!limited.allowed) {
    return NextResponse.json({ error: "요청이 너무 잦아요. 잠시 후 다시 시도해주세요." }, { status: 429, headers: CORS_HEADERS });
  }

  const competition = await prisma.competition.findUnique({ where: { id } });
  if (!competition) return NextResponse.json({ error: "대회 없음" }, { status: 404, headers: CORS_HEADERS });

  const config = normalizeCompetitionConfig(competition.config);
  const t = competitionFormStrings(config.language);

  // 클라이언트만 막으면 마감 후에도 API 로 들어온다 — 서버가 단계를 본다.
  const status = resolveCompetitionStatus(competition);
  if (!status.canApply) {
    return NextResponse.json({ error: t.notAcceptingNow }, { status: 403, headers: CORS_HEADERS });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400, headers: CORS_HEADERS });
  }

  // 허니팟 — 봇만 채운다. 사람에겐 보이지 않는 칸이라 값이 있으면 조용히 성공으로 응답한다.
  if (typeof body._hp === "string" && body._hp.trim()) {
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  }

  if (body.agreePrivacy !== true) {
    return NextResponse.json({ error: t.agreeRequired }, { status: 400, headers: CORS_HEADERS });
  }

  const incoming = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;

  const phoneCountries = (body.phoneCountries && typeof body.phoneCountries === "object" ? body.phoneCountries : {}) as Record<string, unknown>;

  // 정의에 없는 키는 저장하지 않는다(임의 필드 주입 차단). 필수 누락은 400.
  //
  // repeater 는 값이 문자열이 아니라 행 배열이라 별도 객체에 모은다 — data 를
  // Record<string, string> 그대로 둬야 title/teamName/contactEmail 등 아래에서 문자열
  // 메서드로 바로 쓰는 자리들이 매번 타입 좁히기 없이 그대로 동작한다.
  const data: Record<string, string> = {};
  const repeaterData: Record<string, Record<string, string>[]> = {};
  for (const field of config.form.fields) {
    if (field.type === "image" || field.type === "youtube") continue; // 미디어는 아래에서 따로

    if (field.type === "repeater") {
      const result = normalizeRepeaterSubmission(field, incoming[field.key]);
      if ("errorLabel" in result) {
        return NextResponse.json({ error: t.fieldRequired(result.errorLabel) }, { status: 400, headers: CORS_HEADERS });
      }
      if (result.items.length > 0) repeaterData[field.key] = result.items;
      continue;
    }

    const raw = incoming[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.required && !value) {
      return NextResponse.json({ error: t.fieldRequired(field.label) }, { status: 400, headers: CORS_HEADERS });
    }
    if (!value) continue;

    // 전화 항목은 사전등록과 같은 계약으로 저장한다 — E.164 한 형태(설계 §6.3).
    // 등록 확인처럼 이 값을 나중에 조회할 수 있어야 하므로 표기를 하나로 굳힌다.
    if (field.type === "tel") {
      const country = typeof phoneCountries[field.key] === "string" ? (phoneCountries[field.key] as string) : config.form.defaultCountry;
      const e164 = toE164(value, country);
      if (!e164) {
        return NextResponse.json({ error: t.phoneInvalid(field.label) }, { status: 400, headers: CORS_HEADERS });
      }
      data[field.key] = e164;
      continue;
    }

    // 클라이언트는 <input type="number"> 로 막지만, API 를 직접 두드리면 그 제약이 없다 —
    // 반복 그룹의 "인원수 항목과 연동"이 이 값을 그대로 Number() 로 읽으므로 여기서도 확인한다.
    if (field.type === "number" && !/^\d+$/.test(value)) {
      return NextResponse.json({ error: t.numberInvalid(field.label) }, { status: 400, headers: CORS_HEADERS });
    }

    data[field.key] = value;
  }

  // 미디어 — 이미지 URL 은 업로드 라우트가 만든 것, 영상은 videoId 로 정규화해서 저장한다.
  const media: CompetitionMediaItem[] = normalizeMedia(body.media);

  // 이미지 항목의 필수 체크 — media 는 어느 항목에서 올렸는지(key)를 들고 있지 않고
  // role(logo 여부)만 구분한다. "팀 로고로 써요" 항목은 role:"logo" 유무로, 그 외
  // 일반 이미지 항목은 role 이 없는 사진 유무로 본다(항목이 여러 개면 한 장만 있어도
  // 통과하는 한계는 있지만, 지금까지 아예 검사하지 않던 것보다는 낫다).
  for (const field of config.form.fields) {
    if (field.type !== "image" || !field.required) continue;
    const hasImage = field.isLogo
      ? media.some((m) => m.kind === "image" && m.role === "logo")
      : media.some((m) => m.kind === "image" && m.role !== "logo");
    if (!hasImage) {
      return NextResponse.json({ error: t.fieldRequired(field.label) }, { status: 400, headers: CORS_HEADERS });
    }
  }

  const youtubeField = config.form.fields.find((f) => f.type === "youtube");
  if (youtubeField) {
    const rawUrl = typeof incoming[youtubeField.key] === "string" ? (incoming[youtubeField.key] as string).trim() : "";
    if (rawUrl) {
      const videoId = extractYoutubeId(rawUrl);
      if (!videoId) {
        return NextResponse.json({ error: t.youtubeInvalid }, { status: 400, headers: CORS_HEADERS });
      }
      media.push({ kind: "youtube", videoId, sortOrder: media.length });
    } else if (youtubeField.required) {
      return NextResponse.json({ error: t.fieldRequired(youtubeField.label) }, { status: 400, headers: CORS_HEADERS });
    }
  }

  // 대표 이름 — 운영자가 고른 항목(기본 작품명). 비어 있으면 예전 순서로 떨어진다.
  const displayKey = config.form.displayNameKey;
  const displayValue = typeof data[displayKey] === "string" ? (data[displayKey] as string).trim() : "";
  const title = displayValue || data.title || data.teamName || data.name || "제목 없음";
  const contactEmail = data.email ? data.email.toLowerCase() : null;

  // 1팀 1작품 — maxEntriesPerApplicant 를 넘으면 막는다. 이메일 기준.
  if (contactEmail) {
    const already = await prisma.competitionEntry.count({
      where: { competitionId: id, contactEmail, status: { not: "rejected" } },
    });
    if (already >= competition.maxEntriesPerApplicant) {
      return NextResponse.json(
        { error: t.duplicateEntry, duplicate: true },
        { status: 409, headers: CORS_HEADERS },
      );
    }
  }

  // 참가번호 — 현장에서 "3번 팀"으로 부른다. 접수 순번을 쓰되 동시 제출 충돌은 재시도로 흡수한다.
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await prisma.competitionEntry.count({ where: { competitionId: id } });
    const entryNo = String(count + 1 + attempt);
    try {
      const entry = await prisma.competitionEntry.create({
        data: {
          competitionId: id,
          entryNo,
          title,
          teamName: data.teamName || null,
          summary: data.summary || null,
          data: { ...data, ...repeaterData },
          media: JSON.parse(JSON.stringify(media)),
          contactName: data.name || null,
          contactEmail,
          contactPhone: data.phone || null,
          sortOrder: count + attempt,
          // 검증만 하고 버리던 값이었다 — 여기서부터 실제로 남긴다(§compliance).
          agreePrivacy: true,
          agreeMarketing: body.agreeMarketing === true,
          agreeThirdParty: body.agreeThirdParty === true,
        },
      });
      return NextResponse.json(
        { ok: true, entryNo: entry.entryNo, message: config.form.successMessage },
        { status: 201, headers: CORS_HEADERS },
      );
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "P2002") continue; // entryNo 경합 — 다음 번호로 재시도
      console.error("[competition] entry create failed", error);
      return NextResponse.json({ error: t.submitFailed }, { status: 500, headers: CORS_HEADERS });
    }
  }

  return NextResponse.json({ error: t.busy }, { status: 503, headers: CORS_HEADERS });
}
