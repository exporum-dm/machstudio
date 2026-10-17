/**
 * 대회 미리보기 — 토큰만 있으면 열리는 공개 링크(/cp/{previewToken}).
 *
 * 아임웹에 붙이기 전에 실제 브라우저에서 확인하고, 팀원·클라이언트에게 링크로 보낸다.
 *
 * **React 페이지가 아니라 라우트 핸들러로 HTML 을 직접 내려준다.** 이유: React 컴포넌트 안의
 * <script> 는 클라이언트에서 실행되지 않는다(React 가 명시적으로 막는다). 페이지로 만들었더니
 * 마운트 div 만 생기고 런타임이 돌지 않았다. HTML 을 그대로 서빙하면 임베드와 **완전히 같은
 * 실행 경로**가 되므로 "미리보기와 실제가 다르다"도 구조적으로 생기지 않는다.
 *
 * **부작용은 런타임이 막는다** — preview:true 를 받으면 제출·업로드를 실제로 하지 않는다.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompetitionConfig, resolveCompetitionConfigOrgTokens } from "@/lib/competition-config";
import { normalizeCriteria } from "@/lib/competition-scoring";
import { escapeHtml } from "@/lib/competition-render";
import { resolveCompetitionStatus, type CompetitionPhase } from "@/lib/competition-status";
import { resolveOrgProfile, type WorkspaceLegalProfile } from "@/lib/legal-templates";
import { COMPETITION_RUNTIME_JS } from "@/generated/competition-runtime";
import { COMPETITION_RESULT_RUNTIME_JS } from "@/generated/competition-result-runtime";
import { COMPETITION_VOTE_RUNTIME_JS } from "@/generated/competition-vote-runtime";

const PHASES: CompetitionPhase[] = ["upcoming", "recruiting", "prelim", "judging", "final", "announced", "closed"];

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const competition = await prisma.competition.findUnique({
    where: { previewToken: token },
    include: { workspace: { select: { legalProfile: true } } },
  });

  if (!competition) {
    return new NextResponse("<!doctype html><meta charset=utf-8><p>미리보기 링크를 찾을 수 없어요.</p>", {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
    });
  }

  const url = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;

  // ?view=result — 발표 전에 결과 화면을 확인한다. 관람객에게는 아직 안 보이는 상태에서
  // 운영자만 미리 본다(결과 API 가 previewToken 을 확인한다).
  if (url.searchParams.get("view") === "result") {
    return htmlResponse(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(competition.name)} — 결과 미리보기</title>
<style>body{margin:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
.mc-wrap{max-width:860px;margin:0 auto;padding:0 20px 60px}</style>
</head>
<body>
<div class="mc-wrap"><div data-mach-competition-result></div></div>
<script>${COMPETITION_RESULT_RUNTIME_JS}</script>
<script>__msCompetitionResult.boot(${jsonForScript({ competitionId: competition.id, origin, previewToken: token })});</script>
</body>
</html>`);
  }

  /*
   * ?view=vote&round=prelim|final — 투표 화면.
   *
   * 참가작·득표는 런타임이 실행 시점에 /votes 로 가져온다(설정 스냅샷을 싣지 않는다).
   * 그래서 투표 설정을 바꾸고 미리보기를 다시 부르면 바로 그 설정으로 보인다.
   * preview:true 를 넘겨 실제로는 표가 들어가지 않게 한다.
   */
  if (url.searchParams.get("view") === "vote") {
    const round = url.searchParams.get("round") === "final" ? "final" : "prelim";
    // 기본은 **열린 화면**이다 — 확인하고 싶은 건 보통 그쪽이고, 닫힌 화면은 한 줄이라 언제든 본다.
    const previewState = url.searchParams.get("state") === "closed" ? "closed" : "open";
    return htmlResponse(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(competition.name)} — 투표 미리보기</title>
<style>body{margin:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
.mc-wrap{max-width:1100px;margin:0 auto;padding:0 20px 60px}</style>
</head>
<body>
<div class="mc-wrap"><div data-mach-competition-vote></div></div>
<script>${COMPETITION_VOTE_RUNTIME_JS}</script>
<script>__msCompetitionVote.boot(${jsonForScript({ competitionId: competition.id, origin, round, preview: true, previewToken: token, previewState })});</script>
</body>
</html>`);
  }

  // 공고의 선발 방식·심사 기준은 투표 설정·심사단 탭 값을 그대로 그린다(auto 소스).
  const rounds = await prisma.competitionRound.findMany({
    where: { competitionId: competition.id },
    orderBy: { sortOrder: "asc" },
    select: { kind: true, name: true, publicWeight: true, judgeWeight: true, judgeCriteria: true, voteEnabled: true, voteOpenAt: true, voteCloseAt: true },
  });
  const status = resolveCompetitionStatus({ ...competition, rounds });
  // ?phase= 로 접수 전·마감 화면을 지금 확인한다 — 마감 화면을 마감 당일에 처음 보면 늦다.
  const requested = url.searchParams.get("phase");
  const phase = requested && (PHASES as string[]).includes(requested) ? (requested as CompetitionPhase) : status.phase;
  const canApply = requested ? phase === "recruiting" : status.canApply;


  const normalizedConfig = normalizeCompetitionConfig(competition.config);
  const previewOrg = resolveOrgProfile(competition.workspace.legalProfile as WorkspaceLegalProfile | null, normalizedConfig.legal.country);
  const payload = {
    competitionId: competition.id,
    competitionName: competition.name,
    origin,
    phase,
    canApply,
    theme: competition.theme,
    config: resolveCompetitionConfigOrgTokens(normalizedConfig, previewOrg),
    preview: true,
    description: competition.description,
    recruitOpenAt: competition.recruitOpenAt,
    recruitCloseAt: competition.recruitCloseAt,
    rounds: rounds.map((round) => ({
      kind: round.kind === "final" ? ("final" as const) : ("prelim" as const),
      name: round.name,
      publicWeight: round.publicWeight,
      judgeWeight: round.judgeWeight,
      criteria: normalizeCriteria(round.judgeCriteria).map((c) => ({
        name: c.label,
        description: c.description,
        points: c.maxScore,
      })),
    })),
  };

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(competition.name)} — 미리보기</title>
<style>body{margin:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
.mc-wrap{max-width:860px;margin:0 auto;padding:0 20px 60px}
/* 섹션 빌더 공고는 화면 폭을 다 쓰는 페이지다 — 860px 래퍼에 가두면 히어로·배경이 잘린다. */
.mc-wrap.full{max-width:none;padding:0}</style>
</head>
<body>
<div class="mc-wrap${payload.config.noticePage?.enabled ? " full" : ""}"><div data-mach-competition></div></div>
<script>${COMPETITION_RUNTIME_JS}</script>
<script>__msCompetition.boot(${jsonForScript(payload)});</script>
</body>
</html>`;

  return htmlResponse(html);
}

/** 미리보기는 편집 직후 바로 확인하는 화면이라 캐시하지 않는다. */
function htmlResponse(html: string) {
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
    },
  });
}
