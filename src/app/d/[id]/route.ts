/**
 * 상세페이지 임베드 로더 — 외부 사이트(아임웹 등)에 한 줄로 붙는다.
 *
 *   <script async src="https://machstudio.vercel.app/d/{pageId}"></script>
 *
 * 대회 로더(/c/[id])와 같은 방식: 응답 본문 = 런타임 번들 + `__msDetailPage.boot({…설정…})`.
 * 설정을 스크립트에 실어 보내 **요청 1회로 최종 화면이 그려진다**.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeDetailPageSettings } from "@/lib/detail-page/config";
import { normalizeNoticePageConfig } from "@/lib/notice/config";
import { DETAIL_PAGE_RUNTIME_JS } from "@/generated/detail-page-runtime";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

const SCRIPT_HEADERS = {
  "Content-Type": "application/javascript; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
  ...CORS_HEADERS,
} as const;

/** <script> 안에 넣어도 안전한 JSON — `</script>` 브레이크아웃과 U+2028/2029 를 막는다. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 형식이 틀린 id 는 DB 까지 가지 않는다.
  const page = /^[a-z0-9]{10,40}$/.test(id)
    ? await prisma.detailPage.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, config: true, theme: true },
      })
    : null;

  // 없는 id 에 런타임 번들을 서빙하지 않는다 — 매번 다른 id 로 엣지 캐시를 우회해 DB·대역폭을 때릴 수 있다.
  if (!page) {
    return new NextResponse("/* mach page: not found */\n", {
      status: 404,
      headers: { ...SCRIPT_HEADERS, "Cache-Control": "public, max-age=0, s-maxage=60" },
    });
  }

  // 공개 페이로드는 정규화된 값만 — 공개 렌더는 빈 행을 버린다(편집 중인 빈 칸이 방문자에게 안 보이게).
  const config = {
    noticePage: normalizeNoticePageConfig(page.config),
    page: normalizeDetailPageSettings(page.config),
  };
  const theme = (page.theme && typeof page.theme === "object" ? page.theme : {}) as Record<string, string>;

  const body =
    `/* mach page */\n` +
    DETAIL_PAGE_RUNTIME_JS +
    `\n__msDetailPage.boot(${jsonForScript({ pageId: page.id, name: page.name, theme, config })});\n`;

  // ETag 필수 — 검증자가 없으면 브라우저가 재검증을 못 해 낡은 스크립트를 계속 실행한다.
  const etag = `W/"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  const cacheHeaders = {
    // 고치면 바로 보여야 한다 — 브라우저는 매번 재검증, 엣지만 짧게(30초) 캐시.
    "Cache-Control": "public, max-age=0, must-revalidate",
    "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
    ETag: etag,
  } as const;

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ...SCRIPT_HEADERS, ...cacheHeaders } });
  }
  return new NextResponse(body, { status: 200, headers: { ...SCRIPT_HEADERS, ...cacheHeaders } });
}
