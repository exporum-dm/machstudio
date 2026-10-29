"use client";

/**
 * 자동 수집 — "어디서 후보를 긁어올지" 를 브리프마다 정한다.
 *
 * 고치는 영역이라 한 줄 = 소스 하나, 값은 전부 보이는 칸에서 바로 고친다(칸을 벗어나면 저장).
 * 매일 아침 9시(KST)에 크론이 돌고, "지금 수집" 으로 바로 돌릴 수도 있다.
 * 들어온 건 전부 채택 전 후보라 링크 고르기 탭에서 사람이 고른다.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Newspaper, Plus, Rss, Building2, Landmark, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Btn, Chip, Field, FINISH, R } from "@/components/ui/primitives";
import { BIZINFO_FIELDS, KITA_DIVISIONS, type SourceKind } from "@/lib/brief/sources";
import { api, type BriefRow } from "./types";

interface SourceRow {
  id: string;
  kind: SourceKind;
  name: string;
  config: { hashCode?: string; pages?: number; query?: string; days?: number; url?: string; division?: string; include?: string[]; exclude?: string[] };
  category: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastAdded: number;
  lastError: string;
}

const CATEGORY_OPTIONS = [
  { value: "auto", label: "제목 보고 자동 분류" },
  { value: "support", label: "💵 지원사업" },
  { value: "event", label: "📚 웨비나 & 리포트" },
  { value: "news", label: "🌍 산업 뉴스" },
];

const KIND_META: Record<SourceKind, { label: string; icon: typeof Rss }> = {
  bizinfo: { label: "기업마당", icon: Building2 },
  googlenews: { label: "Google 뉴스", icon: Newspaper },
  rss: { label: "RSS", icon: Rss },
  kita: { label: "무역협회", icon: Landmark },
};

const SELECT_CLS = `min-h-9 w-full bg-background px-2 text-sm ${R.control} ${FINISH.s2}`;

function when(iso: string | null): string {
  if (!iso) return "아직 안 돌았어요";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
}

/** 칸을 벗어날 때 바뀐 게 있으면 저장 */
function BlurField({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [v, setV] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setV(value);
  }
  return (
    <Field
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function SourcesTab({ brief, canWrite, onCollected }: { brief: BriefRow; canWrite: boolean; onCollected: () => Promise<void> }) {
  const confirm = useConfirm();
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [presets, setPresets] = useState<{ key: string; label: string; description: string }[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [bizinfoApi, setBizinfoApi] = useState(false);

  const load = useCallback(
    () => api<{ sources: SourceRow[]; presets: typeof presets; bizinfoApi: boolean }>(`/api/briefs/${brief.id}/sources`),
    [brief.id],
  );

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => {
        if (cancelled) return;
        setSources(r.sources);
        setPresets(r.presets);
        setBizinfoApi(r.bizinfoApi);
      })
      .catch((e) => toast.error((e as Error).message));
    return () => { cancelled = true; };
  }, [load]);

  const refresh = async () => setSources((await load()).sources);

  const patch = async (id: string, data: Record<string, unknown>) => {
    setSources((list) => list?.map((s) => (s.id === id ? ({ ...s, ...data, config: { ...s.config, ...(data.config as object) } } as SourceRow) : s)) ?? null);
    try {
      const r = await api<{ source: SourceRow }>(`/api/briefs/${brief.id}/sources/${id}`, { method: "PATCH", body: JSON.stringify(data) });
      setSources((list) => list?.map((s) => (s.id === id ? r.source : s)) ?? null);
    } catch (e) {
      toast.error((e as Error).message);
      await refresh();
    }
  };

  const add = async (kind: SourceKind) => {
    try {
      const body =
        kind === "bizinfo"
          ? { kind, name: "기업마당", config: { hashCode: "07", pages: 3 }, category: "auto" }
          : kind === "googlenews"
            ? { kind, name: "", config: { query: "", days: 3 }, category: "news" }
            : kind === "kita"
              ? { kind, name: "무역협회", config: { division: "01", pages: 1 }, category: "event" }
              : { kind, name: "", config: { url: "" }, category: "news" };
      await api(`/api/briefs/${brief.id}/sources`, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const applyPreset = async (key: string) => {
    try {
      const r = await api<{ added: number }>(`/api/briefs/${brief.id}/sources`, { method: "POST", body: JSON.stringify({ preset: key }) });
      toast.success(r.added ? `소스 ${r.added}개를 넣었어요` : "이미 다 들어 있어요");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (s: SourceRow) => {
    const ok = await confirm({
      title: `“${s.name || KIND_META[s.kind].label}” 소스를 지울까요?`,
      description: "이미 들어온 링크는 남아요. 앞으로 여기서 새로 모으지 않을 뿐이에요.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/briefs/${brief.id}/sources/${s.id}`, { method: "DELETE" });
      setSources((list) => list?.filter((x) => x.id !== s.id) ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const collect = async (sourceId?: string) => {
    setRunning(sourceId ?? "all");
    try {
      const r = await api<{ added: number; results: { error: string }[] }>(`/api/briefs/${brief.id}/collect`, {
        method: "POST",
        body: JSON.stringify(sourceId ? { sourceId } : {}),
      });
      const failed = r.results.filter((x) => x.error).length;
      toast.success(`새 후보 ${r.added}개${failed ? ` · 실패 ${failed}곳` : ""}`);
      await Promise.all([refresh(), onCollected()]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  if (!sources) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중</div>;

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          매일 아침 <b className="text-foreground">9시</b>에 아래 소스에서 새 소식을 모아 “링크 고르기”에 <b className="text-foreground">후보</b>로 넣어요. 무엇을 내보낼지는 거기서 고르면 돼요.
        </p>
        {canWrite && sources.length > 0 && (
          <Btn tone="key" onClick={() => collect()} disabled={running !== null}>
            {running === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} 지금 모두 수집
          </Btn>
        )}
      </div>

      {sources.length === 0 && (
        <section className={`${R.panel} ${FINISH.s1} space-y-3 bg-card p-5`}>
          <p className="text-sm font-semibold">아직 수집 소스가 없어요</p>
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={!canWrite}
              onClick={() => applyPreset(p.key)}
              className={`flex w-full items-start gap-3 ${R.surface} ${FINISH.s1} bg-background p-4 text-left transition hover:shadow-md disabled:opacity-50`}
            >
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{p.label} 세트 넣기</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{p.description}</span>
              </span>
            </button>
          ))}
        </section>
      )}

      <ul className="space-y-2.5">
        {sources.map((s) => {
          const meta = KIND_META[s.kind] ?? KIND_META.rss;
          const Icon = meta.icon;
          return (
            <li key={s.id} className={`${R.surface} ${FINISH.s1} bg-card p-3 transition-opacity ${s.enabled ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.enabled}
                  aria-label="사용"
                  disabled={!canWrite}
                  onClick={() => patch(s.id, { enabled: !s.enabled })}
                  className={`relative mt-1.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${s.enabled ? "bg-violet-600" : `bg-secondary ${FINISH.s2}`}`}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${s.enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                </button>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[170px_minmax(0,1fr)_170px]">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={meta.label} />
                      <BlurField value={s.name} onSave={(name) => patch(s.id, { name })} disabled={!canWrite} placeholder={meta.label} aria-label="이름" className="text-sm font-medium" />
                    </div>

                    {s.kind === "bizinfo" && (
                      <div className="grid grid-cols-2 gap-2">
                        <select value={s.config.hashCode ?? "07"} disabled={!canWrite} onChange={(e) => patch(s.id, { config: { hashCode: e.target.value } })} className={SELECT_CLS} aria-label="기업마당 분야">
                          {BIZINFO_FIELDS.map((f) => <option key={f.code} value={f.code}>분야 · {f.label}</option>)}
                        </select>
                        <select value={s.config.pages ?? 3} disabled={!canWrite} onChange={(e) => patch(s.id, { config: { pages: Number(e.target.value) } })} className={SELECT_CLS} aria-label="읽을 양">
                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>최근 {n * 15}건</option>)}
                        </select>
                      </div>
                    )}
                    {s.kind === "googlenews" && (
                      <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
                        <BlurField value={s.config.query ?? ""} onSave={(query) => patch(s.id, { config: { query } })} disabled={!canWrite} placeholder="검색어 (예: K-뷰티 수출)" aria-label="검색어" />
                        <select value={s.config.days ?? 7} disabled={!canWrite} onChange={(e) => patch(s.id, { config: { days: Number(e.target.value) } })} className={SELECT_CLS} aria-label="기간">
                          {[1, 3, 7, 14, 30].map((n) => <option key={n} value={n}>최근 {n}일</option>)}
                        </select>
                      </div>
                    )}
                    {s.kind === "kita" && (
                      <div className="grid grid-cols-2 gap-2">
                        <select value={s.config.division ?? "01"} disabled={!canWrite} onChange={(e) => patch(s.id, { config: { division: e.target.value } })} className={SELECT_CLS} aria-label="무역협회 공지 분류">
                          {KITA_DIVISIONS.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                        </select>
                        <select value={s.config.pages ?? 1} disabled={!canWrite} onChange={(e) => patch(s.id, { config: { pages: Number(e.target.value) } })} className={SELECT_CLS} aria-label="읽을 양">
                          {[1, 2, 3].map((n) => <option key={n} value={n}>최근 {n * 20}건</option>)}
                        </select>
                      </div>
                    )}
                    {s.kind === "rss" && (
                      <BlurField value={s.config.url ?? ""} onSave={(url) => patch(s.id, { config: { url } })} disabled={!canWrite} placeholder="https://…/rss.xml" aria-label="피드 주소" className="font-mono text-xs" />
                    )}

                    <select value={s.category} disabled={!canWrite} onChange={(e) => patch(s.id, { category: e.target.value })} className={SELECT_CLS} aria-label="분류">
                      {CATEGORY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <BlurField
                      value={(s.config.include ?? []).join(", ")}
                      onSave={(v) => patch(s.id, { config: { include: v.split(",").map((x) => x.trim()).filter(Boolean) } })}
                      disabled={!canWrite}
                      placeholder="이 말이 든 것만 (쉼표로 구분, 비우면 전부)"
                      aria-label="포함할 말"
                      className="text-xs"
                    />
                    <BlurField
                      value={(s.config.exclude ?? []).join(", ")}
                      onSave={(v) => patch(s.id, { config: { exclude: v.split(",").map((x) => x.trim()).filter(Boolean) } })}
                      disabled={!canWrite}
                      placeholder="이 말이 든 건 빼기 (쉼표로 구분)"
                      aria-label="뺄 말"
                      className="text-xs"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {s.kind === "bizinfo" && (
                      <Chip tone={bizinfoApi ? "ok" : "neutral"} className="py-0">
                        {bizinfoApi ? "공식 API" : "목록 읽기 · API 키 없음"}
                      </Chip>
                    )}
                    <span>마지막 수집 {when(s.lastRunAt)}</span>
                    {/* "…대체했어요" 는 실패가 아니라 알림(수집은 됐다) — 개수와 함께 주황으로 */}
                    {s.lastRunAt && (!s.lastError || s.lastError.includes("대체했어요")) && (
                      <Chip tone={s.lastAdded ? "ok" : "neutral"}>새 후보 {s.lastAdded}개</Chip>
                    )}
                    {s.lastError && (
                      <span className={`inline-flex items-center gap-1 ${s.lastError.includes("대체했어요") ? "text-amber-700 dark:text-amber-400" : "text-destructive"}`}>
                        <AlertCircle className="h-3.5 w-3.5" /> {s.lastError}
                      </span>
                    )}
                    {canWrite && (
                      <div className="ml-auto flex items-center gap-1">
                        <Btn tone="ghost" className="px-2 text-xs" onClick={() => collect(s.id)} disabled={running !== null || !s.enabled}>
                          {running === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 지금
                        </Btn>
                        <Btn tone="dangerQuiet" className="px-2" onClick={() => remove(s)} aria-label="소스 지우기"><Trash2 className="h-3.5 w-3.5" /></Btn>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Btn tone="quiet" onClick={() => add("googlenews")}><Plus className="h-4 w-4" /> 뉴스 검색어</Btn>
          <Btn tone="quiet" onClick={() => add("bizinfo")}><Plus className="h-4 w-4" /> 기업마당 분야</Btn>
          <Btn tone="quiet" onClick={() => add("kita")}><Plus className="h-4 w-4" /> 무역협회 공지</Btn>
          <Btn tone="quiet" onClick={() => add("rss")}><Plus className="h-4 w-4" /> RSS 피드</Btn>
          {sources.length > 0 && presets.map((p) => (
            <Btn key={p.key} tone="ghost" onClick={() => applyPreset(p.key)}><Sparkles className="h-4 w-4" /> {p.label} 세트에서 빠진 것 채우기</Btn>
          ))}
        </div>
      )}
    </div>
  );
}
