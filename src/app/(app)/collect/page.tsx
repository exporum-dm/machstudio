"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SourceInfoEditor } from "./_components/SourceInfoEditor";
import { Plus, Database, Globe, Loader2, ChevronRight, Users, Trash2, Upload, UserPlus, Edit3, Copy, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import ModalShell from "@/app/(app)/collect/[id]/ModalShell";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";
import Link from "next/link";
import ProjectMembersModal from "@/components/settings/ProjectMembersModal";
import ActiveToggle from "@/app/(app)/collect/_components/ActiveToggle";
import { PageHeader } from "@/components/ui/page-layout";
import { InlineError } from "@/components/ui/inline-error";
import { FINISH, R, SELECTED, Field, FieldSelect } from "@/components/ui/primitives";

interface CollectSource {
  id: string;
  /** 방식 — 카드에서 구분되지 않으면 빌더형이 "설정이 덜 된 연동형" 처럼 보인다. */
  mode: string;
  name: string;
  description: string | null;
  siteUrl: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { records: number };
}

export default function CollectPage() {
  const { workspace, currentProject, isLoading: wsLoading } = useWorkspace();
  const [sources, setSources] = useState<CollectSource[]>([]);
  const requestSequence = useRef(0);
  const [loadedScope, setLoadedScope] = useState("");
  const scope = workspace && currentProject ? `${workspace.id}:${currentProject.id}` : "";
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const shownSources = sources.filter(source => (!query.trim() || `${source.name} ${source.description ?? ""} ${source.siteUrl ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (statusFilter === "all" || (statusFilter === "active" ? source.isActive : !source.isActive)));
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", siteUrl: "", mode: "builder" as "capture" | "builder" });
  const [isCreating, setIsCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // 복제 — 폼 항목·문구·설정을 그대로 가져가 새 폼을 연다(등록 데이터·링크는 새로).
  const router = useRouter();
  const [duplicateTarget, setDuplicateTarget] = useState<CollectSource | null>(null);
  const [duplicateNameInput, setDuplicateNameInput] = useState("");
  const [duplicating, setDuplicating] = useState(false);

  const fetchSources = useCallback(async () => {
    if (!workspace || !currentProject) return;
    const sequence = ++requestSequence.current;
    const requestedScope = `${workspace.id}:${currentProject.id}`;
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/collect-sources?workspaceId=${workspace.id}&projectId=${currentProject.id}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (sequence !== requestSequence.current) return;
      setSources(data.sources ?? []);
      setLoadedScope(requestedScope);
    } catch {
      if (sequence === requestSequence.current) { setLoadError(true); setLoadedScope(requestedScope); }
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  }, [workspace, currentProject]);

  useEffect(() => {
    const sequence = requestSequence;
    let disposed = false;
    void Promise.resolve().then(() => { if (!disposed) void fetchSources(); });
    return () => { disposed = true; sequence.current++; };
  }, [fetchSources]);

  const handleCreate = async () => {
    if (!form.name.trim() || !workspace || !currentProject) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/collect-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          projectId: currentProject.id,
          name: form.name.trim(),
          description: form.description.trim() || null,
          // 빌더형은 사이트 URL 칸 자체를 안 보여준다 — 남아 있던 값이 딸려 가지 않게 여기서도 끊는다.
          siteUrl: form.mode === "capture" ? form.siteUrl.trim() || null : null,
          mode: form.mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "생성 실패"); return; }
      toast.success(`'${data.source.name}' 수집 폼이 생성됐어요`);
      setForm({ name: "", description: "", siteUrl: "", mode: "builder" as "capture" | "builder" });
      setShowCreate(false);
      fetchSources();
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleSilent = async (sourceId: string, next: boolean) => {
    try {
    const res = await fetch(`/api/collect-sources/${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: next }),
    });
    if (!res.ok) { toast.error("상태를 바꾸지 못했어요. 다시 시도해 주세요."); return false; }
    setSources((prev) => prev.map((s) => s.id === sourceId ? { ...s, isActive: next } : s));
    return true;
    } catch { toast.error("연결을 확인하고 다시 시도해 주세요."); return false; }
  };

  const handleToggle = async (source: CollectSource, next: boolean) => {
    const prev = source.isActive;
    try {
      if (!await handleToggleSilent(source.id, next)) return;
    if (prev && !next) {
      toast("등록 폼이 비활성화됐어요", {
        description: "새 데이터 수집이 중단됩니다",
        duration: 5000,
        action: { label: "되돌리기", onClick: () => handleToggleSilent(source.id, true) },
      });
    } else if (!prev && next) {
      toast.success("등록 폼이 활성화됐어요");
    }
    } catch { toast.error("연결을 확인하고 다시 시도해 주세요."); }
  };


  const openDuplicate = (source: CollectSource) => {
    setDuplicateTarget(source);
    setDuplicateNameInput(`${source.name} (복사본)`);
  };

  const handleDuplicate = async () => {
    if (!duplicateTarget) return;
    const name = duplicateNameInput.trim();
    if (!name) { toast.error("새 폼 이름을 입력해주세요"); return; }
    setDuplicating(true);
    try {
      const res = await fetch(`/api/collect-sources/${duplicateTarget.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "복제하지 못했어요"); return; }
      toast.success(`'${data.source.name}' 폼을 만들었어요 — 내용을 바꿔 주세요`);
      setDuplicateTarget(null);
      // 바로 고칠 수 있는 곳으로 — 빌더형은 등록 폼 탭, 연동형은 기본 정보.
      router.push(`/collect/${data.source.id}?tab=${data.source.mode === "builder" ? "form" : "info"}`);
    } finally {
      setDuplicating(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/collect-sources/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    toast.success("등록 폼이 삭제됐어요");
    setDeleteId(null);
    setSources((prev) => prev.filter((s) => s.id !== id));
  };

  if (wsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Database className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">프로젝트를 먼저 선택해주세요</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <PageHeader title="등록" context={currentProject.name} description="신청·접수·문의 폼을 만들거나 기존 사이트의 폼을 연결해 응답을 관리합니다." />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowMembers(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            aria-label="프로젝트 권한"
          >
            <UserPlus className="w-3.5 h-3.5" />프로젝트 권한
          </button>
          <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer">
            <Upload className="w-3.5 h-3.5" />백업 복구
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f || !workspace || !currentProject) return;
                setRestoring(true);
                try {
                  const text = await f.text();
                  const backup = JSON.parse(text);
                  const res = await fetch("/api/collect-sources/import-backup", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ workspaceId: workspace.id, projectId: currentProject.id, backup }),
                  });
                  const data = await res.json();
                  if (!res.ok) { toast.error(data.error ?? "복구 실패"); return; }
                  toast.success(`복구됨: ${data.imported.toLocaleString()}건 (소스 비활성 상태로 생성됨 — 확인 후 활성화)`);
                  fetchSources();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "파일 처리 실패");
                } finally {
                  setRestoring(false);
                  if (e.target) e.target.value = "";
                }
              }}
            />
          </label>
          {restoring && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            폼 만들기
          </motion.button>
        </div>
      </div>

      {showMembers && workspace && currentProject && (
        <ProjectMembersModal
          projectId={currentProject.id}
          projectName={currentProject.name}
          workspaceId={workspace.id}
          onClose={() => setShowMembers(false)}
        />
      )}

      {/* 생성 폼 */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="p-5 rounded-2xl border border-violet-400/30 bg-violet-500/5"
          >
            <h3 className="text-sm font-semibold mb-4">새 등록 폼</h3>
            <div className="space-y-3">
              {/*
                방식 선택이 맨 위인 이유: 뒤 입력칸이 방식에 따라 달라진다(연동형만 사이트 URL 을 쓴다).
                순서를 뒤집으면 다 채운 뒤 방식을 바꿔 입력이 무의미해진다.
                새 폼은 직접 만들기로 시작하며 기존 연동형 폼의 방식은 바꾸지 않는다.
              */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">어떻게 등록받을까요? *</label>
                <div role="radiogroup" aria-label="등록 방식" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    { value: "builder", title: "직접 만들기", desc: "신청·접수·문의에 필요한 항목을 직접 구성해요" },
                    { value: "capture", title: "기존 폼 연결", desc: "이미 있는 사이트 폼에 스크립트를 붙여 응답을 모아요" },
                  ] as const).map((opt) => {
                    const active = form.mode === opt.value;
                    return (
                      <motion.button
                        key={opt.value}
                        type="button"
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setForm((f) => ({ ...f, mode: opt.value }))}
                        role="radio"
                        aria-checked={active}
                        className={`text-left p-3 ${R.surface} transition-shadow ${
                          active ? SELECTED : `bg-background ${FINISH.s2} hover:shadow-md`
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <span
                            aria-hidden
                            className={`w-3.5 h-3.5 rounded-full shrink-0 ${active ? `bg-violet-500 ${FINISH.s2}` : `bg-transparent ${FINISH.s2}`}`}
                          />
                          {opt.title}
                        </span>
                        <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{opt.desc}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">이름 *</label>
                <input
                  autoFocus
                  type="text"
                  placeholder="예: 행사 등록, 상담 신청, 자료 요청"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(false); }}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">설명</label>
                <input
                  type="text"
                  placeholder="폼의 목적과 운영 메모"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400"
                />
              </div>
              {/* 사이트 URL 은 연동형에서만 의미가 있다 — 스크립트를 붙일 대상 주소다.
                  빌더형은 폼을 여기서 그리므로 이 칸이 하는 일이 없다. */}
              {form.mode === "capture" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">사이트 URL</label>
                  <input
                    type="url"
                    placeholder="https://example.com"
                    value={form.siteUrl}
                    onChange={(e) => setForm((f) => ({ ...f, siteUrl: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400"
                  />
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleCreate}
                  disabled={!form.name.trim() || isCreating}
                  className="px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-40"
                >
                  {isCreating ? "생성 중..." : "생성"}
                </motion.button>
                <button
                  onClick={() => { setShowCreate(false); setForm({ name: "", description: "", siteUrl: "", mode: "builder" as "capture" | "builder" }); }}
                  className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-secondary transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loadedScope === scope && sources.length > 0 && !loadError && <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-48 flex-1"><span className="sr-only">등록 폼 검색</span><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden /><Field value={query} onChange={e => setQuery(e.target.value)} placeholder="이름·설명·주소로 검색" className="pl-9" /></label>
        <FieldSelect aria-label="등록 폼 상태" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-auto"><option value="all">모든 상태</option><option value="active">활성</option><option value="inactive">비활성</option></FieldSelect>
        <span className="text-xs tabular-nums text-muted-foreground">{shownSources.length}개 / 전체 {sources.length}개</span>
      </div>}
      {/* 목록 */}
      {isLoading || loadedScope !== scope ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? <InlineError message="등록 폼 목록을 불러오지 못했어요" onRetry={fetchSources} /> : sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Database className="w-10 h-10 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground">아직 등록 폼이 없어요</p>
          <p className="text-xs text-muted-foreground/60 mt-1 mb-4">신청·접수·문의 등 목적에 맞는 폼을 직접 만들거나 기존 폼을 연결하세요.</p>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            폼 만들기
          </motion.button>
        </div>
      ) : shownSources.length === 0 ? <div className="py-12 text-center"><p className="text-sm text-muted-foreground">조건에 맞는 등록 폼이 없어요.</p><button type="button" onClick={() => { setQuery(""); setStatusFilter("all"); }} className="mt-3 rounded-lg px-3 py-2 text-sm hover:bg-secondary">검색·필터 초기화</button></div> : (
        <div className="space-y-2">
          {shownSources.map((source) => (
            <motion.div
              key={source.id}
              layout
              className={`group grid grid-cols-[36px_minmax(0,1fr)] gap-x-3 gap-y-3 rounded-2xl bg-card p-4 transition-shadow hover:shadow-md sm:flex sm:items-center sm:gap-4 ${FINISH.s1}`}
            >
              <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-500 shrink-0">
                <Database className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                {editingId === source.id ? (
                  <SourceInfoEditor
                    source={source}
                    onCancel={() => setEditingId(null)}
                    onSaved={(next) => { setSources((prev) => prev.map((s) => (s.id === next.id ? { ...s, ...next } : s))); setEditingId(null); }}
                  />
                ) : (
                  <>
                    {/* 이름 행: 편집 아이콘을 이름 텍스트 바로 옆에 — 이름·설명·사이트 주소를 한 번에 고친다 */}
                    <div className="flex items-center gap-1 min-w-0">
                      <Link href={`/collect/${source.id}`} className="min-w-0">
                        <span className="text-sm font-medium truncate block">{source.name}</span>
                      </Link>
                      <button
                        onClick={(e) => { e.preventDefault(); setEditingId(source.id); }}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-opacity shrink-0 sm:opacity-0 sm:group-hover:opacity-60 sm:focus:opacity-100"
                        title="이름·설명·사이트 주소 수정"
                        aria-label={`${source.name} 정보 수정`}
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    </div>
                    <Link href={`/collect/${source.id}`} className="block min-w-0">
                      {source.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5" title={source.description}>{source.description}</p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          <Users className="w-3 h-3" />{source._count.records.toLocaleString()}건
                        </span>
                        {/* 방식 배지 — 빌더형은 사이트 URL 이 없어서, 배지가 없으면 "설정이 덜 된
                            연동형" 처럼 보인다. 되돌릴 수 없는 성질이라 목록에서도 구분돼야 한다. */}
                        <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {source.mode === "builder" ? "빌더형" : "연동형"}
                        </span>
                        {source.siteUrl && (
                          <span className="flex min-w-0 max-w-full items-center gap-1 text-xs text-muted-foreground">
                            <Globe className="w-3 h-3 shrink-0" /><span className="truncate">{source.siteUrl}</span>
                          </span>
                        )}
                      </div>
                    </Link>
                  </>
                )}
              </div>
              <div className="col-start-2 flex shrink-0 items-center justify-end gap-1.5">
                {/* 토글 스위치 */}
                <ActiveToggle
                  active={source.isActive}
                  label={`${source.name} 접수`}
                  onChange={(next) => handleToggle(source, next)}
                  size="sm"
                  showLabel={false}
                />
                {/* 터치 기기엔 hover 가 없다 — 좁은 화면에서는 늘 보이게. */}
                <button
                  onClick={(e) => { e.preventDefault(); openDuplicate(source); }}
                  className="p-1.5 rounded-xl hover:bg-secondary hover:text-foreground transition-colors text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100"
                  title="복제"
                  aria-label={`${source.name} 복제`}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.preventDefault(); setDeleteId(source.id); }}
                  className="p-1.5 rounded-xl hover:bg-red-500/10 hover:text-red-500 transition-colors text-muted-foreground opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <Link href={`/collect/${source.id}`} aria-label={`${source.name} 열기`} className="rounded-lg p-2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* 복제 */}
      <ModalShell
        open={!!duplicateTarget}
        onClose={() => { if (!duplicating) setDuplicateTarget(null); }}
        title="등록 폼 복제"
        description={duplicateTarget ? `'${duplicateTarget.name}'의 폼 항목·문구·설정을 그대로 가져와 새 폼을 만들어요.` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDuplicateTarget(null)}
              disabled={duplicating}
              className="rounded-xl px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              취소
            </button>
            <button
              onClick={() => void handleDuplicate()}
              disabled={duplicating}
              className="flex items-center gap-1.5 rounded-xl bg-violet-500 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
            >
              {duplicating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              복제하기
            </button>
          </div>
        }
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">새 폼 이름</span>
          <input
            autoFocus
            value={duplicateNameInput}
            onChange={(e) => setDuplicateNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleDuplicate(); }}
            placeholder="예: 2026 Korea Expo LA Random Dance Play"
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-violet-400"
          />
        </label>
        <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
          <li>• <b className="text-foreground">가져가요</b> — 폼 항목, 안내·동의 문구, 확인 메일, 등록 기간, 디자인, 기본 정보</li>
          <li>• <b className="text-foreground">새로 시작해요</b> — 등록자 데이터(0건), 설치 코드·미리보기 링크, 현장 체크인 링크·PIN, 웹훅</li>
          <li>• 등록 기간·행사 정보는 원본 그대로라 <b className="text-foreground">새 행사에 맞게 꼭 바꿔 주세요</b></li>
        </ul>
      </ModalShell>

      {/* 삭제 확인 */}
      <AnimatePresence>
        {deleteId && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setDeleteId(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-background border border-border rounded-2xl p-6 w-80 max-w-[calc(100vw-2rem)] shadow-xl"
            >
              <h3 className="text-base font-semibold mb-2">수집 소스 삭제</h3>
              <p className="text-sm text-muted-foreground mb-5">수집된 모든 데이터도 함께 삭제돼요. 되돌릴 수 없어요.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDelete(deleteId)}
                  className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
                >
                  삭제
                </button>
                <button
                  onClick={() => setDeleteId(null)}
                  className="flex-1 py-2 rounded-xl border border-border text-sm hover:bg-secondary transition-colors"
                >
                  취소
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
