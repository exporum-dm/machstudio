/**
 * 결과 발표 — **공개 API**. 임베드 런타임이 실행 시점에 가져간다.
 *
 * 공개 전에는 수상자 정보를 내려보내지 않는다. "화면에서 숨기고 데이터는 준다"로 만들면
 * 개발자 도구 한 번에 명단이 새고, 발표 행사는 그걸로 끝난다.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompetitionConfig, normalizeMedia, secondaryTeamName } from "@/lib/competition-config";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 미리보기는 운영자가 발표 전에 화면을 확인하는 용도다. 토큰이 맞을 때만 공개 취급한다.
  const previewToken = new URL(request.url).searchParams.get("preview");

  const competition = await prisma.competition.findUnique({
    where: { id },
    select: { id: true, name: true, theme: true, config: true, resultPublishedAt: true, previewToken: true },
  });
  if (!competition) {
    return NextResponse.json({ error: "대회를 찾을 수 없어요." }, { status: 404, headers: CORS_HEADERS });
  }

  const isPreview = !!previewToken && !!competition.previewToken && previewToken === competition.previewToken;
  const published = !!competition.resultPublishedAt;
  const language = normalizeCompetitionConfig(competition.config).language;

  const base = {
    competition: { id: competition.id, name: competition.name, theme: competition.theme, language },
    preview: isPreview,
  };

  if (!published && !isPreview) {
    return NextResponse.json(
      { ...base, published: false, awards: [] },
      { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=0, s-maxage=30" } },
    );
  }

  const awards = await prisma.competitionAward.findMany({
    where: { competitionId: id, entryId: { not: null } },
    orderBy: { rank: "asc" },
    include: {
      entry: {
        select: { id: true, entryNo: true, title: true, teamName: true, summary: true, media: true },
      },
    },
  });

  return NextResponse.json(
    {
      ...base,
      published,
      publishedAt: competition.resultPublishedAt,
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
    },
    {
      headers: {
        ...CORS_HEADERS,
        /**
         * 발표 직후 트래픽이 몰리므로 공유 캐시는 두되 **stale-while-revalidate 는 쓰지 않는다.**
         * 운영자가 "다시 감추기"를 누르는 건 뭔가 잘못됐을 때다 — SWR 을 걸면 이미 새어 나간
         * 명단을 몇 분이나 더 서빙하게 된다. 최악의 노출 시간을 s-maxage 로 묶어 둔다.
         */
        "Cache-Control": isPreview ? "no-store" : "public, max-age=0, s-maxage=30",
      },
    },
  );
}
