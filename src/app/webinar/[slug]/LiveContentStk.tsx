"use client";

// 인증 후 라이브 시청 화면 — 탭형 "실시간 참여" 레이아웃.
// 상단바 + 플레이어 + 메타(현재 세션·연사) + 참여 독(Q&A/채팅/세션) + 하단 CTA/알림 카드.
// 색은 theme(accent/text/surface)로 구동해 전시별 테마에 맞춘다. Q&A·CTA·알림은 mach 데이터/config 로 채운다.
// buildStkCss 는 대기(PreLiveWaiting)·입장확인(EntryVerify)과 공유하는 토큰/히어로/아젠다만 담고,
// 이 화면 전용 레이아웃은 WATCH_CSS(lv-* 클래스)로 분리한다.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { getYouTubeVideoId } from "@/lib/youtube";
import { CheckCircle2, Send, Share2 } from "lucide-react";
import { webinarRadiusScale } from "@/lib/webinar-radius";
import { formatKst, kstDateString } from "@/lib/datetime";
import { buildSessionNumbering, cleanSessionText, isPauseSession, isRealSession, parseSpeaker, resolveSessionRef, sessionHasSpeaker, sessionTypeLabel } from "@/lib/webinar-sessions";
import SurveyForm, { SURVEY_FORM_CSS, clearSurveyDraft } from "./SurveyForm";
import { formatSurveyOpensAt, type SurveyAnswers, type SurveyQuestion } from "@/lib/webinar-survey";
import { IMAGE_PRESETS, transformedImageUrl } from "@/lib/webinar-image";
import { onAccentColor } from "@/lib/color";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

interface Session {
  id: string;
  number: number;
  type?: string; // "session" | "qa" | "break"
  title: string;
  speaker: string | null;
  speakerCompany?: string | null;
  speakerPhotoUrl?: string | null;
  logoUrl?: string | null;
  description?: string | null;
  startTime: string;
  endTime: string;
}

// 유형 라벨은 sessionTypeLabel(webinar-sessions.ts)이 준다 — 예전엔 이 파일이 자기 맵을
// 들고 있었고, `?? s.type` 폴백이라 표에 없는 값이 **시청자에게 영문 원문**으로 찍혔다.

interface AnsweredQA {
  id: string;
  question: string;
  sessionNumber: number | null;
  name: string | null; // 서버에서 이미 마스킹됨
  voteCount?: number;
  status?: string; // "answered" 면 답변 완료 배지
}

interface ChatMessage {
  id: string;
  name: string; // 서버에서 마스킹됨 (호스트는 표시명)
  message: string;
  isHost: boolean;
}

interface ChatProps {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  isSending: boolean;
  error?: string;
}

interface CtaButton {
  label: string;
  url?: string;
  style?: "white" | "ghost";
  action?: "url" | "form"; // 기본 url — form 이면 자체 폼(WebinarSurvey)을 연다
  surveyId?: string; // action === "form" 일 때 연결된 폼
  open?: "newTab" | "modal"; // 기본 newTab — 모달이면 페이지 안에서 띄운다
}

interface NotifyConfig {
  enabled?: boolean;
  kicker?: string;
  title?: string;
  description?: string;
  switchLabel?: string;
}

interface CtaCard {
  eyebrow?: string;
  title?: string;
  description?: string;
  benefits?: string[];
  buttons?: CtaButton[];
}

interface LivePageConfig {
  infoContact?: string;
  notice?: string;
  cta?: CtaCard; // 레거시 단일 (ctas 없을 때만 사용)
  ctas?: CtaCard[];
  notify?: NotifyConfig;
}

interface WebinarForLive {
  name: string;
  description: string | null;
  liveStartAt: string;
  liveEndAt: string;
  config: Record<string, unknown>;
  sessions: Session[];
}

interface QAProps {
  sessions: Session[];
  question: string;
  setQuestion: (v: string) => void;
  selectedSession: number | null;
  setSelectedSession: (v: number | null) => void;
  onSend: () => void;
  isSending: boolean;
  sent: boolean;
  error?: string;
  answered?: AnsweredQA[];
  onVote?: (qaId: string) => void;
  votedIds?: string[];
  /**
   * 질문 공개 범위.
   *  open   = 올라온 질문을 서로 보고 추천할 수 있다(기본)
   *  closed = 질문은 주최자만 본다 → 시청자에겐 입력창만 남는다.
   * 서버가 폐쇄형이면 목록을 아예 안 내려주므로 여기 분기는 화면 정리용이다(게이팅은 서버 몫).
   */
  mode?: "open" | "closed";
}

const DEFAULT_NOTICE =
  "※ 영상이 보이지 않을 경우 새로고침 후 다시 접속해주세요. 일부 브라우저에서는 자동 재생이 제한될 수 있어요.";

// 공유 STK 스타일 — 대기/입장확인/시청 세 상태가 같은 디자인 토큰을 쓰도록 export.
// (토큰 + 히어로/배지 + 전체폭 아젠다만. 시청 화면 전용 레이아웃은 WATCH_CSS 로 분리)
/**
 * accent 위에 얹을 글자색.
 *
 * 계산은 `@/lib/color` 한 곳에 있다 — 같은 계산이 저장소에 네 벌까지 늘어나던 것을 모았다.
 * **이름은 여기 그대로 둔다**: `live/page.tsx` 와 `BrandSection.tsx` 가 이 파일에서 가져간다.
 */
export { onAccentColor } from "@/lib/color";

export function buildStkCss(accent: string, text: string, surface: string, borderRadius?: string) {
  const rs = webinarRadiusScale(borderRadius);
  return `
.stk-live { --key: ${accent}; --on-key: ${onAccentColor(accent)}; --key-dim: color-mix(in srgb, ${accent} 12%, transparent); --key-border: color-mix(in srgb, ${accent} 36%, transparent);
  --text:${text}; --muted:color-mix(in srgb, ${text} 62%, transparent); --sub:color-mix(in srgb, ${text} 42%, transparent);
  --card:${surface}; --card-2:color-mix(in srgb, ${text} 5%, ${surface});
  --line:color-mix(in srgb, ${text} 10%, transparent); --line-md:color-mix(in srgb, ${text} 17%, transparent); --r-scale:${rs}; --radius-sm:${12 * rs}px; --radius:${20 * rs}px; --radius-lg:${28 * rs}px;
  --card-shadow:0 1px 3px rgba(0,0,0,0.05), 0 14px 34px -16px rgba(0,0,0,0.22);
  --btn-shadow:0 1px 2px rgba(0,0,0,0.05), 0 2px 5px -2px rgba(0,0,0,0.13);
  --btn-shadow-hover:0 2px 5px -1px rgba(0,0,0,0.10), 0 10px 20px -6px rgba(0,0,0,0.22);
  --btn-shadow-key:0 2px 8px -1px color-mix(in srgb, ${accent} 42%, transparent);
  width:100%; color:var(--text); -webkit-font-smoothing:antialiased; }
.stk-live * { box-sizing:border-box; }
.stk-live .live-inner { max-width:1280px; margin:0 auto; padding:56px 24px 96px; }
.stk-live .live-hero { text-align:center; margin-bottom:44px; }
.stk-live .live-badge { display:inline-flex; align-items:center; gap:8px; padding:8px 16px 8px 12px; border:1px solid var(--key-border); border-radius:999px; background:var(--key-dim); font-size:12px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; margin-bottom:24px; }
.stk-live .live-dot { width:7px; height:7px; border-radius:50%; background:var(--key); animation:stkPulse 2s ease-in-out infinite; flex-shrink:0; }
@keyframes stkPulse { 0%,100%{ box-shadow:0 0 0 0 var(--key-border); } 60%{ box-shadow:0 0 0 9px transparent; } }
.stk-live .live-title { font-size:clamp(30px,4.2vw,52px); line-height:1.12; font-weight:900; letter-spacing:-0.045em; word-break:keep-all; color:var(--text); margin:0; }
.stk-live .live-desc { max-width:720px; margin:20px auto 0; color:var(--muted); font-size:clamp(15px,1.7vw,18px); line-height:1.72; word-break:keep-all; white-space:pre-wrap; }
.stk-live .ag-wrap { margin-top:72px; padding-top:72px; border-top:1px solid var(--line); }
.stk-live .ag-head { text-align:center; margin-bottom:44px; }
.stk-live .ag-kicker { display:inline-flex; align-items:center; margin-bottom:16px; padding:8px 16px; border-radius:999px; border:1px solid var(--key-border); background:var(--key-dim); font-size:12px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; }
.stk-live .ag-head h2 { font-size:clamp(28px,3.6vw,44px); line-height:1.1; font-weight:900; letter-spacing:-0.05em; color:var(--text); margin:0; }
.stk-live .ag-session { border-radius:var(--radius); background:var(--card); overflow:hidden; margin-bottom:14px; box-shadow:var(--card-shadow); transition:box-shadow .2s ease; }
.stk-live .ag-session:hover { box-shadow:0 0 0 1px var(--key-border), var(--card-shadow); }
.stk-live .ag-sess-head { display:grid; grid-template-columns:90px 1fr auto; gap:16px; align-items:start; padding:20px 24px; border-bottom:1px solid var(--line); }
.stk-live .ag-sess-num { font-size:11px; font-weight:900; letter-spacing:0.06em; text-transform:uppercase; color:var(--key); padding-top:3px; }
.stk-live .ag-sess-title { font-size:15px; font-weight:750; line-height:1.42; color:var(--text); letter-spacing:-0.03em; word-break:keep-all; margin:0; }
.stk-live .ag-sess-time { font-size:12.5px; font-weight:600; color:var(--sub); white-space:nowrap; text-align:right; padding-top:3px; }
.stk-live .ag-sess-body { display:flex; gap:20px; padding:22px 24px; align-items:center; }
.stk-live .ag-avatar { flex-shrink:0; width:56px; height:56px; border-radius:50%; overflow:hidden; background:var(--key-dim); border:1px solid var(--key-border); display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:800; color:var(--key); }
.stk-live .ag-avatar img { width:100%; height:100%; object-fit:cover; object-position:top center; }
.stk-live .ag-speaker-desc { font-size:14px; line-height:1.66; color:var(--muted); margin-top:6px; word-break:keep-all; }
.stk-live .ag-speaker-name { font-size:15px; font-weight:750; color:var(--text); letter-spacing:-0.02em; }
.stk-live .ag-footer { text-align:center; padding-top:32px; font-size:13px; color:var(--sub); }
@media (max-width:720px) {
  .stk-live .live-inner { padding:40px 18px 64px; }
  .stk-live .live-hero { text-align:left; }
  .stk-live .live-desc { margin-left:0; }
  .stk-live .ag-head { text-align:left; }
  .stk-live .ag-sess-head { grid-template-columns:1fr; gap:8px; padding:16px 18px; }
  .stk-live .ag-sess-time { text-align:left; }
  .stk-live .ag-sess-body { padding:16px 18px; }
}
`;
}

// 시청 화면 전용 레이아웃 (lv-*). 토큰은 buildStkCss 것을 그대로 사용.
const WATCH_CSS = `
.stk-live .lv-wrap { max-width:1240px; margin:0 auto; padding:14px 16px 40px; }
.stk-live .lv-live { --live:#e5484d; }
/* 상단바 */
.stk-live .lv-top { display:flex; align-items:center; gap:14px; padding:10px 4px 18px; }
.stk-live .lv-livepill { display:inline-flex; align-items:center; gap:7px; padding:5px 11px; border-radius:999px; background:color-mix(in srgb,var(--live) 14%,transparent); color:var(--live); font-weight:800; font-size:12px; letter-spacing:0.04em; }
.stk-live .lv-livepill i { width:7px; height:7px; border-radius:50%; background:var(--live); animation:lvPulse 1.6s infinite; }
.stk-live .lv-viewers { display:inline-flex; align-items:center; gap:5px; padding:5px 10px; border-radius:999px; background:color-mix(in srgb,var(--sub) 13%,transparent); color:var(--sub); font-weight:750; font-size:12px; font-variant-numeric:tabular-nums; }
.stk-live .lv-soonpill { display:inline-flex; align-items:center; gap:7px; padding:5px 11px; border-radius:999px; background:var(--key-dim); color:var(--key); border:1px solid var(--key-border); font-weight:800; font-size:12px; letter-spacing:0.04em; }
@keyframes lvPulse { 0%,100%{ box-shadow:0 0 0 0 color-mix(in srgb,var(--live) 55%,transparent);} 60%{ box-shadow:0 0 0 6px transparent; } }
.stk-live .lv-evname { font-weight:750; font-size:15px; letter-spacing:-0.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text); }
.stk-live .lv-sp { flex:1; }
.stk-live .lv-share { display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 14px; border-radius:calc(10px * var(--r-scale, 1)); background:var(--card); color:var(--muted); font:inherit; font-size:13px; font-weight:650; cursor:pointer; box-shadow:var(--btn-shadow); transition:color .15s ease, box-shadow .15s ease, transform .15s ease; }
.stk-live .lv-share:hover { color:var(--text); box-shadow:var(--btn-shadow-hover); transform:translateY(-1px); }
.stk-live .lv-share svg { width:15px; height:15px; }
/* 재확인 — 무효 등록건(삭제됨)으로 갇힌 시청자의 탈출구. 눈에 띄되 공유 버튼보다 낮은 위계(항상
   쓰는 액션이 아니라서). 텍스트 버튼 + 밑줄로 "여기서 뭔가 바뀐다" 는 신호만 준다. */
.stk-live .lv-reauth { display:inline-flex; align-items:center; background:none; border:0; padding:0 2px; height:34px; font:inherit; font-size:12.5px; font-weight:600; color:var(--sub); cursor:pointer; text-decoration:underline; text-underline-offset:3px; transition:color .15s ease; }
.stk-live .lv-reauth:hover { color:var(--muted); }
@media (max-width:720px) { .stk-live .lv-reauth { min-height:44px; } }
/* 스테이지 — 기본 단일 컬럼(모바일), 941px↑에서만 2컬럼+배치 (경계 소수 픽셀 깨짐 방지) */
.stk-live .lv-stage { display:grid; grid-template-columns:1fr; gap:16px; align-items:start; }
@media (min-width:941px) {
  .stk-live .lv-stage { grid-template-columns:minmax(0,1fr) 372px; grid-template-rows:auto auto; }
  .stk-live .lv-player { grid-column:1; grid-row:1; }
  .stk-live .lv-meta { grid-column:1; grid-row:2; }
  .stk-live .lv-dock { grid-column:2; grid-row:1; }
}
/* 플레이어 */
.stk-live .lv-player { position:relative; aspect-ratio:16/9; border-radius:calc(18px * var(--r-scale, 1)); overflow:hidden; background:#0b0d12; box-shadow:var(--card-shadow); }
.stk-live .lv-player iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
.stk-live .lv-poster { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.55); font-size:14px;
  background:radial-gradient(120% 90% at 20% 0%, color-mix(in srgb,var(--key) 45%,#0b0d12), transparent 55%), radial-gradient(120% 120% at 100% 100%, color-mix(in srgb,var(--key) 26%,#0b0d12), transparent 60%), #0b0d12; }
.stk-live .lv-plive { position:absolute; top:14px; left:14px; z-index:2; display:inline-flex; align-items:center; gap:7px; padding:6px 10px; border-radius:calc(8px * var(--r-scale, 1)); background:var(--live); color:#fff; font-size:11.5px; font-weight:800; letter-spacing:0.04em; pointer-events:none; }
.stk-live .lv-plive i { width:7px; height:7px; border-radius:50%; background:#fff; animation:lvPulse 1.6s infinite; }
/* 메타 */
.stk-live .lv-meta { margin-top:18px; }
.stk-live .lv-kicker { font-size:12px; font-weight:750; color:var(--key); letter-spacing:0.01em; display:inline-flex; align-items:center; gap:7px; }
.stk-live .lv-kicker .d { width:7px; height:7px; border-radius:50%; background:var(--key); animation:lvPulse 1.9s infinite; }
.stk-live .lv-title { font-size:clamp(23px,3.1vw,34px); font-weight:820; letter-spacing:-0.03em; line-height:1.14; margin:12px 0 0; word-break:keep-all; color:var(--text); }
.stk-live .lv-desc { margin:14px 0 0; color:var(--muted); font-size:15px; line-height:1.65; max-width:62ch; word-break:keep-all; white-space:pre-wrap; }
.stk-live .lv-hosts { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
.stk-live .lv-host { display:inline-flex; align-items:center; gap:10px; padding:6px 14px 6px 6px; border-radius:999px; border:1px solid var(--line); background:var(--card); font-size:13px; font-weight:650; color:var(--text); }
.stk-live .lv-host .av { width:27px; height:27px; border-radius:50%; overflow:hidden; display:grid; place-items:center; font-size:12px; font-weight:800; background:var(--key-dim); color:var(--key); }
.stk-live .lv-host .av img { width:100%; height:100%; object-fit:cover; object-position:top center; }
.stk-live .lv-host small { color:var(--sub); font-weight:500; }
/* 독 (높이는 JS 로 플레이어와 동기화) */
.stk-live .lv-dock { min-height:0; }
.stk-live .lv-card { border-radius:var(--radius); background:var(--card); overflow:hidden; display:flex; flex-direction:column; min-height:0; height:100%; box-shadow:var(--card-shadow); }
.stk-live .lv-docktitle { padding:14px 16px 0; font-size:13px; font-weight:750; color:var(--muted); flex:0 0 auto; }
.stk-live .lv-tabs { display:grid; gap:4px; padding:5px; position:relative; margin-top:10px; border-bottom:1px solid var(--line); flex:0 0 auto; }
.stk-live .lv-tab { position:relative; z-index:1; padding:9px 0; border:0; background:none; cursor:pointer; border-radius:calc(10px * var(--r-scale, 1)); font:inherit; font-size:13px; font-weight:700; color:var(--muted); transition:color .15s ease; }
.stk-live .lv-tab[aria-selected="true"] { color:var(--text); }
.stk-live .lv-tab .cnt { color:var(--sub); font-weight:600; font-size:11px; margin-left:3px; }
.stk-live .lv-ind { position:absolute; top:5px; bottom:5px; border-radius:calc(10px * var(--r-scale, 1)); background:color-mix(in srgb, var(--text) 9%, var(--card)); box-shadow:var(--btn-shadow); z-index:0; }
.stk-live .lv-panel { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; padding:14px; }
/* Q&A */
.stk-live .lv-ask { display:flex; gap:8px; margin-bottom:12px; flex:0 0 auto; }
.stk-live .lv-ask input { flex:1; min-width:0; height:40px; padding:0 13px; border-radius:calc(11px * var(--r-scale, 1)); border:1px solid var(--line); background:var(--card-2); color:var(--text); font:inherit; font-size:14px; outline:none; transition:border-color .15s ease; }
.stk-live .lv-ask input:focus { border-color:var(--key); }
.stk-live .lv-ask input:disabled, .stk-live .lv-chatbar input:disabled { opacity:0.55; cursor:not-allowed; }
.stk-live .lv-ask button { flex-shrink:0; width:44px; border-radius:calc(11px * var(--r-scale, 1)); border:0; background:var(--key); color:var(--on-key); cursor:pointer; display:grid; place-items:center; box-shadow:var(--btn-shadow-key); }
.stk-live .lv-ask button:disabled { opacity:0.4; cursor:not-allowed; }
.stk-live .lv-ask button svg { width:17px; height:17px; }
.stk-live .lv-chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; flex:0 0 auto; }
.stk-live .lv-chip { font-size:12px; padding:5px 11px; border-radius:calc(8px * var(--r-scale, 1)); background:var(--card); color:var(--muted); cursor:pointer; box-shadow:var(--btn-shadow); transition:box-shadow .15s ease, color .15s ease; }
.stk-live .lv-chip.on { background:var(--key); color:var(--on-key); box-shadow:var(--btn-shadow-key); }
.stk-live .lv-hint { font-size:12px; margin-top:2px; }
.stk-live .lv-list { display:flex; flex-direction:column; gap:8px; flex:1 1 auto; min-height:0; overflow-y:auto; }
.stk-live .lv-q { display:flex; gap:11px; padding:12px; border:1px solid var(--line); border-radius:calc(13px * var(--r-scale, 1)); background:var(--card-2); }
.stk-live .lv-q > div { flex:1; min-width:0; }
.stk-live .lv-vote { display:flex; flex-direction:column; align-items:center; gap:1px; flex-shrink:0; align-self:flex-start; min-width:42px; padding:6px 0; border-radius:calc(10px * var(--r-scale, 1)); background:var(--card); color:var(--muted); cursor:pointer; font:inherit; box-shadow:var(--btn-shadow); transition:box-shadow .14s ease, color .14s ease, background .14s ease; }
.stk-live .lv-vote span { font-size:10px; line-height:1; }
.stk-live .lv-vote b { font-size:13px; font-variant-numeric:tabular-nums; }
.stk-live .lv-vote:hover:not(:disabled) { box-shadow:var(--btn-shadow-hover); color:var(--text); }
.stk-live .lv-vote.on { background:var(--key-dim); color:var(--key); box-shadow:var(--btn-shadow-key); }
.stk-live .lv-vote:disabled { cursor:default; }
.stk-live .lv-q p { margin:0; font-size:14px; line-height:1.5; word-break:keep-all; color:var(--text); }
.stk-live .lv-q .m { display:flex; align-items:center; gap:8px; margin-top:6px; font-size:12px; color:var(--sub); }
.stk-live .lv-ans { color:#2f9e63; font-weight:700; font-size:11px; padding:2px 7px; border-radius:calc(6px * var(--r-scale, 1)); background:color-mix(in srgb,#2f9e63 14%,transparent); }
.stk-live .lv-empty { flex:1 1 auto; display:flex; align-items:center; justify-content:center; text-align:center; color:var(--sub); font-size:13px; line-height:1.6; padding:20px; word-break:keep-all; }
/* 채팅 */
.stk-live .lv-soon { flex:1 1 auto; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; text-align:center; color:var(--sub); font-size:13px; padding:20px; word-break:keep-all; }
.stk-live .lv-soon b { color:var(--muted); font-size:14px; font-weight:750; }
.stk-live .lv-feed { display:flex; flex-direction:column; gap:9px; flex:1 1 auto; min-height:0; overflow-y:auto; }
.stk-live .lv-msg { font-size:13.5px; line-height:1.45; word-break:keep-all; }
.stk-live .lv-msg .who { font-weight:700; margin-right:6px; color:var(--key); }
.stk-live .lv-msg .txt { color:var(--text); }
.stk-live .lv-msg.host .who { color:#e5484d; }
.stk-live .lv-msg.host .tag { font-size:10px; font-weight:700; color:#e5484d; border:1px solid color-mix(in srgb,#e5484d 40%,transparent); border-radius:calc(5px * var(--r-scale, 1)); padding:1px 5px; margin-right:6px; }
.stk-live .lv-chatbar { display:flex; gap:8px; margin-top:12px; flex:0 0 auto; }
.stk-live .lv-chatbar input { flex:1; min-width:0; height:38px; padding:0 13px; border-radius:calc(11px * var(--r-scale, 1)); border:1px solid var(--line); background:var(--card-2); color:var(--text); font:inherit; font-size:14px; outline:none; transition:border-color .15s ease; }
.stk-live .lv-chatbar input:focus { border-color:var(--key); }
.stk-live .lv-chatbar button { flex-shrink:0; width:40px; border-radius:calc(11px * var(--r-scale, 1)); border:0; background:var(--key); color:var(--on-key); cursor:pointer; display:grid; place-items:center; box-shadow:var(--btn-shadow-key); }
.stk-live .lv-chatbar button:disabled { opacity:0.4; cursor:not-allowed; }
.stk-live .lv-chatbar button svg { width:17px; height:17px; }
/* 세션(아젠다) */
.stk-live .lv-agscroll { flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:8px; }
.stk-live .lv-ses { display:flex; gap:12px; padding:13px; border-radius:calc(13px * var(--r-scale, 1)); border:1px solid var(--line); background:var(--card-2); }
.stk-live .lv-ses.now { border-color:var(--key-border); background:var(--key-dim); }
.stk-live .lv-ses.done { opacity:0.5; }
.stk-live .lv-ses .tc { font-size:12px; color:var(--sub); padding-top:2px; white-space:nowrap; }
.stk-live .lv-ses.now .tc { color:var(--key); font-weight:650; }
.stk-live .lv-ses h4 { margin:0; font-size:14px; font-weight:700; letter-spacing:-0.01em; word-break:keep-all; color:var(--text); }
.stk-live .lv-setype { margin-left:6px; font-size:10px; font-weight:700; padding:1px 6px; border-radius:calc(6px * var(--r-scale, 1)); background:var(--key-dim); color:var(--key); vertical-align:middle; white-space:nowrap; }
/* 휴식은 콘텐츠가 아니라 빈 시간이다 — 오프닝·Q&A·클로징과 같은 키컬러 강조를 주면 안 된다
   (어드민은 이미 휴식=회색으로 구분하고 있어 화면 간에 어긋나 있었다). */
.stk-live .lv-setype.muted { background:color-mix(in srgb,var(--text) 8%,transparent); color:var(--sub); }
.stk-live .lv-sewho { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:6px; }
/* 연사 이름 — 12px 은 로고 옆에서 위계가 뒤집힌다(로고가 이름보다 먼저 읽힘). */
.stk-live .lv-ses small { color:var(--muted); font-size:13.5px; font-weight:600; }
/* "이름 | 소속·직책" — 대기 화면·랜딩과 같은 위계(이름이 더 진하고 구분자는 흐리다). */
.stk-live .lv-sewho .who { display:flex; align-items:baseline; flex-wrap:wrap; gap:0 6px; }
.stk-live .lv-sewho .who b { color:var(--text); font-weight:750; }
.stk-live .lv-sewho .who .sep { opacity:.38; font-weight:400; }
.stk-live .lv-ses .st { margin-left:auto; align-self:center; font-size:11px; font-weight:700; color:var(--sub); white-space:nowrap; }
.stk-live .lv-ses.now .st { color:var(--key); display:inline-flex; align-items:center; gap:5px; }
.stk-live .lv-ses.now .st .d { width:6px; height:6px; border-radius:50%; background:var(--key); animation:lvPulse 1.9s infinite; }
.stk-live .lv-prog { height:4px; border-radius:calc(3px * var(--r-scale, 1)); background:var(--line); margin-top:9px; overflow:hidden; }
.stk-live .lv-prog span { display:block; height:100%; background:var(--key); }
/* 하단 카드 (CTA / 알림) */
.stk-live .lv-foot { margin-top:16px; display:grid; gap:16px; }
.stk-live .lv-fc { border-radius:var(--radius); background:var(--card); padding:18px; box-shadow:var(--card-shadow); }
.stk-live .lv-fk { font-size:11.5px; font-weight:700; color:var(--sub); letter-spacing:0.01em; }
.stk-live .lv-fc h3 { margin:8px 0 4px; font-size:17px; font-weight:800; letter-spacing:-0.02em; color:var(--text); }
.stk-live .lv-fc p { margin:0 0 14px; color:var(--muted); font-size:13.5px; line-height:1.6; word-break:keep-all; white-space:pre-wrap; }
.stk-live .lv-fbenefits { list-style:none; margin:0 0 14px; padding:0; display:flex; flex-direction:column; gap:6px; }
.stk-live .lv-fbenefits li { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--muted); }
.stk-live .lv-fbenefits li::before { content:''; flex-shrink:0; width:5px; height:5px; border-radius:50%; background:var(--key); }
.stk-live .lv-fbtns { display:flex; flex-direction:column; gap:8px; }
.stk-live .lv-fbtn { display:flex; align-items:center; justify-content:center; height:40px; border-radius:calc(11px * var(--r-scale, 1)); font-size:14px; font-weight:750; text-decoration:none !important; cursor:pointer; transition:transform .16s ease, opacity .16s ease, box-shadow .16s ease; }
.stk-live .lv-fbtn:hover { transform:translateY(-1px); opacity:0.94; }
.stk-live .lv-fbtn.primary { background:var(--key); color:var(--on-key) !important; box-shadow:var(--btn-shadow-key); }
.stk-live .lv-fbtn.ghost { background:var(--card); color:var(--text) !important; box-shadow:var(--btn-shadow); }
.stk-live .lv-switchrow { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.stk-live .lv-swlabel { font-size:14px; font-weight:650; color:var(--text); }
.stk-live .lv-switch { flex-shrink:0; width:46px; height:27px; padding:0; border-radius:999px; cursor:pointer; position:relative; border:1px solid var(--line-md); background:var(--card-2); transition:background .2s ease, border-color .2s ease; }
.stk-live .lv-switch .knob { position:absolute; top:2px; left:2px; width:21px; height:21px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,0.3); transition:transform .22s cubic-bezier(.2,.8,.2,1); }
.stk-live .lv-switch[aria-checked="true"] { background:var(--key); border-color:transparent; }
.stk-live .lv-switch[aria-checked="true"] .knob { transform:translateX(19px); }
/* 안내 문구도 어드민이 직접 쓰는 여러 줄 텍스트다 — 편집기 textarea 는 줄바꿈을 받는데
   여기서 한 줄로 흘리면 입력한 모양과 다르게 나간다. */
.stk-live .lv-notice { margin-top:16px; padding:14px 18px; border:1px solid var(--key-border); border-radius:var(--radius-sm); background:var(--key-dim); color:var(--muted); font-size:12.5px; line-height:1.7; word-break:keep-all; white-space:pre-line; }
/* CTA 모달 — 폼(자체 설문)·URL 임베드 공용 */
.stk-live .lv-ctamodal-backdrop { position:fixed; inset:0; z-index:70; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(8,8,12,0.62); backdrop-filter:blur(4px); animation:lvFade .18s ease; }
@keyframes lvFade { from { opacity:0; } }
.stk-live .lv-ctamodal { position:relative; width:min(560px,100%); max-height:min(86vh,760px); overflow-y:auto; overscroll-behavior:contain; background:var(--card); color:var(--text); border-radius:var(--radius); box-shadow:0 30px 80px -20px rgba(0,0,0,.55); padding:28px 24px 26px; animation:lvPop .22s cubic-bezier(.2,.9,.3,1.2); }
@keyframes lvPop { from { opacity:0; transform:translateY(14px) scale(.97); } }
.stk-live .lv-ctamodal.frame { padding:0; overflow:hidden; width:min(720px,100%); height:min(86vh,760px); display:flex; flex-direction:column; }
.stk-live .lv-ctamodal-hd { display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid var(--line); flex-shrink:0; }
.stk-live .lv-ctamodal-hd .t { flex:1; min-width:0; font-size:14px; font-weight:750; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stk-live .lv-ctamodal-ext { font-size:12px; color:var(--key); font-weight:650; white-space:nowrap; text-decoration:none; }
.stk-live .lv-ctamodal-ext:hover { text-decoration:underline; }
.stk-live .lv-ctamodal-iframe { flex:1; width:100%; border:0; background:#fff; }
.stk-live .lv-ctamodal-x { width:30px; height:30px; border:0; border-radius:calc(8px * var(--r-scale, 1)); background:color-mix(in srgb,var(--text) 7%,transparent); color:var(--muted); font-size:13px; cursor:pointer; flex-shrink:0; transition:background .15s ease; }
.stk-live .lv-ctamodal-x:hover { background:color-mix(in srgb,var(--text) 13%,transparent); }
.stk-live .lv-ctamodal-x.abs { position:absolute; top:14px; right:14px; z-index:1; }
.stk-live .lv-ctamodal-title { font-size:19px; font-weight:820; letter-spacing:-.02em; margin:0 28px 6px 0; word-break:keep-all; }
.stk-live .lv-ctamodal-desc { font-size:13px; line-height:1.65; color:var(--muted); margin:0 0 18px; white-space:pre-wrap; word-break:keep-all; }
.stk-live .lv-ctamodal-center { text-align:center; font-size:13.5px; line-height:1.7; color:var(--muted); padding:44px 8px; margin:0; }
.stk-live .lv-ctamodal-center.done { padding:36px 8px; }
.stk-live .lv-ctamodal-center.done .ok { display:inline-grid; place-items:center; width:52px; height:52px; border-radius:50%; background:color-mix(in srgb,#12B76A 14%,transparent); color:#12B76A; font-size:24px; font-weight:800; margin-bottom:12px; }
.stk-live .lv-ctamodal-center.done .big { font-size:17px; font-weight:800; color:var(--text); margin:0 0 6px; }
.stk-live .lv-ctamodal-center.done p { margin:0; }
@media (max-width:560px) { .stk-live .lv-ctamodal { padding:22px 16px 20px; } .stk-live .lv-ctamodal-backdrop { padding:12px; } }
@media (max-width:940px) {
  .stk-live .lv-card { height:auto !important; }
  .stk-live .lv-list, .stk-live .lv-feed, .stk-live .lv-agscroll { max-height:60vh; }
}
@media (max-width:720px) {
  .stk-live .lv-wrap { padding:8px 14px 40px; }
  .stk-live .lv-foot.two { grid-template-columns:1fr !important; }
  /* 모바일 시청자 조작 컨트롤은 터치타깃 ≥44px (데스크톱 밀도는 유지) */
  .stk-live .lv-tab { padding:13px 0; }
  .stk-live .lv-ask input, .stk-live .lv-chatbar input { height:44px; }
  .stk-live .lv-ask button, .stk-live .lv-chatbar button { width:44px; }
  .stk-live .lv-chip { padding:9px 13px; }
  .stk-live .lv-vote { min-width:44px; padding:9px 0; }
  .stk-live .lv-share { height:44px; }
}
@media (prefers-reduced-motion: reduce) {
  .stk-live .lv-livepill i, .stk-live .lv-plive i, .stk-live .lv-kicker .d, .stk-live .lv-ses.now .st .d { animation:none !important; }
}
`;

function hhmmToMs(dayStr: string, hhmm: string): number {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm ?? "")) return NaN;
  return new Date(`${dayStr}T${hhmm.padStart(5, "0")}:00+09:00`).getTime();
}

export default function LiveContentStk({
  webinar,
  accent,
  text,
  surface,
  youtubeId: youtubeIdProp,
  serverNowMs,
  chatEnabled = false,
  isLive = true,
  viewerCount,
  qa,
  chat,
  onTabChange,
  notifyState,
  slug,
  registrationId,
  onReauth,
  onShare,
  shareCopied,
  borderRadius,
}: {
  webinar: WebinarForLive;
  accent: string;
  text?: string;
  surface?: string;
  /** 테마의 테두리 둥글기 — 없으면 디자인 기본값 */
  borderRadius?: string;
  youtubeId?: string | null;
  serverNowMs?: number;
  chatEnabled?: boolean;
  isLive?: boolean;
  viewerCount?: number | null;
  qa: QAProps;
  chat?: ChatProps;
  onTabChange?: (tab: string) => void;
  notifyState?: { subscribed: boolean; onToggle: () => void; error?: string; pending?: boolean };
  /** CTA 폼 모달·새 창 열기에 필요 — 없으면 폼형 CTA 버튼은 동작하지 않는다(목업 하니스 등) */
  slug?: string;
  /** 폼 응답을 등록자와 연결 (없으면 익명 응답) */
  registrationId?: string | null;
  /**
   * 저장된 등록건이 삭제돼 무효가 됐을 때의 탈출구 — localStorage 를 지우고 EntryVerify 로
   * 되돌린다. 없으면(미리보기 하니스 등) 버튼 자체를 그리지 않는다.
   */
  onReauth?: () => void;
  /* 공유는 부모(live/page.tsx)가 처리한다 — 추천 코드(`?ref=`)와 공유 기록은 등록자 컨텍스트를
     아는 쪽에만 있다. 예전엔 이 컴포넌트가 자체 handleShare 로 맨 URL 을 복사해, 시청 화면에서
     나간 공유는 추적에서 통째로 빠졌다. */
  onShare?: () => void;
  shareCopied?: boolean;
}) {
  const css = useMemo(
    () => buildStkCss(accent || "#FE5816", text || "#f0f0f2", surface || "#121216", borderRadius) + WATCH_CSS + SURVEY_FORM_CSS,
    [accent, text, surface, borderRadius],
  );

  const config = (webinar.config ?? {}) as Record<string, unknown>;
  // 기존에 공유 링크가 저장된 웨비나도 즉시 재생되도록, 렌더 직전에 embed용 ID로 정규화한다.
  const youtubeId = getYouTubeVideoId(youtubeIdProp || (typeof config.youtubeId === "string" ? config.youtubeId : ""));
  const live = (config.livePage ?? {}) as LivePageConfig;
  // CTA 카드 여러 장 — 신규 ctas[] 우선, 없으면 레거시 단일 cta. 내용 있는 카드만.
  const ctaList: CtaCard[] = (Array.isArray(live.ctas) ? live.ctas : live.cta ? [live.cta] : [])
    .filter((c) => !!c && (!!c.title || (Array.isArray(c.buttons) && c.buttons.length > 0)));
  const notify = live.notify;
  const hasNotify = !!notify?.enabled;
  const footCount = ctaList.length + (hasNotify ? 1 : 0);

  // CTA 버튼 열기 방식 — 폼(자체 설문) 모달/새 창, URL 모달(iframe)/새 창
  const [ctaFormModal, setCtaFormModal] = useState<string | null>(null); // surveyId
  const [ctaFrameModal, setCtaFrameModal] = useState<{ url: string; title: string } | null>(null);
  const ctaNeedsButton = (btn: CtaButton) => (btn.action === "form" && !!btn.surveyId) || (!!btn.url && btn.open === "modal");
  const onCtaButton = (btn: CtaButton) => {
    if (btn.action === "form" && btn.surveyId) {
      if (btn.open === "newTab") {
        if (slug) window.open(`/webinar/${slug}/survey/${btn.surveyId}`, "_blank", "noopener,noreferrer");
        return;
      }
      if (slug) setCtaFormModal(btn.surveyId);
      return;
    }
    if (btn.url && btn.open === "modal") setCtaFrameModal({ url: btn.url, title: btn.label });
  };
  // 폐쇄형이면 목록은 없는 것으로 취급한다(서버도 안 내려주지만, 모드 전환 직후 잔여 상태 방어).
  const qaClosed = qa.mode === "closed";
  const answered = qaClosed ? [] : (qa.answered ?? []);

  // 세션 상태 계산용 시계 — 클라이언트 전용 렌더라 Date.now() 초기화 안전. 30초 틱.
  const [now, setNow] = useState<number>(() => serverNowMs ?? Date.now());
  useEffect(() => {
    const base = serverNowMs ?? Date.now();
    const t0 = Date.now();
    setNow(base);
    const id = setInterval(() => setNow(base + (Date.now() - t0)), 30_000);
    return () => clearInterval(id);
  }, [serverNowMs]);

  const dayStr = useMemo(() => kstDateString(webinar.liveStartAt), [webinar.liveStartAt]);
  const sessions = useMemo(() => {
    const DAY_MS = 86_400_000;
    // KST 자정을 넘기는 웨비나(예: 23:30 → 00:30) 대응: 세션을 순서대로 훑으며
    // 시작 시각이 직전 세션보다 앞서면 날짜가 넘어간 것으로 보고 dayOffset을 누적한다.
    let dayOffset = 0;
    let prevRawStartMs = -Infinity;
    const list = webinar.sessions.map((s) => {
      const rawStartMs = hhmmToMs(dayStr, s.startTime);
      const rawEndMs = hhmmToMs(dayStr, s.endTime);
      const valid = !Number.isNaN(rawStartMs) && !Number.isNaN(rawEndMs);
      let startMs = rawStartMs;
      let endMs = rawEndMs;
      if (valid) {
        if (rawStartMs < prevRawStartMs) dayOffset += 1;
        prevRawStartMs = rawStartMs;
        startMs = rawStartMs + DAY_MS * dayOffset;
        endMs = rawEndMs + DAY_MS * dayOffset;
        // 세션 내부에서 종료가 시작보다 이르면(자정 통과) 종료를 다음 날로 넘긴다
        if (endMs < startMs) endMs += DAY_MS;
      }
      let status: "done" | "now" | "upcoming" | "none" = "none";
      if (valid) status = now >= endMs ? "done" : now >= startMs ? "now" : "upcoming";
      return { ...s, startMs, endMs, valid, status };
    });
    return list;
  }, [webinar.sessions, dayStr, now]);

  const activeSession = sessions.find((s) => s.status === "now") ?? null;
  const nextSession = sessions.find((s) => s.status === "upcoming") ?? null;
  // 지금/다음 세션이 있을 때만 focus — 모든 세션 종료 후엔 끝난 세션을 "다음"으로 잘못 표기하지 않는다
  const focus = activeSession ?? nextSession ?? null;

  // 표시 순번·개수는 실제 세션만 센다. 예전엔 `focus.number}/${sessions.length}` 여서
  // 중간에 휴식이 끼면 세 번째 세션이 "4/6" 으로 보였다(분자·분모 둘 다 틀림).
  const numbering = useMemo(() => buildSessionNumbering(webinar.sessions), [webinar.sessions]);
  // 유형 라벨 그대로(모르는 값이면 "세션"). 예전엔 삼항 체인이라 새 유형이 "세션"으로 표시되는데
  // displayNumber 는 null 이어서 아래 `· n/N` 이 빠진 "번호 없는 세션" 이라는 모순이 나왔다.
  const metaKind = sessionTypeLabel(focus?.type) ?? "세션";
  const focusDisplayNo = focus ? numbering.displayNumber(focus.number) : null;
  const metaKicker = focus
    ? // 휴식·Q&A 는 번호가 없다 → "지금 휴식" 처럼 종류만 알려준다
      `${activeSession ? "지금" : "다음"} ${metaKind}${focusDisplayNo !== null ? ` · ${focusDisplayNo}/${numbering.realCount}` : ""}`
    : null;
  const metaTitle = focus?.title || webinar.name;
  const metaDesc = focus?.description || webinar.description;
  // 연사 없는 유형(휴식)은 비운다. 레거시 행은 speaker 에 문자열 "null" 이 들어 있을 수 있다.
  // 판정은 유형 표 하나로 — 예전엔 여기가 `!== "break"`(부정형)이고 랜딩은 `=== "session"`
  // (긍정형)이라, Q&A 의 "전체 연사" 가 라이브에는 보이고 랜딩에서는 사라졌다.
  const focusSpeaker = focus && sessionHasSpeaker(focus.type) ? cleanSessionText(focus.speaker) : "";

  // 탭 구성 — 채팅은 chatEnabled 일 때만 노출(오프하면 탭 자체가 사라짐)
  const tabs = useMemo(
    () => [
      { key: "qa", label: "Q&A", count: answered.length || undefined },
      ...(chatEnabled ? [{ key: "chat", label: "채팅", count: undefined as number | undefined }] : []),
      { key: "agenda", label: "세션", count: undefined as number | undefined },
    ],
    [chatEnabled, answered.length],
  );
  const [tab, setTab] = useState<string>("qa");
  // 채팅이 꺼지면 채팅 탭에 머물지 않게 방어
  useEffect(() => {
    if (!tabs.some((t) => t.key === tab)) setTab("qa");
  }, [tabs, tab]);
  // 컨테이너가 활성 탭을 알도록 통지 — 채팅 폴링을 탭 활성 시에만 돌리기 위함
  useEffect(() => { onTabChange?.(tab); }, [tab, onTabChange]);

  // 독 높이 = 플레이어 높이(데스크톱). 탭 전환 시 높이가 흔들리지 않도록 고정.
  const playerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const p = playerRef.current;
    const c = cardRef.current;
    if (!p || !c) return;
    const sync = () => {
      if (window.matchMedia("(min-width:941px)").matches) {
        c.style.height = `${Math.round(p.getBoundingClientRect().height)}px`;
      } else {
        c.style.height = "";
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(p);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  // 채팅 탭 진입 시엔 항상 최신(하단)으로
  useEffect(() => {
    if (tab !== "chat") return;
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tab]);
  // 새 메시지 — 이미 하단 근처(≤120px)일 때만 따라감. 위로 스크롤해 과거를 읽는 중이면 방해하지 않음.
  useEffect(() => {
    if (tab !== "chat") return;
    const el = feedRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [tab, chat?.messages]);


  const [notifyOnLocal, setNotifyOnLocal] = useState(false);
  const notifyLabel = notify?.switchLabel?.trim() || "세션 시작 알림 받기";
  const notifyOn = notifyState ? notifyState.subscribed : notifyOnLocal;
  const toggleNotify = notifyState ? notifyState.onToggle : () => setNotifyOnLocal((v) => !v);

  /* 입장오픈 창(라이브 시작 전, entryOpenBeforeMinutes 이내)엔 등록자가 이미 들어와 있지만
     서버는 라이브 중에만 질문/채팅을 받는다(400). 입력을 활성으로 그려두면 눌러도 거절만
     당하므로 isLive 를 게이트로 써서 입력을 막고 이유를 인라인으로 알린다. 탭·기존 목록은
     그대로 둔다 — 공지·이미 달린 답변은 지금도 볼 값이 있다. */
  const canSend = !!qa.question.trim() && !qa.isSending && isLive;

  return (
    <section className="stk-live lv-live">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="lv-wrap">
        {/* 상단바 */}
        <div className="lv-top">
          {isLive
            ? <span className="lv-livepill"><i />LIVE</span>
            : <span className="lv-soonpill">곧 시작</span>}
          {isLive && typeof viewerCount === "number" && viewerCount > 0 && (
            <span className="lv-viewers">👁 {viewerCount.toLocaleString()}명</span>
          )}
          <span className="lv-evname">{webinar.name}</span>
          <span className="lv-sp" />
          {onReauth && (
            <button type="button" className="lv-reauth" onClick={onReauth}>
              다른 정보로 다시 확인
            </button>
          )}
          {onShare && (
            <motion.button whileTap={{ scale: 0.96 }} transition={spring} className="lv-share" onClick={onShare}>
              <Share2 />{shareCopied ? "복사됨" : "공유"}
            </motion.button>
          )}
        </div>

        {/* 스테이지: 플레이어 + 메타 + 참여 독 */}
        <div className="lv-stage">
          <div className="lv-player" ref={playerRef}>
            {isLive && <span className="lv-plive"><i />LIVE</span>}
            {youtubeId ? (
              <iframe
                src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=0&rel=0&modestbranding=1&playsinline=1`}
                title="Live"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <div className="lv-poster">라이브 영상이 연결되지 않았어요</div>
            )}
          </div>

          <div className="lv-meta">
            {metaKicker && <span className="lv-kicker"><span className="d" />{metaKicker}</span>}
            <h1 className="lv-title">{metaTitle}</h1>
            {metaDesc && <p className="lv-desc">{metaDesc}</p>}
            {focusSpeaker && (
              <div className="lv-hosts">
                <span className="lv-host">
                  <span className="av">
                    {focus?.speakerPhotoUrl ? <img src={transformedImageUrl(focus.speakerPhotoUrl, IMAGE_PRESETS.modalAvatar)} alt={focusSpeaker} /> : focusSpeaker.charAt(0)}
                  </span>
                  {focusSpeaker}
                </span>
              </div>
            )}
          </div>

          <aside className="lv-dock">
            <div className="lv-card" ref={cardRef}>
              <div className="lv-docktitle">실시간 참여</div>
              <div className="lv-tabs" role="tablist" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    id={`lv-tab-${t.key}`}
                    aria-selected={tab === t.key}
                    aria-controls={`lv-panel-${t.key}`}
                    className="lv-tab"
                    onClick={() => setTab(t.key)}
                  >
                    {tab === t.key && (
                      <motion.span layoutId="lv-dock-ind" className="lv-ind" transition={spring} style={{ left: 0, right: 0 }} />
                    )}
                    <span style={{ position: "relative", zIndex: 1 }}>
                      {t.label}
                      {t.count != null && <span className="cnt">{t.count}</span>}
                    </span>
                  </button>
                ))}
              </div>

              {/* Q&A */}
              {tab === "qa" && (
                <div className="lv-panel" role="tabpanel" id="lv-panel-qa" aria-labelledby="lv-tab-qa">
                  {(() => {
                    // 질문 대상 칩은 "세션" 유형만 (Q&A·브레이크 제외).
                    // 라벨은 표시 순번 — 예전엔 원본 number 라 휴식이 끼면 "세션 1, 3, 5" 처럼 건너뛰었다.
                    // 저장·비교는 그대로 s.number (WebinarQA.sessionNumber 참조를 깨지 않으려고).
                    const chipSessions = qa.sessions.filter(isRealSession);
                    return chipSessions.length > 1 ? (
                      <div className="lv-chips">
                        {chipSessions.map((s) => (
                          <motion.button
                            key={s.number}
                            type="button"
                            whileTap={{ scale: 0.96 }}
                            transition={spring}
                            className={`lv-chip ${qa.selectedSession === s.number ? "on" : ""}`}
                            onClick={() => qa.setSelectedSession(qa.selectedSession === s.number ? null : s.number)}
                          >
                            세션 {numbering.displayNumber(s.number) ?? s.number}
                          </motion.button>
                        ))}
                      </div>
                    ) : null;
                  })()}
                  <div className="lv-ask">
                    <input
                      value={qa.question}
                      onChange={(e) => qa.setQuestion(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && canSend) qa.onSend(); }}
                      placeholder={isLive ? "궁금한 걸 질문해보세요" : "방송이 시작되면 질문할 수 있어요"}
                      aria-label="질문 입력"
                      disabled={!isLive}
                    />
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      transition={spring}
                      onClick={qa.onSend}
                      disabled={!canSend}
                      aria-label="질문 전송"
                      style={qa.sent ? { background: "#2f9e63" } : undefined}
                    >
                      {qa.sent ? <CheckCircle2 /> : <Send />}
                    </motion.button>
                  </div>
                  <div aria-live="polite">
                    {!isLive && <p className="lv-hint" style={{ color: "var(--sub)" }}>방송이 시작되면 질문을 받아요. 지금은 공지·기존 질문만 볼 수 있어요.</p>}
                    {qa.sent && <p className="lv-hint" style={{ color: "#2f9e63" }}>질문이 전달됐어요!</p>}
                    {qa.error && <p className="lv-hint" role="alert" style={{ color: "#f87171" }}>{qa.error}</p>}
                  </div>
                  {qaClosed ? (
                    /* 폐쇄형 — 목록·추천 없이 "질문하기"만. 왜 목록이 없는지 한 줄로 알려준다
                       (그냥 비어 있으면 고장으로 읽힌다). */
                    <div className="lv-empty">
                      남긴 질문은 주최자에게만 전달돼요.<br />다른 참여자에게는 보이지 않아요.
                    </div>
                  ) : answered.length > 0 ? (
                    <div className="lv-list" tabIndex={0} aria-label="질문 목록">
                      {answered.map((q) => {
                        const voted = qa.votedIds?.includes(q.id);
                        return (
                          <div className="lv-q" key={q.id}>
                            <button
                              type="button"
                              className={`lv-vote ${voted ? "on" : ""}`}
                              onClick={() => qa.onVote?.(q.id)}
                              disabled={voted || !qa.onVote}
                              aria-pressed={voted}
                              aria-label="이 질문 추천"
                            >
                              <span aria-hidden>▲</span>
                              <b>{q.voteCount ?? 0}</b>
                            </button>
                            <div>
                              <p>{q.question}</p>
                              <div className="m">
                                {q.name && <span>{q.name}</span>}
                                {/* 저장값은 원본 number → 칩 라벨과 같은 표시 순번으로 변환해 보여준다.
                                    변환이 안 되면(오프닝·휴식·클로징을 가리키거나 그 행이 삭제됨)
                                    **원본으로 폴백하지 않고** 배지를 안 그린다 — 폴백하면 세션이 아닌
                                    행의 진행 순서가 "세션 5" 로 새어 나간다(resolveSessionRef 주석). */}
                                {resolveSessionRef(numbering, q.sessionNumber) != null && (
                                  <span>· 세션 {resolveSessionRef(numbering, q.sessionNumber)}</span>
                                )}
                                {q.status === "answered" && <span className="lv-ans">답변 완료</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="lv-empty">아직 질문이 없어요.<br />궁금한 점을 먼저 남겨보세요.</div>
                  )}
                </div>
              )}

              {/* 채팅 */}
              {tab === "chat" && (
                <div className="lv-panel" role="tabpanel" id="lv-panel-chat" aria-labelledby="lv-tab-chat">
                  {chat ? (
                    <>
                      {chat.messages.length > 0 ? (
                        <div className="lv-feed" ref={feedRef} tabIndex={0} aria-label="채팅 메시지">
                          {chat.messages.map((m) => (
                            <div className={`lv-msg${m.isHost ? " host" : ""}`} key={m.id}>
                              {m.isHost && <span className="tag">HOST</span>}
                              <span className="who">{m.name}</span>
                              <span className="txt">{m.message}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="lv-empty">아직 메시지가 없어요.<br />먼저 인사를 건네보세요.</div>
                      )}
                      <div className="lv-chatbar">
                        <input
                          value={chat.input}
                          onChange={(e) => chat.setInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && isLive && chat.input.trim() && !chat.isSending) chat.onSend(); }}
                          placeholder={isLive ? "메시지 보내기…" : "방송이 시작되면 채팅할 수 있어요"}
                          aria-label="채팅 입력"
                          disabled={!isLive}
                        />
                        <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={chat.onSend} disabled={!isLive || !chat.input.trim() || chat.isSending} aria-label="채팅 전송">
                          <Send />
                        </motion.button>
                      </div>
                      {!isLive && <p className="lv-hint" style={{ marginTop: 6, color: "var(--sub)" }}>방송이 시작되면 채팅을 받아요. 지금은 대화만 볼 수 있어요.</p>}
                      {chat.error && <p className="lv-hint" role="alert" style={{ color: "#f87171", marginTop: 6 }}>{chat.error}</p>}
                    </>
                  ) : (
                    <div className="lv-soon">
                      <b>실시간 채팅이 곧 열려요</b>
                      준비되면 이 탭에서 다른 참가자들과 대화할 수 있어요.
                    </div>
                  )}
                </div>
              )}

              {/* 세션(아젠다) */}
              {tab === "agenda" && (
                <div className="lv-panel" role="tabpanel" id="lv-panel-agenda" aria-labelledby="lv-tab-agenda">
                  {sessions.length > 0 ? (
                    <div className="lv-agscroll" tabIndex={0} aria-label="세션 순서">
                      {sessions.map((s) => {
                        const isNext = s.id === nextSession?.id && s.status === "upcoming";
                        const label = s.status === "done" ? "완료" : s.status === "now" ? "진행 중" : isNext ? "다음" : s.status === "upcoming" ? "예정" : "";
                        const pct = s.status === "now" && s.endMs > s.startMs
                          ? Math.min(100, Math.max(0, ((now - s.startMs) / (s.endMs - s.startMs)) * 100))
                          : 0;
                        return (
                          <div className={`lv-ses ${s.status}`} key={s.id}>
                            <span className="tc">{s.startTime}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <h4>
                                {s.title}
                                {!isRealSession(s) && sessionTypeLabel(s.type) && (
                                  <span className={`lv-setype${isPauseSession(s.type) ? " muted" : ""}`}>{sessionTypeLabel(s.type)}</span>
                                )}
                              </h4>
                              {/* 연사 이름 줄 오른쪽에 로고 — 대기 화면·랜딩 팝업과 같은 배치.
                                  연사 없는 유형은 이름을 안 그린다(cleanSessionText 는 레거시 "null"
                                  문자열도 걸러 준다 — 예전엔 휴식 행 밑에 회색 "null" 이 찍혔다). */}
                              {(() => {
                                /* 대기 화면·랜딩 타임테이블과 같은 표기 — "이름 | 소속·직책".
                                   같은 목록의 다른 상태라 표기가 갈라지면 바로 눈에 띈다.
                                   로고도 같은 이유로 그리지 않는다(대기 화면에서 뺐는데 여기 남기면
                                   방송이 시작되는 순간 마크가 다시 나타난다). 로고는 랜딩 타임테이블
                                   펼침과 연사 상세 팝업에서 본다. */
                                const sp = parseSpeaker(cleanSessionText(s.speaker), cleanSessionText(s.speakerCompany));
                                const hasWho = Boolean(sp.name || sp.company);
                                if (!(sessionHasSpeaker(s.type) && hasWho)) return null;
                                return (
                                  <div className="lv-sewho">
                                    <small className="who">
                                      {Boolean(sp.name) && <b>{sp.name}</b>}
                                      {Boolean(sp.name && sp.company) && <span className="sep" aria-hidden="true">|</span>}
                                      {Boolean(sp.company) && <span className="co">{sp.company}</span>}
                                    </small>
                                  </div>
                                );
                              })()}
                              {s.status === "now" && (
                                <div className="lv-prog"><span style={{ width: `${pct}%` }} /></div>
                              )}
                            </div>
                            {label && (
                              <span className="st">
                                {s.status === "now" && <span className="d" />}{label}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="lv-empty">등록된 세션 순서가 없어요.</div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* 하단 카드: CTA(여러 장) + 알림 */}
        {footCount > 0 && (
          <div className={`lv-foot ${footCount > 1 ? "two" : ""}`} style={{ gridTemplateColumns: footCount > 1 ? "repeat(2, minmax(0,1fr))" : "1fr" }}>
            {ctaList.map((c, i) => (
              <div className="lv-fc" key={`cta-${i}`}>
                {c.eyebrow && <div className="lv-fk">{c.eyebrow}</div>}
                {c.title && <h3>{c.title}</h3>}
                {c.description && <p>{c.description}</p>}
                {c.benefits && c.benefits.length > 0 && (
                  <ul className="lv-fbenefits">{c.benefits.map((b, j) => <li key={j}>{b}</li>)}</ul>
                )}
                {c.buttons && c.buttons.length > 0 && (
                  <div className="lv-fbtns">
                    {c.buttons.map((btn, j) =>
                      ctaNeedsButton(btn) ? (
                        <motion.button
                          key={j}
                          type="button"
                          whileTap={{ scale: 0.97 }}
                          transition={spring}
                          onClick={() => onCtaButton(btn)}
                          className={`lv-fbtn ${btn.style === "ghost" ? "ghost" : "primary"}`}
                        >
                          {btn.label}
                        </motion.button>
                      ) : (
                        <motion.a
                          key={j}
                          whileTap={{ scale: 0.97 }}
                          transition={spring}
                          href={btn.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`lv-fbtn ${btn.style === "ghost" ? "ghost" : "primary"}`}
                        >
                          {btn.label}
                        </motion.a>
                      ),
                    )}
                  </div>
                )}
              </div>
            ))}
            {hasNotify && (
              <div className="lv-fc">
                {(notify!.kicker || "다음 세션") && <div className="lv-fk">{notify!.kicker || "다음 세션"}</div>}
                <h3>{notify!.title || "알림 받고 이어보기"}</h3>
                <p>{notify!.description || "다음 세션이 시작되면 알려드리고, 다시보기도 이메일로 보내드려요."}</p>
                <div className="lv-switchrow">
                  <span className="lv-swlabel">{notifyOn ? "알림이 켜졌어요" : notifyLabel}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notifyOn}
                    aria-label={notifyLabel}
                    aria-busy={notifyState?.pending || undefined}
                    disabled={notifyState?.pending}
                    className="lv-switch"
                    onClick={toggleNotify}
                  >
                    <span className="knob" />
                  </button>
                </div>
                {notifyState?.error && <p className="lv-hint" role="alert" style={{ color: "#f87171", marginTop: 8 }}>{notifyState.error}</p>}
              </div>
            )}
          </div>
        )}

        {/* 안내 문구 */}
        <div className="lv-notice">{live.notice || DEFAULT_NOTICE}</div>
      </div>

      {/* CTA 폼 모달 — 자체 폼(WebinarSurvey)을 페이지 안에서 */}
      {ctaFormModal && slug && (
        <CtaFormModal
          key={ctaFormModal}
          slug={slug}
          surveyId={ctaFormModal}
          registrationId={registrationId ?? null}
          onClose={() => setCtaFormModal(null)}
        />
      )}
      {/* CTA URL 모달 — 외부 페이지 임베드 */}
      {ctaFrameModal && (
        <div className="lv-ctamodal-backdrop" onClick={() => setCtaFrameModal(null)}>
          <div className="lv-ctamodal frame" role="dialog" aria-modal="true" aria-label={ctaFrameModal.title} onClick={(e) => e.stopPropagation()}>
            <div className="lv-ctamodal-hd">
              <span className="t">{ctaFrameModal.title}</span>
              <a href={ctaFrameModal.url} target="_blank" rel="noopener noreferrer" className="lv-ctamodal-ext">새 창에서 열기</a>
              <button type="button" className="lv-ctamodal-x" aria-label="닫기" onClick={() => setCtaFrameModal(null)}>✕</button>
            </div>
            <iframe src={ctaFrameModal.url} title={ctaFrameModal.title} className="lv-ctamodal-iframe" />
          </div>
        </div>
      )}
    </section>
  );
}

/* ── CTA 폼 모달 — 문항은 공개 GET 으로 1회 로드, 임시저장은 독립 응답 페이지와 키 공유 ── */
function CtaFormModal({ slug, surveyId, registrationId, onClose }: {
  slug: string;
  surveyId: string;
  registrationId: string | null;
  onClose: () => void;
}) {
  // "before"(시작 예약 전)를 "closed" 와 나눈다 — 둘을 합치면 아직 열리지도 않은 폼이 이미 끝난 것처럼 보인다
  const [state, setState] = useState<"loading" | "form" | "closed" | "before" | "error" | "done">("loading");
  const [survey, setSurvey] = useState<{ title: string; description: string | null; questions: SurveyQuestion[]; opensAt?: string | null; doneTitle?: string | null; doneDescription?: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const draftKey = `mach_survey_draft_page_${surveyId}`; // 독립 페이지와 초안 공유 — 어느 쪽에서 열어도 이어쓴다

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/webinar/${slug}/survey/${surveyId}`);
        if (cancelled) return;
        if (!res.ok) { setState("error"); return; }
        const data = await res.json();
        setSurvey(data.survey);
        setState(data.survey?.isOpen ? "form" : data.survey?.state === "before" ? "before" : "closed");
      } catch { if (!cancelled) setState("error"); }
    })();
    return () => { cancelled = true; };
  }, [slug, surveyId]);

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");

  const handleSubmit = async (answers: SurveyAnswers) => {
    // 소유자 미리보기 — 응답을 저장하지 않고 완료 화면만 보여준다 (isPreviewUrl 가드)
    if (isPreview) { setState("done"); return; }
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(`/api/webinar/${slug}/survey/${surveyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, registrationId: registrationId ?? undefined, source: "live" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(data.error ?? "제출에 실패했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      clearSurveyDraft(draftKey);
      setState("done");
    } catch {
      setSubmitError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="lv-ctamodal-backdrop" onClick={onClose}>
      <div className="lv-ctamodal" role="dialog" aria-modal="true" aria-label={survey?.title ?? "폼"} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lv-ctamodal-x abs" aria-label="닫기" onClick={onClose}>✕</button>

        {state === "loading" && <p className="lv-ctamodal-center">불러오는 중…</p>}
        {state === "error" && <p className="lv-ctamodal-center">폼을 불러오지 못했어요.<br />잠시 후 다시 시도해주세요.</p>}
        {state === "closed" && <p className="lv-ctamodal-center">마감된 폼이에요.<br />소중한 관심 감사합니다.</p>}
        {state === "before" && (
          <p className="lv-ctamodal-center">
            아직 열리지 않았어요.<br />
            {formatSurveyOpensAt(survey?.opensAt) ? `${formatSurveyOpensAt(survey?.opensAt)}부터 참여할 수 있어요.` : "잠시 후 다시 열어주세요."}
          </p>
        )}

        {state === "form" && survey && (
          <>
            <h2 className="lv-ctamodal-title">{survey.title}</h2>
            {survey.description && <p className="lv-ctamodal-desc">{survey.description}</p>}
            <SurveyForm questions={survey.questions} submitting={submitting} onSubmit={handleSubmit} storageKey={draftKey} />
            {submitError && <p className="sv-err" style={{ marginTop: 12 }} role="alert">{submitError}</p>}
          </>
        )}

        {state === "done" && (
          <div className="lv-ctamodal-center done">
            <span className="ok">✓</span>
            <p className="big">{survey?.doneTitle?.trim() || "보내주셨어요, 감사합니다!"}</p>
            <p style={{ whiteSpace: "pre-wrap" }}>{isPreview ? "미리보기 — 실제 응답으로 저장되지는 않아요." : (survey?.doneDescription?.trim() || "내용을 확인하고 빠르게 연락드릴게요.")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
