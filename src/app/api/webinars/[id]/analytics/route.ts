import { projectAdCampaignScope } from "@/lib/ad-campaign-scope";
/**
 * 웨비나 분석 — 퍼널 / UTM 소스·매체별 분해 / 등록 추이 / 인터랙션 아카이브 / 리드 스코어링.
 * 수동 새로고침만 (폴링 없음 — egress 배려). 라이브 KPI 는 dashboard 엔드포인트가 담당.
 *
 * 체류·참석·세그먼트는 assembleWebinarEngagement(캡 적용 유효 체류)에서 파생 — dashboard 와 동일 규칙.
 * 데이터 출처: 방문=WebinarVisitStat / 등록·입장·체류=WebinarRegistration / 인터랙션=투표·Q&A·채팅.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { assembleWebinarEngagement } from "@/lib/webinar-scoring";
import { campaignJoinKey, normalizeUtmKey } from "@/lib/attribution-normalize";
import { resolveWebinarStatus } from "@/lib/webinar-status";
import {
  actionLift,
  facetBy,
  facetByRole,
  MIN_RELIABLE_SAMPLE,
  scoreComposition,
  scoreHistogram,
  summarizeFacet,
} from "@/lib/webinar-lead-facets";
import { goalQuestions, normalizeSurveyQuestions, responseHitsGoal, type SurveyAnswers } from "@/lib/webinar-survey";

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

/**
 * (source, medium) 집계 키.
 *
 * normalizeUtmKey 로 접는 이유: 저장 경로가 여러 개라 과거 데이터에 대소문자·센티널
 * ("(direct)"/"(none)") 이 섞여 있다. 지금은 저장 시점에 서버가 정규화하지만, **이미 쌓인 행**은
 * 그대로다 — 집계에서 같은 규칙으로 한 번 더 접어야 naver/Naver 와 (direct)/"" 가 한 줄로 합쳐진다.
 * (그래서 데이터 마이그레이션 없이 과거 분석도 즉시 교정된다.)
 */
function groupKey(source: string | null, medium: string | null) {
  return `${normalizeUtmKey(source)}|${normalizeUtmKey(medium)}`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await prisma.webinar.findUnique({
    where: { id },
    select: { workspaceId: true, projectId: true, liveStartAt: true, liveEndAt: true, signupDeadline: true, statusOverride: true, components: true, broadcastEndedAt: true, createdAt: true },
  });
  if (!webinar) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: webinar.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const [
    totalRegistered,
    visitAgg,
    regByGroup,
    enteredByGroup,
    visitByGroup,
    campaignRegGroup,
    campaignEnteredGroup,
    trendRows,
  ] = await Promise.all([
    prisma.webinarRegistration.count({ where: { webinarId: id } }),
    prisma.webinarVisitStat.aggregate({ where: { webinarId: id }, _sum: { visits: true } }),
    prisma.webinarRegistration.groupBy({
      by: ["utmSource", "utmMedium"],
      where: { webinarId: id },
      _count: { _all: true },
    }),
    prisma.webinarRegistration.groupBy({
      by: ["utmSource", "utmMedium"],
      where: { webinarId: id, enteredAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.webinarVisitStat.groupBy({
      by: ["utmSource", "utmMedium"],
      where: { webinarId: id },
      _sum: { visits: true },
    }),
    prisma.webinarRegistration.groupBy({
      by: ["utmCampaign"],
      where: { webinarId: id },
      _count: { _all: true },
    }),
    prisma.webinarRegistration.groupBy({
      by: ["utmCampaign"],
      where: { webinarId: id, enteredAt: { not: null } },
      _count: { _all: true },
    }),
    // 등록 추이 — KST 일자별.
    prisma.$queryRawUnsafe<{ d: string; c: bigint }[]>(
      `SELECT to_char("submittedAt" + interval '9 hours', 'YYYY-MM-DD') AS d, COUNT(*)::int AS c
       FROM "WebinarRegistration"
       WHERE "webinarId" = $1::text
       GROUP BY d ORDER BY d ASC`,
      id,
    ),
  ]);

  const visits = visitAgg._sum.visits ?? 0;

  // UTM 분해 — 방문/등록/입장을 (source,medium) 키로 병합
  const merged = new Map<string, { source: string; medium: string; visits: number; registered: number; entered: number }>();
  const ensure = (source: string | null, medium: string | null) => {
    const key = groupKey(source, medium);
    let row = merged.get(key);
    if (!row) {
      // 행에 담는 값도 접힌 키를 쓴다 — 표시용 원문을 남기면 같은 행이 두 라벨을 갖는다.
      row = { source: normalizeUtmKey(source), medium: normalizeUtmKey(medium), visits: 0, registered: 0, entered: 0 };
      merged.set(key, row);
    }
    return row;
  };
  for (const row of visitByGroup) ensure(row.utmSource, row.utmMedium).visits += row._sum.visits ?? 0;
  for (const row of regByGroup) ensure(row.utmSource, row.utmMedium).registered += row._count._all;
  for (const row of enteredByGroup) ensure(row.utmSource, row.utmMedium).entered += row._count._all;

  const utmChannels = Array.from(merged.values())
    .map((row) => ({
      // 품질 열을 붙일 때 쓸 접힌 키 — 표시용 라벨과 분리해 둔다(라벨은 "(direct)" 로 바뀐다).
      key: groupKey(row.source, row.medium),
      source: row.source || "(direct)",
      medium: row.medium || "(none)",
      visits: row.visits,
      registered: row.registered,
      entered: row.entered,
      regRate: pct(row.registered, row.visits),
      entryRate: pct(row.entered, row.registered),
    }))
    .sort((a, b) => (b.registered - a.registered) || (b.visits - a.visits));

  const registrationTrend = trendRows.map((row) => ({ date: row.d, count: Number(row.c) }));

  // ── 캠페인별 성과 + 광고비 조인 ──
  // 등록/입장을 utmCampaign 으로 나누고, 같은 projectId·campaignName 의 광고 성과가 있으면 비용을 붙인다.
  //
  // 매칭은 **대소문자·공백 무시**다(campaignJoinKey). 예전엔 정확 일치라, 빌더가 URL 캠페인명을
  // 소문자로 권하는데 광고 플랫폼 리포트는 원본 대소문자를 유지해서(spring_sale vs Spring_Sale)
  // 조인이 조용히 실패했고 화면에는 비용이 '—' 로만 떠서 "광고비가 없는 것" 인지 "이름이 안 맞는 것"
  // 인지 구분할 수 없었다. 미매칭 광고 캠페인명은 응답으로 함께 내려 화면이 안내한다.
  const campMap = new Map<string, { campaign: string; registered: number; entered: number }>();
  const ensureCamp = (c: string | null) => {
    const key = (c ?? "").trim();
    let row = campMap.get(key);
    if (!row) {
      row = { campaign: key, registered: 0, entered: 0 };
      campMap.set(key, row);
    }
    return row;
  };
  for (const r of campaignRegGroup) ensureCamp(r.utmCampaign).registered += r._count._all;
  for (const r of campaignEnteredGroup) ensureCamp(r.utmCampaign).entered += r._count._all;

  const campaignNames = Array.from(campMap.values()).map((c) => c.campaign).filter(Boolean);
  /**
   * 광고비 기간 창 — 이 웨비나의 홍보 구간(생성일 ~ 라이브 종료)으로 제한한다.
   *
   * 예전엔 기간 조건이 아예 없어서, 같은 프로젝트의 웨비나 A·B 가 같은 캠페인명을 쓰면 A 도 B 도
   * 광고비 **전액**을 표시하고 CPR 을 각자 계산했다(같은 지출의 이중 귀속). 스키마에 reportDate 가
   * 있는데 안 쓰고 있었다. reportDate 가 없는 행은 reportStart/End 구간이 겹치는지로 판정한다.
   *
   * 남는 한계(스키마): AdPerformanceRecord 에 webinarId 가 없어 한 기간에 두 웨비나가 겹치면
   * 여전히 양쪽에 계상된다 — 그건 응답의 costScope 로 화면이 밝힌다.
   */
  const costFrom = webinar.createdAt;
  const costTo = webinar.liveEndAt;
  const adCostRows = campaignNames.length
    ? await prisma.adPerformanceRecord.groupBy({
        by: ["campaignName"],
        where: {
          projectId: webinar.projectId,
          AND: [projectAdCampaignScope(await prisma.adPerformanceFolder.findMany({ where: { projectId: webinar.projectId }, select: { id: true, mediaAccounts: true } }))],
          OR: [
            { reportDate: { gte: costFrom, lte: costTo } },
            { AND: [{ reportDate: null }, { reportStart: { lte: costTo } }, { reportEnd: { gte: costFrom } }] },
          ],
        },
        _sum: { cost: true },
      })
    : [];
  /* 조인 키를 소문자로 접어 합산한다 — 같은 캠페인이 대소문자만 다르게 여러 배치로 들어올 수 있다.
     cost 가 전부 NULL 인 캠페인은 0 이 아니라 **미상**이다(₩0 으로 보이면 '무료' 로 오독된다). */
  const costMap = new Map<string, number | null>();
  for (const row of adCostRows) {
    const key = campaignJoinKey(row.campaignName);
    const sum = row._sum.cost;
    const prev = costMap.get(key);
    if (sum == null) {
      if (!costMap.has(key)) costMap.set(key, null);
      continue;
    }
    costMap.set(key, Math.round((prev ?? 0) + sum));
  }

  const matchedCostKeys = new Set<string>();
  const campaignBreakdown = Array.from(campMap.values())
    .map((c) => {
      const key = campaignJoinKey(c.campaign);
      const hasCost = c.campaign !== "" && costMap.has(key);
      if (hasCost) matchedCostKeys.add(key);
      const cost = hasCost ? costMap.get(key)! : null;
      return {
        campaign: c.campaign || "(캠페인 없음)",
        registered: c.registered,
        entered: c.entered,
        attendRate: pct(c.entered, c.registered),
        cost,
        cpr: cost != null && c.registered ? Math.round(cost / c.registered) : null,
        cpa: cost != null && c.entered ? Math.round(cost / c.entered) : null,
      };
    })
    .sort((a, b) => (b.registered - a.registered) || (b.entered - a.entered));

  /* 광고 데이터에는 있는데 어떤 등록 캠페인과도 안 맞은 이름 — 화면이 "N개가 매칭되지 않았어요" 로
     알린다. 이게 없으면 운영자는 비용 '—' 를 보고 데이터가 없는 줄로만 안다. */
  const unmatchedAdCampaigns = Array.from(
    new Set(
      adCostRows
        .filter((r) => !matchedCostKeys.has(campaignJoinKey(r.campaignName)))
        .map((r) => r.campaignName),
    ),
  ).slice(0, 20);

  // ── 참여 스코어링 + 인터랙션 아카이브 — 기존 모델 집계만(신규 수집 없음) ──
  const [engagement, facetRows, pollRows, qaByStatus, qaTop, chatAgg, reminderCount, ctaAgg] = await Promise.all([
    assembleWebinarEngagement(id, { liveStartAt: webinar.liveStartAt, liveEndAt: webinar.liveEndAt, broadcastEndedAt: webinar.broadcastEndedAt }),
    /* 리드 분석 축 — 업종·직함·채널. 등록 폼이 받아 두고도 명단에만 있던 값이다.
       짧은 문자열 4개만 읽는다(262행이면 수십 KB) — 점수는 아래에서 id 로 붙인다. */
    prisma.webinarRegistration.findMany({
      where: { webinarId: id },
      select: { id: true, industry: true, jobTitle: true, utmSource: true, utmMedium: true },
    }),
    prisma.webinarPoll.findMany({
      where: { webinarId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        question: true,
        isActive: true,
        options: { orderBy: { order: "asc" }, select: { label: true, voteCount: true } },
      },
    }),
    prisma.webinarQA.groupBy({ by: ["status"], where: { webinarId: id }, _count: { _all: true } }),
    prisma.webinarQA.findMany({
      where: { webinarId: id },
      orderBy: [{ voteCount: "desc" }, { createdAt: "asc" }],
      take: 5,
      select: { id: true, question: true, voteCount: true, status: true, name: true },
    }),
    prisma.$queryRawUnsafe<{ messages: number; participants: number }[]>(
      `SELECT COUNT(*)::int AS messages,
              COUNT(DISTINCT COALESCE("registrationId", "name"))::int AS participants
       FROM "WebinarChatMessage"
       WHERE "webinarId" = $1::text AND "isHost" = false`,
      id,
    ),
    prisma.webinarReminder.count({ where: { webinarId: id } }),
    prisma.$queryRawUnsafe<{ clicks: number; clickers: number }[]>(
      `SELECT COUNT(*)::int AS clicks, COUNT(DISTINCT "registrationId")::int AS clickers
       FROM "WebinarPopupClick" WHERE "webinarId" = $1::text`,
      id,
    ),
  ]);

  // 체류·참석 — 캡 적용된 engagement 행에서 파생(운영 dashboard와 동일 상한)
  const enteredRows = engagement.rows.filter((r) => r.entered);
  const attended = enteredRows.length;
  const stay30 = enteredRows.filter((r) => r.watchMinutes >= 30).length;
  const stay60 = enteredRows.filter((r) => r.watchMinutes >= 60).length;
  const avgStayMinutes = attended ? Math.round(enteredRows.reduce((s, r) => s + r.watchMinutes, 0) / attended) : 0;
  const maxStayMinutes = enteredRows.reduce((m, r) => Math.max(m, r.watchMinutes), 0);

  // 리드 세그먼트 분포 + 상위 참여자
  const distribution = { hot: 0, warm: 0, cold: 0, noShow: 0 };
  for (const r of engagement.rows) {
    if (!r.entered) distribution.noShow += 1;
    else distribution[r.segment] += 1;
  }
  const topEngaged = [...engagement.rows]
    .filter((r) => r.entered)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((r) => ({
      name: r.name,
      company: r.company,
      score: r.score,
      segment: r.segment,
      watchMinutes: r.watchMinutes,
      chat: r.chat,
      pollVotes: r.pollVotes,
      qaAsks: r.qaAsks,
      qaUpvotes: r.qaUpvotes,
      ctaClicks: r.ctaClicks,
      agreeMarketing: r.agreeMarketing,
      // 점수 근거 — 화면 툴팁이 "참석25 + 체류22 + 행동0 + 인텐트0" 을 그대로 보여준다
      breakdown: r.breakdown,
    }));

  /* 웨비나가 아직 열리기 전에는 세그먼트가 의미를 갖지 않는다 — 입장이 0 이라 전원이 노쇼로
     집계돼, 등록 254명인 8/11 웨비나가 분석 화면에서 **"노쇼 100%"** 로 보였다(실측).
     그 시점에 운영자가 실제로 쓸 수 있는 숫자는 "지금 확보한 리드가 쓸 만한가" 다.
     phase 를 실어 보내고 화면이 before / live·ended 를 갈라 쓴다. */
  const { status } = resolveWebinarStatus(webinar);
  const phase: "before" | "live" | "ended" = status === "ended" ? "ended" : status === "live" ? "live" : "before";

  /* 노쇼지만 마케팅 동의한 리드 — 리타겟 대상. 점수는 5점 콜드라 상위 참여자 목록에 절대
     안 나오는데, 웨비나 다음 액션(재초대·다시보기 안내)에서 제일 큰 덩어리다. */
  const retargetCount = engagement.rows.filter((r) => !r.entered && r.agreeMarketing).length;

  /* ── 성과 퍼널 — 등록 → 시청 → 설문 응답 → 상담 희망 → 그중 마케팅 동의 ──
   *
   * 왜 이 순서인가(사장님 원안에서 한 군데 고침): 마케팅 약관 동의는 **등록 시점**에 체크하는
   * 값이라 시청보다 먼저 일어난다. 퍼널 마지막에 두면 실측에서 `등록 257 → 시청 0 → 동의 142`
   * 로 마지막 단계가 앞 단계보다 커진다(부분집합이 아니다). 그래서 마지막을
   * **"상담 희망 중 마케팅도 동의한 사람"** 으로 둔다 — 바로 영업하고 마케팅도 보낼 수 있는
   * 완전 활용 가능 리드이고, 단조 감소가 성립한다. 동의 전수는 별도 숫자로 함께 내려보낸다.
   *
   * '설문 응답' 단계를 넣은 이유: 시청→상담 낙차의 원인이 둘인데(설문을 못 봤다 / 봤지만
   * 상담을 원치 않는다) 그 둘은 완전히 다른 문제다(노출·유도 vs 오퍼·콘텐츠).
   *
   * 익명 응답(registrationId=null)은 등록자 부분집합이 아니라 퍼널에서 제외한다 — 그 사실은
   * unlinkedSurveyResponses 로 함께 내려 화면이 밝힌다(조용히 빼면 숫자가 작아 보인다).
   */
  const [surveyDefs, surveyResponses, consentedEntered, unlinkedCount] = await Promise.all([
    prisma.webinarSurvey.findMany({ where: { webinarId: id }, select: { id: true, title: true, questions: true } }),
    prisma.webinarSurveyResponse.findMany({
      where: { webinarId: id, registrationId: { not: null } },
      select: { surveyId: true, registrationId: true, answers: true },
    }),
    prisma.webinarRegistration.count({ where: { webinarId: id, agreeMarketing: true } }),
    prisma.webinarSurveyResponse.count({ where: { webinarId: id, registrationId: null } }),
  ]);

  // 보관 문항까지 포함해야 이미 수집된 답변의 성과 지정이 살아 있다(관리자 경로와 같은 규칙).
  const questionsBySurvey = new Map(
    surveyDefs.map((s) => [s.id, normalizeSurveyQuestions(s.questions, { includeHidden: true })]),
  );
  const goalQuestionTitles = surveyDefs.flatMap((s) =>
    goalQuestions(questionsBySurvey.get(s.id) ?? []).map((q) => q.title || s.title),
  );

  /* 사람 단위 distinct — 한 사람이 설문 두 개에서 성과 선택지를 골라도 1명이다. */
  const respondedIds = new Set<string>();
  const goalIds = new Set<string>();
  for (const r of surveyResponses) {
    if (!r.registrationId) continue;
    respondedIds.add(r.registrationId);
    const qs = questionsBySurvey.get(r.surveyId);
    if (qs && responseHitsGoal(qs, (r.answers ?? {}) as SurveyAnswers)) goalIds.add(r.registrationId);
  }
  // 마케팅 동의는 점수 조립에 이미 있다 — 같은 소스를 써야 등록자 탭·CSV 와 어긋나지 않는다.
  const marketingIds = new Set(engagement.rows.filter((r) => r.agreeMarketing).map((r) => r.registrationId));
  const goalWithMarketing = [...goalIds].filter((rid) => marketingIds.has(rid)).length;

  const performanceFunnel = {
    /** 방문은 임베드 비콘이 붙은 면에서만 집계된다 — 0 이면 화면이 단계를 숨긴다. */
    visits,
    registered: totalRegistered,
    entered: attended,
    surveyResponded: respondedIds.size,
    goalReached: goalIds.size,
    goalWithMarketing,
    /** 체류는 퍼널 단계가 아니라 보조 줄로 — 성과로 가는 경로가 아니라 시청의 질이다. */
    stay30,
    stay60,
    /** 성과 문항이 지정되지 않았으면 화면이 "설문에서 지정하면 볼 수 있어요" 로 안내한다. */
    goalConfigured: goalQuestionTitles.length > 0,
    goalQuestionTitles: goalQuestionTitles.slice(0, 3),
    /** 마케팅 동의 전수(노쇼 포함) — 퍼널 축이 아니라 별도 숫자다. */
    marketingConsented: consentedEntered,
    /** 등록자와 연결되지 않은 익명 설문 응답 — 퍼널에서 제외된 건수 */
    unlinkedSurveyResponses: unlinkedCount,
  };

  /* ── 리드 분석 — 점수를 "결정에 쓸 수 있는 축" 으로 쪼갠다 ──
     세그먼트 4칸만으로는 다음 웨비나를 어떻게 바꿀지 알 수 없다. 규칙은 webinar-lead-facets 에
     모아 두고(테스트로 묶임) 여기서는 조립만 한다. */
  const scoreById = new Map(engagement.rows.map((r) => [r.registrationId, r]));
  const facetScored = facetRows
    .map((f) => {
      const s = scoreById.get(f.id);
      return s
        ? { entered: s.entered, score: s.score, segment: s.segment, breakdown: s.breakdown, jobTitle: f.jobTitle, industry: f.industry ?? "", channel: groupKey(f.utmSource, f.utmMedium), interactions: s }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  /* 채널별 품질 — 기존 유입 표에 열 두 개로 붙인다(새 카드를 만들지 않는다).
     등록 수만 보면 meta 173명이 압도적이지만, 그 리드가 좋았는지는 평균 점수가 답한다. */
  const byChannel = new Map<string, typeof facetScored>();
  for (const r of facetScored) {
    const bag = byChannel.get(r.channel);
    if (bag) bag.push(r);
    else byChannel.set(r.channel, [r]);
  }
  // 채널은 접기지 않고 전부 남긴다(표가 이미 채널을 다 보여준다) — 평균·신뢰 기준만 공유한다.
  const channelQuality = new Map([...byChannel].map(([key, rows]) => [key, summarizeFacet(key, rows)]));
  const utmBreakdown = utmChannels.map(({ key, ...row }) => {
    const q = channelQuality.get(key);
    return {
      ...row,
      avgScore: q?.avgScore ?? 0,
      hot: q?.hot ?? 0,
      hotRate: pct(q?.hot ?? 0, q?.entered ?? 0),
      /** false 면 화면이 평균을 흐리게 표시한다 — 13명 채널의 평균은 노이즈다 */
      scoreReliable: q?.reliable ?? false,
    };
  });

  const leadAnalysis = {
    /** 입장자 점수 분포(10점 구간) — 세그먼트 4칸으로는 "60점 벽" 이 안 보인다 */
    histogram: scoreHistogram(facetScored),
    /** 전체 점수가 어디서 왔나 — "체류는 좋았는데 상호작용이 0" 을 한 줄로 */
    composition: scoreComposition(facetScored),
    /** 업종 — K-뷰티/K-푸드처럼 이미 깔끔한 값이라 원문 상위 5개 + 기타 */
    byIndustry: facetBy(facetScored, (r) => r.industry, { limit: 5 }),
    /** 직함 — 자유 입력을 결재선 기준으로 묶는다(대표/대표이사/CEO 가 갈리지 않게) */
    byRole: facetByRole(facetScored),
    /** 행동별 리프트 — 행동 점수를 뺀 값으로 비교한다(그 함수 주석 참고) */
    lift: actionLift(facetScored, [
      { action: "투표", did: (r) => r.interactions.pollVotes > 0 },
      { action: "채팅", did: (r) => r.interactions.chat > 0 },
      { action: "질문", did: (r) => r.interactions.qaAsks > 0 },
      { action: "질문 추천", did: (r) => r.interactions.qaUpvotes > 0 },
      { action: "CTA 클릭", did: (r) => r.interactions.ctaClicks > 0 },
      { action: "공유", did: (r) => r.interactions.shares > 0 },
    ]),
    minReliableSample: MIN_RELIABLE_SAMPLE,
  };

  /* ── 입소문(추천 링크) ──
     공유 → 클릭 → 등록 3단 퍼널과 상위 추천인. 예전에는 공유 버튼이 맨 URL 을 복사해서
     "몇 명이 공유했나" 도 "그 공유로 몇 명이 왔나" 도 답할 수 없었다.
     클릭은 shareCode 로 집계되므로 등록자와 조인해 사람 단위로 되돌린다. */
  const [womTotals, womBySurface, topReferrers] = await Promise.all([
    prisma.$queryRawUnsafe<{ sharers: number; shares: number; clicks: number; registered: number }[]>(
      `SELECT (SELECT COUNT(DISTINCT "registrationId") FROM "WebinarShareEvent" WHERE "webinarId" = $1::text)::int AS "sharers",
              (SELECT COUNT(*)                        FROM "WebinarShareEvent" WHERE "webinarId" = $1::text)::int AS "shares",
              (SELECT COALESCE(SUM(clicks), 0)        FROM "WebinarShareClick" WHERE "webinarId" = $1::text)::int AS "clicks",
              (SELECT COUNT(*) FROM "WebinarRegistration"
                WHERE "webinarId" = $1::text AND "referredById" IS NOT NULL)::int                               AS "registered"`,
      id,
    ),
    prisma.webinarShareEvent.groupBy({ by: ["surface"], where: { webinarId: id }, _count: { _all: true } }),
    prisma.$queryRawUnsafe<
      { name: string; company: string | null; shares: number; clicks: number; registered: number }[]
    >(
      `SELECT r.name,
              r.company,
              COALESCE(se.n, 0)::int  AS "shares",
              COALESCE(sc.n, 0)::int  AS "clicks",
              COALESCE(rf.n, 0)::int  AS "registered"
         FROM "WebinarRegistration" r
         LEFT JOIN (SELECT "registrationId" AS rid, COUNT(*) n FROM "WebinarShareEvent"
                     WHERE "webinarId" = $1::text GROUP BY 1) se ON se.rid = r.id
         LEFT JOIN (SELECT "shareCode" AS code, SUM(clicks) n FROM "WebinarShareClick"
                     WHERE "webinarId" = $1::text GROUP BY 1) sc ON sc.code = r."shareCode"
         LEFT JOIN (SELECT "referredById" AS rid, COUNT(*) n FROM "WebinarRegistration"
                     WHERE "webinarId" = $1::text AND "referredById" IS NOT NULL GROUP BY 1) rf ON rf.rid = r.id
        WHERE r."webinarId" = $1::text
          AND (se.n > 0 OR sc.n > 0 OR rf.n > 0)
        ORDER BY "registered" DESC, "clicks" DESC, "shares" DESC
        LIMIT 8`,
      id,
    ),
  ]);

  /* 웨비나 전 리드 품질 — 폼 구성에 따라 비어 있을 수 있는 필드만 센다(이름은 필수라 제외). */
  const [leadQualityRow] = await prisma.$queryRawUnsafe<
    { consented: number; withEmail: number; withPhone: number; withCompany: number }[]
  >(
    `SELECT COUNT(*) FILTER (WHERE "agreeMarketing")::int                          AS "consented",
            COUNT(*) FILTER (WHERE email   IS NOT NULL AND email   <> '')::int     AS "withEmail",
            COUNT(*) FILTER (WHERE phone   IS NOT NULL AND phone   <> '')::int     AS "withPhone",
            COUNT(*) FILTER (WHERE company IS NOT NULL AND company <> '')::int     AS "withCompany"
       FROM "WebinarRegistration" WHERE "webinarId" = $1::text`,
    id,
  );

  const qaCount = { pending: 0, answered: 0, dismissed: 0 };
  for (const g of qaByStatus) {
    if (g.status === "pending") qaCount.pending = g._count._all;
    else if (g.status === "answered") qaCount.answered = g._count._all;
    else if (g.status === "dismissed") qaCount.dismissed = g._count._all;
  }
  const qaTotal = qaCount.pending + qaCount.answered + qaCount.dismissed;
  const chatRow = chatAgg[0] ?? { messages: 0, participants: 0 };
  const ctaRow = ctaAgg[0] ?? { clicks: 0, clickers: 0 };

  const interactions = {
    polls: pollRows.map((p) => ({
      id: p.id,
      question: p.question,
      isActive: p.isActive,
      totalVotes: p.options.reduce((sum, o) => sum + o.voteCount, 0),
      options: p.options.map((o) => ({ label: o.label, voteCount: o.voteCount })),
    })),
    qa: {
      total: qaTotal,
      answered: qaCount.answered,
      pending: qaCount.pending,
      dismissed: qaCount.dismissed,
      answerRate: pct(qaCount.answered, qaTotal),
      top: qaTop.map((q) => ({ question: q.question, voteCount: q.voteCount, status: q.status, name: q.name })),
    },
    chat: {
      messages: Number(chatRow.messages) || 0,
      participants: Number(chatRow.participants) || 0,
    },
    cta: {
      clicks: Number(ctaRow.clicks) || 0,
      clickers: Number(ctaRow.clickers) || 0,
    },
    reminders: reminderCount,
  };

  return NextResponse.json({
    funnel: {
      visits,
      registered: totalRegistered,
      attended,
      stay30,
      stay60,
      avgStayMinutes,
      maxStayMinutes,
      attendRate: pct(attended, totalRegistered),
      stay30Rate: pct(stay30, attended),
      stay60Rate: pct(stay60, attended),
      regRate: pct(totalRegistered, visits),
    },
    utmBreakdown,
    campaignBreakdown,
    /* 광고비 조인 투명성 — 화면이 캡션·안내로 밝힌다.
       costScope: 합산 기간. unmatchedAdCampaigns: 이름이 안 맞아 비용이 안 붙은 광고 캠페인. */
    costScope: { from: costFrom.toISOString(), to: costTo.toISOString() },
    unmatchedAdCampaigns,
    registrationTrend,
    interactions,
    scoring: {
      total: engagement.rows.length,
      /** 점수 분모로 실제 쓴 방송 경과 분 — 화면이 "방송 47분 기준" 처럼 밝힌다 */
      liveMinutes: engagement.liveMinutes,
      /** 예정 길이. 분모와 다르면(방송 중·조기 종료) 화면이 그 이유를 설명한다 */
      scheduledMinutes: engagement.scheduledMinutes,
      phase,
      distribution,
      top: topEngaged,
      retargetCount,
      leadQuality: {
        consented: Number(leadQualityRow?.consented) || 0,
        withEmail: Number(leadQualityRow?.withEmail) || 0,
        withPhone: Number(leadQualityRow?.withPhone) || 0,
        withCompany: Number(leadQualityRow?.withCompany) || 0,
      },
    },
    /* 입소문 — 공유 N명 → 클릭 N → 등록 N. 아무도 공유하지 않았으면 화면이 섹션을 숨긴다
       (config 토글 + 실제 데이터 이중 게이트와 같은 원칙: 빈 껍데기를 보여주지 않는다). */
    wordOfMouth: {
      sharers: Number(womTotals[0]?.sharers) || 0,
      shares: Number(womTotals[0]?.shares) || 0,
      clicks: Number(womTotals[0]?.clicks) || 0,
      registered: Number(womTotals[0]?.registered) || 0,
      bySurface: womBySurface.map((g) => ({ surface: g.surface, count: g._count._all })),
      top: topReferrers.map((r) => ({
        name: r.name,
        company: r.company,
        shares: Number(r.shares) || 0,
        clicks: Number(r.clicks) || 0,
        registered: Number(r.registered) || 0,
      })),
    },
    performanceFunnel,
    leadAnalysis,
    hasVisitData: visits > 0,
    generatedAt: new Date().toISOString(),
  });
}
