/**
 * 대회 임베드 로더 — 외부 사이트(아임웹 등)에 한 줄로 붙는다.
 *
 *   <script async src="https://machstudio.vercel.app/c/{competitionId}"></script>
 *
 * 응답 본문 = 런타임 번들 + `__msCompetition.boot({ …설정 스냅샷… })`.
 * 설정을 스크립트에 실어 보내므로 **요청 1회로 최종 화면이 그려진다** — fetch 방식은
 * 별도 왕복이 생겨 빈 화면이 길게 보인다(랜딩 로더 /w/l/[slug] 가 같은 이유로 이 방식이다).
 *
 * 배포 경로가 /c/ 인 이유: proxy.ts 의 matcher 가 .js 를 제외하지 않아 public/ 에 두면
 * 비로그인 방문자가 "/" 로 리다이렉트된다 → nosniff 로 실행 거부.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompetitionConfig, resolveCompetitionConfigOrgTokens } from "@/lib/competition-config";
import { normalizeCriteria } from "@/lib/competition-scoring";
import { resolveCompetitionStatus } from "@/lib/competition-status";
import { resolveOrgProfile, type WorkspaceLegalProfile } from "@/lib/legal-templates";
import { COMPETITION_RUNTIME_JS } from "@/generated/competition-runtime";

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
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

  const competition = await prisma.competition.findUnique({
    where: { id },
    // workspace 는 관계로 딸려 오게 해 쿼리를 늘리지 않는다 — 동의 전문에 남은 조직 토큰
    // ({{ORG_ADDRESS}} 등, §legal-templates/tokens)을 풀 때 쓴다.
    include: { workspace: { select: { legalProfile: true } } },
  });

  // 없는 id 에 런타임 번들을 서빙하지 않는다 — 매번 다른 id 로 엣지 캐시를 우회해 DB·대역폭을 때릴 수 있다.
  if (!competition) {
    return new NextResponse("/* mach competition: not found */\n", {
      status: 404,
      headers: { ...SCRIPT_HEADERS, "Cache-Control": "public, max-age=0, s-maxage=60" },
    });
  }

  // 공개 페이로드에는 공개용 config 만 싣는다(꺼 둔 블록·항목 제외). 참가자 개인정보는 애초에 없다.
  const normalizedConfig = normalizeCompetitionConfig(competition.config);
  const org = resolveOrgProfile(competition.workspace.legalProfile as WorkspaceLegalProfile | null, normalizedConfig.legal.country);
  const config = resolveCompetitionConfigOrgTokens(normalizedConfig, org);

  /**
   * 공고의 선발 방식·심사 기준은 **투표 설정과 심사단 탭의 값을 그대로 그린다**(auto 소스).
   * 공고에 손으로 옮겨 적게 하면 배점을 바꿨을 때 공고만 옛 숫자로 남는다.
   * 심사 항목은 공개 정보다 — 참가자가 무엇으로 평가받는지 알아야 준비할 수 있다.
   */
  const rounds = await prisma.competitionRound.findMany({
    where: { competitionId: competition.id },
    orderBy: { sortOrder: "asc" },
    select: { kind: true, name: true, publicWeight: true, judgeWeight: true, judgeCriteria: true, voteEnabled: true, voteOpenAt: true, voteCloseAt: true },
  });
  // 단계는 라운드 일정까지 보고 정한다 — 본선 투표가 열렸으면 본선(예전엔 접수 마감 뒤 늘 예선).
  const status = resolveCompetitionStatus({ ...competition, rounds });
  const noticeRounds = rounds.map((round) => ({
    kind: round.kind === "final" ? ("final" as const) : ("prelim" as const),
    name: round.name,
    publicWeight: round.publicWeight,
    judgeWeight: round.judgeWeight,
    criteria: normalizeCriteria(round.judgeCriteria).map((c) => ({
      name: c.label,
      description: c.description,
      points: c.maxScore,
    })),
  }));

  const body =
    `/* mach competition */\n` +
    COMPETITION_RUNTIME_JS +
    `\n__msCompetition.boot(${jsonForScript({
      competitionId: competition.id,
      competitionName: competition.name,
      origin,
      phase: status.phase,
      canApply: status.canApply,
      theme: competition.theme,
      config,
      description: competition.description,
      recruitOpenAt: competition.recruitOpenAt,
      recruitCloseAt: competition.recruitCloseAt,
      rounds: noticeRounds,
    })});\n`;

  // ETag 필수 — 검증자가 없으면 브라우저가 재검증을 못 해 낡은 스크립트를 계속 실행한다.
  const etag = `W/"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  const cacheHeaders = {
    // 단계·접수 여부가 본문에 들어 있다. 브라우저에 굳으면 마감 후에도 신청 버튼이 살아 있으므로
    // 매 요청 재검증하게 하고, 엣지만 짧게(30초) 캐시한다.
    "Cache-Control": "public, max-age=0, must-revalidate",
    "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
    ETag: etag,
  } as const;

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ...SCRIPT_HEADERS, ...cacheHeaders } });
  }

  return new NextResponse(body, { status: 200, headers: { ...SCRIPT_HEADERS, ...cacheHeaders } });
}
