"use client";

/**
 * 만족도 조사 공개 화면 — /q/{token}[?src=qr|newsletter][&preview=1]
 *
 * 참관객은 machstudio 계정이 없다. 흐름:
 *  ① 등록할 때 쓴 이메일 또는 전화 → 본인 확인(이름·유형을 불러온다)
 *  ② 그 유형의 문항만(인구통계는 등록 때 받았으니 묻지 않는다)
 *  ③ 완료 문구
 * 등록 없이 온 사람은 "사전등록 안 했어요" → 짧은 기본 문항(walk-in 섹션) + 같은 만족도 문항.
 * 모바일 한 손 조작이 기본 — 큰 터치 영역, 한 페이지 스크롤, 빠진 문항은 그 자리에서 빨갛게.
 */
import { use, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { localize } from "@/lib/collect-form-config";
import { validateSurveyAnswers, visibleSections, type SurveyAnswerMap, type SurveyConfig, type SurveyQuestion } from "@/lib/survey-config";

type PublicConfig = Pick<SurveyConfig,
  "title" | "intro" | "identifyFields" | "audienceFieldKey" | "audienceLabels" | "allowWalkIn" | "walkIn" | "sections" | "completion" | "privacyNote" | "accentColor" | "defaultLocale"
> & { defaultCountry: string };

const UI = {
  en: {
    idLabel: "Email or phone number you used to register",
    idPlaceholder: "you@example.com or phone",
    continue: "Continue",
    notFound: "We couldn't find a registration with that. Please check and try again.",
    walkIn: "I didn't register in advance",
    hi: (n: string) => (n ? `Hi, ${n}!` : "Welcome!"),
    already: "You've already responded — you can update your answers below.",
    required: "Required",
    other: "Other",
    otherPlaceholder: "Please specify",
    na: "N/A",
    submit: "Submit",
    missing: "Please answer the highlighted questions.",
    preview: "Preview — answers are not saved.",
    closed: "This survey is closed. Thank you!",
    notFoundSurvey: "Survey not found.",
    back: "Back",
    error: "Something went wrong. Please try again.",
  },
  ko: {
    idLabel: "사전등록할 때 쓴 이메일 또는 전화번호",
    idPlaceholder: "이메일 또는 전화번호",
    continue: "다음",
    notFound: "등록 정보를 찾지 못했어요. 다시 확인해 주세요.",
    walkIn: "사전등록을 하지 않았어요",
    hi: (n: string) => (n ? `${n}님, 반가워요!` : "반가워요!"),
    already: "이미 응답하셨어요 — 아래에서 답을 고칠 수 있어요.",
    required: "필수",
    other: "기타",
    otherPlaceholder: "직접 입력",
    na: "해당 없음",
    submit: "제출",
    missing: "표시된 문항에 답해 주세요.",
    preview: "미리보기 — 응답은 저장되지 않아요.",
    closed: "조사가 마감되었어요. 감사합니다!",
    notFoundSurvey: "조사를 찾을 수 없어요.",
    back: "뒤로",
    error: "문제가 생겼어요. 다시 시도해 주세요.",
  },
} as const;

type Step = "identify" | "survey" | "done";

export default function SurveyPageClient({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<{ status: string; config: PublicConfig } | null | "missing">(null);
  const [step, setStep] = useState<Step>("identify");
  const [idValue, setIdValue] = useState("");
  const [idError, setIdError] = useState("");
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState<{ name: string; audience: string; answered: boolean; ticket: string } | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [answers, setAnswers] = useState<SurveyAnswerMap>({});
  const [others, setOthers] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Set<string>>(new Set());
  const [submitError, setSubmitError] = useState("");
  const query = useRef<URLSearchParams | null>(null);
  const [previewParam, setPreviewParam] = useState(false);

  useEffect(() => {
    query.current = new URLSearchParams(window.location.search);
    const preview = query.current.get("preview") === "1";
    void fetch(`/api/q/${token}${preview ? "?preview=1" : ""}`, { cache: "no-store" })
      .then(async (res) => {
        setPreviewParam(preview);
        setState(res.ok ? await res.json() : "missing");
      })
      .catch(() => setState("missing"));
  }, [token]);

  const config = state && state !== "missing" ? state.config : null;
  const locale = config?.defaultLocale === "ko" ? "ko" : "en";
  const t = UI[locale];
  const L = (v: Record<string, string> | undefined) => (config ? localize(v ?? {}, config.defaultLocale) : "");
  const accent = config?.accentColor ?? "#7C3AED";

  // "기타" 를 고른 문항은 직접 입력한 글이 답이 된다.
  const merged = useMemo(() => {
    const out: SurveyAnswerMap = { ...answers };
    for (const [key, text] of Object.entries(others)) {
      const v = out[key];
      if (v === "__other__") out[key] = text.trim();
      else if (Array.isArray(v) && v.includes("__other__")) out[key] = [...v.filter((x) => x !== "__other__"), ...(text.trim() ? [text.trim()] : [])];
    }
    return out;
  }, [answers, others]);

  const audience = walkIn ? (config?.audienceFieldKey ? String(merged[config.audienceFieldKey] ?? "") : "") : person?.audience ?? "";
  const sections = config ? visibleSections(config as SurveyConfig, audience, merged, walkIn) : [];

  if (state === null) return <Shell><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div></Shell>;
  if (state === "missing" || !config) return <Shell><p className="py-24 text-center text-sm text-neutral-500">{UI.en.notFoundSurvey}</p></Shell>;
  if (state.status === "closed") return <Shell><Header title={L(config.title)} accent={accent} /><p className="px-5 py-12 text-center text-base text-neutral-700">{t.closed}</p></Shell>;
  // 운영자 미리보기(?preview=1)는 조사가 열려 있어도 저장하지 않는다 — 설계 화면 옆 미리보기에서 눌러 본 답이 결과에 섞이면 안 된다.
  const isPreview = state.status !== "open" || previewParam;

  const identify = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = idValue.trim();
    if (!v) return;
    setBusy(true);
    setIdError("");
    try {
      const body = v.includes("@") ? { email: v } : { phone: v, phoneCountry: config.defaultCountry };
      const res = await fetch(`/api/q/${token}/identify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setIdError(data.error ?? t.error); return; }
      if (!data.found) { setIdError(t.notFound); return; }
      setPerson({ name: data.name, audience: data.audience, answered: data.answered, ticket: data.ticket });
      if (data.previous && typeof data.previous === "object") setAnswers(data.previous as SurveyAnswerMap);
      setWalkIn(false);
      setStep("survey");
      window.scrollTo({ top: 0 });
    } catch {
      setIdError(t.error);
    } finally {
      setBusy(false);
    }
  };

  const set = (key: string, value: SurveyAnswerMap[string]) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setIssues((s) => { if (!s.has(key)) return s; const n = new Set(s); n.delete(key); return n; });
  };

  const submit = async () => {
    setSubmitError("");
    const check = validateSurveyAnswers(config as SurveyConfig, audience, merged, walkIn);
    if (!check.ok) {
      setIssues(new Set(check.issues.map((i) => i.key)));
      setSubmitError(t.missing);
      document.getElementById(`q-${check.issues[0].key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (isPreview) { setStep("done"); window.scrollTo({ top: 0 }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/q/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: person?.ticket, walkIn, answers: check.answers, channel: query.current?.get("src") ?? "", locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.expired) { setStep("identify"); setIdError(data.error); return; }
        if (Array.isArray(data.issues)) setIssues(new Set(data.issues.map((i: { key: string }) => i.key)));
        setSubmitError(data.error ?? t.error);
        return;
      }
      setStep("done");
      window.scrollTo({ top: 0 });
    } catch {
      setSubmitError(t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell style={{ ["--acc" as string]: accent }}>
      <Header title={L(config.title)} accent={accent} />
      {isPreview && <p className="bg-amber-100 px-5 py-2 text-center text-xs font-medium text-amber-800">{t.preview}</p>}

      {step === "identify" && (
        <form onSubmit={identify} className="space-y-5 px-5 py-6">
          {L(config.intro) && <p className="whitespace-pre-line text-[15px] leading-relaxed text-neutral-700">{L(config.intro)}</p>}
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-neutral-900">{t.idLabel}</span>
            <input value={idValue} onChange={(e) => setIdValue(e.target.value)} autoComplete="email" inputMode="email" placeholder={t.idPlaceholder}
              className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-base outline-none focus:border-[var(--acc)] focus:ring-2 focus:ring-[var(--acc)]/20" />
          </label>
          {idError && <p className="text-sm text-red-600">{idError}</p>}
          <button type="submit" disabled={busy || !idValue.trim()}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-[var(--acc)] text-base font-semibold text-white transition active:scale-[0.99] disabled:opacity-50">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : t.continue}
          </button>
          {config.allowWalkIn && (
            <button type="button" onClick={() => { setWalkIn(true); setPerson(null); setStep("survey"); window.scrollTo({ top: 0 }); }}
              className="w-full py-2 text-center text-sm text-neutral-500 underline underline-offset-4">
              {t.walkIn}
            </button>
          )}
          {L(config.privacyNote) && <p className="whitespace-pre-line text-xs leading-relaxed text-neutral-400">{L(config.privacyNote)}</p>}
        </form>
      )}

      {step === "survey" && (
        <div className="space-y-8 px-5 py-6">
          {person && (
            <div className="space-y-1">
              <p className="text-lg font-semibold text-neutral-900">{t.hi(person.name)}</p>
              {person.answered && <p className="text-sm text-neutral-500">{t.already}</p>}
            </div>
          )}
          {sections.map((section) => (
            <section key={section.id} className="space-y-6">
              {(L(section.title) || L(section.description)) && (
                <div className="border-b border-neutral-200 pb-2">
                  {L(section.title) && <h2 className="text-base font-bold text-neutral-900">{L(section.title)}</h2>}
                  {L(section.description) && <p className="mt-1 whitespace-pre-line text-sm text-neutral-500">{L(section.description)}</p>}
                </div>
              )}
              {section.questions.map((q) => (
                <Question key={q.key} q={q} L={L} t={t} value={answers[q.key]} other={others[q.key] ?? ""} invalid={issues.has(q.key)}
                  onChange={(v) => set(q.key, v)} onOther={(text) => setOthers((o) => ({ ...o, [q.key]: text }))} />
              ))}
            </section>
          ))}
          {submitError && <p className="text-sm font-medium text-red-600">{submitError}</p>}
          <div className="flex gap-2 pb-8">
            <button type="button" onClick={() => setStep("identify")} className="h-12 rounded-xl border border-neutral-300 px-5 text-sm text-neutral-600">{t.back}</button>
            <button type="button" onClick={() => void submit()} disabled={busy}
              className="flex h-12 flex-1 items-center justify-center rounded-xl bg-[var(--acc)] text-base font-semibold text-white transition active:scale-[0.99] disabled:opacity-50">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : t.submit}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4 px-6 py-16 text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-[var(--acc)]" />
          <h2 className="text-xl font-bold text-neutral-900">{L(config.completion.title)}</h2>
          {L(config.completion.body) && <p className="whitespace-pre-line text-[15px] leading-relaxed text-neutral-600">{L(config.completion.body)}</p>}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <main className="min-h-screen bg-neutral-100" style={style}>
      <div className="mx-auto min-h-screen max-w-xl bg-white shadow-sm">{children}</div>
    </main>
  );
}

function Header({ title, accent }: { title: string; accent: string }) {
  return (
    <header className="px-5 pb-5 pt-8 text-white" style={{ background: accent }}>
      <h1 className="text-xl font-bold leading-snug">{title}</h1>
    </header>
  );
}

type Dict = (typeof UI)["en"] | (typeof UI)["ko"];

function Question({ q, L, t, value, other, invalid, onChange, onOther }: {
  q: SurveyQuestion;
  L: (v: Record<string, string> | undefined) => string;
  t: Dict;
  value: SurveyAnswerMap[string];
  other: string;
  invalid: boolean;
  onChange: (v: SurveyAnswerMap[string]) => void;
  onOther: (text: string) => void;
}) {
  const options = q.options.map((o) => L(o));
  const pill = (active: boolean) =>
    `flex min-h-[44px] w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-[15px] transition active:scale-[0.99] ${
      active ? "border-[var(--acc)] bg-[var(--acc)]/10 font-medium text-neutral-900" : "border-neutral-200 bg-white text-neutral-700"
    }`;
  const dot = (active: boolean, square = false) => (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 ${square ? "rounded-md" : "rounded-full"} ${active ? "border-[var(--acc)] bg-[var(--acc)]" : "border-neutral-300"}`}>
      {active && <span className={`${square ? "h-2 w-2 rounded-sm" : "h-2 w-2 rounded-full"} bg-white`} />}
    </span>
  );
  const scaleBtn = (n: number | "na", active: boolean, onClick: () => void, label?: string) => (
    <button key={String(n)} type="button" onClick={onClick}
      className={`flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg border text-sm font-semibold transition active:scale-95 ${
        active ? "border-[var(--acc)] bg-[var(--acc)] text-white" : "border-neutral-200 bg-white text-neutral-700"
      }`}>
      {label ?? n}
    </button>
  );

  return (
    <div id={`q-${q.key}`} className={`space-y-3 rounded-2xl ${invalid ? "-mx-3 bg-red-50 px-3 py-3 ring-1 ring-red-300" : ""}`}>
      <div>
        <p className="text-[15px] font-semibold leading-snug text-neutral-900">
          {L(q.title)}{q.required && <span className="ml-1 text-red-500">*</span>}
        </p>
        {L(q.description) && <p className="mt-1 whitespace-pre-line text-sm text-neutral-500">{L(q.description)}</p>}
      </div>

      {q.type === "single" && (
        <div className="space-y-2">
          {options.map((o) => (
            <button key={o} type="button" onClick={() => onChange(o)} className={pill(value === o)}>{dot(value === o)}{o}</button>
          ))}
          {q.allowOther && (
            <>
              <button type="button" onClick={() => onChange("__other__")} className={pill(value === "__other__")}>{dot(value === "__other__")}{t.other}</button>
              {value === "__other__" && <input value={other} onChange={(e) => onOther(e.target.value)} placeholder={t.otherPlaceholder} className="h-11 w-full rounded-xl border border-neutral-300 px-4 text-[15px] outline-none focus:border-[var(--acc)]" />}
            </>
          )}
        </div>
      )}

      {q.type === "multiple" && (() => {
        const arr = Array.isArray(value) ? value : [];
        const toggle = (o: string) => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
        return (
          <div className="space-y-2">
            {options.map((o) => (
              <button key={o} type="button" onClick={() => toggle(o)} className={pill(arr.includes(o))}>{dot(arr.includes(o), true)}{o}</button>
            ))}
            {q.allowOther && (
              <>
                <button type="button" onClick={() => toggle("__other__")} className={pill(arr.includes("__other__"))}>{dot(arr.includes("__other__"), true)}{t.other}</button>
                {arr.includes("__other__") && <input value={other} onChange={(e) => onOther(e.target.value)} placeholder={t.otherPlaceholder} className="h-11 w-full rounded-xl border border-neutral-300 px-4 text-[15px] outline-none focus:border-[var(--acc)]" />}
              </>
            )}
          </div>
        );
      })()}

      {(q.type === "scale" || q.type === "nps") && (() => {
        const [min, max] = q.type === "nps" ? [0, 10] : [1, q.scaleMax];
        const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
        return (
          <div className="space-y-1.5">
            <div className={`flex gap-1 ${q.type === "nps" ? "gap-0.5" : "gap-1.5"}`}>
              {nums.map((n) => scaleBtn(n, value === n, () => onChange(n)))}
            </div>
            {(L(q.minLabel) || L(q.maxLabel)) && (
              <div className="flex justify-between gap-4 text-xs text-neutral-500">
                <span>{L(q.minLabel)}</span><span className="text-right">{L(q.maxLabel)}</span>
              </div>
            )}
          </div>
        );
      })()}

      {q.type === "grid" && (() => {
        const obj = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, string | number>;
        const setCell = (i: number, v: number | "na") => onChange({ ...obj, [String(i)]: v });
        return (
          <div className="space-y-3">
            <div className="flex justify-between text-[11px] text-neutral-400"><span>1 = {L(q.minLabel) || "Very poor"}</span><span>5 = {L(q.maxLabel) || "Excellent"}</span></div>
            {q.rows.map((row, i) => (
              <div key={i} className="space-y-1.5 rounded-xl border border-neutral-200 p-3">
                <p className="text-sm font-medium text-neutral-800">{L(row)}</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => scaleBtn(n, obj[String(i)] === n, () => setCell(i, n)))}
                  {q.naOption && scaleBtn("na", obj[String(i)] === "na", () => setCell(i, "na"), t.na)}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {q.type === "short" && (
        <input value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} maxLength={300}
          className="h-12 w-full rounded-xl border border-neutral-300 px-4 text-base outline-none focus:border-[var(--acc)]" />
      )}
      {q.type === "long" && (
        <textarea value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={3000}
          className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base outline-none focus:border-[var(--acc)]" />
      )}

      {invalid && <p className="text-xs font-medium text-red-600">{t.required}</p>}
    </div>
  );
}
