"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, ImagePlus, Loader2, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { InlineError } from "@/components/ui/inline-error";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { FINISH, R } from "@/components/ui/primitives";
import { formatKst } from "@/lib/datetime";
import { normalizeMedia, youtubeThumbnailUrl } from "@/lib/competition-config";
import EntryDetailModal from "./EntryDetailModal";
import type { CompetitionDetail } from "./page";

interface Entry {
  id: string;
  entryNo: string;
  title: string;
  teamName: string | null;
  summary: string | null;
  media: unknown;
  data: unknown;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  isPublished: boolean;
  sortOrder: number;
  advanced: boolean;
  agreePrivacy: boolean;
  agreeMarketing: boolean;
  agreeThirdParty: boolean;
  submittedAt: string;
}

const STATUS_META: Record<string, { label: string; tone: string }> = {
  submitted: { label: "접수", tone: "bg-secondary text-muted-foreground" },
  approved: { label: "승인", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  rejected: { label: "반려", tone: "bg-red-500/10 text-red-500" },
};

export default function EntriesTab({
  competition,
  onCountChange,
}: {
  competition: CompetitionDetail;
  onCountChange: (count: number) => void;
}) {
  const confirm = useConfirm();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/entries`);
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setEntries(data.entries ?? []);
      onCountChange((data.entries ?? []).length);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [competition.id, onCountChange]);

  useEffect(() => { void Promise.resolve().then(fetchEntries); }, [fetchEntries]);

  const patchEntry = async (entry: Entry, body: Record<string, unknown>) => {
    // 낙관적 반영 — 토글은 즉각 반응해야 한다. 실패하면 되돌린다.
    const before = entry;
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...body } as Entry : e)));
    const res = await fetch(`/api/competitions/${competition.id}/entries/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? before : e)));
      toast.error("변경에 실패했어요");
    }
  };

  const removeEntry = async (entry: Entry) => {
    const ok = await confirm({
      title: `${entry.entryNo}번 '${entry.title}'을(를) 삭제할까요?`,
      description: "투표·심사 기록이 함께 삭제되고 되돌릴 수 없어요.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/competitions/${competition.id}/entries/${entry.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== entry.id);
      onCountChange(next.length);
      return next;
    });
    toast.success("참가작을 삭제했어요");
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (loadError) return <InlineError message="참가작을 불러오지 못했어요" onRetry={fetchEntries} />;

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
        <Users className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">아직 신청이 없어요</p>
        <p className="mt-1 text-xs text-muted-foreground/70">공고 페이지를 배포하면 여기에 쌓입니다</p>
      </div>
    );
  }

  const publishedCount = entries.filter((e) => e.isPublished).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          전체 {entries.length}건 · 투표 노출 {publishedCount}건 — <b>노출</b>을 켠 참가작만 투표 화면에 나옵니다.
        </p>
        {/* 신청 폼 항목·팀원 명단·사진/영상 링크·동의·라운드별 투표 수까지 한 장으로. 연락처가 들어가 활동 기록에 남는다. */}
        <div className="flex shrink-0 gap-1.5">
          <a
            href={`/api/competitions/${competition.id}/entries/export?format=xlsx`}
            download
            className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary/70 ${R.control}`}
          >
            <Download className="h-3 w-3" />
            엑셀 다운로드
          </a>
          <a
            href={`/api/competitions/${competition.id}/entries/export?format=csv`}
            download
            className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
          >
            CSV
          </a>
        </div>
      </div>

      <div className="space-y-2">
        {entries.map((entry) => {
          const media = normalizeMedia(entry.media);
          const thumb = media.find((m) => m.kind === "image");
          const video = media.find((m) => m.kind === "youtube");
          const logo = media.find((m) => m.kind === "image" && m.role === "logo");
          const status = STATUS_META[entry.status] ?? STATUS_META.submitted;
          return (
            <div key={entry.id} className={`flex flex-wrap items-center gap-3 bg-background p-3 ${R.surface} ${FINISH.s2}`}>
              <span className="w-8 shrink-0 text-center font-mono text-sm font-semibold text-muted-foreground">
                {entry.entryNo}
              </span>

              <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-secondary">
                {thumb?.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb.url} alt="" className="h-full w-full object-cover" />
                ) : video?.kind === "youtube" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={youtubeThumbnailUrl(video.videoId)} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>

              <EntryLogoControl
                competitionId={competition.id}
                entry={entry}
                logoUrl={logo?.kind === "image" ? logo.url : null}
                onUpdated={(next) => setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...next } : e)))}
              />

              <button
                onClick={() => setDetailEntryId(entry.id)}
                className="min-w-0 flex-1 rounded-lg py-0.5 text-left transition-colors hover:bg-secondary/50"
                title="눌러서 신청 내용 전체 보기"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{entry.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.tone}`}>{status.label}</span>
                  {entry.advanced && (
                    <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                      본선
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {[entry.teamName, entry.contactName, entry.contactEmail].filter(Boolean).join(" · ")}
                </p>
                <p className="text-[10px] text-muted-foreground/70">{formatKst(entry.submittedAt)}</p>
              </button>

              {video?.kind === "youtube" && (
                <a
                  href={`https://www.youtube.com/watch?v=${video.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="영상 보기"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}

              <select
                value={entry.status}
                onChange={(e) => patchEntry(entry, { status: e.target.value })}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-violet-400"
              >
                <option value="submitted">접수</option>
                <option value="approved">승인</option>
                <option value="rejected">반려</option>
              </select>

              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                노출
                <Switch
                  checked={entry.isPublished}
                  onChange={(v) => patchEntry(entry, { isPublished: v })}
                  label="투표 노출"
                  disabled={entry.status === "rejected"}
                />
              </label>

              <button
                onClick={() => removeEntry(entry)}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                aria-label="삭제"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {detailEntryId && (() => {
        const detailEntry = entries.find((e) => e.id === detailEntryId);
        return detailEntry ? (
          <EntryDetailModal competition={competition} entry={detailEntry} onClose={() => setDetailEntryId(null)} />
        ) : null;
      })()}
    </div>
  );
}

/**
 * 참가작 로고 — 관리자가 직접 넣거나 뗀다.
 *
 * 신청 폼에 "팀 로고로 써요" 항목을 켜도 **그 이후 들어오는 신청부터만** 적용된다(제출
 * 당시엔 어느 사진이 로고 필드에서 왔는지 기록이 없다). 이미 접수된 참가작은 소급 적용이
 * 안 되므로, 여기서 직접 올려야 투표 카드에 로고가 붙는다.
 */
function EntryLogoControl({
  competitionId,
  entry,
  logoUrl,
  onUpdated,
}: {
  competitionId: string;
  entry: Entry;
  logoUrl: string | null;
  onUpdated: (next: Partial<Entry>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/competitions/${competitionId}/entries/${entry.id}/logo`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "로고 업로드에 실패했어요"); return; }
      onUpdated(data.entry);
      toast.success("로고를 넣었어요");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/competitions/${competitionId}/entries/${entry.id}/logo`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "삭제에 실패했어요"); return; }
      onUpdated(data.entry);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group relative h-12 w-12 shrink-0" title="투표 카드 제목 옆에 작은 배지로 나가는 팀 로고예요">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-secondary transition-opacity hover:opacity-80 disabled:opacity-50 ${R.control}`}
        aria-label={logoUrl ? "로고 바꾸기" : "로고 올리기"}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
      </button>
      {logoUrl && !busy && (
        <button
          onClick={remove}
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-red-500 group-hover:opacity-100"
          aria-label="로고 빼기"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}
