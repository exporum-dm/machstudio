"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense, type ElementType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { use } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Cable,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  MoreHorizontal,
  Settings2,
  Trash2,
  Video,
} from "lucide-react";
import { getPublicAppOrigin } from "@/lib/app-url";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { btnCls, FINISH, R, SELECTED } from "@/components/ui/primitives";
import Link from "next/link";
import PageSetupTab from "./PageSetupTab";
import { type WatchState } from "./LivePageTab";
import AnalyticsTab from "./AnalyticsTab";
import DeployTab from "./DeployTab";
import OperateTab, { type OperateSection } from "./OperateTab";
import { resolveWebinarStatus, WEBINAR_STATUS_META } from "@/lib/webinar-status";
import { formatKst } from "@/lib/datetime";
import { InlineError } from "@/components/ui/inline-error";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

type SettingsSection = "source" | "landing" | "registration" | "watch" | "survey" | "check";
// 새 IA: 만들기(create=설정) / 배포(deploy) / 운영(operate=콘솔+등록자) / 분석(analytics)
type Tab = "create" | "deploy" | "operate" | "analytics";
type NavigationTarget = Tab | `create-${SettingsSection}` | "operate-registrants";

const TAB_IDS: Tab[] = ["create", "deploy", "operate", "analytics"];
const CREATE_SECTIONS: SettingsSection[] = ["source", "landing", "registration", "watch", "survey", "check"];

/**
 * 옛 섹션 키 → 새 키. 북마크·공유 링크·외부 문서의 ?sec=general·?sec=sessions 가 죽지 않게 한다.
 * 이 둘은 IA 1단계에서 '원본 정보'로 합쳐졌다. 매핑이 없으면 알 수 없는 키로 떨어져
 * 기본 섹션으로 조용히 튕기는데, 사용자는 "세션이 사라졌다"고 읽는다.
 */
const SECTION_ALIASES: Record<string, SettingsSection> = {
  general: "source",
  sessions: "source",
  // 2단계: 대기·라이브·종료는 '시청 화면' 한 칸의 상태가 됐다.
  waiting: "watch",
  livepage: "watch",
  ended: "watch",
};

/**
 * 옛 섹션 키가 가리키던 상태로 정확히 착지시킨다 — alias 만 있으면 ?sec=ended 북마크가
 * 시청 화면의 기본 상태(라이브)로 떨어져 "종료 화면 설정이 사라졌다"로 읽힌다.
 */
const WATCH_STATE_FROM_ALIAS: Record<string, WatchState> = {
  waiting: "waiting",
  livepage: "live",
  ended: "ended",
};
const WATCH_STATES_ALL: WatchState[] = ["waiting", "entry", "live", "ended"];
const OPERATE_SECTIONS: OperateSection[] = ["console", "registrants"];

interface WebinarSession {
  id: string;
  number: number;
  type: string;
  title: string;
  speaker: string | null;
  speakerCompany: string | null;
  speakerPhotoUrl: string | null;
  logoUrl: string | null;
  description: string | null;
  speakerBio: string | null;
  speakerHomepage: string | null;
  speakerLinks: unknown;
  startTime: string;
  endTime: string;
}

interface Webinar {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  liveStartAt: string;
  liveEndAt: string;
  signupDeadline: string;
  statusOverride?: string | null;
  theme: Record<string, string>;
  config: Record<string, unknown>;
  components?: Record<string, unknown> | null;
  sessions: WebinarSession[];
  project?: { id: string; name: string } | null;
  workspace?: { id: string; name: string } | null;
  _count: { registrations: number; questions: number };
}

const tabs: { id: Tab; label: string; icon: ElementType }[] = [
  { id: "create", label: "만들기", icon: Settings2 },
  { id: "deploy", label: "배포", icon: Cable },
  { id: "operate", label: "운영", icon: Activity },
  { id: "analytics", label: "분석", icon: BarChart3 },
];

function HubLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function WebinarDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: id } = use(params);
  // useSearchParams 는 Suspense 경계가 필요 — 허브 본문을 감싼다
  return (
    <Suspense fallback={<HubLoader />}>
      <WebinarDetail id={id} />
    </Suspense>
  );
}

function WebinarDetail({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [webinar, setWebinar] = useState<Webinar | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<"notfound" | "forbidden" | "error" | null>(null);
  const [copied, setCopied] = useState(false);

  // ── 위치는 URL 이 단일 소스: ?tab=&sec= 에서 파생 (새로고침·뒤로가기·딥링크·공유 복원) ──
  const tabParam = searchParams.get("tab");
  const secParam = searchParams.get("sec");

  const computedDefaultTab = useMemo<Tab | null>(() => {
    if (!webinar) return null;
    // 상태 연동 기본 진입: 종료→분석, 라이브→운영, 그 외(준비·등록중)→만들기.
    // 등록자 수는 진입 탭을 바꾸지 않는다 — 셋업 중 첫 등록자가 들어와도 만들기에 머문다.
    const status = resolveWebinarStatus(webinar).status;
    if (status === "ended") return "analytics";
    if (status === "live") return "operate";
    return "create";
  }, [webinar]);

  const activeTab: Tab = TAB_IDS.includes(tabParam as Tab) ? (tabParam as Tab) : (computedDefaultTab ?? "operate");
  const settingsSection: SettingsSection = CREATE_SECTIONS.includes(secParam as SettingsSection)
    ? (secParam as SettingsSection)
    : (secParam && SECTION_ALIASES[secParam]) || "source";
  // 시청 화면의 편집 상태 — ?st= 이 단일 소스. 옛 섹션 키로 들어오면 그 키가 뜻하던 상태로.
  const stParam = searchParams.get("st");
  const watchState: WatchState = WATCH_STATES_ALL.includes(stParam as WatchState)
    ? (stParam as WatchState)
    : (secParam && WATCH_STATE_FROM_ALIAS[secParam]) || "live";

  const operateSection: OperateSection = OPERATE_SECTIONS.includes(secParam as OperateSection)
    ? (secParam as OperateSection)
    : "console";

  const navigate = useCallback(
    (tab: Tab, sec?: SettingsSection | OperateSection, opts?: { replace?: boolean }) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", tab);
      if (sec) sp.set("sec", sec);
      else sp.delete("sec");
      const url = `${pathname}?${sp.toString()}`;
      // 탭 전환은 push(뒤로가기로 이전 탭 복귀), 서브섹션은 replace(히스토리 소음 방지)
      if (opts?.replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  /** 시청 화면 상태 전환 — replace 로 히스토리 소음을 막는다(섹션 전환과 같은 규칙). */
  const setWatchState = useCallback(
    (next: WatchState) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", "create");
      sp.set("sec", "watch");
      sp.set("st", next);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // 상단 허브 탭 로빙 tabindex — 좌우 화살표로 포커스+선택 이동(WAI-ARIA tabs 패턴)
  const tablistRef = useRef<HTMLDivElement>(null);
  const handleTabKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (index + dir + TAB_IDS.length) % TAB_IDS.length;
      const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons?.[nextIndex]?.focus();
      navigate(TAB_IDS[nextIndex]);
    },
    [navigate],
  );

  // silent=true 면 로더 플래시 없이 webinar 만 갱신 — 자동저장 후 config 를 최신으로 유지하는 용도.
  const fetchWebinar = useCallback(async (silent = false) => {
    if (!silent) { setIsLoading(true); setLoadError(null); }
    try {
      const res = await fetch(`/api/webinars/${id}`);
      if (res.status === 404) { if (!silent) setLoadError("notfound"); return; }
      // 401/403 은 재시도해도 조건이 불변 — 재시도 버튼 없는 안내로 분기
      if (res.status === 401 || res.status === 403) { if (!silent) setLoadError("forbidden"); return; }
      if (!res.ok) { if (!silent) setLoadError("error"); return; }
      const data = await res.json();
      setWebinar(data.webinar);
    } catch {
      // 네트워크 실패 — 빈 상태로 위장하지 않고 재시도 경로 제공
      if (!silent) setLoadError("error");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { void Promise.resolve().then(() => fetchWebinar()); }, [fetchWebinar]);

  // resolveWebinarStatus(webinar) 는 마운트 시 한 번, 자동저장 후에만 다시 계산된다 —
  // 시간이 지나 라이브 시작·마감 등 경계 시각을 넘어도 리렌더 트리거가 없어서 헤더 배지·
  // 아이콘 색, PageSetupTab 에 내려주는 isLive/canRegister 가 낡은 값으로 남는다.
  // 매초 갱신 같은 과한 폴링 대신, 다음 경계 시각 하나에만 타이머를 걸고 도달하면
  // 강제 리렌더(statusTick 토글)한 뒤 다음 경계로 다시 스케줄한다.
  const [, setStatusTick] = useState(0);
  useEffect(() => {
    if (!webinar) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => {
      const { entryOpenAt } = resolveWebinarStatus(webinar);
      const boundaries = [
        entryOpenAt.getTime(),
        new Date(webinar.liveStartAt).getTime(),
        new Date(webinar.liveEndAt).getTime(),
        new Date(webinar.signupDeadline).getTime(),
      ];
      const now = Date.now();
      const nextBoundary = boundaries.filter((t) => t > now).sort((a, b) => a - b)[0];
      if (nextBoundary === undefined) return; // 모든 경계가 이미 지났다 — 더 스케줄할 것 없음
      timer = setTimeout(() => {
        setStatusTick((v) => v + 1);
        scheduleNext();
      }, nextBoundary - now);
    };
    scheduleNext();
    return () => { if (timer) clearTimeout(timer); };
  }, [webinar]);

  // tab 쿼리가 없으면 계산된 기본 탭을 URL 에 명시(replace) — 위치를 URL 단일 소스로 고정
  useEffect(() => {
    if (!webinar || !computedDefaultTab) return;
    if (!TAB_IDS.includes(searchParams.get("tab") as Tab)) {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", computedDefaultTab);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    }
  }, [webinar, computedDefaultTab, searchParams, pathname, router]);

  const handleNavigate = (target: NavigationTarget | string) => {
    if (target.startsWith("create-")) {
      navigate("create", target.replace("create-", "") as SettingsSection);
      return;
    }
    if (target === "operate-registrants") {
      navigate("operate", "registrants");
      return;
    }
    navigate(target as Tab);
  };

  const publicOrigin = getPublicAppOrigin();
  const liveUrl = webinar && publicOrigin ? `${publicOrigin}/webinar/${webinar.slug}/live` : "";

  const copyLiveUrl = async () => {
    if (!liveUrl) { toast.error("공개 주소 설정을 확인해 주세요."); return; }
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error("링크를 복사하지 못했어요."); }
  };

  if (isLoading) return <HubLoader />;

  // 로드 실패(네트워크·5xx)는 재시도 가능 — '찾을 수 없음'과 구분
  if (loadError === "error") {
    return (
      <div className="p-8">
        <InlineError message="웨비나를 불러오지 못했어요" onRetry={() => void fetchWebinar()} />
      </div>
    );
  }

  if (loadError === "forbidden") {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Video className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">이 웨비나에 접근할 권한이 없어요</p>
        <Link href="/webinar" className="text-xs text-violet-500 mt-2 hover:underline">목록으로</Link>
      </div>
    );
  }

  if (loadError === "notfound" || !webinar) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Video className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">웨비나를 찾을 수 없어요</p>
        <Link href="/webinar" className="text-xs text-violet-500 mt-2 hover:underline">목록으로</Link>
      </div>
    );
  }

  // 상태 머신 기준 — statusOverride(수동 전환) 반영. 헤더 배지/아이콘 색이 운영 콘솔과 일치.
  // 상태는 여기서 한 번만 푼다 — 자식이 다시 계산하면 statusOverride 를 못 보고 헤더와 어긋난다.
  const webinarStatus = resolveWebinarStatus(webinar);
  const status = webinarStatus.status;
  const isLive = status === "live";
  const isEnded = status === "ended";
  const statusMeta = WEBINAR_STATUS_META[status];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-6 lg:px-8 pt-6 lg:pt-8 pb-0 space-y-4">
        {/* 브레드크럼 — 목록 + 소속 프로젝트 맥락 (딥링크/복제 진입 시 어느 프로젝트인지) */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
          <Link
            href="/webinar"
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            웨비나 목록
          </Link>
          {webinar.project && (
            <span className="text-muted-foreground/60">
              · {webinar.workspace ? `${webinar.workspace.name} / ` : ""}{webinar.project.name}
            </span>
          )}
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isLive ? "bg-red-500/10 text-red-500" : isEnded ? "bg-secondary text-muted-foreground" : "bg-violet-500/10 text-violet-500"
            }`}>
              <Video className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">{webinar.name}</h1>
                {(isLive || isEnded) && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusMeta.tone}`}>{statusMeta.label}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatKst(webinar.liveStartAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                {" ~ "}
                {formatKst(webinar.liveEndAt, { hour: "2-digit", minute: "2-digit" })}
                {" · "}
                등록자 {webinar._count.registrations.toLocaleString()}명
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-secondary/50 text-xs font-mono text-muted-foreground max-w-xs truncate">
              /webinar/{webinar.slug}/live
            </div>
            <motion.button
              onClick={copyLiveUrl}
              whileTap={{ scale: 0.9 }}
              transition={spring}
              className="p-2 rounded-xl border border-border hover:bg-secondary transition-colors"
              title="라이브 URL 복사"
            >
              {copied ? (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring} className="inline-flex">
                  <Check className="w-3.5 h-3.5 text-green-500" />
                </motion.span>
              ) : (
                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </motion.button>
            <motion.a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              whileTap={{ scale: 0.9 }}
              transition={spring}
              className="p-2 rounded-xl border border-border hover:bg-secondary transition-colors"
              title="라이브 페이지 열기"
            >
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </motion.a>
            <motion.a
              href={`${liveUrl}?preview=registration`}
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.95 }}
              transition={spring}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:bg-secondary transition-colors"
              title="시청 화면 미리보기 — 대기·입장확인·라이브·종료를 한 창에서 전환"
            >
              <Eye className="w-3.5 h-3.5" />
              미리보기
            </motion.a>
            <WebinarOverflowMenu webinar={{ id: webinar.id, name: webinar.name }} />
          </div>
        </div>

        <div ref={tablistRef} className="flex items-center gap-1 overflow-x-auto py-2" role="tablist" aria-label="웨비나 메뉴">
          {tabs.map(({ id: tabId, label, icon: Icon }, tabIndex) => (
            <motion.button
              key={tabId}
              id={`tab-${tabId}`}
              role="tab"
              aria-selected={activeTab === tabId}
              aria-controls={`panel-${tabId}`}
              tabIndex={activeTab === tabId ? 0 : -1}
              onClick={() => navigate(tabId)}
              onKeyDown={(e) => handleTabKeyDown(e, tabIndex)}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              transition={spring}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === tabId ? SELECTED : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {tabId === "operate" && webinar._count.registrations > 0 && (
                <span className="ml-1 text-[10px] bg-violet-500/10 text-violet-500 px-1.5 py-0.5 rounded-full font-medium">
                  {webinar._count.registrations}
                </span>
              )}

            </motion.button>
          ))}
        </div>
      </div>

      <div
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        tabIndex={0}
        className={`flex-1 ${activeTab === "create" ? "overflow-hidden" : "overflow-auto"}`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {activeTab === "create" && (
              <PageSetupTab
                webinar={webinar}
                // 세션 저장(추가·수정·순서변경·삭제)이 이 콜백을 통해 여기까지 올라온다.
                // fetchWebinar()(비침묵판)를 쓰면 isLoading 이 세워져 만들기 화면 전체가
                // 스피너로 바뀌며 언마운트된다 — 그 사이 다른 필드 자동저장이 디바운스 대기
                // 중이면 화면이 사라지는 동안 값이 옛 값으로 잠깐 보였다가 자기치유된다.
                // silent 갱신으로 화면을 유지한 채 데이터만 최신화한다.
                onUpdate={() => fetchWebinar(true)}
                onSilentUpdate={() => fetchWebinar(true)}
                section={settingsSection}
                onSectionChange={(section) => navigate("create", section, { replace: true })}
                watchState={watchState}
                onWatchStateChange={setWatchState}
                isLive={isLive}
                // 레일 상태 점의 근거 — 같은 판정을 두 번 하지 않는다
                canRegister={webinarStatus.canRegister}
                isEnded={isEnded}
                // 안내 문구의 "운영 → 라이브 콘솔에서" 같은 문장을 누를 수 있게 —
                // 목적지가 다른 탭이라 만들기 혼자서는 이동할 수 없다(navigate 는 이 껍데기 소유).
                onJumpToTab={navigate}
              />
            )}
            {activeTab === "deploy" && <DeployTab
                webinarId={id}
                projectId={webinar.project?.id ?? ""}
                slug={webinar.slug}
                webinarName={webinar.name}
                components={webinar.components ?? null}
                onSilentUpdate={() => fetchWebinar(true)}
              />}
            {activeTab === "operate" && (
              <OperateTab
                webinarId={id}
                webinar={webinar}
                onNavigate={handleNavigate}
                section={operateSection}
                onSectionChange={(section) => navigate("operate", section, { replace: true })}
              />
            )}
            {activeTab === "analytics" && <AnalyticsTab webinarId={id} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * 껍데기 ··· 메뉴 — 저빈도·고위험 액션의 집.
 *
 * IA 문서가 웨비나 삭제를 **만들기 밖 이 메뉴로** 보낸 이유를 그대로 옮긴다:
 * "계정 수준 파괴 액션이 자동저장 표시 바로 다음 줄에 있었다 — 확인 단계는 있었지만
 * **'멀리'가 아니었다**."
 *
 * 나는 이걸 원본 정보 화면 **맨 아래**로 옮기고 "화면 맨 끝에만" 이라고 적어 뒀는데,
 * 화면 안에 있는 한 여전히 '멀리' 가 아니다(스크롤하면 지나간다). 여기로 옮긴다.
 * 확인은 공용 모달의 requireText 게이트 — 웨비나 이름을 정확히 입력해야 열린다.
 */
function WebinarOverflowMenu({ webinar }: { webinar: { id: string; name: string } }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const remove = async () => {
    setOpen(false);
    const ok = await confirm({
      title: "웨비나를 삭제할까요?",
      description: "모든 등록자, Q&A, 채팅, 공지, 설문 응답이 함께 삭제돼요. 되돌릴 수 없어요.",
      confirmLabel: "삭제",
      tone: "danger",
      requireText: { label: `확인을 위해 웨비나 이름 "${webinar.name}" 을 입력하세요`, expected: webinar.name },
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/webinars/${webinar.id}`, { method: "DELETE" });
      if (!res.ok) { toast.error("삭제 실패"); return; }
      toast.success("웨비나가 삭제됐어요");
      router.push("/webinar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="웨비나 더보기"
        title="더보기"
        disabled={busy}
        className={btnCls("quiet", "h-9 w-9 !px-0")}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className={`absolute right-0 top-full z-30 mt-1.5 w-56 bg-popover p-1.5 ${R.surface} ${FINISH.overlay}`}>
          <button
            type="button"
            role="menuitem"
            onClick={remove}
            className={`w-full text-left ${btnCls("dangerQuiet", "justify-start")}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            웨비나 삭제
          </button>
        </div>
      )}
    </div>
  );
}
