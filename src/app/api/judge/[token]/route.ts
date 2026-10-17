/**
 * 심사위원용 공개 API — machstudio 계정 없이 링크 + 비밀번호로 들어온다.
 *
 * GET  : 인증 상태 확인 + 심사 대상·기존 점수 (미인증이면 잠금 상태만 알려준다)
 * POST : 비밀번호 인증 → 세션 쿠키 발급
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimit } from "@/lib/ratelimit";
import { verifySharePassword } from "@/lib/share-password";
import { createJudgeSession, judgeCookieName, verifyJudgeSession } from "@/lib/competition-judge-session";
import { normalizeMedia, secondaryTeamName } from "@/lib/competition-config";
import { criteriaMaxTotal, normalizeCriteria } from "@/lib/competition-scoring";

async function loadJudge(token: string) {
  return prisma.competitionJudge.findUnique({
    where: { accessToken: token },
    include: { competition: { select: { id: true, name: true, theme: true } } },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const judge = await loadJudge(token);
  if (!judge) return NextResponse.json({ error: "심사 링크를 찾을 수 없어요." }, { status: 404 });

  const store = await cookies();
  const authed = verifyJudgeSession(store.get(judgeCookieName(token))?.value, token, judge.passwordHash);

  if (!authed) {
    // 잠금 화면에 필요한 최소 정보만 — 참가작·다른 심사위원 정보는 주지 않는다.
    return NextResponse.json({
      authed: false,
      judgeName: judge.name,
      competitionName: judge.competition.name,
    });
  }

  // 심사 대상 라운드 — 등록할 때 고른 라운드(judge.roundKind) 그대로. 예선·본선을 각각
  // 다른 심사위원단이 보는 대회가 흔해서, 심사위원 단위 배정이지 대회 전체 설정이 아니다.
  const round = await prisma.competitionRound.findUnique({
    where: { competitionId_kind: { competitionId: judge.competitionId, kind: judge.roundKind } },
  });

  if (!round) return NextResponse.json({ error: "배정된 라운드를 찾을 수 없어요." }, { status: 404 });

  const criteria = normalizeCriteria(round.judgeCriteria);

  // **모든 심사위원이 전 참가작을 본다**(분할 없음 — 공평성). 본선이면 진출자만.
  const entries = await prisma.competitionEntry.findMany({
    where: {
      competitionId: judge.competitionId,
      isPublished: true,
      status: { not: "rejected" },
      ...(round.kind === "final" ? { advanced: true } : {}),
    },
    // 본선은 운영자가 정한 무대 순서로, 예선은 목록 순서로 — 심사위원이 보는 순서가
    // 실제 진행 순서와 어긋나면 현장에서 채점표를 잘못 찾는다.
    orderBy:
      round.kind === "final"
        ? [{ finalOrder: "asc" }, { entryNo: "asc" }]
        : [{ sortOrder: "asc" }, { submittedAt: "asc" }],
    select: {
      id: true, entryNo: true, title: true, teamName: true, summary: true, media: true,
    },
  });

  const myScores = await prisma.competitionJudgeScore.findMany({
    where: { roundId: round.id, judgeId: judge.id },
  });

  await prisma.competitionJudge.update({ where: { id: judge.id }, data: { lastSeenAt: new Date() } });

  return NextResponse.json({
    authed: true,
    judgeName: judge.name,
    competitionName: judge.competition.name,
    theme: judge.competition.theme,
    round: { id: round.id, kind: round.kind, name: round.name },
    criteria,
    criteriaMax: criteriaMaxTotal(criteria),
    entries: entries.map((entry) => ({
      id: entry.id,
      entryNo: entry.entryNo,
      title: entry.title,
      teamName: secondaryTeamName(entry.title, entry.teamName),
      summary: entry.summary,
      media: normalizeMedia(entry.media),
    })),
    scores: myScores.map((s) => ({
      entryId: s.entryId,
      scores: s.scores,
      total: s.total,
      comment: s.comment,
      submitted: s.submitted,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // 비밀번호 대입을 막는다 — 토큰이 새어도 무차별 시도로는 못 뚫게.
  const ip = getClientIp(request);
  const limited = rateLimit(`judge-auth:${token}:${ip}`, { limit: 10, windowMs: 5 * 60_000 });
  if (!limited.allowed) {
    return NextResponse.json({ error: "시도가 너무 잦아요. 잠시 후 다시 시도해주세요." }, { status: 429 });
  }

  const judge = await loadJudge(token);
  if (!judge) return NextResponse.json({ error: "심사 링크를 찾을 수 없어요." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";

  if (!verifySharePassword(password, judge.passwordHash)) {
    return NextResponse.json({ error: "비밀번호가 맞지 않아요." }, { status: 401 });
  }

  const session = createJudgeSession(token, judge.passwordHash);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(judgeCookieName(token), session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}
