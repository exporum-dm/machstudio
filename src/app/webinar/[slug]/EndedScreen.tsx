"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Check, Play, ClipboardCheck, FileText, Download, Share2, Link2, Lock } from "lucide-react";
import { buildStkCss } from "./LiveContentStk";
import { DEFAULT_ENDED_DESCRIPTION, DEFAULT_ENDED_TITLE, type LivePageConfig } from "@/lib/webinar-config";
import type { EndedSurveyLink } from "@/lib/webinar-ended-surveys";
import { formatSurveyOpensAt, surveyOpenState } from "@/lib/webinar-survey";

/**
 * 라이브 종료 화면 — 감사 + 다음 스텝 전환.
 * 다시보기 / 만족도 설문 / 자료 다운로드 / 다음 웨비나 / 공유. 각 섹션은 config 및 데이터 유무로 표시.
 * (리캡 통계는 표시하지 않음)
 */
const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

/** 제목·설명이 비었을 때의 기본 문구 — 외부 설문 URL 만 넣은 경우가 이 경로다. */
const DEFAULT_SURVEY_TITLE = "1분 만족도 설문";
const DEFAULT_SURVEY_DESCRIPTION = "오늘 어떠셨나요? 짧은 피드백이 다음 웨비나를 더 좋게 만들어요.";
/** 버튼 문구 기본값 — 설문 편집기의 '종료 화면 버튼' 을 비우면 이 문구가 나간다. */
const DEFAULT_SURVEY_CTA = "설문 참여하기";

const EXTRA_CSS = `
.stk-live .en-hero { text-align:center; display:flex; flex-direction:column; align-items:center; gap:16px; padding:8px 0 4px; }
.stk-live .en-check { width:60px; height:60px; border-radius:50%; background:color-mix(in srgb,#12B76A 14%,transparent); color:#12B76A; display:grid; place-items:center; box-shadow:0 0 0 8px color-mix(in srgb,#12B76A 6%,transparent); }
.stk-live .en-check svg { width:30px; height:30px; }
/* 카드 수를 세지 않는다 — 설문을 여러 개 걸 수 있게 되면서 "2개면 2열" 이라는 손계산이
   3개 이상에서 무너졌다. auto-fit + minmax 는 1개면 한 줄 전폭, 2개면 반반, 3개면 3열,
   좁은 화면이면 자동으로 1열이 된다(별도 미디어쿼리 불필요). */
.stk-live .en-actions { display:grid; gap:16px; margin:40px 0 32px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); }
.stk-live .en-act { background:var(--card); border-radius:var(--radius); box-shadow:var(--card-shadow); padding:24px; display:flex; flex-direction:column; gap:6px; }
.stk-live .en-act .ic { width:40px; height:40px; border-radius:calc(11px * var(--r-scale, 1)); background:var(--key-dim); color:var(--key); display:grid; place-items:center; margin-bottom:8px; }
.stk-live .en-act .ic svg { width:20px; height:20px; }
.stk-live .en-act h3 { font-size:16.5px; font-weight:780; letter-spacing:-.02em; color:var(--text); margin:0; }
.stk-live .en-act p { font-size:13.5px; line-height:1.6; color:var(--muted); margin:0 0 8px; flex:1; word-break:keep-all; }
.stk-live .en-btn { display:flex; align-items:center; justify-content:center; gap:7px; width:100%; height:44px; border:0; border-radius:var(--radius-sm); font:inherit; font-size:14px; font-weight:750; cursor:pointer; text-decoration:none; transition:transform .16s ease, box-shadow .16s ease, opacity .16s ease; }
.stk-live .en-btn.primary { background:var(--key); color:#fff; box-shadow:var(--btn-shadow-key); }
.stk-live .en-btn.soft { background:var(--card-2); color:var(--text); box-shadow:var(--btn-shadow); }
.stk-live .en-btn:hover { transform:translateY(-2px); }
.stk-live .en-btn:disabled { opacity:.6; cursor:default; transform:none; }
.stk-live .en-res { background:var(--card); border-radius:var(--radius); box-shadow:var(--card-shadow); padding:8px 4px; margin-bottom:30px; }
.stk-live .en-res .rh { padding:16px 20px 6px; font-size:13px; font-weight:750; color:var(--muted); }
.stk-live .en-res a { display:flex; align-items:center; gap:13px; padding:13px 20px; text-decoration:none; color:var(--text); transition:background .15s ease; }
.stk-live .en-res a+a { border-top:1px solid var(--line); }
.stk-live .en-res a:hover { background:color-mix(in srgb,var(--text) 3%,transparent); }
/* 잠긴 자료 — 클릭을 막지 않는다. disabled 는 포커스를 못 받아 스크린리더가 존재를 못 알리고,
   "왜 안 되는지" 를 말할 기회도 잃는다. 눌렀을 때 다음 행동(설문 열기·등록)을 준다. */
.stk-live .en-res .locked { cursor:pointer; }
.stk-live .en-res .locked .nm { color:var(--muted); }
.stk-live .en-res .locked .fi { background:color-mix(in srgb,var(--text) 6%,transparent); color:var(--sub); }
.stk-live .en-res .why { display:block; margin-top:2px; font-size:11.5px; color:var(--key); font-weight:650; }
.stk-live .en-res .fi { width:34px; height:34px; border-radius:calc(9px * var(--r-scale, 1)); background:var(--key-dim); color:var(--key); display:grid; place-items:center; flex-shrink:0; }
.stk-live .en-res .fi svg { width:17px; height:17px; }
.stk-live .en-res .nm { font-size:14px; font-weight:650; flex:1; }
.stk-live .en-res .mt { font-size:12px; color:var(--sub); }
.stk-live .en-res .dl { color:var(--sub); display:grid; place-items:center; }
.stk-live .en-res .dl svg { width:18px; height:18px; }
.stk-live .en-next { display:flex; align-items:center; gap:20px; flex-wrap:wrap; padding:24px; margin-bottom:24px; border-radius:var(--radius); box-shadow:var(--card-shadow); background:linear-gradient(120deg, var(--key-dim), var(--card)); }
.stk-live .en-next .tx { flex:1; min-width:220px; }
.stk-live .en-next .eb { font-size:11.5px; font-weight:750; letter-spacing:.12em; text-transform:uppercase; color:var(--key); }
.stk-live .en-next h3 { font-size:20px; font-weight:800; letter-spacing:-.03em; color:var(--text); margin:6px 0 4px; }
.stk-live .en-next p { font-size:13.5px; color:var(--muted); margin:0; }
.stk-live .en-next .en-btn { width:auto; padding:0 22px; }
.stk-live .en-share { display:flex; align-items:center; justify-content:center; gap:10px; padding:22px 0 40px; color:var(--sub); font-size:13px; }
.stk-live .en-sbtn { width:40px; height:40px; border-radius:999px; border:0; background:var(--card); box-shadow:var(--btn-shadow); color:var(--muted); cursor:pointer; display:grid; place-items:center; transition:transform .15s ease, color .15s ease; }
.stk-live .en-sbtn:hover { transform:translateY(-2px); color:var(--key); }
.stk-live .en-sbtn svg { width:16px; height:16px; }
`;

interface EndedScreenProps {
  webinar: { name: string; description: string | null };
  accent: string;
  text: string;
  surface: string;
  live: LivePageConfig;
  /**
   * 종료 화면에 걸린 설문들 — 자체 설문 N개 또는 외부 설문 URL 하나.
   * 배열인 이유: 만족도 설문과 다음 행사 사전조사를 함께 거는 게 실제 운영 패턴이다.
   */
  surveys?: readonly EndedSurveyLink[];
  /**
   * 우리 설문 카드를 눌렀을 때 — 새 창 대신 이 콜백으로 팝업을 띄운다.
   * 주지 않으면(미리보기 하니스 등) 링크 그대로 동작한다 — 팝업 로직 없이도 화면이 성립하게.
   */
  onOpenSurvey?: (survey: EndedSurveyLink) => void;
  /** 이 방문자가 사전등록을 마쳤는가. 자료 게이팅의 첫 관문. */
  hasRegistration?: boolean;
  /** 이미 낸 설문 id 들 — 자료의 surveyId 가 여기 있으면 자물쇠가 풀린다. */
  completedSurveyIds?: readonly string[];
  /** 미등록자가 잠긴 자료를 눌렀을 때. 없으면 안내 문구만 보이고 아무 일도 안 한다. */
  onRequireRegister?: () => void;
  onReplay?: () => void;
  replayRequested?: boolean;
  replayPending?: boolean;
  onShare?: () => void;
  shareCopied?: boolean;
  /** 서버 시계(폴링이 갱신) — 응답 기간 판정을 여기서 하려면 서버 기준 시각이 필요하다. */
  serverNowMs?: number;
  /** 테마의 테두리 둥글기 — 없으면 디자인 기본값 */
  borderRadius?: string;
}

export default function EndedScreen({
  webinar, accent, text, surface, live, surveys, onOpenSurvey,
  hasRegistration = true, completedSurveyIds = [], onRequireRegister,
  onReplay, replayRequested, replayPending, onShare, shareCopied, serverNowMs, borderRadius,
}: EndedScreenProps) {
  const css = useMemo(() => buildStkCss(accent || "#6D28D9", text || "#141320", surface || "#FFFFFF", borderRadius) + EXTRA_CSS, [accent, text, surface, borderRadius]);

  const showReplay = live.ended.replay && !!onReplay;
  /**
   * 응답 기간을 **여기서** 판정한다 — 서버가 판정 결과만 주면 그 값은 fetch 시점에 굳고,
   * 종료 화면은 오래 열려 있어서 예약 시각이 지나도 새로고침할 때까지 안 열렸다.
   * serverNowMs 는 폴링이 갱신하므로 시각이 되는 순간 카드가 스스로 열린다.
   * (외부 설문 URL 카드는 일정이 없다 — isOpen 미정이면 열린 것으로 본다.)
   */
  const stateOf = (s: EndedSurveyLink) =>
    s.isOpen === undefined ? "open" : surveyOpenState({ isOpen: s.isOpen, opensAt: s.opensAt, closesAt: s.closesAt }, serverNowMs ?? Date.now());
  // 이중 게이트 — 영역 토글 ON + 실제 설문 있음(AGENTS §4). 껍데기 카드를 시청자에게 안 보인다.
  const surveyList = live.ended.survey ? (surveys ?? []).filter((s) => s.url) : [];
  const showResources = live.ended.resources && live.resources.length > 0;
  const showNext = live.ended.nextWebinar && !!live.nextWebinar;
  const showShare = live.ended.share && !!onShare;
  const actionCount = (showReplay ? 1 : 0) + surveyList.length;

  return (
    <div className="stk-live">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="live-inner">
        <div className="en-hero">
          <div className="en-check"><Check strokeWidth={2.6} /></div>
          {/* 어드민이 입력한 문구 우선, 비어 있으면 기본값. 줄바꿈은 pre-line 으로 살린다
              (제목의 줄바꿈 위치를 직접 정할 수 있어야 해서 <br /> 대신 실제 개행을 쓴다). */}
          <h1 className="live-title" style={{ whiteSpace: "pre-line" }}>
            {live.ended.title.trim() || DEFAULT_ENDED_TITLE}
          </h1>
          <p className="live-desc" style={{ whiteSpace: "pre-line" }}>
            {live.ended.description.trim() || DEFAULT_ENDED_DESCRIPTION}
          </p>
        </div>

        {actionCount > 0 && (
          <div className="en-actions">
            {showReplay && (
              <div className="en-act">
                <span className="ic"><Play /></span>
                <h3>다시보기</h3>
                <p>놓친 세션이 있어도 괜찮아요. 편집본 다시보기 링크를 이메일로 보내드립니다.</p>
                <motion.button whileTap={{ scale: 0.97 }} transition={spring} onClick={onReplay} disabled={replayRequested || replayPending} className="en-btn primary">
                  {replayRequested ? "신청 완료 ✓" : replayPending ? "신청 중…" : "다시보기 신청"}
                </motion.button>
              </div>
            )}
            {surveyList.map((survey, i) => (
              /* 제목·설명은 각 설문이 들고 있는 값을 쓴다 — 두 개를 걸었을 때 카드가
                 똑같은 문구로 두 번 나오면 무엇을 누르는지 알 수 없다. 없으면 기본 문구. */
              <div className="en-act" key={survey.url || i}>
                <span className="ic"><ClipboardCheck /></span>
                <h3>{survey.title?.trim() || DEFAULT_SURVEY_TITLE}</h3>
                <p style={{ whiteSpace: "pre-line" }}>{survey.description?.trim() || DEFAULT_SURVEY_DESCRIPTION}</p>
                {/**
                  * 우리 설문(surveyId 있음)은 **팝업**으로 — 종료 화면은 여정의 끝이라 새 탭이
                  * 열리면 뒤에 있는 자료·다음 웨비나가 잊힌다. 외부 설문 URL 은 문항을 받아올 수
                  * 없고 iframe 도 상대가 막을 수 있어 새 탭이 정직하다.
                  */}
                {/* 시작 예약 전 — 버튼을 열어 두면 눌러서 "아직 열리지 않았어요" 를 보게 된다.
                    누르기 전에 **언제부터인지** 말해 주는 쪽이 낫다. 시각이 지나면 폴링이 갱신한
                    serverNowMs 로 이 분기가 스스로 풀린다. */}
                {stateOf(survey) === "before" ? (
                  <span className="en-btn soft" aria-disabled="true" style={{ opacity: 0.55, cursor: "default" }}>
                    {formatSurveyOpensAt(survey.opensAt) ? `${formatSurveyOpensAt(survey.opensAt)}부터` : "잠시 후 열려요"}
                  </span>
                ) : survey.surveyId && onOpenSurvey ? (
                  <button type="button" onClick={() => onOpenSurvey(survey)} className="en-btn soft">
                    {survey.ctaLabel?.trim() || DEFAULT_SURVEY_CTA}
                  </button>
                ) : (
                  <a href={survey.url} target="_blank" rel="noopener noreferrer" className="en-btn soft">
                    {survey.ctaLabel?.trim() || DEFAULT_SURVEY_CTA}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {showResources && (
          <div className="en-res">
            <div className="rh">받아가세요</div>
            {live.resources.map((r, i) => {
              /* 게이트 판정 — 조건 설문이 종료 화면에 실제로 걸려 있어야 풀 길이 있다.
                 빠졌으면 잠긴 채로 두고 문구로 알린다(조용히 열어 주면 조건이 거짓이 된다). */
              const gate = r.surveyId ? surveys?.find((sv) => sv.surveyId === r.surveyId) : undefined;
              const needsSurvey = Boolean(r.surveyId) && !completedSurveyIds.includes(r.surveyId);
              const locked = Boolean(r.surveyId) && (!hasRegistration || needsSurvey);
              /**
               * 잠긴 이유는 **아는 만큼만** 말한다.
               *
               * 예전엔 gate 를 못 찾으면 무조건 "조건 설문이 닫혔어요" 라고 했다. 그런데 조건 설문에
               * 시작 예약이 걸려 있으면 목록에 없어서 gate 가 비었고, 아직 열리지도 않은 설문을
               * 끝났다고 말했다 — 게다가 이 행은 눌러도 아무 일이 안 났다(gate 가 없어 분기 둘 다 안 탐).
               * 지금은 시작 전 설문도 목록에 실려 오므로 gate 를 찾고, 상태별로 말이 갈린다.
               */
              const gateState = gate ? stateOf(gate) : null;
              const gateName = gate?.title?.trim() || "설문";
              /* 종료 화면에서 !hasRegistration 은 "아직 사전등록을 안 한 방문자" 이지, 지금 등록할 수
                 있다는 뜻이 아니다 — 이 화면이 뜰 땐 등록 자체가 이미 마감된 상태다. "사전등록하면
                 받을 수 있어요" 는 열어 줄 것처럼 읽혀서 눌러보게 만들고, 눌러도 반응이 없으면
                 고장으로 보인다. 마감을 그대로 말해 클릭을 유도하지 않는다(아래 hasNextStep 도 함께). */
              const why = !hasRegistration
                ? "등록이 마감돼 배포가 끝났어요"
                : gateState === "before"
                  ? `${gateName}은 ${formatSurveyOpensAt(gate?.opensAt) || "곧"}부터 열려요`
                  : gate
                    ? `${gateName}을 완료하면 받을 수 있어요`
                    : "지금은 조건 설문이 열려 있지 않아요";
              // 다음 걸음이 실제로 있는가 — 미등록은 onRequireRegister 가 있을 때만(지금은 종료
              // 화면에서 이 게이트를 열지 않기로 했으므로 항상 없다), 조건 설문 미완료는 gate 가 있을 때만.
              const hasNextStep = hasRegistration ? Boolean(gate) : Boolean(onRequireRegister);

              const body = (
                <>
                  <span className="fi">{locked ? <Lock /> : <FileText />}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="nm" style={{ display: "block" }}>{r.title}</span>
                    {r.meta && <span className="mt">{r.meta}</span>}
                    {locked && <span className="why">{why}</span>}
                  </span>
                  {!locked && <span className="dl"><Download /></span>}
                </>
              );

              if (!locked) {
                return (
                  <a key={i} href={r.url} target="_blank" rel="noopener noreferrer">{body}</a>
                );
              }
              /* 눌렀을 때 다음 걸음으로 보낸다 — 미등록은 등록, 설문 미완료는 **그 설문을 바로 연다**.
                 안내만 띄우면 사용자가 설문을 다시 찾아 올라가야 한다. */
              return (
                <a
                  key={i}
                  className="locked"
                  role="button"
                  tabIndex={0}
                  aria-disabled="true"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!hasRegistration) onRequireRegister?.();
                    else if (gate) onOpenSurvey?.(gate);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    if (!hasRegistration) onRequireRegister?.();
                    else if (gate) onOpenSurvey?.(gate);
                  }}
                  /* 다음 걸음이 없으면(등록 마감·조건 설문 연결 빠짐) 손 커서로 클릭을 유도하지 않는다 */
                  style={hasNextStep ? undefined : { cursor: "default" }}
                >
                  {body}
                </a>
              );
            })}
          </div>
        )}

        {showNext && live.nextWebinar && (
          <div className="en-next">
            <div className="tx">
              <div className="eb">Next Webinar</div>
              <h3>{live.nextWebinar.title}</h3>
              {live.nextWebinar.when && <p>{live.nextWebinar.when}</p>}
            </div>
            {live.nextWebinar.url
              ? <a href={live.nextWebinar.url} target="_blank" rel="noopener noreferrer" className="en-btn primary">사전등록하고 알림 받기</a>
              : <span className="en-btn primary" style={{ opacity: .7 }}>준비 중</span>}
          </div>
        )}

        {showShare && (
          <div className="en-share">
            함께 들으면 좋은 동료에게 공유해요
            <button type="button" onClick={onShare} className="en-sbtn" aria-label="링크 복사"><Link2 /></button>
            {shareCopied && <span style={{ color: "var(--key)", fontWeight: 600 }}>복사됨 ✓</span>}
          </div>
        )}
        {!showShare && <div style={{ paddingBottom: 40 }} />}
      </div>
    </div>
  );
}
