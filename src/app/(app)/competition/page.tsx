"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trophy, Loader2, ChevronRight, Users, Trash2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useWorkspace } from "@/contexts/workspace";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/inline-error";
import { resolveCompetitionStatus, COMPETITION_PHASE_META } from "@/lib/competition-status";

interface Competition {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phaseOverride: string | null;
  recruitOpenAt: string | null;
  recruitCloseAt: string | null;
  createdAt: string;
  _count: { entries: number };
  rounds?: Array<{ kind: string; voteEnabled: boolean; voteOpenAt: string | null; voteCloseAt: string | null }>;
}

/** 한글 이름을 슬러그로 바꾸면 "-"·"--" 로 뭉개진다 — 그때는 비워 두고 사용자가 직접 쓰게 한다. */
function toSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return /^[a-z0-9-]{2,}$/.test(slug) && !/^-+$/.test(slug) ? slug : "";
}

export default function CompetitionPage() {
  const { workspace, currentProject, isLoading: wsLoading } = useWorkspace();
  const confirm = useConfirm();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", description: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const fetchCompetitions = useCallback(async () => {
    if (!workspace || !currentProject) return;
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/competitions?workspaceId=${workspace.id}&projectId=${currentProject.id}`);
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setCompetitions(data.competitions ?? []);
    } catch {
      // 로드 실패를 '대회 없음'으로 위장하지 않는다
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [workspace, currentProject]);

  useEffect(() => { void Promise.resolve().then(fetchCompetitions); }, [fetchCompetitions]);

  const handleCreate = async () => {
    if (!workspace || !currentProject) return;
    const name = form.name.trim();
    const slug = form.slug.trim();
    if (!name) { toast.error("대회 이름을 입력해주세요"); return; }
    if (!/^[a-z0-9-]{2,}$/.test(slug) || /^-+$/.test(slug)) {
      toast.error("주소는 소문자·숫자·하이픈만, 2자 이상이어야 해요");
      return;
    }
    setIsCreating(true);
    try {
      const res = await fetch("/api/competitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          projectId: currentProject.id,
          name,
          slug,
          description: form.description.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "생성 실패"); return; }
      toast.success(`'${data.competition.name}' 대회가 만들어졌어요`);
      setForm({ name: "", slug: "", description: "" });
      setSlugTouched(false);
      setShowCreate(false);
      fetchCompetitions();
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (competition: Competition) => {
    const ok = await confirm({
      title: `'${competition.name}' 대회를 삭제할까요?`,
      description: "참가작·투표·심사 기록이 모두 함께 삭제되고 되돌릴 수 없어요.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/competitions/${competition.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    toast.success("대회가 삭제됐어요");
    setCompetitions((prev) => prev.filter((c) => c.id !== competition.id));
  };

  if (wsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <Trophy className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">프로젝트를 먼저 선택해주세요</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">대회</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {currentProject.name} · 모집 공고부터 투표·심사·발표까지
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-600"
        >
          <Plus className="h-4 w-4" />
          대회 만들기
        </motion.button>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            className="overflow-hidden rounded-2xl border border-border bg-background p-5"
          >
            <h2 className="mb-4 text-sm font-semibold">새 대회</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">대회 이름</span>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => ({ ...f, name, slug: slugTouched ? f.slug : toSlug(name) }));
                  }}
                  placeholder="예: 2026 스타트업 피칭 대회"
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-violet-400"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">주소(슬러그)</span>
                <input
                  value={form.slug}
                  onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: e.target.value })); }}
                  placeholder="pitch-2026"
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 font-mono text-sm outline-none transition-colors focus:border-violet-400"
                />
                <span className="block text-[11px] text-muted-foreground">소문자·숫자·하이픈만, 2자 이상</span>
              </label>
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">설명 (선택)</span>
                <input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-violet-400"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setShowCreate(false); setForm({ name: "", slug: "", description: "" }); setSlugTouched(false); }}
                className="rounded-xl px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary"
              >
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="rounded-xl bg-violet-500 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
              >
                {isCreating ? "만드는 중..." : "만들기"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <InlineError message="대회 목록을 불러오지 못했어요" onRetry={fetchCompetitions} />
      ) : competitions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
          <Trophy className="mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">아직 대회가 없어요</p>
          <p className="mt-1 text-xs text-muted-foreground/70">대회를 만들고 모집 공고부터 구성해보세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {competitions.map((competition) => {
            const status = resolveCompetitionStatus(competition);
            const meta = COMPETITION_PHASE_META[status.phase];
            return (
              <div
                key={competition.id}
                className="group flex items-center gap-4 rounded-2xl border border-border bg-background p-4 transition-colors hover:border-violet-400/40"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-500">
                  <Trophy className="h-4 w-4" />
                </div>
                <Link href={`/competition/${competition.slug}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{competition.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}>{meta.label}</span>
                    {status.isOverridden && (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">수동</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      참가작 {competition._count.entries.toLocaleString()}
                    </span>
                    <span className="font-mono">/{competition.slug}</span>
                  </div>
                </Link>
                <button
                  onClick={() => handleDelete(competition)}
                  className="rounded-lg p-2 text-muted-foreground opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                  aria-label="삭제"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
