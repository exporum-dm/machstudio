/**
 * 발표 화면 데이터 — showToken 으로만 열린다.
 *
 * **필요한 걸 한 번에 다 준다.** 무대에서 현장 와이파이가 끊기는 건 예외가 아니라 기본값이라,
 * 연출 도중에 추가 요청이 필요한 구조면 그 순간 화면이 멈춘다. 로드가 끝나면 나머지는
 * 브라우저 안에서만 돈다.
 *
 * 결과 공개(resultPublishedAt)와 무관하게 내려준다 — 발표 화면이 곧 공개하는 자리이고,
 * 링크는 운영자만 가진다. 대신 리허설(?rehearsal=1)은 **더미**만 준다.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompetitionConfig, normalizeMedia, secondaryTeamName } from "@/lib/competition-config";
import { normalizeShowConfig, rehearsalPayload } from "@/lib/competition-show";
import {
  combineScores,
  criteriaMaxTotal,
  normalizeCriteria,
} from "@/lib/competition-scoring";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rehearsal = new URL(request.url).searchParams.get("rehearsal") === "1";

  const competition = await prisma.competition.findUnique({
    where: { showToken: token },
    select: { id: true, name: true, theme: true, config: true, showConfig: true, scoringConfig: true },
  });
  if (!competition) {
    return NextResponse.json({ error: "발표 링크를 찾을 수 없어요." }, { status: 404 });
  }

  const config = normalizeShowConfig(competition.showConfig);
  // 리허설도 실제 언어를 따른다 — 더미 팀 이름만 연습용이고 무대 UI 언어는 실제 설정 그대로다.
  const language = normalizeCompetitionConfig(competition.config).language;

  if (rehearsal) {
    const dummy = rehearsalPayload(competition.name);
    return NextResponse.json(
      { ...dummy, competition: { name: dummy.competition.name, theme: competition.theme, language }, config },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const awards = await prisma.competitionAward.findMany({
    where: { competitionId: competition.id, entryId: { not: null } },
    orderBy: { rank: "asc" },
    include: {
      entry: { select: { id: true, entryNo: true, title: true, teamName: true, summary: true, media: true } },
    },
  });

  // 순위 연출(순위 역순·바 레이스)은 본선 종합 점수를 쓴다. 본선이 없으면 예선으로 떨어진다.
  const rounds = await prisma.competitionRound.findMany({
    where: { competitionId: competition.id },
    orderBy: { sortOrder: "desc" },
  });
  const round = rounds.find((r) => r.kind === "final") ?? rounds[0];

  let ranking: unknown[] = [];
  if (round) {
    const entries = await prisma.competitionEntry.findMany({
      where: {
        competitionId: competition.id,
        isPublished: true,
        status: { not: "rejected" },
        ...(round.kind === "final" ? { advanced: true } : {}),
      },
      select: { id: true, entryNo: true, title: true, teamName: true },
    });
    const [voteGroups, judgeScores, judges] = await Promise.all([
      prisma.competitionVote.groupBy({ by: ["entryId"], where: { roundId: round.id }, _count: { _all: true } }),
      prisma.competitionJudgeScore.findMany({
        where: { roundId: round.id },
        select: { entryId: true, judgeId: true, total: true, submitted: true },
      }),
      prisma.competitionJudge.findMany({ where: { competitionId: competition.id }, select: { id: true, weight: true } }),
    ]);

    ranking = combineScores({
      entries,
      voteCounts: new Map(voteGroups.map((g) => [g.entryId, g._count._all])),
      judgeScores,
      judgeWeights: new Map(judges.map((j) => [j.id, j.weight])),
      criteriaMax: criteriaMaxTotal(normalizeCriteria(round.judgeCriteria)),
      publicWeight: round.publicWeight,
      judgeWeight: round.judgeWeight,
      tieBreak: round.kind === "final" ? "public" : "entryNo",
    }).map((row) => ({
      entryNo: row.entryNo,
      title: row.title,
      teamName: secondaryTeamName(row.title, row.teamName),
      rank: row.rank,
      combined: row.combined,
      publicScore: row.publicScore,
      judgeScore: row.judgeScore,
      tied: row.tied,
    }));
  }

  return NextResponse.json(
    {
      competition: { name: competition.name, theme: competition.theme, language },
      config,
      rehearsal: false,
      awards: awards
        .filter((award) => award.entry)
        .map((award) => ({
          id: award.id,
          name: award.name,
          description: award.description,
          entry: {
            entryNo: award.entry!.entryNo,
            title: award.entry!.title,
            teamName: secondaryTeamName(award.entry!.title, award.entry!.teamName),
            summary: award.entry!.summary,
            media: normalizeMedia(award.entry!.media),
          },
        })),
      ranking,
      // 룰렛이 돌릴 후보 이름. 수상자만 넣으면 답이 뻔히 보인다.
      candidates: (
        await prisma.competitionEntry.findMany({
          where: { competitionId: competition.id, isPublished: true, status: { not: "rejected" } },
          orderBy: { entryNo: "asc" },
          select: { teamName: true, title: true },
        })
      ).map((e) => e.teamName ?? e.title),
    },
    // 무대에서 쓰는 화면이라 절대 캐시하지 않는다 — 직전에 고친 배정이 반영되지 않으면 끝이다.
    { headers: { "Cache-Control": "no-store" } },
  );
}
