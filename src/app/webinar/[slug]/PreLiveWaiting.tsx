"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Share2, Bell, CalendarPlus } from "lucide-react";
import { buildStkCss } from "./LiveContentStk";
import { formatKst } from "@/lib/datetime";
import { safeHttpUrl, type LivePageConfig } from "@/lib/webinar-config";
import { buildSessionNumbering, cleanSessionText, isPauseSession, parseSpeaker, sessionHasSpeaker, sessionKicker } from "@/lib/webinar-sessions";
import { IMAGE_PRESETS, transformedImageUrl } from "@/lib/webinar-image";

/**
 * 등록 완료 ~ 라이브 오픈 전 대기 화면.
 * 히어로 + 카운트다운(주인공) + 캘린더·공유·알림 CTA + [요약·사회적증거 / 아젠다 타임라인] 2단.
 * 색·마감은 STK 토큰(테마 accent/surface/text + 소프트 섀도우) 구동. 섹션은 config 로 on/off.
 */
const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

const EXTRA_CSS = `
.stk-live .plw-eyebrow { font-size:11.5px; font-weight:750; letter-spacing:.14em; text-transform:uppercase; color:var(--key); }
.stk-live .cd { display:flex; justify-content:center; align-items:center; gap:10px; margin:6px auto 0; }
.stk-live .cd .cell { background:var(--card); box-shadow:var(--card-shadow); border-radius:var(--radius); padding:20px 14px; min-width:118px; text-align:center; }
@media (max-width:640px){ .stk-live .cd .cell { min-width:74px; padding:16px 8px; } }
.stk-live .cd .num { font-size:clamp(36px,6vw,58px); font-weight:840; line-height:1; letter-spacing:-.05em; color:var(--text); font-variant-numeric:tabular-nums; }
.stk-live .cd .lab { margin-top:10px; font-size:10.5px; font-weight:750; letter-spacing:.12em; text-transform:uppercase; color:var(--sub); }
.stk-live .cd .sep { font-size:30px; font-weight:300; color:var(--sub); }
.stk-live .cd-live { text-align:center; font-size:22px; font-weight:850; color:var(--key); }
.stk-live .plw-when { margin-top:20px; font-size:14px; color:var(--muted); text-align:center; }
.stk-live .plw-when b { color:var(--text); font-weight:700; }
.stk-live .plw-center-action { width:100%; max-width:440px; margin:6px auto 0; }
.stk-live .plw-entry-panel { width:100%; max-width:440px; margin:26px auto 0; }
.stk-live .plw-ctas { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:26px; }
.stk-live .plw-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:46px; padding:0 20px; border:0; border-radius:var(--radius-sm); font:inherit; font-size:14px; font-weight:700; cursor:pointer; background:var(--card); color:var(--text); box-shadow:var(--btn-shadow); transition:transform .16s ease, box-shadow .16s ease, opacity .16s ease; }
.stk-live .plw-btn:hover { transform:translateY(-2px); box-shadow:var(--btn-shadow-hover); }
.stk-live .plw-btn:disabled { opacity:.55; cursor:default; }
.stk-live .plw-btn svg { width:17px; height:17px; }
.stk-live .plw-btn.primary { background:var(--key); color:#fff; box-shadow:var(--btn-shadow-key); }
.stk-live .plw-btn.on { background:var(--key); color:#fff; box-shadow:var(--btn-shadow-key); }
.stk-live .plw-err { margin-top:10px; text-align:center; font-size:12.5px; color:#ef4444; }
.stk-live .plw-band { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin:56px 0 40px; align-items:start; }
.stk-live .plw-info-stack { display:flex; flex-direction:column; gap:20px; }
.stk-live .plw-band.single { grid-template-columns:minmax(0, 1fr); max-width:680px; margin-inline:auto; }
/* 한 열로 접히면 DOM 순서(CTA → 소개·아젠다)가 그대로 나온다 — 모바일에서는 **CTA 가 먼저**다.
   좁은 화면은 스크롤이 길어 아래로 갈수록 이탈하므로, 행동을 요구하는 카드가 위에 있어야 한다.
   PC 는 두 열이 나란히라 순서 문제가 없다(왼쪽 CTA / 오른쪽 소개·세션). */
@media (max-width:820px){ .stk-live .plw-band { grid-template-columns:1fr; } }
.stk-live .plw-panel { background:var(--card); border-radius:var(--radius); box-shadow:var(--card-shadow); padding:24px; }
.stk-live .plw-panel h3 { font-size:13px; font-weight:750; color:var(--muted); margin:0 0 4px; }
.stk-live .plw-panel .big { font-size:25px; font-weight:800; letter-spacing:-.03em; color:var(--text); }
/* pre-line 필수 — 같은 설명이 히어로(.live-desc)에서는 줄바꿈을 살리는데 이 패널에서만 한 줄로
   흘러서, 어드민이 넣은 줄바꿈이 화면 두 곳에서 다르게 보였다.
   (AGENTS 공통: "사용자 텍스트(설명 등)는 줄바꿈을 보존해 표시") */
.stk-live .plw-panel .desc { margin-top:18px; padding-top:18px; border-top:1px solid var(--line); font-size:13.5px; line-height:1.7; color:var(--muted); word-break:keep-all; white-space:pre-line; }
.stk-live .plw-ag { background:var(--card); border-radius:var(--radius); box-shadow:var(--card-shadow); padding:8px 4px 12px; }
.stk-live .plw-ag .h { display:flex; align-items:baseline; justify-content:space-between; padding:18px 22px 10px; }
.stk-live .plw-ag .h h3 { font-size:15px; font-weight:800; letter-spacing:-.02em; color:var(--text); margin:0; }
.stk-live .plw-ag .h span { font-size:12px; color:var(--sub); }
/* 세션 타임라인.
   예전 배치는 [시각 52px] gap28 [내용] 이고 선이 left:88px 이라 시각과 내용 사이가 크게 비어
   한 줄이 두 덩어리로 갈라져 보였다. 시각·마커·내용을 12px 간격으로 붙여 한 줄로 읽히게 한다.
   grid 로 마커 열을 따로 두면 선을 절대좌표(left:88px)로 못 박지 않아도 된다. */
/* 시각 열은 고정폭 — auto 로 두면 열 폭이 내용에 따라 흔들려 선 위치를 계산으로 못 박는다
   (실측: 마커 중심 103px vs 선 82px 로 21px 어긋났다). "14:00" 는 항상 5글자라 42px 로 충분하다. */
.stk-live .plw-row { position:relative; display:grid; grid-template-columns:42px 13px 1fr; gap:12px; padding:11px 22px; align-items:start; }
/* 선은 마커 열 한가운데. 첫 줄은 마커부터, 마지막 줄은 마커까지만 그린다(선이 카드 밖으로 새지 않게). */
.stk-live .plw-row::before { content:""; position:absolute; left:calc(22px + 42px + 12px + 6px); top:0; bottom:0; width:1.5px; background:var(--line); }
.stk-live .plw-row:first-of-type::before { top:18px; } .stk-live .plw-row:last-of-type::before { bottom:calc(100% - 19px); }
/* 시각은 시작–종료를 함께 — 길이를 못 가늠하면 타임라인이라 부를 이유가 없다.
   세로쓰기로 두 줄을 겹치지 않게 쌓고 tabular-nums 로 자릿수를 고정한다. */
.stk-live .plw-row .tm { position:relative; z-index:1; display:flex; flex-direction:column; line-height:1.3; font-size:12px; font-weight:700; color:var(--muted); font-variant-numeric:tabular-nums; padding-top:2px; }
.stk-live .plw-row .tm .to { font-weight:600; color:var(--sub); }
.stk-live .plw-row .mk { position:relative; z-index:1; margin:5px auto 0; width:9px; height:9px; border-radius:50%; background:var(--card); box-shadow:0 0 0 3px var(--key-dim), 0 0 0 1.5px var(--key); }
.stk-live .plw-row.brk .mk { box-shadow:0 0 0 3px color-mix(in srgb,var(--text) 6%,transparent), 0 0 0 1.5px var(--sub); }
/* 제목이 먼저 읽혀야 한다 — 예전엔 주황 칩(SESSION 1)이 맨 위에서 시선을 먼저 먹었다.
   칩을 제목 **아래**로 내리고 크기를 줄여 분류 라벨의 자리로 되돌린다. */
.stk-live .plw-row h4 { font-size:14.5px; font-weight:700; letter-spacing:-.01em; line-height:1.4; color:var(--text); margin:0; word-break:keep-all; }
.stk-live .plw-row .kd { display:inline-block; margin-top:5px; font-size:9.5px; font-weight:750; letter-spacing:.06em; text-transform:uppercase; color:var(--key); background:var(--key-dim); padding:2px 6px; border-radius:calc(5px * var(--r-scale, 1)); }
.stk-live .plw-row.brk .kd { color:var(--sub); background:color-mix(in srgb,var(--text) 6%,transparent); }
/* 휴식은 콘텐츠가 아니다 — 한 줄로 눌러 스크롤에서 건너뛰게 한다. */
.stk-live .plw-row.brk h4 { font-size:12.5px; font-weight:650; color:var(--sub); }
.stk-live .plw-row.brk .kd { display:none; }
.stk-live .plw-who { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:8px; }
.stk-live .plw-who .av { width:26px; height:26px; border-radius:50%; overflow:hidden; background:var(--key-dim); color:var(--key); display:grid; place-items:center; font-size:11px; font-weight:750; }
.stk-live .plw-who .av img { width:100%; height:100%; object-fit:cover; }
/* 연사 이름 — 12.5px 은 로고 옆에서 작아 보여 위계가 뒤집혔다(로고가 이름보다 먼저 읽힘). */
/* "이름 | 소속·직책" — 랜딩 타임테이블과 같은 위계. 이름을 더 진하게 둬서 구분자가 흐려도
   어디까지가 이름인지 읽힌다. gap 은 세로 0(줄바꿈 시 붙게), 가로 6px. */
/* 함께 기다리는 사람 밴드 — 카운트다운 바로 아래. 숫자가 주인공이라 배경은 옅게 깔고
   테두리 대신 그림자로 마감한다(AGENTS.md 공통: 외곽선 대신 그림자). */
/* 가운데 정렬은 flex + fit-content + margin-inline 으로. inline-flex 는 부모의 text-align 을
   따르는데 .live-inner 는 block/start 라 왼쪽에 붙었다(실측: 중심차 -82px). */
/* "이 웨비나는" 카드의 마지막 줄. 예전에는 카운트다운 아래 떠 있는 가운데 알약이라 어느 것에
   대한 숫자인지 걸리는 데가 없었고, 그림자까지 있어 카드가 하나 더 있는 것처럼 보였다.
   카드 안으로 들어왔으므로 그림자를 뺀다 — 판 위의 판은 위계를 흐린다. 위쪽 구분선으로
   본문과 나누되 선은 옅게(외곽선 마감이 아니라 문단 구분이다). */
.stk-live .plw-panel .plw-together {
  display:flex; align-items:center; gap:12px;
  margin:18px 0 0; padding:18px 0 0; border:0; border-top:1px solid var(--line);
  background:none; color:var(--muted);
  font-size:13.5px; font-weight:600;
}
.stk-live .plw-panel .plw-together b { color:var(--text); font-weight:800; font-variant-numeric:tabular-nums; }
/* 겹친 프로필 원 — 사람이 모여 있다는 걸 숫자보다 먼저 말한다.
   음수 마진으로 겹치고, 카드색 링을 둘러 뒤 원과 분리한다(겹침이 뭉개지지 않게).
   이니셜·사진을 넣지 않는 이유: 실제 등록자가 아니라 **양을 나타내는 장식**이다.
   가짜 이름을 넣으면 특정인이 등록한 것처럼 읽혀 사회적 증거가 거짓이 된다. */
.stk-live .plw-avatars { display:flex; flex:none; }
.stk-live .plw-avatars span {
  width:30px; height:30px; border-radius:50%; margin-left:-10px;
  border:2.5px solid var(--card);
  display:grid; place-items:center;
  background:var(--key-dim); color:var(--key);
}
.stk-live .plw-avatars span:first-child { margin-left:0; }
.stk-live .plw-avatars svg { width:15px; height:15px; }
/* 마지막 칸은 "그 외 더" — 원의 수(4)는 고정 장식이고 실제 수는 문장이 말한다. */
.stk-live .plw-avatars span.more {
  background:color-mix(in srgb, var(--text) 7%, var(--card));
  color:var(--sub); font-size:11px; font-weight:800; letter-spacing:-.02em;
}
/* 채널 초대 카드.
   폭을 560px 로 좁혀 가운데 두면 바로 위 "이 웨비나는" 패널과 어깨가 어긋난다 — 같은 스택
   안의 형제이므로 열 폭을 그대로 채운다.
   본문을 가운데 정렬했던 것도 되돌렸다. 이 글은 한 문장이 아니라 **안내 + 항목 나열 + 맺음말**
   7줄이라, 가운데 정렬이면 줄마다 시작점이 달라져 목록이 목록으로 안 읽힌다(시처럼 보인다).
   왼쪽 정렬이면 불릿 없이도 나열로 읽힌다 — 문구는 운영자가 쓰는 자유 텍스트라 구조를
   코드가 파싱할 수 없고, 정렬만으로 형태를 살리는 게 안전하다.
   면은 키컬러를 옅게 깐다. 위 패널과 같은 흰 카드면 "정보 카드가 하나 더"로 보이는데,
   이 카드가 요구하는 건 읽기가 아니라 **행동**이다(외곽선 대신 그림자 마감은 그대로). */
.stk-live .plw-follow-up-card {
  width:100%;
  padding:22px 24px;
  display:flex;
  flex-direction:column;
  gap:18px;
  background:color-mix(in srgb, var(--key) 7%, var(--card));
  border-radius:var(--radius);
  box-shadow:var(--card-shadow);
}
/* 카드 제목. 형제 패널의 h3(13px 뮤트)는 **eyebrow** 이고 진짜 제목은 .big(25px)이다.
   여기는 카드가 하나뿐이라 그 둘 사이 — 카드의 머리로 읽히되 웨비나 이름과 경쟁하지 않는 크기. */
.stk-live .plw-follow-up-card h3 {
  margin:0;
  font-size:17px; font-weight:800; letter-spacing:-.02em; color:var(--text);
  word-break:keep-all;
}
/* 제목이 있으면 본문과의 간격을 좁힌다 — 둘은 한 덩어리이고, 큰 간격은 버튼 앞에 둔다. */
.stk-live .plw-follow-up-card h3 + p { margin-top:-6px; }
/* 나열 항목 — 체크 표시를 의사요소로 둔다. 마크를 DOM 에 넣으면 스크린리더가 항목마다
   읽어 버리고, 텍스트가 두 줄로 접힐 때 들여쓰기가 무너진다. */
.stk-live .plw-follow-up-items { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
.stk-live .plw-follow-up-items li {
  position:relative; padding-left:24px;
  color:var(--text); opacity:.82;
  font-size:14px; line-height:1.55; word-break:keep-all;
}
.stk-live .plw-follow-up-items li::before {
  content:""; position:absolute; left:2px; top:.45em;
  width:6px; height:10px; border:solid var(--key); border-width:0 2px 2px 0;
  transform:rotate(45deg) translateY(-1px);
}
.stk-live .plw-follow-up-card p {
  margin:0;
  color:var(--text);
  opacity:.78;
  font-size:14px;
  line-height:1.75;
  white-space:pre-line;
  word-break:keep-all;
}
/* 버튼은 카드 폭을 채운다 — 이 카드의 주 행동이 하나뿐이라 크기를 줄일 이유가 없고,
   모바일에서 그대로 터치 타깃이 된다. */
.stk-live .plw-follow-up-card a {
  min-height:48px;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  padding:0 18px;
  border-radius:calc(12px * var(--r-scale, 1));
  background:var(--key);
  /* 흰 글자 고정(요청). --on-key 는 밝은 키컬러에서 진한 글자로 뒤집는데, 그 판정이
     YIQ 0.6 임계라 주황(#ff8500 → 0.605)이 간신히 넘어 검은 글자가 나오고 있었다. */
  color:#fff;
  font-size:14px;
  font-weight:800;
  box-shadow:var(--btn-shadow-key);
  transition:transform .16s ease, box-shadow .16s ease;
}
.stk-live .plw-follow-up-card a:hover { transform:translateY(-2px); box-shadow:var(--btn-shadow-hover); }
.stk-live .plw-follow-up-card a::after { content:"→"; font-weight:700; }
@media (prefers-reduced-motion: reduce) {
  .stk-live .plw-follow-up-card a { transition:none; }
  .stk-live .plw-follow-up-card a:hover { transform:none; }
}
/* 캘린더 버튼 — 초대 공유와 같은 줄의 형제다. 예전에는 화면 하단 고정 배너였는데, 늘 떠 있어
   콘텐츠를 가리면서도 다른 CTA 들과 위계가 끊겨 있었다. .plw-btn 규격을 그대로 쓰므로
   여기서는 노출 폭만 정한다 — 모바일 전용(PC 는 일정을 옮겨 담을 곳이 손에 없다). */
@media (min-width:768px) { .stk-live .plw-btn.cal { display:none; } }
.stk-live .plw-who small { font-size:14px; color:var(--text); font-weight:650; }
.stk-live .plw-who .who { display:flex; align-items:baseline; flex-wrap:wrap; gap:0 6px; }
.stk-live .plw-who .who b { font-weight:750; }
.stk-live .plw-who .who .sep { opacity:.38; font-weight:400; }
.stk-live .plw-who .who .co { color:var(--muted); font-weight:600; }
`;

interface Session {
  id: string;
  number: number;
  type?: string;
  title: string;
  speaker: string | null;
  speakerCompany?: string | null;
  speakerPhotoUrl?: string | null;
  logoUrl?: string | null;
  description?: string | null;
  startTime: string;
  endTime: string;
}

interface PreLiveWaitingProps {
  webinar: { name: string; description: string | null; liveStartAt: string; sessions: Session[] };
  accent: string;
  text: string;
  surface: string;
  /** 테마의 테두리 둥글기 — 없으면 디자인 기본값 */
  borderRadius?: string;
  targetIso: string;
  serverNowMs?: number;
  registered?: boolean;
  live: LivePageConfig;
  /** 지금 대기 화면에 함께 있는 등록자 수. null = 서버가 세지 않는 구간(라이브 중). */
  waitingCount?: number | null;
  /** 누적 사전등록자 수 — 사회적 증거 밴드가 쓴다. waitingCount(지금 대기 인원)와 다른 값. */
  registrantCount?: number | null;
  hasCalendar?: boolean;
  onCalendar?: () => void;
  onShare?: () => void;
  shareCopied?: boolean;
  onNotify?: () => void;
  notify?: { subscribed: boolean; pending: boolean; error: string };
  /** 입장 확인처럼 카운트다운과 같은 레이아웃을 공유하는 화면의 주요 행동 카드. */
  centerAction?: ReactNode;
  /** 수동 라이브 전환도 카운트다운 대신 주요 행동 카드를 보여준다. */
  replaceCountdown?: boolean;
}

function diffParts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export default function PreLiveWaiting({
  webinar, accent, text, surface, borderRadius, targetIso, serverNowMs, registered = true,
  live, waitingCount, registrantCount, hasCalendar, onCalendar, onShare, shareCopied, onNotify, notify, centerAction, replaceCountdown = false,
}: PreLiveWaitingProps) {
  const css = useMemo(() => buildStkCss(accent || "#6D28D9", text || "#141320", surface || "#FFFFFF", borderRadius) + EXTRA_CSS, [accent, text, surface, borderRadius]);
  const targetMs = useMemo(() => new Date(targetIso).getTime(), [targetIso]);

  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => serverNowMs ?? 0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 대기 인원은 hydration 뒤에만 열어야 한다.
    setMounted(true);
    const base = serverNowMs ?? Date.now();
    const startedAt = Date.now();
    setNow(base);
    const id = setInterval(() => setNow(base + (Date.now() - startedAt)), 1000);
    return () => clearInterval(id);
  }, [serverNowMs]);

  const remaining = targetMs - now;
  const started = remaining <= 0;
  const { d, h, m, s } = diffParts(remaining);
  const cells = [{ n: d, l: "Days" }, { n: h, l: "Hours" }, { n: m, l: "Min" }, { n: s, l: "Sec" }];

  const showCalendar = live.waiting.calendar && hasCalendar && !!onCalendar;
  const showShare = live.waiting.share && !!onShare;
  const showNotify = live.waiting.notify && !!onNotify;
  const agendaNumbering = useMemo(() => buildSessionNumbering(webinar.sessions), [webinar.sessions]);
  const showAgenda = live.waiting.agenda && webinar.sessions.length > 0;
  /**
   * 사회적 증거 밴드 — **누적 사전등록자 수**를 쓴다(지금 접속 중인 인원이 아니라).
   * 등록을 망설이는 사람에게 보여 주는 숫자라, 여태 몇 명이 등록했는지가 설득력이 있다.
   *
   * 2명 미만이면 그리지 않는다. "1명이 신청했어요" 는 텅 빈 행사라는 신호가 되어 오히려
   * 이탈을 부른다 — 사회적 증거는 있을 때만 말한다. 마운트 전에도 숨긴다(SSR 과 값이 달라 깜빡이지 않게).
   */
  const showTogether = live.waiting.social && mounted && typeof registrantCount === "number" && registrantCount >= 2;
  /* 소개 카드 — 설정이 비면 웨비나 기본정보로 떨어진다(기존 화면 불변). */
  const about = live.waiting.about;
  const aboutEyebrow = about.eyebrow.trim() || "이 웨비나는";
  const aboutTitle = about.title.trim() || webinar.name;
  const aboutBody = about.body.trim() || (webinar.description ?? "");

  const followUp = live.waiting.followUp;
  const followUpTitle = followUp.title.trim();
  const followUpText = followUp.text.trim();
  const followUpUrl = safeHttpUrl(followUp.ctaUrl);
  const showFollowUpCta = followUp.ctaLabel.trim() !== "" && followUpUrl !== "";
  const followUpItems = followUp.items;
  const showFollowUp =
    followUp.enabled && (followUpTitle !== "" || followUpText !== "" || followUpItems.length > 0 || showFollowUpCta);
  /* 캘린더가 이 줄로 들어왔으니 게이트에도 넣는다 — 빼면 캘린더만 켰을 때 줄 자체가 안 그려진다. */
  const showUtilityCtas = showCalendar || showShare || showNotify;
  /* "이 웨비나는" 패널은 아젠다·팔로업이 없어도 그린다 — 함께 기다리는 인원 밴드가 그 안에 들어가서다. */
  const showInfoBand = showAgenda || showFollowUp || showTogether;
  /* 2단은 **왼쪽 열에 CTA 가 있을 때만**. 예전에는 아젠다 유무로 갈랐는데, 소개 카드가
     오른쪽으로 옮겨온 뒤로는 왼쪽이 빌 수 있어 빈 칸이 남았다. */
  const twoColumn = showFollowUp;
  const showCenterAction = Boolean(centerAction) && (started || replaceCountdown);

  return (
    <div className="stk-live">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="live-inner">
        <div className="live-hero">
          <div className="plw-eyebrow">Live Webinar</div>
          <h1 className="live-title" style={{ marginTop: 12 }}>{webinar.name}</h1>
          {webinar.description && <p className="live-desc">{webinar.description}</p>}
        </div>

        {!mounted ? (
          <div style={{ minHeight: 120 }} />
        ) : showCenterAction ? (
          <div className="plw-center-action">{centerAction}</div>
        ) : started ? (
          <p className="cd-live">곧 시작합니다 — 잠시만 기다려주세요</p>
        ) : (
          <>
            <div className="cd" aria-label="시작까지 남은 시간">
              {cells.map((c, i) => (
                <div key={c.l} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="cell"><div className="num">{String(c.n).padStart(2, "0")}</div><div className="lab">{c.l}</div></div>
                  {i < cells.length - 1 && <div className="sep">:</div>}
                </div>
              ))}
            </div>
            <p className="plw-when">
              <b>{formatKst(webinar.liveStartAt, { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })}</b> 라이브 시작
            </p>
          </>
        )}

        {/**
          * "N명이 함께 기다려요" — 카운트다운 바로 아래.
          *
          * 2명 미만이면 그리지 않는다. "1명이 함께 기다려요" 는 자기 자신이라 정보가 아니고,
          * 텅 빈 대기실이라는 신호가 되어 오히려 이탈을 부른다. 사회적 증거는 있을 때만 말한다.
          *
          * null(서버가 세지 않는 구간 = 라이브 중)에도 그리지 않는다 — 그때는 시청자 수가
          * 같은 자리를 맡는다. 마운트 전에는 숨긴다(SSR 과 값이 달라 깜빡이지 않게).
          */}
        {mounted && centerAction && !showCenterAction && <div className="plw-entry-panel">{centerAction}</div>}

        {showUtilityCtas && (
          <div className="plw-ctas">
            {showCalendar && (
              <motion.button whileTap={{ scale: 0.97 }} transition={spring} onClick={onCalendar} className="plw-btn cal">
                <CalendarPlus /> 캘린더 추가
              </motion.button>
            )}
            {showShare && (
              <motion.button whileTap={{ scale: 0.97 }} transition={spring} onClick={onShare} className="plw-btn">
                <Share2 /> {shareCopied ? "링크 복사됨 ✓" : "초대 공유"}
              </motion.button>
            )}
            {showNotify && (
              <motion.button whileTap={{ scale: 0.97 }} transition={spring} onClick={onNotify} disabled={notify?.pending} className={`plw-btn ${notify?.subscribed ? "on" : ""}`}>
                <Bell /> {notify?.subscribed ? "알림 받는 중 ✓" : "시작 알림 받기"}
              </motion.button>
            )}
          </div>
        )}
        {notify?.error && <p className="plw-err">{notify.error}</p>}

        {showInfoBand && (
          <div className={`plw-band${twoColumn ? "" : " single"}`}>
            {/* 왼쪽 — 추가 CTA 카드만. 소개 카드는 오른쪽 위로 옮겼다: 세션 순서를 볼 때
                "무슨 웨비나였나" 가 바로 위에 있어야 읽히고, CTA 는 그 흐름 밖의 제안이다. */}
            {showFollowUp && (
              <div className="plw-info-stack side">
                  <div className="plw-follow-up-card">
                    {followUpTitle && <h3>{followUp.title}</h3>}
                    {followUpText && <p>{followUp.text}</p>}
                    {followUpItems.length > 0 && (
                      <ul className="plw-follow-up-items">
                        {followUpItems.map((it) => <li key={it}>{it}</li>)}
                      </ul>
                    )}
                    {showFollowUpCta && (
                      <a href={followUpUrl} target="_blank" rel="noopener noreferrer">
                        {followUp.ctaLabel}
                      </a>
                    )}
                  </div>
              </div>
            )}

            {/* 오른쪽 — 소개 카드가 위, 세션 순서가 그 아래 */}
            <div className="plw-info-stack main">
              <div className="plw-panel">
                <h3>{aboutEyebrow}</h3>
                <div className="big">{aboutTitle}</div>
                {aboutBody && <div className="desc">{aboutBody}</div>}
                {/* 함께 기다리는 인원 — 카드 맨 아래. 예전에는 카운트다운 아래 떠 있는 알약이라
                    어느 것에 대한 숫자인지 걸리는 데가 없었다. 웨비나를 설명하는 카드의 마지막 줄에
                    두면 "이 웨비나를 몇 명이 기다린다"로 읽힌다. */}
                {showTogether && (
                  <div className="plw-together" role="status" aria-live="polite">
                    {/* 원은 장식이라 스크린리더에서 감춘다 — 읽어야 할 정보는 옆 문장에 다 있다. */}
                    <div className="plw-avatars" aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <span key={i}>
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="8" r="4" />
                            <path d="M12 14c-4.4 0-8 2.7-8 6v1h16v-1c0-3.3-3.6-6-8-6z" />
                          </svg>
                        </span>
                      ))}
                      <span className="more">+</span>
                    </div>
                    <span><b>{registrantCount.toLocaleString()}명</b>이 이 웨비나를 기다려요</span>
                  </div>
                )}
              </div>
            {showAgenda && (
              <div className="plw-ag">
                {/* 개수는 실제 세션만 — 휴식·Q&A 를 세면 "3개 세션"이 "5개 세션"으로 부풀었다 */}
                <div className="h"><h3>세션 순서</h3><span>{agendaNumbering.realCount}개 세션</span></div>
                {webinar.sessions.map((sn) => {
                  /**
                   * 종류 표기는 유형 표가 만든다(sessionKicker). 예전엔 여기서 삼항 체인이었고,
                   * 표에 없는 유형이 else 로 떨어져 `Session ${displayNumber ?? sn.number}` 가 됐다 —
                   * 세션이 아니면 displayNumber 가 null 이라 폴백이 **DB 진행 순서 원본**을 찍어서
                   * 오프닝(number 1)과 첫 세션(표시번호 1)이 한 화면에 둘 다 "Session 1" 이 됐다.
                   */
                  const kd = sessionKicker(sn.type, agendaNumbering.displayNumber(sn.number));
                  // 톤다운은 **빈 시간(휴식)에만**. 오프닝·클로징은 세션으로 세지 않지만 콘텐츠다.
                  const muted = isPauseSession(sn.type);
                  /* 랜딩 타임테이블과 같은 표기 — "이름 | 소속·직책".
                     parseSpeaker 를 거치는 이유: 레거시 speaker 가 "이름 | 회사" 결합형이라
                     raw 로 쓰면 구분자가 두 번 나오거나 소속이 이름 안에 박혀 나온다. */
                  const sp = parseSpeaker(cleanSessionText(sn.speaker), cleanSessionText(sn.speakerCompany));
                  const hasWho = Boolean(sp.name || sp.company);
                  return (
                    <div className={`plw-row ${muted ? "brk" : ""}`} key={sn.id}>
                      {/* 시작–종료를 함께 — endTime 은 데이터에 있는데 여태 안 쓰고 있었다.
                          길이를 못 가늠하면 "타임라인" 이라 부를 이유가 없다. */}
                      <div className="tm">
                        <span>{sn.startTime}</span>
                        {sn.endTime && <span className="to">{sn.endTime}</span>}
                      </div>
                      <span className="mk" />
                      <div>
                        {/* 제목이 먼저 — 분류 칩은 아래로 내린다(예전엔 칩이 시선을 먼저 먹었다). */}
                        <h4>{sn.title}</h4>
                        <span className="kd">{kd}</span>
                        {/**
                          * 로고는 그리지 않는다 — 랜딩 타임테이블의 접힌 줄과 같은 판단이다.
                          * 훑을 때 필요한 건 시각·무엇·누구뿐이고, 마크는 그 셋에 기여하지 않으면서
                          * 줄마다 폭이 달라 세로 리듬을 흔든다. 로고는 랜딩 타임테이블 펼침과
                          * 연사 상세 팝업에서 본다.
                          *
                          * 그래서 게이트도 연사 하나로 좁아졌다(예전엔 로고만 있는 오프닝·클로징에도
                          * 줄을 그려야 해서 조건이 둘이었다).
                          */}
                        {sessionHasSpeaker(sn.type) && hasWho && (
                          <div className="plw-who">
                            {/* 아바타 이니셜은 이름에서 — 소속만 있는 세션에서는 그리지 않는다(빈 원 방지). */}
                            {Boolean(sp.name) && (
                              <span className="av">{sn.speakerPhotoUrl ? <img src={transformedImageUrl(sn.speakerPhotoUrl, IMAGE_PRESETS.modalAvatar)} alt={sp.name} /> : sp.name[0]}</span>
                            )}
                            <small className="who">
                              {Boolean(sp.name) && <b>{sp.name}</b>}
                              {Boolean(sp.name && sp.company) && <span className="sep" aria-hidden="true">|</span>}
                              {Boolean(sp.company) && <span className="co">{sp.company}</span>}
                            </small>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
