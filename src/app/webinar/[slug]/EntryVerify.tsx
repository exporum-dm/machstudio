"use client";

import { motion } from "framer-motion";
import { ArrowRight, Lock } from "lucide-react";
import PreLiveWaiting from "./PreLiveWaiting";
import type { LivePageConfig } from "@/lib/webinar-config";

/**
 * 입장 확인은 대기 화면과 같은 히어로·아젠다·안내를 사용한다.
 * 입장 오픈 시간에는 카운트다운 아래에서 미리 확인할 수 있고, 라이브가 시작되면
 * 동일한 자리에 인증 카드가 올라와 다음 행동이 분명해진다.
 */
const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

const EXTRA_CSS = `
.stk-live .ev-card { width:100%; background:var(--card); border-radius:var(--radius-lg); box-shadow:var(--card-shadow); padding:28px; text-align:center; }
.stk-live .ev-now { display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:650; color:#12B76A; background:color-mix(in srgb,#12B76A 13%,transparent); padding:6px 13px; border-radius:999px; margin-bottom:18px; }
.stk-live .ev-now .d { width:7px; height:7px; border-radius:50%; background:currentColor; animation:evBreathe 2.2s ease-in-out infinite; }
@keyframes evBreathe { 0%,100%{ opacity:1; } 55%{ opacity:.5; } }
.stk-live .ev-now b { font-variant-numeric:tabular-nums; margin:0 1px; }
.stk-live .ev-title { font-size:23px; font-weight:820; letter-spacing:-.03em; color:var(--text); margin:0; }
.stk-live .ev-sub { margin:9px 0 24px; font-size:14px; line-height:1.6; color:var(--muted); word-break:keep-all; }
.stk-live .ev-seg { position:relative; display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:4px; border-radius:var(--radius-sm); background:color-mix(in srgb,var(--text) 5%,transparent); margin-bottom:12px; }
.stk-live .ev-seg-btn { position:relative; z-index:1; padding:11px 0; border:0; background:transparent; border-radius:calc(9px * var(--r-scale, 1)); font:inherit; font-size:13.5px; font-weight:700; color:var(--muted); cursor:pointer; transition:color .2s ease; }
.stk-live .ev-seg-btn.on { color:#fff; }
.stk-live .ev-knob { position:absolute; inset:4px auto 4px 4px; width:calc(50% - 4px); background:var(--key); border-radius:calc(9px * var(--r-scale, 1)); box-shadow:var(--btn-shadow-key); z-index:0; transition:transform .28s cubic-bezier(.32,.72,0,1); }
.stk-live .ev-knob.email { transform:translateX(100%); }
.stk-live .ev-input { width:100%; height:50px; padding:0 16px; border:1.5px solid var(--line-md); border-radius:var(--radius-sm); background:var(--card-2); color:var(--text); font:inherit; font-size:15px; outline:none; text-align:center; transition:border-color .18s ease, box-shadow .18s ease; }
.stk-live .ev-input:focus { border-color:var(--key); box-shadow:0 0 0 4px var(--key-dim); }
.stk-live .ev-err { font-size:12.5px; color:#ef4444; margin:8px 0 0; }
.stk-live .ev-primary { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; height:52px; margin-top:14px; border:0; border-radius:var(--radius-sm); background:var(--key); color:#fff; font:inherit; font-size:15px; font-weight:800; cursor:pointer; box-shadow:var(--btn-shadow-key); transition:transform .16s ease, box-shadow .16s ease; }
.stk-live .ev-primary:hover:not(:disabled) { transform:translateY(-2px); }
.stk-live .ev-primary:disabled { opacity:.55; cursor:not-allowed; }
.stk-live .ev-primary svg { width:18px; height:18px; }
.stk-live .ev-trust { display:flex; align-items:center; justify-content:center; gap:7px; margin-top:18px; font-size:12px; color:var(--sub); }
.stk-live .ev-trust svg { width:13px; height:13px; }
.stk-live .ev-ghost { display:block; width:100%; margin-top:6px; padding:10px; border:0; background:transparent; color:var(--muted); font:inherit; font-size:13px; font-weight:600; cursor:pointer; }
.stk-live .ev-ghost b { color:var(--key); }
`;

interface Session {
  id: string;
  number: number;
  type?: string;
  title: string;
  speaker: string | null;
  speakerPhotoUrl?: string | null;
  logoUrl?: string | null;
  description?: string | null;
  startTime: string;
  endTime: string;
}

interface EntryVerifyProps {
  webinar: { name: string; description: string | null; liveStartAt: string; sessions: Session[] };
  accent: string;
  text: string;
  surface: string;
  /** 테마의 테두리 둥글기 — 없으면 디자인 기본값 */
  borderRadius?: string;
  targetIso: string;
  serverNowMs?: number;
  isLive: boolean;
  authMethod: "phone" | "email";
  authValue: string;
  verifyError: string;
  isVerifying: boolean;
  onAuthMethod: (m: "phone" | "email") => void;
  onAuthValueChange: (v: string) => void;
  onVerify: () => void;
  onGoSignup: () => void;
  /** 지금 사전등록을 받는가 — 마감됐으면 등록 안내를 띄우지 않는다(막힌 문을 열어주지 않는다) */
  canRegister?: boolean;
  live: LivePageConfig;
  viewerCount?: number;
  hasCalendar?: boolean;
  onCalendar?: () => void;
  onShare?: () => void;
  shareCopied?: boolean;
  onNotify?: () => void;
  notify?: { subscribed: boolean; pending: boolean; error: string };
}

export default function EntryVerify({
  webinar, accent, text, surface, borderRadius, targetIso, serverNowMs, isLive,
  authMethod, authValue, verifyError, isVerifying,
  onAuthMethod, onAuthValueChange, onVerify, onGoSignup, canRegister = true,
  live, viewerCount, hasCalendar, onCalendar, onShare, shareCopied, onNotify, notify,
}: EntryVerifyProps) {
  const showViewers = live.entry.viewerCount && (viewerCount ?? 0) > 0;
  const entryCard = (
    <div className="ev-card">
      {showViewers && (
        <span className="ev-now"><span className="d" />지금 <b>{(viewerCount ?? 0).toLocaleString()}명</b>이 함께 보고 있어요</span>
      )}
      <h2 className="ev-title">웨비나에 입장하기</h2>
      <p className="ev-sub">사전등록한 전화번호 또는 이메일만 입력하면<br />바로 시청 화면으로 이동해요.</p>

      <div className="ev-seg">
        <span className={`ev-knob ${authMethod === "email" ? "email" : ""}`} />
        {(["phone", "email"] as const).map((method) => (
          <button key={method} type="button" onClick={() => onAuthMethod(method)} className={`ev-seg-btn ${authMethod === method ? "on" : ""}`}>
            {method === "phone" ? "전화번호" : "이메일"}
          </button>
        ))}
      </div>

      <input type={authMethod === "phone" ? "tel" : "email"} inputMode={authMethod === "phone" ? "numeric" : undefined} value={authValue}
        onChange={(e) => onAuthValueChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onVerify(); }}
        placeholder={authMethod === "phone" ? "01012345678" : "name@company.com"} className="ev-input"
        aria-label={authMethod === "phone" ? "전화번호" : "이메일"} />
      {verifyError && <p className="ev-err">{verifyError}</p>}

      <motion.button whileTap={{ scale: 0.97 }} transition={spring} onClick={onVerify} disabled={isVerifying} className="ev-primary">
        {isVerifying ? "확인 중…" : <>웨비나 입장하기 <ArrowRight /></>}
      </motion.button>
      <div className="ev-trust"><Lock /> 등록 정보 확인용으로만 쓰이고 저장되지 않아요</div>
      {canRegister && (
        <button type="button" onClick={onGoSignup} className="ev-ghost">아직 등록 전이신가요? <b>사전등록하기 →</b></button>
      )}
    </div>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: EXTRA_CSS }} />
      <PreLiveWaiting
        webinar={webinar}
        accent={accent}
        text={text}
        surface={surface}
        borderRadius={borderRadius}
        targetIso={targetIso}
        serverNowMs={serverNowMs}
        live={live}
        hasCalendar={hasCalendar}
        onCalendar={onCalendar}
        onShare={onShare}
        shareCopied={shareCopied}
        onNotify={onNotify}
        notify={notify}
        centerAction={entryCard}
        replaceCountdown={isLive}
      />
    </>
  );
}
