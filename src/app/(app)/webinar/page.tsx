"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Video, Loader2, ChevronRight, Calendar, Users, Trash2 } from "lucide-react";
import { PageHeader, ListSearch } from "@/components/ui/page-layout";
import { useQueryText } from "@/components/ui/use-query-tab";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";
import { kstDateTimeLocalToIso, formatKst, kstDateString } from "@/lib/datetime";
import { InlineError } from "@/components/ui/inline-error";
import { resolveWebinarStatus, WEBINAR_STATUS_META } from "@/lib/webinar-status";
import WebinarSchedulePicker from "@/components/webinar/WebinarSchedulePicker";
import Link from "next/link";

interface Webinar {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  liveStartAt: string;
  liveEndAt: string;
  signupDeadline: string;
  statusOverride?: string | null;
  components?: unknown;
  createdAt: string;
  _count: { registrations: number };
  project?: { id: string; name: string } | null;
}

export default function WebinarPage() {
  const { workspace, currentProject, isLoading: wsLoading } = useWorkspace();
  const [webinars, setWebinars] = useState<Webinar[]>([]);
  const [cloneSources, setCloneSources] = useState<Webinar[]>([]);
  const [query, setQuery] = useQueryText();
  const shown = webinars.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [cloneFromId, setCloneFromId] = useState("");
  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
    liveStartAt: "",
    liveEndAt: "",
    signupDeadline: "",
  });
  const [isCreating, setIsCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const fetchWebinars = useCallback(async () => {
    if (!workspace || !currentProject) return;
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/webinars?workspaceId=${workspace.id}&projectId=${currentProject.id}`);
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setWebinars(data.webinars ?? []);
    } catch {
      // 로드 실패를 '웨비나 없음'으로 위장하지 않음
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [workspace, currentProject]);

  // 복제 원본 후보 — 워크스페이스 내 모든 프로젝트의 웨비나 (projectId 미지정)
  const fetchCloneSources = useCallback(async () => {
    if (!workspace) return;
    try {
      const res = await fetch(`/api/webinars?workspaceId=${workspace.id}`);
      const data = await res.json();
      setCloneSources(data.webinars ?? []);
    } catch {
      /* 복제는 선택 기능이라 실패해도 생성은 가능 */
    }
  }, [workspace]);

  useEffect(() => { fetchWebinars(); }, [fetchWebinars]);
  useEffect(() => { if (showCreate) void fetchCloneSources(); }, [showCreate, fetchCloneSources]);

  const autoSlug = (name: string) => {
    const base = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    // 한글 등 비ASCII 이름은 위 규칙이 문자를 전부 걷어내 ""나 "-"만 남긴다
    // ('웨비나' → "", '정기 웨비나' → "-") — 그런 값은 슬러그로 못 쓰니 날짜+랜덤 폴백을 쓴다.
    if (base.length < 2) {
      const yymm = kstDateString().replace(/-/g, "").slice(2, 6);
      const rand = Math.random().toString(36).slice(2, 6);
      return `webinar-${yymm}-${rand}`;
    }
    return base.slice(0, 50);
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.liveStartAt || !form.liveEndAt || !form.signupDeadline || !workspace || !currentProject) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/webinars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          projectId: currentProject.id,
          name: form.name.trim(),
          slug: form.slug || autoSlug(form.name.trim()),
          description: form.description.trim() || null,
          liveStartAt: kstDateTimeLocalToIso(form.liveStartAt),
          liveEndAt: kstDateTimeLocalToIso(form.liveEndAt),
          signupDeadline: kstDateTimeLocalToIso(form.signupDeadline),
          ...(cloneFromId ? { cloneFromId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "생성 실패"); return; }
      toast.success(cloneFromId ? `'${data.webinar.name}' 웨비나가 복제 생성됐어요` : `'${data.webinar.name}' 웨비나가 생성됐어요`);
      setForm({ name: "", slug: "", description: "", liveStartAt: "", liveEndAt: "", signupDeadline: "" });
      setCloneFromId("");
      setShowCreate(false);
      fetchWebinars();
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/webinars/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    toast.success("웨비나가 삭제됐어요");
    setDeleteId(null);
    setWebinars((prev) => prev.filter((w) => w.id !== id));
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
        <Video className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">프로젝트를 먼저 선택해주세요</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <PageHeader title="웨비나" context={currentProject.name} description="등록부터 라이브 운영과 결과 분석까지 관리합니다." />
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          웨비나 추가
        </motion.button>
      </div>

      {/* 생성 폼 */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="p-5 rounded-2xl border border-violet-400/30 bg-violet-500/5"
          >
            <h3 className="text-sm font-semibold mb-4">새 웨비나</h3>
            <div className="space-y-3">
              {cloneSources.length > 0 && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">복제 원본 (선택)</label>
                  <select
                    value={cloneFromId}
                    onChange={(e) => setCloneFromId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400"
                  >
                    <option value="">빈 웨비나로 시작</option>
                    {cloneSources.map((w) => (
                      <option key={w.id} value={w.id}>
                        {(w.project?.name ? `${w.project.name} · ` : "") + w.name}
                      </option>
                    ))}
                  </select>
                  {cloneFromId && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      테마·등록폼·랜딩·라이브 화면 구성·세션·컴포넌트 설정을 복사해요. 일정·등록자·주소(슬러그)와
                      자료 목록·다음 웨비나 안내처럼 회차마다 달라지는 값은 새로 지정합니다.
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">웨비나 이름 *</label>
                  <input
                    autoFocus
                    type="text"
                    placeholder="예: 2025 서울 아트페어 웨비나"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: autoSlug(e.target.value) }))}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">슬러그 (URL 경로)</label>
                  <input
                    type="text"
                    placeholder="자동 생성"
                    value={form.slug}
                    onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400 font-mono"
                  />
                  {/* 공개 주소 실시간 프리뷰 — 슬러그를 고치는 그 자리에서 결과를 바로 확인 */}
                  <p className="mt-1 text-[11px] text-muted-foreground font-mono truncate">
                    {typeof window !== "undefined" ? window.location.host : "machstudio.vercel.app"}/webinar/
                    {form.slug || (form.name.trim() ? autoSlug(form.name.trim()) : "…")}
                  </p>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">설명</label>
                <input
                  type="text"
                  placeholder="웨비나에 대한 간단한 설명"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">일정 *</label>
                <WebinarSchedulePicker
                  value={{ liveStartAt: form.liveStartAt, liveEndAt: form.liveEndAt, signupDeadline: form.signupDeadline }}
                  onChange={(v) => setForm((f) => ({ ...f, liveStartAt: v.liveStartAt, liveEndAt: v.liveEndAt, signupDeadline: v.signupDeadline }))}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleCreate}
                  disabled={!form.name.trim() || !form.liveStartAt || !form.liveEndAt || !form.signupDeadline || isCreating}
                  className="px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-40"
                >
                  {isCreating ? "생성 중..." : "생성"}
                </motion.button>
                <button
                  onClick={() => { setShowCreate(false); setCloneFromId(""); setForm({ name: "", slug: "", description: "", liveStartAt: "", liveEndAt: "", signupDeadline: "" }); }}
                  className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-secondary transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {webinars.length > 0 && <ListSearch value={query} onChange={setQuery} label="웨비나 검색" count={shown.length} />}
      {/* 목록 */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <InlineError message="웨비나 목록을 불러오지 못했어요" onRetry={() => void fetchWebinars()} />
      ) : webinars.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Video className="w-10 h-10 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground">아직 웨비나가 없어요</p>
          <p className="text-xs text-muted-foreground/60 mt-1">웨비나를 추가해 사전등록, 라이브 페이지, 어드민을 한 곳에서 관리하세요</p>
        </div>
      ) : shown.length === 0 ? <div className="py-12 text-center"><p className="text-sm text-muted-foreground">검색 결과가 없어요.</p><button type="button" onClick={() => setQuery("")} className="mt-3 rounded-lg px-3 py-2 text-sm hover:bg-secondary">검색 초기화</button></div> : (
        <div className="space-y-2">
          {shown.map((webinar) => {
            // 상태 머신 기준(statusOverride 반영) — 허브·운영 콘솔과 동일 라벨
            const status = resolveWebinarStatus(webinar).status;
            const meta = WEBINAR_STATUS_META[status];
            const isLive = status === "live";
            const isEnded = status === "ended";

            return (
              <div key={webinar.id} className="group flex items-center gap-4 p-4 rounded-2xl border border-border bg-background hover:border-violet-400/30 transition-colors">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  isLive ? "bg-red-500/10 text-red-500" : isEnded ? "bg-secondary text-muted-foreground" : "bg-violet-500/10 text-violet-500"
                }`}>
                  <Video className="w-4 h-4" />
                </div>
                <Link href={`/webinar/${webinar.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{webinar.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${meta.tone}`}>{meta.label}</span>
                  </div>
                  {webinar.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{webinar.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatKst(webinar.liveStartAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {webinar._count.registrations.toLocaleString()}명
                    </span>
                  </div>
                </Link>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => { e.preventDefault(); setDeleteId(webinar.id); }}
                    className="p-2 rounded-xl hover:bg-red-500/10 hover:text-red-500 transition-colors text-muted-foreground opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            );
          })}
        </div>
      )}

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
              <h3 className="text-base font-semibold mb-2">웨비나 삭제</h3>
              <p className="text-sm text-muted-foreground mb-5">등록자, Q&A, 공지 등 모든 데이터도 함께 삭제돼요. 되돌릴 수 없어요.</p>
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
