/**
 * 홈페이지 임베드 로더의 **공통 몸통**.
 *
 *   <script async src="https://machstudio.vercel.app/h/{PAGE_ID}"></script>       페이지 통짜
 *   <script async src="https://machstudio.vercel.app/h/{PAGE_ID}/{SID}"></script> 구획 하나
 *
 * 두 라우트가 같은 번들·같은 캐시 정책·같은 게이트를 쓴다. 각자 적으면 한쪽만 고쳐지고
 * 그 차이는 파트너 페이지에서 처음 드러난다(폼 로더와 같은 이유).
 *
 * ── 검사 순서가 곧 안전이다 ───────────────────────────────────────────
 * ① 공개 승인(순수 문자열 비교) — **DB 를 건드리기 전에**. 아직 아무에게도 공개하지 않은
 *    기능이라 승인 전에는 한 글자도 나가면 안 되고, 그 판정에 커넥션을 쓸 이유도 없다.
 * ② IP 레이트리밋 — 인증 없이 DB 를 여는 경로다. 이 저장소는 커넥션 풀 고갈로 실제
 *    장애를 겪었다(2026-08-11).
 * ③ 스키마 준비 확인(캐시된 카탈로그 조회) — 준비 전에는 Expo 델리게이트를 부르지 않는다.
 * ④ 공개 절대 주소 — 없거나 프리뷰 배포면 **503**. 요청 호스트로 대체하지 않는다.
 * ⑤ 조회·게이트·페이로드.
 *
 * ── 주석에 id 를 넣지 않는다 ──────────────────────────────────────────
 * id 는 URL 세그먼트라 `%2F` 로 "별표+슬래시" 를 만들어 주석을 닫고, 우리 오리진에서
 * 서빙되는 스크립트 본문에 임의 JS 를 넣을 수 있다(랜딩 로더에서 실제로 있었던 취약점).
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { jsonForScript } from "@/lib/script-json";
import { EXPO_RUNTIME_JS, EXPO_RUNTIME_SRC_HASH } from "@/generated/expo-runtime";
import { getExpoCapabilities, isExpoPublicEmbedReleaseEnabled } from "@/lib/expo/capability";
import { probeExpoSchema } from "@/lib/expo/schema-probe";
import { getRequiredExpoPublicOrigin } from "@/lib/expo/origin";
import { normalizeExpoTheme } from "@/lib/expo/config";
import { normalizeLocaleTag, parseLocaleSignalParam, resolveLocaleFromRawSignals } from "@/lib/form-locale";
import { expoContentLocales } from "@/lib/expo/i18n";
import { hasContent } from "@/lib/expo/model";
import { buildExpoPayload, collectInternalPageIds, collectSourceRefs } from "@/lib/expo/payload";
import { normalizeExpoPage } from "@/lib/expo/config";
import type { ExpoSection } from "@/lib/expo/types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

export const SCRIPT_HEADERS = {
  "Content-Type": "application/javascript; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
  ...CORS_HEADERS,
} as const;

/** 엣지가 흡수해도 되는 응답(존재/부재가 한동안 안 바뀐다). */
export const EXPO_LIVE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
} as const;

/** 짧게만 흡수 — 없는 id 난사가 매번 DB 까지 내려가지 않게. */
const CACHEABLE_MISS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=60",
} as const;

/**
 * **절대 캐시하지 않는다.** 공개 승인이 꺼진 응답이나 설정 오류를 엣지가 물면,
 * 승인을 켠 뒤에도 한동안 빈 스크립트가 서빙된다 — 그리고 그 반대(라이브 본문이 꺼진
 * 상태의 캐시를 물려받는 것)가 더 나쁘다.
 */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function expoLoaderOptions() {
  // 공개 승인이 꺼져 있어도 204 다 — 프리플라이트 응답으로 기능 존재를 알려 주지 않는다.
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  });
}

const script = (comment: string, status: number, headers: Record<string, string>) =>
  new NextResponse(`/* mach expo: ${comment} */\n`, { status, headers: { ...SCRIPT_HEADERS, ...headers } });

interface LoaderTarget {
  pageId: string;
  /** 구획 단독이면 그 sid. */
  sid?: string | null;
}

export async function serveExpoRuntime(req: Request, target: LoaderTarget): Promise<NextResponse> {
  /**
   * ① 공개 승인. 순수 환경변수 비교라 DB·카탈로그를 건드리지 않는다.
   * 응답은 **상수**이고 no-store 다 — 켠 뒤에 꺼진 상태의 캐시를 물려받지 않게.
   */
  if (!isExpoPublicEmbedReleaseEnabled()) {
    return script("not found", 404, NO_STORE);
  }

  // ② 한도. 조회 전에 건다.
  const rl = await rateLimitAsync(`expo-loader:${getClientIp(req)}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return script("slow down", 429, { ...NO_STORE, "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() });
  }

  // ③ 스키마 준비. 아니면 Expo 델리게이트를 부르지 않는다.
  const caps = await getExpoCapabilities({ probe: probeExpoSchema });
  if (!caps.publicEmbed) return script("not found", 404, NO_STORE);

  /**
   * ④ 공개 절대 주소. 이 주소는 파트너 HTML 에 박혀 회수할 수 없으므로, 설정이
   * 잘못되면 **아무것도 내보내지 않는다.** 요청 호스트나 상대주소로 대체하지 않는다.
   */
  const originResult = getRequiredExpoPublicOrigin();
  if (!originResult.ok) {
    console.error("[expo-loader] 공개 주소 설정 오류", originResult.reason);
    return script("temporarily unavailable", 503, NO_STORE);
  }
  const origin = originResult.origin;

  // ⑤ 조회. 필요한 컬럼만 — 사이트 하나에 페이지가 50개까지다.
  let row: {
    id: string;
    published: unknown;
    liveAt: Date | null;
    site: { id: string; projectId: string; theme: unknown; defaultLocale: string; deletedAt: Date | null };
  } | null = null;
  try {
    row = await prisma.expoPage.findFirst({
      where: { id: target.pageId, deletedAt: null, site: { deletedAt: null } },
      select: {
        id: true, published: true, liveAt: true,
        site: { select: { id: true, projectId: true, theme: true, defaultLocale: true, deletedAt: true } },
      },
    });
  } catch (error) {
    /**
     * DB 가 흔들릴 때 404 를 캐시하면 **엣지가 살아 있는 콘텐츠를 없는 것으로 덮는다.**
     * 그래서 여기서는 404 가 아니라 캐시 불가 503 이다.
     */
    console.error("[expo-loader] 페이지 조회 실패", error);
    return script("temporarily unavailable", 503, NO_STORE);
  }

  if (!row || row.site.deletedAt || !row.published) {
    return script("not found", 404, CACHEABLE_MISS);
  }

  const theme = normalizeExpoTheme(row.site.theme);
  const defaultLocale = row.site.defaultLocale || "ko";
  const search = new URL(req.url).searchParams;

  /**
   * 무엇을 그릴지 고른다.
   *
   * 페이지 통짜: 공개 스위치(`liveAt`)가 꺼져 있으면 **연결 확인만** 한다.
   * 구획 단독: 페이지의 `liveAt`·`enabled` 를 보지 않는다 — 그게 부분 이행의 정의다.
   *   발행본에 그 sid 가 아예 없으면 404, 있는데 게이트가 닫혀 있으면 연결 확인.
   */
  const publishedConfig = normalizeExpoPage(row.published);
  let sections: ExpoSection[] = [];
  let connectionOnly = false;
  if (target.sid) {
    const selected = publishedConfig.sections.find((section) => section.sid === target.sid);
    if (!selected) return script("not found", 404, CACHEABLE_MISS);
    if (selected.embedEnabled && hasContent(selected)) sections = [selected];
    else connectionOnly = true;
  } else if (row.liveAt) {
    sections = publishedConfig.sections.filter((section) => section.enabled && hasContent(section));
  } else {
    connectionOnly = true;
  }

  let translations: Record<string, ReturnType<typeof buildExpoPayload>["sections"]> | undefined;
  let resolvedPayload: ReturnType<typeof buildExpoPayload> | null = null;
  if (!connectionOnly && sections.length > 0) {
    /**
     * 내부 링크는 **같은 사이트의 살아 있는 페이지**만 푼다. 형제 페이지를 한 번에
     * 모아 조회한다 — 구획마다 두드리면 페이지 하나에 수십 번 쿼리가 나간다.
     */
    const ids = collectInternalPageIds(sections);
    let siblings: Array<{ id: string; imwebUrl: string | null; deletedAt: Date | null }> = [];
    if (ids.length > 0) {
      try {
        siblings = await prisma.expoPage.findMany({
          where: { id: { in: ids }, siteId: row.site.id },
          select: { id: true, imwebUrl: true, deletedAt: true },
        });
      } catch (error) {
        // 링크를 못 풀면 그 자리는 빈 문자열이 된다 — 화면 전체를 버리지 않는다.
        console.error("[expo-loader] 형제 페이지 조회 실패", error);
      }
    }

    /**
     * 사전등록 소스 참조는 **이 사이트의 프로젝트 것인지** 서버가 다시 확인한다.
     * 아니면 홈페이지의 등록 폼이 다른 전시의 등록을 받는다.
     */
    const refs = collectSourceRefs(sections);
    let allowed = new Set<string>();
    if (refs.length > 0) {
      try {
        const sources = await prisma.collectSource.findMany({
          where: { id: { in: refs }, projectId: row.site.projectId, deletedAt: null, mode: "builder" },
          select: { id: true },
        });
        allowed = new Set(sources.map((s) => s.id));
      } catch (error) {
        console.error("[expo-loader] 소스 확인 실패", error);
      }
    }
    const safe = sections.map((section) => {
      const ref = section.content.sourceRef;
      if (typeof ref !== "string" || allowed.has(ref)) return section;
      // 확인 안 된 참조는 **비운다** — 런타임이 소스 없는 폼 구획을 그리지 않는다.
      return { ...section, content: { ...section.content, sourceRef: "" } };
    });

    const available = expoContentLocales(safe, defaultLocale);
    const forced = search.has("hl") || search.has("lang");
    const locale = resolveLocaleFromRawSignals(
      [...parseLocaleSignalParam(search.get("hl")), normalizeLocaleTag(search.get("lang"))],
      available,
      defaultLocale,
    );
    const config = { ...publishedConfig, sections: safe };
    const context = { defaultLocale, pages: siblings, now: new Date() };
    resolvedPayload = buildExpoPayload(config, { ...context, locale });
    // A single cached script can select a host language without a second loader request.
    if (!forced && available.length > 1) {
      translations = Object.fromEntries(available
        .filter((code) => code !== defaultLocale)
        .map((code) => [code, buildExpoPayload(config, { ...context, locale: code }).sections]));
    }
  }

  const payload = {
    pageId: row.id,
    ...(target.sid ? { sectionId: target.sid } : {}),
    // 공개 로더는 통짜와 구획 단독 모두 라이브다. standalone은 내보내기 산출물만 명시한다.
    mode: "live" as const,
    theme,
    origin,
    sections: resolvedPayload?.sections ?? [],
    campaigns: resolvedPayload?.campaigns ?? [],
    destinations: resolvedPayload?.destinations ?? [],
    ...(connectionOnly ? { connectionOnly: true } : {}),
    ...(translations ? { translations, defaultLocale } : {}),
  };

  const canonicalPayload = jsonForScript(payload);
  const body = `/* mach expo */\n${EXPO_RUNTIME_JS}\n__msExpo.boot(${canonicalPayload}, document.currentScript);\n`;

  /**
   * ETag 필수 — 검증자가 없으면 브라우저가 재검증을 못 해 낡은 스크립트를 계속 실행한다
   * (랜딩에서 실측: 새 탭에서도 transferSize 0 으로 캐시된 옛 번들이 돌았다).
   */
  const etag = `W/"${createHash("sha256")
    .update(EXPO_RUNTIME_SRC_HASH)
    .update("\n")
    .update(canonicalPayload)
    .digest("base64url")
    .slice(0, 27)}"`;
  const cacheHeaders = { ...EXPO_LIVE_CACHE_HEADERS, ETag: etag };

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ...SCRIPT_HEADERS, ...cacheHeaders } });
  }
  return new NextResponse(body, { status: 200, headers: { ...SCRIPT_HEADERS, ...cacheHeaders } });
}
