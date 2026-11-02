"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, CalendarDays, ChevronRight, FolderKanban, Loader2, Plus, Radio, X } from "lucide-react";
import { PageHeader, ListSearch } from "@/components/ui/page-layout";
import { useQueryText } from "@/components/ui/use-query-tab";
import { InlineError } from "@/components/ui/inline-error";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";

type Folder = {
  id: string; name: string; description: string | null; reportStart: string; reportEnd: string;
  mediaAccounts: Array<{ platform: string; accountName?: string }>;
  updatedAt: string; _count: { records: number; imports: number };
};

// DB에는 UTC로 저장되지만 이 앱의 날짜는 KST 달력일 기준 — naive slice(0,10)은 자정 부근에 하루 밀린다.
function kstDateOnly(value: string | Date) {
  const kst = new Date(new Date(value).getTime() + 9 * 60 * 60_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

const today = kstDateOnly(new Date());

export default function AnalyticsFoldersPage() {
  const { workspace, currentProject, isLoading: workspaceLoading } = useWorkspace();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [query, setQuery] = useQueryText();
  const shown = folders.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", reportStart: `${new Date().getFullYear()}-01-01`, reportEnd: today });

  const load = useCallback(async () => {
    if (!workspace || !currentProject) return;
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/ad-performance/folders?workspaceId=${workspace.id}&projectId=${currentProject.id}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `광고 성과 폴더를 불러오지 못했습니다. (${response.status})`);
      setFolders(data.folders ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "광고 성과 폴더를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [workspace, currentProject]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createFolder() {
    if (!workspace || !currentProject || !form.name.trim()) return;
    setCreating(true);
    try {
      const response = await fetch("/api/ad-performance/folders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, workspaceId: workspace.id, projectId: currentProject.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `폴더를 만들지 못했습니다. (${response.status})`);
      toast.success("광고 성과 폴더를 만들었습니다.");
      setOpen(false);
      setForm({ name: "", description: "", reportStart: `${new Date().getFullYear()}-01-01`, reportEnd: today });
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "폴더를 만들지 못했습니다."); }
    finally { setCreating(false); }
  }

  if (workspaceLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!currentProject) return <div className="flex h-64 flex-col items-center justify-center text-muted-foreground"><FolderKanban className="mb-3 h-10 w-10 opacity-30" /><p className="text-sm">프로젝트를 먼저 선택해주세요</p></div>;

  return (
    <div className="space-y-7 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="광고 성과" context={currentProject?.name} description="매체별 캠페인과 광고 소재의 성과를 비교합니다." />
        <motion.button whileTap={{ scale: .97 }} onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-violet-600"><Plus className="h-4 w-4" />광고 성과 폴더 만들기</motion.button>
      </header>

      {folders.length > 0 && <ListSearch value={query} onChange={setQuery} label="광고 폴더 검색" count={shown.length} />}
      {loading ? <div className="flex h-52 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : loadError ? <InlineError message={loadError} onRetry={load} /> : folders.length === 0 ? (
        <button onClick={() => setOpen(true)} className="group flex min-h-64 w-full flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-secondary/20 text-center transition hover:border-violet-300 hover:bg-violet-500/[.03]"><span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/10 text-violet-500"><FolderKanban className="h-6 w-6" /></span><strong className="text-sm">첫 광고 성과 폴더를 만들어보세요</strong><span className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">하나의 행사에 Meta, Google, TikTok 계정을 연결하고 통합 성과부터 소재까지 내려가며 확인할 수 있습니다.</span></button>
      ) : shown.length === 0 ? <div className="py-12 text-center"><p className="text-sm text-muted-foreground">검색 결과가 없어요.</p><button type="button" onClick={() => setQuery("")} className="mt-3 rounded-lg px-3 py-2 text-sm hover:bg-secondary">검색 초기화</button></div> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{shown.map((folder, index) => (
          <motion.div key={folder.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .04 }}>
            <Link href={`/analytics/${folder.id}`} className="group block rounded-2xl bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,.08),0_10px_30px_rgba(15,23,42,.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_34px_rgba(91,33,182,.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
              <div className="mb-6 flex items-start justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-500"><BarChart3 className="h-5 w-5" /></span><ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-violet-500" /></div>
              <h2 className="font-semibold">{folder.name}</h2><p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">{folder.description || "여러 광고 매체의 캠페인 성과를 한곳에서 봅니다."}</p>
              <div className="mt-5 flex items-center gap-2 border-t border-border/60 pt-4 text-[11px] text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />{kstDateOnly(folder.reportStart)} – {kstDateOnly(folder.reportEnd)}<span className="ml-auto flex items-center gap-1"><Radio className="h-3 w-3" />{folder.mediaAccounts?.length || 0}개 매체</span></div>
            </Link>
          </motion.div>
        ))}</div>
      )}

      <AnimatePresence>{open && <><motion.button aria-label="닫기" className="fixed inset-0 z-40 bg-black/35" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={() => setOpen(false)} /><motion.section role="dialog" aria-modal="true" initial={{opacity:0,y:12,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:8,scale:.98}} className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-background p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between"><div><h2 className="font-semibold">광고 성과 폴더 만들기</h2><p className="mt-1 text-xs text-muted-foreground">계정 연결은 폴더를 만든 다음 추가할 수 있습니다.</p></div><button onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-secondary"><X className="h-4 w-4" /></button></div><div className="space-y-4"><label className="block text-xs font-medium">폴더 이름<input autoFocus value={form.name} onChange={e => setForm({...form,name:e.target.value})} placeholder="예: 2026 에듀테크 코리아 페어" className="mt-1.5 w-full rounded-xl bg-secondary/60 px-3.5 py-2.5 text-sm outline-none ring-violet-400 focus:ring-2" /></label><label className="block text-xs font-medium">설명<textarea value={form.description} onChange={e => setForm({...form,description:e.target.value})} rows={2} className="mt-1.5 w-full resize-none rounded-xl bg-secondary/60 px-3.5 py-2.5 text-sm outline-none ring-violet-400 focus:ring-2" /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium">시작일<input type="date" value={form.reportStart} onChange={e => setForm({...form,reportStart:e.target.value})} className="mt-1.5 w-full rounded-xl bg-secondary/60 px-3 py-2.5 text-sm" /></label><label className="text-xs font-medium">종료일<input type="date" value={form.reportEnd} onChange={e => setForm({...form,reportEnd:e.target.value})} className="mt-1.5 w-full rounded-xl bg-secondary/60 px-3 py-2.5 text-sm" /></label></div><button disabled={creating || !form.name.trim()} onClick={createFolder} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50">{creating && <Loader2 className="h-4 w-4 animate-spin" />}폴더 만들기</button></div></motion.section></>}</AnimatePresence>
    </div>
  );
}
