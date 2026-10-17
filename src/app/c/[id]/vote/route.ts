/**
 * 대회 투표 임베드 로더.
 *
 *   <script async src="https://…/c/{competitionId}/vote"></script>
 *   <div data-mach-competition-vote></div>
 *
 * 공고 로더(/c/{id})와 달리 **설정 스냅샷을 싣지 않는다.** 참가작 목록·이미 찍은 표·남은 표는
 * 사람마다·순간마다 다르므로 런타임이 실행 시점에 /votes 로 가져온다. 스크립트 본문은
 * 대회마다 동일해서 엣지 캐시가 잘 듣는다.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentRoundKind } from "@/lib/competition-status";
import { COMPETITION_VOTE_RUNTIME_JS } from "@/generated/competition-vote-runtime";

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
  const url = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  const requested = url.searchParams.get("round");

  // 없는 id 에 번들을 서빙하지 않는다 — 매번 다른 id 로 엣지 캐시를 우회할 수 있다.
  const competition = await prisma.competition.findUnique({
    where: { id },
    select: { id: true, rounds: { select: { kind: true, voteEnabled: true, voteOpenAt: true, voteCloseAt: true } } },
  });
  if (!competition) {
    return new NextResponse("/* mach competition vote: not found */\n", {
      status: 404,
      headers: { ...SCRIPT_HEADERS, "Cache-Control": "public, max-age=0, s-maxage=60" },
    });
  }

  // ?round= 이 없으면 지금 라운드(열림 → 곧 열림 → 최근 마감)를 고른다 — 설치 코드 하나로 예선부터 본선까지.
  // 예전엔 늘 예선이라, LA 대회 투표 페이지가 본선 기간에도 마감된 예선을 보여 줬다(2026-10-18).
  const auto = requested !== "final" && requested !== "prelim";
  const round = auto ? currentRoundKind(competition.rounds) : (requested as "prelim" | "final");

  const body =
    `/* mach competition vote */\n` +
    COMPETITION_VOTE_RUNTIME_JS +
    `\n__msCompetitionVote.boot(${jsonForScript({ competitionId: id, origin, round })});\n`;

  const etag = `W/"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  const cacheHeaders = {
    "Cache-Control": "public, max-age=0, must-revalidate",
    // 라운드를 고정한 코드는 본문이 안 바뀐다 → 넉넉히. 자동 라운드는 라운드가 바뀌는 순간 따라가야 해서 짧게.
    "CDN-Cache-Control": auto ? "public, s-maxage=60, stale-while-revalidate=120" : "public, s-maxage=300, stale-while-revalidate=3600",
    ETag: etag,
  } as const;

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ...SCRIPT_HEADERS, ...cacheHeaders } });
  }

  return new NextResponse(body, { status: 200, headers: { ...SCRIPT_HEADERS, ...cacheHeaders } });
}
