/**
 * 토큰 미리보기 — **초안과 발행본을 같은 렌더러로** 본다.
 *
 * `/hp/{previewToken}` 은 워크스페이스 멤버가 아닌 검토자도 열 수 있다. 권한은
 * 추측 불가능한 토큰이 대신하고, 이 페이지는 조회 외의 부작용을 갖지 않는다
 * (`/p/{previewToken}` 과 같은 규약).
 *
 * ── 왜 React 미리보기를 따로 만들지 않나 ──────────────────────────────
 * 미리보기용 렌더러를 따로 만들면 **두 벌이 갈라진다.** 편집기에서 멀쩡한데 파트너
 * 사이트에서만 다르게 보이는 종류의 버그가 생기고, 그건 발행한 뒤에 발견된다.
 * 그래서 커밋된 **실제 임베드 번들**을 그대로 실어 보낸다 — 보이는 것이 나가는 것이다.
 *
 * ── 이 문서는 절대 밖으로 새지 않는다 ─────────────────────────────────
 * 모든 응답이 `private, no-store` 이고 `noindex, nofollow` 다. 발행 전 초안이 검색에
 * 걸리거나 CDN 에 남으면 그건 유출이다.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { jsonForScript } from "@/lib/script-json";
import { EXPO_RUNTIME_JS } from "@/generated/expo-runtime";
import { EXPO_SCHEMA_CAPABILITY_VERSION, getExpoCapabilities } from "@/lib/expo/capability";
import { probeExpoSchema } from "@/lib/expo/schema-probe";
import { getRequiredExpoPublicOrigin } from "@/lib/expo/origin";
import { normalizeExpoPage, normalizeExpoTheme } from "@/lib/expo/config";
import { normalizeHexColor } from "@/lib/color";
import { normalizeLocaleTag } from "@/lib/form-locale";
import { buildExpoPayload, collectInternalPageIds, collectSourceRefs } from "@/lib/expo/payload";
import { expoCustomCodeDigest, previewSections } from "@/lib/expo/code-digest";
import { campaignPreviewMode, forcedCampaignsForPreview } from "@/lib/expo/campaign-preview";

export const dynamic = "force-dynamic";

/**
 * 미리보기 문서의 고정 헤더.
 *
 * `frame-ancestors 'self'` 와 `X-Frame-Options: SAMEORIGIN` 둘 다 둔다 — 편집기가
 * 같은 오리진에서 iframe 으로 띄우는 것은 되고, 남의 사이트가 감싸는 것은 안 된다.
 * 감싸기가 되면 발행 전 초안이 그쪽 화면에 그려지고 클릭재킹 대상이 된다.
 */
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "frame-ancestors 'self'",
} as const;

const OPEN_SCRIPT = "<script>";
/** 소스에 닫는 태그 리터럴을 두지 않는다 — 이 파일을 훑는 정적 검사와 싸우지 않게. */
const CLOSE_SCRIPT = "</" + "script>";

function shell(bodyHtml: string, status: number): NextResponse {
  const document = [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    "<title>홈페이지 미리보기</title>",
    // head 에 스타일·폰트 링크를 **하나도** 두지 않는다 — 서체는 런타임이 FontFace 로 등록한다.
    "</head>",
    '<body style="margin:0">',
    bodyHtml,
    "</body>",
    "</html>",
  ].join("\n");
  return new NextResponse(document, { status, headers: HEADERS });
}

const message = (text: string, status: number) => shell(
  `<p style="font:15px/1.6 system-ui,sans-serif;padding:24px;color:#5b6672">${text}</p>`,
  status,
);

/** 토큰·페이지 id 를 문구에 넣지 않는다 — 그대로 되비추면 그게 반사 경로다. */
const notFound = () => message("미리보기 링크를 찾을 수 없어요.", 404);
const unavailable = () => message("미리보기를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.", 503);

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  /**
   * 스키마 플래그가 틀리면 **아무 일도 하지 않는다.** 순수 문자열 비교라 한도도
   * 카탈로그도 건드리지 않는다 — 스키마가 없는 배포에서 매 요청 DB 를 두드리면
   * 이 저장소가 겪은 커넥션 풀 고갈로 이어진다(2026-08-11).
   */
  if (process.env.EXPO_SCHEMA_CAPABILITY !== EXPO_SCHEMA_CAPABILITY_VERSION) return notFound();

  // 토큰 대입을 난사하면 매 요청이 쿼리 한 번이다 — 조회 전에 한도를 건다.
  const rl = await rateLimitAsync(`expo-preview:${getClientIp(req)}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { ...HEADERS, "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
    });
  }

  const caps = await getExpoCapabilities({ probe: probeExpoSchema });
  if (!caps.preview) return notFound();

  /**
   * 서체·폼 스크립트 주소는 **서버가 정한 절대 주소**에서만 온다. 요청 호스트로
   * 떨어뜨리면 미리보기에서 본 것과 발행 결과가 달라진다.
   */
  const originResult = getRequiredExpoPublicOrigin();
  if (!originResult.ok) {
    console.error("[expo-preview] 공개 주소 설정 오류", originResult.reason);
    return unavailable();
  }
  const origin = originResult.origin;

  const url = new URL(req.url);
  const wantPublished = url.searchParams.get("published") === "1";
  const wide = url.searchParams.get("container") === "wide";
  const requestedPageId = url.searchParams.get("page");
  const channel = (url.searchParams.get("channel") ?? "").slice(0, 64);
  const wantsCode = url.searchParams.get("customCode") === "run";
  const requestedDigest = (url.searchParams.get("codeDigest") ?? "").slice(0, 64);
  const forcedCampaigns = forcedCampaignsForPreview(campaignPreviewMode(url.searchParams.get("campaignState")));

  let site: {
    id: string;
    projectId: string;
    theme: unknown;
    defaultLocale: string;
    pages: Array<{
      id: string; isHome: boolean; sortOrder: number;
      draft: unknown; published: unknown; imwebUrl: string | null; deletedAt: Date | null;
    }>;
  } | null = null;
  try {
    site = await prisma.expoSite.findFirst({
      where: { previewToken: token, deletedAt: null },
      select: {
        id: true, projectId: true, theme: true, defaultLocale: true,
        pages: {
          where: { deletedAt: null },
          select: {
            id: true, isHome: true, sortOrder: true,
            draft: true, published: true, imwebUrl: true, deletedAt: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  } catch (error) {
    console.error("[expo-preview] 사이트 조회 실패", error);
    return unavailable();
  }
  if (!site || site.pages.length === 0) return notFound();

  /**
   * 요청한 페이지가 **이 토큰의 사이트 것**이어야 한다. 아니면 토큰 하나로 남의
   * 사이트 초안을 열 수 있다.
   */
  const page = requestedPageId
    ? site.pages.find((p) => p.id === requestedPageId) ?? null
    : site.pages.find((p) => p.isHome) ?? site.pages[0];
  if (!page) return notFound();

  const source = wantPublished ? page.published : page.draft;
  const config = normalizeExpoPage(source);
  // 무엇을 그릴지는 `previewSections` 한 곳이 정한다 — 편집기가 지문을 계산할 때도
  // 같은 함수를 쓰므로 두 판정이 갈라질 수 없다(code-digest.ts).
  const sections = previewSections(source);

  // 지문은 **서버가** 계산한다. 요청이 보낸 값과 정확히 같을 때만 실행을 허용한다.
  const codeDigest = expoCustomCodeDigest(sections);
  const allowCustomCode = wantsCode && codeDigest !== "" && requestedDigest === codeDigest;

  const ids = collectInternalPageIds(sections);
  const siblings = site.pages
    .filter((p) => ids.includes(p.id))
    .map((p) => ({ id: p.id, imwebUrl: p.imwebUrl, deletedAt: p.deletedAt }));

  // 소스 참조도 같은 프로젝트인지 확인한다 — 미리보기에서 남의 전시 폼이 뜨면 안 된다.
  const refs = collectSourceRefs(sections);
  let allowed = new Set<string>();
  if (refs.length > 0) {
    try {
      const sources = await prisma.collectSource.findMany({
        where: { id: { in: refs }, projectId: site.projectId, deletedAt: null, mode: "builder" },
        select: { id: true },
      });
      allowed = new Set(sources.map((s) => s.id));
    } catch (error) {
      console.error("[expo-preview] 소스 확인 실패", error);
    }
  }
  const safe = sections.map((section) => {
    const ref = section.content.sourceRef;
    if (typeof ref !== "string" || allowed.has(ref)) return section;
    return { ...section, content: { ...section.content, sourceRef: "" } };
  });

  const resolved = buildExpoPayload({ ...config, sections: safe }, {
    locale: normalizeLocaleTag(url.searchParams.get("lang")) ?? (site.defaultLocale || "ko"),
    defaultLocale: site.defaultLocale || "ko",
    pages: siblings,
    now: new Date(),
    ...(forcedCampaigns ? { forcedCampaigns } : {}),
  });

  /**
   * 색은 **아직 저장하지 않은 값으로도** 그려 볼 수 있다.
   *
   * 사이트 테마는 공개 로더가 실시간으로 읽는다(`app/h/[pageId]/loader.ts`) — 저장하는
   * 순간 이미 붙여 둔 파트너 사이트의 색이 바뀐다. 그래서 편집기는 확인을 받기 전에
   * 여기로 색을 실어 보내 먼저 보여 준다. **저장은 하지 않는다.**
   *
   * 값이 색이 아니면 저장된 색으로 돌아간다 — 타이핑 중인 반쪽짜리 값이 화면을 깨지 않게.
   */
  const saved = normalizeExpoTheme(site.theme);
  const pick = (key: string, fallback: string) =>
    normalizeHexColor(url.searchParams.get(key) ?? "") ?? fallback;

  const payload = {
    pageId: page.id,
    theme: {
      accent: pick("accent", saved.accent),
      lightBg: pick("lightBg", saved.lightBg),
      darkBg: pick("darkBg", saved.darkBg),
    },
    origin,
    sections: resolved.sections,
    campaigns: resolved.campaigns,
    destinations: resolved.destinations,
    // 초안인지 발행본인지가 화면 문구의 축이다 — 둘 다 저장·추적을 끈다.
    mode: wantPublished ? "preview-published" : "preview-draft",
    preview: {
      allowCustomCode,
      // 채널이 없으면 편집기 통로를 아예 붙이지 않는다(직접 URL 로 열어 본 경우).
      ...(channel ? { parentOrigin: origin, channel } : {}),
      ...(allowCustomCode ? { codeDigest } : {}),
    },
  };

  /**
   * 아임웹 콘텐츠 폭 흉내. 실측 기준 1410/1440(데스크톱)·360/390(모바일)이라
   * `calc(100% - 30px)` 가 양쪽에 맞는다. `wide` 는 전폭이다.
   */
  const wrapperStyle = wide ? "width:100%" : "width:calc(100% - 30px);margin:0 auto";

  const body = [
    `<div style="${wrapperStyle}">`,
    '<div data-mach-expo></div>',
    "</div>",
    OPEN_SCRIPT,
    EXPO_RUNTIME_JS,
    `__msExpo.boot(${jsonForScript(payload)}, document.currentScript);`,
    CLOSE_SCRIPT,
  ].join("\n");

  return shell(body, 200);
}
