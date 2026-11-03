"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Check, X, UserPlus, ShieldCheck, UserMinus, Database, Sparkles, CalendarClock } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";

interface NotificationData {
  invitationId?: string;
  workspaceId?: string;
  workspaceName?: string;
  inviterName?: string;
  role?: string;
  // COLLECT_SUBMITTED
  sourceId?: string;
  sourceName?: string;
  recordId?: string;
  // REPORT_SENT
  reportName?: string;
  dashboardId?: string;
  // REMINDER — 정기 알림(lib/reminders.ts)
  title?: string;
  when?: string;
  href?: string | null;
  // generic fallback
  message?: string;
  [k: string]: unknown;
}

interface Notification {
  id: string;
  type: string;
  data: NotificationData;
  read: boolean;
  createdAt: string;
  // WORKSPACE_INVITE 만 채워짐 — data 의 스냅샷이 아니라 지금 초대 상태(/api/notifications 가 조인).
  invitationStatus?: string | null;
}

const ROLE_LABEL: Record<string, string> = { OWNER: "소유자", ADMIN: "편집자", MEMBER: "뷰어" };

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  const hour = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  if (hour < 24) return `${hour}시간 전`;
  return `${day}일 전`;
}

function NotificationItem({ n, onAction }: { n: Notification; onAction: () => void }) {
  const [isActing, setIsActing] = useState(false);
  const { refreshWorkspaces } = useWorkspace();

  const handleInvite = async (action: "accept" | "decline") => {
    if (!n.data.invitationId) return;
    setIsActing(true);
    try {
      const res = await fetch(`/api/invitations/${n.data.invitationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "처리하지 못했어요"); return; }
      toast.success(action === "accept" ? `'${n.data.workspaceName}' 워크스페이스에 참여했어요` : "초대를 거절했어요");
      // 수락 시 사이드바·전역 워크스페이스 목록 즉시 갱신.
      if (action === "accept") {
        await refreshWorkspaces();
      }
      onAction();
    } finally { setIsActing(false); }
  };

  if (n.type === "WORKSPACE_INVITE") {
    return (
      <div className={`p-4 rounded-2xl border transition-colors ${n.read ? "border-border bg-background" : "border-violet-400/20 bg-violet-500/5"}`}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-violet-500/10 flex items-center justify-center text-violet-500 shrink-0 mt-0.5">
            <UserPlus className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug">
              <span className="text-violet-500">{n.data.inviterName}</span>님이 <span className="font-semibold">{n.data.workspaceName}</span> 워크스페이스에 초대했어요
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{ROLE_LABEL[n.data.role ?? "MEMBER"]} 권한 · {timeAgo(n.createdAt)}</p>
            {/* 버튼 노출은 read 가 아니라 초대의 실제 상태를 따른다 — '모두 읽음' 을 눌러도
                아직 PENDING 인 초대는 계속 수락/거절할 수 있어야 한다. read 는 카드 강조만 담당. */}
            {n.invitationStatus === "PENDING" && (
              <div className="flex gap-2 mt-3">
                <motion.button whileTap={{ scale: 0.95 }}
                  onClick={() => handleInvite("accept")} disabled={isActing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-medium hover:bg-violet-600 transition-colors disabled:opacity-40">
                  <Check className="w-3 h-3" />수락
                </motion.button>
                <motion.button whileTap={{ scale: 0.95 }}
                  onClick={() => handleInvite("decline")} disabled={isActing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-40">
                  <X className="w-3 h-3" />거절
                </motion.button>
              </div>
            )}
            {n.invitationStatus === "ACCEPTED" && (
              <p className="text-xs text-violet-500 mt-1.5">수락했어요</p>
            )}
            {n.invitationStatus === "DECLINED" && (
              <p className="text-xs text-muted-foreground mt-1.5">거절했어요</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (n.type === "ROLE_CHANGED") {
    return (
      <div className={`p-4 rounded-2xl border transition-colors ${n.read ? "border-border bg-background" : "border-blue-400/20 bg-blue-500/5"}`}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0 mt-0.5">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug">
              <span className="font-semibold">{n.data.workspaceName}</span>에서 역할이 <span className="text-blue-500">{ROLE_LABEL[n.data.role ?? "MEMBER"]}</span>으로 변경됐어요
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.createdAt)}</p>
          </div>
          {!n.read && <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
        </div>
      </div>
    );
  }

  if (n.type === "MEMBER_REMOVED") {
    return (
      <div className={`p-4 rounded-2xl border transition-colors ${n.read ? "border-border bg-background" : "border-red-400/20 bg-red-500/5"}`}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 shrink-0 mt-0.5">
            <UserMinus className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug">
              <span className="font-semibold">{n.data.workspaceName}</span> 워크스페이스에서 제거됐어요
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.createdAt)}</p>
          </div>
          {!n.read && <div className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-1.5" />}
        </div>
      </div>
    );
  }

  if (n.type === "COLLECT_SUBMITTED") {
    const inner = (
      <div className={`p-4 rounded-2xl border transition-colors ${n.read ? "border-border bg-background" : "border-emerald-400/20 bg-emerald-500/5"}`}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0 mt-0.5">
            <Database className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug">
              <span className="font-semibold">{n.data.sourceName ?? "수집 소스"}</span> 에 새 제출이 들어왔어요
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.createdAt)}</p>
          </div>
          {!n.read && <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-1.5" />}
        </div>
      </div>
    );
    return n.data.sourceId
      ? <Link href={`/collect/${n.data.sourceId}`} className="block">{inner}</Link>
      : inner;
  }

  if (n.type === "REPORT_SENT") {
    return (
      <div className={`p-4 rounded-2xl border transition-colors ${n.read ? "border-border bg-background" : "border-violet-400/20 bg-violet-500/5"}`}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-violet-500/10 flex items-center justify-center text-violet-500 shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug">
              정기 리포트 <span className="font-semibold">{n.data.reportName ?? ""}</span> 가 발송됐어요
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.createdAt)}</p>
          </div>
          {!n.read && <div className="w-2 h-2 rounded-full bg-violet-500 shrink-0 mt-1.5" />}
        </div>
      </div>
    );
  }

  if (n.type === "REMINDER") {
    const inner = (
      <div className={`p-4 rounded-2xl border transition-colors ${n.read ? "border-border bg-background" : "border-amber-400/30 bg-amber-500/5"}`}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
            <CalendarClock className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-snug">{n.data.title ?? "정기 알림"}</p>
            {n.data.message && n.data.message !== n.data.title && <p className="text-sm leading-snug mt-0.5">{n.data.message}</p>}
            <p className="text-xs text-muted-foreground mt-0.5">{n.data.when ? `${n.data.when} · ` : ""}{timeAgo(n.createdAt)}</p>
          </div>
          {!n.read && <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0 mt-1.5" />}
        </div>
      </div>
    );
    return typeof n.data.href === "string" && n.data.href.startsWith("/")
      ? <Link href={n.data.href} className="block">{inner}</Link>
      : inner;
  }

  // Generic fallback — 알 수 없는 타입도 표시 (안 보이는 것보단 낫게)
  return (
    <div className={`p-4 rounded-2xl border transition-colors ${n.read ? "border-border bg-background" : "border-violet-400/20 bg-violet-500/5"}`}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground shrink-0 mt-0.5">
          <Bell className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">
            {n.data.message ?? n.type}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.createdAt)}</p>
        </div>
        {!n.read && <div className="w-2 h-2 rounded-full bg-violet-500 shrink-0 mt-1.5" />}
      </div>
    </div>
  );
}

interface Props { sidebarWidth?: number; }

export function NotificationPanel({ sidebarWidth = 248 }: Props) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    const res = await fetch("/api/notifications");
    const data = await res.json();
    setNotifications(data.notifications ?? []);
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleMarkAllRead = async () => {
    await fetch("/api/notifications", { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  return (
    <>
      {/* 백드롭 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* 종 버튼 */}
      <button
        onClick={() => setOpen(!open)}
        className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
          open ? "bg-violet-500/10 text-violet-500" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        }`}
      >
        <Bell className="w-4 h-4 shrink-0" />
        <span>알림</span>
        {unreadCount > 0 && (
          <span className="ml-auto flex items-center justify-center w-5 h-5 rounded-full bg-violet-500 text-white text-[10px] font-semibold shrink-0">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* 알림 패널 */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{ left: sidebarWidth + 8 }}
            className="fixed top-2 bottom-2 w-80 bg-background rounded-2xl shadow-xl border border-border z-40 flex flex-col"
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
              <div>
                <h2 className="text-base font-semibold">알림</h2>
                {unreadCount > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">읽지 않은 알림 {unreadCount}개</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-secondary transition-colors">
                    모두 읽음
                  </button>
                )}
                <button onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="mx-5 h-px bg-border shrink-0" />

            {/* 알림 목록 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <Bell className="w-8 h-8 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">알림이 없어요</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {notifications.map((n) => (
                    <motion.div key={n.id}
                      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      <NotificationItem n={n} onAction={() => { fetchNotifications(); }} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
