"use client";

/**
 * 웨비나 라이브 즉시 알림 받기 — Supabase Realtime(Broadcast) 공개 채널을 구독한다.
 * 운영자가 공지·투표·팝업 등을 바꾸면 서버(src/lib/webinar-live-signal.ts)가 신호를 보내고,
 * 이 훅이 onSignal(at) 을 부른다. 화면은 그때 상태를 다시 받는다.
 *
 * - 신호에는 내용이 없다(공개 채널). 무엇을 보여 줄지는 늘 /live-state 가 정한다.
 * - 수백 명이 같은 순간 신호를 받으므로 0~jitterMs 사이에 흩어서 부른다(서버 묶음 캐시가 받아 준다).
 * - 연속 신호(채팅이 몰릴 때)는 하나로 합친다 — 대기 중이면 가장 늦은 at 만 남긴다.
 * - connected 가 false 면(연결 실패·동시 접속 한도 초과·차단된 네트워크) 화면은 예비 폴링을 촘촘히 한다.
 */
import { useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { LIVE_SIGNAL_EVENT, liveSignalTopic } from "@/lib/webinar-live-signal-shared";

let client: SupabaseClient | null = null;
function realtimeClient(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // 로그인 세션과 섞이지 않게 — 시청자는 익명이고, 이 클라이언트는 실시간 구독만 한다.
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return client;
}

export function useLiveSignal(webinarId: string | null | undefined, onSignal: (at: number) => void, opts: { enabled?: boolean; jitterMs?: number } = {}) {
  const { enabled = true, jitterMs = 800 } = opts;
  const [connected, setConnected] = useState(false);
  const handler = useRef(onSignal);
  useEffect(() => { handler.current = onSignal; }, [onSignal]);

  useEffect(() => {
    if (!enabled || !webinarId) return;
    const sb = realtimeClient();
    if (!sb) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latest = 0;
    const channel = sb.channel(liveSignalTopic(webinarId), { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: LIVE_SIGNAL_EVENT }, (msg) => {
      const at = Number((msg.payload as { at?: unknown } | undefined)?.at) || Date.now();
      latest = Math.max(latest, at);
      if (timer) return; // 이미 곧 부를 예정 — 가장 늦은 at 으로 한 번만
      timer = setTimeout(() => {
        timer = null;
        handler.current(latest);
      }, Math.floor(Math.random() * jitterMs));
    });
    channel.subscribe((status) => {
      setConnected(status === "SUBSCRIBED");
    });
    return () => {
      if (timer) clearTimeout(timer);
      setConnected(false);
      void sb.removeChannel(channel);
    };
  }, [enabled, webinarId, jitterMs]);

  return connected;
}
