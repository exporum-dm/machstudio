"use client";

/**
 * UTM 빌더 → 선택지 관리 — source·medium·campaign 프리셋(UTMPreset)을 표에서 바로 고친다.
 *
 * 예전엔 이벤트 택소노미 탭에 있었는데, 이 값은 UTM 빌더의 선택지라 빌더 안에서 고치는 게 자연스럽다.
 * 값이 바뀔 때마다 onChanged 로 알려 빌더의 선택지도 바로 맞춘다.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";

interface Preset { id: string; field: string; value: string; label: string | null }

const UTM_FIELDS = [
  { field: "source", title: "utm_source", note: "어디서 왔나 — 매체·사이트 (예: meta, naver, stibee)" },
  { field: "medium", title: "utm_medium", note: "어떤 방식으로 — 광고·메일·QR (예: cpc, email, qr)" },
  { field: "campaign", title: "utm_campaign", note: "무엇을 위해 — 목적 (예: registration, visitor)" },
] as const;

export default function UtmPresetsPanel({ onChanged }: { onChanged?: () => void }) {
  const { workspace } = useWorkspace();
  const confirm = useConfirm();
  const [presets, setPresets] = useState<Preset[] | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    const p = await fetch(`/api/utm-presets?workspaceId=${workspace.id}`).then((r) => r.json()).catch(() => ({ presets: [] }));
    setPresets(p.presets ?? []);
  }, [workspace]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

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
    onChanged?.();
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
    onChanged?.();
  };
  const removePreset = async (preset: Preset) => {
    const ok = await confirm({ title: `'${preset.value}' 값을 지울까요?`, description: "UTM 빌더의 선택지에서도 사라져요. 이미 만든 링크는 그대로예요.", confirmLabel: "지우기", tone: "danger" });
    if (!ok) return;
    const res = await fetch("/api/utm-presets", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: preset.id }) });
    if (!res.ok) { toast.error("지우지 못했어요"); return; }
    setPresets((prev) => (prev ?? []).filter((x) => x.id !== preset.id));
    onChanged?.();
  };

  if (!presets) {
    return <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">
        여기 적은 값이 <b>UTM 생성 화면의 선택지</b>가 돼요. 팀이 같은 값을 골라 쓰면 GA4에서 채널이 갈라지지 않아요. 값은 소문자로 저장돼요.
      </p>
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
