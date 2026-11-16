import { NextResponse } from "next/server";
import { surveyAcceptingWhere } from "@/lib/webinar-survey";
import { prisma } from "@/lib/prisma";
import { resolveWebinarStatus } from "@/lib/webinar-status";
import { normalizeQaMode } from "@/lib/webinar-config";
import { maskName } from "@/lib/mask";
import { SharedLoadCache, VerdictMemo } from "@/lib/shared-load-cache";

const CORS = { "Access-Control-Allow-Origin": "*" };

// 통합 라이브 상태 — 시청자가 폴링하던 여러 엔드포인트(공지·Q&A·채팅·투표·팝업·Tally·상태)를
// 한 번의 요청으로 합쳐 egress/요청 수를 대폭 줄인다.
// 쿼리: registrationId(있으면 Q&A 보드+채팅 게이팅), chat=1(채팅 탭 활성 시), chatAfter=<ISO>(증분),
//       qa=1(Q&A 탭), v=<ms>(즉시 알림의 바뀐 시각 — 그보다 오래된 묶음 캐시는 쓰지 않는다)
//
// ## 묶음 캐시 (2026-11-16, 동시 500명 대비)
// 예전엔 시청자 요청마다 DB 질의 9개가 나가 시청자 수만큼 부하가 늘었다(2026-08-11 91명에 연결 고갈).
// 이제는 웨비나별 "모두에게 같은 값"을 인스턴스당 SHARED_TTL_MS 에 한 번만 읽고, 요청마다
// 등록자 여부·탭에 따라 잘라서 준다. 등록자 확인도 기억해 두어(VerdictMemo) 매번 묻지 않는다.
// 즉시 알림(webinar-live-signal)이 오면 화면이 v=바뀐 시각 을 붙여 부르므로 옛 캐시를 받지 않는다.
const SHARED_TTL_MS = 2_000;
const shared = new SharedLoadCache<Shared | null>(SHARED_TTL_MS);
const viewers = new VerdictMemo(10 * 60_000, 30_000);

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    return await liveState(request, ctx);
  } catch (err) {
    // DB 연결 고갈(EMAXCONN)·일시 장애 때 맨 500(빈 본문) 대신 503 — 2026-08-11 라이브 중
    // 풀러 한도 초과로 이 라우트만 죽어 시청자 화면이 "영상이 연결되지 않았어요" 가 됐다.
    // 뷰어 폴러는 !res.ok 면 이번 폴을 버리고 화면 값(youtubeId 포함)을 유지한 채 다음 주기에 재시도한다.
    console.error("[live-state]", err);
    return NextResponse.json(
      { error: "일시적인 서버 혼잡이에요" },
      { status: 503, headers: { ...CORS, "Retry-After": "12" } },
    );
  }
}

/** 웨비나 하나의 "모두에게 같은" 라이브 상태 — 등록자 게이팅 전의 원재료. */
async function loadShared(slug: string) {
  const webinar = await prisma.webinar.findUnique({
    where: { slug },
    select: {
      id: true, statusOverride: true, liveStartAt: true, liveEndAt: true, signupDeadline: true, components: true, config: true,
      project: { select: { deletedAt: true } },
    },
  });
  // project.deletedAt 이 있으면 삭제 유예(30일) 중인 프로젝트 — 지금 못 찾는 웨비나와 동일하게 처리한다.
  if (!webinar || webinar.project.deletedAt !== null) return null;

  const statusInfo = resolveWebinarStatus(webinar);
  const components = (webinar.components ?? {}) as Record<string, unknown>;
  const chatEnabled = components.chatEnabled === true;
  // 폐쇄형(주최자만 열람)이면 보드를 **조회조차 하지 않는다** — 뷰어에서 숨기는 건 게이팅이 아니다.
  const qaMode = normalizeQaMode(components);
  const wid = webinar.id;

  // 실시간 동시 시청자 수 — 라이브 중에만(사회적 증거 배지). 어드민 대시보드의 presenceSince 와
  // 같은 최근성 창(5분) — 최근성 필터가 없으면 leave 신호가 거의 안 오는 모바일에서 과대 편향된다.
  const presenceSince = new Date(Date.now() - 5 * 60_000);

  // 동시 병렬 조회 — 풀(max 2)이 알아서 큐잉하므로 여기 몇 개를 늘어놓든 인스턴스가 잡는 연결 수는
  // 늘지 않는다 — src/lib/prisma.ts 참고. 묶음 캐시라 웨비나당 2초에 한 번이다.
  const [announcements, qaRows, pollRow, popupRow, tallyRow, surveyRow, chatRows, pushedRow, pinnedRow, viewerCount] = await Promise.all([
    prisma.webinarAnnouncement.findMany({
      where: { webinarId: wid, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, message: true, createdAt: true },
    }),
    qaMode === "open"
      ? prisma.webinarQA.findMany({
          where: { webinarId: wid, status: { not: "dismissed" } },
          orderBy: [{ voteCount: "desc" }, { createdAt: "asc" }],
          take: 100,
          select: { id: true, question: true, sessionNumber: true, status: true, createdAt: true, name: true, voteCount: true },
        })
      : Promise.resolve(null),
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
    // 채팅 최근 50개 — 증분(chatAfter)은 요청마다 이 목록에서 잘라 준다.
    chatEnabled
      ? prisma.webinarChatMessage.findMany({
          where: { webinarId: wid },
          orderBy: { createdAt: "desc" }, take: 50,
          select: { id: true, name: true, message: true, isHost: true, createdAt: true },
        }).then((r) => r.reverse())
      : Promise.resolve(null),
    // Q&A '화면에 띄우기' — 현재 송출 중인 질문(웨비나당 1개). dismissed 제외.
    prisma.webinarQA.findFirst({
      where: { webinarId: wid, onScreen: true, status: { not: "dismissed" } },
      select: { id: true, question: true, name: true },
    }),
    chatEnabled
      ? prisma.webinarChatMessage.findFirst({
          where: { webinarId: wid, isPinned: true },
          select: { id: true, name: true, message: true, isHost: true, createdAt: true },
        })
      : Promise.resolve(null),
    statusInfo.status === "live"
      ? prisma.webinarRegistration.count({
          where: {
            webinarId: wid,
            isActive: true,
            OR: [{ presencePingAt: { gte: presenceSince } }, { lastPingAt: { gte: presenceSince } }],
          },
        })
      : Promise.resolve(null),
  ]);

  const yt = (webinar.config as Record<string, unknown> | null)?.youtubeId;
  return {
    webinar: { id: wid, statusOverride: webinar.statusOverride, liveStartAt: webinar.liveStartAt, liveEndAt: webinar.liveEndAt, signupDeadline: webinar.signupDeadline },
    chatEnabled,
    qaMode,
    youtubeId: typeof yt === "string" ? yt : null,
    viewerCount,
    announcements,
    answeredQA: qaRows ? qaRows.map((q) => ({ ...q, name: q.name ? maskName(q.name) : null })) : null,
    chat: chatRows
      ? chatRows.map((m) => ({ id: m.id, name: m.isHost ? m.name : maskName(m.name), message: m.message, isHost: m.isHost, createdAt: m.createdAt }))
      : null,
    poll: pollRow ?? null,
    popup: popupRow ?? null,
    tally: tallyRow ?? null,
    survey: surveyRow ?? null,
    pushedQuestion: pushedRow ? { id: pushedRow.id, question: pushedRow.question, name: pushedRow.name ? maskName(pushedRow.name) : null } : null,
    pinnedMessage: pinnedRow
      ? { id: pinnedRow.id, name: pinnedRow.isHost ? pinnedRow.name : maskName(pinnedRow.name), message: pinnedRow.message, isHost: pinnedRow.isHost, createdAt: pinnedRow.createdAt }
      : null,
  };
}
type Shared = Awaited<ReturnType<typeof loadShared>>;

/**
 * registrationId 는 쿼리스트링에서 온 **자칭**이다 — "값이 있다"가 아니라 "이 웨비나의 등록자다"를
 * 확인해야 한다(예전엔 truthy 검사만 해서 ?registrationId=아무거나 로 등록자 전용 콘텐츠가 새었다).
 * 확인 결과는 잠깐 기억한다 — 시청자가 몇 초마다 부르는데 매번 DB 에 묻지 않게.
 */
async function isRegistered(registrationId: string | null, webinarId: string) {
  if (!registrationId) return false;
  const key = `${webinarId}:${registrationId}`;
  const known = viewers.get(key);
  if (known !== undefined) return known;
  const row = await prisma.webinarRegistration.findFirst({ where: { id: registrationId, webinarId }, select: { id: true } });
  viewers.set(key, row !== null);
  return row !== null;
}

async function liveState(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(request.url);
  const registrationId = url.searchParams.get("registrationId");
  const wantChat = url.searchParams.get("chat") === "1";
  const wantQa = url.searchParams.get("qa") === "1"; // Q&A 탭 활성 시에만 100행 보드 전송(egress 절감)
  const chatAfterRaw = url.searchParams.get("chatAfter");
  const v = Number(url.searchParams.get("v"));
  // 미래 시각을 보내 캐시를 계속 우회하지 못하게 — 지금보다 뒤는 지금으로.
  const minStartedAt = Number.isFinite(v) && v > 0 ? Math.min(v, Date.now()) : 0;

  const s = await shared.get(slug, () => loadShared(slug), minStartedAt);
  if (!s) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404, headers: CORS });

  const isViewer = await isRegistered(registrationId, s.webinar.id);
  // 상태는 시각으로 정해지므로(시작·종료 시각) 캐시된 값이 아니라 지금 계산한다.
  const statusInfo = resolveWebinarStatus(s.webinar);

  let chat: { messages: NonNullable<Shared>["chat"] } | undefined;
  if (wantChat && s.chatEnabled && isViewer && s.chat) {
    const afterMs = chatAfterRaw ? Date.parse(chatAfterRaw) : NaN;
    chat = { messages: Number.isNaN(afterMs) ? s.chat : s.chat.filter((m) => m.createdAt.getTime() >= afterMs) };
  }

  return NextResponse.json(
    {
      status: statusInfo.status,
      entryOpen: statusInfo.entryOpen,
      serverNow: new Date().toISOString(),
      chatEnabled: s.chatEnabled,
      // 라이브 중 콘솔에서 모드를 바꿔도 이미 보고 있는 시청자가 다음 폴에서 따라오게(chatEnabled 와 동일 패턴)
      qaMode: s.qaMode,
      // 영상 동기화 — 유효 등록자에게만 현재 설정을 전달한다.
      youtubeId: isViewer ? s.youtubeId : null,
      viewerCount: statusInfo.status === "live" ? s.viewerCount : null,
      announcements: s.announcements,
      answeredQA: isViewer && wantQa && s.qaMode === "open" && s.answeredQA ? s.answeredQA : undefined,
      chat,
      poll: s.poll,
      popup: s.popup,
      tally: s.tally,
      survey: s.survey,
      // Q&A 송출·고정 채팅은 등록자 전용 콘텐츠.
      pushedQuestion: isViewer ? s.pushedQuestion : null,
      pinnedMessage: isViewer && s.chatEnabled ? s.pinnedMessage : null,
    },
    // 응답은 요청마다 다르다(등록자 여부·탭·chatAfter) — CDN 캐시 안 함. 묶음은 서버 안에서만.
    { headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET" } });
}
