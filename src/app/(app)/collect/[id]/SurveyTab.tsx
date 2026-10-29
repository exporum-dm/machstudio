"use client";

/**
 * 만족도 조사 탭 — 사전등록 폼에 붙는 조사(2026-10-20).
 *
 *  설계 : 섹션(대상 유형) · 문항을 표에서 바로 고친다(자동 저장) + 옆에 실제 화면 미리보기.
 *  배포 : 공개 주소 /q/{token} — QR(PNG·SVG)·뉴스레터 링크(?src= 로 경로 구분). 인쇄된 QR 이 가리키므로 주소는 그대로 둔다.
 *  결과 : 문항별 평균·NPS·분포·의견, 등록 정보(유형·성별·연령…)로 나눠 보기, 엑셀(등록 정보 열 포함).
 *
 * 인구통계는 사전등록이 이미 받았다 — 조사에는 만족도 문항만 넣으면 된다(결과에서 등록 정보로 나눠 본다).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, Download,
  ExternalLink, Lightbulb, Loader2, PenLine, Plus, QrCode, RefreshCw, Sparkles, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { useAutosave } from "@/components/ui/use-autosave";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { getPublicAppOrigin } from "@/lib/app-url";
import { downloadQr } from "@/lib/qr-download";
import type { Insight } from "@/lib/registration-analysis";
import {
  SURVEY_QUESTION_TYPES, SURVEY_QUESTION_TYPE_LABEL,
  type QuestionSummary, type SurveyConfig, type SurveyQuestion, type SurveyQuestionType, type SurveySection,
} from "@/lib/survey-config";

function InsightRow({ i }: { i: Insight }) {
  const Icon = i.tone === "good" ? CheckCircle2 : i.tone === "warn" ? AlertTriangle : Lightbulb;
  const color = i.tone === "good" ? "text-emerald-600 dark:text-emerald-400" : i.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-violet-600 dark:text-violet-300";
  return (
    <li className="flex gap-3 py-2.5">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug">{i.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{i.detail}</p>
      </div>
    </li>
  );
}

interface SurveyListItem { id: string; name: string; token: string; status: string; responses: number }
/** 등록 폼 항목 — 연결 문항이 질문·선택지를 그대로 가져온다 */
interface RegField { key: string; label: string; type: string; group: string; options: number; required: boolean }
type View = "design" | "share" | "results";
const STATUS: Array<[string, string]> = [["draft", "작성 중"], ["open", "진행 중"], ["closed", "마감"]];

export default function SurveyTab({ sourceId }: { sourceId: string }) {
  const [list, setList] = useState<SurveyListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(async () => {
    const res = await fetch(`/api/collect-sources/${sourceId}/surveys`);
    const data = await res.json().catch(() => ({}));
    const surveys: SurveyListItem[] = res.ok ? data.surveys ?? [] : [];
    setList(surveys);
    setSelectedId((cur) => cur ?? surveys[0]?.id ?? null);
  }, [sourceId]);
  useEffect(() => { void Promise.resolve().then(loadList); }, [loadList]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}/surveys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "만들지 못했어요"); return; }
      setList((l) => [...(l ?? []), data.survey]);
      setSelectedId(data.survey.id);
    } finally {
      setCreating(false);
    }
  };

  if (list === null) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <BarChart3 className="h-8 w-8 text-violet-500" />
        <div>
          <p className="text-sm font-semibold">만족도 조사를 만들어 보세요</p>
          <p className="mt-1 text-xs text-muted-foreground">참관객은 등록할 때 쓴 이메일·전화만 넣으면 만족도 문항만 답해요. 인구통계는 등록 정보로 이어져요.</p>
        </div>
        <button onClick={() => void create()} disabled={creating} className={`flex items-center gap-1 bg-violet-500 px-4 py-2 text-xs font-medium text-white hover:bg-violet-600 ${R.control}`}>
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}만족도 조사 만들기
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {list.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {list.map((s) => (
            <button key={s.id} onClick={() => setSelectedId(s.id)}
              className={`px-3 py-1.5 text-xs ${R.control} ${selectedId === s.id ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}>{s.name}</button>
          ))}
          <button onClick={() => void create()} className={`flex items-center gap-1 bg-secondary px-3 py-1.5 text-xs text-muted-foreground ${R.control}`}><Plus className="h-3 w-3" />새 조사</button>
        </div>
      )}
      {selectedId && <SurveyEditor key={selectedId} surveyId={selectedId} onListChange={(patch) => setList((l) => (l ?? []).map((s) => (s.id === selectedId ? { ...s, ...patch } : s)))} onCreate={list.length === 1 ? () => void create() : undefined} />}
    </div>
  );
}

function SurveyEditor({ surveyId, onListChange, onCreate }: { surveyId: string; onListChange: (p: Partial<SurveyListItem>) => void; onCreate?: () => void }) {
  const [meta, setMeta] = useState<{ name: string; token: string; status: string } | null>(null);
  const [config, setConfig] = useState<SurveyConfig | null>(null);
  const [regFields, setRegFields] = useState<RegField[]>([]);
  const [view, setView] = useState<View>("design");
  const [previewKey, setPreviewKey] = useState(0);
  const origin = getPublicAppOrigin();

  useEffect(() => {
    void fetch(`/api/surveys/${surveyId}`).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "조사를 불러오지 못했어요"); return; }
      setMeta({ name: data.survey.name, token: data.survey.token, status: data.survey.status });
      setConfig(data.survey.config);
      setRegFields(data.registrationFields ?? []);
    });
  }, [surveyId]);

  const patchMeta = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/surveys/${surveyId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "저장하지 못했어요"); return false; }
    setMeta({ name: data.survey.name, token: data.survey.token, status: data.survey.status });
    onListChange({ name: data.survey.name, token: data.survey.token, status: data.survey.status });
    return true;
  };

  const saveConfig = useCallback(async (c: SurveyConfig | null) => {
    if (!c) return true;
    const res = await fetch(`/api/surveys/${surveyId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: c }) });
    if (res.ok) setPreviewKey((k) => k + 1);
    return res.ok;
  }, [surveyId]);
  const autosave = useAutosave(config, saveConfig, 900);

  if (!meta || !config) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const link = `${origin}/q/${meta.token}`;

  return (
    <div className="space-y-4">
      {/* 머리 */}
      <div className={`flex flex-wrap items-center justify-between gap-3 bg-background p-3 ${R.panel} ${FINISH.s1}`}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <input key={meta.name} defaultValue={meta.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== meta.name) void patchMeta({ name: v }); }}
            className={`${FIELD_CLS} h-8 min-w-[200px] flex-1 text-sm font-semibold`} aria-label="조사 이름" />
          <div className="flex gap-0.5">
            {STATUS.map(([v, label]) => (
              <button key={v} onClick={() => void patchMeta({ status: v })}
                className={`px-2.5 py-1.5 text-xs ${R.control} ${meta.status === v ? (v === "open" ? "bg-emerald-500 text-white" : v === "closed" ? "bg-neutral-500 text-white" : "bg-foreground text-background") : "bg-secondary text-muted-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AutosaveIndicator state={autosave.state} />
          <a href={`${link}?preview=1`} target="_blank" rel="noreferrer" className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-xs ${R.control}`}><ExternalLink className="h-3 w-3" />미리보기</a>
          {onCreate && <button onClick={onCreate} className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground ${R.control}`}><Plus className="h-3 w-3" />조사 추가</button>}
        </div>
      </div>
      {meta.status !== "open" && (
        <p className={`bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 ${R.control}`}>
          {meta.status === "draft" ? "작성 중이에요 — 참관객은 아직 열 수 없고 미리보기만 돼요. 준비되면 \"진행 중\"으로 바꿔 주세요." : "마감했어요 — 참관객에게는 마감 안내만 보여요."}
        </p>
      )}

      <div className="flex gap-1 border-b border-border">
        {([["design", "설계", PenLine], ["share", "배포 · QR", QrCode], ["results", "결과", BarChart3]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setView(id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${view === id ? "border-violet-500 text-violet-600 dark:text-violet-400" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {view === "design" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <DesignView config={config} onChange={setConfig} regFields={regFields} />
          <div className="hidden xl:block">
            <div className={`sticky top-4 overflow-hidden bg-background ${R.panel} ${FINISH.s1}`}>
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
                <span>참관객 화면 미리보기</span>
                <button onClick={() => setPreviewKey((k) => k + 1)} className="rounded p-1 hover:bg-secondary" aria-label="새로고침"><RefreshCw className="h-3 w-3" /></button>
              </div>
              <iframe key={previewKey} src={`/q/${meta.token}?preview=1`} title="미리보기" className="h-[720px] w-full bg-white" />
            </div>
          </div>
        </div>
      )}
      {view === "share" && <ShareView link={link} token={meta.token} name={meta.name} onToken={(t) => patchMeta({ token: t })} />}
      {view === "results" && <ResultsView surveyId={surveyId} config={config} />}
    </div>
  );
}

// ── 설계 ──────────────────────────────────────────────────────────────

const loc = (v: Record<string, string> | undefined, l: string) => v?.[l] ?? Object.values(v ?? {})[0] ?? "";
let qseq = 0;

function DesignView({ config, onChange, regFields }: { config: SurveyConfig; onChange: (c: SurveyConfig) => void; regFields: RegField[] }) {
  const l = config.defaultLocale;
  const set = (patch: Partial<SurveyConfig>) => onChange({ ...config, ...patch });
  const setSection = (i: number, s: SurveySection) => set({ sections: config.sections.map((x, j) => (j === i ? s : x)) });
  const allQuestions = [...config.walkIn.questions, ...config.sections.flatMap((s) => s.questions)];
  const audiences = useMemo(() => Object.keys(config.audienceLabels).length ? Object.keys(config.audienceLabels) : [], [config.audienceLabels]);

  return (
    <div className="space-y-4">
      <div className={`space-y-3 bg-background p-4 ${R.panel} ${FINISH.s1}`}>
        <h3 className="text-sm font-semibold">기본</h3>
        <Field label="화면 제목"><input value={loc(config.title, l)} onChange={(e) => set({ title: { ...config.title, [l]: e.target.value } })} className={`${FIELD_CLS} h-8 text-sm`} /></Field>
        <Field label="첫 화면 안내"><AutoArea value={loc(config.intro, l)} onChange={(v) => set({ intro: { ...config.intro, [l]: v } })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="완료 화면 제목"><input value={loc(config.completion.title, l)} onChange={(e) => set({ completion: { ...config.completion, title: { ...config.completion.title, [l]: e.target.value } } })} className={`${FIELD_CLS} h-8 text-sm`} /></Field>
          <Field label="포인트 색"><input type="color" value={config.accentColor} onChange={(e) => set({ accentColor: e.target.value })} className="h-8 w-16 cursor-pointer rounded border border-border" /></Field>
        </div>
        <Field label="완료 화면 안내 문구"><AutoArea value={loc(config.completion.body, l)} onChange={(v) => set({ completion: { ...config.completion, body: { ...config.completion.body, [l]: v } } })} /></Field>
        <Field label="개인정보 안내(첫 화면 아래 작게)"><AutoArea value={loc(config.privacyNote, l)} onChange={(v) => set({ privacyNote: { ...config.privacyNote, [l]: v } })} /></Field>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="text-muted-foreground">본인 확인</span>
          {(["email", "phone"] as const).map((f) => (
            <label key={f} className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-violet-500" checked={config.identifyFields.includes(f)}
                onChange={(e) => set({ identifyFields: e.target.checked ? [...new Set([...config.identifyFields, f])] : config.identifyFields.filter((x) => x !== f) })} />
              {f === "email" ? "이메일" : "전화번호"}
            </label>
          ))}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-violet-500" checked={config.allowWalkIn} onChange={(e) => set({ allowWalkIn: e.target.checked })} />
            사전등록 안 한 사람도 참여(아래 &ldquo;등록 없이 참여&rdquo; 문항을 먼저 물어요)
          </label>
        </div>
        {audiences.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">유형 이름(등록 폼 &ldquo;{config.audienceFieldKey}&rdquo; 값)</span>
            {audiences.map((a) => (
              <label key={a} className="flex items-center gap-1">
                <span className="text-muted-foreground">{a} →</span>
                <input value={config.audienceLabels[a] ?? ""} onChange={(e) => set({ audienceLabels: { ...config.audienceLabels, [a]: e.target.value } })} className={`${FIELD_CLS} h-7 w-28 text-xs`} />
              </label>
            ))}
          </div>
        )}
      </div>

      {config.allowWalkIn && (
        <SectionCard
          title="등록 없이 참여한 사람에게만"
          hint="사전등록 정보가 없으니 등록 폼의 인구통계 문항을 여기서 받아요. ‘등록 폼 항목 연결’로 넣으면 질문·선택지가 등록 폼과 똑같고(등록 폼을 고치면 같이 바뀌어요), 결과에서 등록자와 한 열로 합쳐 봐요."
          section={config.walkIn} locale={l} audiences={audiences} allQuestions={allQuestions} fixed
          regFields={regFields} audienceKey={config.audienceFieldKey}
          onChange={(s) => set({ walkIn: s })}
        />
      )}
      {config.sections.map((s, i) => (
        <SectionCard key={s.id} section={s} locale={l} audiences={audiences} allQuestions={allQuestions}
          onChange={(next) => setSection(i, next)}
          onRemove={() => set({ sections: config.sections.filter((_, j) => j !== i) })}
          onMove={(dir) => {
            const j = i + dir;
            if (j < 0 || j >= config.sections.length) return;
            const arr = [...config.sections];
            [arr[i], arr[j]] = [arr[j], arr[i]];
            set({ sections: arr });
          }}
        />
      ))}
      <button onClick={() => set({ sections: [...config.sections, { id: `s_${Date.now().toString(36)}`, title: { [l]: "" }, description: { [l]: "" }, audiences: [], questions: [] }] })}
        className={`flex w-full items-center justify-center gap-1 border border-dashed border-border py-2.5 text-xs text-muted-foreground hover:text-foreground ${R.control}`}>
        <Plus className="h-3 w-3" />섹션 추가
      </button>
    </div>
  );
}

function SectionCard({ section, locale: l, audiences, allQuestions, onChange, onRemove, onMove, title, hint, fixed, regFields = [], audienceKey = "" }: {
  section: SurveySection; locale: string; audiences: string[]; allQuestions: SurveyQuestion[];
  onChange: (s: SurveySection) => void; onRemove?: () => void; onMove?: (dir: -1 | 1) => void;
  title?: string; hint?: string; fixed?: boolean; regFields?: RegField[]; audienceKey?: string;
}) {
  const linked = new Set(allQuestions.map((q) => q.linkKey).filter(Boolean));
  const addLinked = (key: string) => {
    const field = regFields.find((f) => f.key === key);
    if (!field) return;
    const q: SurveyQuestion = {
      id: `q_${Date.now().toString(36)}${++qseq}`, key, linkKey: key, type: "single", title: { [l]: field.label }, description: { [l]: "" },
      required: field.required, options: [], allowOther: false, minLabel: {}, maxLabel: {}, scaleMax: 5, rows: [], naOption: true,
      // 유형별(분기) 등록 항목은 그 유형을 고른 사람에게만 — 등록 폼과 같은 조건
      showIf: field.group && audienceKey ? { key: audienceKey, value: field.group } : null,
    };
    onChange({ ...section, questions: [...section.questions, q] });
  };
  const setQ = (i: number, q: SurveyQuestion) => onChange({ ...section, questions: section.questions.map((x, j) => (j === i ? q : x)) });
  const addQ = () => {
    const n = ++qseq;
    const q: SurveyQuestion = {
      id: `q_${Date.now().toString(36)}${n}`, key: `q${Date.now().toString(36).slice(-4)}${n}`, type: "scale", title: { [l]: "" }, description: { [l]: "" },
      required: true, options: [], allowOther: false, minLabel: { [l]: "Very dissatisfied" }, maxLabel: { [l]: "Very satisfied" }, scaleMax: 5, rows: [], naOption: true, showIf: null, linkKey: "",
    };
    onChange({ ...section, questions: [...section.questions, q] });
  };
  return (
    <div className={`space-y-3 bg-background p-4 ${R.panel} ${FINISH.s1}`}>
      <div className="flex flex-wrap items-start gap-2">
        {title ? (
          <div className="flex-1"><h3 className="text-sm font-semibold">{title}</h3>{hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}</div>
        ) : (
          <input value={loc(section.title, l)} onChange={(e) => onChange({ ...section, title: { ...section.title, [l]: e.target.value } })} placeholder="섹션 제목(참관객에게 보여요)"
            className={`${FIELD_CLS} h-8 min-w-0 flex-1 text-sm font-semibold`} />
        )}
        {!fixed && (
          <div className="flex items-center gap-0.5">
            <button onClick={() => onMove?.(-1)} className="rounded p-1 text-muted-foreground hover:bg-secondary" aria-label="위로"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button onClick={() => onMove?.(1)} className="rounded p-1 text-muted-foreground hover:bg-secondary" aria-label="아래로"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button onClick={() => { if (confirm("이 섹션과 문항을 지울까요?")) onRemove?.(); }} className="rounded p-1 text-muted-foreground hover:text-red-500" aria-label="섹션 지우기"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>
      {!fixed && audiences.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">대상</span>
          <button onClick={() => onChange({ ...section, audiences: [] })} className={`px-2 py-0.5 ${R.control} ${section.audiences.length === 0 ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}>전원</button>
          {audiences.map((a) => {
            const on = section.audiences.includes(a);
            return (
              <button key={a} onClick={() => onChange({ ...section, audiences: on ? section.audiences.filter((x) => x !== a) : [...section.audiences, a] })}
                className={`px-2 py-0.5 ${R.control} ${on ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground"}`}>{a}</button>
            );
          })}
        </div>
      )}
      {!fixed && (
        <input value={loc(section.description, l)} onChange={(e) => onChange({ ...section, description: { ...section.description, [l]: e.target.value } })} placeholder="섹션 설명(선택)"
          className={`${FIELD_CLS} h-7 text-xs`} />
      )}
      <div className="divide-y divide-border rounded-lg border border-border">
        {section.questions.map((q, i) => (
          <QuestionRow key={q.id} q={q} index={i} locale={l} allQuestions={allQuestions} regField={q.linkKey ? regFields.find((f) => f.key === q.linkKey) : undefined} onChange={(next) => setQ(i, next)}
            onRemove={() => onChange({ ...section, questions: section.questions.filter((_, j) => j !== i) })}
            onMove={(dir) => {
              const j = i + dir;
              if (j < 0 || j >= section.questions.length) return;
              const arr = [...section.questions];
              [arr[i], arr[j]] = [arr[j], arr[i]];
              onChange({ ...section, questions: arr });
            }} />
        ))}
        {section.questions.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">문항이 없어요</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={addQ} className={`flex items-center gap-1 bg-secondary px-3 py-1.5 text-xs ${R.control}`}><Plus className="h-3 w-3" />문항 추가</button>
        {regFields.length > 0 && (
          <select value="" onChange={(e) => { if (e.target.value) addLinked(e.target.value); }} className={`${FIELD_CLS} h-7 w-auto text-xs`} aria-label="등록 폼 항목 연결">
            <option value="">+ 등록 폼 항목 연결…</option>
            {regFields.filter((f) => !linked.has(f.key) && !["email", "phone", "first_name", "last_name", "name"].includes(f.key)).map((f) => (
              <option key={f.key} value={f.key}>{f.group ? `[${f.group}] ` : ""}{f.label}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function QuestionRow({ q, index, locale: l, allQuestions, regField, onChange, onRemove, onMove }: {
  q: SurveyQuestion; index: number; locale: string; allQuestions: SurveyQuestion[]; regField?: RegField;
  onChange: (q: SurveyQuestion) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  if (q.linkKey) return <LinkedRow q={q} index={index} locale={l} regField={regField} onRemove={onRemove} onMove={onMove} />;
  const set = (patch: Partial<SurveyQuestion>) => onChange({ ...q, ...patch });
  const target = q.showIf ? allQuestions.find((x) => x.key === q.showIf!.key) : null;
  const needsDetail = q.type !== "short" && q.type !== "long";
  return (
    <div className="space-y-2 px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
          <select value={q.type} onChange={(e) => set({ type: e.target.value as SurveyQuestionType })} className={`${FIELD_CLS} h-8 text-xs`} aria-label="문항 유형">
            {SURVEY_QUESTION_TYPES.map((t) => <option key={t} value={t}>{SURVEY_QUESTION_TYPE_LABEL[t]}</option>)}
          </select>
          <input value={loc(q.title, l)} onChange={(e) => set({ title: { ...q.title, [l]: e.target.value } })} placeholder="질문"
            className={`${FIELD_CLS} h-8 text-sm`} aria-label="질문" />
        </div>
        <label className="mt-1.5 flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <input type="checkbox" className="accent-violet-500" checked={q.required} onChange={(e) => set({ required: e.target.checked })} />필수
        </label>
        <div className="flex shrink-0 items-center">
          <button onClick={() => setOpen((v) => !v)} className="rounded p-1 text-muted-foreground hover:bg-secondary" aria-label="자세히">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => onMove(-1)} className="rounded p-1 text-muted-foreground hover:bg-secondary" aria-label="위로"><ArrowUp className="h-3 w-3" /></button>
          <button onClick={() => onMove(1)} className="rounded p-1 text-muted-foreground hover:bg-secondary" aria-label="아래로"><ArrowDown className="h-3 w-3" /></button>
          <button onClick={onRemove} className="rounded p-1 text-muted-foreground hover:text-red-500" aria-label="지우기"><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>
      {/* 선택지는 고치는 값이라 접지 않는다 — 접는 건 드물게 쓰는 설정뿐 */}
      {(q.type === "single" || q.type === "multiple") && (
        <div className="ml-7 space-y-1">
          <OptionList items={q.options} locale={l} onChange={(options) => set({ options })} placeholder="선택지" addLabel="선택지 추가" />
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input type="checkbox" className="accent-violet-500" checked={q.allowOther} onChange={(e) => set({ allowOther: e.target.checked })} />&ldquo;기타(직접 입력)&rdquo; 넣기
          </label>
        </div>
      )}
      {q.type === "grid" && (
        <div className="ml-7">
          <p className="mb-1 text-[11px] text-muted-foreground">평가 항목(각각 1~5점)</p>
          <OptionList items={q.rows} locale={l} onChange={(rows) => set({ rows })} placeholder="평가 항목" addLabel="평가 항목 추가" />
        </div>
      )}
      {open && (
        <div className="ml-7 grid gap-2 rounded-lg bg-secondary/40 p-2 text-xs sm:grid-cols-2">
          <Field label="설명(선택)"><input value={loc(q.description, l)} onChange={(e) => set({ description: { ...q.description, [l]: e.target.value } })} className={`${FIELD_CLS} h-7 text-xs`} /></Field>
          <Field label="저장 key(받은 뒤엔 바꾸지 마세요)"><input value={q.key} onChange={(e) => set({ key: e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 60) })} className={`${FIELD_CLS} h-7 font-mono text-xs`} /></Field>
          {needsDetail && (q.type === "scale" || q.type === "nps" || q.type === "grid") && (
            <>
              <Field label={q.type === "grid" ? "1점 설명" : "낮은 쪽 설명"}><input value={loc(q.minLabel, l)} onChange={(e) => set({ minLabel: { ...q.minLabel, [l]: e.target.value } })} className={`${FIELD_CLS} h-7 text-xs`} /></Field>
              <Field label={q.type === "grid" ? "5점 설명" : "높은 쪽 설명"}><input value={loc(q.maxLabel, l)} onChange={(e) => set({ maxLabel: { ...q.maxLabel, [l]: e.target.value } })} className={`${FIELD_CLS} h-7 text-xs`} /></Field>
            </>
          )}
          {q.type === "grid" && (
            <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-violet-500" checked={q.naOption} onChange={(e) => set({ naOption: e.target.checked })} />&ldquo;해당 없음&rdquo; 선택지</label>
          )}
          <Field label="보이기 조건(선택)">
            <div className="flex gap-1">
              <select value={q.showIf?.key ?? ""} onChange={(e) => set({ showIf: e.target.value ? { key: e.target.value, value: q.showIf?.value ?? "" } : null })} className={`${FIELD_CLS} h-7 min-w-0 flex-1 text-xs`}>
                <option value="">항상 보이기</option>
                {allQuestions.filter((x) => x.key !== q.key && (x.type === "single" || x.type === "multiple")).map((x) => <option key={x.key} value={x.key}>{loc(x.title, l) || x.key}</option>)}
              </select>
              {q.showIf && target && (
                <select value={q.showIf.value} onChange={(e) => set({ showIf: { key: q.showIf!.key, value: e.target.value } })} className={`${FIELD_CLS} h-7 min-w-0 flex-1 text-xs`}>
                  <option value="">값 고르기</option>
                  {target.options.map((o) => <option key={loc(o, l)} value={loc(o, l)}>{loc(o, l)}</option>)}
                </select>
              )}
            </div>
          </Field>
        </div>
      )}
      {!open && q.showIf && <p className="ml-7 text-[11px] text-violet-500">↳ &ldquo;{loc(target?.title, l) || q.showIf.key}&rdquo; = {q.showIf.value} 일 때만</p>}
    </div>
  );
}

/** 등록 폼 연결 문항 — 질문·선택지·필수는 등록 폼이 원본이라 여기서 고치지 않는다. */
function LinkedRow({ q, index, locale: l, regField, onRemove, onMove }: {
  q: SurveyQuestion; index: number; locale: string; regField?: RegField; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const typeLabel = regField?.type === "multiple" ? "복수 선택" : regField?.type === "single" ? "단일 선택" : "짧은 답";
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <span className="mt-1 w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">{regField?.label || loc(q.title, l) || q.linkKey}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {regField ? (
            <>등록 폼 항목 그대로 · {typeLabel}{regField.options ? ` · 선택지 ${regField.options}개` : ""}{regField.required ? " · 필수" : ""}</>
          ) : (
            <span className="text-amber-600">등록 폼에서 이 항목({q.linkKey})을 찾을 수 없어 참관객에게 보이지 않아요</span>
          )}
          {q.showIf && <span className="text-violet-500"> · {q.showIf.key} = {q.showIf.value} 일 때만</span>}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <button onClick={() => onMove(-1)} className="rounded p-1 text-muted-foreground hover:bg-secondary" aria-label="위로"><ArrowUp className="h-3 w-3" /></button>
        <button onClick={() => onMove(1)} className="rounded p-1 text-muted-foreground hover:bg-secondary" aria-label="아래로"><ArrowDown className="h-3 w-3" /></button>
        <button onClick={onRemove} className="rounded p-1 text-muted-foreground hover:text-red-500" aria-label="지우기"><Trash2 className="h-3 w-3" /></button>
      </div>
    </div>
  );
}

// ── 배포 ──────────────────────────────────────────────────────────────

function ShareView({ link, token, name, onToken }: { link: string; token: string; name: string; onToken: (t: string) => Promise<boolean> }) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const qrLink = `${link}?src=qr`;
  const rows: Array<[string, string, string]> = [
    ["현장 QR", qrLink, "X배너·안내데스크. 이미 인쇄한 네이버 QR 은 네이버 QR 관리에서 연결 주소를 이 링크로 바꾸면 돼요."],
    ["뉴스레터·이메일", `${link}?src=newsletter`, "행사 후 발송용. 응답이 어디서 왔는지 결과에서 나눠 봐요."],
    ["기본 링크", link, "그 밖의 곳(SNS·문자 등)."],
  ];
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(null), 1500); } catch { toast.error("복사하지 못했어요"); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className={`space-y-3 bg-background p-4 ${R.panel} ${FINISH.s1}`}>
        {rows.map(([label, url, hint]) => (
          <div key={label} className="space-y-1">
            <p className="text-xs font-semibold">{label}</p>
            <div className="flex gap-1">
              <input readOnly value={url} onFocus={(e) => e.target.select()} className={`${FIELD_CLS} h-8 min-w-0 flex-1 font-mono text-xs`} />
              <button onClick={() => void copy(url)} className={`flex items-center gap-1 bg-secondary px-3 text-xs ${R.control}`}>{copied === url ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}복사</button>
            </div>
            <p className="text-[11px] text-muted-foreground">{hint}</p>
          </div>
        ))}
        <details className="pt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">주소 바꾸기</summary>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-muted-foreground">…/q/</span>
            <input key={token} defaultValue={token} onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== token && confirm("주소를 바꾸면 이미 인쇄·발송한 링크와 QR 이 열리지 않아요. 바꿀까요?")) void onToken(v);
            }} className={`${FIELD_CLS} h-7 w-48 font-mono text-xs`} />
          </div>
        </details>
      </div>
      <div className={`flex flex-col items-center gap-3 bg-background p-4 ${R.panel} ${FINISH.s1}`}>
        <div ref={qrRef} className="rounded-xl bg-white p-3"><QRCodeSVG value={qrLink} size={200} level="M" /></div>
        <p className="text-center text-[11px] text-muted-foreground">현장 QR 링크(?src=qr)</p>
        <div className="flex gap-1">
          {(["png", "svg"] as const).map((f) => (
            <button key={f} onClick={() => void downloadQr(qrRef.current?.querySelector("svg") ?? null, `${name}_QR`, f)}
              className={`flex items-center gap-1 bg-secondary px-3 py-1.5 text-xs ${R.control}`}><Download className="h-3 w-3" />{f.toUpperCase()}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 결과 ──────────────────────────────────────────────────────────────

interface Results {
  total: number; registered: number;
  byAudience: Array<{ value: string; count: number }>;
  byChannel: Array<{ value: string; count: number }>;
  summaries: QuestionSummary[];
  segmentable: Array<{ key: string; label: string }>;
  by: string;
  scoreQuestions: Array<{ key: string; type: string; title: string }>;
  segments: Array<{ value: string; count: number; scores: Array<{ key: string; average: number | null; nps: number | null }> }>;
  lastAt: string | null;
  /** 저장된 AI 해석 — 한 번도 안 돌렸으면 null. 결과 분석 탭도 이 값을 그대로 보여준다. */
  ai: { summary: string; insights: Insight[]; generatedAt: string } | null;
  aiAvailable: boolean;
}

function ResultsView({ surveyId, config }: { surveyId: string; config: SurveyConfig }) {
  const [audience, setAudience] = useState("");
  const [by, setBy] = useState("");
  const [data, setData] = useState<Results | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const load = useCallback(async () => {
    const res = await fetch(`/api/surveys/${surveyId}/results?audience=${encodeURIComponent(audience)}${by ? `&by=${encodeURIComponent(by)}` : ""}`);
    const json = await res.json().catch(() => null);
    if (res.ok) setData(json);
  }, [surveyId, audience, by]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const runAi = useCallback(async () => {
    setAiBusy(true);
    setAiError("");
    try {
      const res = await fetch(`/api/surveys/${surveyId}/ai-insight`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "AI가 해석을 쓰지 못했어요");
      setData((d) => (d ? { ...d, ai: { summary: body.summary, insights: body.insights, generatedAt: body.generatedAt } } : d));
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }, [surveyId]);
  if (!data) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const label = (a: string) => config.audienceLabels[a] ?? a;
  // 대표 지표 — 추천 점수(NPS) 먼저, 그다음 점수 문항 순서대로(보통 전반 만족도가 첫 점수 문항이다).
  const headline = [...data.summaries.filter((s) => s.type === "nps" && s.answered), ...data.summaries.filter((s) => s.type === "scale" && s.average !== undefined)].slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setAudience("")} className={`px-2.5 py-1 text-xs ${R.control} ${!audience ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}>전체 {data.total}</button>
          {data.byAudience.map((a) => (
            <button key={a.value} onClick={() => setAudience(a.value)} className={`px-2.5 py-1 text-xs ${R.control} ${audience === a.value ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}>{label(a.value)} {a.count}</button>
          ))}
        </div>
        <div className="flex gap-1">
          <button onClick={() => void load()} className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-xs ${R.control}`}><RefreshCw className="h-3 w-3" />새로고침</button>
          <a href={`/api/surveys/${surveyId}/results?format=xlsx`} className={`flex items-center gap-1 bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 ${R.control}`}><Download className="h-3 w-3" />엑셀(등록 정보 포함)</a>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="응답" value={data.total.toLocaleString()} sub={`사전등록 연결 ${data.registered} · 경로 ${data.byChannel.map((c) => `${c.value} ${c.count}`).join(" · ") || "-"}`} />
        {headline.map((s) => (
          <Kpi key={s.key} label={s.title} value={s.type === "nps" ? (s.nps ?? "-").toString() : (s.average ?? "-").toString()} sub={s.type === "nps" ? `NPS · 평균 ${s.average ?? "-"}점 · ${s.answered}명` : `평균 · ${s.answered}명`} />
        ))}
      </div>

      {/* AI 해석 — 문항별 숫자는 아래 카드에 있다. 여기서는 등록 데이터·주관식 답변까지 같이 읽고
          전체적으로 무엇을 뜻하는지 해석한다. 결과 분석 탭도 이걸 그대로 보여준다(저장해서 공유). */}
      {data.total > 0 && (
        <div className={`bg-background p-4 ${R.panel} ${FINISH.s1}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-500" />AI 해석</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                등록 데이터·주관식 답변까지 같이 읽고 전체적으로 무엇을 뜻하는지 해석해요. 결과 분석 탭에도 그대로 보여요.
              </p>
            </div>
            <button
              onClick={() => void runAi()}
              disabled={!data.aiAvailable || aiBusy}
              title={data.aiAvailable ? "등록 데이터와 교차해서 AI가 해석해요" : "Vercel 환경 변수 ANTHROPIC_API_KEY 를 넣으면 켜져요"}
              className={`flex shrink-0 items-center gap-1.5 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-600 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-violet-400 ${R.control}`}
            >
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {data.ai ? "다시 해석하기" : "AI로 해석하기"}
            </button>
          </div>
          {aiError && <p className="mt-3 text-sm text-destructive">{aiError}</p>}
          {data.ai ? (
            <div className="mt-4 space-y-3">
              <p className="text-[11px] text-muted-foreground tabular-nums">{new Date(data.ai.generatedAt).toLocaleString("ko-KR")} 해석</p>
              {data.ai.summary && <p className="rounded-xl bg-violet-500/5 p-3 text-sm leading-relaxed">{data.ai.summary}</p>}
              {data.ai.insights.length > 0 && (
                <ul className="divide-y divide-border">{data.ai.insights.map((i, idx) => <InsightRow key={idx} i={i} />)}</ul>
              )}
            </div>
          ) : (
            !aiError && <p className="mt-3 text-sm text-muted-foreground">아직 해석한 적이 없어요.</p>
          )}
        </div>
      )}

      {data.total === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">아직 응답이 없어요</p>
      ) : (
        <>
          {data.scoreQuestions.length > 0 && data.segmentable.length > 0 && (
            <div className={`space-y-2 overflow-x-auto bg-background p-4 ${R.panel} ${FINISH.s1}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">등록 정보로 나눠 보기</h3>
                <select value={data.by} onChange={(e) => setBy(e.target.value)} className={`${FIELD_CLS} h-7 w-auto text-xs`}>
                  {data.segmentable.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <span className="text-[11px] text-muted-foreground">사전등록 응답 + 등록 없이 같은 문항으로 답한 응답 · 30명 미만은 참고치</span>
              </div>
              <table className="w-full min-w-[560px] text-xs">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1.5 pr-3 font-medium">값</th><th className="py-1.5 pr-3 font-medium">응답</th>{data.scoreQuestions.map((q) => <th key={q.key} className="py-1.5 pr-3 font-medium">{q.title}</th>)}</tr></thead>
                <tbody>
                  {data.segments.map((s) => (
                    <tr key={s.value} className={`border-t border-border ${s.count < 30 ? "text-muted-foreground" : ""}`}>
                      <td className="py-1.5 pr-3 font-medium">{label(s.value)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{s.count}</td>
                      {s.scores.map((sc) => <td key={sc.key} className="py-1.5 pr-3 tabular-nums">{sc.nps !== null ? `NPS ${sc.nps}` : sc.average ?? "-"}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {data.summaries.filter((s) => s.answered > 0).map((s) => <SummaryCard key={s.key} s={s} />)}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ s }: { s: QuestionSummary }) {
  const max = Math.max(1, ...(s.counts ?? []).map((c) => c.count));
  return (
    <div className={`space-y-2 bg-background p-4 ${R.panel} ${FINISH.s1}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{s.title}</p>
        <span className="shrink-0 text-[11px] text-muted-foreground">{s.answered}명</span>
      </div>
      {(s.average !== undefined || s.nps !== undefined) && (
        <p className="text-xs text-muted-foreground">{s.nps !== undefined && <b className="mr-2 text-base text-foreground">NPS {s.nps}</b>}{s.average !== undefined && <>평균 <b className="text-foreground">{s.average}</b></>}</p>
      )}
      {s.counts && (
        <div className="space-y-1">
          {s.counts.map((c) => (
            <div key={c.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_36px] items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground" title={c.label}>{c.label}</span>
              <div className="h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-violet-500" style={{ width: `${(c.count / max) * 100}%` }} /></div>
              <span className="text-right tabular-nums">{c.count}</span>
            </div>
          ))}
        </div>
      )}
      {s.rows && (
        <div className="space-y-1">
          {s.rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_44px] items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground" title={r.label}>{r.label}</span>
              <div className="h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-violet-500" style={{ width: `${((r.average ?? 0) / 5) * 100}%` }} /></div>
              <span className="text-right tabular-nums">{r.average ?? "-"}</span>
            </div>
          ))}
        </div>
      )}
      {s.texts && (
        <ul className="max-h-56 space-y-1 overflow-auto text-xs">
          {s.texts.slice(0, 50).map((t, i) => <li key={i} className="whitespace-pre-line rounded bg-secondary/50 px-2 py-1">{t}</li>)}
        </ul>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={`bg-background p-4 ${R.panel} ${FINISH.s1}`}>
      <p className="truncate text-[11px] text-muted-foreground" title={label}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={sub}>{sub}</p>
    </div>
  );
}

/**
 * 선택지 편집 — 사전등록 폼 빌더처럼 한 줄 = 한 선택지. Enter 로 아래에 새 선택지, 빈 칸에서 Backspace 로 지우기,
 * 여러 줄을 붙여 넣으면 줄마다 나뉜다. (예전엔 줄바꿈 텍스트 칸이라 Enter 를 치면 빈 줄이 바로 사라졌다.)
 * 빈 선택지는 화면에서만 잠시 남고 저장할 때 서버가 걸러 낸다.
 */
function OptionList({ items, locale: l, onChange, placeholder, addLabel }: {
  items: Array<Record<string, string>>; locale: string; onChange: (items: Array<Record<string, string>>) => void; placeholder: string; addLabel: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  // 새로 생긴 칸에 커서 — 목록이 다시 그려진 뒤에 옮긴다.
  const pendingFocus = useRef<number | null>(null);
  useEffect(() => {
    if (pendingFocus.current === null) return;
    refs.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  }, [items]);
  const setFocusIndex = (i: number) => { pendingFocus.current = i; };
  const setAt = (i: number, text: string) => onChange(items.map((x, j) => (j === i ? { ...x, [l]: text } : x)));
  const insertAfter = (i: number, texts: string[] = [""]) => {
    const next = [...items];
    next.splice(i + 1, 0, ...texts.map((t) => ({ [l]: t })));
    onChange(next);
    setFocusIndex(i + texts.length);
  };
  const removeAt = (i: number) => {
    onChange(items.filter((_, j) => j !== i));
    setFocusIndex(Math.max(0, i - 1));
  };
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{i + 1}</span>
          <input
            ref={(el) => { refs.current[i] = el; }}
            value={loc(item, l)}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") { e.preventDefault(); insertAfter(i); }
              else if (e.key === "Backspace" && !e.currentTarget.value && items.length > 1) { e.preventDefault(); removeAt(i); }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text/plain");
              if (!text.includes("\n")) return;
              e.preventDefault();
              const parts = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
              if (!parts.length) return;
              const [first, ...rest] = parts;
              const next = items.map((x, j) => (j === i ? { ...x, [l]: (loc(x, l) + first).trim() } : x));
              next.splice(i + 1, 0, ...rest.map((t) => ({ [l]: t })));
              onChange(next);
              setFocusIndex(i + rest.length);
            }}
            placeholder={`${placeholder} ${i + 1}`}
            className={`${FIELD_CLS} h-7 min-w-0 flex-1 text-xs`}
          />
          <button type="button" onClick={() => removeAt(i)} className="rounded p-1 text-muted-foreground hover:text-red-500" aria-label={`${placeholder} 지우기`}>
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => insertAfter(items.length - 1)}
        className="flex items-center gap-1 pl-5 text-[11px] text-violet-600 hover:underline dark:text-violet-400">
        <Plus className="h-3 w-3" />{addLabel}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="block text-[11px] text-muted-foreground">{label}</span>{children}</label>;
}

function AutoArea({ value, onChange, placeholder, small }: { value: string; onChange: (v: string) => void; placeholder?: string; small?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={`${FIELD_CLS} w-full resize-none overflow-hidden py-1.5 ${small ? "text-xs" : "text-sm"}`} />
  );
}
