"use client";

import { use, useEffect, useMemo, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { buildStkCss } from "../../LiveContentStk";
import SurveyForm, { SURVEY_FORM_CSS, clearSurveyDraft } from "../../SurveyForm";
import { formatSurveyOpensAt, type SurveyAnswers, type SurveyQuestion } from "@/lib/webinar-survey";

/**
 * 독립 설문 응답 페이지 — /webinar/[slug]/survey/[surveyId]
 * 종료 화면·이메일 링크에서 진입. 등록 브라우저면 localStorage 의 registrationId 로 응답을 연결한다.
 */
const PAGE_CSS = `
.stk-live .svp-wrap { max-width:640px; margin:0 auto; padding:40px 20px 80px; }
.stk-live .svp-kicker { font-size:12px; font-weight:750; letter-spacing:.12em; text-transform:uppercase; color:var(--key); text-align:center; margin:0 0 10px; }
.stk-live .svp-title { font-size:26px; font-weight:820; letter-spacing:-.03em; color:var(--text); text-align:center; margin:0; word-break:keep-all; }
.stk-live .svp-desc { font-size:14px; line-height:1.65; color:var(--muted); text-align:center; margin:10px 0 0; white-space:pre-wrap; word-break:keep-all; }
.stk-live .svp-card { margin-top:28px; background:var(--card); border-radius:var(--radius-lg); box-shadow:var(--card-shadow); padding:30px 26px; }
.stk-live .svp-center { min-height:60vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; color:var(--muted); text-align:center; padding:0 20px; }
.stk-live .svp-check { width:58px; height:58px; border-radius:50%; background:color-mix(in srgb,#12B76A 14%,transparent); color:#12B76A; display:grid; place-items:center; box-shadow:0 0 0 8px color-mix(in srgb,#12B76A 6%,transparent); }
.stk-live .svp-done-title { font-size:22px; font-weight:800; letter-spacing:-.02em; color:var(--text); margin:6px 0 0; }
@media (max-width:480px){ .stk-live .svp-card { padding:22px 16px; } .stk-live .svp-title { font-size:22px; } }
`;

interface PublicSurvey {
  id: string;
  title: string;
  description: string | null;
  questions: SurveyQuestion[];
  isOpen: boolean;
  /** 못 받는 이유 — "아직 시작 전" 과 "마감" 은 시청자에게 다른 말이다. */
  state?: "open" | "off" | "before" | "closed";
  /** 시작 전일 때만 온다 — 언제 다시 오면 되는지 알려주기 위한 값. */
  opensAt?: string | null;
  doneTitle?: string | null;
  doneDescription?: string | null;
}

type PageState = "loading" | "notfound" | "closed" | "before" | "form" | "done";

export default function SurveyPage({ params }: { params: Promise<{ slug: string; surveyId: string }> }) {
  const { slug, surveyId } = use(params);
  const [survey, setSurvey] = useState<PublicSurvey | null>(null);
  const [webinarName, setWebinarName] = useState("");
  const [theme, setTheme] = useState<{ accent: string; text: string; surface: string; radius?: string }>({ accent: "#6D28D9", text: "#141320", surface: "#FFFFFF" });
  const [state, setState] = useState<PageState>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  /**
   * 시작 예약 시각이 되면 **스스로 열린다**.
   *
   * "8월 11일 15:00부터 참여할 수 있어요" 를 읽은 사람이 가장 많이 있는 곳이 바로 이 페이지다.
   * 그 시각에 화면이 그대로면 안내가 거짓이 되고, 사용자는 새로고침해야 하는지 알 수 없다.
   * 서버 시각을 따로 받지 않고 opensAt 까지 남은 시간만큼 기다렸다 다시 부른다(+2초 여유 —
   * 기기 시계가 조금 빠르면 아직 before 로 돌아온다).
   */
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (state !== "before" || !survey?.opensAt) return;
    const delay = new Date(survey.opensAt).getTime() - Date.now() + 2000;
    // setTimeout 은 ~24.8일(32비트)을 넘기면 즉시 발화한다 — 먼 예약은 타이머를 걸지 않는다
    if (!Number.isFinite(delay) || delay > 24 * 3600e3) return;
    const t = setTimeout(() => setReloadKey((k) => k + 1), Math.max(delay, 1000));
    return () => clearTimeout(t);
  }, [state, survey?.opensAt]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [surveyRes, infoRes] = await Promise.all([
          fetch(`/api/webinar/${slug}/survey/${surveyId}`),
          fetch(`/api/webinar/${slug}/info`),
        ]);
        if (cancelled) return;
        if (!surveyRes.ok) { setState("notfound"); return; }
        const surveyData = await surveyRes.json();
        setSurvey(surveyData.survey);
        if (infoRes.ok) {
          const info = await infoRes.json();
          const t = (info?.webinar?.theme ?? {}) as Record<string, string>;
          setWebinarName(String(info?.webinar?.name ?? ""));
          setTheme({
            accent: t.accentColor || "#6D28D9",
            text: t.textColor || "#141320",
            surface: t.surfaceColor || "#FFFFFF",
            radius: t.borderRadius,
          });
        }
        // 시작 전은 마감과 다르게 안내한다 — 마감은 끝난 것이고, 시작 전은 다시 오면 되는 것이다
        setState(surveyData.survey?.isOpen ? "form" : surveyData.survey?.state === "before" ? "before" : "closed");
      } catch {
        if (!cancelled) setState("notfound");
      }
    })();
    return () => { cancelled = true; };
  }, [slug, surveyId, reloadKey]);

  const css = useMemo(() => buildStkCss(theme.accent, theme.text, theme.surface, theme.radius) + SURVEY_FORM_CSS + PAGE_CSS, [theme]);

  const handleSubmit = async (answers: SurveyAnswers) => {
    setSubmitting(true);
    setSubmitError("");
    try {
      // 등록 브라우저면 응답을 등록자와 연결 (라이브 페이지가 저장한 mach_reg_<slug>)
      let registrationId: string | undefined;
      try {
        const raw = localStorage.getItem(`mach_reg_${slug}`);
        if (raw) registrationId = (JSON.parse(raw) as { registrationId?: string }).registrationId;
      } catch { /* 스토리지 차단 무시 */ }
      const source = new URLSearchParams(window.location.search).get("src") === "ended" ? "ended" : "link";

      const res = await fetch(`/api/webinar/${slug}/survey/${surveyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, registrationId, source }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(data.error ?? "제출에 실패했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      clearSurveyDraft(`mach_survey_draft_page_${surveyId}`); // 제출 완료 — 임시저장 정리
      setState("done");
    } catch {
      setSubmitError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stk-live" style={{ minHeight: "100vh" }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {state === "loading" && (
        <div className="svp-center"><Loader2 className="animate-spin" style={{ width: 26, height: 26 }} /></div>
      )}

      {state === "notfound" && (
        <div className="svp-center">
          <p className="svp-done-title">설문을 찾을 수 없어요</p>
          <p style={{ margin: 0, fontSize: 14 }}>링크가 만료됐거나 잘못된 주소예요.</p>
        </div>
      )}

      {state === "closed" && (
        <div className="svp-center">
          <p className="svp-done-title">마감된 설문이에요</p>
          <p style={{ margin: 0, fontSize: 14 }}>소중한 관심 감사합니다.</p>
        </div>
      )}

      {state === "before" && (
        <div className="svp-center">
          <p className="svp-done-title">아직 응답을 받기 전이에요</p>
          <p style={{ margin: 0, fontSize: 14 }}>
            {formatSurveyOpensAt(survey?.opensAt) ? `${formatSurveyOpensAt(survey?.opensAt)}부터 참여할 수 있어요.` : "잠시 후 다시 열어주세요."}
          </p>
        </div>
      )}

      {state === "form" && survey && (
        <div className="svp-wrap">
          {webinarName && <p className="svp-kicker">{webinarName}</p>}
          <h1 className="svp-title">{survey.title}</h1>
          {survey.description && <p className="svp-desc">{survey.description}</p>}
          <div className="svp-card">
            <SurveyForm questions={survey.questions} submitting={submitting} onSubmit={handleSubmit} storageKey={`mach_survey_draft_page_${surveyId}`} />
            {submitError && <p className="sv-err" style={{ marginTop: 12 }} role="alert">{submitError}</p>}
          </div>
        </div>
      )}

      {state === "done" && (
        <div className="svp-center">
          <div className="svp-check"><Check strokeWidth={2.6} style={{ width: 28, height: 28 }} /></div>
          <p className="svp-done-title">{survey?.doneTitle?.trim() || "소중한 의견 감사합니다"}</p>
          <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>{survey?.doneDescription?.trim() || "보내주신 답변이 다음 웨비나를 더 좋게 만들어요."}</p>
        </div>
      )}
    </div>
  );
}
