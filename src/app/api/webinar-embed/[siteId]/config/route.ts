/**
 * 웨비나 임베드 공개 설정 — 로더가 런타임에 읽는 단일 계약.
 *
 * - 무인증. youtubeId·등록자 수 등 민감 값은 노출하지 않는다.
 * - 서버가 activeWebinarId 로 웨비나를 해석 — 전시 전환은 어드민에서 이 값만 교체.
 * - 캐시: s-maxage=60 + swr=300 → 수동 오버라이드도 방문자에게 최대 ~1분 내 전파,
 *   오리진(Supabase) 조회는 CDN이 흡수한다. CORS 는 * (Origin echo 는 캐시 파편화 유발).
 */
import { buildIcs } from "@/lib/webinar-calendar";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveWebinarStatus } from "@/lib/webinar-status";
import { endedSurveyLinks } from "@/lib/webinar-ended-surveys";
import { buildPublicRegistrationFormPayload, publicRegistrationFormLocales } from "@/lib/webinar-public-registration-form";
import { parseLocaleSignalParam, resolveLocaleFromRawSignals } from "@/lib/form-locale";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

/**
 * 이 응답에는 **상태**가 들어 있다(statusOverride·입장 오픈). SWR 300 이면 CDN 이 최대 5분
 * 묵은 상태를 내줄 수 있어, 라이브로 전환해도 배너가 한참 사전등록으로 남았다.
 * 60 초로 줄여 최악이 ~2분이 되게 한다(원본 조회는 가벼운 select 몇 개다).
 */
const CACHE_OK = "public, s-maxage=60, stale-while-revalidate=60";
const CACHE_MISS = "public, s-maxage=60";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  });
}


// 허용 오리진 비교 — 스킴+호스트+포트만 본다(경로·서브도메인 부분일치는 인정하지 않는다).
function originAllowed(reqOrigin: string | null, allowed: string[]) {
  if (!allowed.length) return true; // 미설정 = 제한 없음(기존 동작 유지)
  if (!reqOrigin) return false;
  const norm = (v: string) => { try { return new URL(v).origin.toLowerCase(); } catch { return ""; } };
  const target = norm(reqOrigin);
  return !!target && allowed.some((a) => norm(a) === target);
}

export async function GET(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;

  /**
   * **호스트 페이지의 언어 신호**(hl=a|b|c|d). 로더가 네 값을 읽어 **판정 없이** 실어 보내고,
   * 고르는 일은 여기서 한다 — 손으로 쓴 로더 스크립트 안에 언어 판정이 한 벌 더 생기면
   * 반드시 정본과 갈라진다(색 계산이 네 벌로 갈라져 생긴 사고가 이미 있다).
   *
   * 캐시가 언어마다 갈라지지만, 실제로 나타나는 값은 사이트당 한두 개뿐이다
   * (그 사이트가 실제로 번역해 둔 언어로 좁혀지므로).
   */
  const localeSignals = parseLocaleSignalParam(new URL(req.url).searchParams.get("hl"));

  const site = await prisma.webinarEmbedSite.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      isActive: true,
      deletedAt: true,
      livePageUrl: true,
      bannerPagePatterns: true,
      allowedOrigins: true,
      activeWebinar: {
        select: {
          id: true, // 자체 설문(종료 화면 연결) 조회용
          slug: true,
          name: true,
          description: true,
          liveStartAt: true,
          liveEndAt: true,
          signupDeadline: true,
          statusOverride: true,
          theme: true,
          config: true,
          components: true,
          updatedAt: true,
          // sessions 는 로더가 렌더하지 않음(아젠다는 라이브 페이지 iframe 담당) — 미전송으로 페이로드 절감
          project: { select: { deletedAt: true } }, // 삭제 유예(30일) 중인 프로젝트 판정용
        },
      },
    },
  });

  // activeWebinar.project.deletedAt 이 있으면 그 프로젝트가 삭제 유예 중 — 사이트 자체는 살아 있어도
  // 그 웨비나는 지금 노출 중인 웨비나가 없는 것과 동일하게 처리한다.
  if (!site || site.deletedAt !== null || !site.isActive || !site.activeWebinar || site.activeWebinar.project.deletedAt !== null) {
    return NextResponse.json(
      { error: "노출 중인 웨비나가 없어요" },
      { status: 404, headers: { ...CORS_HEADERS, "Cache-Control": CACHE_MISS } },
    );
  }

  // 허용 오리진이 설정돼 있으면 실제로 막는다 — siteId 만 알면 아무 도메인에나
  // 스니펫을 붙여 진짜 등록 폼을 띄울 수 있던 구멍.
  // 오리진별 응답이 갈리므로 이 경우엔 CDN 공유 캐시를 끈다(private).
  const allowedOrigins = site.allowedOrigins ?? [];
  if (allowedOrigins.length) {
    const reqOrigin = req.headers.get("origin") ?? req.headers.get("referer");
    if (!originAllowed(reqOrigin, allowedOrigins)) {
      return NextResponse.json(
        { error: "이 사이트에서는 사용할 수 없는 위젯이에요" },
        { status: 403, headers: { ...CORS_HEADERS, "Cache-Control": "private, no-store" } },
      );
    }
  }

  const webinar = site.activeWebinar;
  const statusInfo = resolveWebinarStatus(webinar);
  const config = (webinar.config ?? {}) as Record<string, unknown>;

  // 신호를 **실제로 번역이 있는 언어**로 좁힌다. 번역이 없는 언어를 고르면 문구마다 원문으로
  // 폴백해 화면이 그대로인데, 운영자는 "영문 페이지인데 왜 국문이지" 에서 멈춘다.
  const formLocales = publicRegistrationFormLocales(webinar.config);
  const viewerLocale = resolveLocaleFromRawSignals(localeSignals, formLocales.locales, formLocales.defaultLocale);

  // 절대 URL 기준 — 스니펫/로더가 파트너 사이트에서 실행되므로 배포 오리진이어야 한다(w/l 라우트와 동일 방식).
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

  // 종료 화면에 연결된 자체 설문 — 라이브 페이지(info 라우트)와 같은 우선순위를 임베드에도 적용한다.
  // 이걸 안 실어 보내면 자체 설문만 설정한 웨비나는 아임웹 종료 배너·히어로가 통째로 비어 버린다.
  /**
   * 종료 화면 설문은 여러 개 걸 수 있지만 **임베드 배너·히어로는 CTA 한 줄**이라 첫 번째만 쓴다.
   * 파트너 사이트 배너에 설문 버튼을 N개 늘어놓는 건 그 자리의 역할(한 줄 알림)에 맞지 않는다.
   * 전체 목록이 필요하면 배너의 링크가 종료 화면으로 보내고, 거기서 카드 N장을 보여준다.
   *
   * orderBy 는 결정론을 위한 것이다 — 정렬 없는 findFirst 는 여러 개가 되는 순간
   * 어느 설문이 뽑힐지 DB 순서에 달리고, 캐시된 임베드 설정이 조용히 다른 링크를 갖게 된다.
   */
  /**
   * 응답 기간으로 걸러 **뽑지 않는다** — 두 가지 이유.
   * (1) 시작 예약·마감 창에서 자체 설문이 "없는 것" 이 되면 endedSurveyLinks 가 옛 외부
   *     surveyUrl 로 폴백해, 파트너 사이트 배너가 **지웠다고 생각한 옛 폼**을 가리킨다.
   * (2) 이 payload 는 CDN 에 캐시된다 — 시각에 따라 달라지는 값을 굳히면 예약 시각이 지나도
   *     캐시가 만료될 때까지 옛 판정이 남는다. 링크는 시각과 무관하게 고정하고, 열림 여부는
   *     그 링크가 가리키는 응답 페이지가 스스로 말한다("아직 열리지 않았어요" + 시각).
   * off(운영자가 끔)·closed 인 설문도 링크는 유지된다 — 응답 페이지가 이유를 말하므로
   *     옛 외부 폼으로 보내는 것보다 정확하다.
   */
  const endedSurvey = await prisma.webinarSurvey.findFirst({
    where: { webinarId: webinar.id, showOnEnded: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  /* 자체 설문 vs 외부 URL 의 배타적 폴백은 뷰어와 같은 함수로 판정한다 —
     한쪽만 고치면 같은 웨비나가 면에 따라 다른 설문을 가리킨다. 여기서는 첫 번째만 쓴다. */
  const endedSurveyUrl =
    endedSurveyLinks(
      endedSurvey ? [endedSurvey] : [],
      config.surveyUrl,
      (id) => `${appOrigin}/webinar/${encodeURIComponent(webinar.slug)}/survey/${id}?src=ended`,
    )[0]?.url ?? null;

  const payload = {
    slug: webinar.slug,
    name: webinar.name,
    status: statusInfo.status,
    statusOverride: webinar.statusOverride ?? null,
    serverNow: new Date().toISOString(),
    entryOpenAt: statusInfo.entryOpenAt.toISOString(),
    liveStartAt: webinar.liveStartAt.toISOString(),
    liveEndAt: webinar.liveEndAt.toISOString(),
    signupDeadline: webinar.signupDeadline.toISOString(),
    canRegister: statusInfo.canRegister,
    // 어드민 수정 시 열려 있는 페이지도 재렌더되도록 하는 렌더 키 (로더가 상태와 함께 비교)
    updatedKey: webinar.updatedAt.toISOString(),
    // 클라 live-중 등록 재판정용: 명시 설정만 boolean 으로 내리고, 미설정이면 null →
    // 로더가 signupDeadline 을 실시간 비교(서버 규칙과 동일). fetch 시점 boolean 고정 금지.
    allowLiveRegistration: (() => {
      const comps = (webinar.components ?? {}) as Record<string, unknown>;
      return typeof comps.allowLiveRegistration === "boolean" ? comps.allowLiveRegistration : null;
    })(),
    theme: webinar.theme ?? {},
    components: webinar.components ?? {},
    registrationForm: buildPublicRegistrationFormPayload(webinar.config, viewerLocale),
    links: {
      livePageUrl: site.livePageUrl ?? null,
      surveyUrl: endedSurveyUrl,
      calendarUrl: typeof config.calendarUrl === "string" ? config.calendarUrl : null,
    },
    ics: buildIcs(webinar),
    bannerPagePatterns: site.bannerPagePatterns,
  };

  return NextResponse.json(payload, {
    // 오리진 제한이 걸린 사이트는 응답이 요청 오리진에 따라 달라지므로 공유 캐시 금지.
    headers: { ...CORS_HEADERS, "Cache-Control": allowedOrigins.length ? "private, max-age=60" : CACHE_OK },
  });
}
