"use client";

// 라이브 페이지 상태별 디자인 프리뷰 하니스.
// 실제 상태머신/인증/타이밍 없이 각 상태를 브라우저에서 바로 확인·검토하기 위한 화면.
// - ?slug= 없으면 목업 데이터로 각 상태 디자인을 확인(개발용)
// - ?slug=<웨비나> 가 있으면 공개 /info 로 그 웨비나의 실제 저장된 테마·CTA·세션·알림 구성을 불러와
//   라이브 시청 레이아웃을 그대로 미리보기(만들기 › 라이브 페이지의 "미리보기" 링크가 사용).
//   youtubeId 는 /info 가 게이팅해 노출하지 않으므로 영상 자리엔 포스터가 뜬다(레이아웃/테마 확인용).

import { useEffect, useMemo, useState } from "react";
import LiveContentStk from "@/app/webinar/[slug]/LiveContentStk";
import EntryVerify from "@/app/webinar/[slug]/EntryVerify";
import PreLiveWaiting from "@/app/webinar/[slug]/PreLiveWaiting";
import EndedScreen from "@/app/webinar/[slug]/EndedScreen";
import EndedSurveyDialog from "@/app/webinar/[slug]/EndedSurveyDialog";
import type { EndedSurveyLink } from "@/lib/webinar-ended-surveys";
import { normalizeLivePageConfig } from "@/lib/webinar-config";

type State = "waiting" | "entry" | "live" | "ended";

/**
 * 목업 모드 전용 — 카드 2장이 어떻게 앉는지 확인용(실제 웨비나에서는 저장된 값만 쓴다).
 * 두 번째 카드는 ctaLabel 을 지정해 버튼 문구가 설문마다 달라지는지도 함께 확인한다.
 */
const MOCK_ENDED_SURVEYS = [
  // surveyId 가 있으면 종료 화면이 새 창 대신 팝업으로 연다 — 그 분기를 하니스에서 눌러 보게.
  { url: "#survey-1", surveyId: "mock-1", title: "1분 만족도 설문", description: "오늘 어떠셨나요? 짧은 피드백이 다음 웨비나를 더 좋게 만들어요." },
  // 두 번째는 외부 설문 URL 을 흉내 낸다(surveyId 없음) — 새 탭으로 가는 쪽이 그대로 남는지.
  { url: "#survey-2", title: "다음 웨비나 주제 사전조사", description: "다음 회차에서 가장 듣고 싶은 주제를 골라주세요.", ctaLabel: "사전 신청하기" },
];
type ThemeKey = "dark" | "light";

const THEMES: Record<ThemeKey, { bg: string; text: string; surface: string; accent: string }> = {
  dark: { bg: "#0f0f11", text: "#f0f0f2", surface: "#17171c", accent: "#7c5cff" },
  light: { bg: "#f6f6f8", text: "#16161a", surface: "#ffffff", accent: "#6d28d9" },
};

const MOCK = {
  name: "2026 스마트테크 코리아 마케팅 웨비나",
  description: "AI 마케팅 자동화의 최신 트렌드와, 전시·웨비나 리드를 매출로 잇는 실전 전략을 소개합니다.",
  liveStartAt: "2026-08-20T19:00:00+09:00",
  liveEndAt: "2026-08-20T21:00:00+09:00",
  config: {
    livePage: {
      ctas: [
        {
          eyebrow: "세션 자료",
          title: "발표 자료·템플릿 받기",
          description: "이번 세션에서 쓴 자동화 워크플로우와 슬라이드를 지금 내려받으세요.",
          buttons: [{ label: "자료 받기 ↓", url: "#", style: "white" }],
        },
        {
          eyebrow: "다음 전시",
          title: "STK 2026 사전등록",
          description: "다음 오프라인 전시 얼리버드 등록이 열렸어요.",
          buttons: [
            { label: "사전등록", url: "#", style: "white" },
            { label: "자세히 보기", url: "#", style: "ghost" },
          ],
        },
      ],
      notify: {
        enabled: true,
        kicker: "다음 세션 · 20:20",
        title: "알림 받고 이어보기",
        description: "다음 세션이 시작되면 알려드리고, 다시보기도 이메일로 보내드려요.",
        switchLabel: "세션 시작 알림 받기",
      },
    },
  },
  /**
   * 유형 5종이 다 들어 있다 — 실 웨비나 없이 아젠다의 종류 표기·톤·번호를 검증하려면
   * 하니스에 표본이 있어야 한다. 특히 확인할 것:
   *   · 오프닝(순서 1)과 첫 세션(표시번호 1)이 둘 다 "Session 1" 로 찍히지 않는가
   *   · 세션 개수가 2개로 나오는가(5행 중 실제 세션만)
   *   · 휴식만 톤이 낮고 오프닝·클로징은 일반 행인가
   * 예전엔 3행 전부 session/qa 였고, 첫 행 제목이 "오프닝 —" 인데 type 은 session 인 모순이 있었다.
   */
  sessions: [
    { id: "s1", number: 1, type: "opening", title: "환영 인사", speaker: "김민준 | 마하스튜디오 대표", speakerPhotoUrl: null, logoUrl: null, description: "마하스튜디오 대표", startTime: "19:00", endTime: "19:10" },
    { id: "s2", number: 2, type: "session", title: "왜 지금 마케팅 자동화인가", speaker: "김민준", speakerCompany: "마하스튜디오 대표", speakerPhotoUrl: null, logoUrl: "/next.svg", description: "마하스튜디오 대표 · 마케팅 자동화 10년", startTime: "19:10", endTime: "19:40" },
    { id: "s3", number: 3, type: "break", title: "휴식", speaker: null, speakerPhotoUrl: null, logoUrl: null, description: null, startTime: "19:40", endTime: "19:50" },
    { id: "s4", number: 4, type: "session", title: "전시 리드를 매출로 전환하는 4단계", speaker: "이서연", speakerCompany: "엑스포럼 그로스 리드", speakerPhotoUrl: null, logoUrl: "/vercel.svg", description: "그로스 리드 · 前 대형 전시 운영", startTime: "19:50", endTime: "20:20" },
    { id: "s5", number: 5, type: "qa", title: "라이브 Q&A", speaker: "전체 연사", speakerPhotoUrl: null, logoUrl: null, description: "참가자 질문에 실시간으로 답합니다.", startTime: "20:20", endTime: "20:50" },
    { id: "s6", number: 6, type: "closing", title: "마무리 · 경품 추첨", speaker: "운영사무국", speakerPhotoUrl: null, logoUrl: null, description: null, startTime: "20:50", endTime: "21:00" },
  ],
};

interface RealWebinar {
  name: string;
  description: string | null;
  liveStartAt: string;
  liveEndAt: string;
  config: Record<string, unknown>;
  theme: Record<string, string> | null;
  chatEnabled: boolean;
  sessions: { id: string; number: number; type?: string; title: string; speaker: string | null; speakerCompany?: string | null; speakerPhotoUrl: string | null; logoUrl?: string | null; description: string | null; startTime: string; endTime: string }[];
}

export default function LivePreviewPage() {
  const [state, setState] = useState<State>("waiting");
  const [themeKey, setThemeKey] = useState<ThemeKey>("dark");
  const [real, setReal] = useState<RealWebinar | null>(null);

  // ?state= 로 초기 화면 지정 — 만들기의 대기/라이브/종료 메뉴에서 해당 화면을 바로 연다
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("state");
    if (s === "waiting" || s === "entry" || s === "live" || s === "ended") setState(s);
  }, []);

  // ?slug= 가 있으면 그 웨비나의 실제 저장 구성을 공개 /info 로 불러와 미리보기(없으면 목업 유지)
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("slug");
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/webinar/${slug}/info`);
        if (!res.ok) return;
        const data = await res.json();
        const w = data.webinar;
        if (cancelled || !w) return;
        const comps = (w.components ?? {}) as Record<string, unknown>;
        setReal({
          name: w.name,
          description: w.description ?? null,
          liveStartAt: w.liveStartAt,
          liveEndAt: w.liveEndAt,
          config: (w.config ?? {}) as Record<string, unknown>,
          theme: (w.theme ?? null) as Record<string, string> | null,
          chatEnabled: comps.chatEnabled === true,
          sessions: Array.isArray(w.sessions)
            ? w.sessions.map((s: Record<string, unknown>) => ({
                id: String(s.id), number: Number(s.number), type: s.type as string | undefined, title: String(s.title),
                speaker: (s.speaker as string) ?? null, speakerCompany: (s.speakerCompany as string) ?? null,
                speakerPhotoUrl: (s.speakerPhotoUrl as string) ?? null,
                description: (s.description as string) ?? null, startTime: String(s.startTime), endTime: String(s.endTime),
              }))
            : [],
        });
        setChatOn(comps.chatEnabled === true);
        // ?state= 로 화면을 지정하지 않았을 때만 라이브 시청 레이아웃을 기본으로
        if (!new URLSearchParams(window.location.search).get("state")) setState("live");
      } catch { /* 무시 — 목업으로 폴백 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // 미리보기 대상 — 실제 웨비나가 로드됐으면 그것, 아니면 목업
  const webinarData = real ?? MOCK;
  const live = normalizeLivePageConfig(webinarData.config);
  const t = real?.theme
    ? {
        bg: real.theme.bgColor ?? THEMES.dark.bg,
        text: real.theme.textColor ?? THEMES.dark.text,
        surface: real.theme.surfaceColor ?? THEMES.dark.surface,
        accent: real.theme.accentColor ?? THEMES.dark.accent,
      }
    : THEMES[themeKey];
  const borderRadius = real?.theme?.borderRadius ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("radius") ?? undefined : undefined);

  // EntryVerify 로컬 상태
  const [authMethod, setAuthMethod] = useState<"phone" | "email">("phone");
  const [authValue, setAuthValue] = useState("");
  // LiveContentStk QA 로컬 상태
  const [question, setQuestion] = useState("");
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [chatOn, setChatOn] = useState(true);
  const [qaMode, setQaMode] = useState<"open" | "closed">("open");
  // 종료 화면 설문 팝업 — 카드 CTA 를 누르면 열린다(새 창이 아니라는 것을 눌러서 확인).
  const [openedSurvey, setOpenedSurvey] = useState<EndedSurveyLink | null>(null);

  const target = useMemo(() => new Date(Date.now() + (2 * 86400 + 5 * 3600 + 37 * 60) * 1000).toISOString(), []);
  // 라이브 프리뷰에선 세션이 진행 중으로 보이게 서버시각을 행사 중으로 고정.
  // 실제 웨비나는 시작 20분 후 시점으로 잡아 첫 세션이 진행 중으로 표시된다(레이아웃 확인용).
  const liveNowMs = useMemo(() => new Date("2026-08-20T19:45:00+09:00").getTime(), []);
  const previewNowMs = real ? Date.parse(real.liveStartAt) + 20 * 60_000 : liveNowMs;
  const ANSWERED = useMemo(
    () => [
      { id: "a1", question: "레코드가 흩어져 있을 때 중복은 어떤 기준으로 잡나요?", sessionNumber: 2, name: "박*훈", voteCount: 24, status: "answered" },
      { id: "a2", question: "아임웹 폼 없이 바로 CRM 으로 넘길 수 있나요?", sessionNumber: null, name: "정*아", voteCount: 18, status: "pending" },
      { id: "a3", question: "노쇼를 줄이는 리마인드 시퀀스 예시가 궁금해요.", sessionNumber: 2, name: "최*", voteCount: 7, status: "pending" },
    ],
    [],
  );
  const [chatText, setChatText] = useState("");
  const CHAT = useMemo(
    () => [
      { id: "c1", name: "윤*재", message: "방금 4단계 정리 너무 좋네요 👏", isHost: false },
      { id: "c2", name: "이서연", message: "질문은 Q&A 탭에 남겨주세요!", isHost: true },
      { id: "c3", name: "소*민", message: "자료도 받을 수 있나요?", isHost: false },
      { id: "c4", name: "대*현", message: "이 파트 다시 듣고 싶어요", isHost: false },
    ],
    [],
  );

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text }}>
      {/* 프리뷰 툴바 */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "10px 16px", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", color: "#fff", opacity: 0.7 }}>LIVE PREVIEW</span>
        {real && (
          <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", opacity: 0.9, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            실제 · {real.name}
          </span>
        )}
        <div style={{ display: "flex", gap: 4 }}>
          {(["waiting", "entry", "live", "ended"] as State[]).map((s) => (
            <button key={s} onClick={() => setState(s)}
              style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.16)", fontSize: 12, fontWeight: 700, cursor: "pointer", background: state === s ? t.accent : "transparent", color: "#fff" }}>
              {s === "waiting" ? "대기" : s === "entry" ? "입장확인" : s === "live" ? "라이브시청" : "종료"}
            </button>
          ))}
        </div>
        <button onClick={() => setChatOn((v) => !v)}
          style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.16)", fontSize: 12, fontWeight: 700, cursor: "pointer", background: chatOn ? t.accent : "transparent", color: "#fff" }}>
          채팅 {chatOn ? "ON" : "OFF"}
        </button>
        <button onClick={() => setQaMode((v) => (v === "open" ? "closed" : "open"))}
          style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.16)", fontSize: 12, fontWeight: 700, cursor: "pointer", background: qaMode === "closed" ? t.accent : "transparent", color: "#fff" }}>
          Q&amp;A {qaMode === "open" ? "오픈형" : "폐쇄형"}
        </button>
        {/* 목업일 때만 테마 토글 노출 — 실제 웨비나는 저장된 테마를 그대로 사용 */}
        {!real && (
          <div style={{ display: "flex", gap: 4 }}>
            {(["dark", "light"] as ThemeKey[]).map((k) => (
              <button key={k} onClick={() => setThemeKey(k)}
                style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.16)", fontSize: 12, fontWeight: 700, cursor: "pointer", background: themeKey === k ? t.accent : "transparent", color: "#fff" }}>
                {k === "dark" ? "다크" : "라이트"}
              </button>
            ))}
          </div>
        )}
      </div>

      {state === "waiting" && (
        <PreLiveWaiting webinar={webinarData} accent={t.accent} text={t.text} surface={t.surface} borderRadius={borderRadius} targetIso={real?.liveStartAt ?? target} registered live={live} waitingCount={137} hasCalendar onCalendar={() => {}} onShare={() => {}} onNotify={() => {}} notify={{ subscribed: false, pending: false, error: "" }} />
      )}
      {state === "entry" && (
        <EntryVerify
          webinar={webinarData} accent={t.accent} text={t.text} surface={t.surface} borderRadius={borderRadius}
          targetIso={real?.liveStartAt ?? target} serverNowMs={previewNowMs} isLive
          authMethod={authMethod} authValue={authValue} verifyError="" isVerifying={false}
          onAuthMethod={setAuthMethod} onAuthValueChange={setAuthValue} onVerify={() => {}} onGoSignup={() => {}}
          live={live} viewerCount={1284}
        />
      )}
      {state === "live" && (
        <LiveContentStk
          webinar={webinarData} accent={t.accent} text={t.text} surface={t.surface} borderRadius={borderRadius} youtubeId={null}
          serverNowMs={previewNowMs} chatEnabled={chatOn}
          qa={{ sessions: webinarData.sessions, question, setQuestion, selectedSession, setSelectedSession, onSend: () => {}, isSending: false, sent: false, answered: ANSWERED, onVote: qaMode === "closed" ? undefined : () => {}, votedIds: [], mode: qaMode }}
          chat={chatOn ? { messages: CHAT, input: chatText, setInput: setChatText, onSend: () => setChatText(""), isSending: false } : undefined}
          notifyState={{ subscribed: false, onToggle: () => {}, error: "", pending: false }}
        />
      )}
      {state === "ended" && (
        <EndedScreen
          webinar={webinarData} accent={t.accent} text={t.text} surface={t.surface} borderRadius={borderRadius}
          live={live}
          /**
           * 종료 화면 설문은 여러 개 걸 수 있다(카드 N장). 목업 모드에서는 2장을 태워
           * 그리드가 실제로 2열로 앉는지 눈으로 확인한다 — 실제 웨비나(?slug=)에서는
           * 그 웨비나에 저장된 값만 쓴다(있는 것을 보여줘야 미리보기다).
           */
          surveys={
            real
              ? (() => {
                  const url = (real.config as Record<string, unknown>)?.surveyUrl;
                  return typeof url === "string" && url ? [{ url }] : [];
                })()
              : MOCK_ENDED_SURVEYS
          }
          onReplay={() => {}} onShare={() => {}}
          onOpenSurvey={(sv) => setOpenedSurvey(sv)}
        />
      )}

      {/* 종료 화면 설문 팝업 — 하니스에서는 목업 id 라 문항 조회가 404 로 떨어진다.
          그래도 "새 창이 아니라 이 자리에 뜬다" 와 에러 상태 문구를 눌러서 확인할 수 있다. */}
      {openedSurvey?.surveyId && (
        <EndedSurveyDialog
          slug="harness"
          surveyId={openedSurvey.surveyId}
          fallbackTitle={openedSurvey.title?.trim() || "설문"}
          registrationId={null}
          accent={t.accent}
          surface={t.surface}
          text={t.text}
          soft={(pct) => `color-mix(in srgb, ${t.text} ${pct}%, transparent)`}
          readOnly
          onClose={() => setOpenedSurvey(null)}
        />
      )}
    </div>
  );
}
