"use client";

/**
 * 미디어 — 사진·동영상은 물론 한글·엑셀·CSV 같은 문서까지, 형식을 가리지 않고 올려
 * 공개 URL을 받는 워크스페이스 공용 자료실.
 *
 * 특정 웨비나·대회·홈페이지에 매이지 않는다 — 팀이 여러 화면에 재사용할 로고·클립·문서
 * 같은 자산을 둘 곳이 없어서 만들었다(다른 업로드는 전부 그 소유 엔티티에 종속돼 있다).
 *
 * 업로드는 이 화면이 직접 처리하지 않는다. Vercel 서버리스 함수의 요청 본문 상한(4.5MB)이
 * 있어 우리 서버를 거치면 큰 사진·동영상이 통과할 수 없다 — 그래서 서명 URL을 받아
 * **브라우저가 Supabase Storage 로 직접** 올린다(api/media/sign 머리말 참고).
 *
 * 그룹은 정규화된 테이블이 아니라 자산 각각에 붙은 자유 문자열이다(schema.prisma 주석).
 * 그 이름을 쓰는 자산이 하나도 안 남으면 그룹은 화면에서 조용히 사라진다 — 따로
 * 만들거나 지우는 절차가 없다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, ImageIcon, Video, FileText, Copy, Trash2, Loader2, X, Check, Minus,
  FolderPlus, FolderInput, ClipboardCopy, Square as SquareIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { FINISH, R, FieldSelect, Field, Btn } from "@/components/ui/primitives";
import {
  extensionFromFilename,
  formatBytes,
  kindForMimeType,
  validateMediaUpload,
  type MediaKind,
} from "@/lib/media-asset";
import { MEDIA_BUCKET } from "@/lib/media-asset-bucket";
import { compressForWeb } from "@/lib/web-image";

/** 이보다 큰 동영상은 링크로 쓰면 전송량이 빨리 찬다 — 올리기 전에 알린다. */
const VIDEO_WARN_BYTES = 10 * 1024 * 1024;

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

/** 필터 값 — 빈 문자열은 "전체", 이 상수는 "미분류"(groupLabel = null)를 뜻한다. */
const UNGROUPED = "__ungrouped__";

interface MediaAssetRow {
  id: string;
  kind: MediaKind;
  url: string;
  mimeType: string;
  size: number;
  originalName: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  groupLabel: string | null;
  createdAt: string;
  createdBy: { name: string | null; email: string } | null;
  project: { id: string; name: string } | null;
}

interface PendingUpload {
  id: string;
  name: string;
  kind: MediaKind;
  status: "reading" | "uploading" | "registering" | "error";
  error?: string;
}

/** 이미지는 로드해서, 동영상은 메타데이터만 읽어서 가로세로·길이를 잰다. 실패해도 업로드를 막지 않는다. */
function readMediaDimensions(file: File, kind: "image" | "video"): Promise<{ width?: number; height?: number; durationSec?: number }> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    const timer = setTimeout(() => { cleanup(); resolve({}); }, 8_000);

    if (kind === "image") {
      const img = new Image();
      img.onload = () => { clearTimeout(timer); cleanup(); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { clearTimeout(timer); cleanup(); resolve({}); };
      img.src = objectUrl;
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      clearTimeout(timer); cleanup();
      resolve({ width: video.videoWidth || undefined, height: video.videoHeight || undefined, durationSec: Number.isFinite(video.duration) ? video.duration : undefined });
    };
    video.onerror = () => { clearTimeout(timer); cleanup(); resolve({}); };
    video.src = objectUrl;
  });
}

function formatDuration(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec)) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 선택 체크박스 — 세 상태(빈 것·일부·전부)를 하나의 작은 컨트롤로 표현한다. */
function SelectMark({ state }: { state: "none" | "some" | "all" }) {
  if (state === "all") {
    return <span className="flex h-4 w-4 items-center justify-center rounded bg-violet-500 text-white"><Check className="h-3 w-3" aria-hidden /></span>;
  }
  if (state === "some") {
    return <span className="flex h-4 w-4 items-center justify-center rounded bg-violet-500 text-white"><Minus className="h-3 w-3" aria-hidden /></span>;
  }
  return <span className="flex h-4 w-4 items-center justify-center rounded border border-border bg-white/90"><SquareIcon className="h-2.5 w-2.5 text-transparent" aria-hidden /></span>;
}

export default function MediaPage() {
  const { workspace, projects, currentProject } = useWorkspace();
  const confirm = useConfirm();
  const supabase = useMemo(() => createClient(), []);

  const [assets, setAssets] = useState<MediaAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  // 페이지에 처음 들어오면 지금 고른 프로젝트로 좁혀서 보여준다 — "전체"는 언제든 고를 수 있다.
  const [projectFilter, setProjectFilter] = useState<string>(currentProject?.id ?? "");
  const [groupFilter, setGroupFilter] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  // 사진은 기본으로 웹용(긴 변 2000px)으로 줄여 올린다 — 인쇄용 원본이 필요할 때만 끈다(lib/web-image.ts).
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const [groupInput, setGroupInput] = useState("");
  const [movePanelOpen, setMovePanelOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * 인라인 IIFE 로 쓴다 — 콜백을 따로 만들어 이펙트에서 부르면 컴파일러가 "이펙트 안에서
   * setState" 로 판정한다(react-hooks/set-state-in-effect). ExpoSiteEditor.tsx 가 같은
   * 이유로 이 형태를 쓴다.
   */
  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      try {
        const qs = projectFilter ? `?projectId=${encodeURIComponent(projectFilter)}` : "";
        const res = await fetch(`/api/media${qs}`, { cache: "no-store", signal: controller.signal });
        const data = await res.json();
        setAssets(Array.isArray(data.assets) ? data.assets : []);
        setSelected(new Set());
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        toast.error("목록을 불러오지 못했어요. 연결을 확인해주세요.");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [workspace, projectFilter]);

  /** 지금 프로젝트 필터 안에 실제로 쓰이는 그룹 이름들 — 여기서 파생만 한다, 따로 조회하지 않는다. */
  const availableGroups = useMemo(() => {
    const names = new Set<string>();
    for (const a of assets) if (a.groupLabel) names.add(a.groupLabel);
    return [...names].sort((a, b) => a.localeCompare(b, "ko"));
  }, [assets]);

  const hasUngrouped = useMemo(() => assets.some((a) => !a.groupLabel), [assets]);

  const visibleAssets = useMemo(() => {
    if (!groupFilter) return assets;
    if (groupFilter === UNGROUPED) return assets.filter((a) => !a.groupLabel);
    return assets.filter((a) => a.groupLabel === groupFilter);
  }, [assets, groupFilter]);

  const selectionState: "none" | "some" | "all" = selected.size === 0
    ? "none"
    : selected.size >= visibleAssets.length && visibleAssets.length > 0
      ? "all"
      : "some";

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => (prev.size > 0 ? new Set() : new Set(visibleAssets.map((a) => a.id))));
  }, [visibleAssets]);

  const toggleSelectOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const uploadOne = useCallback(async (original: File) => {
    const pendingId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const kind = kindForMimeType(original.type);
    let file = original;
    setPending((prev) => [...prev, { id: pendingId, name: original.name, kind, status: "reading" }]);
    const setStatus = (status: PendingUpload["status"], error?: string) => {
      setPending((prev) => prev.map((p) => (p.id === pendingId ? { ...p, status, error } : p)));
    };
    const removeAfterDelay = (ms: number) => {
      setTimeout(() => setPending((prev) => prev.filter((p) => p.id !== pendingId)), ms);
    };

    // 사진은 화면용 크기로 줄여서 올린다 — 원본 그대로면 페이지 한 번에 수십 MB 가 나간다.
    if (kind === "image" && !keepOriginal) {
      const result = await compressForWeb(original);
      if (result.compressed) {
        file = result.file;
        toast.message(`${original.name}: 웹용으로 줄였어요 ${formatBytes(result.before)} → ${formatBytes(result.after)}`);
      }
    }
    if (kind === "video" && original.size > VIDEO_WARN_BYTES) {
      toast.warning(`${original.name}: 동영상이 ${formatBytes(original.size)}예요. 웹페이지에 넣을 영상은 YouTube 에 올리고 그 링크를 쓰면 전송량 걱정이 없어요.`);
    }

    const clientError = validateMediaUpload({ mimeType: file.type, size: file.size });
    if (clientError) {
      setStatus("error", clientError);
      toast.error(`${file.name}: ${clientError}`);
      removeAfterDelay(4_000);
      return;
    }

    try {
      // 가로세로·길이는 사진·동영상일 때만 잰다 — 문서는 잴 게 없다.
      const dims = kind === "file" ? {} : await readMediaDimensions(file, kind);

      setStatus("uploading");
      const signRes = await fetch("/api/media/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: file.type, size: file.size, originalName: file.name, projectId: projectFilter || null }),
      });
      if (!signRes.ok) throw new Error((await signRes.json().catch(() => ({}))).error ?? "업로드 준비에 실패했어요.");
      const { path, token } = await signRes.json();

      const { error: uploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      setStatus("registering");
      const confirmRes = await fetch("/api/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path, mimeType: file.type, size: file.size, originalName: file.name,
          width: dims.width, height: dims.height, durationSec: dims.durationSec,
          // 특정 그룹을 보던 중에 올렸으면 그 그룹으로 바로 들어간다 — "전체"·"미분류" 를
          // 보고 있었으면 그룹 없이 들어간다.
          groupLabel: groupFilter && groupFilter !== UNGROUPED ? groupFilter : undefined,
        }),
      });
      if (!confirmRes.ok) throw new Error((await confirmRes.json().catch(() => ({}))).error ?? "등록에 실패했어요.");
      const { asset } = await confirmRes.json();

      setAssets((prev) => [asset, ...prev]);
      setPending((prev) => prev.filter((p) => p.id !== pendingId));
      toast.success(`${file.name} 업로드 완료`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "업로드에 실패했어요.";
      setStatus("error", message);
      toast.error(`${file.name}: ${message}`);
      removeAfterDelay(5_000);
    }
  }, [projectFilter, groupFilter, supabase, keepOriginal]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => { void uploadOne(file); });
  }, [uploadOne]);

  const copyLink = useCallback(async (asset: MediaAssetRow) => {
    try {
      await navigator.clipboard.writeText(asset.url);
      setCopiedId(asset.id);
      setTimeout(() => setCopiedId((id) => (id === asset.id ? null : id)), 1_500);
    } catch {
      toast.error("복사하지 못했어요. 주소를 직접 선택해 복사해주세요.");
    }
  }, []);

  const copyLinks = useCallback(async (rows: MediaAssetRow[], label: string) => {
    if (rows.length === 0) { toast.error("복사할 항목이 없어요."); return; }
    try {
      await navigator.clipboard.writeText(rows.map((r) => r.url).join("\n"));
      toast.success(`${label} ${rows.length}개 링크를 복사했어요.`);
    } catch {
      toast.error("복사하지 못했어요. 브라우저 권한을 확인해주세요.");
    }
  }, []);

  const handleDelete = useCallback(async (asset: MediaAssetRow) => {
    const approved = await confirm({
      title: `"${asset.originalName}" 을(를) 지울까요?`,
      description: "이미 다른 곳에 붙여 넣은 링크는 더 이상 열리지 않아요. 되돌릴 수 없어요.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!approved) return;

    const prevAssets = assets;
    setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    try {
      const res = await fetch(`/api/media/${asset.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "삭제에 실패했어요.");
      toast.success("지웠어요.");
    } catch (error) {
      setAssets(prevAssets);
      toast.error(error instanceof Error ? error.message : "삭제에 실패했어요. 연결을 확인해주세요.");
    }
  }, [assets, confirm]);

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const approved = await confirm({
      title: `선택한 ${ids.length}개를 지울까요?`,
      description: "이미 다른 곳에 붙여 넣은 링크는 더 이상 열리지 않아요. 되돌릴 수 없어요.",
      confirmLabel: "전부 지우기",
      tone: "danger",
    });
    if (!approved) return;

    setBulkBusy(true);
    try {
      const res = await fetch("/api/media/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", ids }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "삭제에 실패했어요.");
      const body = await res.json() as { deletedIds: string[]; skippedIds: string[] };

      setAssets((prev) => prev.filter((a) => !body.deletedIds.includes(a.id)));
      setSelected(new Set());
      if (body.deletedIds.length > 0) toast.success(`${body.deletedIds.length}개 지웠어요.`);
      if (body.skippedIds.length > 0) toast.error(`${body.skippedIds.length}개는 올린 사람만 지울 수 있어 건너뛰었어요.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제에 실패했어요. 연결을 확인해주세요.");
    } finally {
      setBulkBusy(false);
    }
  }, [selected, confirm]);

  const applyGroup = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const label = groupInput.trim() || null;

    setBulkBusy(true);
    try {
      const res = await fetch("/api/media/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "group", ids, groupLabel: label }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "그룹을 바꾸지 못했어요.");

      setAssets((prev) => prev.map((a) => (selected.has(a.id) ? { ...a, groupLabel: label } : a)));
      toast.success(label ? `${ids.length}개를 "${label}" 그룹에 담았어요.` : `${ids.length}개를 미분류로 옮겼어요.`);
      setGroupPanelOpen(false);
      setGroupInput("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "그룹을 바꾸지 못했어요. 연결을 확인해주세요.");
    } finally {
      setBulkBusy(false);
    }
  }, [selected, groupInput]);

  const applyMove = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const targetId = moveTarget || null;

    setBulkBusy(true);
    try {
      const res = await fetch("/api/media/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "move", ids, projectId: targetId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "프로젝트를 옮기지 못했어요.");

      const targetProject = projects.find((p) => p.id === targetId) ?? null;
      setAssets((prev) => {
        // 지금 특정 프로젝트로 좁혀서 보는 중인데 다른 프로젝트로 옮겼으면, 이 목록에는
        // 더 이상 안 보이는 게 맞다(서버 GET 도 같은 필터를 쓴다) — 그대로 두면 없는 걸 있는 척.
        if (projectFilter && targetId !== projectFilter) {
          return prev.filter((a) => !selected.has(a.id));
        }
        return prev.map((a) => (selected.has(a.id) ? { ...a, project: targetProject } : a));
      });
      setSelected(new Set());
      toast.success(targetProject ? `${ids.length}개를 "${targetProject.name}" 프로젝트로 옮겼어요.` : `${ids.length}개를 워크스페이스 공용으로 옮겼어요.`);
      setMovePanelOpen(false);
      setMoveTarget("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "프로젝트를 옮기지 못했어요. 연결을 확인해주세요.");
    } finally {
      setBulkBusy(false);
    }
  }, [selected, moveTarget, projects, projectFilter]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">미디어</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          사진·동영상은 물론 한글·엑셀·CSV 같은 파일도 올리면 바로 쓸 수 있는 주소가 생겨요.
        </p>
      </div>

      {/* 업로드 자리 — 항상 보이고 그 자리에서 바로 시작된다(고치는 영역: 접지 않는다). */}
      <motion.label
        whileHover={!isDragging ? { y: -2, borderColor: "rgba(139, 92, 246, 0.6)" } : undefined}
        whileTap={{ scale: 0.995 }}
        transition={{ duration: 0.18 }}
        className={`flex min-h-32 cursor-pointer flex-col items-center justify-center ${R.panel} border border-dashed px-4 py-8 text-center transition-colors ${
          isDragging ? "border-violet-400 bg-violet-500/10" : "border-border hover:bg-violet-500/5"
        }`}
        onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
      >
        <Upload className={`mb-3 h-7 w-7 ${isDragging ? "text-violet-400" : "text-violet-500"}`} aria-hidden />
        <span className="text-sm font-medium">파일을 끌어다 놓거나 클릭해서 선택</span>
        <span className="mt-1 text-xs text-muted-foreground">
          사진·동영상·한글·엑셀·CSV 등 어떤 형식이든 올릴 수 있어요
          {groupFilter && groupFilter !== UNGROUPED ? ` · "${groupFilter}" 그룹으로 들어가요` : ""}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
        />
      </motion.label>
      <label className="-mt-2 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} className="accent-violet-500" />
        사진 원본 그대로 올리기 <span className="text-muted-foreground/70">(인쇄용일 때만 — 기본은 PC·모바일용으로 줄여서 올려요)</span>
      </label>

      {/* 올라가는 중인 파일 — 끝나면 목록으로 옮겨가고 이 줄은 사라진다. */}
      <AnimatePresence initial={false}>
        {pending.length > 0 && (
          <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-1.5 overflow-hidden">
            {pending.map((p) => (
              <li key={p.id} className={`flex items-center gap-2 ${R.surface} ${FINISH.s2} bg-secondary px-3 py-2 text-xs`}>
                {p.status === "error" ? (
                  <X className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-500" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {p.status === "reading" && "확인 중…"}
                  {p.status === "uploading" && "올리는 중…"}
                  {p.status === "registering" && "등록 중…"}
                  {p.status === "error" && (p.error ?? "실패")}
                </span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      {/* 필터 + 전체 선택/복사 — 한 줄. 고빈도 컨트롤이라 접지 않는다. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {projects.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">프로젝트</span>
            <FieldSelect value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-44">
              <option value="">전체</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </FieldSelect>
          </div>
        )}

        {(availableGroups.length > 0 || hasUngrouped) && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">그룹</span>
            <FieldSelect
              value={groupFilter}
              onChange={(e) => { setGroupFilter(e.target.value); setSelected(new Set()); }}
              className="w-44"
            >
              <option value="">전체</option>
              {availableGroups.map((g) => <option key={g} value={g}>{g}</option>)}
              {hasUngrouped && <option value={UNGROUPED}>미분류</option>}
            </FieldSelect>
          </div>
        )}

        {visibleAssets.length > 0 && (
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <SelectMark state={selectionState} />
              {selectionState === "none" ? "전체 선택" : `${selected.size}개 선택됨`}
            </button>
            <button
              type="button"
              onClick={() => void copyLinks(visibleAssets, "지금 보이는")}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
              링크 전체 복사
            </button>
          </div>
        )}
      </div>

      {/* 선택 중일 때만 나타나는 일괄 조작 — 저빈도·파괴적(삭제)은 확인 단계 뒤에 둔다. */}
      <AnimatePresence initial={false}>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            className={`overflow-hidden ${R.surface} ${FINISH.s2} bg-secondary`}
          >
            <div className="flex flex-wrap items-center gap-2 p-2.5">
              <span className="px-1 text-xs font-medium">{selected.size}개 선택됨</span>
              <Btn onClick={() => void copyLinks(assets.filter((a) => selected.has(a.id)), "선택한")} disabled={bulkBusy}>
                <Copy className="h-3.5 w-3.5" aria-hidden />
                링크 복사
              </Btn>
              <Btn onClick={() => { setGroupPanelOpen((v) => !v); setMovePanelOpen(false); }} disabled={bulkBusy}>
                <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                그룹에 담기
              </Btn>
              {projects.length > 0 && (
                <Btn onClick={() => { setMovePanelOpen((v) => !v); setGroupPanelOpen(false); }} disabled={bulkBusy}>
                  <FolderInput className="h-3.5 w-3.5" aria-hidden />
                  프로젝트 이동
                </Btn>
              )}
              <Btn tone="danger" onClick={() => void handleBulkDelete()} disabled={bulkBusy}>
                {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                선택 삭제
              </Btn>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                선택 해제
              </button>
            </div>

            <AnimatePresence initial={false}>
              {groupPanelOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden border-t border-border/60 p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Field
                      value={groupInput}
                      onChange={(e) => setGroupInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void applyGroup(); }}
                      placeholder="그룹 이름 (비우면 미분류로)"
                      list="media-group-suggestions"
                      className="max-w-64 flex-1"
                      autoFocus
                    />
                    <datalist id="media-group-suggestions">
                      {availableGroups.map((g) => <option key={g} value={g} />)}
                    </datalist>
                    <Btn tone="key" onClick={() => void applyGroup()} disabled={bulkBusy}>
                      {groupInput.trim() ? `"${groupInput.trim()}" 로 담기` : "미분류로 옮기기"}
                    </Btn>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {movePanelOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden border-t border-border/60 p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <FieldSelect
                      value={moveTarget}
                      onChange={(e) => setMoveTarget(e.target.value)}
                      className="max-w-64 flex-1"
                      autoFocus
                    >
                      <option value="">프로젝트 없음(워크스페이스 공용)</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </FieldSelect>
                    <Btn tone="key" onClick={() => void applyMove()} disabled={bulkBusy}>
                      이동
                    </Btn>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 목록 — 읽는 영역: 요약(썸네일) 먼저, 세부는 카드 안에 작게.
         auto-fill 로 칸 폭을 150px 안팎에 고정한다 — 창을 최대화해도 카드가 커지지 않고
         칸 수만 늘어야 한 화면에 더 많이 훑을 수 있다(고정 열 수 grid-cols-4 는 초대형
         모니터에서 카드 하나가 화면을 반쯤 차지하게 만든다). */}
      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          불러오는 중…
        </div>
      ) : assets.length === 0 ? (
        <div className={`${R.panel} ${FINISH.s1} bg-card p-10 text-center text-sm text-muted-foreground`}>
          아직 올린 파일이 없어요. 위 자리에 끌어다 놓으면 바로 시작돼요.
        </div>
      ) : visibleAssets.length === 0 ? (
        <div className={`${R.panel} ${FINISH.s1} bg-card p-10 text-center text-sm text-muted-foreground`}>
          이 그룹에는 아직 아무것도 없어요.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {visibleAssets.map((asset) => {
            const isSelected = selected.has(asset.id);
            return (
              <motion.div
                key={asset.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={spring}
                className={`group relative overflow-hidden ${R.panel} ${FINISH.s1} bg-card ${isSelected ? "ring-2 ring-violet-500" : ""}`}
              >
                <div className="relative aspect-square bg-secondary">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={`${asset.originalName} 선택`}
                    onClick={() => toggleSelectOne(asset.id)}
                    className="absolute left-1.5 top-1.5 z-10 rounded bg-white/80 p-0.5 shadow-sm backdrop-blur-sm transition-transform hover:scale-110"
                  >
                    <SelectMark state={isSelected ? "all" : "none"} />
                  </button>

                  {asset.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Supabase 원본을 그대로 보여준다(next/image 최적화 미설정, image-downscale.ts 주석 참고).
                    <img src={asset.url} alt={asset.originalName} className="h-full w-full object-cover" loading="lazy" />
                  ) : asset.kind === "video" ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
                      <Video className="h-8 w-8" aria-hidden />
                      {formatDuration(asset.durationSec) && (
                        <span className="text-[11px] font-medium">{formatDuration(asset.durationSec)}</span>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
                      <FileText className="h-8 w-8" aria-hidden />
                      {extensionFromFilename(asset.originalName) && (
                        <span className="text-[11px] font-medium uppercase">{extensionFromFilename(asset.originalName)}</span>
                      )}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/55 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => void copyLink(asset)}
                      aria-label={`${asset.originalName} 링크 복사`}
                      className={`inline-flex h-7 w-7 items-center justify-center ${R.control} bg-white/90 text-foreground shadow-sm transition-colors hover:bg-white`}
                    >
                      {copiedId === asset.id ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(asset)}
                      aria-label={`${asset.originalName} 삭제`}
                      className={`inline-flex h-7 w-7 items-center justify-center ${R.control} bg-white/90 text-destructive shadow-sm transition-colors hover:bg-white`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="p-2.5">
                  <p className="truncate text-xs font-medium" title={asset.originalName}>{asset.originalName}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    {asset.kind === "image" ? <ImageIcon className="h-3 w-3" aria-hidden /> : asset.kind === "video" ? <Video className="h-3 w-3" aria-hidden /> : <FileText className="h-3 w-3" aria-hidden />}
                    {formatBytes(asset.size)}
                    {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
                  </p>
                  {/* "전체"로 볼 때만 — 이미 특정 프로젝트로 좁혀 보는 중이면 카드마다 반복할 필요가 없다. */}
                  {!projectFilter && asset.project && (
                    <p className="mt-1 truncate text-[10px] text-muted-foreground" title={asset.project.name}>
                      {asset.project.name}
                    </p>
                  )}
                  {asset.groupLabel && (
                    <p className="mt-1 truncate text-[10px] font-medium text-violet-600 dark:text-violet-300" title={asset.groupLabel}>
                      {asset.groupLabel}
                    </p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
