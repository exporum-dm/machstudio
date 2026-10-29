"use client";

/**
 * 도구 → 이벤트 택소노미 — GA4/GTM 이벤트 이름 짓는 규칙을 한 곳에.
 *
 *  1) 설계 안내: 이벤트를 어떻게 정할지 짧은 원칙. 처음 쓰는 사람도 표를 채우기 전에 읽고 시작하게.
 *  2) 이벤트: GA4/GTM 이벤트 이름·발생 시점·파라미터. 이름은 GA4 규칙대로만 저장된다.
 *  3) machstudio 가 자동으로 보내는 이벤트: 등록 폼이 dataLayer 로 보내는 것 — 읽기 전용.
 *
 * UTM 값(source·medium·campaign 선택지)은 UTM 빌더의 "선택지 관리"로 옮겼다(2026-10-29).
 * 고치는 화면이다(AGENTS §2): 값은 표에서 바로 고치고 칸을 벗어나면 저장된다.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import {
  BUILTIN_EVENTS,
  EVENT_NAME_RE,
  TAXONOMY_PLATFORMS,
  TAXONOMY_STATUS_LABEL,
  toEventName,
  type TaxonomyParameter,
} from "@/lib/event-taxonomy";

interface EventRow {
  id: string; name: string; category: string; description: string; trigger: string;
  parameters: TaxonomyParameter[]; platforms: string[]; status: "active" | "deprecated";
}

// 이벤트를 정하기 전에 읽는 원칙 — 길게 쓰지 않는다. 다섯 줄이면 표를 채울 수 있게.
const DESIGN_STEPS = [
  { title: "질문부터 정해요", body: "\"사전등록 전환율은?\" \"어느 버튼에서 문의가 오나?\"처럼 보고서에서 답하고 싶은 질문을 먼저 적고, 그 답에 필요한 행동만 이벤트로 만들어요." },
  { title: "이름은 대상_동작", body: "booth_inquiry_click, brochure_download처럼 영문 소문자와 밑줄로 써요. 동작은 view · click · submit · download처럼 몇 개로 정해 두면 이름이 흩어지지 않아요." },
  { title: "세부는 파라미터로", body: "버튼마다 이벤트를 만들지 말고 cta_click 하나에 button_location 같은 파라미터로 나눠요. 보고서에서 보려면 GA4 맞춤 측정기준으로 등록해야 해요." },
  { title: "GA4 기본 이름을 먼저", body: "sign_up, generate_lead처럼 GA4가 정해 둔 이벤트가 있으면 그 이름을 그대로 써요. 전환 설정과 기본 보고서가 바로 맞물려요." },
  { title: "바꾸지 말고 멈추기", body: "이름을 바꾸면 이전 데이터와 끊겨요. 안 쓰게 된 이벤트는 지우지 말고 '사용 안 함'으로 바꿔 기록을 남겨요." },
] as const;

export default function TaxonomyTab({ onOpenUtm }: { onOpenUtm?: () => void }) {
  const { workspace } = useWorkspace();
  const confirm = useConfirm();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newEventName, setNewEventName] = useState("");

  const load = useCallback(async () => {
    if (!workspace) return;
    const e = await fetch(`/api/event-taxonomy?workspaceId=${workspace.id}`).then((r) => r.json()).catch(() => ({ events: [] }));
    setEvents(e.events ?? []);
  }, [workspace]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  // ── 이벤트 ────────────────────────────────────────────────
  const addEvent = async () => {
    if (!workspace) return;
    const name = toEventName(newEventName);
    if (!EVENT_NAME_RE.test(name)) { toast.error("영문 소문자로 시작하고 소문자·숫자·밑줄만 쓸 수 있어요"); return; }
    const res = await fetch("/api/event-taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, name, platforms: ["GA4", "GTM"] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "추가하지 못했어요"); return; }
    setEvents((prev) => [...(prev ?? []), data.event]);
    setNewEventName("");
    setOpenId(data.event.id);
  };
  const patchEvent = async (id: string, patch: Partial<EventRow>) => {
    setEvents((prev) => (prev ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const res = await fetch("/api/event-taxonomy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "저장하지 못했어요"); void load(); return; }
    setEvents((prev) => (prev ?? []).map((x) => (x.id === id ? data.event : x)));
  };
  const removeEvent = async (row: EventRow) => {
    const ok = await confirm({ title: `'${row.name}' 이벤트를 지울까요?`, confirmLabel: "지우기", tone: "danger" });
    if (!ok) return;
    const res = await fetch(`/api/event-taxonomy?id=${row.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("지우지 못했어요"); return; }
    setEvents((prev) => (prev ?? []).filter((x) => x.id !== row.id));
  };

  if (!events) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* ── 설계 안내 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">이벤트 택소노미 설계하기</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            사이트에서 일어나는 행동에 팀 모두가 같은 이름을 붙이는 약속이에요. 한 번 정해 두면 GA4 보고서가 행사마다 흩어지지 않아요.
          </p>
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {DESIGN_STEPS.map((step, i) => (
            <li key={step.title} className={`min-w-0 bg-background p-3 ${R.panel} ${FINISH.s1}`}>
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[10px] text-violet-600 dark:text-violet-400">{i + 1}</span>
                {step.title}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="text-[11px] text-muted-foreground">
          유입 경로(utm_source·medium·campaign) 값은 이벤트가 아니라 링크에 붙는 꼬리표라{" "}
          {onOpenUtm ? (
            <button onClick={onOpenUtm} className="inline-flex items-center gap-0.5 text-violet-500 hover:underline">
              UTM 빌더 → 선택지 관리<ArrowRight className="h-3 w-3" />
            </button>
          ) : (
            <b>UTM 빌더 → 선택지 관리</b>
          )}
          에서 정해요.
        </p>
      </section>

      {/* ── 이벤트 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">이벤트</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            GA4·GTM 이벤트 이름 규칙. 이름은 GA4 규칙(영문 소문자·숫자·밑줄, 40자)으로만 저장돼요 — 대문자·띄어쓰기가 섞이면 GA4에서 다른 이벤트로 갈라져요.
          </p>
        </div>
        <div className={`overflow-hidden bg-background ${R.panel} ${FINISH.s1}`}>
          {events.length === 0 && <p className="px-4 py-5 text-center text-xs text-muted-foreground">아직 등록한 이벤트가 없어요</p>}
          {events.map((row) => (
            <EventRowView
              key={row.id}
              row={row}
              open={openId === row.id}
              onToggle={() => setOpenId((v) => (v === row.id ? null : row.id))}
              onPatch={(patch) => void patchEvent(row.id, patch)}
              onRemove={() => void removeEvent(row)}
            />
          ))}
          <div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
            <input
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void addEvent(); }}
              placeholder="새 이벤트 이름 (예: booth_inquiry_click)"
              className={`${FIELD_CLS} h-8 max-w-sm flex-1 font-mono text-xs`}
            />
            <button onClick={() => void addEvent()} className={`flex items-center gap-1 bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-600 ${R.control}`}>
              <Plus className="h-3 w-3" />추가
            </button>
            {newEventName && toEventName(newEventName) !== newEventName && (
              <span className="text-[11px] text-muted-foreground">저장될 이름: <code>{toEventName(newEventName)}</code></span>
            )}
          </div>
        </div>
      </section>

      {/* ── machstudio 자동 이벤트 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">machstudio가 자동으로 보내는 이벤트</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">사전등록 폼이 사이트의 dataLayer로 보내요. GTM에서 이 이름으로 트리거를 만들면 돼요(미리보기에서는 보내지 않아요).</p>
        </div>
        <div className={`overflow-x-auto bg-background ${R.panel} ${FINISH.s1}`}>
          <table className="w-full text-xs">
            <thead className="bg-secondary/40 text-left text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">이벤트</th><th className="px-4 py-2 font-medium">언제</th><th className="px-4 py-2 font-medium">파라미터</th></tr>
            </thead>
            <tbody>
              {BUILTIN_EVENTS.map((e) => (
                <tr key={e.name} className="border-t border-border">
                  <td className="whitespace-nowrap px-4 py-2 font-mono">{e.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{e.trigger}</td>
                  <td className="px-4 py-2 font-mono text-muted-foreground">{e.parameters.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EventRowView({
  row, open, onToggle, onPatch, onRemove,
}: {
  row: EventRow;
  open: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<EventRow>) => void;
  onRemove: () => void;
}) {
  const setParam = (index: number, patch: Partial<TaxonomyParameter>) =>
    onPatch({ parameters: row.parameters.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <button onClick={onToggle} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={open ? "접기" : "펼치기"}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <input
          defaultValue={row.name}
          onBlur={(e) => { const v = toEventName(e.target.value); if (v !== row.name) onPatch({ name: v }); }}
          className={`${FIELD_CLS} h-7 w-56 max-w-full font-mono text-xs ${row.status === "deprecated" ? "line-through opacity-60" : ""}`}
          aria-label="이벤트 이름"
        />
        <input
          defaultValue={row.description}
          onBlur={(e) => { if (e.target.value !== row.description) onPatch({ description: e.target.value }); }}
          placeholder="설명 (무엇을 재나)"
          className={`${FIELD_CLS} h-7 min-w-0 flex-1 text-xs`}
        />
        <select
          value={row.status}
          onChange={(e) => onPatch({ status: e.target.value as EventRow["status"] })}
          className={`${FIELD_CLS} h-7 w-28 text-xs`}
        >
          {Object.entries(TAXONOMY_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button onClick={onRemove} className="rounded p-1 text-muted-foreground hover:text-red-500" aria-label={`${row.name} 지우기`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="space-y-2 border-t border-border bg-secondary/20 px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">분류</span>
              <input defaultValue={row.category} onBlur={(e) => { if (e.target.value !== row.category) onPatch({ category: e.target.value }); }}
                placeholder="예: 전환 · 참여 · 콘텐츠" className={`${FIELD_CLS} h-8 text-xs`} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">언제 발생하나</span>
              <input defaultValue={row.trigger} onBlur={(e) => { if (e.target.value !== row.trigger) onPatch({ trigger: e.target.value }); }}
                placeholder="예: 부스 문의 버튼 클릭" className={`${FIELD_CLS} h-8 text-xs`} />
            </label>
          </div>
          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground">보내는 곳</span>
            <div className="flex flex-wrap gap-1">
              {TAXONOMY_PLATFORMS.map((p) => {
                const on = row.platforms.includes(p);
                return (
                  <button key={p} onClick={() => onPatch({ platforms: on ? row.platforms.filter((x) => x !== p) : [...row.platforms, p] })}
                    className={`px-2 py-1 text-[11px] transition-colors ${R.control} ${on ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground">파라미터</span>
            {row.parameters.map((p, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_24px] items-center gap-1.5">
                <input defaultValue={p.key} onBlur={(e) => { const v = toEventName(e.target.value); if (v !== p.key) setParam(i, { key: v }); }}
                  placeholder="key" className={`${FIELD_CLS} h-7 font-mono text-xs`} />
                <input defaultValue={p.description} onBlur={(e) => { if (e.target.value !== p.description) setParam(i, { description: e.target.value }); }}
                  placeholder="설명" className={`${FIELD_CLS} h-7 text-xs`} />
                <input defaultValue={p.example} onBlur={(e) => { if (e.target.value !== p.example) setParam(i, { example: e.target.value }); }}
                  placeholder="예시 값" className={`${FIELD_CLS} h-7 text-xs`} />
                <button onClick={() => onPatch({ parameters: row.parameters.filter((_, x) => x !== i) })} className="rounded p-1 text-muted-foreground hover:text-red-500" aria-label="파라미터 지우기">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button onClick={() => onPatch({ parameters: [...row.parameters, { key: `param_${row.parameters.length + 1}`, description: "", example: "" }] })}
              className="flex items-center gap-1 text-[11px] text-violet-500 hover:underline">
              <Plus className="h-3 w-3" />파라미터 추가
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
