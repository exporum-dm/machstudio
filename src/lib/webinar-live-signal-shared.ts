/** 즉시 알림 채널 이름·이벤트 — 서버(webinar-live-signal.ts)와 시청 화면(use-live-signal.ts)이 같이 쓴다. */
export type LiveSignalKind = "announcement" | "poll" | "popup" | "tally" | "survey" | "qa" | "chat" | "webinar";
export const liveSignalTopic = (webinarId: string) => `webinar-live:${webinarId}`;
export const LIVE_SIGNAL_EVENT = "changed";
