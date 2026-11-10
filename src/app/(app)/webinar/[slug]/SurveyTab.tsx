"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type ElementType, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Plus, Trash2, GripVertical, Link2, Loader2, BarChart3,
  Star, CircleDot, ListChecks, Gauge, AlignLeft, Copy, ChevronDown, ChevronRight, ArrowLeft, Info, X, Smartphone, CalendarClock, CircleCheckBig, ClipboardList, MousePointerClick, Target,
} from "lucide-react";
import { getPublicAppOrigin } from "@/lib/app-url";
import { toast } from "sonner";
import { useAutosave } from "@/components/ui/use-autosave";
import { useReportAutosave } from "@/components/ui/autosave-scope";
import { FIELD_CLS, FINISH, R, SELECTED } from "@/components/ui/primitives";
import { OptionRows } from "@/components/ui/option-rows";
import { EditableList } from "@/components/ui/editable-list";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatSurveyOpensAt, isSurveyAcceptingResponses, normalizeSurveyQuestions, surveyOpenState, SURVEY_MAX_QUESTIONS, SURVEY_TYPE_LABELS, type SurveyQuestion, type SurveyQuestionType } from "@/lib/webinar-survey";
import SurveyForm, { SURVEY_FORM_CSS } from "@/app/webinar/[slug]/SurveyForm";
import { buildStkCss } from "@/app/webinar/[slug]/LiveContentStk";
import { kstDateTimeLocalInput, kstDateTimeLocalToIso } from "@/lib/datetime";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

/** 문항 유형 메타 — 팝오버·칩이 공유. 아이콘+설명으로 각 유형이 뭘 하는지 즉시 보이게. */
const TYPE_META: Record<SurveyQuestionType, { label: string; desc: string; icon: ElementType }> = {
  rating: { label: "별점", desc: "1–5점 만족도", icon: Star },
  single: { label: "객관식 · 단일", desc: "하나만 선택", icon: CircleDot },
  multiple: { label: "객관식 · 복수", desc: "여러 개 · 최대 개수 제한", icon: ListChecks },
  nps: { label: "추천지수 NPS", desc: "0–10 추천 점수", icon: Gauge },
  text: { label: "주관식", desc: "자유 서술형 (최대 2000자)", icon: AlignLeft },
};
const TYPE_ORDER: SurveyQuestionType[] = ["rating", "single", "multiple", "nps", "text"];

/** 척도 고정 유형의 안내 문구 — 편집할 게 없는 이유를 설명한다. */
const FIXED_TYPE_HINT: Partial<Record<SurveyQuestionType, string>> = {
  rating: "별점 1–5개 — 응답자가 별을 눌러 만족도를 매겨요. 척도는 고정이에요.",
  nps: "0–10 추천지수 — 0=전혀 아니에요, 10=매우 그래요. 척도는 고정이에요.",
  text: "주관식 장문 — 응답자가 자유롭게 서술해요 (최대 2000자).",
};

interface AdminSurvey {
  id: string;
  title: string;
  description: string | null;
  questions: SurveyQuestion[];
  isOpen: boolean;
  opensAt: string | null; // 시작 예약 — 이 시각 전에는 isOpen 이 켜져 있어도 받지 않음
  closesAt: string | null; // 마감 예약 — 지나면 isOpen 과 무관하게 응답 마감
  doneTitle: string | null; // 제출 완료 화면 제목(없으면 기본 문구)
  doneDescription: string | null; // 제출 완료 화면 설명
  ctaLabel: string | null; // 종료 화면 카드의 버튼 문구(없으면 기본: 설문 참여하기)
  showOnEnded: boolean;
  isActive: boolean;
  _count?: { responses: number };
}

/**
 * ISO → datetime-local 입력값(KST 벽시각 yyyy-MM-ddTHH:mm).
 * 기기 로컬 타임존이 아니라 KST 로 고정한다 — 라이브 시작·마감 등 이 플랫폼의 다른 모든
 * 일정 입력칸과 기준을 맞춰야 화면에 보이는 값과 저장되는 값이 어긋나지 않는다.
 */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  return kstDateTimeLocalInput(iso);
}

interface ViewerTheme { accent: string; text: string; surface: string; radius?: string }

// 호출 시점마다 새 id 를 만든다 — 모듈 스코프에서 1회 평가하면 한 세션에서 만든 설문들이 문항 id 를 공유한다.
const buildDefaultQuestions = (): SurveyQuestion[] => [
  { id: crypto.randomUUID(), type: "rating", title: "오늘 웨비나는 전반적으로 어떠셨나요?", required: true, options: [] },
  { id: crypto.randomUUID(), type: "single", title: "가장 도움이 된 세션은 무엇인가요?", required: false, options: ["세션 1", "세션 2", "세션 3"] },
  { id: crypto.randomUUID(), type: "nps", title: "동료에게 이 웨비나를 추천하시겠어요?", required: false, options: [] },
  { id: crypto.randomUUID(), type: "text", title: "더 듣고 싶은 주제나 의견을 남겨주세요.", required: false, options: [] },
];

const countOptions = (q: SurveyQuestion) => q.options.filter((o) => o.trim()).length;

/* ---------- 유형 선택 팝오버 (칩·문항 추가 버튼이 공유) ---------- */
function TypeMenu({ current, onPick }: { current?: SurveyQuestionType; onPick: (t: SurveyQuestionType) => void }) {
  return (
    <div className={`absolute left-0 top-full z-30 mt-1.5 w-64 bg-popover p-1.5 ${R.surface} ${FINISH.overlay}`}>
      <p className="px-2 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
        {current ? "질문 유형 변경" : "추가할 유형 선택"}
      </p>
      {TYPE_ORDER.map((t) => {
        const meta = TYPE_META[t];
        const Icon = meta.icon;
        const active = current === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${active ? "bg-violet-500/10" : "hover:bg-secondary/70"}`}
          >
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${active ? "bg-violet-500 text-white" : "bg-violet-500/10 text-violet-500"}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className={`block text-[13px] font-semibold ${active ? "text-violet-600 dark:text-violet-400" : ""}`}>{meta.label}</span>
              <span className="block text-[11px] text-muted-foreground">{meta.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 열림 상태 + 바깥 클릭/ESC 닫기를 묶은 훅 */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

/* ---------- 문항 카드 ---------- */
function QuestionRow({
  q,
  index,
  setQuestions,
  handle,
  removeButton,
  onDuplicate,
  onFocusQuestion,
}: {
  q: SurveyQuestion;
  index: number;
  setQuestions: Dispatch<SetStateAction<SurveyQuestion[]>>;
  /** 골격이 만든 드래그 핸들 — dnd-kit 배선(포인터+방향키)이 붙어 있다. */
  handle: ReactNode | null;
  /** 골격이 만든 삭제 컨트롤 — 5초 되돌리기까지 포함. */
  removeButton: (opts?: { label?: string; onClick?: () => void }) => ReactNode | null;
  onDuplicate: () => void;
  onFocusQuestion: (qid: string) => void;
}) {
  const typePop = usePopover();

  const patch = (next: Partial<SurveyQuestion>) =>
    setQuestions((qs) => qs.map((item) => (item.id === q.id ? { ...item, ...next } : item)));
  const hasOptions = q.type === "single" || q.type === "multiple";
  const optionCount = countOptions(q);

  /* 선택지를 고치면 함께 정리해야 하는 파생값 두 개.
     저장 시 정규화가 같은 일을 하지만, 편집 중 화면에는 옛 값이 남아 있어
     "성과로 지정된 칩" 이 이미 없는 문구를 가리키는 상태가 보인다. */
  const clampDerived = (options: string[], next: Partial<SurveyQuestion>) => {
    const live = options.filter((o) => o.trim());
    // 옵션이 줄어 maxSelect 가 옵션수 이상이 되면 무제한과 같아진다.
    if (q.maxSelect !== undefined && q.maxSelect >= live.length) next.maxSelect = undefined;
    // 성과 지정은 **지금 있는 문구**만 유지 — 문구를 고치면 그 지정은 풀린다(안내 문구로 알린다).
    const goals = (q.goalOptions ?? []).filter((o) => live.includes(o));
    if (goals.length !== (q.goalOptions ?? []).length) next.goalOptions = goals.length ? goals : undefined;
    return next;
  };

  const changeType = (t: SurveyQuestionType) => {
    typePop.setOpen(false);
    if (t === q.type) return;
    const next: Partial<SurveyQuestion> = { type: t };
    if ((t === "single" || t === "multiple") && optionCount === 0) next.options = ["", ""];
    if (t !== "multiple") next.maxSelect = undefined;
    // 별점·NPS·주관식은 성과 판정 대상이 아니다 — 남겨두면 저장 때 조용히 사라진다.
    if (t !== "single" && t !== "multiple") next.goalOptions = undefined;
    patch(next);
  };

  const meta = TYPE_META[q.type];
  const TypeIcon = meta.icon;

  return (
    /* framer Reorder → 골격(dnd-kit). layout 프롭 제거가 핵심 — framer 가 transform 의
       저자가 되면 dnd-kit 이 넘긴 값이 버려진다(SessionsTab 실측). 방향키 재정렬과
       삭제 되돌리기가 함께 붙는다. */
    <div className={`${R.surface} bg-secondary ${FINISH.s2} transition-colors focus-within:bg-secondary/70`}>
      <div onFocusCapture={() => onFocusQuestion(q.id)}>
        <div className="flex items-center gap-1 px-2 pt-2">
          {handle}
          <span className="w-7 shrink-0 text-center font-mono text-[10px] font-semibold text-muted-foreground/70">Q{index + 1}</span>

          <div className="relative" ref={typePop.ref}>
            <button
              type="button"
              onClick={() => typePop.setOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={typePop.open}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-background px-2 py-1.5 text-xs font-semibold shadow-sm transition-shadow hover:shadow"
            >
              <span className="grid h-5 w-5 place-items-center rounded-lg bg-violet-500/10 text-violet-500"><TypeIcon className="h-3 w-3" /></span>
              {meta.label}
              <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
            </button>
            {typePop.open && <TypeMenu current={q.type} onPick={changeType} />}
          </div>

          <span className="flex-1" />
          <label className={`flex select-none items-center gap-1.5 text-[11px] ${q.required ? "font-semibold text-amber-600" : "text-muted-foreground"}`}>
            필수
            <Switch checked={q.required} onChange={(v) => patch({ required: v })} label={`${q.title || "문항"} 필수`} />
          </label>
          <button type="button" onClick={onDuplicate} aria-label="문항 복제" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-background hover:text-foreground">
            <Copy className="h-3.5 w-3.5" />
          </button>
          {removeButton({ label: `${q.title || `Q${index + 1}`} 문항 삭제` })}
        </div>

        <div className="px-3 pb-3 pl-[42px] pt-1">
          <input
            value={q.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="질문을 입력하세요"
            aria-label="문항"
            className="w-full bg-transparent pb-2 text-[14px] font-semibold tracking-tight outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
          />

          {hasOptions && (
            <div className="space-y-1.5">
              {/**
               * 공용 OptionRows 로 이관 — 등록 탭의 선택지 코드와 사실상 같은 코드였다.
               * 얻는 것: 드래그·키보드 재정렬(선택지 순서는 응답 화면의 표시 순서인데
               * 바꾸는 방법이 문구를 다시 타이핑하는 것뿐이었다).
               *
               * clampDerived 는 여기 남는다 — 이건 설문에만 있는 파생값이고, 계산 근거가
               * 배열 길이가 아니라 **비어 있지 않은 옵션 수**다. 그래서 골격의 onCountChange
               * (배열 길이)로는 못 맞춘다. 배열을 손에 든 onChange 에서 처리한다.
               */}
              <OptionRows
                listId={`survey-q-${q.id}`}
                value={q.options}
                onChange={(options) => patch(clampDerived(options, { options }))}
                markerShape={q.type === "multiple" ? "square" : "circle"}
                ownerLabel="문항"
                ownerTitle={q.title}
              />

              {optionCount === 0 && (
                <p className="flex items-center gap-1.5 pt-0.5 text-[11px] text-amber-600">
                  <Info className="h-3 w-3 shrink-0" />선택지가 없으면 응답 화면에 표시되지 않아요{q.required ? " — 필수 문항이라 제출도 막혀요" : ""}.
                </p>
              )}

              {q.type === "multiple" && optionCount >= 2 && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-dashed border-border pt-2.5">
                  <span className="mr-1 text-[11px] font-medium text-muted-foreground">최대 선택</span>
                  <button
                    type="button"
                    aria-pressed={q.maxSelect === undefined}
                    onClick={() => patch({ maxSelect: undefined })}
                    className={`h-6 px-2 text-[11px] font-semibold transition-colors ${R.control} ${q.maxSelect === undefined ? SELECTED : `bg-background text-muted-foreground hover:text-foreground ${FINISH.s2}`}`}
                  >
                    무제한
                  </button>
                  {/* 옵션 전체 선택 = 무제한과 같으므로 옵션수-1 까지만 제공(저장 규칙과 일치) */}
                  {Array.from({ length: optionCount - 1 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={q.maxSelect === n}
                      onClick={() => patch({ maxSelect: n })}
                      className={`h-6 min-w-7 px-2 text-[11px] font-semibold tabular-nums transition-colors ${R.control} ${q.maxSelect === n ? SELECTED : `bg-background text-muted-foreground hover:text-foreground ${FINISH.s2}`}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}

              {/**
               * 성과 선택지 — 이 선택지를 고른 사람을 **성과 퍼널의 "상담 희망"** 으로 센다.
               *
               * 왜 자동 판정이 아닌가: 실제 설문에 상담을 언급하는 문항이 둘이었다
               * ("1:1 상담을 희망하시나요?" 와 "현재 단계는?" 의 마지막 선택지 '1:1 상담 희망').
               * 제목·문구로 추측하면 조용히 엉뚱한 문항을 센다.
               *
               * 선택지를 고쳐 쓰면 지정이 자동으로 끊긴다(정규화가 없는 문구를 버린다) —
               * 그게 "지정은 있는데 성과가 0" 보다 낫고, 그 사실을 아래 문구로 알린다.
               */}
              {optionCount >= 1 && (
                <div className="mt-1 border-t border-dashed border-border pt-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <Target className="h-3 w-3 shrink-0 text-violet-500" />
                    <span className="text-[11px] font-medium text-muted-foreground">성과로 셀 선택지</span>
                    <span className="text-[10.5px] text-muted-foreground/70">— 분석의 성과 퍼널에서 &lsquo;상담 희망&rsquo; 으로 집계돼요</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.filter((o) => o.trim()).map((opt) => {
                      const on = (q.goalOptions ?? []).includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            const cur = q.goalOptions ?? [];
                            const next = on ? cur.filter((o) => o !== opt) : [...cur, opt];
                            patch({ goalOptions: next.length ? next : undefined });
                          }}
                          className={`h-6 max-w-full truncate px-2 text-[11px] font-medium transition-colors ${R.control} ${on ? SELECTED : `bg-background text-muted-foreground hover:text-foreground ${FINISH.s2}`}`}
                          title={on ? `성과로 셈: ${opt}` : `성과로 세기: ${opt}`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {(q.goalOptions ?? []).length > 0 && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      선택지 문구를 고치면 이 지정이 풀려요 — 문구를 바꾼 뒤에는 다시 지정해주세요.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!hasOptions && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
              <Info className="h-3 w-3 shrink-0" />{FIXED_TYPE_HINT[q.type]}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- 응답자 실시간 미리보기 — 실제 뷰어 컴포넌트(SurveyForm)를 STK 테마로 그대로 렌더 ---------- */
const PREVIEW_CSS = `
.stk-live.svprev { background:var(--card-2); padding:20px 14px 28px; min-height:100%; }
.stk-live.svprev .pv-head { text-align:center; margin-bottom:16px; padding:0 4px; }
.stk-live.svprev .pv-kick { font-size:10px; font-weight:750; letter-spacing:.14em; text-transform:uppercase; color:var(--key); margin:0 0 6px; }
.stk-live.svprev .pv-title { font-size:17px; font-weight:820; letter-spacing:-.02em; color:var(--text); margin:0; word-break:keep-all; }
.stk-live.svprev .pv-desc { font-size:12px; line-height:1.6; color:var(--muted); margin:7px 0 0; white-space:pre-wrap; word-break:keep-all; }
.stk-live.svprev .pv-card { background:var(--card); border-radius:16px; box-shadow:var(--card-shadow); padding:18px 15px; }
.stk-live.svprev .pv-empty { text-align:center; font-size:12px; line-height:1.8; color:var(--muted); margin:6px 0; }
`;

function SurveyPreview({
  slug,
  webinarName,
  title,
  description,
  questions,
  theme,
  bodyRef,
}: {
  slug: string;
  webinarName?: string;
  title: string;
  description: string;
  questions: SurveyQuestion[];
  theme: ViewerTheme;
  bodyRef: React.RefObject<HTMLDivElement | null>;
}) {
  const css = useMemo(
    () => buildStkCss(theme.accent, theme.text, theme.surface, theme.radius) + SURVEY_FORM_CSS + PREVIEW_CSS,
    [theme.accent, theme.text, theme.surface, theme.radius],
  );
  // 뷰어 경로와 같은 정규화 — 빈 제목·선택지 0개 객관식은 실제 응답 화면처럼 숨긴다.
  const visible = useMemo(() => normalizeSurveyQuestions(questions), [questions]);

  return (
    <div className="mx-auto w-full max-w-[440px] 2xl:sticky 2xl:top-4">
      <div className="mb-2 flex items-center gap-1.5 px-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
        <Smartphone className="h-3 w-3" />응답자 미리보기
        <span className="ml-auto inline-flex items-center gap-1.5 text-emerald-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />실시간
        </span>
      </div>
      <div className="overflow-hidden rounded-[24px] shadow-xl">
        <div className="flex h-8 items-center justify-center bg-secondary/70 px-3">
          <span className="truncate font-mono text-[10px] text-muted-foreground/80">…/webinar/{slug}/survey</span>
        </div>
        <div ref={bodyRef} className="relative max-h-[min(760px,calc(100vh-230px))] overflow-y-auto overscroll-contain">
          <style dangerouslySetInnerHTML={{ __html: css }} />
          <div className="stk-live svprev">
            <div className="pv-head">
              {webinarName && <p className="pv-kick">{webinarName}</p>}
              <h4 className="pv-title">{title.trim() || "제목 없는 설문"}</h4>
              {description.trim() !== "" && <p className="pv-desc">{description}</p>}
            </div>
            <div className="pv-card">
              {visible.length === 0 ? (
                <p className="pv-empty">아직 표시할 문항이 없어요.<br />질문 제목과 선택지를 채우면 바로 나타나요.</p>
              ) : (
                <SurveyForm
                  questions={visible}
                  onSubmit={() => toast.success("미리보기 제출 완료 — 실제 응답으로 저장되지는 않아요")}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 px-1 text-center text-[11px] text-muted-foreground/70">직접 눌러볼 수 있어요 — 필수 검증·선택 제한도 그대로 동작해요.</p>
    </div>
  );
}

/* ---------- 설문 1개 편집기 — 자체 자동저장(디바운스 PATCH) + 인접 실시간 미리보기 ---------- */
function SurveyEditor({
  webinarId,
  slug,
  webinarName,
  theme,
  survey,
  onDeleted,
  onMetaChanged,
  endedSurveyAreaOn,
  onGoToEndedScreen,
}: {
  webinarId: string;
  slug: string;
  webinarName?: string;
  theme: ViewerTheme;
  survey: AdminSurvey;
  onDeleted: () => void;
  onMetaChanged: (patch: Partial<AdminSurvey>) => void;
  endedSurveyAreaOn?: boolean;
  onGoToEndedScreen?: () => void;
}) {
  const [title, setTitle] = useState(survey.title);
  const [description, setDescription] = useState(survey.description ?? "");
  const [questions, setQuestions] = useState<SurveyQuestion[]>(survey.questions);
  const [doneTitle, setDoneTitle] = useState(survey.doneTitle ?? "");
  const [doneDescription, setDoneDescription] = useState(survey.doneDescription ?? "");
  const [ctaLabel, setCtaLabel] = useState(survey.ctaLabel ?? "");
  const [copied, setCopied] = useState(false);
  // 보관 문항(retired)은 편집 대상이 아니다 — 답변이 있어 정의만 남겨둔 것이라
  // 편집 목록·드래그에서 빼고 아래 별도 섹션에 읽기 전용으로 보여준다.
  const activeQuestions = useMemo(() => questions.filter((q) => !q.retired), [questions]);
  const retiredQuestions = useMemo(() => questions.filter((q) => q.retired), [questions]);
  // 순서 변경은 활성 문항에만 적용하고 보관 문항은 항상 뒤에 유지한다.
  const setActiveOrder = (next: SurveyQuestion[]) => setQuestions([...next, ...retiredQuestions]);
  const confirm = useConfirm();
  const addPop = usePopover();
  const previewBodyRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<string | null>(null);

  const save = async () => {
    try {
      const res = await fetch(`/api/webinars/${webinarId}/surveys/${survey.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ title, description, questions, doneTitle, doneDescription, ctaLabel }),
      });
      if (!res.ok) { toast.error("자동 저장 실패 — 잠시 후 다시 시도돼요", { id: "autosave-error" }); return false; }
      // 목록(마스터-디테일) 왕복 후 재진입해도 방금 저장한 값으로 초기화되도록 부모 캐시 동기화
      // (빠뜨린 필드는 재진입 시 옛 값으로 되돌아가 다음 자동저장이 그 옛 값을 다시 저장한다)
      onMetaChanged({
        title,
        description: description.trim() || null,
        questions,
        doneTitle: doneTitle.trim() || null,
        doneDescription: doneDescription.trim() || null,
        ctaLabel: ctaLabel.trim() || null,
      });
      return true;
    } catch { return false; }
  };
  const { state: saveState, retry } = useAutosave({ title, description, questions, doneTitle, doneDescription, ctaLabel }, save);
  // 표시는 껍데기 한 곳에서 그린다(만들기 화면당 1개) — 저장 경로는 그대로 각자.
  useReportAutosave(saveState, retry);

  const toggle = async (key: "isOpen" | "showOnEnded", value: boolean) => {
    const res = await fetch(`/api/webinars/${webinarId}/surveys/${survey.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (!res.ok) { toast.error("변경에 실패했어요"); return; }
    onMetaChanged({ [key]: value });

    /**
     * 여기서 종료 화면 토글(config.livePage.ended.survey)까지 켜고 싶지만 **할 수 없다.**
     * 서버의 config 병합은 최상위 얕은 병합이라(mergeJson) `config: { livePage: { … } }` 를 보내면
     * **livePage 전체가 교체**된다 — CTA·자료·공지·대기 화면 설정이 통째로 날아간다.
     * livePage 를 온전히 보내려면 현재 값을 알아야 하고, 그건 이 탭이 들고 있지 않다(스냅샷을
     * 새로 읽어 보내는 것도 다른 창의 편집을 되돌릴 위험이 있다).
     *
     * 그래서 쓰지 않고 **보이게 한다** — 아래 안내가 종료 화면 영역이 꺼져 있음을 알리고
     * 그 자리로 보낸다. 결정을 한 자리로 모으는 쪽(3택)은 시청 화면 › 종료 가 담당한다.
     */
  };

  // 응답 기간(시작·마감 예약) — 입력 중엔 로컬 draft, 확정(blur/해제)에만 PATCH
  // (datetime-local 은 연·월·일·시·분을 하나씩 채울 때마다 change 가 나서, change 마다 저장하면 중간 쓰레기 값이 날아간다)
  const [opensDraft, setOpensDraft] = useState(() => toLocalInputValue(survey.opensAt));
  const [closesDraft, setClosesDraft] = useState(() => toLocalInputValue(survey.closesAt));
  useEffect(() => { setOpensDraft(toLocalInputValue(survey.opensAt)); }, [survey.opensAt]);
  useEffect(() => { setClosesDraft(toLocalInputValue(survey.closesAt)); }, [survey.closesAt]);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const SCHEDULE_LABEL = { opensAt: "시작 예약", closesAt: "마감 예약" } as const;

  const commitSchedule = async (field: "opensAt" | "closesAt", local: string) => {
    const iso = local ? kstDateTimeLocalToIso(local) : null;
    if (toLocalInputValue(iso) === toLocalInputValue(survey[field])) return; // 변경 없음
    // 뒤집힌 기간은 **보내기 전에 그 자리에서** 막는다 — 저장되면 운영자는 기간을 정했다고
    // 믿는데 설문은 영구히 닫힌다. draft 는 지우지 않는다(방금 입력한 값이 보여야 고칠 수 있다).
    const nextOpens = field === "opensAt" ? iso : survey.opensAt;
    const nextCloses = field === "closesAt" ? iso : survey.closesAt;
    if (nextOpens && nextCloses && new Date(nextOpens).getTime() >= new Date(nextCloses).getTime()) {
      setRangeError("시작이 마감보다 늦어요 — 이대로면 응답을 받지 않아요");
      return;
    }
    setRangeError(null);
    const res = await fetch(`/api/webinars/${webinarId}/surveys/${survey.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: iso }),
    });
    if (res.ok) onMetaChanged({ [field]: iso });
    else {
      toast.error(`${SCHEDULE_LABEL[field]} 변경에 실패했어요`);
      (field === "opensAt" ? setOpensDraft : setClosesDraft)(toLocalInputValue(survey[field]));
    }
  };

  // 지금 실제로 받고 있는지 — 스위치와 두 예약을 한 번에 판정한다(공개 라우트와 같은 함수)
  const openState = surveyOpenState(survey);
  const scheduleNote =
    openState === "before" ? `시작 예약 전 — ${formatSurveyOpensAt(survey.opensAt)}부터 받아요`
    : openState === "closed" ? "예약 시각이 지나 마감됨"
    : null;

  const remove = async () => {
    if (!(await confirm({
      title: "설문을 삭제할까요?",
      description: `"${title}" — 응답 ${survey._count?.responses ?? 0}건도 함께 삭제돼요. 되돌릴 수 없어요.`,
      confirmLabel: "삭제",
      tone: "danger",
    }))) return;
    const res = await fetch(`/api/webinars/${webinarId}/surveys/${survey.id}`, { method: "DELETE" });
    if (res.ok) { toast.success("설문을 삭제했어요"); onDeleted(); }
    else toast.error("삭제에 실패했어요");
  };

  const copyLink = async () => {
    const origin = getPublicAppOrigin();
    if (!origin) { toast.error("공개 주소 설정을 확인해 주세요."); return; }
    const url = `${origin}/webinar/${slug}/survey/${survey.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error("복사에 실패했어요"); }
  };

  const addQuestion = (t: SurveyQuestionType) => {
    addPop.setOpen(false);
    // 상한을 넘겨 저장하면 서버가 400 으로 막는다 → 누르기 전에 알려준다(예전엔 조용히 잘렸다).
    if (activeQuestions.length >= SURVEY_MAX_QUESTIONS) {
      toast.error(`문항은 최대 ${SURVEY_MAX_QUESTIONS}개까지예요.`);
      return;
    }
    const q: SurveyQuestion = { id: crypto.randomUUID(), type: t, title: "", required: false, options: t === "single" || t === "multiple" ? ["", ""] : [] };
    setQuestions((prev) => [...prev, q]);
  };

  const duplicateQuestion = (id: string) => {
    setQuestions((prev) => {
      const i = prev.findIndex((item) => item.id === id);
      if (i < 0) return prev;
      const copy: SurveyQuestion = { ...prev[i], id: crypto.randomUUID(), options: [...prev[i].options] };
      return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
    });
  };

  // 편집 중인 문항을 미리보기에서 하이라이트·스크롤 (미리보기 컨테이너만 스크롤 — 페이지는 안 움직이게)
  const focusQuestion = useCallback((qid: string) => {
    if (lastFocusRef.current === qid) return;
    lastFocusRef.current = qid;
    const cont = previewBodyRef.current;
    const el = cont?.querySelector<HTMLElement>(`#sv-q-${CSS.escape(qid)}`);
    if (!cont || !el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cRect = cont.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const top = cont.scrollTop + (eRect.top - cRect.top) - cont.clientHeight / 2 + eRect.height / 2;
    cont.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
    if (!reduce) {
      el.animate(
        [{ backgroundColor: `color-mix(in srgb, ${theme.accent} 9%, transparent)`, borderRadius: "12px" }, { backgroundColor: "transparent", borderRadius: "12px" }],
        { duration: 900, easing: "ease-out" },
      );
    }
  }, [theme.accent]);

  return (
    <div className="rounded-2xl bg-background p-4 shadow-sm sm:p-5">
      <div className="space-y-5 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_440px] 2xl:gap-8 2xl:space-y-0">
        {/* ---- 편집 컬럼 ---- */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="설문 제목"
                aria-label="설문 제목"
                className="w-full bg-transparent text-[16px] font-bold tracking-tight outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="설명 (선택) — 응답 페이지 상단에 표시"
                aria-label="설문 설명"
                className="mt-0.5 w-full bg-transparent text-[13px] text-muted-foreground outline-none placeholder:text-muted-foreground/40"
              />
            </div>
            <button type="button" onClick={remove} aria-label="설문 삭제" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {/* onChange 로 setActiveOrder 를 그대로 쓴다 — 재정렬과 삭제 **둘 다** 맞다.
              보관(retired) 문항을 항상 뒤에 붙여 주는 함수라 활성 목록만 다루면 된다. */}
          <EditableList<SurveyQuestion>
            listId={`survey-${survey.id}-questions`}
            itemNoun="문항"
            items={activeQuestions}
            onChange={setActiveOrder}
            rowKey={(item) => item.id}
            reorderable
            rowChrome="bare"
            // 추가는 유형을 먼저 고르는 팝오버라 목록 밖에 있다 — 골격은 그리지 않는다.
            renderAdd={() => null}
            renderRow={({ item, visibleIndex, handle, removeButton }) => (
              <QuestionRow
                q={item}
                index={visibleIndex}
                setQuestions={setQuestions}
                handle={handle}
                removeButton={removeButton}
                onDuplicate={() => duplicateQuestion(item.id)}
                onFocusQuestion={focusQuestion}
              />
            )}
          />

          <div className="relative" ref={addPop.ref}>
            <button
              type="button"
              onClick={() => addPop.setOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={addPop.open}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-secondary/40 py-2.5 text-xs font-semibold text-violet-500 transition-colors hover:bg-violet-500/10"
            >
              <Plus className="h-3.5 w-3.5" />질문 추가
            </button>
            {addPop.open && <TypeMenu onPick={addQuestion} />}
          </div>

          {/* 보관된 문항 — 지웠지만 이미 받은 답변이 있어 정의를 남겨둔 것.
              응답 화면에는 안 나오고, 분석·개별응답·CSV 에서 지난 답변을 계속 볼 수 있다.
              편집 값이 아니라 읽는 값이므로 요약만 보여준다(원칙 1: 읽는 영역). */}
          {retiredQuestions.length > 0 && (
            <div className={`space-y-1.5 bg-secondary p-3 ${R.surface} ${FINISH.s2}`}>
              <p className="text-[11px] font-semibold text-muted-foreground">
                보관된 문항 {retiredQuestions.length}개
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                지운 문항이지만 받은 답변이 있어 분석·CSV 에서 볼 수 있도록 남겨뒀어요. 응답 화면에는 나오지 않아요.
              </p>
              <ul className="space-y-1 pt-1">
                {retiredQuestions.map((q) => (
                  <li key={q.id} className="flex items-baseline gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
                      {SURVEY_TYPE_LABELS[q.type]}
                    </span>
                    <span className="break-words">{q.title || "(제목 없음)"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 제출 완료 화면 — 응답 제출 후 보이는 문구(비우면 기본 문구). 응답 링크·라이브 푸시·CTA 모달 공통 적용. */}
          <div className={`space-y-2 bg-secondary p-3 ${R.surface} ${FINISH.s2}`}>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <CircleCheckBig className="h-3.5 w-3.5 text-violet-500" />제출 완료 화면
            </p>
            <input
              value={doneTitle}
              onChange={(e) => setDoneTitle(e.target.value)}
              placeholder="완료 제목 (비우면 기본: 소중한 의견 감사합니다)"
              aria-label="제출 완료 제목"
              className="w-full bg-transparent text-[13px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
            />
            <textarea
              value={doneDescription}
              onChange={(e) => setDoneDescription(e.target.value)}
              rows={2}
              placeholder="완료 설명 (선택) — 예: 문의가 접수됐어요. 담당자가 확인 후 연락드릴게요."
              aria-label="제출 완료 설명"
              className="w-full resize-none bg-transparent text-[12px] leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          {/* 종료 화면 카드의 버튼 문구 — "설문 참여하기" 를 이 설문에서만 다른 말로 바꾸고 싶을 때.
              두 설문을 함께 걸었을 때 카드마다 다른 행동을 유도하는 문구(예: "설문 참여하기" vs
              "사전 신청하기")를 쓸 수 있어야 두 버튼이 똑같아 보이지 않는다. */}
          <div className={`space-y-1.5 bg-secondary p-3 ${R.surface} ${FINISH.s2}`}>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <MousePointerClick className="h-3.5 w-3.5 text-violet-500" />종료 화면 버튼
            </p>
            <input
              value={ctaLabel}
              onChange={(e) => setCtaLabel(e.target.value)}
              placeholder="버튼 문구 (비우면 기본: 설문 참여하기)"
              aria-label="종료 화면 버튼 문구"
              className="w-full bg-transparent text-[13px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
            />
          </div>

          {questions.some((q) => !q.title.trim()) && (
            <p className="text-[11px] text-muted-foreground/70">제목이 빈 문항은 저장은 되지만 응답 화면에는 표시되지 않아요.</p>
          )}
          {(survey._count?.responses ?? 0) > 0 && (
            <p className="text-[11px] text-amber-600">
              이미 {survey._count?.responses}건이 응답했어요 — 문항을 지우거나 선택지 문구를 바꾸면 기존 응답이 결과 집계에서 빠져요.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3">
            <label className="flex select-none items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={survey.isOpen} onChange={(v) => toggle("isOpen", v)} label="응답 받기" />
              응답 받기
            </label>
            <label className="flex select-none items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={survey.showOnEnded} onChange={(v) => toggle("showOnEnded", v)} label="종료 화면에 연결" />
              종료 화면에 연결
            </label>
            {/* 이 스위치만 켜도 시청자에게는 아무것도 안 보일 수 있다 — 종료 화면의 설문 영역이
                따로 꺼져 있으면 무시된다. 예전엔 그 사실이 어디에도 없어서 "켰는데 안 나온다" 가 됐다.
                여기서 쓰지 않고 알리는 이유: config 병합이 최상위 얕은 병합이라 이 탭에서
                livePage 를 건드리면 CTA·자료·공지가 통째로 날아간다. */}
            {survey.showOnEnded && endedSurveyAreaOn === false && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                종료 화면의 설문 영역이 꺼져 있어 시청자에게는 보이지 않아요.
                {onGoToEndedScreen && (
                  <button type="button" onClick={onGoToEndedScreen} className="font-semibold underline underline-offset-2">
                    시청 화면 › 종료에서 켜기
                  </button>
                )}
              </p>
            )}
            {/* 응답 기간 — 시작·마감을 한 줄에 나란히. 비우면 각각 "즉시 시작"·"무기한"이고,
                그 뜻은 placeholder 가 아니라 아래 안내 한 줄이 말한다(빈 datetime-local 은 tt:tt 만 보인다). */}
            <div className="flex select-none flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              <span>응답 기간</span>
              <input
                type="datetime-local"
                value={opensDraft}
                onChange={(e) => setOpensDraft(e.target.value)}
                onBlur={(e) => void commitSchedule("opensAt", e.target.value)}
                aria-label="응답 시작 예약 시각"
                className={`${FIELD_CLS} min-h-0 px-1.5 py-1 text-[11px] tabular-nums`}
              />
              {survey.opensAt && (
                <button
                  type="button"
                  onClick={() => { setOpensDraft(""); void commitSchedule("opensAt", ""); }}
                  aria-label="시작 예약 해제"
                  className="grid h-5 w-5 place-items-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <span aria-hidden className="text-muted-foreground/50">→</span>
              <input
                type="datetime-local"
                value={closesDraft}
                onChange={(e) => setClosesDraft(e.target.value)}
                onBlur={(e) => void commitSchedule("closesAt", e.target.value)}
                aria-label="응답 마감 예약 시각"
                className={`${FIELD_CLS} min-h-0 px-1.5 py-1 text-[11px] tabular-nums`}
              />
              {survey.closesAt && (
                <button
                  type="button"
                  onClick={() => { setClosesDraft(""); void commitSchedule("closesAt", ""); }}
                  aria-label="마감 예약 해제"
                  className="grid h-5 w-5 place-items-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              {scheduleNote && (
                <span className="rounded-lg bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">{scheduleNote}</span>
              )}
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70"><BarChart3 className="h-3 w-3" />응답 {survey._count?.responses ?? 0}건</span>
            {/* 검증 피드백은 해당 필드 바로 아래 인라인으로 — 저장을 시도하기 전에 알린다 */}
            {rangeError && (
              <p className="w-full text-[11px] font-medium text-destructive">{rangeError}</p>
            )}
            {!rangeError && (survey.opensAt || survey.closesAt) && (
              <p className="w-full text-[11px] leading-relaxed text-muted-foreground/70">
                {survey.opensAt ? `${formatSurveyOpensAt(survey.opensAt)}부터` : "지금부터"} {survey.closesAt ? `${formatSurveyOpensAt(survey.closesAt)}까지` : "무기한"} 받아요.
                {" "}응답 받기를 끄면 기간과 무관하게 즉시 멈춰요.
              </p>
            )}
            <button type="button" onClick={copyLink} className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <Link2 className="h-3.5 w-3.5" />{copied ? "복사됨 ✓" : "응답 링크 복사"}
            </button>
          </div>
        </div>

        {/* ---- 미리보기 컬럼 ---- */}
        <div className="min-w-0">
          <SurveyPreview
            slug={slug}
            webinarName={webinarName}
            title={title}
            description={description}
            questions={questions}
            theme={theme}
            bodyRef={previewBodyRef}
          />
        </div>
      </div>
    </div>
  );
}

export default function SurveyTab({
  webinarId,
  slug,
  webinarName,
  theme,
  endedSurveyAreaOn,
  onGoToEndedScreen,
}: {
  webinarId: string;
  slug: string;
  webinarName?: string;
  theme?: Record<string, string>;
  /**
   * 종료 화면의 설문 영역(config.livePage.ended.survey)이 켜져 있는가.
   * 꺼져 있으면 '종료 화면에 연결' 을 켜도 시청자에게 아무것도 보이지 않는다 —
   * 이 탭은 그 사실을 알려 주기만 하고, 켜는 결정은 시청 화면 › 종료 › '설문 연결' 소관이다.
   */
  endedSurveyAreaOn?: boolean;
  onGoToEndedScreen?: () => void;
}) {
  const [surveys, setSurveys] = useState<AdminSurvey[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null); // 목록↔상세(마스터-디테일)

  const viewerTheme: ViewerTheme = useMemo(() => ({
    accent: theme?.accentColor || "#6D28D9",
    text: theme?.textColor || "#141320",
    surface: theme?.surfaceColor || "#FFFFFF",
    radius: theme?.borderRadius,
  }), [theme]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/webinars/${webinarId}/surveys`);
      if (!res.ok) return;
      const data = await res.json();
      setSurveys(data.surveys ?? []);
    } catch { /* 다음 시도 */ }
  }, [webinarId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/surveys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "만족도 설문", questions: buildDefaultQuestions() }),
      });
      if (!res.ok) { toast.error("설문 생성에 실패했어요"); return; }
      const data = await res.json();
      setSurveys((prev) => [...(prev ?? []), data.survey]);
      setSelectedId(data.survey.id); // 만들면 바로 편집으로
    } finally { setCreating(false); }
  };

  // ── 상세(선택된 설문 편집) — 목록에서 클릭하면 진입 ──
  const selected = surveys?.find((s) => s.id === selectedId) ?? null;
  if (selected) {
    return (
      <div className="max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-8">
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />설문 목록
        </button>
        <SurveyEditor
          endedSurveyAreaOn={endedSurveyAreaOn}
          onGoToEndedScreen={onGoToEndedScreen}
          key={selected.id}
          webinarId={webinarId}
          slug={slug}
          webinarName={webinarName}
          theme={viewerTheme}
          survey={selected}
          onDeleted={() => { setSurveys((prev) => (prev ?? []).filter((item) => item.id !== selected.id)); setSelectedId(null); }}
          /* 종료 화면 연결은 여러 개 가능 — 예전엔 여기서 다른 설문의 배지를 내렸다(서버의
             원-액티브 강제와 짝). 서버 제약을 걷었으니 이 목록도 건드리지 않는다. */
          onMetaChanged={(patch) =>
            setSurveys((prev) => (prev ?? []).map((item) => (item.id === selected.id ? { ...item, ...patch } : item)))
          }
        />
      </div>
    );
  }

  // ── 목록 ──
  return (
    <div className="max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">설문</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            종료 화면·라이브 푸시·응답 링크에서 같은 설문으로 응답을 모아요. 결과는 분석 탭에서.
          </p>
        </div>
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.96 }}
          transition={spring}
          onClick={create}
          disabled={creating}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />새 설문
        </motion.button>
      </div>

      {surveys === null && (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      )}
      {surveys?.length === 0 && (
        <div className="space-y-2 rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">아직 설문이 없어요</p>
          <p className="text-xs text-muted-foreground">새 설문을 만들면 만족도 템플릿(별점·객관식·추천지수·주관식)으로 시작해요.</p>
        </div>
      )}

      {/* 설문 목록 — 카드 하나 = 설문 하나. 클릭하면 편집으로 (밑으로 길게 쌓이지 않게) */}
      {surveys && surveys.length > 0 && (
        <div className="space-y-2">
          {surveys.map((s) => {
            const qCount = s.questions.filter((q) => q.title.trim() && !((q.type === "single" || q.type === "multiple") && q.options.filter(Boolean).length === 0)).length;
            // 상태를 이유까지 구분한다 — "시작 전" 을 "마감" 이라 부르면 운영자가 예약을 지운다
            const state = surveyOpenState(s);
            const accepting = state === "open";
            const stateLabel = { open: "응답 받는 중", before: "시작 전", closed: "마감", off: "마감" }[state];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className="group flex w-full items-center gap-3 rounded-2xl bg-background p-4 text-left shadow-sm transition-all hover:shadow-md hover:ring-1 hover:ring-violet-400/40"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
                  <ClipboardList className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{s.title || "제목 없는 설문"}</span>
                    {s.isActive && <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400">송출 중</span>}
                    {s.showOnEnded && <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">종료 화면</span>}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${accepting ? "bg-green-500/10 text-green-600 dark:text-green-400" : state === "before" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-secondary text-muted-foreground"}`}>
                      {stateLabel}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground tabular-nums">
                    {qCount}문항 · 응답 {(s._count?.responses ?? 0).toLocaleString()}건
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-violet-500" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
