/**
 * 프로젝트 대시보드 — "지금 진행 중인 것" 을 메뉴마다 한 줄씩.
 *
 * 예전 대시보드는 사실상 사전등록 통계 화면이었다. 운영자가 아침에 여는 첫 화면은 사전등록뿐
 * 아니라 광고·대회·웨비나까지 "어디가 움직이고 있나" 를 한 번에 봐야 한다(2026-10-08 요청).
 * 사전등록의 자세한 통계는 각 폼의 "현황" 탭으로 옮겼다 — 여기서는 요약하고 그리로 보낸다.
 *
 * "진행 중" 판단은 메뉴마다 다르다. 끝난 것까지 늘어놓으면 첫 화면이 과거 기록으로 덮인다.
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeCollectForm, resolveRegistrationStatus } from "@/lib/collect-form-config";
import { resolveCompetitionStatus, type CompetitionPhase } from "@/lib/competition-status";
import { resolveWebinarStatus, type WebinarStatus } from "@/lib/webinar-status";
import { isDueForNightlySync } from "@/lib/ad-sync/shared";

const DAY_MS = 86_400_000;
/** 사전등록 폼이 "진행 중" 으로 남는 기간 — 마지막 등록이 이보다 오래면 끝난 행사로 본다(연동형). */
const COLLECT_RECENT_DAYS = 30;
/** 발표가 끝난 대회도 며칠은 결과 문의가 들어온다 — 그 뒤엔 첫 화면에서 내린다. */
const ANNOUNCED_KEEP_DAYS = 14;

export interface OverviewCollectSource {
  id: string;
  name: string;
  mode: string;
  /** 빌더형의 등록 상태(before/open/closed). 연동형은 null — 외부 폼이라 우리가 열고 닫지 않는다. */
  registration: "before" | "open" | "closed" | null;
  closesAt: string | null;
  total: number;
  today: number;
  yesterday: number;
  /** 운영 시작일(KST 날짜, YYYY-MM-DD) — 폼 생성일과 첫 등록 중 이른 날. */
  startedAt: string;
  /**
   * 운영 시작일부터 오늘까지 KST 일별 등록 수(오래된 날 → 오늘). 대시보드는 **전체 기간**으로 본다
   * — 최근 7일만 그리면 "지금까지 어떻게 모였나" 가 안 읽힌다는 요청(2026-10-08).
   */
  trend: number[];
  lastAt: string | null;
  /** 현장 체크인을 켠 폼의 입장 인원(중복 스캔 제외). 안 켰으면 null. */
  checkedIn: number | null;
}

export interface OverviewAdFolder {
  id: string;
  name: string;
  reportStart: string;
  reportEnd: string;
  currency: string;
  platforms: string[];
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  lastSyncedAt: string | null;
}

export interface OverviewCompetition {
  id: string;
  slug: string;
  name: string;
  phase: CompetitionPhase;
  recruitCloseAt: string | null;
  entries: number;
  approved: number;
  published: number;
  advanced: number;
  votes: number;
}

export interface OverviewWebinar {
  id: string;
  slug: string;
  name: string;
  status: WebinarStatus;
  liveStartAt: string;
  registrations: number;
}

export interface ProjectOverview {
  generatedAt: string;
  collect: { active: OverviewCollectSource[]; otherCount: number };
  ads: { active: OverviewAdFolder[]; otherCount: number };
  competitions: { active: OverviewCompetition[]; otherCount: number };
  webinars: { active: OverviewWebinar[]; otherCount: number };
  detailPages: { published: Array<{ id: string; name: string; updatedAt: string }>; otherCount: number };
}

/** KST 달력 날짜 키(YYYY-MM-DD). */
function kstDay(date: Date): string {
  return new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** from~to(포함) KST 날짜 키 목록. 너무 길어지지 않게 최근 3년으로 자른다. */
function daySeries(from: string, to: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(t) || Number.isNaN(end)) return [to];
  t = Math.max(t, end - 3 * 365 * DAY_MS);
  for (; t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export async function buildProjectOverview(workspaceId: string, projectId: string, now = new Date()): Promise<ProjectOverview> {
  const [sources, folders, competitions, webinars, pages] = await Promise.all([
    prisma.collectSource.findMany({
      where: { workspaceId, projectId, deletedAt: null },
      select: { id: true, name: true, mode: true, isActive: true, formConfig: true, checkinEnabled: true, createdAt: true },
    }),
    prisma.adPerformanceFolder.findMany({
      where: { workspaceId, projectId },
      select: { id: true, name: true, reportStart: true, reportEnd: true, currency: true, mediaAccounts: true, lastSyncedAt: true },
    }),
    prisma.competition.findMany({
      where: { workspaceId, projectId },
      select: { id: true, slug: true, name: true, recruitOpenAt: true, recruitCloseAt: true, phaseOverride: true, resultPublishedAt: true },
    }),
    prisma.webinar.findMany({
      where: { workspaceId, projectId },
      select: { id: true, slug: true, name: true, liveStartAt: true, liveEndAt: true, signupDeadline: true, statusOverride: true, components: true },
    }),
    prisma.detailPage.findMany({
      where: { workspaceId, projectId, deletedAt: null },
      select: { id: true, name: true, config: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  // ── 사전등록 ──────────────────────────────────────────────────────
  const sourceIds = sources.map((s) => s.id);
  const todayKey = kstDay(now);
  const [totals, daily, checkins] = sourceIds.length
    ? await Promise.all([
        prisma.collectRecord.groupBy({
          by: ["sourceId"],
          where: { sourceId: { in: sourceIds } },
          _count: { _all: true },
          _min: { createdAt: true },
          _max: { createdAt: true },
        }),
        prisma.$queryRaw<Array<{ sourceId: string; day: string; n: number }>>`
          SELECT "sourceId", to_char("createdAt" AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day, count(*)::int AS n
          FROM "CollectRecord"
          WHERE "sourceId" = ANY(${sourceIds})
          GROUP BY 1, 2`,
        prisma.$queryRaw<Array<{ sourceId: string; n: number }>>`
          SELECT "sourceId", count(DISTINCT "recordId")::int AS n
          FROM "CollectCheckIn"
          WHERE "sourceId" = ANY(${sourceIds})
          GROUP BY 1`,
      ])
    : [[], [], []];
  const totalBy = new Map(totals.map((t) => [t.sourceId, { n: t._count._all, first: t._min.createdAt, last: t._max.createdAt }]));
  const dailyBy = new Map(daily.map((d) => [`${d.sourceId}:${d.day}`, d.n]));
  const checkinBy = new Map(checkins.map((c) => [c.sourceId, c.n]));

  const collectAll: Array<OverviewCollectSource & { keep: boolean }> = sources.map((s) => {
    const builder = s.mode === "builder";
    const config = builder ? normalizeCollectForm(s.formConfig) : null;
    const registration = config ? resolveRegistrationStatus(config, now) : null;
    const last = totalBy.get(s.id)?.last ?? null;
    const recent = !!last && now.getTime() - last.getTime() < COLLECT_RECENT_DAYS * DAY_MS;
    const first = totalBy.get(s.id)?.first ?? null;
    const startedAt = kstDay(first && first < s.createdAt ? first : s.createdAt);
    const trend = daySeries(startedAt, todayKey).map((day) => dailyBy.get(`${s.id}:${day}`) ?? 0);
    // 빌더형은 등록 기간이 곧 진행 여부다. 막 만든 폼(아직 0건)도 열려 있으면 보여 준다.
    const keep = s.isActive && (builder ? registration !== "closed" || recent : recent);
    return {
      id: s.id,
      name: s.name,
      mode: s.mode,
      registration,
      closesAt: config?.eventInfo.registrationWindow.closesAt ?? null,
      total: totalBy.get(s.id)?.n ?? 0,
      today: dailyBy.get(`${s.id}:${todayKey}`) ?? 0,
      yesterday: dailyBy.get(`${s.id}:${kstDay(new Date(now.getTime() - DAY_MS))}`) ?? 0,
      startedAt,
      trend,
      lastAt: last ? last.toISOString() : null,
      checkedIn: s.checkinEnabled ? (checkinBy.get(s.id) ?? 0) : null,
      keep,
    };
  });
  const collectActive = collectAll.filter((s) => s.keep).sort((a, b) => b.today - a.today || b.total - a.total);

  // ── 광고 성과 ──────────────────────────────────────────────────────
  const dueFolders = folders.filter((f) => isDueForNightlySync(f, now));
  const adSums = dueFolders.length
    ? await prisma.adPerformanceRecord.groupBy({
        by: ["folderId"],
        where: { folderId: { in: dueFolders.map((f) => f.id) } },
        _sum: { cost: true, impressions: true, clicks: true, conversions: true },
      })
    : [];
  const adBy = new Map(adSums.map((a) => [a.folderId, a._sum]));
  const adsActive: OverviewAdFolder[] = dueFolders
    .map((f) => {
      const sum = adBy.get(f.id);
      const accounts = (Array.isArray(f.mediaAccounts) ? f.mediaAccounts : []) as Array<{ platform?: string }>;
      return {
        id: f.id,
        name: f.name,
        reportStart: f.reportStart.toISOString(),
        reportEnd: f.reportEnd.toISOString(),
        currency: f.currency,
        platforms: [...new Set(accounts.map((a) => a.platform).filter((p): p is string => !!p))],
        cost: sum?.cost ?? 0,
        impressions: sum?.impressions ?? 0,
        clicks: sum?.clicks ?? 0,
        conversions: sum?.conversions ?? 0,
        lastSyncedAt: f.lastSyncedAt ? f.lastSyncedAt.toISOString() : null,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  // ── 대회 ──────────────────────────────────────────────────────────
  const compWithPhase = competitions.map((c) => ({ ...c, phase: resolveCompetitionStatus(c, now).phase }));
  const compKeep = compWithPhase.filter((c) => {
    if (c.phase === "closed") return false;
    if (c.phase === "announced") {
      const at = c.resultPublishedAt?.getTime();
      return !!at && now.getTime() - at < ANNOUNCED_KEEP_DAYS * DAY_MS;
    }
    return true;
  });
  const compIds = compKeep.map((c) => c.id);
  const [entryGroups, voteRows] = compIds.length
    ? await Promise.all([
        prisma.competitionEntry.groupBy({
          by: ["competitionId", "status", "isPublished", "advanced"],
          where: { competitionId: { in: compIds } },
          _count: { _all: true },
        }),
        prisma.$queryRaw<Array<{ competitionId: string; n: number }>>`
          SELECT r."competitionId", count(v.id)::int AS n
          FROM "CompetitionVote" v JOIN "CompetitionRound" r ON r.id = v."roundId"
          WHERE r."competitionId" = ANY(${compIds})
          GROUP BY 1`,
      ])
    : [[], []];
  const votesBy = new Map(voteRows.map((v) => [v.competitionId, v.n]));
  const competitionsActive: OverviewCompetition[] = compKeep.map((c) => {
    const groups = entryGroups.filter((g) => g.competitionId === c.id);
    const count = (pred: (g: (typeof groups)[number]) => boolean) =>
      groups.filter(pred).reduce((sum, g) => sum + g._count._all, 0);
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      phase: c.phase,
      recruitCloseAt: c.recruitCloseAt ? c.recruitCloseAt.toISOString() : null,
      entries: count(() => true),
      approved: count((g) => g.status === "approved"),
      published: count((g) => g.isPublished),
      advanced: count((g) => g.advanced),
      votes: votesBy.get(c.id) ?? 0,
    };
  });

  // ── 웨비나 ────────────────────────────────────────────────────────
  const webinarWithStatus = webinars.map((w) => ({
    ...w,
    status: resolveWebinarStatus(w, now).status,
  }));
  const webinarKeep = webinarWithStatus.filter((w) => w.status !== "ended");
  const regGroups = webinarKeep.length
    ? await prisma.webinarRegistration.groupBy({ by: ["webinarId"], where: { webinarId: { in: webinarKeep.map((w) => w.id) } }, _count: { _all: true } })
    : [];
  const regBy = new Map(regGroups.map((r) => [r.webinarId, r._count._all]));
  const webinarsActive: OverviewWebinar[] = webinarKeep
    .map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
      status: w.status,
      liveStartAt: w.liveStartAt.toISOString(),
      registrations: regBy.get(w.id) ?? 0,
    }))
    .sort((a, b) => a.liveStartAt.localeCompare(b.liveStartAt));

  // ── 상세페이지 ────────────────────────────────────────────────────
  const published = pages.filter((p) => (p.config as { noticePage?: { enabled?: unknown } } | null)?.noticePage?.enabled === true);

  return {
    generatedAt: now.toISOString(),
    collect: { active: collectActive.map(({ keep: _keep, ...s }) => s), otherCount: collectAll.length - collectActive.length },
    ads: { active: adsActive, otherCount: folders.length - adsActive.length },
    competitions: { active: competitionsActive, otherCount: competitions.length - competitionsActive.length },
    webinars: { active: webinarsActive, otherCount: webinars.length - webinarsActive.length },
    detailPages: {
      published: published.map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt.toISOString() })),
      otherCount: pages.length - published.length,
    },
  };
}
