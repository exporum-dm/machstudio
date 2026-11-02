"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, Plus, Copy, Check, Trash2, AlertTriangle } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { formatKstDateTime } from "@/lib/datetime";
import { ApiTokenIcon } from "@/components/settings/settings-icons";
import { getPublicAppOrigin } from "@/lib/app-url";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

interface Token {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface Props {
  workspaceId: string;
  projects: { id: string; name: string }[];
  onClose: () => void;
}

const SCOPES = [
  { id: "records:read",    label: "수집 레코드 조회" },
  { id: "records:write",   label: "수집 레코드 추가/삭제" },
  { id: "sources:read",    label: "수집 소스 조회" },
  { id: "sources:write",   label: "수집 소스 관리" },
  { id: "dashboards:read", label: "대시보드 조회" },
  { id: "ads:read",        label: "광고 성과 조회" },
];

export default function ApiTokensModal({ workspaceId, projects, onClose }: Props) {
  const publicOrigin = getPublicAppOrigin();
  const confirm = useConfirm();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", scopes: ["dashboards:read", "ads:read"] as string[], expiresInDays: 90 });
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mcpProjectId, setMcpProjectId] = useState(projects[0]?.id ?? "");
  const [mcpLinkCopied, setMcpLinkCopied] = useState(false);

  const copyMcpLink = async () => {
    if (!mcpProjectId) return;
    try {
      await navigator.clipboard.writeText(`${publicOrigin}/mcp/${mcpProjectId}`);
      setMcpLinkCopied(true);
      setTimeout(() => setMcpLinkCopied(false), 1500);
    } catch {
      toast.error("복사에 실패했어요");
    }
  };

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/api-tokens?workspaceId=${workspaceId}`);
      const data = await res.json();
      setTokens(data.tokens ?? []);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void Promise.resolve().then(fetchTokens); }, [fetchTokens]);

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error("이름이 필요해요"); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/api-tokens", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId, name: form.name.trim(), scopes: form.scopes,
          expiresInDays: form.expiresInDays || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "생성 실패"); return; }
      setNewToken(data.accessToken);
      setForm({ name: "", scopes: ["dashboards:read", "ads:read"], expiresInDays: 90 });
      fetchTokens();
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (t: Token) => {
    if (!(await confirm({ title: "토큰을 폐기할까요?", description: `"${t.name}"\n이 토큰을 사용 중인 외부 도구는 즉시 동작을 멈춰요.`, confirmLabel: "폐기", tone: "danger" }))) return;
    await fetch(`/api/api-tokens/${t.id}`, { method: "DELETE" });
    fetchTokens();
  };

  const copyNewToken = () => {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={spring}
        className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="API 토큰"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ApiTokenIcon className="w-4 h-4 text-violet-500" />
            <h2 className="text-sm font-semibold">API 토큰</h2>
          </div>
          <motion.button
            whileHover={{ rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            transition={spring}
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </motion.button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-xs text-muted-foreground">
            외부 도구와 AI가 Machstudio API·MCP를 읽을 때 사용합니다. 토큰은 발급 직후 한 번만 표시되니 안전한 곳에 저장하세요.
          </p>
          <div className="rounded-xl bg-secondary/40 p-3 text-[11px] leading-5 text-muted-foreground space-y-2">
            <p><span className="font-medium text-foreground">REST API</span> · <code className="font-mono break-all">{publicOrigin}/api/v1/openapi.json</code></p>
            <p><span className="font-medium text-foreground">원격 MCP(워크스페이스 전체)</span> · <code className="font-mono break-all">{publicOrigin}/mcp</code></p>
            {projects.length > 0 && (
              <div>
                <p className="font-medium text-foreground">원격 MCP(프로젝트 하나만 — Claude 커넥터에 이걸 쓰면 다른 프로젝트는 안 보여요)</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <select
                    value={mcpProjectId}
                    onChange={(e) => setMcpProjectId(e.target.value)}
                    className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
                  >
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <code className="flex-1 break-all">{publicOrigin}/mcp/{mcpProjectId}</code>
                  <button
                    onClick={copyMcpLink}
                    className="shrink-0 rounded-md p-1 hover:bg-secondary text-muted-foreground transition-colors"
                    aria-label="복사"
                  >
                    {mcpLinkCopied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            )}
            <p>연결할 때 Authorization 헤더에 <code className="font-mono">Bearer xfp_...</code> 형식으로 토큰을 넣으세요. Claude 같은 OAuth 커넥터는 링크만 넣으면 로그인 화면이 떠요.</p>
          </div>

          <AnimatePresence>
          {newToken && (
            <motion.div
              initial={{ opacity: 0, y: -4, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -4, height: 0 }}
              transition={spring}
              className="overflow-hidden"
            >
              <div className="p-4 rounded-xl border-2 border-violet-500/30 bg-violet-500/5 space-y-2">
                <p className="text-xs font-semibold text-violet-600 dark:text-violet-400">새 토큰이 발급됐어요 — 지금 복사하세요</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-xs font-mono break-all">{newToken}</code>
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.92 }}
                    transition={spring}
                    onClick={copyNewToken}
                    className="p-2 rounded-lg border border-border hover:bg-secondary transition-colors"
                    aria-label="복사"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {copied ? (
                        <motion.span
                          key="check"
                          initial={{ scale: 0, rotate: -90 }}
                          animate={{ scale: 1, rotate: 0 }}
                          exit={{ scale: 0, rotate: 90 }}
                          transition={spring}
                        >
                          <Check className="w-3.5 h-3.5 text-green-500" />
                        </motion.span>
                      ) : (
                        <motion.span
                          key="copy"
                          initial={{ scale: 0, rotate: -90 }}
                          animate={{ scale: 1, rotate: 0 }}
                          exit={{ scale: 0, rotate: 90 }}
                          transition={spring}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  <AlertTriangle className="inline w-3 h-3 mr-1 text-amber-500" />
                  이 토큰은 다시 표시되지 않아요. 잃어버리면 새로 발급해야 합니다.
                </p>
                <button
                  onClick={() => setNewToken(null)}
                  className="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
                >
                  확인했어요 — 닫기
                </button>
              </div>
            </motion.div>
          )}
          </AnimatePresence>

          {/* 새 토큰 폼 */}
          <div className="p-4 rounded-xl border border-border space-y-3">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="토큰 이름 (예: Zapier 연동)"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-violet-400 transition-colors"
            />
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">권한 (scopes)</label>
              <div className="space-y-1">
                {SCOPES.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.scopes.includes(s.id)}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        scopes: e.target.checked ? [...f.scopes, s.id] : f.scopes.filter((x) => x !== s.id),
                      }))}
                      className="accent-violet-500"
                    />
                    <code className="text-[10px] font-mono text-muted-foreground">{s.id}</code>
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">만료</label>
              <select
                value={form.expiresInDays}
                onChange={(e) => setForm((f) => ({ ...f, expiresInDays: parseInt(e.target.value) }))}
                className="px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:border-violet-400 transition-colors"
              >
                <option value={0}>만료 없음</option>
                <option value={30}>30일</option>
                <option value={90}>90일</option>
                <option value={365}>1년</option>
              </select>
            </div>
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              transition={spring}
              onClick={handleCreate}
              disabled={creating || !form.name.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-medium hover:bg-violet-600 disabled:opacity-40 transition-colors"
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              토큰 발급
            </motion.button>
          </div>

          {/* 기존 토큰 목록 */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">발급된 토큰</p>
            {loading ? (
              <div className="flex items-center justify-center h-16"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
            ) : tokens.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">아직 토큰이 없어요</p>
            ) : (
              <div className="space-y-1.5">
                <AnimatePresence initial={false}>
                {tokens.map((t) => (
                  <motion.div
                    key={t.id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    whileHover={{ borderColor: "rgba(139, 92, 246, 0.18)" }}
                    transition={spring}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        <code className="font-mono">{t.prefix}...</code>
                        {" · "}
                        scopes: {t.scopes.join(", ") || "(없음)"}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {t.lastUsedAt ? `마지막 사용: ${formatKstDateTime(t.lastUsedAt)}` : "사용 이력 없음"}
                        {t.expiresAt && ` · 만료: ${formatKstDateTime(t.expiresAt).slice(0, 10)}`}
                      </p>
                    </div>
                    <motion.button
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.92 }}
                      transition={spring}
                      onClick={() => handleDelete(t)}
                      className="p-1.5 rounded hover:bg-red-500/10 hover:text-red-500 text-muted-foreground transition-colors"
                      aria-label="삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </motion.button>
                  </motion.div>
                ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
