/**
 * 대중 투표 — 공개 엔드포인트(로그인 없음).
 *
 * 상한 검사를 여기서 하지만 **최종 방어선은 DB 유니크 제약**이다. 조회와 INSERT 사이에 다른
 * 요청이 끼어들면 이 검사는 통과하고 DB 만 막는다 — 그래서 P2002 를 오류가 아니라 정상 흐름
 * ("이미 투표한 항목")으로 처리한다.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimit } from "@/lib/ratelimit";
import { normalizeCompetitionConfig, normalizeMedia, secondaryTeamName } from "@/lib/competition-config";
import { resolveCompetitionStatus } from "@/lib/competition-status";
import { roundDisplayName } from "@/lib/notice/build-model";
import { noticeStrings } from "@/lib/notice/strings";
import { competitionVoteStrings } from "@/lib/competition-vote-strings";
import {
  deriveVoterKey,
  orderEntries,
  resolveVoteWindow,
  voteWindowMessage,
} from "@/lib/competition-vote";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });
}

async function loadContext(competitionId: string, roundKind: string) {
  const competition = await prisma.competition.findUnique({ where: { id: competitionId } });
  if (!competition) return { error: "대회 없음" as const, status: 404 };

  const kind = roundKind === "final" ? "final" : "prelim";
  const round = await prisma.competitionRound.findUnique({
    where: { competitionId_kind: { competitionId, kind } },
  });
  if (!round) return { error: "라운드 없음" as const, status: 404 };

  return { competition, round };
}

/**
 * 미리보기 전용 샘플 참가작.
 *
 * 접수 전에는 공개된 참가작이 0건이라 투표 화면이 "아직 공개된 참가작이 없어요" 한 줄만
 * 그린다 — 정작 확인하고 싶은 카드 배치·영상 썸네일·투표 버튼을 **행사 당일까지 볼 수 없다**.
 * 발표 화면의 리허설(가짜 결과)과 같은 취지로, 미리보기에서만 가짜 팀을 채운다.
 * id 에 접두사를 붙여 실제 참가작 id 와 절대 섞이지 않게 한다(투표 POST 는 어차피 막힌다).
 */
const SAMPLE_ENTRIES = Array.from({ length: 6 }, (_, i) => ({
  id: `preview-sample-${i + 1}`,
  entryNo: String(i + 1).padStart(3, "0"),
  title: `연습용 크루 ${i + 1}`,
  teamName: `Sample Crew ${i + 1}`,
  summary:
    i % 2 === 0
      ? "미리보기용 가짜 참가작이에요. 실제 접수가 시작되면 이 자리에 진짜 팀이 들어옵니다."
      : "카드 배치와 버튼 위치를 확인하는 용도예요.",
  media: [],
}));

/** 투표 화면이 처음 뜰 때 — 참가작 목록 + 내가 이미 찍은 것 + 남은 표. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const roundKind = url.searchParams.get("round") ?? "prelim";
  const deviceId = url.searchParams.get("deviceId");

  const ctx = await loadContext(id, roundKind);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status, headers: CORS_HEADERS });
  const { competition, round } = ctx;

  /*
   * 미리보기 — previewToken 이 맞을 때만 열린다(/cp 와 결과 API 가 쓰는 것과 같은 토큰).
   * 여기서 하는 일은 **보여주는 것뿐**이다: 투표 창을 열린 것으로 보이게 하고, 공개된
   * 참가작이 없으면 가짜 팀을 채운다. 표는 POST 가 따로 막으므로 이 경로로 득표가 늘지 않는다.
   */
  const previewToken = url.searchParams.get("previewToken");
  const isPreview = !!previewToken && !!competition.previewToken && previewToken === competition.previewToken;
  // 닫힌 화면도 확인해야 하므로 강제로 여는 건 state=open 일 때만.
  const forceOpen = isPreview && url.searchParams.get("state") === "open";

  const window = resolveVoteWindow(round);
  const ip = getClientIp(request);
  const config = normalizeCompetitionConfig(competition.config);
  const language = config.language;

  // 본선은 진출자만 보여준다. 예선은 노출 토글을 켠 참가작 전체.
  const entries = await prisma.competitionEntry.findMany({
    where: {
      competitionId: id,
      isPublished: true,
      status: { not: "rejected" },
      ...(round.kind === "final" ? { advanced: true } : {}),
    },
    select: {
      id: true, entryNo: true, title: true, teamName: true, summary: true,
      media: true, sortOrder: true, submittedAt: true, finalOrder: true,
    },
  });

  const { voterKey } = deriveVoterKey({
    identity: round.voterIdentity,
    roundId: round.id,
    ip,
    deviceId,
  });

  const myVotes = voterKey
    ? await prisma.competitionVote.findMany({
        where: { roundId: round.id, voterKey },
        select: { entryId: true },
      })
    : [];

  // 진행 중 순위 공개는 표심을 쏠리게 한다(밴드왜건). 운영자가 켠 경우에만 내려준다.
  let tally: Record<string, number> | null = null;
  if (round.showLiveTally) {
    const grouped = await prisma.competitionVote.groupBy({
      by: ["entryId"],
      where: { roundId: round.id },
      _count: { _all: true },
    });
    tally = Object.fromEntries(grouped.map((g) => [g.entryId, g._count._all]));
  }

  // 본선은 무대 진행 순서라 운영자가 정한 순서를 그대로 쓴다(라운드 설정의 표시 순서는 예선용).
  const ordered = orderEntries(entries, round.kind === "final" ? "final" : round.entryOrder, voterKey || ip);

  return NextResponse.json(
    {
      competition: { id: competition.id, name: competition.name, theme: competition.theme, language, voteIntro: config.voteIntro },
      round: {
        kind: round.kind,
        // 대회를 만들 때 우리가 넣어 둔 "예선"/"본선" 기본값이면 언어를 따른다(공고와 같은 규칙).
        // 운영자가 이름을 한 번이라도 바꿨다면 그건 운영자의 글이라 손대지 않는다.
        name: roundDisplayName(round, noticeStrings(language)),
        maxVotesPerVoter: round.maxVotesPerVoter,
        allowVoteUndo: round.allowVoteUndo,
        voterIdentity: round.voterIdentity,
        showLiveTally: round.showLiveTally,
      },
      open: forceOpen || window.open,
      // "닫힘" 한 문장(message)과 별개로 상단 상태 배지가 참조하는 짧은 사유 — 열림/예정/마감을 구분해야
      // 배지 색과 문구가 갈린다. 강제로 연 미리보기는 실제로 열린 것과 같은 "ok"로 본다.
      reason: forceOpen ? "ok" : window.reason,
      message: forceOpen ? "" : voteWindowMessage(window.reason, language),
      /*
        샘플은 **열린 화면(state=open)에서만** 채운다. "지금 상태" 미리보기는 방문자가
        보는 그대로여야 하므로, 참가작이 없으면 없는 대로 "아직 공개된 참가작이 없어요"가
        나와야 한다 — 거기에 가짜 팀을 섞으면 미리보기가 다시 거짓말을 한다.
      */
      entries: (ordered.length === 0 && forceOpen ? SAMPLE_ENTRIES : ordered).map((entry) => ({
        id: entry.id,
        entryNo: entry.entryNo,
        title: entry.title,
        teamName: secondaryTeamName(entry.title, entry.teamName),
        summary: entry.summary,
        media: normalizeMedia(entry.media),
      })),
      myVoteIds: myVotes.map((v) => v.entryId),
      remaining: Math.max(0, round.maxVotesPerVoter - myVotes.length),
      tally,
    },
    { headers: CORS_HEADERS },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ip = getClientIp(request);

  const limited = rateLimit(`competition-vote:${id}:${ip}`, { limit: 40, windowMs: 60_000 });
  if (!limited.allowed) {
    return NextResponse.json({ error: "요청이 너무 잦아요. 잠시 후 다시 시도해주세요." }, { status: 429, headers: CORS_HEADERS });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400, headers: CORS_HEADERS });
  }

  const ctx = await loadContext(id, String(body.round ?? "prelim"));
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status, headers: CORS_HEADERS });
  const { competition, round } = ctx;
  const language = normalizeCompetitionConfig(competition.config).language;
  const t = competitionVoteStrings(language);

  // 대회 단계와 투표 창을 서버가 본다.
  const phase = resolveCompetitionStatus(competition).phase;
  if (phase === "closed") {
    return NextResponse.json({ error: t.competitionClosed }, { status: 403, headers: CORS_HEADERS });
  }
  const window = resolveVoteWindow(round);
  if (!window.open) {
    return NextResponse.json({ error: voteWindowMessage(window.reason, language) }, { status: 403, headers: CORS_HEADERS });
  }

  const entryIds = Array.isArray(body.entryIds)
    ? body.entryIds.filter((v): v is string => typeof v === "string" && !!v)
    : [];
  if (entryIds.length === 0) {
    return NextResponse.json({ error: t.noSelection }, { status: 400, headers: CORS_HEADERS });
  }

  const { voterKey, ipHash, error } = deriveVoterKey({
    identity: round.voterIdentity,
    roundId: round.id,
    ip,
    deviceId: typeof body.deviceId === "string" ? body.deviceId : null,
    registrationNo: typeof body.registrationNo === "string" ? body.registrationNo : null,
  });
  if (!voterKey) {
    return NextResponse.json({ error: error ?? t.cannotIdentifyVoter }, { status: 400, headers: CORS_HEADERS });
  }

  // 노출된 참가작만 받는다 — id 를 직접 만들어 보내는 경로를 막는다.
  const validEntries = await prisma.competitionEntry.findMany({
    where: {
      id: { in: entryIds },
      competitionId: id,
      isPublished: true,
      status: { not: "rejected" },
      ...(round.kind === "final" ? { advanced: true } : {}),
    },
    select: { id: true },
  });
  if (validEntries.length !== entryIds.length) {
    return NextResponse.json({ error: t.invalidEntries }, { status: 400, headers: CORS_HEADERS });
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;

  /**
   * **투표자 단위로 직렬화한다.**
   *
   * 유니크 제약(roundId, entryId, voterKey)은 *같은 항목* 재투표만 막는다. 서로 다른 항목에
   * 대한 동시 요청은 전부 "지금까지 0표"를 읽고 통과해 **상한을 넘겨 들어간다** —
   * 실측으로 상한 2표에 3표가 저장됐다. 그래서 (라운드, 투표자) 키로 advisory lock 을 잡고
   * 카운트→삽입을 한 트랜잭션에 묶는다. 다른 투표자끼리는 키가 달라 경합하지 않는다.
   */
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${round.id}:${voterKey}`}))`;

    const mine = await tx.competitionVote.findMany({
      where: { roundId: round.id, voterKey },
      select: { entryId: true },
    });
    const owned = new Set(mine.map((v) => v.entryId));
    const duplicated = entryIds.filter((id) => owned.has(id));
    const toInsert = entryIds.filter((id) => !owned.has(id));

    if (owned.size + toInsert.length > round.maxVotesPerVoter) {
      return {
        limitExceeded: true as const,
        remaining: Math.max(0, round.maxVotesPerVoter - owned.size),
      };
    }

    // IP 보조 상한 — device 모드에서 시크릿창 반복 같은 대량 조작을 억제한다.
    // 정상적인 공유망(회사·전시장) 사용자를 막지 않을 만큼 넉넉히 잡는 값이다.
    if (round.ipVoteLimit && round.ipVoteLimit > 0 && toInsert.length > 0) {
      const fromIp = await tx.competitionVote.count({ where: { roundId: round.id, ipHash } });
      if (fromIp + toInsert.length > round.ipVoteLimit) {
        return { ipExceeded: true as const };
      }
    }

    if (toInsert.length > 0) {
      // 잠금을 잡고 있어 같은 투표자의 동시 삽입이 없다 — createMany 로 한 번에 넣는다.
      await tx.competitionVote.createMany({
        data: toInsert.map((entryId) => ({ roundId: round.id, entryId, voterKey, ipHash, userAgent })),
      });
    }

    return { inserted: toInsert.length, duplicated, total: owned.size + toInsert.length };
  });

  if ("limitExceeded" in result) {
    return NextResponse.json(
      { error: t.limitReached(round.maxVotesPerVoter), remaining: result.remaining },
      { status: 409, headers: CORS_HEADERS },
    );
  }
  if ("ipExceeded" in result) {
    return NextResponse.json({ error: t.ipExceeded }, { status: 429, headers: CORS_HEADERS });
  }

  const { inserted, duplicated, total } = result;

  return NextResponse.json(
    {
      ok: true,
      inserted,
      duplicated,
      remaining: Math.max(0, round.maxVotesPerVoter - total),
      message: inserted > 0 ? t.votedSuccess : t.alreadyVoted,
    },
    { status: inserted > 0 ? 201 : 200, headers: CORS_HEADERS },
  );
}

/** 투표 취소 — 운영자가 허용한 경우에만. 실수로 누른 표를 못 무르면 문의가 온다. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ip = getClientIp(request);

  const limited = rateLimit(`competition-unvote:${id}:${ip}`, { limit: 40, windowMs: 60_000 });
  if (!limited.allowed) {
    return NextResponse.json({ error: "요청이 너무 잦아요." }, { status: 429, headers: CORS_HEADERS });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400, headers: CORS_HEADERS });
  }

  const ctx = await loadContext(id, String(body.round ?? "prelim"));
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status, headers: CORS_HEADERS });
  const { competition, round } = ctx;
  const language = normalizeCompetitionConfig(competition.config).language;
  const t = competitionVoteStrings(language);

  if (!round.allowVoteUndo) {
    return NextResponse.json({ error: t.undoNotAllowed }, { status: 403, headers: CORS_HEADERS });
  }
  const window = resolveVoteWindow(round);
  if (!window.open) {
    return NextResponse.json({ error: voteWindowMessage(window.reason, language) }, { status: 403, headers: CORS_HEADERS });
  }

  const { voterKey } = deriveVoterKey({
    identity: round.voterIdentity,
    roundId: round.id,
    ip,
    deviceId: typeof body.deviceId === "string" ? body.deviceId : null,
    registrationNo: typeof body.registrationNo === "string" ? body.registrationNo : null,
  });
  if (!voterKey) return NextResponse.json({ error: t.cannotIdentifyVoter }, { status: 400, headers: CORS_HEADERS });

  const entryId = typeof body.entryId === "string" ? body.entryId : "";
  if (!entryId) return NextResponse.json({ error: t.entryRequired }, { status: 400, headers: CORS_HEADERS });

  await prisma.competitionVote.deleteMany({ where: { roundId: round.id, entryId, voterKey } });
  const total = await prisma.competitionVote.count({ where: { roundId: round.id, voterKey } });

  return NextResponse.json(
    { ok: true, remaining: Math.max(0, round.maxVotesPerVoter - total) },
    { headers: CORS_HEADERS },
  );
}
