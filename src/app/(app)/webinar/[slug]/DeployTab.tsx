"use client";

// 배포 탭 — 아임웹 부착의 단일 창구.
// 사이트 연결(1회) → 스니펫 복사 → 마운트 마커 배치 → 연결 배지 확인.
// 전시 전환은 "이 웨비나 노출"만 바꾸면 된다 (코드 재부착 없음).

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Cable,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Megaphone,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getPublicAppOrigin } from "@/lib/app-url";
import { isHttpUrl, normalizeLandingPageConfig } from "@/lib/webinar-config";
import { FIELD_CLS, UrlField } from "@/components/ui/primitives";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

interface EmbedSite {
  id: string;
  name: string;
  siteUrl: string | null;
  livePageUrl: string | null;
  bannerPagePatterns: string[];
  lastSeenAt: string | null;
  lastSeenOrigin: string | null;
  isActive: boolean;
  activeWebinar: { id: string; name: string; slug: string } | null;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.96 }}
      transition={spring}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          toast.success("복사했어요");
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
      {label ?? "복사"}
    </motion.button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-[11.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

function ConnectionBadge({ lastSeenAt }: { lastSeenAt: string | null }) {
  if (!lastSeenAt) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-[11px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" /> 아직 부착 안 됨
      </span>
    );
  }
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  const fresh = ageMs < 5 * 60_000;
  const mins = Math.floor(ageMs / 60_000);
  const ageText = mins < 1 ? "방금 전" : mins < 60 ? `${mins}분 전` : mins < 60 * 24 ? `${Math.floor(mins / 60)}시간 전` : `${Math.floor(mins / 1440)}일 전`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
        fresh
          ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
          : "border-border bg-secondary/50 text-muted-foreground"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${fresh ? "animate-pulse bg-green-500" : "bg-muted-foreground/40"}`} />
      {fresh ? "연결됨" : "마지막 확인"} · {ageText}
    </span>
  );
}

const MOUNT_MARKERS = [
  {
    key: "hero-button",
    title: "히어로 버튼",
    desc: "상세페이지 히어로 영역 — 상태에 따라 사전등록 → 입장하기 → 종료 CTA로 자동 전환돼요.",
    code: '<div data-mach-webinar-mount="hero-button"></div>',
  },
  {
    key: "register-form",
    title: "사전등록 폼",
    desc: "등록 폼이 이 자리에 렌더되고 제출 데이터는 mach studio로 바로 들어와요 (UTM 자동 첨부).",
    code: '<div data-mach-webinar-mount="register-form"></div>',
  },
  {
    key: "live",
    title: "라이브 시청",
    desc: "라이브 전용 페이지에 배치 — 인증·시청·Q&A·공지가 이 안에서 동작해요. 배치한 페이지 주소를 아래 \"라이브 페이지 URL\"에 등록해주세요.",
    code: '<div data-mach-webinar-mount="live"></div>',
  },
] as const;

// 랜딩 임베드 스니펫 — 호스트 문서에 직접 마운트한다(iframe 아님).
// iframe 은 별도 뷰포트라 (a) 100svh 풀스크린이 호스트 화면을 모르고 (b) position:fixed 가
// 호스트 뷰포트에 안 붙어 팝업이 어긋나고 (c) 배경 스크롤을 잠글 수 없고 (d) 높이를
// postMessage 로 중계해야 해서 로드 직후 빈 상자가 오래 보인다 — 전부 실측된 문제라 걷어냈다.
//
// 인라인 <script> 를 쓰지 않는 이유: 아임웹 코드위젯이 재저장 시 인라인 스크립트를 지우는 경우가 있다.
// div 안의 링크는 스크립트가 영영 안 와도 등록 경로가 살아 있게 하는 폴백이다.
//
// bg: 스크립트가 도착해 실제 랜딩을 그리기 전까지 보이는 마운트 판의 배경색.
// 예전엔 #06080d 로 고정돼 있어서, 랜딩을 화이트로 설정한 웨비나도 스크립트 도착 전까지
// 검은 판이 떴다 — 저장된 랜딩 배경(히어로 섹션 모드가 light 면 lightBg, dark 면 darkBg)을
// 읽어 그대로 쓴다. 색을 못 정한 경우(폴백 인자를 안 준 경우)에만 옛 값으로 되돌아간다.
const FALLBACK_LANDING_BG = "#06080d";
function buildLandingEmbedSnippet(origin: string, slug: string, name: string, bg: string) {
  const label = (name || "웨비나").replace(/[<>&]/g, "");
  return `<!-- machstudio 웨비나 랜딩 -->
<div id="ms-landing-${slug}" data-ms-landing-mount data-ms-slug="${slug}"
     style="display:block;min-height:100svh;background:${bg}">
  <a href="${origin}/webinar/${slug}/landing"
     style="display:block;padding:96px 20px;color:#abb5c7;text-align:center;text-decoration:none;font:600 15px/1.7 Pretendard,-apple-system,sans-serif">
    ${label} 사전 등록 페이지 열기 →
  </a>
</div>
<script async src="${origin}/w/l/${slug}"></script>`;
}

export default function DeployTab({ webinarId, projectId, slug, webinarName }: {
  webinarId: string;
  projectId: string;
  slug: string;
  webinarName: string;
}) {
  const confirm = useConfirm();

  const { workspace } = useWorkspace();
  const [sites, setSites] = useState<EmbedSite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSiteUrl, setNewSiteUrl] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  // 비개발자 온보딩: 부착 순서 가이드를 기본으로 펼치고(핵심 절차), 마운트 마커(코드 참조)는 접어 둔다
  const [markersOpen, setMarkersOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [liveUrlDrafts, setLiveUrlDrafts] = useState<Record<string, string>>({});
  const [bannerDrafts, setBannerDrafts] = useState<Record<string, string>>({});
  const hasLoadedRef = useRef(false);
  // 랜딩 배경색 — 스니펫 마운트 판이 스크립트 도착 전까지 보여줄 색. props 로 landingPage
  // config 가 안 내려오므로(이 탭은 components 만 받는다) 여기서 따로 읽어 온다.
  // null 이면 아직 못 정한 상태 — 스니펫은 옛 고정값(#06080d)으로 폴백한다.
  const [landingBg, setLandingBg] = useState<string | null>(null);
  // 스니펫은 파트너 사이트에 그대로 박히므로 배포 URL 기준이어야 한다.
  // 접속 중인 호스트(localhost·프리뷰 배포)를 쓰면 곧 죽는 주소가 남는다.
  const origin = getPublicAppOrigin();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/webinars/${webinarId}`);
        const data = await res.json().catch(() => null);
        if (!alive || !res.ok || !data?.webinar) return;
        const lp = normalizeLandingPageConfig(data.webinar.config);
        setLandingBg(lp.sectionBg.hero === "light" ? lp.colors.lightBg : lp.colors.darkBg);
      } catch {
        /* 실패해도 조용히 폴백 색을 쓴다 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [webinarId]);

  const fetchSites = useCallback(async () => {
    if (!workspace || !projectId) return;
    if (!hasLoadedRef.current) setIsLoading(true);
    try {
      const res = await fetch(`/api/webinar-embed-sites?workspaceId=${workspace.id}&projectId=${projectId}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.sites) {
        setSites(data.sites);
        hasLoadedRef.current = true;
      }
    } finally {
      setIsLoading(false);
    }
  }, [workspace, projectId]);

  useEffect(() => { void fetchSites(); }, [fetchSites]);

  // 연결 배지 갱신 — 10초 폴링 + 탭 숨김 가드
  useEffect(() => {
    if (!projectId) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      void fetchSites();
    }, 30_000);
    return () => clearInterval(id);
  }, [fetchSites, projectId]);

  const createSite = async () => {
    if (!workspace || !projectId || !newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/webinar-embed-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          projectId,
          name: newName.trim(),
          siteUrl: newSiteUrl.trim(),
          activeWebinarId: webinarId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "사이트 생성에 실패했어요");
      toast.success("사이트가 연결됐어요. 스니펫을 아임웹에 붙여넣어 주세요.");
      setNewName("");
      setNewSiteUrl("");
      setShowCreate(false);
      void fetchSites();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "사이트 생성에 실패했어요");
    } finally {
      setCreating(false);
    }
  };

  const patchSite = async (siteId: string, patch: Record<string, unknown>, successMsg: string) => {
    const res = await fetch(`/api/webinar-embed-sites/${siteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "저장에 실패했어요");
      return false;
    }
    toast.success(successMsg);
    void fetchSites();
    return true;
  };

  const deleteSite = async (site: EmbedSite) => {
    if (!(await confirm({ title: "사이트 연결을 삭제할까요?", description: `"${site.name}"\n부착된 스크립트는 더 이상 아무것도 표시하지 않아요.`, confirmLabel: "삭제", tone: "danger" }))) return;
    const res = await fetch(`/api/webinar-embed-sites/${site.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("삭제했어요");
      void fetchSites();
    } else {
      toast.error("삭제에 실패했어요");
    }
  };

  if (!projectId) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="text-sm font-semibold">프로젝트 정보를 확인할 수 없어요</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            이 URL의 웨비나가 속한 프로젝트를 확인한 뒤 사이트 연결과 설치 코드를 안전하게 관리할 수 있어요. 목록으로 돌아가 다시 열어주세요.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const landingUrl = origin ? `${origin}/webinar/${slug}/landing` : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl space-y-6">
      {/* 랜딩 페이지 임베드 — 사이트 연결(추적)과 독립적으로 바로 쓸 수 있다 */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Megaphone className="h-4 w-4 text-violet-500" /> 랜딩 페이지 임베드
        </h2>
        {landingUrl ? (
          <>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              아임웹 HTML 위젯에 아래 코드를 붙이면 헤더 아래에 상세페이지가 그대로 들어가요. 높이는 자동으로 맞춰지고,
              만들기 → 랜딩 페이지에서 수정하면 재부착 없이 즉시 반영돼요.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">직접 링크</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-[11.5px]">{landingUrl}</code>
                  <CopyButton text={landingUrl} />
                  <a
                    href={landingUrl}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" /> 열기
                  </a>
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">임베드 코드 (아임웹 HTML 위젯)</p>
                <CodeBlock code={buildLandingEmbedSnippet(origin, slug, webinarName, landingBg ?? FALLBACK_LANDING_BG)} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                비공개 상태면 방문자에게 “아직 공개되지 않은 페이지” 안내만 보여요 — 만들기 → 랜딩 페이지에서 공개로 켜세요.
              </p>
            </div>
          </>
        ) : (
          <p role="alert" className="mt-3 rounded-xl bg-secondary/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            공개 배포 주소가 설정되지 않아 랜딩 링크와 설치 코드를 복사할 수 없어요. NEXT_PUBLIC_CANONICAL_APP_URL을 설정하세요.
          </p>
        )}
      </section>

      {/* ① 사이트 연결 */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Cable className="h-4 w-4 text-violet-500" /> 아임웹 사이트 연결
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              사이트당 코드를 한 번만 붙이면 돼요. 배너 문구와 예약은 만들기 → 랜딩 페이지에서 설정해요.
            </p>
          </div>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={spring}
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600"
          >
            <Plus className="h-3.5 w-3.5" /> 새 사이트 연결
          </motion.button>
        </div>

        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="mt-4 space-y-2 rounded-xl border border-border bg-background p-4">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="사이트 이름 (예: 스마트테크코리아)"
                  className={FIELD_CLS}
                />
                <UrlField
                  label="사이트 주소"
                  value={newSiteUrl}
                  onChange={setNewSiteUrl}
                  placeholder="사이트 주소 (선택 — 예: https://smarttechkorea.com)"
                  isValidHttpUrl={isHttpUrl}
                />
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={createSite}
                  disabled={!newName.trim() || creating}
                  className="w-full rounded-xl bg-violet-500 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
                >
                  {creating ? "연결 중…" : "이 웨비나로 연결하기"}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {sites.length === 0 && !showCreate && (
          <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            아직 연결된 사이트가 없어요. &ldquo;새 사이트 연결&rdquo;로 시작해주세요.
          </p>
        )}

        <div className="mt-4 space-y-4">
          {sites.map((site) => {
            const isThisWebinar = site.activeWebinar?.id === webinarId;
            const snippet = origin ? `<script async src="${origin}/w/${site.id}"></script>` : null;
            return (
              <div key={site.id} className={`rounded-xl border p-4 transition-colors ${isThisWebinar ? "border-violet-500/40 bg-violet-500/[0.04]" : "border-border bg-background"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{site.name}</span>
                    <ConnectionBadge lastSeenAt={site.lastSeenAt} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {site.siteUrl && (
                      <a href={site.siteUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-secondary" aria-label="사이트 열기">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button onClick={() => deleteSite(site)} className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500" aria-label="삭제">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {isThisWebinar ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-500">
                      <Check className="h-3 w-3" /> 이 웨비나 노출 중
                    </span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">
                        현재 노출: {site.activeWebinar ? site.activeWebinar.name : "없음"}
                      </span>
                      <button
                        onClick={() => patchSite(site.id, { activeWebinarId: webinarId }, "이 웨비나가 노출되도록 전환했어요")}
                        className="rounded-lg border border-violet-500/40 px-2.5 py-1 text-[11px] font-medium text-violet-500 transition-colors hover:bg-violet-500/10"
                      >
                        이 웨비나 노출하기
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  <p className="text-[11px] font-medium text-muted-foreground">부착 스니펫 (아임웹 환경설정 → 코드 삽입, 1회)</p>
                  {snippet ? (
                    <CodeBlock code={snippet} />
                  ) : (
                    <p role="alert" className="rounded-lg bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      공개 배포 주소가 설정되지 않아 이 사이트의 설치 코드를 복사할 수 없어요. NEXT_PUBLIC_CANONICAL_APP_URL을 설정하세요.
                    </p>
                  )}
                </div>

                <div className="mt-3 space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">라이브 페이지 URL (아임웹에 만든 라이브 전용 페이지 주소)</p>
                  <div className="flex items-center gap-2">
                    {/* 이 값은 **라우트가 버린다** — PATCH /api/webinar-embed-sites/[id] 의 safeUrl 이
                        http(s) 아닌 값을 null 로 만든다. 스킴 없이 적으면 저장했다고 생각한 주소가
                        사라지고 아무 안내도 없었다(실측). */}
                    <UrlField
                      label="라이브 페이지 URL"
                      value={liveUrlDrafts[site.id] ?? site.livePageUrl ?? ""}
                      onChange={(v) => setLiveUrlDrafts((prev) => ({ ...prev, [site.id]: v }))}
                      placeholder="https://example.com/webinarlive"
                      isValidHttpUrl={isHttpUrl}
                      className="min-w-0 flex-1"
                    />
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={() => {
                        const draft = (liveUrlDrafts[site.id] ?? site.livePageUrl ?? "").trim();
                        void patchSite(site.id, { livePageUrl: draft }, "라이브 페이지 URL을 저장했어요");
                      }}
                      className="shrink-0 rounded-xl border border-border px-3 py-2 text-xs transition-colors hover:bg-secondary"
                    >
                      저장
                    </motion.button>
                  </div>
                </div>

                {/* 하단 배너 표시 범위 — 스니펫이 전 페이지에서 로드되므로 배너 노출 경로를 제한 */}
                {(() => {
                  const patterns = site.bannerPagePatterns ?? [];
                  const specific = patterns.length > 0;
                  const draft = bannerDrafts[site.id] ?? patterns.join(", ");
                  return (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-[11px] font-medium text-muted-foreground">하단 배너 표시 범위</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={specific ? "specific" : "all"}
                          onChange={(e) => {
                            if (e.target.value === "all") {
                              setBannerDrafts((prev) => ({ ...prev, [site.id]: "" }));
                              void patchSite(site.id, { bannerPagePatterns: [] }, "모든 페이지에 배너를 표시해요");
                            } else {
                              const next = draft.trim() || "/webinar";
                              setBannerDrafts((prev) => ({ ...prev, [site.id]: next }));
                              void patchSite(
                                site.id,
                                { bannerPagePatterns: next.split(",").map((s) => s.trim()).filter(Boolean) },
                                "지정한 페이지에서만 배너를 표시해요",
                              );
                            }
                          }}
                          className="rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none transition-colors focus:border-violet-400"
                        >
                          <option value="all">모든 페이지</option>
                          <option value="specific">특정 페이지에서만</option>
                        </select>
                        {specific && (
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              value={draft}
                              onChange={(e) => setBannerDrafts((prev) => ({ ...prev, [site.id]: e.target.value }))}
                              placeholder="/webinar"
                              className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none transition-colors focus:border-violet-400"
                            />
                            <motion.button
                              whileTap={{ scale: 0.96 }}
                              onClick={() =>
                                void patchSite(
                                  site.id,
                                  { bannerPagePatterns: draft.split(",").map((s) => s.trim()).filter(Boolean) },
                                  "배너 표시 페이지를 저장했어요",
                                )
                              }
                              className="shrink-0 rounded-xl border border-border px-3 py-2 text-xs transition-colors hover:bg-secondary"
                            >
                              저장
                            </motion.button>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        {specific
                          ? "쉼표로 여러 경로 지정 가능. 끝에 * 를 붙이면 하위 경로 포함 (예: /webinar 는 사전등록 페이지, /webinar* 는 그 하위까지)."
                          : "지금은 스니펫이 부착된 모든 페이지에 배너가 떠요. 사전등록 페이지에서만 띄우려면 '특정 페이지에서만'을 선택하세요."}
                      </p>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </section>

      {/* ② 마운트 마커 */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <button onClick={() => setMarkersOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
          <div>
            <h2 className="text-sm font-semibold">컴포넌트 위치 지정 (마운트 마커)</h2>
            <p className="mt-1 text-xs text-muted-foreground">버튼·폼이 들어갈 자리에 아임웹 &ldquo;코드&rdquo; 위젯으로 붙여넣으세요. 하단 배너는 마커 없이 자동 표시돼요.</p>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${markersOpen ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence>
          {markersOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="mt-4 space-y-4">
                {MOUNT_MARKERS.map((marker) => (
                  <div key={marker.key}>
                    <p className="text-xs font-medium">{marker.title}</p>
                    <p className="mb-1.5 mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{marker.desc}</p>
                    <CodeBlock code={marker.code} />
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* ③ 부착 순서 가이드 */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <button onClick={() => setGuideOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
          <h2 className="text-sm font-semibold">아임웹 부착 순서</h2>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${guideOpen ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence>
          {guideOpen && (
            <motion.ol
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="mt-3 list-decimal space-y-2 overflow-hidden pl-4 text-xs leading-relaxed text-muted-foreground"
            >
              <li>위에서 사이트를 연결하고 <b className="text-foreground">부착 스니펫</b>을 복사해요.</li>
              <li>아임웹 관리자 → <b className="text-foreground">환경설정 → 코드 삽입(헤더)</b>에 스니펫을 붙여넣어요. <b className="text-foreground">사이트당 딱 한 번</b>이에요.</li>
              <li>웨비나 상세페이지에서 버튼·폼이 들어갈 자리에 <b className="text-foreground">코드 위젯</b>을 추가하고 마운트 마커를 붙여넣어요.</li>
              <li>라이브 전용 페이지를 하나 만들고 <b className="text-foreground">라이브 마커</b>를 배치한 뒤, 그 페이지 주소를 위 &ldquo;라이브 페이지 URL&rdquo;에 저장해요.</li>
              <li>페이지를 열면 위 연결 배지가 <b className="text-foreground">&ldquo;연결됨&rdquo;</b>으로 바뀌어요. 이후 모든 변경은 mach studio에서!</li>
            </motion.ol>
          )}
        </AnimatePresence>
      </section>
      </div>
    </div>
  );
}
