"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/inline-error";

interface DetailPageRow {
  id: string;
  name: string;
  enabled: boolean;
  updatedAt: string;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function DetailPageListPage() {
  const { workspace, currentProject, isLoading: wsLoading } = useWorkspace();
  const confirm = useConfirm();
  const [pages, setPages] = useState<DetailPageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const fetchPages = useCallback(async () => {
    if (!workspace || !currentProject) return;
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/detail-pages?workspaceId=${workspace.id}&projectId=${currentProject.id}`);
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setPages(data.pages ?? []);
    } catch {
      // 로드 실패를 '페이지 없음'으로 위장하지 않는다
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [workspace, currentProject]);

  useEffect(() => { void Promise.resolve().then(fetchPages); }, [fetchPages]);

  const handleCreate = async () => {
    if (!workspace || !currentProject) return;
    const trimmed = name.trim();
    if (!trimmed) { toast.error("페이지 이름을 입력해주세요"); return; }
    setIsCreating(true);
    try {
      const res = await fetch("/api/detail-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id, projectId: currentProject.id, name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "만들지 못했어요"); return; }
      toast.success(`'${data.page.name}' 페이지를 만들었어요`);
      setName("");
      setShowCreate(false);
      fetchPages();
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (page: DetailPageRow) => {
    const ok = await confirm({
      title: `'${page.name}' 페이지를 삭제할까요?`,
      description: "아임웹에 붙여 둔 곳에서도 바로 사라져요.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/detail-pages/${page.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제하지 못했어요"); return; }
    toast.success("페이지를 삭제했어요");
    setPages((prev) => prev.filter((p) => p.id !== page.id));
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
        <FileText className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">프로젝트를 먼저 선택해주세요</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">상세페이지</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {currentProject.name} · 아임웹 코드블럭에 한 줄로 붙이는 상세페이지
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-600"
        >
          <Plus className="h-4 w-4" />
          페이지 만들기
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
            <h2 className="mb-4 text-sm font-semibold">새 상세페이지</h2>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">페이지 이름</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleCreate(); }}
                placeholder="예: 2026 바이어 상담회 안내"
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-violet-400"
              />
              <span className="block text-[11px] text-muted-foreground">관리용 이름이에요. 히어로 제목 첫 줄로도 들어가요(나중에 바꿀 수 있어요).</span>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setShowCreate(false); setName(""); }}
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
        <InlineError message="상세페이지 목록을 불러오지 못했어요" onRetry={fetchPages} />
      ) : pages.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
          <FileText className="mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">아직 상세페이지가 없어요</p>
          <p className="mt-1 text-xs text-muted-foreground/70">대회 공고 페이지와 같은 방식으로 섹션을 켜고 채우면 돼요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map((page) => (
            <div
              key={page.id}
              className="group flex items-center gap-4 rounded-2xl border border-border bg-background p-4 transition-colors hover:border-violet-400/40"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-500">
                <FileText className="h-4 w-4" />
              </div>
              <Link href={`/detail-page/${page.id}`} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{page.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      page.enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {page.enabled ? "공개" : "비공개"}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">마지막 수정 {formatDate(page.updatedAt)}</div>
              </Link>
              {/* 터치 기기에는 hover 가 없다 — 좁은 화면에서는 늘 보이게. */}
              <button
                onClick={() => handleDelete(page)}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                aria-label="삭제"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
