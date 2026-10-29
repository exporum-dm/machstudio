"use client";

/**
 * 주간 보고 — DM 주간 업무 보고 시트와 같은 표(2026-10-18 실제 보고서에 맞춤).
 *
 *  보고일(목) 기준 전주 달성 = 보고일까지 7일, 금주 목표 = 다음 7일.
 *  업무일지로 초안을 만들고(행사 = 일지 머리표, 분류 = 낱말), 칸을 시트처럼 "[운영]\n- 내역" 으로 바로 고친다.
 *  고치면 그 보고일 보고서로 저장되고, 다음 주 보고서·AI 다듬기가 이 흐름을 잇는다.
 *  엑셀은 시트와 같은 자리(B2~)·같은 시트 이름(YYMMDD).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Copy, Download, Loader2, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import {
  REPORT_STATUS_LABELS, blockText, defaultReportDate, kstToday, parseBlockText, shiftDay,
  type ReportBlock, type ReportRow, type WeeklyReport,
} from "@/lib/worklog";

const md = (day: string) => {
  const [, m, d] = day.split("-");
  return `${Number(m)}/${Number(d)}`;
};
const SOURCE_LABEL: Record<string, string> = { edited: "저장됨", imported: "엑셀에서 불러온 보고서", ai: "AI로 다듬음" };
type Side = "last" | "next";
type Saved = { source: string; updatedAt: string } | null;

export default function ReportTab({ workspaceId, hasGroups }: { workspaceId: string; hasGroups: boolean }) {
  const confirm = useConfirm();
  const [date, setDate] = useState(() => defaultReportDate(kstToday()));
  const [hideOwners, setHideOwners] = useState(true);
  const [metrics, setMetrics] = useState(true);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [saved, setSaved] = useState<Saved>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [version, setVersion] = useState(0); // 칸을 다시 그릴 때(불러오기·AI) — 칸은 defaultValue 라서
  const rowsRef = useRef<ReportRow[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const timerJob = useRef<{ workspaceId: string; date: string; source: "edited" | "ai" } | null>(null);
  const saveQueue = useRef<{ workspaceId: string; date: string; rows: ReportRow[]; source: "edited" | "ai" } | null>(null);
  const saveRunning = useRef(false);
  const resolvePending = useRef<(() => void) | null>(null);
  const loadSeq = useRef(0);
  const loadingRef = useRef(false);
  const [saveScheduled, setSaveScheduled] = useState(false);

  const applyRows = useCallback((next: ReportRow[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const load = useCallback(async (fresh = false) => {
    const seq = ++loadSeq.current;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/worklog/report?workspaceId=${workspaceId}&date=${date}${metrics ? "&metrics=1" : ""}${fresh ? "&fresh=1" : ""}`);
      const json = await res.json().catch(() => null);
      if (seq !== loadSeq.current) return;
      if (!res.ok) { toast.error(json?.error ?? "보고서를 만들지 못했어요"); return; }
      setReport(json.report);
      applyRows(json.report.rows);
      setSaved(json.saved);
      setAiAvailable(!!json.aiAvailable);
      setVersion((v) => v + 1);
    } finally {
      if (seq === loadSeq.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [workspaceId, date, metrics, applyRows]);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  const drainSaveQueue = useCallback(async () => {
    if (saveRunning.current) return;
    saveRunning.current = true;
    setSaving(true);
    try {
      while (saveQueue.current) {
        // 기다리는 동안 여러 번 고쳤으면 마지막 모습 하나만 저장한다.
        const job = saveQueue.current;
        saveQueue.current = null;
        try {
          const res = await fetch("/api/worklog/report", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(job),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) toast.error(json.error ?? "저장하지 못했어요");
          else setSaved(json.saved);
        } catch {
          toast.error("저장하지 못했어요");
        }
      }
    } finally {
      saveRunning.current = false;
      setSaving(false);
      const resolve = resolvePending.current;
      resolvePending.current = null;
      pending.current = null;
      resolve?.();
    }
  }, []);

  const save = useCallback((source: "edited" | "ai" = "edited", scope = { workspaceId, date }): Promise<void> => {
    // 날짜가 바뀐 뒤 실행돼도 고치던 보고일로 가도록 예약 순간의 범위를 담는다.
    saveQueue.current = { ...scope, rows: rowsRef.current, source };
    if (!pending.current) {
      pending.current = new Promise<void>((resolve) => { resolvePending.current = resolve; });
    }
    const wait = pending.current;
    void drainSaveQueue();
    return wait;
  }, [workspaceId, date, drainSaveQueue]);

  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => () => {
    if (!timer.current || !timerJob.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    const job = timerJob.current;
    timerJob.current = null;
    void saveRef.current(job.source, { workspaceId: job.workspaceId, date: job.date });
  }, []);

  const scheduleSave = () => {
    if (timer.current) clearTimeout(timer.current);
    timerJob.current = { workspaceId, date, source: "edited" };
    setSaveScheduled(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      const job = timerJob.current;
      timerJob.current = null;
      setSaveScheduled(false);
      if (job) void save(job.source, { workspaceId: job.workspaceId, date: job.date });
    }, 700);
  };
  const flush = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      const job = timerJob.current;
      timerJob.current = null;
      setSaveScheduled(false);
      if (job) await save(job.source, { workspaceId: job.workspaceId, date: job.date });
    }
    if (pending.current) await pending.current;
  };

  const edit = (fn: (rows: ReportRow[]) => ReportRow[]) => {
    // 다른 보고서를 읽는 사이 남아 있던 입력 이벤트가 새 날짜에 섞이지 않게 한다.
    if (loadingRef.current) return;
    applyRows(fn(rowsRef.current));
    scheduleSave();
  };
  const setBlock = (ri: number, pi: number, side: Side, patch: Partial<ReportBlock> | null) =>
    edit((rs) => rs.map((r, i) => (i !== ri ? r : {
      ...r,
      pairs: r.pairs.map((p, j) => {
        if (j !== pi) return p;
        if (patch === null) return { ...p, [side]: null };
        const base: ReportBlock = p[side] ?? { category: "", lines: [], owners: [], status: "", extra: [] };
        const next = { ...base, ...patch };
        const empty = !next.category && next.lines.length === 0 && next.extra.length === 0;
        return { ...p, [side]: empty ? null : next };
      }),
    })));
  const addPair = (ri: number) => {
    edit((rs) => rs.map((r, i) => (i !== ri ? r : { ...r, pairs: [...r.pairs, { last: { category: "운영", lines: [], owners: [], status: "진행", extra: [] }, next: null }] })));
    setVersion((v) => v + 1);
  };
  const removePair = (ri: number, pi: number) => {
    const removed = rowsRef.current[ri]?.pairs[pi];
    if (!removed) return;
    let restored = false;
    edit((rs) => rs.map((r, i) => (i !== ri ? r : { ...r, pairs: r.pairs.filter((_, j) => j !== pi) })));
    setVersion((v) => v + 1);
    toast("묶음을 지웠어요", {
      action: {
        label: "되돌리기",
        onClick: () => {
          if (restored || loadingRef.current) return;
          restored = true;
          edit((rs) => rs.map((r, i) => (i !== ri ? r : {
            ...r,
            pairs: [...r.pairs.slice(0, pi), removed, ...r.pairs.slice(pi)],
          })));
          setVersion((v) => v + 1);
        },
      },
    });
  };

  const regenerate = async () => {
    if (saved) {
      const ok = await confirm({
        title: "업무일지로 다시 만들까요?",
        description: "이 보고일에 저장된 보고서(고친 내용)를 지우고, 지금 업무일지로 초안을 새로 만들어요.",
        confirmLabel: "다시 만들기",
        tone: "danger",
      });
      if (!ok) return;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      timerJob.current = null;
      setSaveScheduled(false);
      if (pending.current) await pending.current;
      await fetch(`/api/worklog/report?workspaceId=${workspaceId}&date=${date}`, { method: "DELETE" });
    }
    await load(true);
  };

  const polish = async () => {
    if (saved && saved.source !== "ai") {
      const ok = await confirm({
        title: "AI로 다시 쓸까요?",
        description: "업무일지 초안과 지난 보고서를 보고 칸 글을 새로 써요. 지금 고친 내용은 바뀌어요.",
        confirmLabel: "AI로 다듬기",
      });
      if (!ok) return;
    }
    setAiBusy(true);
    try {
      const res = await fetch("/api/worklog/report/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, date, metrics }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? "AI 가 보고서를 쓰지 못했어요"); return; }
      applyRows(json.report.rows);
      setVersion((v) => v + 1);
      await save("ai", { workspaceId, date });
      toast.success("AI로 다듬었어요 — 칸을 눌러 더 고칠 수 있어요");
    } finally {
      setAiBusy(false);
    }
  };

  /** 메신저·메일에 바로 붙일 글 — 행사별로 전주/금주. */
  const asText = () => {
    const lines: string[] = [`[주간 업무 보고] ${date}`, ""];
    for (const row of rows) {
      if (row.pairs.length === 0) continue;
      lines.push(`■ ${row.groupName.replace(/\n/g, " ")}`);
      for (const p of row.pairs) {
        if (p.last) lines.push(`  전주 (${p.last.status || "-"}) ${blockText(p.last).replace(/\n/g, " ")}`);
        if (p.next) lines.push(`  금주 (${p.next.status || "-"}) ${blockText(p.next).replace(/\n/g, " ")}`);
      }
    }
    return lines.join("\n");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      toast.success("복사했어요");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("복사하지 못했어요");
    }
  };
  const download = async () => {
    await flush();
    window.location.href = `/api/worklog/report?workspaceId=${workspaceId}&date=${date}&format=xlsx${hideOwners ? "&hideOwners=1" : ""}${metrics ? "&metrics=1" : ""}`;
  };

  const changeDate = async (next: string) => {
    if (next === date) return;
    // 이전 요청과 입력을 먼저 닫고 나서 날짜를 바꿔야 줄이 다른 보고일로 가지 않는다.
    loadSeq.current++;
    loadingRef.current = true;
    setLoading(true);
    await flush();
    setDate(next);
  };
  const changeMetrics = async (next: boolean) => {
    if (next === metrics) return;
    loadSeq.current++;
    loadingRef.current = true;
    setLoading(true);
    await flush();
    setMetrics(next);
  };

  useEffect(() => {
    if (!saveScheduled && !saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveScheduled, saving]);

  const filled = rows.reduce((n, r) => n + r.pairs.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-[11px] text-muted-foreground">보고일</span>
            <div className="flex items-center gap-1">
              <button onClick={() => void changeDate(shiftDay(date, -7))} className={`bg-secondary px-2 py-1.5 text-xs ${R.control}`} aria-label="지난 보고">‹</button>
              <input type="date" value={date} onChange={(e) => e.target.value && void changeDate(e.target.value)} className={`${FIELD_CLS} h-8 w-40 text-xs`} />
              <button onClick={() => void changeDate(shiftDay(date, 7))} className={`bg-secondary px-2 py-1.5 text-xs ${R.control}`} aria-label="다음 보고">›</button>
            </div>
          </label>
          {report && (
            <div className="pb-1 text-xs text-muted-foreground">
              전주 달성 <b className="text-foreground">{md(report.lastWeek.start)}~{md(report.lastWeek.end)}</b> · 금주 목표 <b className="text-foreground">{md(report.thisWeek.start)}~{md(report.thisWeek.end)}</b>
              <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${saved ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
                {saving ? "저장 중…" : saved ? `${SOURCE_LABEL[saved.source] ?? "저장됨"} · ${new Date(saved.updatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "업무일지 자동 초안 — 고치면 저장돼요"}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" title="초안에 프로젝트 전주 사전등록·광고 숫자를 붙여요">
            <input type="checkbox" checked={metrics} onChange={(e) => void changeMetrics(e.target.checked)} className="accent-violet-500" />
            지표 붙이기
          </label>
          <label className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" title="회사 보고용 — 엑셀에서 담당자·결과 칸을 비워요">
            <input type="checkbox" checked={hideOwners} onChange={(e) => setHideOwners(e.target.checked)} className="accent-violet-500" />
            담당·결과 숨기기
          </label>
          <button onClick={() => void regenerate()} disabled={loading} className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground ${R.control}`}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />업무일지로 다시 만들기
          </button>
          <button onClick={() => void polish()} disabled={!aiAvailable || aiBusy}
            title={aiAvailable ? "지난 보고서 문체대로 여러 줄을 합치고 다듬어요" : "Vercel 환경 변수 ANTHROPIC_API_KEY 를 넣으면 켜져요"}
            className={`flex items-center gap-1 bg-violet-500/10 px-2.5 py-1.5 text-xs font-medium text-violet-600 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-violet-400 ${R.control}`}>
            {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}AI로 다듬기
          </button>
          <button onClick={() => void copy()} disabled={!report} className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 ${R.control}`}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}글로 복사
          </button>
          <button onClick={() => void download()} disabled={!report}
            className={`flex items-center gap-1 bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-40 ${R.control}`}>
            <Download className="h-3 w-3" />엑셀 다운로드
          </button>
        </div>
      </div>

      {!hasGroups && (
        <p className={`bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 ${R.control}`}>
          행사가 없어서 모든 줄이 &ldquo;기타&rdquo;로 묶여요 — 행사 관리 탭에서 행사를 불러와 주세요.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        칸을 눌러 시트처럼 고쳐요 — 첫 줄 <code className="rounded bg-secondary px-1">[운영]</code> 이 분류, 아래 <code className="rounded bg-secondary px-1">- 내역</code> 이 줄이에요. 초안은 지난 보고의 금주 목표에서 이어 쓰고, 회의·정산·정리 같은 잔손 일은 빼고, 같은 종류 업로드는 한 줄로 합쳐 둔 거예요. 더 줄이거나 문장을 다듬어 주세요{aiAvailable ? "(AI로 다듬기가 대신 해요)" : ""}.
      </p>

      {loading && !report ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : report && (
        <div className={`overflow-x-auto bg-background ${loading ? "pointer-events-none opacity-60" : ""} ${R.panel} ${FINISH.s1}`}>
          <table className="w-full min-w-[1000px] table-fixed border-collapse text-xs">
            <colgroup>
              <col className="w-44" /><col /><col className="w-[72px]" /><col className="w-36" /><col /><col className="w-[72px]" /><col className="w-36" /><col className="w-7" />
            </colgroup>
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground">
                <th className="sticky left-0 z-10 bg-secondary px-3 py-2" />
                <th colSpan={3} className="border-l border-border px-3 py-2 text-left font-semibold text-foreground">전주 달성</th>
                <th colSpan={3} className="border-l border-border px-3 py-2 text-left font-semibold text-foreground">금주 목표</th>
                <th />
              </tr>
              <tr className="bg-secondary/30 text-left text-muted-foreground">
                <th className="sticky left-0 z-10 bg-secondary px-3 py-1.5 font-medium">행사</th>
                <th className="border-l border-border px-3 py-1.5 font-medium">내역</th>
                <th className="px-2 py-1.5 font-medium">달성</th>
                <th className="px-2 py-1.5 font-medium">결과 및 산출물</th>
                <th className="border-l border-border px-3 py-1.5 font-medium">내역</th>
                <th className="px-2 py-1.5 font-medium">달성</th>
                <th className="px-2 py-1.5 font-medium">비고</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const pairs = row.pairs.length ? row.pairs : [null];
                return pairs.map((pair, pi) => (
                  <tr key={`${version}-${ri}-${pi}`} className={`group align-top ${pi === 0 ? "border-t-2 border-border" : "border-t border-border/50"}`}>
                    {pi === 0 && (
                      <td rowSpan={pairs.length} className="sticky left-0 z-10 bg-background px-3 py-2 font-medium">
                        <div className="whitespace-pre-line">{row.groupName}</div>
                        <button onClick={() => addPair(ri)} className="mt-1 flex items-center gap-0.5 text-[11px] font-normal text-muted-foreground opacity-0 transition-opacity hover:text-violet-500 group-hover:opacity-100 [@media(hover:none)]:opacity-60">
                          <Plus className="h-3 w-3" />묶음 추가
                        </button>
                      </td>
                    )}
                    {pair === null ? (
                      <td colSpan={7} className="border-l border-border px-3 py-2 text-muted-foreground/50">—</td>
                    ) : (
                      <>
                        <BlockCells block={pair.last} border onText={(t) => setBlock(ri, pi, "last", parseBlockText(t))} onStatus={(s) => setBlock(ri, pi, "last", { status: s })} onExtra={(x) => setBlock(ri, pi, "last", { extra: x })} />
                        <BlockCells block={pair.next} border onText={(t) => setBlock(ri, pi, "next", parseBlockText(t))} onStatus={(s) => setBlock(ri, pi, "next", { status: s })} onExtra={(x) => setBlock(ri, pi, "next", { extra: x })} />
                        <td className="py-2 pr-1">
                          <button onClick={() => removePair(ri, pi)} className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-red-500 group-hover:opacity-100 [@media(hover:none)]:opacity-60" aria-label="묶음 지우기">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          </table>
          {filled === 0 && <p className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground">이 기간에 적은 일지가 없어요 — 일지 탭에서 적으면 여기 채워져요.</p>}
        </div>
      )}
    </div>
  );
}

function BlockCells({ block, border, onText, onStatus, onExtra }: {
  block: ReportBlock | null;
  border?: boolean;
  onText: (text: string) => void;
  onStatus: (status: string) => void;
  onExtra: (extra: string[]) => void;
}) {
  const text = blockText(block);
  const extra = block?.extra.join("\n") ?? "";
  return (
    <>
      <td className={`px-2 py-1.5 ${border ? "border-l border-border" : ""}`}>
        <AutoTextarea defaultValue={text} placeholder="[분류]&#10;- 내역" onCommit={(v) => { if (v !== text) onText(v); }} />
      </td>
      <td className="px-1 py-1.5">
        <select value={block?.status ?? ""} onChange={(e) => onStatus(e.target.value)} disabled={!block} className={`${FIELD_CLS} h-7 w-full px-1 text-xs`} aria-label="달성">
          <option value="">-</option>
          {REPORT_STATUS_LABELS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="px-1 py-1.5">
        <AutoTextarea defaultValue={extra} placeholder="" muted onCommit={(v) => { if (v !== extra) onExtra(v.split("\n").map((s) => s.trim()).filter(Boolean)); }} />
      </td>
    </>
  );
}

function AutoTextarea({ defaultValue, placeholder, muted, onCommit }: { defaultValue: string; placeholder: string; muted?: boolean; onCommit: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(onCommit);
  useEffect(() => { commitRef.current = onCommit; }, [onCommit]);
  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [defaultValue]);
  return (
    <textarea
      ref={ref}
      rows={1}
      defaultValue={defaultValue}
      placeholder={placeholder.replace("&#10;", "\n")}
      onInput={(e) => {
        fit();
        if (debounce.current) clearTimeout(debounce.current);
        const value = e.currentTarget.value;
        // 탭을 닫기 전에도 입력값이 부모 상태와 저장 예약에 올라오게 한다.
        debounce.current = setTimeout(() => {
          debounce.current = null;
          commitRef.current(value);
        }, 600);
      }}
      onBlur={(e) => {
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = null;
        commitRef.current(e.target.value);
      }}
      className={`block w-full resize-none overflow-hidden rounded-md bg-transparent px-1.5 py-1 text-xs leading-5 outline-none transition-colors hover:bg-secondary/50 focus:bg-secondary/60 focus:ring-1 focus:ring-violet-500/40 ${muted ? "text-muted-foreground" : ""}`}
    />
  );
}
