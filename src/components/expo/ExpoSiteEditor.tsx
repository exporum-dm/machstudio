"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AutosaveScope, AggregateAutosaveIndicator } from "@/components/ui/autosave-scope";
import { FINISH, R, Segmented } from "@/components/ui/primitives";
import { PreviewFrame } from "@/components/ui/PreviewFrame";
import { ColorField } from "@/components/ui/ColorField";
import { normalizeHexColor } from "@/lib/color";
import { EXPO_DEFAULT_THEME, normalizeExpoTheme } from "@/lib/expo/config";
import { ExpoProjectSync } from "@/components/expo/ExpoProjectSync";
import { PageDraftWorkspace } from "@/components/expo/PageDraftWorkspace";
import { ExpoTemplateSave } from "@/components/expo/ExpoTemplateSave";
import { ExpoPageTree } from "@/components/expo/ExpoPageTree";
import { useExpoPreviewChannel } from "@/lib/expo/use-preview-channel";
import type { ExpoReadinessView, ExpoSnippetsView } from "@/lib/expo/editor-dto";
import type { ExpoPermissions, ExpoRelease } from "@/lib/expo/permissions";
import type { FlushResult } from "@/lib/expo/use-page-autosave";
import type { CampaignPreviewMode, ExpoTheme } from "@/lib/expo/types";
export { forcedCampaignsForPreview } from "@/lib/expo/campaign-preview";

/**
 * 홈페이지 편집 — **탐색 · 편집 · 미리보기 3열**.
 *
 * ── 3열이 하는 일 ─────────────────────────────────────────────────────
 * 왼쪽은 페이지를 고르고, 가운데는 그 페이지를 고치고, 오른쪽은 결과를 그린다.
 * 가운데의 모든 값은 자동저장되고, 오른쪽 미리보기는 **서버에 저장된 초안**을 읽으므로
 * 저장이 한 바퀴 돈 뒤에 따라온다 — 두 개의 진실이 아니라 하나의 진실에 시차가 있는 것이다.
 *
 * ── 왜 서버가 준 권한을 그대로 쓰나 ───────────────────────────────────
 * 버튼을 숨기는 것은 인가가 아니다 — 모든 라우트가 자기 자리에서 다시 판정한다.
 * 여기서 권한을 보는 목적은 **뷰어에게 눌러도 실패할 버튼을 보여주지 않는 것** 하나다.
 */

interface PageSummary {
  id: string;
  slug: string;
  title: string;
  isHome: boolean;
  sortOrder: number;
  imwebUrl: string | null;
  hasPublished: boolean;
  liveAt: string | null;
}

interface SiteInfo {
  id: string;
  name: string;
  projectId: string;
  previewToken: string | null;
  siteUrl: string | null;
  defaultLocale: string;
  /** 사이트 색. **공개 로더가 실시간으로 읽는다** — 저장하는 순간 공개 페이지가 바뀐다. */
  theme: ExpoTheme;
}

/**
 * **오른쪽 칸이 알아야 하는 것.** 가운데 칸(폼)에서 위로 올려 흐른다 — 저장 번호도
 * 발행 상태도 페이지 상세에서 오고, 그걸 들고 있는 건 폼 쪽이기 때문이다.
 */
interface PageStatus {
  /**
   * 이 정보가 **어느 페이지 것인가.** 없으면 페이지를 바꾼 직후, 새 페이지의 상세가
   * 도착하기 전까지 미리보기가 **새 주소 + 앞 페이지의 값**으로 한 번 뜬다:
   * 발행본이 없는 페이지에 `published=1` 이 붙고, 승인한 적 없는 페이지에 앞 페이지의
   * 코드 지문이 실려 나간다(서버는 거절하지만, 화면에는 "코드가 바뀌었어요" 가 뜬다).
   */
  pageId: string;
  /**
   * **이름은 여기 없다.** 상세는 `pageId` 가 바뀔 때만 다시 읽으므로, 트리에서 이름을
   * 고쳐도 이 보고에 실린 이름은 그대로다 — 페이지를 떠났다 돌아오기 전까지 발행 패널이
   * 옛 이름을 단다. 이름의 출처는 트리가 고치는 **페이지 목록** 하나뿐이다.
   */
  revision: number;
  codeDigest: string;
  publishedCodeDigest: string;
  hasPublished: boolean;
  liveAt: string | null;
  readiness: ExpoReadinessView;
  snippets: ExpoSnippetsView;
  /**
   * 아직 저장 안 끝났거나 어긋났다. **발행은 저장된 초안을 굳히는 일**이라, 이때 누르면
   * 방금 친 글이 빠진 사본이 밖에 나간다.
   */
  saveBlocked: boolean;
}

export interface ExpoSiteEditorProps {
  siteId: string;
  projectId: string;
  siteName: string;
  permissions: ExpoPermissions;
  release: ExpoRelease;
  /**
   * 편집기와 미리보기 프레임이 공유하는 오리진. **서버가 정한 값**이다 —
   * `window.location.origin` 을 쓰면 프레임 쪽 판정(`preview-bridge.ts` 의 parentOrigin)과
   * 어긋나 통로가 조용히 죽는다.
   */
  previewOrigin: string;
}

/** 사전등록 폼 후보 — 같은 전시의 빌더 폼. 사이트 조회에 같이 실려 온다. */
interface SourceOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface SiteResponse {
  site: SiteInfo;
  pages: PageSummary[];
  sources: SourceOption[];
}

/** 상태를 만지지 않는 순수 조회 — 상태 변경은 호출부의 `.then` 에서만 한다. */
async function fetchSite(
  siteId: string,
  signal: AbortSignal,
): Promise<SiteResponse | "error"> {
  const res = await fetch(`/api/expo/${encodeURIComponent(siteId)}`, { signal, cache: "no-store" });
  if (!res.ok) return "error";
  return (await res.json()) as SiteResponse;
}

export function ExpoSiteEditor(props: ExpoSiteEditorProps) {
  return (
    <AutosaveScope>
      {/* 사이드바의 전시를 이 사이트의 전시로 맞춘다 — 소속은 URL 자원에서 온다. */}
      <ExpoProjectSync projectId={props.projectId} />
      <EditorBody {...props} />
    </AutosaveScope>
  );
}

function EditorBody({ siteId, siteName, permissions, release, previewOrigin }: ExpoSiteEditorProps) {
  const params = useSearchParams();
  const router = useRouter();

  const [site, setSite] = useState<SiteInfo | null>(null);
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [sources, setSources] = useState<SourceOption[]>([]);
  /**
   * 삭제 유예(5초) 중인 페이지. 되살아날 수 있는 것을 편집하게 두면 **되살린 뒤 무엇이
   * 남아 있어야 하는지 아무도 모른다** — 그래서 그동안 편집·발행을 잠근다.
   */
  const [pendingPages, setPendingPages] = useState<ReadonlySet<string>>(new Set());
  /** 아직 적용하지 않은 색. null 이면 바꾼 것이 없다. */
  const [stagedTheme, setStagedTheme] = useState<ExpoTheme | null>(null);
  const [loadError, setLoadError] = useState(false);

  const requestedPageId = params.get("page");

  /**
   * 다시 읽기는 **번호를 올려서** 한다. 효과 본문에서 동기적으로 상태를 바꾸면 연쇄
   * 렌더가 되고(react-hooks 규칙), 무엇보다 "언제 읽는가" 가 두 곳에 흩어진다.
   */
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSite(siteId, controller.signal)
      .then((result) => {
        if (result === "error") { setLoadError(true); return; }
        setLoadError(false);
        /**
         * 색은 경계에서 한 번 다듬는다. 라우트가 이미 정규화해 주지만, 여기서 `undefined`
         * 가 들어오면 색 패널이 `saved.accent` 를 읽다가 **편집기 전체가 죽는다** —
         * 한 필드 때문에 화면이 통째로 안 뜨는 종류의 사고다.
         */
        setSite({ ...result.site, theme: normalizeExpoTheme(result.site.theme) });
        setPages(result.pages);
        setSources(result.sources ?? []);
      })
      .catch((error: { name?: string }) => {
        if (error?.name === "AbortError") return;
        setLoadError(true);
      });
    return () => controller.abort();
  }, [siteId, reloadNonce]);

  /** 고른 페이지. 주소에 없거나 사라졌으면 홈, 그것도 없으면 첫 페이지. */
  const selected = useMemo(() => {
    if (!pages || pages.length === 0) return null;
    const byId = requestedPageId ? pages.find((p) => p.id === requestedPageId) : null;
    return byId ?? pages.find((p) => p.isHome) ?? pages[0];
  }, [pages, requestedPageId]);

  /**
   * 내부 링크 후보. **지금 편집 중인 페이지도 뺀 적이 없다** — 같은 페이지의 다른 구획으로
   * 보내는 링크(맨 위로·신청 폼으로)가 실제로 필요하고, 자기 참조는 렌더가 알아서 푼다.
   */
  const linkTargets = useMemo(
    () => (pages ?? []).map((page) => ({ id: page.id, title: page.title })),
    [pages],
  );

  const transitionIntent = useRef(0);
  /** 삭제 유예를 시작한 intent. DELETE 응답 뒤에도 최신 행동일 때만 fallback으로 간다. */
  const removalIntents = useRef(new Map<string, number>());
  useEffect(() => {
    const pendingRemovals = removalIntents.current;
    // 같은 컴포넌트 인스턴스가 다른 사이트를 받으면 이전 사이트의 await 결과를 모두 폐기한다.
    transitionIntent.current += 1;
    pendingRemovals.clear();
    return () => {
      // unmount 뒤 끝난 POST/flush도 router나 선택을 바꾸지 못한다.
      transitionIntent.current += 1;
      pendingRemovals.clear();
    };
  }, [siteId]);

  const beginNavigationIntent = useCallback((): number => {
    // 더 최신 행동이 시작되면 이전 삭제의 fallback token은 다시 쓰일 수 없다.
    removalIntents.current.clear();
    transitionIntent.current += 1;
    return transitionIntent.current;
  }, []);

  const flushBeforeTransition = useCallback(async (
    flush: () => Promise<FlushResult>,
  ): Promise<boolean> => {
    const result = await flush();
    if (result === "clean" || result === "saved" || result === "disabled") return true;
    if (result === "failed") toast.error("페이지를 저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.");
    return false;
  }, []);

  const commitPageSelection = useCallback((pageId: string, intent: number): boolean => {
    if (intent !== transitionIntent.current) return false;
    const next = new URLSearchParams(params.toString());
    next.set("page", pageId);
    // `replace` 다 — 페이지를 훑을 때마다 뒤로가기 기록이 쌓이면 목록으로 못 돌아간다.
    router.replace(`?${next.toString()}`, { scroll: false });
    return true;
  }, [params, router]);

  const selectPage = useCallback(async (
    pageId: string,
    flush: () => Promise<FlushResult>,
  ): Promise<boolean> => {
    if (pageId === selected?.id) return true;
    const intent = beginNavigationIntent();
    if (!(await flushBeforeTransition(flush)) || intent !== transitionIntent.current) return false;
    return commitPageSelection(pageId, intent);
  }, [beginNavigationIntent, commitPageSelection, flushBeforeTransition, selected?.id]);

  const addPage = useCallback(async (flush: () => Promise<FlushResult>) => {
    const intent = beginNavigationIntent();
    if (!(await flushBeforeTransition(flush)) || intent !== transitionIntent.current) return false;
    const res = await fetch(`/api/expo/${encodeURIComponent(siteId)}/pages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "새 페이지" }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "페이지를 만들지 못했어요");
      return false;
    }
    const { page } = (await res.json()) as { page: { id: string } };
    // POST가 성공했다면 더 최신 선택이 있어도 목록에는 새 페이지를 반영한다. 자동 삭제하지 않는다.
    reload();
    return commitPageSelection(page.id, intent);
  }, [beginNavigationIntent, commitPageSelection, flushBeforeTransition, siteId, reload]);

  const preparePageRemoval = useCallback(async (
    pageId: string,
    flush: () => Promise<FlushResult>,
  ): Promise<boolean> => {
    const intent = beginNavigationIntent();
    if (!(await flushBeforeTransition(flush)) || intent !== transitionIntent.current) return false;
    removalIntents.current.set(pageId, intent);
    return true;
  }, [beginNavigationIntent, flushBeforeTransition]);

  const selectAfterPageRemoval = useCallback((pageId: string, removedPageId: string): boolean => {
    const intent = removalIntents.current.get(removedPageId);
    removalIntents.current.delete(removedPageId);
    if (intent === undefined) return false;
    return commitPageSelection(pageId, intent);
  }, [commitPageSelection]);

  if (loadError) {
    return (
      <Shell siteName={siteName}>
        <p className="px-1 py-16 text-sm">
          <span className="block font-medium">홈페이지를 불러오지 못했어요.</span>
          <span className="mt-1 block text-muted-foreground">잠시 후 다시 시도해 주세요.</span>
        </p>
      </Shell>
    );
  }

  if (!site || !pages) {
    return (
      <Shell siteName={siteName}>
        <p className="flex items-center gap-2 px-1 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          불러오는 중…
        </p>
      </Shell>
    );
  }

  /** 지금 보고 있는 페이지가 삭제 유예 중인가. */
  const pendingSelected = Boolean(selected && pendingPages.has(selected.id));

  return (
    <Shell siteName={site.name} siteUrl={site.siteUrl}>
      <div className="mt-5">
        {selected ? <PageDraftWorkspace
          key={selected.id}
          siteId={siteId}
          pageId={selected.id}
          permissions={{
            ...permissions,
            canEdit: permissions.canEdit && !pendingSelected,
            canPublish: permissions.canPublish && !pendingSelected,
          }}
          sources={sources}
          pages={linkTargets}
          locale={site.defaultLocale || "ko"}
          embedLocked={!release.publicEmbedEnabled}
          onSaved={reload}
          leftTop={(draft) => <ExpoPageTree
            siteId={siteId}
            pages={pages}
            selectedId={selected.id}
            canEdit={permissions.canEdit}
            canRename={false}
            canManageSite={permissions.canManageSite}
            onSelect={(pageId) => selectPage(pageId, draft.flush)}
            onSelectAfterRemove={selectAfterPageRemoval}
            onAdd={() => addPage(draft.flush)}
            onBeforeRemove={(pageId) => preparePageRemoval(pageId, draft.flush)}
            onReload={reload}
            onPendingChange={setPendingPages}
          />}
          leftBottom={<>
            {permissions.canPublish ? <ThemePanel
              siteId={siteId}
              saved={site.theme}
              staged={stagedTheme}
              onStage={setStagedTheme}
              onApplied={(theme) => {
                setSite((prev) => prev ? { ...prev, theme } : prev);
                setStagedTheme(null);
              }}
              anyLive={pages.some((page) => page.liveAt)}
            /> : null}
            {permissions.canEdit ? <ExpoTemplateSave siteId={siteId} siteName={site.name} /> : null}
          </>}
          renderPreview={(draft, locale) => {
            const page = draft.page;
            const info: PageStatus | null = page ? {
              pageId: page.id,
              revision: draft.revision,
              codeDigest: page.codeDigest,
              publishedCodeDigest: page.publishedCodeDigest,
              hasPublished: page.hasPublished,
              liveAt: page.liveAt,
              readiness: page.readiness,
              snippets: page.snippets,
              saveBlocked: draft.saveBlocked,
            } : null;
            return <PreviewPane
              key={selected.id}
              previewToken={site.previewToken}
              locale={locale}
              pageId={selected.id}
              release={release}
              info={info}
              theme={stagedTheme}
              previewOrigin={previewOrigin}
              onSelectSection={draft.setSelectedSid}
            />;
          }}
        /> : <div className={`${R.panel} ${FINISH.s1} bg-card p-5 text-sm text-muted-foreground`}>
          페이지가 없어요.
        </div>}
      </div>
    </Shell>
  );
}

function Shell({
  siteName, siteUrl, children,
}: { siteName: string; siteUrl?: string | null; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6 lg:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{siteName}</h1>
          {siteUrl ? (
            <a
              href={siteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4"
            >
              {siteUrl}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <AggregateAutosaveIndicator />
          {/* `?list=1` 이라야 사이트가 하나뿐일 때 상세로 다시 튕기지 않는다. */}
          <Link href="/homepage?list=1" className="text-sm underline underline-offset-4">
            모든 사이트
          </Link>
        </div>
      </div>
      {children}
    </div>
  );
}


/**
 * 오른쪽 칸 — **저장된 것**을 그린다.
 *
 * 편집 중인 값이 아니라 서버에 저장된 초안을 읽는다. 그래서 자동저장이 한 바퀴 돈 뒤에
 * 따라온다 — 진실이 둘인 게 아니라 하나의 진실에 시차가 있는 것이고, 저장 번호를
 * `reloadKey` 로 넘겨 그 시차를 눈에 보이게 좁힌다.
 *
 * ── 붙여넣은 코드는 기본으로 실행하지 않는다 ──────────────────────────
 * 남이 준 스크립트를 편집기에서 자동으로 돌리지 않는다. 운영자가 한 번 확인하면 그
 * 허가는 **그때 본 그 코드에만** 붙는다 — 지문이 다르면 서버가 거절하므로, 코드를 고친
 * 순간 허가가 저절로 낡는다(`code-digest.ts`). 허가는 저장하지 않는다.
 */
function PreviewPane({
  previewToken, pageId, release, info, theme, previewOrigin, onSelectSection, locale,
}: {
  previewToken: string | null;
  locale: string;
  pageId: string | null;
  release: ExpoRelease;
  info: PageStatus | null;
  /** 아직 적용하지 않은 색. **프레임에 밀어 넣는다** — 저장하지 않고, 다시 띄우지도 않는다. */
  theme: ExpoTheme | null;
  previewOrigin: string;
  /** 프레임에서 구획을 눌렀다. */
  onSelectSection: (sid: string) => void;
}) {
  const [showPublished, setShowPublished] = useState(false);
  /** 미리보기 주소에만 실리는 캠페인 가정. 초안과 자동저장에는 닿지 않는다. */
  const [campaignMode, setCampaignMode] = useState<CampaignPreviewMode>("current");
  /** 실행을 허가한 지문. 세션 한 번의 판단이라 저장하지 않는다. */
  const [approvedDigest, setApprovedDigest] = useState("");

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const { channel, pushTheme } = useExpoPreviewChannel({
    pageId, origin: previewOrigin, frameRef, onSelectSection,
  });

  /**
   * 색은 **프레임에 밀어 넣는다** — 주소에 싣지 않는다.
   *
   * 전에는 URL 에 실었는데, `<input type="color">` 가 선택기를 끄는 동안 정상 HEX 를 초당
   * 수십 번 쏘고 PreviewFrame 이 URL 을 key 로 쓰는 탓에 **iframe 이 그만큼 파괴·재생성**됐다.
   * 디바운스로 눌러 두긴 했지만, 프레임 안쪽은 처음부터 `mach-expo-preview-theme` 를 받아
   * 메모리에만 반영할 줄 알았다(`preview-bridge.ts`). 그쪽을 쓰면 리로드가 0회다.
   */
  useEffect(() => {
    if (theme) pushTheme(theme);
  }, [theme, pushTheme]);

  /**
   * **자기 페이지 것만 믿는다.** 페이지를 바꾸면 `pageId` 는 곧바로 새것이 되지만
   * `info` 는 새 페이지 상세가 도착할 때까지 앞 페이지 것이다. 그대로 쓰면 앞 페이지의
   * 발행 여부와 코드 지문으로 새 페이지를 한 번 부른다.
   */
  const own = info && info.pageId === pageId ? info : null;

  const wantPublished = showPublished && Boolean(own?.hasPublished);
  const digest = (wantPublished ? own?.publishedCodeDigest : own?.codeDigest) ?? "";
  const codeApproved = digest !== "" && approvedDigest === digest;

  /**
   * 프레임을 처음 띄울 때의 색. 이후 변경은 주소가 아니라 통로로 간다.
   * ref 가 아니라 state 인 이유: 이 값은 **렌더에서 읽힌다**(주소를 만든다).
   */
  const [initialTheme] = useState(theme);

  const src = useMemo(() => {
    /**
     * `own` 이 있어야 그린다 — 없으면 이 페이지의 상세가 아직 안 왔다는 뜻이다.
     * 먼저 그려 봐야 발행 여부도 지문도 모르는 채로 한 번 부르고 곧바로 다시 부른다.
     */
    if (!previewToken || !pageId || !own) return null;
    const query = new URLSearchParams({ page: pageId, lang: locale });
    if (wantPublished) query.set("published", "1");
    if (campaignMode !== "current") query.set("campaignState", campaignMode);
    if (codeApproved) {
      query.set("customCode", "run");
      query.set("codeDigest", digest);
    }
    /**
     * **색이 될 때만** 싣는다. 타이핑 중인 반쪽짜리 값(`#1f`)까지 실으면 글자 하나마다
     * 주소가 바뀌어 iframe 이 다시 뜬다 — 색을 고르는 동안 미리보기가 계속 깜빡인다.
     */
    /**
     * 첫 프레임에 쓸 색만 주소에 싣는다. 그 뒤의 변경은 `pushTheme` 이 리로드 없이 옮긴다 —
     * 여기에 계속 실으면 색을 고르는 동안 프레임이 매번 다시 뜬다.
     */
    if (initialTheme) {
      for (const key of ["accent", "lightBg", "darkBg"] as const) {
        const hex = normalizeHexColor(initialTheme[key]);
        if (hex) query.set(key, hex);
      }
    }
    query.set("channel", channel);
    return `/hp/${encodeURIComponent(previewToken)}?${query.toString()}`;
  }, [previewToken, pageId, own, wantPublished, campaignMode, codeApproved, digest, channel, initialTheme, locale]);

  if (!src) {
    return (
      <aside className={`${R.panel} ${FINISH.s1} bg-card p-3`} aria-label="미리보기">
        <h2 className="px-1 pb-2 text-sm font-semibold">미리보기</h2>
        <p className="px-1 py-10 text-sm text-muted-foreground">미리보기를 준비하는 중이에요.</p>
      </aside>
    );
  }

  return (
    <aside className={`${R.panel} ${FINISH.s1} space-y-2 bg-card p-3`} aria-label="미리보기">
      <PreviewFrame
        title="홈페이지 미리보기"
        src={src}
        frameRef={frameRef}
        /* 저장될 때마다 다시 불러온다 — 안 그러면 고친 내용이 영영 안 보인다. */
        reloadKey={`${own?.revision ?? 0}:${campaignMode}:${codeApproved ? "code" : "safe"}`}
        openLabel="새 탭에서 미리보기 열기"
        note={release.publicEmbedEnabled ? undefined : "공개 전"}
        controls={
          /* 발행본이 실제로 있을 때만 고르게 한다 — 없는 것을 고르는 칸은 고장으로 읽힌다. */
          <div className="flex flex-wrap items-center gap-2">
            {own?.hasPublished ? (
              <Segmented
                label="무엇을 보는가"
                value={showPublished ? "published" : "draft"}
                onChange={(next) => setShowPublished(next === "published")}
                options={[
                  { value: "draft", label: "초안" },
                  { value: "published", label: "발행본" },
                ]}
              />
            ) : null}
            <label className="text-[11px] text-muted-foreground">
              <span className="sr-only">캠페인 미리보기</span>
              <select
                aria-label="캠페인 미리보기"
                value={campaignMode}
                onChange={(event) => setCampaignMode(event.target.value as CampaignPreviewMode)}
                className="min-h-8 rounded-md bg-secondary px-2 text-xs text-foreground"
              >
                <option value="current">현재 일정</option>
                <option value="exhibitor">참가기업만</option>
                <option value="visitor">참관객만</option>
                <option value="both">둘 다</option>
                <option value="ended">둘 다 종료</option>
              </select>
            </label>
          </div>
        }
      />

      {digest === "" ? null : codeApproved ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          붙여넣은 코드를 실행 중이에요.
          <button
            type="button"
            onClick={() => setApprovedDigest("")}
            className="underline underline-offset-4 hover:text-foreground"
          >
            멈추기
          </button>
        </p>
      ) : (
        <div className={`${R.surface} ${FINISH.s2} space-y-1.5 bg-secondary p-2.5`}>
          <p className="text-[11px] leading-relaxed">
            <span className="font-medium">붙여넣은 코드는 아직 실행하지 않았어요.</span>
            <span className="mt-0.5 block text-muted-foreground">
              {approvedDigest === ""
                ? "지도·위젯처럼 밖에서 가져온 코드는 확인한 뒤에 돌립니다."
                : "코드가 바뀌었어요. 바뀐 내용을 확인하고 다시 실행해 주세요."}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setApprovedDigest(digest)}
            className={`inline-flex min-h-9 items-center gap-1.5 ${R.control} ${FINISH.control} bg-background px-3 text-xs font-medium transition-colors hover:bg-background/70`}
          >
            이 코드 실행하기
          </button>
        </div>
      )}
    </aside>
  );
}

/**
 * 사이트 색 — **자동저장하지 않는다.**
 *
 * 이 화면에서 유일하게 자동저장이 아닌 값이다. 공개 로더가 사이트 테마를 실시간으로
 * 읽으므로(`app/h/[pageId]/loader.ts`) 저장하는 순간 **이미 파트너 사이트에 붙여 둔
 * 페이지의 색까지 바뀐다.** 타이핑 중인 색이 그대로 나가면 안 된다.
 *
 * 그래서 고치는 동안은 화면 안에만 있고(미리보기에는 실어 보낸다), 적용을 눌러야 나간다.
 * 되돌릴 수 있는 변경이라 확인 모달까지 두지는 않는다 — 대신 무엇이 바뀌는지 적는다.
 */
function ThemePanel({
  siteId, saved, staged, onStage, onApplied, anyLive,
}: {
  siteId: string;
  saved: ExpoTheme;
  staged: ExpoTheme | null;
  onStage: (next: ExpoTheme | null) => void;
  onApplied: (theme: ExpoTheme) => void;
  anyLive: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const current = staged ?? saved;
  const dirty = staged !== null;

  const set = (key: keyof ExpoTheme, value: string) => onStage({ ...current, [key]: value });

  /**
   * **미리보기가 거짓말하는 자리다.** 색이 아닌 값은 미리보기 주소에서 빠지므로
   * (아래 PreviewPane) 프레임에는 저장돼 있던 옛 색이 그대로 보인다 — 화면은 멀쩡한데
   * 저장하면 값이 거절된다. 그래서 **그 칸 바로 아래**에서 미리 말한다(AGENTS.md 공통).
   */
  const badKeys = (["accent", "lightBg", "darkBg"] as const).filter(
    (key) => !normalizeHexColor(current[key]),
  );
  const invalid = badKeys.length > 0;
  const hint = (key: keyof ExpoTheme) =>
    badKeys.includes(key) ? (
      <p className="text-[11px] leading-relaxed text-[var(--destructive)]">
        #RRGGBB 형식으로 적어 주세요. 지금 값은 저장되지 않아요.
      </p>
    ) : null;

  const apply = async () => {
    if (!staged || invalid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/expo/${encodeURIComponent(siteId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: staged }),
      });
      if (!res.ok) {
        toast.error((await res.json().catch(() => ({}))).error ?? "색을 바꾸지 못했어요");
        return;
      }
      const body = (await res.json()) as { site: { theme: ExpoTheme } };
      // 서버가 정규화한 값을 받는다 — 화면이 보낸 값과 저장된 값이 다를 수 있다.
      onApplied(body.site.theme);
      toast.success("색을 적용했어요");
    } catch {
      toast.error("색을 바꾸지 못했어요. 연결을 확인해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`${R.panel} ${FINISH.s1} space-y-2.5 bg-card p-3`} aria-labelledby="expo-theme-heading">
      <h2 id="expo-theme-heading" className="text-sm font-semibold">색</h2>

      <ColorField
        label="키컬러"
        value={current.accent}
        onChange={(next) => set("accent", next)}
      />
      {hint("accent")}
      <ColorField
        label="밝은 배경"
        value={current.lightBg}
        onChange={(next) => set("lightBg", next)}
      />
      {hint("lightBg")}
      <ColorField
        label="어두운 배경"
        note="배경을 어둡게 한 구획"
        value={current.darkBg}
        onChange={(next) => set("darkBg", next)}
      />
      {hint("darkBg")}

      {dirty ? (
        <div className={`${R.surface} ${FINISH.s2} space-y-2 bg-secondary p-2.5`}>
          <p className="text-[11px] leading-relaxed">
            <span className="font-medium">아직 적용하지 않았어요.</span>
            <span className="mt-0.5 block text-muted-foreground">
              {anyLive
                ? "적용하면 이미 공개 중인 페이지의 색도 바로 바뀝니다. 오른쪽에서 먼저 확인하세요."
                : "오른쪽 미리보기에는 지금 이 색으로 보이고 있어요."}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={saving || invalid}
              className={`inline-flex min-h-9 items-center gap-1.5 ${R.control} ${FINISH.control} bg-violet-500 px-3 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-60`}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              적용
            </button>
            <button
              type="button"
              onClick={() => onStage(null)}
              disabled={saving}
              className={`inline-flex min-h-9 items-center ${R.control} px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-60`}
            >
              되돌리기
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onStage({ ...EXPO_DEFAULT_THEME })}
          className="text-[11px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
        >
          기본 색으로
        </button>
      )}
    </section>
  );
}
