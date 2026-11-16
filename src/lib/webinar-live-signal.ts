/**
 * 웨비나 라이브 즉시 알림 — 운영자가 공지·투표·팝업·Q&A·채팅·영상·상태를 바꾸면
 * Supabase Realtime(Broadcast)으로 "바뀌었어요" 신호를 보낸다. 시청 화면은 신호를 받자마자
 * /live-state 를 다시 받는다 → 공지가 뜨기까지 평균 6초(12초 폴링) → 1초 안.
 *
 * - 신호에는 **내용을 싣지 않는다**(공개 채널이라 누구나 구독할 수 있다). 무엇을 볼 수 있는지는
 *   늘 /live-state 가 등록자 확인 후 정한다.
 * - `at` = 바뀐 시각(ms). 시청 화면이 이 값을 /live-state 에 `v` 로 넘기면, 서버 묶음 캐시가
 *   그보다 오래된 답을 주지 않는다(바뀐 직후 옛 답을 받는 일을 막는다).
 * - 실패해도 운영자 요청은 성공한다 — 시청 화면의 예비 폴링(12초)이 결국 따라잡는다.
 *
 * 서버리스에서 웹소켓을 열지 않으려고 Realtime REST 브로드캐스트 엔드포인트를 쓴다.
 */
import { after } from "next/server";
import { LIVE_SIGNAL_EVENT, liveSignalTopic, type LiveSignalKind } from "@/lib/webinar-live-signal-shared";

export { LIVE_SIGNAL_EVENT, liveSignalTopic, type LiveSignalKind };


type RouteCtx = { params: Promise<{ id: string }> };

/**
 * 운영자 라우트 감싸기 — 요청이 **성공했을 때만**(2xx, 즉 권한 확인·저장까지 끝난 뒤) 응답을 보낸 다음
 * 즉시 알림을 쏜다. 권한 없는 요청이 시청 화면 수백 개를 흔들지 못하게.
 */
export function withLiveSignal<C extends RouteCtx>(kind: LiveSignalKind, handler: (request: Request, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const res = await handler(request, ctx);
    if (res.ok) {
      const { id } = await ctx.params;
      after(() => signalLive(id, kind));
    }
    return res;
  };
}

export async function signalLive(webinarId: string, kind: LiveSignalKind): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !webinarId) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ topic: liveSignalTopic(webinarId), event: LIVE_SIGNAL_EVENT, payload: { kind, at: Date.now() }, private: false }],
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch (err) {
    console.warn("[live-signal] broadcast failed", kind, err instanceof Error ? err.message : err);
  }
}
