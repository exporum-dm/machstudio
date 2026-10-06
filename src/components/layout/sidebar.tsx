"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, LayoutGrid, BarChart3, LogOut,
  ChevronDown, Plus, FolderOpen, Check, Loader2, Settings2, Settings, Database, Video, Link2, Pencil, Trash2, ShieldCheck, Menu, Trophy, Globe, ImageIcon, Newspaper, FileText,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/contexts/workspace";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { WorkspaceSettingsModal } from "@/components/workspace/workspace-settings-modal";
import { ProfileSettingsModal } from "@/components/user/profile-settings-modal";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import ThemeToggle from "@/components/layout/theme-toggle";
import ApiTokensModal from "@/components/settings/ApiTokensModal";
import NotificationPrefsModal from "@/components/settings/NotificationPrefsModal";
import { ApiTokenIcon, NotificationSettingsIcon } from "@/components/settings/settings-icons";
import { isSuperAdminEmail } from "@/lib/super-admin";

/**
 * `capability` 가 붙은 항목은 **서버가 준비됐다고 답할 때만** 그린다.
 *
 * 준비되지 않은 항목을 회색으로 두거나 눌리는 빈 항목으로 남기지 않는다 — 눌렀는데
 * 아무 일도 안 일어나는 메뉴는 고장으로 읽히고, 아직 공개 전인 기능의 존재를 알릴
 * 이유도 없다. **아예 없다.**
 */
export interface NavItem {
  href: string;
  icon: typeof LayoutDashboard;
  label: string;
  capability?: "expoHomepage";
}

export const navItems: NavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "대시보드" },
  { href: "/collect", icon: Database, label: "사전등록" },
  { href: "/analytics", icon: BarChart3, label: "광고 성과" },
  { href: "/utm-builder", icon: Link2, label: "UTM 빌더" },
  { href: "/webinar", icon: Video, label: "웨비나" },
  { href: "/competition", icon: Trophy, label: "대회" },
  { href: "/detail-page", icon: FileText, label: "상세페이지" },
  { href: "/homepage", icon: Globe, label: "홈페이지", capability: "expoHomepage" },
  { href: "/brief", icon: Newspaper, label: "브리프" },
  { href: "/media", icon: ImageIcon, label: "미디어" },
];

/**
 * 준비되지 않은 기능의 항목은 **배열에서 빠진다.**
 *
 * 그려 놓고 `disabled` 로 두면 눌렀는데 아무 일도 안 일어나는 메뉴가 되고, 그건
 * 고장으로 읽힌다. 그리고 아직 공개 전인 기능의 존재를 브라우저에 알릴 이유도 없다.
 *
 * 판정값은 **서버가 prop 으로 내려 준다** — 이 파일은 준비 상태를 스스로 조회하지 않는다.
 */
export function filterNavItems(
  items: readonly NavItem[],
  flags: { expoHomepageEnabled: boolean },
): NavItem[] {
  return items.filter((item) => item.capability !== "expoHomepage" || flags.expoHomepageEnabled);
}

function Dropdown({
  open, onClose, children,
}: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  // Escape 로 닫기 — 키보드 사용자가 드롭다운에서 빠져나올 수 있게
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-2xl shadow-lg z-50 overflow-hidden"
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export interface SidebarProps {
  /**
   * 홈페이지 메뉴를 그릴지. **서버가 요청 시점에 판정해 내려 준다**(`(app)/layout.tsx`).
   * 클라이언트가 스스로 조회하지 않는다.
   */
  expoHomepageEnabled?: boolean;
}

export function Sidebar({ expoHomepageEnabled = false }: SidebarProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const confirm = useConfirm();
  const supabase = useMemo(() => createClient(), []);
  const {
    workspace, workspaces, projects, currentProject,
    setCurrentProject, switchWorkspace, refreshProjects, isLoading,
  } = useWorkspace();

  const visibleNavItems = useMemo(
    () => filterNavItems(navItems, { expoHomepageEnabled }),
    [expoHomepageEnabled],
  );

  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [wsSettingsOpen, setWsSettingsOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [apiTokensOpen, setApiTokensOpen] = useState(false);
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [fabHidden, setFabHidden] = useState(false);

  const [showNewWs, setShowNewWs] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [isCreatingWs, setIsCreatingWs] = useState(false);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [isRenamingProject, setIsRenamingProject] = useState(false);

  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [dbSuperAdmin, setDbSuperAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUserEmail(user.email ?? "");
    });
    fetch("/api/user/profile").then((r) => r.json()).then((d) => {
      if (d.profile?.name) setUserName(d.profile.name);
    }).catch(() => {});
    // /api/workspace 응답에 isSuperAdmin 포함됨 — 사이드바 admin 메뉴 표시용
    fetch("/api/workspace").then((r) => r.json()).then((d) => {
      if (d.isSuperAdmin === true) setDbSuperAdmin(true);
    }).catch(() => {});
  }, [supabase.auth]);

  // 모바일: 라우트 이동 시 드로어 자동 닫기
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // 모바일: 드로어 열렸을 때 배경 스크롤 잠금
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  // 모바일: 본문 스크롤 다운 시 floating 버튼 숨김(콘텐츠 가림 방지), 멈춤/업 시 표시
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    let lastY = main.scrollTop;
    let idle: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      const y = main.scrollTop;
      if (y > lastY + 4 && y > 80) setFabHidden(true);
      else if (y < lastY - 4) setFabHidden(false);
      lastY = y;
      clearTimeout(idle);
      idle = setTimeout(() => setFabHidden(false), 700);
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => { main.removeEventListener("scroll", onScroll); clearTimeout(idle); };
  }, []);

  const displayName = userName || userEmail;
  const initial = displayName?.[0]?.toUpperCase() ?? "?";
  const isSuperAdmin = isSuperAdminEmail(userEmail) || dbSuperAdmin;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleCreateWorkspace = async () => {
    if (!newWsName.trim()) return;
    setIsCreatingWs(true);
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newWsName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(`생성 실패: ${data.error}`); return; }
      await switchWorkspace(data.workspace);
      setNewWsName(""); setShowNewWs(false); setWsMenuOpen(false);
      toast.success(`'${data.workspace.name}' 워크스페이스가 생성됐어요`);
    } catch (err) {
      toast.error(`워크스페이스 생성 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setIsCreatingWs(false); }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    setIsCreatingProject(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName.trim() }),
      });
      const data = await res.json();
      await refreshProjects();
      setCurrentProject(data.project);
      setNewProjectName(""); setShowNewProject(false); setProjectMenuOpen(false);
      toast.success(`'${data.project.name}' 프로젝트가 생성됐어요`);
    } catch (err) {
      toast.error(`프로젝트를 생성하지 못했어요. ${err instanceof Error ? err.message : "다시 시도해주세요"}`);
    } finally { setIsCreatingProject(false); }
  };

  const startRenameProject = (project: { id: string; name: string }) => {
    setShowNewProject(false);
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
  };

  const cancelRenameProject = () => {
    setEditingProjectId(null);
    setEditingProjectName("");
  };

  const handleRenameProject = async () => {
    if (!editingProjectId || !editingProjectName.trim()) return;
    setIsRenamingProject(true);
    try {
      const res = await fetch(`/api/projects/${editingProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingProjectName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "프로젝트 이름을 변경하지 못했어요");
        return;
      }
      if (currentProject?.id === data.project.id) setCurrentProject(data.project);
      await refreshProjects();
      cancelRenameProject();
      toast.success("프로젝트 이름이 변경됐어요");
    } catch (err) {
      toast.error(`프로젝트 이름 변경 실패: ${err instanceof Error ? err.message : "다시 시도해주세요"}`);
    } finally {
      setIsRenamingProject(false);
    }
  };

  const handleDeleteProject = async (project: { id: string; name: string }) => {
    const ok = await confirm({
      title: "프로젝트를 삭제할까요?",
      description: `"${project.name}" 프로젝트는 이 프로젝트의 웨비나와 등록자 데이터를 포함해 30일 후 영구 삭제되고, 그 전까지는 관리자에게 복구를 요청할 수 있어요.`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "프로젝트를 삭제하지 못했어요");
        return;
      }
      // 현재 프로젝트를 지웠으면 남은 프로젝트로 전환 (마지막 프로젝트는 서버가 삭제를 막음)
      if (currentProject?.id === project.id) {
        const next = projects.find((p) => p.id !== project.id);
        if (next) setCurrentProject(next);
      }
      await refreshProjects();
      toast.success("프로젝트가 삭제됐어요");
    } catch (err) {
      toast.error(`프로젝트 삭제 실패: ${err instanceof Error ? err.message : "다시 시도해주세요"}`);
    }
  };

  return (
    <>
    {/* 모바일 상단바 — lg 미만에서만 표시 */}
    <header className="lg:hidden fixed top-0 inset-x-0 h-14 z-30 flex items-center justify-between gap-2 px-3 bg-background/90 backdrop-blur-md border-b border-border/60">
      <button
        onClick={() => setMobileOpen(true)}
        className="flex items-center gap-2 min-w-0 p-1.5 rounded-xl hover:bg-secondary active:scale-95 transition"
      >
        <div className="w-7 h-7 rounded-lg bg-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
          {workspace?.name?.[0]?.toUpperCase() ?? "W"}
        </div>
        <div className="min-w-0 text-left">
          <p className="text-sm font-semibold truncate leading-tight">{workspace?.name ?? "mach"}</p>
          {currentProject?.name && <p className="text-[10px] text-muted-foreground truncate leading-tight">{currentProject.name}</p>}
        </div>
      </button>
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="메뉴 열기"
        className="w-8 h-8 rounded-full bg-violet-500/15 flex items-center justify-center text-violet-500 text-xs font-bold shrink-0 active:scale-95 transition"
      >
        {initial}
      </button>
    </header>

    {/* 모바일 드로어 backdrop */}
    <AnimatePresence>
      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 bg-black/40 z-40"
        />
      )}
    </AnimatePresence>

    <aside className={`flex flex-col bg-background shadow-2xl transition-transform duration-300 ease-out z-50 fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl lg:inset-x-auto lg:left-2 lg:top-2 lg:bottom-2 lg:w-60 lg:max-h-none lg:rounded-2xl lg:shadow-md lg:z-30 lg:translate-y-0 ${mobileOpen ? "translate-y-0" : "translate-y-full"}`}>
      {/* 모바일 시트 핸들 */}
      <div className="lg:hidden flex justify-center pt-2.5 pb-1 shrink-0"><div className="h-1 w-9 rounded-full bg-border" /></div>
      {/* 워크스페이스 switcher */}
      <div className="px-3 pt-4 pb-2">
        <div className="relative">
          <button
            onClick={() => { setWsMenuOpen(!wsMenuOpen); setProjectMenuOpen(false); setProfileOpen(false); }}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-secondary transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {workspace?.name?.[0]?.toUpperCase() ?? "W"}
              </div>
              <div className="min-w-0 text-left">
                <p className="text-sm font-semibold truncate leading-tight">
                  {isLoading ? "로딩 중..." : (workspace?.name ?? "워크스페이스")}
                </p>
                <p className="text-[11px] text-muted-foreground">워크스페이스</p>
              </div>
            </div>
            <motion.div animate={{ rotate: wsMenuOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            </motion.div>
          </button>

          <Dropdown open={wsMenuOpen} onClose={() => { setWsMenuOpen(false); setShowNewWs(false); setNewWsName(""); }}>
            <div className="p-1">
              <p className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">워크스페이스</p>
              {workspaces.map((ws) => (
                <button key={ws.id}
                  onClick={() => { switchWorkspace(ws); setWsMenuOpen(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-secondary transition-colors text-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-md bg-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {ws.name[0].toUpperCase()}
                    </div>
                    <span className="truncate">{ws.name}</span>
                  </div>
                  {workspace?.id === ws.id && <Check className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                </button>
              ))}
            </div>
            <div className="border-t border-border p-1">
              <button
                onClick={() => { setWsMenuOpen(false); setWsSettingsOpen(true); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-secondary transition-colors text-sm text-muted-foreground">
                <Settings2 className="w-3.5 h-3.5" />워크스페이스 설정
              </button>
            </div>
            <div className="border-t border-border p-2">
              <AnimatePresence mode="wait">
                {showNewWs ? (
                  <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                    <input autoFocus type="text" placeholder="워크스페이스 이름" value={newWsName}
                      onChange={(e) => setNewWsName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCreateWorkspace(); if (e.key === "Escape") setShowNewWs(false); }}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                    />
                    <div className="flex gap-1.5">
                      <motion.button whileTap={{ scale: 0.95 }} onClick={handleCreateWorkspace} disabled={!newWsName.trim() || isCreatingWs}
                        className="flex-1 rounded-lg bg-violet-500 py-1.5 text-xs font-medium text-white hover:bg-violet-600 transition-colors disabled:opacity-40">
                        {isCreatingWs ? "생성 중..." : "생성"}
                      </motion.button>
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => { setShowNewWs(false); setNewWsName(""); }}
                        className="flex-1 rounded-lg border border-border py-1.5 text-xs hover:bg-secondary transition-colors">
                        취소
                      </motion.button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.button key="btn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={() => setShowNewWs(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-secondary transition-colors text-sm text-muted-foreground">
                    <Plus className="w-3.5 h-3.5" />새 워크스페이스 추가
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </Dropdown>
        </div>
      </div>

      {/* 프로젝트 선택기 */}
      <div className="px-3 pb-3">
        <div className="relative">
          <button
            onClick={() => { setProjectMenuOpen(!projectMenuOpen); setWsMenuOpen(false); setProfileOpen(false); }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-secondary transition-colors text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="w-4 h-4 text-violet-500 shrink-0" />
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              ) : (
                <span className="font-medium truncate">{currentProject?.name ?? "프로젝트 선택"}</span>
              )}
            </div>
            <motion.div animate={{ rotate: projectMenuOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            </motion.div>
          </button>

          <Dropdown open={projectMenuOpen} onClose={() => { setProjectMenuOpen(false); setShowNewProject(false); setNewProjectName(""); cancelRenameProject(); }}>
            <div className="p-1">
              <p className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">프로젝트</p>
              {projects.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">프로젝트가 없어요</p>
              ) : (
                projects.map((project) => (
                  <div key={project.id}>
                    {editingProjectId === project.id ? (
                      <div className="px-2 py-1.5 space-y-2">
                        <input
                          autoFocus
                          type="text"
                          value={editingProjectName}
                          onChange={(e) => setEditingProjectName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameProject();
                            if (e.key === "Escape") cancelRenameProject();
                          }}
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                        />
                        <div className="flex gap-1.5">
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={handleRenameProject}
                            disabled={!editingProjectName.trim() || isRenamingProject}
                            className="flex-1 rounded-lg bg-violet-500 py-1.5 text-xs font-medium text-white hover:bg-violet-600 transition-colors disabled:opacity-40"
                          >
                            {isRenamingProject ? "저장 중..." : "이름 변경"}
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={cancelRenameProject}
                            className="flex-1 rounded-lg border border-border py-1.5 text-xs hover:bg-secondary transition-colors"
                          >
                            취소
                          </motion.button>
                        </div>
                      </div>
                    ) : (
                      <div className="group flex items-center gap-1 rounded-xl hover:bg-secondary transition-colors">
                        <button
                          onClick={() => { setCurrentProject(project); setProjectMenuOpen(false); }}
                          className="flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-sm"
                        >
                          <span className="truncate">{project.name}</span>
                          {currentProject?.id === project.id && <Check className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => startRenameProject(project)}
                          className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-background hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                          aria-label={`${project.name} 이름 변경`}
                          title="프로젝트 이름 변경"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProject(project)}
                          className="mr-1 rounded-lg p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
                          aria-label={`${project.name} 삭제`}
                          title="프로젝트 삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-border p-2">
              <AnimatePresence mode="wait">
                {showNewProject ? (
                  <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                    <input autoFocus type="text" placeholder="프로젝트 이름" value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCreateProject(); if (e.key === "Escape") setShowNewProject(false); }}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                    />
                    <div className="flex gap-1.5">
                      <motion.button whileTap={{ scale: 0.95 }} onClick={handleCreateProject} disabled={!newProjectName.trim() || isCreatingProject}
                        className="flex-1 rounded-lg bg-violet-500 py-1.5 text-xs font-medium text-white hover:bg-violet-600 transition-colors disabled:opacity-40">
                        {isCreatingProject ? "생성 중..." : "생성"}
                      </motion.button>
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => { setShowNewProject(false); setNewProjectName(""); }}
                        className="flex-1 rounded-lg border border-border py-1.5 text-xs hover:bg-secondary transition-colors">
                        취소
                      </motion.button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.button key="btn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={() => { cancelRenameProject(); setShowNewProject(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-secondary transition-colors text-sm text-muted-foreground">
                    <Plus className="w-3.5 h-3.5" />새 프로젝트
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </Dropdown>
        </div>
      </div>

      {/* 구분선 */}
      <div className="mx-3 h-px bg-border/60 mb-2" />

      {/* 네비게이션 */}

      <nav className="flex-1 px-3 py-1 space-y-0.5 overflow-y-auto">
        {visibleNavItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/");
          return (
            <motion.div key={href} whileTap={{ scale: 0.96 }} className="relative">
              {isActive && (
                <motion.div
                  layoutId="nav-active-bg"
                  className="absolute inset-0 rounded-xl bg-violet-500/10"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <Link href={href}
                className={`relative flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
                  isActive ? "text-violet-500 font-medium" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <motion.span
                  animate={{ scale: isActive ? 1.15 : 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="shrink-0"
                >
                  <Icon className="w-4 h-4" />
                </motion.span>
                <span>{label}</span>
              </Link>
            </motion.div>
          );
        })}
      </nav>

      {/* 슈퍼어드민 + 알림 + What's new */}
      <div className="px-3 pb-2 space-y-1">
        {isSuperAdmin && (
          <Link
            href="/admin"
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
              pathname === "/admin"
                ? "bg-violet-500/10 text-violet-500 font-medium"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            관리자
          </Link>
        )}
        <Link
          href="/summary-dashboard"
          className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
            pathname === "/summary-dashboard"
              ? "bg-violet-500/10 text-violet-500 font-medium"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          요약 대시보드
        </Link>
        <div className="flex items-center gap-1">
          <NotificationPanel />
          <ThemeToggle />
        </div>
      </div>

      {/* 하단 프로필 */}
      <div className="px-3 pb-3 pt-2" ref={profileRef}>
        <div className="relative">
          <button
            onClick={() => { setProfileOpen(!profileOpen); setWsMenuOpen(false); setProjectMenuOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-secondary transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-500 text-xs font-bold shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium truncate leading-tight">{userName || "내 계정"}</p>
              <p className="text-[11px] text-muted-foreground truncate">{userEmail}</p>
            </div>
            <motion.div animate={{ rotate: profileOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            </motion.div>
          </button>

          {/* 위쪽으로 열리는 드롭다운 */}
          <AnimatePresence>
            {profileOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full left-0 right-0 mb-1 bg-background border border-border rounded-2xl shadow-lg z-50 overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-500 text-sm font-bold shrink-0">
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{userName || "이름 없음"}</p>
                        <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-1 space-y-0.5">
                    <button
                      onClick={() => { setProfileOpen(false); setProfileSettingsOpen(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-secondary transition-colors text-sm text-muted-foreground hover:text-foreground">
                      <Settings className="w-3.5 h-3.5" />프로필 설정
                    </button>
                    <button
                      onClick={() => { setProfileOpen(false); setNotifPrefsOpen(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-secondary transition-colors text-sm text-muted-foreground hover:text-foreground">
                      <NotificationSettingsIcon className="w-3.5 h-3.5" />알림 설정
                    </button>
                    {workspace && (workspace.role === "OWNER" || workspace.role === "ADMIN") && (
                      <button
                        onClick={() => { setProfileOpen(false); setApiTokensOpen(true); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-secondary transition-colors text-sm text-muted-foreground hover:text-foreground">
                        <ApiTokenIcon className="w-3.5 h-3.5" />API 토큰
                      </button>
                    )}
                  </div>
                  <div className="border-t border-border p-1">
                    <button onClick={handleSignOut}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-red-500/10 hover:text-red-500 text-sm text-muted-foreground transition-colors">
                      <LogOut className="w-3.5 h-3.5" />로그아웃
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </aside>

    {/* 모바일 floating 메뉴 버튼 — 콘텐츠 위에 떠 있음 (lg 미만) */}
    <button
      onClick={() => setMobileOpen(true)}
      aria-label="메뉴 열기"
      className={`lg:hidden fixed left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-6 py-3.5 rounded-full bg-violet-500 text-white text-sm font-semibold shadow-lg shadow-violet-500/40 active:scale-95 transition-all duration-300 ${fabHidden ? "translate-y-4 opacity-0 pointer-events-none" : "translate-y-0 opacity-100"}`}
      style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
    >
      <Menu className="w-4 h-4" /> 메뉴
    </button>

    <WorkspaceSettingsModal open={wsSettingsOpen} onClose={() => setWsSettingsOpen(false)} />
    <ProfileSettingsModal open={profileSettingsOpen} onClose={() => setProfileSettingsOpen(false)} />
    {apiTokensOpen && workspace && (
      <ApiTokensModal workspaceId={workspace.id} onClose={() => setApiTokensOpen(false)} />
    )}
    {notifPrefsOpen && (
      <NotificationPrefsModal onClose={() => setNotifPrefsOpen(false)} />
    )}
</>
  );
}
