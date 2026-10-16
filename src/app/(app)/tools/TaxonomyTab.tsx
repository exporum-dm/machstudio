"use client";

/**
 * 도구 → 이벤트 택소노미 — 이름 짓는 규칙을 한 곳에.
 *
 *  1) UTM 값: UTM 빌더의 프리셋(UTMPreset)을 그대로 편집한다. 여기 있는 값이 곧 UTM 빌더의 선택지라,
 *     시트에서 따로 관리하던 "허용 값" 이 빌더와 어긋날 일이 없다.
 *  2) 이벤트: GA4/GTM 이벤트 이름·발생 시점·파라미터. 이름은 GA4 규칙대로만 저장된다.
 *  3) machstudio 가 자동으로 보내는 이벤트: 등록 폼이 dataLayer 로 보내는 것 — 읽기 전용.
 *
 * 고치는 화면이다(AGENTS §2): 값은 표에서 바로 고치고 칸을 벗어나면 저장된다.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
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

interface Preset { id: string; field: string; value: string; label: string | null }
interface EventRow {
  id: string; name: string; category: string; description: string; trigger: string;
  parameters: TaxonomyParameter[]; platforms: string[]; status: "active" | "deprecated";
}

const UTM_FIELDS = [
  { field: "source", title: "utm_source", note: "어디서 왔나 — 매체·사이트 (예: meta, naver, stibee)" },
  { field: "medium", title: "utm_medium", note: "어떤 방식으로 — 광고·메일·QR (예: cpc, email, qr)" },
  { field: "campaign", title: "utm_campaign", note: "무엇을 위해 — 목적 (예: registration, visitor)" },
] as const;

export default function TaxonomyTab() {
  const { workspace } = useWorkspace();
  const confirm = useConfirm();
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newEventName, setNewEventName] = useState("");

  const load = useCallback(async () => {
    if (!workspace) return;
    const [p, e] = await Promise.all([
      fetch(`/api/utm-presets?workspaceId=${workspace.id}`).then((r) => r.json()).catch(() => ({ presets: [] })),
      fetch(`/api/event-taxonomy?workspaceId=${workspace.id}`).then((r) => r.json()).catch(() => ({ events: [] })),
    ]);
    setPresets(p.presets ?? []);
    setEvents(e.events ?? []);
  }, [workspace]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  // ── UTM 값 ────────────────────────────────────────────────
  const addPreset = async (field: string, value: string, label: string) => {
    if (!workspace || !value.trim()) return false;
    const res = await fetch("/api/utm-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, field, value, label }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "추가하지 못했어요"); return false; }
    setPresets((prev) => {
      const list = (prev ?? []).filter((x) => x.id !== data.preset.id);
      return [...list, data.preset];
    });
    return true;
  };
  const patchPreset = async (preset: Preset, patch: { value?: string; label?: string }) => {
    const res = await fetch("/api/utm-presets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: preset.id, value: patch.value ?? preset.value, label: patch.label ?? preset.label ?? "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "저장하지 못했어요"); return; }
    setPresets((prev) => (prev ?? []).map((x) => (x.id === preset.id ? data.preset : x)));
  };
  const removePreset = async (preset: Preset) => {
    const ok = await confirm({ title: `'${preset.value}' 값을 지울까요?`, description: "UTM 빌더의 선택지에서도 사라져요. 이미 만든 링크는 그대로예요.", confirmLabel: "지우기", tone: "danger" });
    if (!ok) return;
    const res = await fetch("/api/utm-presets", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: preset.id }) });
    if (!res.ok) { toast.error("지우지 못했어요"); return; }
    setPresets((prev) => (prev ?? []).filter((x) => x.id !== preset.id));
  };

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

  if (!presets || !events) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* ── UTM 값 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">UTM 값</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">여기 적은 값이 <b>UTM 빌더의 선택지</b>예요. 값은 소문자로 저장돼요.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {UTM_FIELDS.map(({ field, title, note }) => (
            <UtmColumn
              key={field}
              title={title}
              note={note}
              presets={presets.filter((p) => p.field === field)}
              onAdd={(value, label) => addPreset(field, value, label)}
              onPatch={patchPreset}
              onRemove={removePreset}
            />
          ))}
        </div>
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

function UtmColumn({
  title, note, presets, onAdd, onPatch, onRemove,
}: {
  title: string;
  note: string;
  presets: Preset[];
  onAdd: (value: string, label: string) => Promise<boolean>;
  onPatch: (preset: Preset, patch: { value?: string; label?: string }) => void;
  onRemove: (preset: Preset) => void;
}) {
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const submit = async () => {
    if (await onAdd(value, label)) { setValue(""); setLabel(""); }
  };
  return (
    <div className={`min-w-0 bg-background p-4 ${R.panel} ${FINISH.s1}`}>
      <div className="font-mono text-xs font-semibold">{title}</div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
      <div className="mt-3 space-y-1">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] gap-1.5 text-[10px] font-medium text-muted-foreground">
          <span>값</span><span>표시 이름</span><span />
        </div>
        {presets.map((p) => (
          <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-1.5">
            <input
              defaultValue={p.value}
              onBlur={(e) => { const v = e.target.value.trim().toLowerCase(); if (v && v !== p.value) onPatch(p, { value: v }); }}
              className={`${FIELD_CLS} h-7 font-mono text-xs`}
            />
            <input
              defaultValue={p.label ?? ""}
              onBlur={(e) => { if (e.target.value.trim() !== (p.label ?? "")) onPatch(p, { label: e.target.value.trim() }); }}
              className={`${FIELD_CLS} h-7 text-xs`}
            />
            <button onClick={() => onRemove(p)} className="rounded p-1 text-muted-foreground hover:text-red-500" aria-label={`${p.value} 지우기`}>
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-1.5 pt-1">
          <input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit(); }}
            placeholder="새 값" className={`${FIELD_CLS} h-7 font-mono text-xs`} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit(); }}
            placeholder="표시 이름" className={`${FIELD_CLS} h-7 text-xs`} />
          <button onClick={() => void submit()} className="rounded p-1 text-violet-500 hover:bg-violet-500/10" aria-label="추가">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
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
