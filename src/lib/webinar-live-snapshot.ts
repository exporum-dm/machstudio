/**
 * 라이브 폴(`/api/webinar/[slug]/live-state`)에서 **모든 시청자가 똑같이 받는 부분**을
 * 한 번만 조회해 짧게 재사용한다.
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────
 * 시청자는 12초마다 live-state 를 부른다. 500명이면 초당 약 42요청이고, 그 요청 하나하나가
 * 공지·투표·팝업·Tally·설문·시청자수·웨비나 행을 **따로** 읽었다 — 초당 250건이 넘는 쿼리가
 * 전부 같은 답을 돌려주는 구조였다. 2026-08-11 라이브(시청자 91명)에서 Supavisor client 한도를
 * 넘겨 이 라우트만 죽었고, 시청자 화면이 "영상이 연결되지 않았어요" 가 됐다.
 * 그때는 인스턴스당 연결 수를 2로 줄여 막았지만(`lib/prisma.ts`), 그건 연결을 아낀 것이지
 * **쿼리 수를 줄인 게 아니다** — 시청자가 늘면 같은 벽에 다시 부딪힌다.
 *
 * ── 왜 Redis 가 아니라 인스턴스 메모리인가 ────────────────────────────
 * 이 값은 5초 뒤에 버려도 되는 것이라 **일관성이 필요 없다**. Redis 로 가면 왕복이 하나
 * 늘어 DB 쿼리를 네트워크 왕복으로 바꾸는 데 그친다. Fluid Compute 는 인스턴스를 재사용하며
 * 한 인스턴스가 동시 요청을 여러 개 처리하므로, 프로세스 메모리만으로도 적중률이 아주 높다.
 *
 * ── 동시 만료 보호 ────────────────────────────────────────────────────
 * 캐시만 두면 TTL 이 끝나는 순간 그 인스턴스에 몰려 있던 요청이 **전부** DB 로 간다
 * (thundering herd). 진행 중인 조회를 공유해(single-flight) 만료 시점에도 쿼리 한 벌만 나간다.
 */
import { prisma } from "@/lib/prisma";
import { surveyAcceptingWhere } from "@/lib/webinar-survey";
import { resolveWebinarStatus } from "@/lib/webinar-status";
import { normalizeLivePageConfig, normalizeQaMode } from "@/lib/webinar-config";

/**
 * 신선도 한도. 폴 주기(12초)의 절반이 안 되게 잡아, 공지를 올린 운영자가 체감하는 지연이
 * **폴 주기 안에서 흡수**되게 한다(최악 12초 + 5초).
 */
const SNAPSHOT_TTL_MS = 5_000;

/** 동시 시청자 수의 최근성 창 — 어드민 대시보드·대기 화면과 **같은 값**이어야 숫자가 안 튄다. */
const PRESENCE_WINDOW_MS = 5 * 60_000;

export interface WebinarLiveSnapshot {
  webinar: {
    id: string;
    statusOverride: string | null;
    liveStartAt: Date | null;
    liveEndAt: Date | null;
    signupDeadline: Date | null;
    components: unknown;
    config: unknown;
    projectDeleted: boolean;
  } | null;
  status: ReturnType<typeof resolveWebinarStatus> | null;
  chatEnabled: boolean;
  qaMode: ReturnType<typeof normalizeQaMode>;
  announcements: Array<{ id: string; type: string; message: string; createdAt: Date }>;
  poll: unknown;
  popup: unknown;
  tally: unknown;
  survey: unknown;
  /** 라이브 중 동시 시청자 수. 라이브가 아니면 null — 그때는 waitingCount 가 그 자리를 맡는다. */
  viewerCount: number | null;
  /** 시청자용 응답에 집계 결과를 공개할지 여부. */
  showViewerCount: boolean;
  /** 라이브 전 "N명이 함께 기다려요". 라이브 중이면 null(두 수가 한 화면에서 경쟁하지 않게). */
  waitingCount: number | null;
  /** 누적 사전등록자 수 — 사회적 증거. 위 두 값과 달리 "지금 접속 중" 이 아니라 총원이다. */
  registrantCount: number;
}

interface Entry {
  value: WebinarLiveSnapshot;
  expiresAt: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<WebinarLiveSnapshot>>();

/**
 * 메모리 누수 방지 — 슬러그는 사실상 유한하지만(동시 진행 웨비나 수), 장수명 인스턴스에
 * 과거 슬러그가 쌓이는 것은 막는다. 만료된 항목만 걷어낸다.
 */
function sweep(now: number): void {
  if (cache.size < 200) return;
  for (const [k, e] of cache) if (e.expiresAt <= now) cache.delete(k);
}

export async function getWebinarLiveSnapshot(slug: string): Promise<WebinarLiveSnapshot> {
  const now = Date.now();
  const hit = cache.get(slug);
  if (hit && hit.expiresAt > now) return hit.value;

  const running = inFlight.get(slug);
  if (running) return running;

  const task = loadSnapshot(slug)
    .then((value) => {
      cache.set(slug, { value, expiresAt: Date.now() + SNAPSHOT_TTL_MS });
      sweep(Date.now());
      return value;
    })
    .finally(() => {
      inFlight.delete(slug);
    });

  inFlight.set(slug, task);
  return task;
}

async function loadSnapshot(slug: string): Promise<WebinarLiveSnapshot> {
  const row = await prisma.webinar.findUnique({
    where: { slug },
    select: {
      id: true, statusOverride: true, liveStartAt: true, liveEndAt: true, signupDeadline: true,
      components: true, config: true,
      project: { select: { deletedAt: true } },
    },
  });

  // 삭제 유예(30일) 중인 프로젝트의 웨비나는 **지금 없는 웨비나와 같이** 다룬다.
  // 없다는 사실도 캐시한다 — 없는 슬러그로 들어오는 폴(옛 링크·봇)이 매번 DB 를 때리지 않게.
  if (!row || row.project.deletedAt !== null) {
    return {
      webinar: null, status: null, chatEnabled: false, qaMode: normalizeQaMode({}),
      announcements: [], poll: null, popup: null, tally: null, survey: null,
      viewerCount: null, showViewerCount: false, waitingCount: null, registrantCount: 0,
    };
  }

  const status = resolveWebinarStatus(row);
  const components = (row.components ?? {}) as Record<string, unknown>;
  const wid = row.id;
  const presenceSince = new Date(Date.now() - PRESENCE_WINDOW_MS);

  const [announcements, poll, popup, tally, survey, viewerCount, waitingCount, registrantCount] = await Promise.all([
    prisma.webinarAnnouncement.findMany({
      where: { webinarId: wid, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, message: true, createdAt: true },
    }),
    prisma.webinarPoll.findFirst({
      where: { webinarId: wid, isActive: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, question: true, updatedAt: true, options: { orderBy: { order: "asc" }, select: { id: true, label: true, voteCount: true } } },
    }),
    prisma.webinarPopup.findFirst({
      where: { webinarId: wid, isActive: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, type: true, title: true, message: true, buttonLabel: true, buttonUrl: true,
        secondaryLabel: true, secondaryUrl: true, integrationType: true, embedCode: true,
        tallyFormId: true, tallyEmojiText: true, tallyEmojiAnimation: true, tallyLayout: true,
        tallyWidth: true, tallyAutoClose: true, dismissible: true, updatedAt: true,
      },
    }),
    prisma.webinarTallyPush.findFirst({
      where: { webinarId: wid, isActive: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, title: true, formId: true, emojiText: true, emojiAnimation: true,
        layout: true, width: true, autoClose: true, showOnce: true, doNotShowAfterSubmit: true, updatedAt: true,
      },
    }),
    // 자체 설문 푸시 — 발행 중(isActive)이고 지금 응답을 받는 것만(온·오프 + 응답 기간).
    // questions 는 폴 페이로드에 싣지 않는다(매 폴 중복 전송 방지) — 모달이 공개 GET 으로 1회 로드.
    prisma.webinarSurvey.findFirst({
      where: { webinarId: wid, isActive: true, ...surveyAcceptingWhere() },
      select: { id: true, title: true, pushedAt: true },
    }),
    /**
     * 동시 시청자 수. 기준은 `presencePingAt` **하나뿐**이다.
     *
     * 예전에는 `OR [presencePingAt, lastPingAt]` 이었다. 그 OR 은 죽은 가지였다 —
     * ping 라우트의 네 경로(wait · enter · leave · heartbeat)가 **전부** presencePingAt 을
     * 찍으므로, "최근 5분 안에 신호를 보낸 행"에 그 값이 없을 수가 없다. 그런데 OR 이 있으면
     * Postgres 가 인덱스 하나로 처리할 수 없어 매번 그 웨비나의 등록자 전 행을 훑었고,
     * 그걸 피하려 lastPingAt 에도 인덱스를 걸면 ping 의 HOT update 가 깨져 쓰기가 무거워진다
     * (분당 500건 갱신 × 인덱스 하나 추가). 조건을 하나로 줄이는 쪽이 양쪽을 다 해결한다.
     */
    status.status === "live"
      ? prisma.webinarRegistration.count({
          where: { webinarId: wid, isActive: true, presencePingAt: { gte: presenceSince } },
        })
      : Promise.resolve(null),
    /**
     * 대기 인원. `isActive` 를 보지 않는 이유: 대기 프레즌스(event: "wait")는 그 값을 건드리지
     * 않는다 — 입장률·시청 시간을 오염시키지 않으려고 presencePingAt 만 찍는다(ping 라우트 주석).
     * 창(5분)은 시청자 수와 같은 값이다. 두 수가 같은 기준이어야 방송이 시작될 때 숫자가 안 튄다.
     */
    status.status === "live"
      ? Promise.resolve(null)
      : prisma.webinarRegistration.count({
          where: { webinarId: wid, presencePingAt: { gte: presenceSince } },
        }),
    prisma.webinarRegistration.count({ where: { webinarId: wid } }),
  ]);

  return {
    webinar: {
      id: row.id, statusOverride: row.statusOverride, liveStartAt: row.liveStartAt,
      liveEndAt: row.liveEndAt, signupDeadline: row.signupDeadline,
      components: row.components, config: row.config, projectDeleted: false,
    },
    status,
    chatEnabled: components.chatEnabled === true,
    qaMode: normalizeQaMode(components),
    announcements,
    poll,
    popup,
    tally,
    survey,
    viewerCount,
    showViewerCount: normalizeLivePageConfig(row.config).entry.viewerCount,
    waitingCount,
    registrantCount,
  };
}
