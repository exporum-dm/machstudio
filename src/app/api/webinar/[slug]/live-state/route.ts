import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { maskName } from "@/lib/mask";
import { getWebinarLiveSnapshot } from "@/lib/webinar-live-snapshot";
import { normalizeLiveSessionDisplay } from "@/lib/webinar-config";

const CORS = { "Access-Control-Allow-Origin": "*" };

// 통합 라이브 상태 — 시청자가 폴링하던 여러 엔드포인트(공지·Q&A·채팅·투표·팝업·Tally·상태)를
// 한 번의 요청으로 합쳐 egress/요청 수를 대폭 줄인다.
// 쿼리: registrationId(있으면 Q&A 보드+채팅 게이팅), chat=1(채팅 탭 활성 시), chatAfter=<ISO>(증분)
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    return await liveState(request, ctx);
  } catch (err) {
    // DB 연결 고갈(EMAXCONN)·일시 장애 때 맨 500(빈 본문) 대신 503 — 2026-08-11 라이브 중
    // 풀러 한도 초과로 이 라우트만 죽어 시청자 화면이 "영상이 연결되지 않았어요" 가 됐다.
    // 뷰어 폴러는 !res.ok 면 이번 폴을 버리고 화면 값(youtubeId 포함)을 유지한 채 12초 뒤 재시도한다.
    console.error("[live-state]", err);
    return NextResponse.json(
      { error: "일시적인 서버 혼잡이에요" },
      { status: 503, headers: { ...CORS, "Retry-After": "12" } },
    );
  }
}

async function liveState(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(request.url);
  const registrationId = url.searchParams.get("registrationId");
  const wantChat = url.searchParams.get("chat") === "1";
  const wantQa = url.searchParams.get("qa") === "1"; // Q&A 탭 활성 시에만 100행 보드 전송(egress 절감)
  const chatAfterRaw = url.searchParams.get("chatAfter");

  /**
   * **모든 시청자가 똑같이 받는 부분은 한 번만 읽는다**(5초 스냅샷, lib/webinar-live-snapshot).
   * 공지·투표·팝업·Tally·설문·시청자수·웨비나 행이 여기 들어 있다 — 500명이 12초마다 부르면
   * 초당 42요청인데, 예전에는 그 요청마다 같은 답을 내는 쿼리를 7건씩 따로 날렸다.
   * 아래 **시청자별**로 달라지는 조회(소속 확인·Q&A 보드·채팅·송출 질문·고정 메시지)만 매번 한다.
   */
  const snap = await getWebinarLiveSnapshot(slug);
  if (!snap.webinar || !snap.status) {
    return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404, headers: CORS });
  }

  const statusInfo = snap.status;
  const chatEnabled = snap.chatEnabled;
  // 폐쇄형(주최자만 열람)이면 보드를 **조회조차 하지 않는다** — 뷰어에서 숨기는 건 게이팅이 아니다.
  // (응답에 실리면 개발자도구에서 그대로 읽힌다). 겸사겸사 100행 전송도 사라져 egress 도 줄어든다.
  const qaMode = snap.qaMode;
  const wid = snap.webinar.id;

  // registrationId 는 쿼리스트링에서 온 **자칭**이다 — "값이 있다"가 아니라 "이 웨비나의 등록자다"를
  // 확인해야 한다. 예전엔 아래 youtubeId 만 소속을 검증하고, Q&A 보드·채팅·송출 질문·고정 메시지는
  // truthy 검사만 했다. 그래서 ?registrationId=아무거나 로 등록자 전용 콘텐츠(질문·채팅 원문)가
  // 미등록자에게도, 심지어 다른 웨비나 등록자에게도 그대로 나갔다.
  // **이 조회만은 캐시하지 않는다** — 소속 판정이 낡으면 권한이 낡는다.
  const viewer = registrationId
    ? await prisma.webinarRegistration.findFirst({
        where: { id: registrationId, webinarId: wid },
        select: { id: true },
      })
    : null;
  const isViewer = viewer !== null;

  // 시청자별 조회만 병렬로. 풀(max 2)이 알아서 큐잉하므로 여기 몇 개를 늘어놓든
  // 인스턴스가 잡는 연결 수는 늘지 않는다 — src/lib/prisma.ts 참고.
  const [qaRows, chatRows, pushedRow, pinnedRow] = await Promise.all([
    isViewer && wantQa && qaMode === "open"
      ? prisma.webinarQA.findMany({
          where: { webinarId: wid, status: { not: "dismissed" } },
          orderBy: [{ voteCount: "desc" }, { createdAt: "asc" }],
          take: 100,
          select: { id: true, question: true, sessionNumber: true, status: true, createdAt: true, name: true, voteCount: true },
        })
      : Promise.resolve(null),
    wantChat && chatEnabled && isViewer
      ? (() => {
          const afterMs = chatAfterRaw ? Date.parse(chatAfterRaw) : NaN;
          const after = Number.isNaN(afterMs) ? null : new Date(afterMs);
          return after
            ? prisma.webinarChatMessage.findMany({
                where: { webinarId: wid, createdAt: { gte: after } },
                orderBy: { createdAt: "asc" }, take: 50,
                select: { id: true, name: true, message: true, isHost: true, createdAt: true },
              })
            : prisma.webinarChatMessage.findMany({
                where: { webinarId: wid },
                orderBy: { createdAt: "desc" }, take: 50,
                select: { id: true, name: true, message: true, isHost: true, createdAt: true },
              }).then((r) => r.reverse());
        })()
      : Promise.resolve(null),
    // Q&A '화면에 띄우기' — 현재 송출 중인 질문(웨비나당 1개). Q&A 보드처럼 등록자 게이팅 + dismissed 제외.
    isViewer
      ? prisma.webinarQA.findFirst({
          where: { webinarId: wid, onScreen: true, status: { not: "dismissed" } },
          select: { id: true, question: true, name: true },
        })
      : Promise.resolve(null),
    // 고정 채팅 메시지 — chatEnabled + 확인된 등록자일 때만(채팅 콘텐츠).
    chatEnabled && isViewer
      ? prisma.webinarChatMessage.findFirst({
          where: { webinarId: wid, isPinned: true },
          select: { id: true, name: true, message: true, isHost: true, createdAt: true },
        })
      : Promise.resolve(null),
  ]);

  const answeredQA = qaRows
    ? qaRows.map((q) => ({ ...q, name: q.name ? maskName(q.name) : null }))
    : undefined;
  const chat = chatRows
    ? { messages: chatRows.map((m) => ({ id: m.id, name: m.isHost ? m.name : maskName(m.name), message: m.message, isHost: m.isHost, createdAt: m.createdAt })) }
    : undefined;
  const pushedQuestion = pushedRow
    ? { id: pushedRow.id, question: pushedRow.question, name: pushedRow.name ? maskName(pushedRow.name) : null }
    : null;
  const pinnedMessage = pinnedRow
    ? { id: pinnedRow.id, name: pinnedRow.isHost ? pinnedRow.name : maskName(pinnedRow.name), message: pinnedRow.message, isHost: pinnedRow.isHost, createdAt: pinnedRow.createdAt }
    : null;

  // 영상 동기화 — 유효 등록자에게만 현재 설정을 전달한다.
  // 최초 입장 뒤 운영자가 주소를 교체하거나 비워도 다음 상태 폴에서 시청 화면이 같은 값으로 갱신된다.
  // 소속 확인은 위에서 이미 했다 — 같은 조회를 두 번 하지 않는다.
  let youtubeId: string | null = null;
  if (isViewer) {
    const yt = (snap.webinar.config as Record<string, unknown> | null)?.youtubeId;
    youtubeId = typeof yt === "string" ? yt : null;
  }

  return NextResponse.json(
    {
      status: statusInfo.status,
      entryOpen: statusInfo.entryOpen,
      serverNow: new Date().toISOString(),
      chatEnabled,
      // 라이브 중 콘솔에서 모드를 바꿔도 이미 보고 있는 시청자가 다음 폴에서 따라오게(chatEnabled 와 동일 패턴)
      qaMode,
      youtubeId,
      viewerCount: snap.showViewerCount ? snap.viewerCount : null,
      sessionDisplay: normalizeLiveSessionDisplay(snap.webinar.components),
      announcements: snap.announcements,
      answeredQA,
      chat,
      poll: snap.poll ?? null,
      popup: snap.popup ?? null,
      tally: snap.tally ?? null,
      survey: snap.survey ?? null,
      pushedQuestion,
      pinnedMessage,
    },
    // 동적 데이터 — 캐시 안 함 (registrationId/chatAfter 별로 응답이 다름)
    { headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET" } });
}
