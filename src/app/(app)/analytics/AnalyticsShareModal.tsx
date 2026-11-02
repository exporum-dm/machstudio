"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Loader2, Lock, RefreshCw, Share2, X } from "lucide-react";
import { getPublicAppOrigin } from "@/lib/app-url";
import { toast } from "sonner";

interface ShareState {
  shareToken: string | null;
  shareEnabled: boolean;
  hasPassword: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export function AnalyticsShareModal({ open, onClose, projectId, projectName }: Props) {
  const [state, setState] = useState<ShareState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");

  const shareUrl = state?.shareToken && getPublicAppOrigin()
    ? `${getPublicAppOrigin()}/share/analytics/${state.shareToken}`
    : "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/analytics-share`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "공유 정보를 불러올 수 없어요");
        return;
      }
      const data = await res.json();
      setState(data);
      setPasswordOpen(data.hasPassword);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      setPasswordInput("");
      load();
    }
  }, [open, load]);

  const patch = useCallback(async (body: Record<string, unknown>, successMsg?: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/analytics-share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "변경 실패");
        return false;
      }
      const data = await res.json();
      setState(data);
      if (successMsg) toast.success(successMsg);
      return true;
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  const toggleEnabled = async (next: boolean) => {
    await patch({ shareEnabled: next }, next ? "공유가 활성화됐어요" : "공유를 비활성화했어요");
  };

  const rotateToken = async () => {
    await patch({ rotate: true }, "URL을 새로 만들었어요");
  };

  const setPassword = async () => {
    if (!passwordInput.trim()) return;
    const ok = await patch({ sharePassword: passwordInput }, "비밀번호를 설정했어요");
    if (ok) setPasswordInput("");
  };

  const clearPassword = async () => {
    await patch({ clearSharePassword: true }, "비밀번호를 해제했어요");
    setPasswordInput("");
  };

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("복사에 실패했어요");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Share2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">광고 성과 공유</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{projectName} · 최근 30일 요약을 읽기 전용으로 공유합니다</p>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {loading || !state ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between rounded-xl bg-secondary/40 p-3">
                  <div>
                    <p className="text-sm font-medium">공유 활성화</p>
                    <p className="text-[11px] text-muted-foreground">링크를 가진 누구나 볼 수 있어요</p>
                  </div>
                  <Toggle
                    checked={state.shareEnabled}
                    onChange={toggleEnabled}
                    disabled={busy}
                  />
                </div>

                {state.shareEnabled && state.shareToken && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">공유 URL</label>
                      <div className="mt-1.5 flex items-center gap-2">
                        <input
                          readOnly
                          value={shareUrl}
                          className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono outline-none"
                        />
                        <motion.button
                          onClick={copy}
                          whileTap={{ scale: 0.94 }}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs transition-colors hover:bg-secondary"
                        >
                          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied ? "복사됨" : "복사"}
                        </motion.button>
                      </div>
                      <button
                        onClick={rotateToken}
                        disabled={busy}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <RefreshCw className="h-3 w-3" /> URL 새로 만들기
                      </button>
                    </div>

                    <div className="rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                          <p className="text-sm font-medium">비밀번호 보호</p>
                        </div>
                        <Toggle
                          checked={passwordOpen || state.hasPassword}
                          onChange={(next) => {
                            setPasswordOpen(next);
                            if (!next && state.hasPassword) clearPassword();
                          }}
                          disabled={busy}
                        />
                      </div>
                      {(passwordOpen || state.hasPassword) && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-3 space-y-2"
                        >
                          {state.hasPassword ? (
                            <>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600">비밀번호 설정됨</span>
                                <button
                                  onClick={clearPassword}
                                  disabled={busy}
                                  className="text-[11px] text-rose-500 hover:underline"
                                >
                                  해제
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="password"
                                  value={passwordInput}
                                  onChange={(e) => setPasswordInput(e.target.value)}
                                  placeholder="새 비밀번호"
                                  className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-violet-400"
                                />
                                <button
                                  onClick={setPassword}
                                  disabled={!passwordInput.trim() || busy}
                                  className="rounded-xl bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
                                >
                                  변경
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center gap-2">
                              <input
                                type="password"
                                value={passwordInput}
                                onChange={(e) => setPasswordInput(e.target.value)}
                                placeholder="비밀번호"
                                className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-violet-400"
                              />
                              <button
                                onClick={setPassword}
                                disabled={!passwordInput.trim() || busy}
                                className="rounded-xl bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
                              >
                                설정
                              </button>
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground">비밀번호 없이 링크만 알아도 누구나 볼 수 있어요.</p>
                        </motion.div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
        checked ? "bg-violet-500" : "bg-secondary"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}
