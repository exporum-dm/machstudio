"use client";

// 운영 콘솔 — 라이브 당일의 단일 화면.
// 상태 수동 전환 / KPI / 공지·Q&A·팝업·Tally 발행 / 접속자.
// 폴링은 상태 적응형: 라이브 15초, 평시 90초 (+ 탭 숨김 가드) — egress 배려.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import {
  Activity,
  Ban,
  BarChart3,
  Bell,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Eye,
  ChevronRight,
  HelpCircle,
  Inbox,
  ListChecks,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  MessageSquarePlus,
  Pin,
  RefreshCw,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import QATab from "./QATab";
import AnnouncementsTab from "./AnnouncementsTab";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { WEBINAR_STATUS_META } from "@/lib/webinar-status";
import { surveyOpenState, type SurveyQuestion } from "@/lib/webinar-survey";
import { formatKst } from "@/lib/datetime";
import { isHttpUrlOrSitePath, LIVE_SESSION_SLOTS, normalizeLiveSessionDisplay, type LiveSessionSlot } from "@/lib/webinar-config";
import { UrlField } from "@/components/ui/primitives";
import { isPauseSession, isRealSession, resolveLiveSessionHighlights, sessionTypeLabel } from "@/lib/webinar-sessions";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

type WebinarStatus = "upcoming" | "registration" | "live" | "ended";

interface DashboardSummary {
  totalRegistered: number;
  attended: number;
  activeViewers: number;
  presenceViewers: number;
  pendingQuestions: number;
  attendRate: number;
  avgStayMinutes: number;
}

interface CurrentViewer {
  id: string;
  name: string;
  company: string | null;
  enteredAt: string | null;
  currentStayMinutes: number;
  isLive: boolean;
}

interface DashboardData {
  status: WebinarStatus;
  isOverridden: boolean;
  summary: DashboardSummary;
  currentViewers: CurrentViewer[];
}

interface AdminPopup {
  id: string;
  type: string;
  title: string;
  message: string | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
  integrationType: string;
  tallyFormId: string | null;
  isActive: boolean;
  createdAt: string;
}

interface AdminTallyPush {
  id: string;
  title: string;
  formId: string;
  memo: string | null;
  isActive: boolean;
  createdAt: string;
}

interface AdminSurveyPush {
  id: string;
  title: string;
  isActive: boolean;
  isOpen: boolean;
  // 응답 기간 — 둘 다 판정에 들어간다. 하나라도 타입에서 빠지면 isSurveyAcceptingResponses 가
  // undefined 를 "설정 없음" 으로 보고 "받는 중" 이라 답한다(시작 전 설문을 열린 것처럼 표시).
  opensAt?: string | null;
  closesAt?: string | null;
  _count?: { responses: number };
}

interface AdminPollOption {
  id: string;
  label: string;
  order: number;
  voteCount: number;
}

interface AdminPoll {
  id: string;
  question: string;
  isActive: boolean;
  createdAt: string;
  options: AdminPollOption[];
}

interface WebinarForConsole {
  config: Record<string, unknown>;
  components?: Record<string, unknown> | null;
  liveStartAt?: string;
  liveEndAt?: string;
  sessions: { id: string; number: number; type: string; title: string; startTime: string; endTime: string }[];
  _count: { registrations: number };
}

// 상태 라벨·톤은 lib/webinar-status 의 WEBINAR_STATUS_META 단일 정의 사용
const STATUS_META = WEBINAR_STATUS_META;

// 차트에 마커로 표시할 운영 이벤트(송출·발행·발송) 종류
const CHART_EVENT_ACTIONS = new Set([
  "webinar.poll_created", "webinar.poll_updated",
  "webinar.announcement_created", "webinar.announcement_updated",
  "webinar.popup_updated", "webinar.tally_push_updated", "webinar.reminder_sent",
  "webinar.survey_updated",
]);

function Section({
  title,
  icon: Icon,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: typeof Bell;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <section className="rounded-2xl border border-border bg-card shadow-card">
      <motion.button
        whileTap={{ scale: 0.99 }}
        transition={spring}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 p-4 text-left sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
          <Icon className="h-4 w-4 shrink-0 text-violet-500" />
          <span className="truncate">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badge}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </motion.button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-4 sm:p-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{children}</p>;
}

/* ── 팝업 발행 패널 ── */
function PopupPanel({ webinarId }: { webinarId: string }) {
  const confirm = useConfirm();
  const [popups, setPopups] = useState<AdminPopup[]>([]);
  const [form, setForm] = useState({ type: "notice", title: "", message: "", buttonLabel: "", buttonUrl: "", tallyFormId: "", useTally: false });
  const [busy, setBusy] = useState(false);

  const fetchPopups = useCallback(async () => {
    const res = await fetch(`/api/webinars/${webinarId}/popups`);
    if (res.ok) setPopups((await res.json()).popups ?? []);
  }, [webinarId]);
  useEffect(() => { void fetchPopups(); }, [fetchPopups]);

  const create = async () => {
    if (!form.title.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/popups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: form.type,
          title: form.title,
          message: form.message,
          buttonLabel: form.buttonLabel,
          buttonUrl: form.useTally ? null : form.buttonUrl,
          integrationType: form.useTally ? "tally" : "link",
          tallyFormId: form.useTally ? form.tallyFormId : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("팝업이 등록됐어요. 목록에서 ON으로 켜면 시청자에게 표시돼요.");
      setForm({ type: "notice", title: "", message: "", buttonLabel: "", buttonUrl: "", tallyFormId: "", useTally: false });
      void fetchPopups();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "팝업 등록에 실패했어요");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (popup: AdminPopup) => {
    const res = await fetch(`/api/webinars/${webinarId}/popups/${popup.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !popup.isActive }),
    });
    // 실패를 무음 처리하면 "켰다고 믿는데 시청자에겐 안 뜨는" 라이브 사고가 된다.
    if (!res.ok) {
      toast.error(res.status === 409 ? "다른 팝업이 방금 켜졌어요. 목록을 새로고침했어요." : "변경에 실패했어요");
      void fetchPopups();
      return;
    }
    toast.success(popup.isActive ? "팝업을 껐어요" : "팝업이 시청자에게 표시돼요 (다른 팝업은 자동 OFF)");
    void fetchPopups();
  };

  const remove = async (popup: AdminPopup) => {
    if (!(await confirm({ title: "팝업을 삭제할까요?", description: `"${popup.title}"`, confirmLabel: "삭제", tone: "danger" }))) return;
    const res = await fetch(`/api/webinars/${webinarId}/popups/${popup.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제에 실패했어요"); void fetchPopups(); return; }
    toast.success("삭제했어요");
    void fetchPopups();
  };

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-violet-400";

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-border bg-background/60 p-3.5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[130px_1fr]">
          <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className={inputCls}>
            <option value="notice">안내</option>
            <option value="survey">설문 유도</option>
            <option value="cta">바로가기</option>
            <option value="urgent">중요 공지</option>
          </select>
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="팝업 제목 *" className={inputCls} />
        </div>
        <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder="내용 (선택)" rows={2} className={`${inputCls} resize-none`} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input value={form.buttonLabel} onChange={(e) => setForm((f) => ({ ...f, buttonLabel: e.target.value }))} placeholder="버튼 라벨 (선택)" className={inputCls} />
          {form.useTally ? (
            <input value={form.tallyFormId} onChange={(e) => setForm((f) => ({ ...f, tallyFormId: e.target.value }))} placeholder="Tally 폼 ID" className={inputCls} />
          ) : (
            /* 스킴 없이 적으면 시청자 화면의 버튼이 죽는다(값은 남고 링크만 안 먹는다) —
               라이브 중에 발견되는 종류의 사고라 입력 시점에 막는다. */
            <UrlField label="버튼 URL" value={form.buttonUrl} onChange={(buttonUrl) => setForm((f) => ({ ...f, buttonUrl }))} placeholder="버튼 URL — https://… 또는 /내부경로" isValidHttpUrl={isHttpUrlOrSitePath} invalidMessage="https:// 로 시작하는 주소이거나, / 로 시작하는 사이트 내부 경로여야 해요." />
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={form.useTally} onChange={(e) => setForm((f) => ({ ...f, useTally: e.target.checked }))} className="accent-violet-500" />
            버튼을 Tally 설문으로 연결
          </label>
          <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} onClick={create} disabled={!form.title.trim() || busy}
            className="rounded-lg bg-violet-500 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50">
            {busy ? "등록 중…" : "팝업 등록"}
          </motion.button>
        </div>
      </div>

      {popups.length === 0 ? (
        <p className="text-xs text-muted-foreground">등록된 팝업이 없어요. ON 상태 팝업 1개만 시청자에게 표시돼요.</p>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {popups.map((popup) => (
              <motion.div
                key={popup.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${popup.isActive ? "border-green-500/40 bg-green-500/[0.06]" : "border-border"}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {popup.isActive && <span className="mr-1.5 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400">ON</span>}
                    {popup.title}
                  </p>
                  {popup.message && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{popup.message}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => toggle(popup)} className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${popup.isActive ? "border-border text-muted-foreground hover:bg-secondary" : "border-green-500/40 text-green-600 dark:text-green-400 hover:bg-green-500/10"}`}>
                    {popup.isActive ? "OFF" : "ON"}
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => remove(popup)} className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500">삭제</motion.button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* ── 자체 설문 푸시 패널 — 설문 작성은 만들기 → 설문, 콘솔에선 발행/중지만 ── */
function SurveyPushPanel({ webinarId }: { webinarId: string }) {
  // opensAt 을 빼면 surveyOpenState 가 "시작 예약 없음" 으로 읽어 시작 전 설문을 받는 중이라 답한다
  const [surveys, setSurveys] = useState<{ id: string; title: string; isActive: boolean; isOpen: boolean; opensAt?: string | null; closesAt?: string | null; questions?: unknown[]; _count?: { responses: number } }[]>([]);

  const fetchSurveys = useCallback(async () => {
    const res = await fetch(`/api/webinars/${webinarId}/surveys`);
    if (res.ok) setSurveys((await res.json()).surveys ?? []);
  }, [webinarId]);
  useEffect(() => { void fetchSurveys(); }, [fetchSurveys]);

  const toggle = async (s: { id: string; title: string; isActive: boolean }) => {
    const res = await fetch(`/api/webinars/${webinarId}/surveys/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !s.isActive }),
    });
    if (!res.ok) {
      toast.error(res.status === 409 ? "다른 설문이 방금 발행됐어요. 새로고침 후 다시 시도해주세요." : "변경에 실패했어요");
      return;
    }
    toast.success(s.isActive ? "설문 발행을 중지했어요" : "시청자 화면에 설문이 표시돼요");
    void fetchSurveys();
  };

  return (
    <div className="space-y-2">
      {surveys.length === 0 ? (
        <p className="text-xs text-muted-foreground">아직 설문이 없어요. 만들기 → 설문에서 먼저 만들어주세요.</p>
      ) : (
        surveys.map((s) => {
          // 응답 기간(시작·마감 예약)을 벗어나면 발행해도 live-state 가 걸러 시청자에게 안 나간다 —
          // 그래서 콘솔에서도 막는다. 다만 **이유를 말한다**: 시작 전을 "마감" 이라 하면 예약을 지운다.
          const state = surveyOpenState(s);
          const accepting = state === "open";
          return (
          <div key={s.id} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${s.isActive ? "border-green-500/40 bg-green-500/[0.06]" : "border-border"}`}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {s.isActive && <span className="mr-1.5 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400">송출 중</span>}
                {s.title}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">응답 {s._count?.responses ?? 0}건{state === "before" ? " · 시작 전" : state === "closed" ? " · 예약 마감됨" : state === "off" ? " · 마감됨" : ""}</p>
            </div>
            <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => toggle(s)} disabled={!accepting && !s.isActive}
              className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${s.isActive ? "border-border text-muted-foreground hover:bg-secondary" : "border-green-500/40 text-green-600 dark:text-green-400 hover:bg-green-500/10"}`}>
              {s.isActive ? "발행 중지" : "발행"}
            </motion.button>
          </div>
          );
        })
      )}
      <p className="text-[11px] text-muted-foreground">발행하면 시청자 화면에 설문 모달이 떠요. 문항 편집·결과는 만들기 → 설문 / 분석 탭에서.</p>
    </div>
  );
}

/* ── 문의·폼 응답 피드 — CTA 폼/설문으로 들어온 응답을 최신순으로. 누가·무엇을 남겼는지 실시간 확인. ── */
interface InquiryResponse {
  id: string;
  surveyId: string;
  surveyTitle: string;
  submittedAt: string;
  source: string | null;
  answers: Record<string, unknown>;
  registrant: { id: string; name: string; company: string | null; email: string | null; phone: string | null } | null;
}
const SOURCE_LABEL: Record<string, string> = { live: "라이브", ended: "종료 화면", link: "링크" };

function inquiryAnswerText(q: SurveyQuestion, answer: unknown): string {
  if (answer === undefined || answer === null || answer === "") return "";
  const v = Array.isArray(answer) ? answer.join(", ") : String(answer);
  return q.type === "rating" || q.type === "nps" ? `${v}점` : v;
}

function InquiryPanel({ webinarId, tick = 0, onNavigate }: { webinarId: string; tick?: number; onNavigate?: (target: string) => void }) {
  const [responses, setResponses] = useState<InquiryResponse[]>([]);
  const [surveys, setSurveys] = useState<Record<string, { title: string; questions: SurveyQuestion[] }>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [surveyOrder, setSurveyOrder] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<string>("all"); // "all" | surveyId
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const my = ++reqRef.current;
    (async () => {
      try {
        const qs = filter === "all" ? "" : `?surveyId=${encodeURIComponent(filter)}`;
        const res = await fetch(`/api/webinars/${webinarId}/survey-responses${qs}`);
        if (cancelled || my !== reqRef.current) return;
        if (!res.ok) { setLoaded(true); return; }
        const data = await res.json();
        setResponses(data.responses ?? []);
        setSurveys(data.surveys ?? {});
        setCounts(data.counts ?? {});
        setSurveyOrder(data.surveyOrder ?? []);
        setTotal(data.total ?? 0);
        // 필터 중이던 폼이 삭제됐으면(카운트에서 사라짐) 전체로 복귀 — 유령 필터에 고착 방지
        if (filter !== "all" && !(data.surveys ?? {})[filter]) setFilter("all");
      } catch { /* 다음 주기 재시도 */ } finally {
        if (!cancelled && my === reqRef.current) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [webinarId, tick, filter]);

  if (!loaded) {
    return <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  }

  // 응답이 하나도 없으면(전체 기준) 빈 상태 — 필터 칩도 숨긴다
  if (total === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-3 text-xs leading-relaxed text-muted-foreground">
        아직 들어온 문의·폼 응답이 없어요. 만들기 → 시청 화면 → 라이브의 CTA 버튼에 폼을 연결하면, 시청자가 남긴 문의가 여기로 실시간으로 모여요.
      </p>
    );
  }

  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${active ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`;
  // 필터 칩에 노출할 폼 — 응답 1건 이상인 폼만(만든 순)
  const chipSurveys = surveyOrder.filter((sid) => (counts[sid] ?? 0) > 0);
  const viewTotal = filter === "all" ? total : (counts[filter] ?? responses.length);

  return (
    <div className="space-y-2">
      {/* 전체 + 폼(CTA 연결)별 필터 */}
      <div className="flex flex-wrap gap-1.5 pb-0.5">
        <button type="button" onClick={() => setFilter("all")} className={chipCls(filter === "all")} aria-pressed={filter === "all"}>
          전체 <span className="tabular-nums opacity-70">{total.toLocaleString()}</span>
        </button>
        {chipSurveys.map((sid) => (
          <button key={sid} type="button" onClick={() => setFilter(sid)} className={chipCls(filter === sid)} aria-pressed={filter === sid}>
            <span className="max-w-[160px] truncate">{surveys[sid]?.title ?? "폼"}</span>
            <span className="tabular-nums opacity-70">{(counts[sid] ?? 0).toLocaleString()}</span>
          </button>
        ))}
      </div>

      {responses.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">이 폼에는 아직 응답이 없어요.</p>
      ) : (
      <div className="space-y-1.5">
        {responses.map((r) => {
          const qs = surveys[r.surveyId]?.questions ?? [];
          const answered = qs
            .map((q) => ({ q, text: inquiryAnswerText(q, r.answers?.[q.id]) }))
            .filter((a) => a.text !== "");
          const preview = answered.map((a) => a.text).join(" · ");
          const open = expanded === r.id;
          return (
            <div key={r.id} className={`rounded-xl border transition-colors ${open ? "border-violet-500/40 bg-violet-500/[0.04]" : "border-border bg-secondary/20"}`}>
              <button
                type="button"
                onClick={() => setExpanded(open ? null : r.id)}
                aria-expanded={open}
                className="flex w-full items-start gap-2.5 p-3 text-left"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-semibold text-violet-600 dark:text-violet-400" aria-hidden>
                  {r.registrant?.name?.[0] ?? "익"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="text-xs font-semibold">{r.registrant?.name ?? "익명"}</span>
                    {r.registrant?.company && <span className="text-[11px] text-muted-foreground">{r.registrant.company}</span>}
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{r.surveyTitle}</span>
                  </span>
                  {!open && preview && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{preview}</span>}
                </span>
                <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
                  {formatKst(r.submittedAt, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
                </span>
              </button>

              {open && (
                <div className="space-y-2.5 border-t border-border/60 px-3 pb-3 pt-2.5">
                  {(r.registrant?.email || r.registrant?.phone) && (
                    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {r.registrant?.email && <span>{r.registrant.email}</span>}
                      {r.registrant?.phone && <span>{r.registrant.phone}</span>}
                    </p>
                  )}
                  {answered.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">기록된 답변이 없어요.</p>
                  ) : (
                    <dl className="space-y-2">
                      {answered.map(({ q, text }) => (
                        <div key={q.id} className="space-y-0.5">
                          <dt className="text-[11px] text-muted-foreground">{q.title}</dt>
                          <dd className="whitespace-pre-wrap break-words text-xs leading-relaxed">{text}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="text-[10px] text-muted-foreground">{SOURCE_LABEL[r.source ?? ""] ?? "링크"} 유입{r.registrant ? " · 등록자 연결됨" : " · 익명(비등록)"}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <p className="text-[11px] text-muted-foreground">
          {filter === "all" ? "" : "이 폼 "}최근 {responses.length}건{viewTotal > responses.length && ` · 전체 ${viewTotal.toLocaleString()}건`}
        </p>
        {onNavigate && (
          <button type="button" onClick={() => onNavigate("operate-registrants")} className="inline-flex items-center gap-0.5 text-[11px] font-medium text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-400">
            등록자에서 전체 보기<ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Tally 단독 푸시 패널 ── */
function TallyPanel({ webinarId }: { webinarId: string }) {
  const confirm = useConfirm();
  const [pushes, setPushes] = useState<AdminTallyPush[]>([]);
  const [form, setForm] = useState({ title: "", formId: "", memo: "" });
  const [busy, setBusy] = useState(false);

  const fetchPushes = useCallback(async () => {
    const res = await fetch(`/api/webinars/${webinarId}/tally-pushes`);
    if (res.ok) setPushes((await res.json()).tallyPushes ?? []);
  }, [webinarId]);
  useEffect(() => { void fetchPushes(); }, [fetchPushes]);

  const create = async () => {
    if (!form.formId.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/tally-pushes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Tally 푸시가 등록됐어요. ON으로 켜면 시청자 화면에 설문이 바로 떠요.");
      setForm({ title: "", formId: "", memo: "" });
      void fetchPushes();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "등록에 실패했어요");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (push: AdminTallyPush) => {
    const res = await fetch(`/api/webinars/${webinarId}/tally-pushes/${push.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !push.isActive }),
    });
    if (!res.ok) {
      toast.error(res.status === 409 ? "다른 푸시가 방금 켜졌어요. 목록을 새로고침했어요." : "변경에 실패했어요");
      void fetchPushes();
      return;
    }
    toast.success(push.isActive ? "푸시를 껐어요" : "시청자 화면에 설문이 표시돼요 (다른 푸시는 자동 OFF)");
    void fetchPushes();
  };

  const remove = async (push: AdminTallyPush) => {
    if (!(await confirm({ title: "푸시를 삭제할까요?", description: `"${push.title}"`, confirmLabel: "삭제", tone: "danger" }))) return;
    const res = await fetch(`/api/webinars/${webinarId}/tally-pushes/${push.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제에 실패했어요"); void fetchPushes(); return; }
    toast.success("삭제했어요");
    void fetchPushes();
  };

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-violet-400";

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-border bg-background/60 p-3.5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="푸시 제목 (예: 만족도 조사)" className={inputCls} />
          <input value={form.formId} onChange={(e) => setForm((f) => ({ ...f, formId: e.target.value }))} placeholder="Tally 폼 ID 또는 임베드 코드 *" className={inputCls} />
        </div>
        <div className="flex items-center gap-2">
          <input value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} placeholder="메모 (선택)" className={inputCls} />
          <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} onClick={create} disabled={!form.formId.trim() || busy}
            className="shrink-0 rounded-lg bg-violet-500 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50">
            {busy ? "등록 중…" : "푸시 등록"}
          </motion.button>
        </div>
        <p className="text-[11px] text-muted-foreground">응답자의 등록 ID가 hidden field로 함께 전송돼 나중에 등록 데이터와 매칭할 수 있어요.</p>
      </div>

      {pushes.length === 0 ? (
        <p className="text-xs text-muted-foreground">등록된 Tally 푸시가 없어요.</p>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {pushes.map((push) => (
              <motion.div
                key={push.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${push.isActive ? "border-green-500/40 bg-green-500/[0.06]" : "border-border"}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {push.isActive && <span className="mr-1.5 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400">ON</span>}
                    {push.title}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">{push.formId}</span>
                  </p>
                  {push.memo && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{push.memo}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => toggle(push)} className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${push.isActive ? "border-border text-muted-foreground hover:bg-secondary" : "border-green-500/40 text-green-600 dark:text-green-400 hover:bg-green-500/10"}`}>
                    {push.isActive ? "OFF" : "ON"}
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => remove(push)} className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500">삭제</motion.button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* ── 운영 콘솔 본체 ── */
/* ── 실시간 투표 패널 ── */
function PollPanel({ webinarId, tick = 0 }: { webinarId: string; tick?: number }) {
  const confirm = useConfirm();
  const [polls, setPolls] = useState<AdminPoll[]>([]);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editOptions, setEditOptions] = useState<{ id: string; label: string }[]>([]);

  // 인플라이트 펜스 — 늦게 도착한 tick 응답이 방금 켠 ON/OFF 를 stale 값으로 되돌리지 않게.
  const pollReqRef = useRef(0);
  const mutatingRef = useRef(false);
  const fetchPolls = useCallback(async () => {
    const my = ++pollReqRef.current;
    const res = await fetch(`/api/webinars/${webinarId}/polls`);
    if (my !== pollReqRef.current) return; // 더 새 요청이 출발했다 — 이 응답은 버린다
    if (res.ok) setPolls((await res.json()).polls ?? []);
  }, [webinarId]);
  useEffect(() => { void fetchPolls(); }, [fetchPolls]);
  // 라이브 주기(tick)마다 집계 갱신 — 단, 편집 중엔 스킵해 입력 중 폼이 서버값으로 덮이지 않게
  const editIdRef = useRef(editId);
  editIdRef.current = editId;
  // 마운트 시 tick 효과 중복 발화 방지 — 초기 1회는 위 마운트 효과가 담당하고, tick 실제 변화에만 갱신.
  const tickMountedRef = useRef(false);
  useEffect(() => {
    if (!tickMountedRef.current) { tickMountedRef.current = true; return; }
    if (tick > 0 && !editIdRef.current && !mutatingRef.current) void fetchPolls();
  }, [tick, fetchPolls]);

  const create = async () => {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || opts.length < 2 || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/polls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, options: opts }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("투표가 등록됐어요. ON으로 켜면 시청자 화면 우하단에 표시돼요.");
      setQuestion("");
      setOptions(["", ""]);
      void fetchPolls();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "투표 등록에 실패했어요");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (poll: AdminPoll) => {
    mutatingRef.current = true;
    try {
      const res = await fetch(`/api/webinars/${webinarId}/polls/${poll.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !poll.isActive }),
      });
      if (!res.ok) {
        toast.error(res.status === 409 ? "다른 투표가 방금 켜졌어요. 목록을 새로고침했어요." : "변경에 실패했어요");
        await fetchPolls();
        return;
      }
      toast.success(poll.isActive ? "투표를 껐어요" : "투표가 시청자에게 표시돼요 (다른 투표는 자동 OFF)");
      await fetchPolls();
    } finally {
      mutatingRef.current = false;
    }
  };

  const remove = async (poll: AdminPoll) => {
    if (!(await confirm({ title: "투표를 삭제할까요?", description: `"${poll.question}" — 응답 기록도 함께 삭제돼요.`, confirmLabel: "삭제", tone: "danger" }))) return;
    mutatingRef.current = true;
    try {
      const res = await fetch(`/api/webinars/${webinarId}/polls/${poll.id}`, { method: "DELETE" });
      if (!res.ok) { toast.error("삭제에 실패했어요"); await fetchPolls(); return; }
      toast.success("삭제했어요");
      await fetchPolls();
    } finally {
      mutatingRef.current = false;
    }
  };

  const startEdit = (poll: AdminPoll) => {
    setEditId(poll.id);
    setEditQuestion(poll.question);
    setEditOptions(poll.options.map((o) => ({ id: o.id, label: o.label })));
  };

  const saveEdit = async () => {
    if (!editId || !editQuestion.trim()) return;
    const res = await fetch(`/api/webinars/${webinarId}/polls/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: editQuestion, options: editOptions }),
    });
    if (res.ok) { toast.success("수정했어요"); setEditId(null); void fetchPolls(); }
    else toast.error("수정에 실패했어요");
  };

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-violet-400";

  return (
    <div className="space-y-4">
      {/* 생성 폼 */}
      <div className="space-y-2 rounded-xl border border-border bg-background/60 p-3.5">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="투표 질문 *" className={inputCls} />
        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={opt} onChange={(e) => setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))} placeholder={`선택지 ${i + 1}`} className={inputCls} />
              {options.length > 2 && (
                <button type="button" onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))} aria-label="선택지 삭제" className="shrink-0 rounded-lg border border-border px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500">×</button>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          {options.length < 8 ? (
            <button type="button" onClick={() => setOptions((prev) => [...prev, ""])} className="text-xs font-medium text-violet-500 hover:underline">+ 선택지 추가</button>
          ) : <span />}
          <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} onClick={create} disabled={!question.trim() || options.filter((o) => o.trim()).length < 2 || busy}
            className="rounded-lg bg-violet-500 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50">
            {busy ? "등록 중…" : "투표 등록"}
          </motion.button>
        </div>
      </div>

      {polls.length === 0 ? (
        <p className="text-xs text-muted-foreground">등록된 투표가 없어요. ON 상태 투표 1개만 시청자 우하단에 표시돼요.</p>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {polls.map((poll) => {
              const total = poll.options.reduce((s, o) => s + o.voteCount, 0);
              const editing = editId === poll.id;
              return (
                <motion.div
                  key={poll.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className={`rounded-xl border p-3 ${poll.isActive ? "border-green-500/40 bg-green-500/[0.06]" : "border-border"}`}
                >
                  {editing ? (
                    <div className="space-y-2">
                      <input value={editQuestion} onChange={(e) => setEditQuestion(e.target.value)} className={inputCls} />
                      {editOptions.map((o, i) => (
                        <input key={o.id} value={o.label} onChange={(e) => setEditOptions((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={inputCls} />
                      ))}
                      <p className="text-[10px] text-muted-foreground">선택지 개수 변경은 새 투표로 만들어주세요 (응답 보존을 위해 문구만 수정돼요).</p>
                      <div className="flex justify-end gap-1.5">
                        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setEditId(null)} className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary">취소</motion.button>
                        <motion.button whileTap={{ scale: 0.9 }} onClick={saveEdit} className="rounded-lg bg-violet-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-600">저장</motion.button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {poll.isActive && <span className="mr-1.5 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400">ON</span>}
                            {poll.question}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{poll.options.length}개 선택지 · 총 {total}표</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => toggle(poll)} className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${poll.isActive ? "border-border text-muted-foreground hover:bg-secondary" : "border-green-500/40 text-green-600 dark:text-green-400 hover:bg-green-500/10"}`}>
                            {poll.isActive ? "OFF" : "ON"}
                          </motion.button>
                          <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => startEdit(poll)} className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary">수정</motion.button>
                          <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => remove(poll)} className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500">삭제</motion.button>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1">
                        {poll.options.map((o) => {
                          const pct = total > 0 ? Math.round((o.voteCount / total) * 100) : 0;
                          return (
                            <div key={o.id} className="relative overflow-hidden rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px]">
                              <div className="absolute inset-y-0 left-0 bg-violet-500/10" style={{ width: `${pct}%` }} />
                              <div className="relative flex items-center justify-between">
                                <span className="truncate">{o.label}</span>
                                <span className="tabular-nums text-muted-foreground">{o.voteCount}표 · {pct}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* ── 실시간 채팅 모더레이션 패널 ── */
interface AdminChatMessage {
  id: string;
  name: string;
  message: string;
  isHost: boolean;
  isPinned: boolean;
  registrationId: string | null;
  createdAt: string;
}

// 토글 스위치 — 채팅 on/off·모더레이션 설정 등에서 공용.
function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-violet-500" : "border border-border bg-secondary"}`}>
      <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-[3px]"}`} />
    </button>
  );
}

function ChatPanel({ webinarId, tick = 0, fillHeight = false, onEnabledChange }: { webinarId: string; tick?: number; fillHeight?: boolean; onEnabledChange?: (v: boolean) => void }) {
  const confirm = useConfirm();
  const [messages, setMessages] = useState<AdminChatMessage[]>([]);
  const [hostMsg, setHostMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<{ chatEnabled: boolean; hideLinks: boolean; slowSec: number; bannedWords: string[]; bannedCount: number }>({ chatEnabled: false, hideLinks: true, slowSec: 0, bannedWords: [], bannedCount: 0 });
  const [showBanned, setShowBanned] = useState(false);
  const [slowInput, setSlowInput] = useState("0");
  const [bannedInput, setBannedInput] = useState("");
  const [savingMod, setSavingMod] = useState(false);
  const seededRef = useRef(false);
  // 진행 중 mutation(고정·차단·설정) 동안 사일런트 폴링이 상태를 덮지 않게 가드 + 인플라이트 응답 펜스.
  const mutatingRef = useRef(false);
  const reqIdRef = useRef(0);

  const fetchMessages = useCallback(async () => {
    const gen = ++reqIdRef.current;
    const res = await fetch(`/api/webinars/${webinarId}/chat`);
    if (res.ok) {
      const d = await res.json();
      // 요청 출발 후 mutation 이 reqId 를 올렸으면(=그 사이 고정/차단/저장 발생) 이 응답은 버린다.
      if (gen !== reqIdRef.current) { setLoading(false); return; }
      setMessages(d.messages ?? []);
      if (d.settings) {
        setSettings({ chatEnabled: !!d.settings.chatEnabled, hideLinks: d.settings.hideLinks !== false, slowSec: d.settings.slowSec ?? 0, bannedWords: d.settings.bannedWords ?? [], bannedCount: d.settings.bannedCount ?? 0 });
        onEnabledChange?.(!!d.settings.chatEnabled); // 헤더 켜짐/꺼짐 스위치를 폴링 값과 동기화(다른 창·설정탭 변경 반영)
        // 입력 버퍼는 최초 1회만 시드 — 폴링이 편집 중 값을 덮지 않게.
        if (!seededRef.current) { seededRef.current = true; setSlowInput(String(d.settings.slowSec ?? 0)); setBannedInput((d.settings.bannedWords ?? []).join(", ")); }
      }
    }
    setLoading(false);
  }, [webinarId]);
  useEffect(() => { void fetchMessages(); }, [fetchMessages]);
  // 라이브 주기(tick)마다 모더레이션 피드 갱신(mutation 중엔 스킵 — 낙관적 갱신 보호)
  useEffect(() => { if (tick > 0 && !mutatingRef.current) void fetchMessages(); }, [tick, fetchMessages]);

  const sendHost = async () => {
    if (!hostMsg.trim() || busy || !settings.chatEnabled) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: hostMsg }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("운영자 메시지를 보냈어요");
      setHostMsg("");
      void fetchMessages();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "전송에 실패했어요");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: AdminChatMessage) => {
    if (!(await confirm({ title: "메시지를 삭제할까요?", description: `"${m.message.slice(0, 40)}"`, confirmLabel: "삭제", tone: "danger" }))) return;
    // 다른 mutation 과 동일한 펜스 — 삭제 직후 늦게 온 폴링이 지운 메시지를 되살리지 않게.
    mutatingRef.current = true; reqIdRef.current++;
    try {
      const res = await fetch(`/api/webinars/${webinarId}/chat/${m.id}`, { method: "DELETE" });
      if (res.ok) { toast.success("삭제했어요"); setMessages((prev) => prev.filter((x) => x.id !== m.id)); }
      else toast.error("삭제에 실패했어요");
    } finally { mutatingRef.current = false; }
  };

  // 고정 — 웨비나당 1개(켜면 나머지 고정 해제). 채팅이 꺼져 있으면 고정해도 시청자에게 안 보인다.
  const togglePin = async (m: AdminChatMessage) => {
    if (!settings.chatEnabled) return;
    mutatingRef.current = true;
    reqIdRef.current++;
    try {
      const next = !m.isPinned;
      const res = await fetch(`/api/webinars/${webinarId}/chat/${m.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isPinned: next }),
      });
      if (!res.ok) { toast.error("고정하지 못했어요"); return; }
      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, isPinned: next } : (next ? { ...x, isPinned: false } : x)));
      toast.success(next ? "메시지를 고정했어요" : "고정을 해제했어요");
    } finally { mutatingRef.current = false; }
  };

  // 차단 — 작성 시청자를 채팅에서 차단하고 기존 메시지 정리.
  const ban = async (m: AdminChatMessage) => {
    if (!m.registrationId) { toast.error("이 메시지는 차단할 수 없어요(익명)"); return; }
    if (!(await confirm({ title: `${m.name}님을 차단할까요?`, description: "이 시청자는 더 이상 채팅할 수 없고, 남긴 메시지는 삭제돼요.", confirmLabel: "차단", tone: "danger" }))) return;
    mutatingRef.current = true;
    reqIdRef.current++;
    try {
      const res = await fetch(`/api/webinars/${webinarId}/chat/${m.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ban: true }),
      });
      if (!res.ok) { toast.error("차단하지 못했어요"); return; }
      toast.success("차단했어요");
      setMessages((prev) => prev.filter((x) => x.registrationId !== m.registrationId));
      setSettings((s) => ({ ...s, bannedCount: s.bannedCount + 1 }));
    } finally { mutatingRef.current = false; }
  };

  const saveMod = async () => {
    setSavingMod(true);
    mutatingRef.current = true;
    reqIdRef.current++;
    try {
      const bannedWords = bannedInput.split(",").map((w) => w.trim()).filter(Boolean);
      const res = await fetch(`/api/webinars/${webinarId}/chat`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slowSec: Number(slowInput) || 0, bannedWords }),
      });
      if (!res.ok) { toast.error("설정 저장 실패"); return; }
      setSettings((s) => ({ ...s, slowSec: Number(slowInput) || 0, bannedWords }));
      toast.success("모더레이션 설정을 저장했어요");
    } finally { setSavingMod(false); mutatingRef.current = false; }
  };

  // 채팅 on/off · 천천히 모드 · 링크 자동 숨김 토글 — 설정 PATCH 재사용, 낙관적 반영.
  const patchChat = async (body: Record<string, unknown>, apply: () => void) => {
    mutatingRef.current = true; reqIdRef.current++;
    try {
      const res = await fetch(`/api/webinars/${webinarId}/chat`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { toast.error("변경에 실패했어요"); return; }
      apply();
    } finally { mutatingRef.current = false; }
  };
  const toggleHideLinks = () => { const next = !settings.hideLinks; void patchChat({ hideLinks: next }, () => setSettings((s) => ({ ...s, hideLinks: next }))); };
  const toggleSlow = () => { const next = settings.slowSec > 0 ? 0 : 10; void patchChat({ slowSec: next }, () => { setSettings((s) => ({ ...s, slowSec: next })); setSlowInput(String(next)); }); };

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-violet-400";

  // 고정 메시지를 맨 위로(단일 활성). 나머지는 서버 순서(최근순) 유지.
  const orderedMsgs = [...messages].sort((a, b) => Number(b.isPinned) - Number(a.isPinned));

  return (
    <div className={fillHeight ? "flex h-full min-h-0 flex-col" : "space-y-4"}>
      {!fillHeight && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          시청자 채팅은 <b className="font-semibold text-foreground">만들기 → 시청 화면 → 라이브 → 참여 구성에서 채팅</b>을 켜야 시청 화면에 보여요. 여기선 운영자 발언과 메시지 삭제(모더레이션)를 할 수 있어요.
        </p>
      )}

      {loading ? (
        <div className={fillHeight ? "flex min-h-0 flex-1 items-center justify-center" : "py-6 text-center"}>
          <p className="text-xs text-muted-foreground">불러오는 중…</p>
        </div>
      ) : messages.length === 0 ? (
        <div className={fillHeight ? "flex min-h-0 flex-1 items-center justify-center" : "py-6 text-center"}>
          <p className="text-xs text-muted-foreground">아직 채팅 메시지가 없어요.</p>
        </div>
      ) : (
        <div className={`${fillHeight ? "min-h-0 flex-1" : "max-h-80"} space-y-0.5 overflow-y-auto overscroll-contain`}>
          <AnimatePresence initial={false}>
            {orderedMsgs.map((m) => (
              <motion.div
                key={m.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className={`group flex items-start gap-2.5 rounded-xl p-2 transition-colors ${m.isPinned ? "bg-violet-500/10" : "hover:bg-secondary/60"}`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${m.isHost ? "bg-red-500/10 text-red-500" : "bg-violet-500/10 text-violet-600 dark:text-violet-400"}`} aria-hidden>
                  {m.name?.[0] ?? "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className={`font-semibold ${m.isHost ? "text-red-500" : "text-foreground"}`}>{m.name}</span>
                    {m.isHost && <span className="rounded bg-red-500/10 px-1 py-0.5 text-[9px] font-bold text-red-500">HOST</span>}
                    {m.isPinned && <span className="font-medium text-violet-500">📌 고정됨</span>}
                    <span>{formatKst(m.createdAt, { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <p className="mt-0.5 break-words text-[12.5px] text-foreground">{m.message}</p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  {/* 채팅이 꺼져 있으면 고정해도 시청자 화면엔 아무 채팅 자체가 안 내려간다 — 헛수고를 막는다. */}
                  <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => togglePin(m)} disabled={!settings.chatEnabled}
                    className={`rounded-lg p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${m.isPinned ? "text-violet-500" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                    title={settings.chatEnabled ? (m.isPinned ? "고정 해제" : "고정") : "시청자 채팅이 꺼져 있어요"} aria-label={m.isPinned ? "고정 해제" : "메시지 고정"}>
                    <Pin className="h-3.5 w-3.5" />
                  </motion.button>
                  {!m.isHost && m.registrationId && (
                    <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => ban(m)}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500" title="차단" aria-label={`${m.name}님 차단`}>
                      <Ban className="h-3.5 w-3.5" />
                    </motion.button>
                  )}
                  <motion.button whileTap={{ scale: 0.9 }} transition={spring} onClick={() => remove(m)}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500" title="삭제" aria-label="메시지 삭제">
                    <Trash2 className="h-3.5 w-3.5" />
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* 하단 클러스터 — 모더레이션 설정(천천히·링크·금지어) + 진행자 컴포저 */}
      <div className="shrink-0 space-y-3 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <Switch on={settings.slowSec > 0} onClick={toggleSlow} label="천천히 모드" />
            천천히 모드{settings.slowSec > 0 ? ` ${settings.slowSec}초` : ""}
          </label>
          <label className="flex items-center gap-1.5">
            <Switch on={settings.hideLinks} onClick={toggleHideLinks} label="링크 자동 숨김" />
            링크 자동 숨김
          </label>
          <button type="button" onClick={() => setShowBanned((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-secondary">
            금지어 설정{settings.bannedWords.length > 0 ? ` (${settings.bannedWords.length})` : ""}
            <ChevronDown className={`h-3 w-3 transition-transform ${showBanned ? "rotate-180" : ""}`} />
          </button>
          {settings.bannedCount > 0 && <span>차단 {settings.bannedCount}명</span>}
        </div>
        {showBanned && (
          <div className="flex items-center gap-2">
            <input value={bannedInput} onChange={(e) => setBannedInput(e.target.value)} placeholder="금지어(쉼표로 구분, 2자 이상)"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none transition-colors focus:border-violet-400" />
            <motion.button whileTap={{ scale: 0.97 }} transition={spring} onClick={saveMod} disabled={savingMod}
              className="shrink-0 rounded-lg bg-violet-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50">저장</motion.button>
          </div>
        )}
        {/* chatEnabled 가 꺼져 있으면 컴포저가 열려 있어도 서버는 201 을 주고 성공 토스트가 뜨지만
            live-state 가 채팅 데이터를 아예 안 내려줘 시청자는 아무도 못 본다 — 보내기 전에 막는다. */}
        {!loading && !settings.chatEnabled && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
            시청자 채팅이 꺼져 있어요 — 지금 보낸 메시지는 시청자에게 보이지 않아요.
            {fillHeight ? " 위쪽 켜기 스위치로 켤 수 있어요." : " 만들기 → 시청 화면 → 라이브 → 참여 구성에서 채팅을 켜야 보여요."}
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={hostMsg}
            onChange={(e) => setHostMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void sendHost(); }}
            placeholder={settings.chatEnabled ? "진행자(HOST)로 메시지 보내기…" : "시청자 채팅이 꺼져 있어요"}
            disabled={!settings.chatEnabled}
            className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-50`}
          />
          <motion.button whileTap={{ scale: 0.97 }} onClick={sendHost} disabled={!hostMsg.trim() || busy || !settings.chatEnabled}
            className="shrink-0 rounded-lg bg-violet-500 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50">
            보내기
          </motion.button>
        </div>
      </div>
    </div>
  );
}

// 버튼 링크 정규화 — 서버(lib/email.ts 의 normalizeReminderUrl)와 같은 규칙: 스킴이 없으면
// https:// 를 붙이고, 그래도 http(s) 로 파싱되지 않으면 무효. 서버는 이걸 조용히 버려서
// 버튼 없는 메일이 대량 발송되므로, 입력 시점(blur)에 여기서 먼저 잡는다.
function normalizeButtonUrl(raw: string): { value: string; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: "", error: null };
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { value: candidate, error: "http(s) 링크만 사용할 수 있어요" };
    }
    return { value: candidate, error: null };
  } catch {
    return { value: candidate, error: "올바른 링크 형식이 아니에요" };
  }
}

/* ── 알림 발송 패널 ("알림 받고 이어보기" 구독자에게) ── */
function ReminderPanel({ webinarId }: { webinarId: string }) {
  const confirm = useConfirm();
  const [count, setCount] = useState(0);
  const [emailReady, setEmailReady] = useState(false);
  const [form, setForm] = useState({ subject: "", message: "", url: "", buttonLabel: "" });
  const [urlError, setUrlError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleUrlBlur = () => {
    const { value, error } = normalizeButtonUrl(form.url);
    setForm((f) => ({ ...f, url: value }));
    setUrlError(error);
  };

  const fetchReminders = useCallback(async () => {
    const res = await fetch(`/api/webinars/${webinarId}/reminders`);
    if (res.ok) {
      const d = await res.json();
      setCount(d.count ?? 0);
      setEmailReady(!!d.emailConfigured);
    }
    setLoading(false);
  }, [webinarId]);
  useEffect(() => { void fetchReminders(); }, [fetchReminders]);

  const send = async () => {
    if (!form.subject.trim() || !form.message.trim() || busy) return;
    // blur 를 안 거치고 붙여넣은 값으로 바로 발송을 누르는 경우도 있다 — 발송 직전 한 번 더 정규화·검증.
    const { value: normalizedUrl, error } = normalizeButtonUrl(form.url);
    if (error) {
      setForm((f) => ({ ...f, url: normalizedUrl }));
      setUrlError(error);
      return;
    }
    if (normalizedUrl !== form.url) setForm((f) => ({ ...f, url: normalizedUrl }));
    // 구독자 전원에게 즉시 발송되는 되돌릴 수 없는 동작 — 확인 후 진행(최종 버튼 링크도 보여준다).
    if (!(await confirm({
      title: `구독자 ${count}명에게 발송할까요?`,
      description: `제목: "${form.subject.trim()}"${normalizedUrl ? ` · 버튼 링크: ${normalizedUrl}` : ""} · 발송 후에는 취소할 수 없어요.`,
      confirmLabel: "발송",
    }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/reminders/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, url: normalizedUrl }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (d.emailConfigured) {
        // 200 이라도 sent:0·failed>0 이면 전량 실패다 — res.ok 만 보고 초록 "완료" 를 띄우면
        // 운영자가 발송 사고를 놓친다. 부분 실패는 경고, 전량 실패는 에러로 구분한다.
        const orphanedSuffix = d.orphaned > 0 ? ` · 삭제된 등록자 ${d.orphaned}명 제외` : "";
        if (d.sent === 0 && d.failed > 0) {
          toast.error(`발송 실패 — ${d.failed}명 전송 실패${orphanedSuffix}`);
        } else if (d.failed > 0) {
          toast.warning(`일부 발송 실패 — ${d.sent}명 전송, ${d.failed}명 실패${orphanedSuffix}`);
        } else {
          toast.success(`발송 완료 — ${d.sent}명 전송${orphanedSuffix}`);
        }
      }
      else toast.message(`이메일 발송 미설정 — 건너뜀 (구독자 ${d.total}명). RESEND_API_KEY 설정 후 사용하세요.`);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "발송에 실패했어요");
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-violet-400";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">
          구독자 <b className="font-semibold text-violet-500">{loading ? "…" : count}</b>명
          <span className="ml-1 text-[11px] text-muted-foreground">(&ldquo;알림 받고 이어보기&rdquo; 켠 시청자)</span>
        </p>
        <button onClick={() => void fetchReminders()} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          <RefreshCw className="h-3 w-3" /> 새로고침
        </button>
      </div>

      {!loading && !emailReady && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
          이메일 발송이 아직 연결되지 않았어요. <code className="rounded bg-black/10 px-1 dark:bg-white/10">RESEND_API_KEY</code>(+발송 도메인)를 설정하면 실제로 발송돼요. 지금은 구독자만 수집돼요.
        </p>
      )}

      <div className="space-y-2 rounded-xl border border-border bg-background/60 p-3.5">
        <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="제목 (예: 곧 다음 세션이 시작돼요)" className={inputCls} />
        <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder="내용" rows={3} className={`${inputCls} resize-none`} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <input
              value={form.url}
              onChange={(e) => { setForm((f) => ({ ...f, url: e.target.value })); if (urlError) setUrlError(null); }}
              onBlur={handleUrlBlur}
              placeholder="버튼 링크 (선택)"
              aria-invalid={urlError ? true : undefined}
              className={`${inputCls}${urlError ? " border-red-500/60 focus:border-red-500" : ""}`}
            />
            {urlError && <p className="mt-1 text-[11px] text-red-500">{urlError}</p>}
          </div>
          <input value={form.buttonLabel} onChange={(e) => setForm((f) => ({ ...f, buttonLabel: e.target.value }))} placeholder="버튼 라벨 (선택)" className={inputCls} />
        </div>
        <div className="flex justify-end">
          <motion.button whileTap={{ scale: 0.97 }} onClick={send} disabled={!form.subject.trim() || !form.message.trim() || !!urlError || busy || count === 0}
            className="rounded-lg bg-violet-500 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50">
            {busy ? "발송 중…" : `구독자 ${count}명에게 발송`}
          </motion.button>
        </div>
      </div>
    </div>
  );
}

interface CurveData { points: { label: string; viewers: number; entered: number; chat: number }[]; peak: number; avg: number; hasData: boolean; bucketMinutes?: number; range?: string }
interface ActivityItem { id: string; action: string; label: string; at: string; actor: string | null }

// tailwind 토큰(oklch)을 canvas 용 concrete 색으로 — 프로브 span 의 computed color 를 읽는다(테마 반영).
function readColor(className: string, alpha?: number) {
  if (typeof document === "undefined") return "#888";
  const el = document.createElement("span");
  el.className = className; el.style.display = "none"; document.body.appendChild(el);
  const rgb = getComputedStyle(el).color; el.remove();
  if (alpha == null) return rgb;
  const m = rgb.match(/[\d.]+/g);
  return m ? `rgba(${m[0]},${m[1]},${m[2]},${alpha})` : rgb;
}

// 실시간 신선도 — 마지막 동기화 후 경과를 1초마다 갱신 표시
function FreshBadge({ syncAt }: { syncAt: number }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const ago = Math.max(0, Math.round((Date.now() - syncAt) / 1000));
  const txt = ago < 5 ? "방금" : ago < 60 ? `${ago}초 전` : `${Math.floor(ago / 60)}분 전`;
  // syncAt 은 성공 시에만 갱신 — 2분 넘게 갱신 없으면 폴링 실패로 보고 초록불 대신 주의 색·문구.
  const stale = ago > 120;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${stale ? "bg-amber-500" : "bg-green-500"}`} /> {stale ? `연결 확인 필요 · ${txt}` : `실시간 · ${txt} 갱신`}
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || !cv.getContext) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    const W = Math.max(40, r.width || 80), H = Math.max(20, r.height || 34);
    cv.width = W * ratio; cv.height = H * ratio; ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const vals = values.length ? values : [0, 0];
    const max = Math.max(1, ...vals), min = Math.min(...vals);
    const rng = Math.max(1, max - min);
    const x = (i: number) => (i / Math.max(1, vals.length - 1)) * W;
    const y = (v: number) => H - 2 - ((v - min) / rng) * (H - 4);
    const ac = readColor("text-violet-500");
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, readColor("text-violet-500", 0.28) as string); g.addColorStop(1, readColor("text-violet-500", 0) as string);
    ctx.beginPath(); vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = ac as string; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke();
  }, [values]);
  return <canvas ref={ref} className="h-full w-full" />;
}

// 동시 접속 추이 — attendance-curve 실데이터. 동시·입장 라인 + 채팅 하단 막대 + 이벤트 마커 + 호버.
const CHART_RANGES: { key: string; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "60m", label: "최근 60분" },
  { key: "30m", label: "최근 30분" },
];
function ChartLegend() {
  return (
    <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-500" />동시</span>
      <span className="flex items-center gap-1"><span className="h-0.5 w-2.5 rounded bg-green-500" />입장</span>
      <span className="flex items-center gap-1"><span className="h-2 w-1.5 rounded-sm bg-muted-foreground/40" />채팅</span>
    </div>
  );
}
function ChartRangeToggle({ range, onRangeChange }: { range: string; onRangeChange?: (r: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
      {CHART_RANGES.map((rg) => (
        <button key={rg.key} onClick={() => onRangeChange?.(rg.key)} disabled={!onRangeChange}
          className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${range === rg.key ? "bg-violet-500 text-white" : "text-muted-foreground hover:bg-secondary"}`}>
          {rg.label}
        </button>
      ))}
    </div>
  );
}
function ViewerChart({ curve, events = [], range = "all", onRangeChange }: { curve: CurveData | null; events?: { min: number; label: string }[]; range?: string; onRangeChange?: (r: string) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; label: string; v: number; entered: number; chat: number } | null>(null);
  const pts = curve?.points ?? [];
  // 운영 이벤트(투표 발행·공지 등)를 가장 가까운(≤10분) 버킷에 매핑 — 추이와 액션 상관 표시
  const evByIdx = new Map<number, string[]>();
  if (pts.length) {
    const ptMin = pts.map((p) => { const [h, m] = p.label.split(":").map(Number); return (h || 0) * 60 + (m || 0); });
    events.forEach((e) => {
      let best = 0, bd = Infinity;
      ptMin.forEach((pm, i) => { const d = Math.abs(pm - e.min); if (d < bd) { bd = d; best = i; } });
      if (bd <= 10) { const arr = evByIdx.get(best) ?? []; arr.push(e.label); evByIdx.set(best, arr); }
    });
  }
  useEffect(() => {
    const cv = ref.current; if (!cv || !cv.getContext) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const draw = () => {
      const r = cv.getBoundingClientRect();
      const W = Math.max(280, r.width || 600), H = Math.max(160, r.height || 220);
      cv.width = W * ratio; cv.height = H * ratio; ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const padL = 8, padR = 8, padT = 14, padB = 22, barBand = 16;
      const vals = pts.map((p) => p.viewers);
      const entered = pts.map((p) => p.entered ?? 0);
      const chat = pts.map((p) => p.chat ?? 0);
      const yMax = Math.max(10, curve?.peak ?? 0, ...entered) * 1.15;
      const maxChat = Math.max(1, ...chat);
      const N = pts.length;
      const plotB = H - padB - barBand; // 라인 영역 바닥(하단 채팅 막대 위)
      const ac = readColor("text-violet-500"), good = readColor("text-green-500"), muted = readColor("text-muted-foreground"), gl = readColor("text-muted-foreground", 0.14);
      const x = (i: number) => padL + (N <= 1 ? 0.5 : i / (N - 1)) * (W - padL - padR);
      const y = (v: number) => padT + (1 - v / yMax) * (plotB - padT);
      ctx.font = "10px sans-serif"; ctx.textBaseline = "middle";
      [0, 0.5, 1].forEach((f) => { const gv = Math.round(yMax * f), yy = y(gv); ctx.strokeStyle = gl as string; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke(); ctx.fillStyle = muted as string; ctx.textAlign = "left"; ctx.fillText(gv >= 1000 ? (gv / 1000).toFixed(1) + "k" : String(gv), padL + 2, yy - 7); });
      // 채팅 하단 막대(자체 스케일 — 동시/입장과 100배 차 나므로 별도 표현)
      if (N) { const bw = Math.max(1.5, ((W - padL - padR) / N) * 0.5); ctx.fillStyle = readColor("text-muted-foreground", 0.35) as string; chat.forEach((c, i) => { if (c <= 0) return; const bh = (c / maxChat) * (barBand - 3); ctx.fillRect(x(i) - bw / 2, H - padB - bh, bw, bh); }); }
      const linePath = (arr: number[]) => { ctx.beginPath(); arr.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)))); };
      if (N >= 2) {
        const grad = ctx.createLinearGradient(0, padT, 0, plotB); grad.addColorStop(0, readColor("text-violet-500", 0.26) as string); grad.addColorStop(1, readColor("text-violet-500", 0) as string);
        linePath(vals); ctx.lineTo(x(N - 1), plotB); ctx.lineTo(x(0), plotB); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
        ctx.setLineDash([4, 3]); linePath(entered); ctx.strokeStyle = good as string; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke(); ctx.setLineDash([]);
        linePath(vals); ctx.strokeStyle = ac as string; ctx.lineWidth = 2.2; ctx.lineJoin = "round"; ctx.stroke();
        const ex = x(N - 1), ey = y(vals[N - 1]); ctx.beginPath(); ctx.arc(ex, ey, 3.6, 0, 7); ctx.fillStyle = ac as string; ctx.fill();
      }
      // 운영 이벤트 마커 — 라인 영역 바닥의 작은 점(해당 버킷에 액션 발생)
      evByIdx.forEach((_l, i) => { ctx.beginPath(); ctx.arc(x(i), plotB, 2.6, 0, 7); ctx.fillStyle = ac as string; ctx.fill(); });
      ctx.fillStyle = muted as string; ctx.textBaseline = "alphabetic";
      if (N) { ctx.textAlign = "left"; ctx.fillText(pts[0].label, padL, H - 6); ctx.textAlign = "right"; ctx.fillText(pts[N - 1].label, W - padR, H - 6); }
      if (hover != null && pts[hover]) { const hx = x(hover); ctx.strokeStyle = readColor("text-muted-foreground", 0.4) as string; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, plotB); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(hx, y(vals[hover]), 3.4, 0, 7); ctx.fillStyle = ac as string; ctx.fill(); }
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(cv);
    const mq = window.matchMedia("(prefers-color-scheme: dark)"); mq.addEventListener("change", draw);
    return () => { ro.disconnect(); mq.removeEventListener("change", draw); };
  }, [pts, hover, curve, events]);
  const onMove = (clientX: number) => {
    const cv = ref.current; if (!cv || !pts.length) return;
    const r = cv.getBoundingClientRect(); const padL = 8, padR = 8, W = Math.max(280, r.width);
    let i = Math.round(((clientX - r.left - padL) / (W - padL - padR)) * (pts.length - 1));
    i = Math.max(0, Math.min(pts.length - 1, i)); const p = pts[i];
    setHover(i); setTip({ x: padL + (pts.length <= 1 ? 0.5 : i / (pts.length - 1)) * (W - padL - padR), label: p.label, v: p.viewers, entered: p.entered ?? 0, chat: p.chat ?? 0 });
  };
  if (!curve || !curve.hasData) {
    return (
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3.5 sm:px-5"><BarChart3 className="h-4 w-4 text-violet-500" /><h2 className="text-sm font-semibold">동시 접속 추이</h2><div className="ml-auto"><ChartRangeToggle range={range} onRangeChange={onRangeChange} /></div></div>
        <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
          <p className="text-sm font-medium">아직 시청 데이터가 없어요</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">라이브가 시작되고 시청자가 입장하면 분 단위 추이가 여기 표시돼요.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3.5 sm:px-5">
        <BarChart3 className="h-4 w-4 text-violet-500" /><h2 className="text-sm font-semibold">동시 접속 추이</h2>
        <ChartLegend />
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">피크 <b className="font-semibold text-foreground tabular-nums">{curve.peak.toLocaleString()}</b> · 평균 <b className="font-semibold text-foreground tabular-nums">{curve.avg.toLocaleString()}</b></span>
          <ChartRangeToggle range={range} onRangeChange={onRangeChange} />
        </div>
      </div>
      <div className="relative px-3 py-3" style={{ height: 240 }}>
        <canvas ref={ref} className="block h-full w-full cursor-crosshair" style={{ touchAction: "none" }}
          onMouseMove={(e) => onMove(e.clientX)} onMouseLeave={() => { setHover(null); setTip(null); }}
          onTouchStart={(e) => onMove(e.touches[0].clientX)} onTouchMove={(e) => onMove(e.touches[0].clientX)} />
        {tip && (
          <div className="pointer-events-none absolute top-2 -translate-x-1/2 rounded-lg bg-foreground px-2.5 py-1.5 text-[11px] leading-tight text-background shadow-lg" style={{ left: tip.x }}>
            <div className="font-bold">{tip.label}</div>
            <div className="tabular-nums">동시 {tip.v.toLocaleString()} · 입장 {tip.entered.toLocaleString()} · 채팅 {tip.chat.toLocaleString()}</div>
            {hover != null && evByIdx.get(hover)?.map((lb, k) => <div key={k} className="mt-0.5 opacity-80">● {lb}</div>)}
          </div>
        )}
      </div>
    </section>
  );
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">아직 운영 활동이 없어요.</p>;
  return (
    <section className="max-h-64 overflow-y-auto rounded-2xl border border-border bg-card">
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-[13px] last:border-0">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
          <span className="min-w-[52px] shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatKst(it.at, { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="min-w-0 flex-1 truncate">{it.label}{it.actor ? <span className="text-muted-foreground"> · {it.actor}</span> : null}</span>
        </div>
      ))}
    </section>
  );
}

// 현재 KST 분(자정 기준). 러닝오더 상태 판정용.

// 경과·종료까지 시계 — 라이브 중 초 단위 갱신
function LiveClock({ startAt, endAt }: { startAt?: string; endAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const fmt = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); const mm = String(m).padStart(2, "0"), ss = String(s % 60).padStart(2, "0"); return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; };
  const start = startAt ? Date.parse(startAt) : NaN, end = endAt ? Date.parse(endAt) : NaN;
  const elapsed = Number.isFinite(start) && now >= start ? fmt(now - start) : null;
  const remain = Number.isFinite(end) && end > now ? fmt(end - now) : null;
  if (!elapsed && !remain) return null;
  return (
    <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
      {elapsed && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> 경과 <b className="font-semibold text-foreground tabular-nums">{elapsed}</b></span>}
      {remain && <span>종료까지 <b className="font-semibold text-foreground tabular-nums">{remain}</b></span>}
    </span>
  );
}

// 러닝오더 — 세션 타임라인. 세션 시각("HH:MM")을 웨비나의 KST 캘린더 날짜에 앵커링해 절대시각으로 done/live/next 판정
// (KST 고정 +9, DST 없음). 이로써 자정 넘김·전날/다음날에도 상태가 정확하다.
function RunningOrder({ webinarId, sessions, liveStartAt, components, onSilentUpdate }: {
  webinarId: string;
  sessions: WebinarForConsole["sessions"];
  liveStartAt?: string;
  components?: WebinarForConsole["components"];
  onSilentUpdate?: () => Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [display, setDisplay] = useState(() => normalizeLiveSessionDisplay(components));
  const [saving, setSaving] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  if (!sessions.length) return null;

  async function updateDisplay(slot: LiveSessionSlot, value: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components: { [slot]: value } }),
      });
      if (!res.ok) throw new Error();
      setDisplay((prev) => ({ ...prev, [slot]: value }));
      void onSilentUpdate?.();
      toast.success("시청 화면의 세션 표시를 바꿨어요");
    } catch {
      toast.error("세션 표시를 바꾸지 못했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }
  const KST = 9 * 3_600_000;
  const base = liveStartAt ? new Date(liveStartAt) : null;
  const kst = base && !Number.isNaN(base.getTime()) ? new Date(base.getTime() + KST) : null;
  // 웨비나 KST 날짜 + HH:MM → 절대(UTC) ms. liveStartAt 없으면 판정 불가(전부 예정 처리).
  const absOf = (hhmm: string): number | null => {
    if (!kst) return null;
    const [h, m] = (hhmm || "").split(":").map(Number);
    return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), h || 0, m || 0) - KST;
  };
  const ordered = [...sessions].sort((a, b) => a.number - b.number).map((s) => {
    const st = absOf(s.startTime);
    let en = absOf(s.endTime);
    if (st != null && en != null && en <= st) en += 86_400_000; // 종료가 시작보다 이르면 자정 넘김 세션
    const status = st == null || en == null ? "none" : en <= now ? "done" : st <= now ? "now" : "upcoming";
    return { id: s.id, s, status };
  });
  const { activeSession, nextSession } = resolveLiveSessionHighlights(ordered, display);
  const nowKst = new Date(now + KST);
  const nowLabel = `${String(nowKst.getUTCHours()).padStart(2, "0")}:${String(nowKst.getUTCMinutes()).padStart(2, "0")}`;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border p-4 sm:px-5">
        <ListChecks className="h-4 w-4 text-violet-500" />
        <h2 className="text-sm font-semibold">러닝오더</h2>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">현재 {nowLabel}</span>
      </div>
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 sm:px-5" aria-busy={saving}>
        {LIVE_SESSION_SLOTS.map(({ key, label }) => {
          const selected = display[key];
          const otherSlot = key === "liveCurrentSession" ? "liveNextSession" : "liveCurrentSession";
          return (
            <label key={key} className="grid gap-1.5 text-xs font-medium">
              {label} 표시
              <select
                className="h-9 min-w-0 rounded-lg bg-secondary px-2 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                value={selected}
                disabled={saving}
                onChange={(event) => void updateDisplay(key, event.target.value)}
              >
                <option value="auto">일정대로 자동 표시</option>
                <option value="hidden">숨기기</option>
                {selected !== "auto" && selected !== "hidden" && !sessions.some((s) => s.id === selected) && (
                  <option value={selected} disabled>삭제된 세션 · 숨김</option>
                )}
                {ordered.map(({ s }) => <option key={s.id} value={s.id} disabled={display[otherSlot] === s.id}>{s.startTime} {s.title}</option>)}
              </select>
            </label>
          );
        })}
      </div>
      <div className="divide-y divide-border/60">
        {ordered.map(({ s, status }) => {
          const state = s.id === activeSession?.id ? "live" : s.id === nextSession?.id ? "next" : status === "done" ? "done" : "upcoming";
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${state === "live" ? "animate-pulse bg-green-500" : state === "next" ? "bg-violet-500" : state === "done" ? "bg-muted-foreground/30" : "bg-border"}`} />
              <div className="min-w-0 flex-1">
                <div className={`flex items-center gap-1.5 text-[13px] ${state === "done" ? "text-muted-foreground" : "font-medium"}`}>
                  <span className="truncate">{s.title}</span>
                  {/* 세션이 아닌 항목은 러닝오더에서도 구분돼야 한다 — 라이브 중에 운영자가
                      "지금이 세션인가 오프닝인가" 를 여기서 읽는다. 예전엔 break/qa 두 개만
                      하드코딩돼 있고 default 가 없어서, 유형이 늘면 배지가 아예 안 붙었다.
                      빈 시간(휴식)만 회색 — 나머지는 콘텐츠라 키컬러를 유지한다. */}
                  {!isRealSession(s) && sessionTypeLabel(s.type) && (
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      isPauseSession(s.type)
                        ? "bg-secondary text-muted-foreground"
                        : "bg-violet-500/10 text-violet-500"
                    }`}>
                      {sessionTypeLabel(s.type)}
                    </span>
                  )}
                </div>
                <div className="text-[11px] tabular-nums text-muted-foreground">{s.startTime} – {s.endTime}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${state === "live" ? "bg-green-500/10 text-green-600 dark:text-green-400" : state === "next" ? "bg-violet-500/10 text-violet-600 dark:text-violet-400" : "bg-secondary text-muted-foreground"}`}>
                {state === "live" ? "진행 중" : state === "next" ? "다음" : state === "done" ? "완료" : "예정"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const DRAWER_SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;

// 인터랙션 — 통합 송출 카드. 타입별 현재/활성 항목을 토글 행으로, 활성 투표는 실시간 결과 프리뷰.
// 생성/편집·알림 발송은 헤더 ⚙로 여는 우측 설정 드로어(세그먼트 탭)에서.
function BroadcastCard({ webinarId, tick = 0, sections }: { webinarId: string; tick?: number; sections: { key: string; label: string; icon: typeof Bell; render: (open: boolean) => ReactNode }[] }) {
  const [polls, setPolls] = useState<AdminPoll[]>([]);
  const [anns, setAnns] = useState<{ id: string; message: string; isActive: boolean }[]>([]);
  const [popups, setPopups] = useState<{ id: string; title: string; isActive: boolean }[]>([]);
  const [tallies, setTallies] = useState<{ id: string; title: string; isActive: boolean }[]>([]);
  const [surveys, setSurveys] = useState<AdminSurveyPush[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const openDrawer = () => { setHasOpened(true); setDrawerOpen(true); };
  const [activeSection, setActiveSection] = useState(sections[0]?.key ?? "");
  // 최초 열람 후 유지(mount-on-first-view) — 드로어 열 때 안 본 탭까지 즉시 fetch 하지 않게 방문한 섹션만 마운트.
  const [visited, setVisited] = useState<string[]>(() => (sections[0]?.key ? [sections[0].key] : []));
  const selectSection = (key: string) => { setActiveSection(key); setVisited((v) => (v.includes(key) ? v : [...v, key])); };
  const openDrawerTo = (key: string) => { selectSection(key); openDrawer(); };
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const mut = useRef(false);

  // 인플라이트 펜스 — tick 으로 출발한 응답이 patch 이후에 도착해 방금 켠 스위치를 되돌리면
  // 운영자가 다시 눌러 실제 송출을 꺼버리는 역전 사고가 난다.
  const reqRef = useRef(0);
  const fetchAll = useCallback(async () => {
    const my = ++reqRef.current;
    const safe = async (url: string, key: string) => { try { const r = await fetch(url); if (!r.ok) return []; return (await r.json())[key] ?? []; } catch { return []; } };
    const [p, a, pu, t, s] = await Promise.all([
      safe(`/api/webinars/${webinarId}/polls`, "polls"),
      safe(`/api/webinars/${webinarId}/announcements`, "announcements"),
      safe(`/api/webinars/${webinarId}/popups`, "popups"),
      safe(`/api/webinars/${webinarId}/tally-pushes`, "tallyPushes"),
      safe(`/api/webinars/${webinarId}/surveys`, "surveys"),
    ]);
    if (my !== reqRef.current) return; // 더 새 요청이 출발했다 — 이 응답은 버린다
    setPolls(p); setAnns(a); setPopups(pu); setTallies(t); setSurveys(s);
  }, [webinarId]);
  useEffect(() => { void fetchAll(); }, [fetchAll]);
  useEffect(() => { if (tick > 0 && !mut.current) void fetchAll(); }, [tick, fetchAll]);
  // 드로어를 다시 열 때마다 카드와 패널을 모두 최신화한다.
  // 패널은 마운트 유지형이라 openGen 을 key 에 섞어 재마운트 = 재조회시킨다
  // (다른 운영자가 바꾼 내용이 닫혀 있는 동안 반영되지 않던 문제).
  const [openGen, setOpenGen] = useState(0);
  useEffect(() => {
    if (!drawerOpen) return;
    setOpenGen((g) => g + 1);
    void fetchAll();
  }, [drawerOpen, fetchAll]);

  const patch = async (seg: string, id: string, isActive: boolean, name: string) => {
    mut.current = true;
    try {
      const res = await fetch(`/api/webinars/${webinarId}/${seg}/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }),
      });
      // 실패해도 목록을 다시 읽는다 — "다른 항목이 켜졌다"는 사실이 카드에 보여야 재시도 판단이 된다.
      if (!res.ok) {
        // 409(다른 항목이 방금 켜짐)는 자체 문구 유지 — 나머지는 서버가 준 이유(예: 설문 응답 기간 관련
        // 400)를 그대로 보여준다. 문구를 "변경에 실패했어요"로 덮으면 왜 막혔는지 운영자가 알 수 없다.
        const body = await res.json().catch(() => null);
        toast.error(res.status === 409 ? "다른 항목이 방금 켜졌어요. 목록을 새로고침했어요." : body?.error || "변경에 실패했어요");
        await fetchAll();
        return;
      }
      toast.success(isActive ? `${name} 송출 시작` : `${name} 송출 종료`);
      await fetchAll();
    } finally { mut.current = false; }
  };

  // 드로어 접근성 — 열 때 패널로 포커스 진입 + Tab 트랩 + Esc 닫기 + 스크롤 잠금, 닫힐 때 여닫은 요소로 포커스 복원.
  const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  useEffect(() => {
    if (!drawerOpen) return;
    previousFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();
    }, 0);
    // 패널에 바운드(버블) — 포커스가 드로어 안일 때만 Esc/Tab 처리. 편집 패널이 여는 중첩 확인창(별도 포털,
    // 패널 DOM 밖)에서 Esc 를 누르면 이 리스너가 아니라 확인창 자신의 핸들러가 처리 → 드로어 오폭발 방지.
    const panel = panelRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setDrawerOpen(false); return; }
      if (e.key === "Tab" && panelRef.current) {
        // 보이는(display:none 아닌) 요소만 경계로 — 숨긴 섹션(비활성 탭)의 요소를 first/last 로 잡으면 focus() 실패로 트랩이 샌다.
        const f = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        if (f.length === 0) { e.preventDefault(); panelRef.current.focus(); return; }
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    panel?.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      panel?.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previousFocusRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen]);

  const activePoll = polls.find((p) => p.isActive) ?? null;
  /**
   * 새 발행 대상 — 지금 받는 설문이 우선, 없으면 **시작 예약 대기 중**인 설문을 보여준다.
   *
   * 예전엔 open 만 골라서, 시작 예약을 걸어 둔 설문이 있어도 카드가 "등록된 설문 없음" 이라고 했다.
   * 운영자는 방금 만든 설문이 사라진 줄 안다. 마감·수동 오프만 대상에서 뺀다(그건 발행해도
   * live-state 가 걸러 시청자에게 안 나간다).
   */
  const currentSurvey =
    surveys.find((s) => s.isActive) ??
    surveys.find((s) => surveyOpenState(s) === "open") ??
    surveys.find((s) => surveyOpenState(s) === "before") ??
    null;
  const currentSurveyNote = currentSurvey && surveyOpenState(currentSurvey) === "before" ? " · 시작 전" : "";
  // SurveyPushPanel(설문 탭)과 같은 기준 — open 이 아니고 이미 발행 중도 아니면 스위치를 눌러도
  // live-state 가 걸러 시청자에게 안 나간다. 카드에서 그대로 눌러 끄기·켜기 가능해 보이면
  // "눌렀는데 왜 안 되지"가 된다. 대신 설정 버튼으로 드로어의 설문 탭까지 안내한다.
  const surveyGated = currentSurvey ? !currentSurvey.isActive && surveyOpenState(currentSurvey) !== "open" : false;
  const rows = [
    { seg: "polls", icon: BarChart3, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400", name: "실시간 투표", cur: activePoll ?? polls[0] ?? null, summary: (activePoll ?? polls[0])?.question ?? "등록된 투표 없음", gated: false },
    { seg: "surveys", icon: ClipboardCheck, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", name: "설문", cur: currentSurvey, summary: currentSurvey ? `${currentSurvey.title}${currentSurveyNote}` : "등록된 설문 없음", gated: surveyGated },
    { seg: "announcements", icon: Megaphone, tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400", name: "공지", cur: anns.find((a) => a.isActive) ?? anns[0] ?? null, summary: (anns.find((a) => a.isActive) ?? anns[0])?.message ?? "등록된 공지 없음", gated: false },
    { seg: "popups", icon: MessageSquarePlus, tone: "bg-secondary text-muted-foreground", name: "팝업", cur: popups.find((p) => p.isActive) ?? popups[0] ?? null, summary: (popups.find((p) => p.isActive) ?? popups[0])?.title ?? "등록된 팝업 없음", gated: false },
    { seg: "tally-pushes", icon: Bell, tone: "bg-secondary text-muted-foreground", name: "Tally 설문", cur: tallies.find((t) => t.isActive) ?? tallies[0] ?? null, summary: (tallies.find((t) => t.isActive) ?? tallies[0])?.title ?? "등록된 설문 없음", gated: false },
  ] as const;
  const activeCount = rows.filter((r) => r.cur && (r.cur as { isActive: boolean }).isActive).length;

  return (
    <>
    <section className="flex h-[76vh] flex-col overflow-hidden rounded-2xl border border-border bg-card lg:h-[620px]">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-4 sm:px-5">
        <MessageSquarePlus className="h-4 w-4 text-violet-500" />
        <h2 className="text-sm font-semibold">인터랙션</h2>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${activeCount ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-secondary text-muted-foreground"}`}>{activeCount ? `${activeCount}개 송출 중` : "대기"}</span>
        <button type="button" onClick={openDrawer} aria-label="인터랙션 설정" className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <Settings className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {rows.map((r) => {
          const cur = r.cur as { id: string; isActive: boolean } | null;
          const showSwitch = cur && !r.gated;
          return (
            <div key={r.seg} className="flex items-center gap-3 border-b border-border/60 py-3 last:border-0">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${r.tone}`}><r.icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{r.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{r.summary}</div>
              </div>
              {showSwitch ? (
                <button onClick={() => patch(r.seg, cur.id, !cur.isActive, r.name)} role="switch" aria-checked={cur.isActive} aria-label={`${r.name} 송출`}
                  className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${cur.isActive ? "bg-violet-500" : "bg-secondary border border-border"}`}>
                  <span className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow transition-all ${cur.isActive ? "left-[18px]" : "left-[3px]"}`} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openDrawerTo(r.seg === "tally-pushes" ? "tally" : r.seg)}
                  aria-label={`${r.name} 설정 열기`}
                  title={`${r.name} 설정`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Settings className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}

        {activePoll && (
          <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-3">
            <div className="text-xs font-semibold">{activePoll.question}</div>
            <div className="mb-2 mt-0.5 text-[11px] text-muted-foreground">실시간 집계 · 응답 {activePoll.options.reduce((s, o) => s + o.voteCount, 0).toLocaleString()}표</div>
            {(() => {
              const total = activePoll.options.reduce((s, o) => s + o.voteCount, 0) || 1;
              return activePoll.options.map((o) => {
                const pct = Math.round((o.voteCount / total) * 100);
                return (
                  <div key={o.id} className="mb-1.5 last:mb-0">
                    <div className="flex justify-between gap-2 text-[11px]"><span className="truncate">{o.label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{o.voteCount}표 · {pct}%</span></div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-card"><div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    </section>

    {typeof document !== "undefined" && hasOpened && createPortal(
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: drawerOpen ? 1 : 0 }} transition={{ duration: 0.15 }}
        className={`fixed inset-0 z-50 flex bg-black/50 backdrop-blur-sm ${drawerOpen ? "" : "pointer-events-none"}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
      >
        <motion.div
          ref={panelRef} tabIndex={-1}
          initial={{ x: "100%" }} animate={{ x: drawerOpen ? 0 : "100%" }} transition={DRAWER_SPRING}
          className="ml-auto flex h-full w-full max-w-lg flex-col bg-background shadow-2xl outline-none"
          onClick={(e) => e.stopPropagation()}
          role="dialog" aria-modal="true" aria-label="인터랙션 설정"
        >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-violet-500" />
                <h2 className="text-sm font-semibold">인터랙션 설정</h2>
              </div>
              <motion.button
                whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }} transition={DRAWER_SPRING}
                onClick={() => setDrawerOpen(false)} aria-label="닫기"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </motion.button>
            </div>
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-5 py-2">
              {sections.map((s) => (
                <button
                  key={s.key} type="button" aria-pressed={activeSection === s.key} onClick={() => selectSection(s.key)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${activeSection === s.key ? "bg-violet-500 text-white" : "text-muted-foreground hover:bg-secondary"}`}
                >
                  <s.icon className="h-3.5 w-3.5" />{s.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {sections.map((s) => (visited.includes(s.key) ? (
                <div key={`${s.key}-${openGen}`} className={activeSection === s.key ? "" : "hidden"}>{s.render(drawerOpen)}</div>
              ) : null))}
            </div>
          </motion.div>
        </motion.div>,
      document.body,
    )}
    </>
  );
}

export default function LiveConsoleTab({
  webinarId,
  webinar,
  onNavigate,
  onSilentUpdate,
}: {
  webinarId: string;
  webinar?: WebinarForConsole;
  onNavigate?: (target: string) => void;
  onSilentUpdate?: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  // 라이브 폴링 tick — 대시보드 적응형 주기(라이브 15초/평시 90초, 탭 숨김 스킵)에 맞춰 증가시켜,
  // 투표 집계·채팅 모더레이션 피드가 별도 타이머 없이 같은 주기로 갱신되게 한다.
  const [liveTick, setLiveTick] = useState(0);
  const [curve, setCurve] = useState<CurveData | null>(null);
  const [curveRange, setCurveRange] = useState("all");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [syncAt, setSyncAt] = useState<number>(() => Date.now());
  // 시청자 채팅 on/off — 콘솔 프로퍼티(components.chatEnabled)로 초기화, 헤더 스위치로 낙관적 토글.
  const [chatOn, setChatOn] = useState<boolean>(
    () => (webinar?.components as { chatEnabled?: boolean } | null | undefined)?.chatEnabled === true,
  );
  // 토글 직후 패널 폴링이 아직 옛 값을 물고 오면 스위치가 혼자 되돌아간다 →
  // 서버가 내가 보낸 값을 따라잡을 때까지 패널이 올려주는 값을 무시한다.
  const chatPendingRef = useRef<boolean | null>(null);
  const onPanelChatEnabled = useCallback((v: boolean) => {
    if (chatPendingRef.current !== null) {
      if (v !== chatPendingRef.current) return; // 아직 반영 전 값 — 버린다
      chatPendingRef.current = null;
    }
    setChatOn(v);
  }, []);
  const toggleChatOn = () => {
    const next = !chatOn;
    chatPendingRef.current = next;
    setChatOn(next);
    fetch(`/api/webinars/${webinarId}/chat`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatEnabled: next }),
    })
      .then((r) => { if (!r.ok) throw new Error(); toast.success(next ? "시청자 채팅을 켰어요" : "시청자 채팅을 껐어요"); })
      .catch(() => { chatPendingRef.current = null; setChatOn(!next); toast.error("변경에 실패했어요"); });
  };
  // Q&A 공개 범위 — 채팅 스위치와 같은 방식(콘솔 프로퍼티로 초기화 + 낙관적 갱신 + 실패 시 되돌림).
  // 폐쇄형은 서버(live-state·공개 GET·추천)에서 막히고, 여기 값은 그 스위치일 뿐이다.
  const [qaMode, setQaMode] = useState<"open" | "closed">(
    () => ((webinar?.components as { qaMode?: string } | null | undefined)?.qaMode === "closed" ? "closed" : "open"),
  );
  const setQaModeRemote = (next: "open" | "closed") => {
    if (next === qaMode) return;
    const prev = qaMode;
    setQaMode(next);
    fetch(`/api/webinars/${webinarId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // components 는 서버가 최상위 키 단위로 병합한다 → chatEnabled 등 다른 키는 보존된다
      body: JSON.stringify({ components: { qaMode: next } }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        toast.success(next === "closed" ? "폐쇄형으로 바꿨어요 — 시청자는 질문 목록을 볼 수 없어요" : "오픈형으로 바꿨어요 — 시청자끼리 질문을 볼 수 있어요");
      })
      .catch(() => { setQaMode(prev); toast.error("변경에 실패했어요"); });
  };
  const statusRef = useRef<WebinarStatus>("registration");
  // 라이브 진입/이탈 시 폴링 루프를 다시 짜기 위한 신호 — ref 만으로는 이미 걸린 90초 타이머가 그대로 남는다.
  const [isLivePolling, setIsLivePolling] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/webinars/${webinarId}/dashboard`);
      if (!res.ok) return;
      const next: DashboardData = await res.json();
      statusRef.current = next.status;
      setIsLivePolling(next.status === "live");
      setData(next);
      setSyncAt(Date.now());
    } catch {
      /* 일시적 네트워크 오류 — 폴링 루프가 죽지 않도록 삼킴(다음 주기 재시도) */
    } finally {
      setIsLoading(false);
    }
  }, [webinarId]);

  // 동시 접속 추이(차트·미니 스파크라인) + 운영 로그 — 대시보드와 같은 폴링 주기로 갱신
  const fetchCurve = useCallback(async () => {
    try { const res = await fetch(`/api/webinars/${webinarId}/analytics/attendance-curve?range=${curveRange}`); if (res.ok) setCurve(await res.json()); } catch { /* 다음 주기 재시도 */ }
  }, [webinarId, curveRange]);
  const fetchActivity = useCallback(async () => {
    try { const res = await fetch(`/api/webinars/${webinarId}/activity`); if (res.ok) setActivity((await res.json()).items ?? []); } catch { /* 다음 주기 재시도 */ }
  }, [webinarId]);

  // 적응형 폴링 — 라이브 15초 / 평시 90초, 탭 숨김 시 건너뜀
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let ticks = 0;
    let cancelled = false;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (!document.hidden) {
          await fetchDashboard();
          void fetchActivity();
          // 동시접속 곡선은 5분 버킷이라 매 틱(라이브 15초) 재조회는 낭비 — 4틱(≈60초)마다만
          if (ticks % 4 === 0) void fetchCurve();
          ticks += 1;
          setLiveTick((t) => t + 1);
        }
        schedule();
      }, statusRef.current === "live" ? 15_000 : 90_000);
    };
    // 초기 조회로 statusRef 를 먼저 확정한 뒤 스케줄 — 라이브인데 첫 주기가 90초로 잡히던 레이스 방지.
    void (async () => {
      await fetchDashboard();
      if (cancelled) return;
      void fetchCurve(); void fetchActivity();
      schedule();
    })();
    return () => { cancelled = true; clearTimeout(timer); };
    // isLivePolling 이 바뀌면 루프를 새로 짠다 — 수동으로 라이브 전환한 직후
    // 이미 걸려 있던 90초 타이머 때문에 첫 갱신이 늦어지던 문제.
  }, [fetchDashboard, fetchCurve, fetchActivity, isLivePolling]);

  const setOverride = async (value: WebinarStatus | null) => {
    if (switching) return;
    // 확인창 게이트는 "값 이름"이 아니라 "지금 시청자에게 보이는 것이 바뀌는가"로 잡는다 —
    // 방송 중(live)에 다른 값으로 나가는 전환은 registration·ended·null(자동) 어떤 값이든
    // 시청 화면을 대기 화면으로 되돌리고 영상을 끊는다. 값 이름만 보고 live/ended 전환에만
    // 확인창을 달면, '등록 중' 오클릭이 확인 없이 시청자 전원을 축출한다.
    const currentStatus = data?.status ?? "registration";
    const viewerCount = data?.summary?.activeViewers ?? 0;
    const knockOutDesc =
      viewerCount > 0
        ? `지금 시청 중인 시청자 ${viewerCount.toLocaleString()}명이 대기 화면으로 돌아가고 영상이 중단돼요.`
        : "지금 시청 중인 시청자가 대기 화면으로 돌아가고 영상이 중단돼요.";
    const confirmCfg =
      value === "live"
        ? { title: "'라이브'로 전환할까요?", description: "아임웹의 버튼·배너가 즉시 라이브 모드로 바뀌고, 등록자에게 시청 화면이 열려요.", confirmLabel: "라이브 시작", tone: "danger" as const }
        : currentStatus === "live"
          ? {
              title: value === "ended" ? "'종료'로 전환할까요?" : value === null ? "자동 판정으로 되돌릴까요?" : "'등록 중'으로 전환할까요?",
              description: knockOutDesc,
              confirmLabel: value === "ended" ? "종료" : "전환",
              tone: "danger" as const,
            }
          : null;
    if (confirmCfg && !(await confirm(confirmCfg))) return;
    setSwitching(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusOverride: value }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(value === null ? "일정 기반 자동 판정으로 복귀했어요" : "상태를 수동 전환했어요 — 아임웹 부착물에 2분 내 반영돼요");
      void fetchDashboard();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "상태 전환에 실패했어요");
    } finally {
      setSwitching(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = data?.status ?? "registration";
  const isOverridden = data?.isOverridden ?? false;
  const summary = data?.summary;
  // 시청자 목록은 서버에서 상위 일부만 내려온다 — 개수 표기는 항상 집계값을 쓴다.
  const presenceTotal = summary?.presenceViewers ?? 0;
  const viewers = data?.currentViewers ?? [];
  const meta = STATUS_META[status];
  // 활동 로그 → 차트 이벤트 마커(KST 분 단위). 최근 8건.
  const chartEvents = activity
    .filter((a) => CHART_EVENT_ACTIONS.has(a.action))
    .slice(0, 8)
    .map((a) => { const d = new Date(a.at); return { min: ((d.getUTCHours() + 9) % 24) * 60 + d.getUTCMinutes(), label: a.label }; });

  const hasRegistrationForm = Boolean(webinar?.config?.registrationForm);
  const hasVideo = typeof webinar?.config?.youtubeId === "string" && Boolean(webinar.config.youtubeId);
  // "세션 구성" 완료 판정은 실제 세션 기준 — 휴식·Q&A 행만 있으면 아직 구성된 게 아니다.
  const hasSessions = (webinar?.sessions ?? []).some(isRealSession);
  const showChecklist = (status === "registration" || status === "upcoming") && (summary?.attended ?? 0) === 0;

  const overrideOptions: { value: WebinarStatus | null; label: string }[] = [
    { value: null, label: "자동" },
    { value: "registration", label: "등록 중" },
    { value: "live", label: "라이브" },
    { value: "ended", label: "종료" },
  ];

  // ── 레이아웃 사이 재사용 블록 (라이브=2×2 그리드 / 그 외=단일 컬럼) ──
  const pushGroup = (
    <>
      <Section title="공지" icon={Megaphone} defaultOpen={status === "live"}>
        <AnnouncementsTab webinarId={webinarId} embedded />
      </Section>
      <Section title="팝업 푸시" icon={MessageSquarePlus}>
        <PopupPanel webinarId={webinarId} />
      </Section>
      <Section title="실시간 투표" icon={BarChart3} defaultOpen={status === "live"}>
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
          우하단에 떠 있는 실시간 투표예요. ON 상태 1개만 표시되고 집계는 자동으로 갱신돼요.
        </p>
        <PollPanel webinarId={webinarId} tick={liveTick} />
      </Section>
    </>
  );

  const participationGroup = (
    <>
      <Section
        title="Q&A 모더레이션"
        icon={HelpCircle}
        defaultOpen={false}
        badge={summary && summary.pendingQuestions > 0 ? (
          <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-500">{summary.pendingQuestions}</span>
        ) : undefined}
      >
        <QATab webinarId={webinarId} embedded tick={liveTick} />
      </Section>
      <Section title="실시간 채팅" icon={MessageSquare} defaultOpen={false}>
        <ChatPanel webinarId={webinarId} tick={liveTick} />
      </Section>
    </>
  );

  const sendGroup = (
    <>
      <Section title="설문 푸시" icon={ClipboardCheck}>
        <SurveyPushPanel webinarId={webinarId} />
      </Section>
      <Section title="Tally 설문 푸시" icon={Bell}>
        <TallyPanel webinarId={webinarId} />
      </Section>
      <Section title="알림 발송" icon={Mail}>
        <ReminderPanel webinarId={webinarId} />
      </Section>
    </>
  );

  const inquirySection = (
    <Section title="문의·폼 응답" icon={Inbox} defaultOpen={status === "live"}>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        CTA 폼·설문으로 들어온 응답이에요. 누가 무엇을 남겼는지 최신순으로 보여줘요 — 행을 누르면 답변 전체가 펼쳐져요.
      </p>
      <InquiryPanel webinarId={webinarId} tick={liveTick} onNavigate={onNavigate} />
    </Section>
  );

  const viewerSection = (
    // 배지는 실제 접속자 수(summary) — viewers 는 미리보기용으로 서버에서 잘려 오므로 개수로 쓰면 안 된다.
    <Section title="시청자" icon={Activity} badge={presenceTotal ? (
      <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-500">{presenceTotal.toLocaleString()}</span>
    ) : undefined}>
      {viewers.length === 0 ? (
        <p className="text-xs text-muted-foreground">현재 시청 중인 참여자가 없어요.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">이름</th>
                <th className="py-2 pr-3 font-medium">회사</th>
                <th className="py-2 pr-3 font-medium text-right">접속</th>
                <th className="py-2 font-medium text-right">상태</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {viewers.map((viewer) => (
                  <motion.tr
                    key={viewer.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="py-2 pr-3 font-medium">{viewer.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{viewer.company ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{viewer.currentStayMinutes}분</td>
                    <td className="py-2 text-right">
                      {viewer.isLive ? (
                        <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">시청 중</span>
                      ) : (
                        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">유지</span>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
          {presenceTotal > viewers.length && (
            <p className="pt-2 text-[11px] text-muted-foreground">외 {(presenceTotal - viewers.length).toLocaleString()}명 — 전체 명단은 등록자 탭에서 볼 수 있어요.</p>
          )}
        </div>
      )}
    </Section>
  );

  const activityLog = (
    <>
      <GroupLabel>운영 로그</GroupLabel>
      <ActivityFeed items={activity} />
    </>
  );

  // 인터랙션 설정 드로어 섹션 — 화면에 뜨는 것(공지·팝업·투표·Tally)과 알림 발송을 한 곳에서 만들기/편집.
  // render(open) — 드로어를 닫아도 패널을 마운트 유지(재조회 방지)하되, PollPanel 폴링은 open=false 면 tick=0 으로 멈춤.
  const interactionSections = [
    { key: "announcements", label: "공지", icon: Megaphone, render: () => <AnnouncementsTab webinarId={webinarId} embedded /> },
    { key: "popups", label: "팝업", icon: MessageSquarePlus, render: () => <PopupPanel webinarId={webinarId} /> },
    {
      key: "polls", label: "투표", icon: BarChart3, render: (open: boolean) => (
        <>
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">우하단에 떠 있는 실시간 투표예요. ON 상태 1개만 표시되고 집계는 자동으로 갱신돼요.</p>
          <PollPanel webinarId={webinarId} tick={open ? liveTick : 0} />
        </>
      ),
    },
    { key: "surveys", label: "설문", icon: ClipboardCheck, render: () => <SurveyPushPanel webinarId={webinarId} /> },
    { key: "tally", label: "Tally", icon: Bell, render: () => <TallyPanel webinarId={webinarId} /> },
    { key: "reminders", label: "알림", icon: Mail, render: () => <ReminderPanel webinarId={webinarId} /> },
  ];

  const runningOrder = webinar && (
    <RunningOrder
      key={webinarId}
      webinarId={webinarId}
      sessions={webinar.sessions ?? []}
      liveStartAt={webinar.liveStartAt}
      components={webinar.components}
      onSilentUpdate={onSilentUpdate}
    />
  );

  // 라이브 2행 좌우 — 480px 고정 높이, 헤더 고정 + 내부만 스크롤(fillHeight)
  const qaCard = (
    <section className="flex h-[76vh] flex-col overflow-hidden rounded-2xl border border-border bg-card lg:h-[620px]">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-4 sm:px-5">
        <HelpCircle className="h-4 w-4 text-violet-500" />
        <h2 className="text-sm font-semibold">Q&amp;A 대기열</h2>
        {summary && summary.pendingQuestions > 0 && (
          <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-500">{summary.pendingQuestions}</span>
        )}
        {/* 공개 범위 전환 — 라이브 중 1클릭 거리(채팅 켜기/끄기와 같은 자리·같은 무게).
            시청자에게 보이는 게 달라지는 조작이라 결과를 문구로 못박아 토스트로 알린다. */}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center rounded-full bg-secondary p-0.5" role="radiogroup" aria-label="Q&A 공개 범위">
            {([
              { v: "open" as const, t: "오픈형" },
              { v: "closed" as const, t: "폐쇄형" },
            ]).map((o) => (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={qaMode === o.v}
                onClick={() => setQaModeRemote(o.v)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all ${
                  qaMode === o.v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.t}
              </button>
            ))}
          </div>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">추천순</span>
        </div>
      </div>
      {qaMode === "closed" && (
        <p className="shrink-0 border-b border-border bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-700 sm:px-5 dark:text-amber-400">
          폐쇄형 — 시청자에게는 질문하기 입력만 보이고, 올라온 질문은 이 화면에서만 보여요.
        </p>
      )}
      <div className="min-h-0 flex-1 p-4 sm:p-5">
        <QATab webinarId={webinarId} embedded fillHeight tick={liveTick} />
      </div>
    </section>
  );

  const chatCard = (
    <section className="flex h-[76vh] flex-col overflow-hidden rounded-2xl border border-border bg-card lg:h-[620px]">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-4 sm:px-5">
        <MessageSquare className="h-4 w-4 text-violet-500" />
        <h2 className="text-sm font-semibold">채팅 모더레이션</h2>
        <div className="ml-auto flex items-center gap-2">
          <span className={`text-[11px] font-medium ${chatOn ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>{chatOn ? "켜짐" : "꺼짐"}</span>
          <Switch on={chatOn} onClick={toggleChatOn} label="시청자 채팅 켜기/끄기" />
        </div>
      </div>
      <div className="min-h-0 flex-1 p-4 sm:p-5">
        <ChatPanel webinarId={webinarId} tick={liveTick} fillHeight onEnabledChange={onPanelChatEnabled} />
      </div>
    </section>
  );

  // 종료 요약 — 사용 가능한 실데이터(누적 입장·평균 체류·피크·입장률)로 목업 recapgrid 재현
  const recapCard = status === "ended" && summary && (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border p-4 sm:px-5">
        <h2 className="text-sm font-semibold">방송 요약</h2>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">종료됨</span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {([
          { l: "누적 입장", v: summary.attended.toLocaleString() },
          { l: "평균 접속", v: `${summary.avgStayMinutes}분` },
          { l: "피크 동시", v: (curve?.peak ?? 0).toLocaleString() },
          { l: "입장률", v: `${summary.attendRate}%` },
        ]).map((r) => (
          <div key={r.l} className="bg-card p-4">
            <div className="text-[11px] text-muted-foreground">{r.l}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{r.v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border p-4 sm:px-5">
        <button onClick={() => onNavigate?.("operate-registrants")} className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-secondary">등록자 내보내기 (CSV) →</button>
        <span className="text-[11px] text-muted-foreground">다시보기·설문 발송은 아래 &lsquo;발송&rsquo;에서 이어서 진행하세요.</span>
      </div>
    </section>
  );

  const checklist = showChecklist && (
    <section className="rounded-2xl border border-border bg-secondary/20 p-4">
      <h3 className="text-sm font-semibold">라이브 전 준비</h3>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { done: hasRegistrationForm, icon: ClipboardList, label: "등록 폼 정리", target: "create-registration" },
          { done: (summary?.totalRegistered ?? 0) > 0, icon: Users, label: "등록자 확보", target: "operate-registrants" },
          // 세션은 IA 1단계에서 '원본 정보'로 합쳐졌다 — 옛 키는 alias 로 살아 있지만 새 링크는 새 키로 쓴다.
          { done: hasSessions, icon: ListChecks, label: "세션 구성", target: "create-source" },
          { done: hasVideo, icon: Eye, label: "라이브 영상 연결", target: "create-watch" },
        ].map((item) => (
          <motion.button
            key={item.label}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={() => onNavigate?.(item.target)}
            className={`flex items-center gap-2 rounded-xl border p-3 text-left text-xs transition-colors hover:border-violet-400/40 ${
              item.done ? "border-green-500/30 bg-green-500/[0.04]" : "border-border bg-background"
            }`}
          >
            <item.icon className={`h-4 w-4 shrink-0 ${item.done ? "text-green-500" : "text-muted-foreground"}`} />
            <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.label}</span>
          </motion.button>
        ))}
      </div>
    </section>
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      {/* 상태(커맨드) 바 */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.tone}`}>{meta.label}</span>
            {isOverridden && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                수동 전환됨
              </span>
            )}
            <motion.button whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }} transition={spring} onClick={() => { void fetchDashboard(); void fetchCurve(); void fetchActivity(); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary" aria-label="새로고침">
              <RefreshCw className="h-3.5 w-3.5" />
            </motion.button>
            <FreshBadge syncAt={syncAt} />
            {status === "live" && <LiveClock startAt={webinar?.liveStartAt} endAt={webinar?.liveEndAt} />}
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-border bg-background p-1">
            {overrideOptions.map((option) => {
              const selected = option.value === null ? !isOverridden : isOverridden && status === option.value;
              return (
                <motion.button
                  key={option.label}
                  whileTap={{ scale: 0.96 }}
                  transition={spring}
                  onClick={() => setOverride(option.value)}
                  disabled={switching || selected}
                  className={`relative rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-default ${
                    selected ? "text-white" : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {selected && (
                    <motion.span
                      layoutId="live-status-seg"
                      transition={spring}
                      className="absolute inset-0 rounded-lg bg-violet-500"
                      style={{ zIndex: 0 }}
                    />
                  )}
                  <span className="relative z-10">{option.label}</span>
                </motion.button>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          상태는 아임웹의 버튼·배너·등록 폼에 자동 반영돼요. 수동 전환 후 &ldquo;자동&rdquo;을 누르면 일정 기반 판정으로 돌아가요.
        </p>
      </section>

      {/* 실시간 지표 — 통합 스트립(현재 시청 강조 + 미니 스파크). 종료 상태에선 recap 카드가 대신함 */}
      {summary && status !== "ended" && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground">현재 시청</div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-3xl font-semibold leading-none tabular-nums">{summary.activeViewers.toLocaleString()}</span>
              <div className="h-7 min-w-[48px] flex-1"><Sparkline values={(curve?.points ?? []).map((p) => p.viewers)} /></div>
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">최근 90초{curve?.peak ? ` · 피크 ${curve.peak.toLocaleString()}` : ""}</div>
          </div>
          {([
            { l: "입장률", v: `${summary.attendRate}`, u: "%", bar: summary.attendRate },
            { l: "입장", v: summary.attended.toLocaleString(), sub: `사전등록 ${summary.totalRegistered.toLocaleString()}` },
            { l: "페이지 유지", v: summary.presenceViewers.toLocaleString(), sub: "최근 5분" },
            { l: "평균 접속", v: `${summary.avgStayMinutes}`, u: "분" },
            { l: "대기 질문", v: summary.pendingQuestions.toLocaleString(), attn: summary.pendingQuestions > 0 },
          ] as { l: string; v: string; u?: string; sub?: string; bar?: number; attn?: boolean }[]).map((s) => (
            <div key={s.l} className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-4">
              <span className="text-[11px] text-muted-foreground">{s.l}</span>
              <span className={`text-2xl font-semibold leading-none tabular-nums ${s.attn ? "text-amber-500" : ""}`}>{s.v}{s.u && <span className="ml-0.5 text-sm font-medium text-muted-foreground">{s.u}</span>}</span>
              {s.bar != null ? (
                <div className="h-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-green-500" style={{ width: `${s.bar}%` }} /></div>
              ) : (
                <span className="text-[11px] text-muted-foreground">{s.sub ?? " "}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {status === "live" ? (
        <>
          {/* 라이브 1행: 동시 접속 추이 + 러닝오더 (같은 줄 높이 일치) */}
          <div className="grid items-stretch gap-4 lg:grid-cols-[1.6fr_1fr]">
            <ViewerChart curve={curve} events={chartEvents} range={curveRange} onRangeChange={setCurveRange} />
            {runningOrder}
          </div>

          {/* 라이브 2행: 화면에 띄우기(통합 송출 카드) · Q&A 대기열 · 채팅 모더레이션 (높이 일치) */}
          <div className="grid gap-4 lg:grid-cols-3">
            <BroadcastCard webinarId={webinarId} tick={liveTick} sections={interactionSections} />
            {qaCard}
            {chatCard}
          </div>

          {/* 시청자·문의·운영 로그 — 라이브 작업 영역 아래로 (발송·편집은 인터랙션 카드의 설정 드로어로 이동) */}
          {inquirySection}
          {viewerSection}
          {activityLog}
        </>
      ) : (
        <>
          {recapCard}
          {status === "ended" && <ViewerChart curve={curve} events={chartEvents} range={curveRange} onRangeChange={setCurveRange} />}
          {checklist}
          {runningOrder}

          {/* ── 화면에 띄우기 — 시청 화면 위에 뜨는 것. 한 번에 하나만(팝업 우선). ── */}
          <GroupLabel>인터랙션 · 한 번에 하나만</GroupLabel>
          {pushGroup}

          {/* ── 참여 관리 — 시청자가 남긴 것 관리 ── */}
          <GroupLabel>참여 관리</GroupLabel>
          {participationGroup}
          {inquirySection}

          {/* ── 발송 — 외부 설문·이메일 내보내기 ── */}
          <GroupLabel>발송</GroupLabel>
          {sendGroup}
          {viewerSection}
          {activityLog}
        </>
      )}
    </div>
  );
}
