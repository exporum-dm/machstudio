"use client";

import { Fragment, useEffect, useMemo, useState, type ElementType } from "react";
import { isSurveyAcceptingResponses } from "@/lib/webinar-survey";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, ListChecks, MonitorPlay, SlidersHorizontal, ClipboardCheck, Megaphone } from "lucide-react";
import SourceInfoTab from "./SourceInfoTab";
import RegistrationFormTab from "./RegistrationFormTab";
import LivePageTab, { type WatchState } from "./LivePageTab";
import { AutosaveScope, AggregateAutosaveIndicator } from "@/components/ui/autosave-scope";
import { readinessBySection, readinessFromExposure, type ReadinessSection } from "@/lib/webinar-readiness";
import { buildExposureReport } from "@/lib/webinar-exposure";
import { normalizeLivePageConfig } from "@/lib/webinar-config";
import SurveyTab from "./SurveyTab";
import { type OperateSection } from "./OperateTab";
import LandingPageTab from "./LandingPageTab";
import { FINISH, JumpLink, R, SELECTED_SURFACE, SELECTED_TEXT } from "@/components/ui/primitives";
import SetupPreview from "./SetupPreview";
import ExposureTab from "./ExposureTab";
import { useLiveViewers } from "@/components/webinar/use-live-viewers";
import { useLiveOffGuard } from "@/components/webinar/use-live-guard";

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
  slug: string;
  name: string;
  description: string | null;
  liveStartAt: string;
  liveEndAt: string;
  signupDeadline: string;
  theme: Record<string, string>;
  config: Record<string, unknown>;
  components?: Record<string, unknown> | null;
  sessions: WebinarSession[];
  /** 약관 전문 템플릿 — 등록 폼이 "상속 중" 을 보여주려면 값이 필요하다(IA 8단계). */
  workspace?: { id: string; name: string; privacyBodyTemplate?: string | null; marketingBodyTemplate?: string | null } | null;
}

type PageSetupSection = "source" | "landing" | "registration" | "watch" | "survey" | "check";

/**
 * 승인된 IA 재설계 — 축을 하나로 바꿨다: **"사실인가, 표현인가"**.
 * "이 값이 어느 화면에 보이나"는 여러 화면에 나가는 값(테마·세션)에 답이 없어서
 * 그 값들이 마지막에 손댄 섹션에 얹혀 있었다.
 *
 * 1단계에서 합친 것: 기본 정보 + 세션 + (라이브 페이지 안의) 디자인 → '원본 정보'.
 * 2단계에서 대기·라이브·종료가 '시청 화면' 4상태로 합쳐지면 산출물이 4개가 된다.
 */
const sections: { id: PageSetupSection; label: string; desc: string; icon: ElementType; group: "사실" | "산출물" | "확인" }[] = [
  { id: "source", group: "사실", label: "원본 정보", desc: "이름·일정, 진행 순서, 브랜드 — 네 산출물이 모두 여기서 읽어갑니다.", icon: SlidersHorizontal },
  // 랜딩은 홍보 진입점이라 등록보다 앞 — 산출물 순서 = 시청자 여정 순서
  { id: "landing", group: "산출물", label: "랜딩 페이지", desc: "외부 사이트에 임베드하는 상세페이지 — 히어로·소개·프로그램·FAQ를 구성합니다.", icon: Megaphone },
  { id: "registration", group: "산출물", label: "등록 폼", desc: "사전등록에서 수집할 항목과 동의 문구를 설정합니다.", icon: FileText },
  // 대기·입장·라이브·종료는 **한 라우트의 네 순간**이라 메뉴 한 칸 + 상태 세그먼트로 합쳤다.
  { id: "watch", group: "산출물", label: "시청 화면", desc: "등록자가 라이브 전·중·후에 보는 한 몸의 화면 — 상태별로 골라 편집합니다.", icon: MonitorPlay },
  { id: "survey", group: "산출물", label: "설문", desc: "자체 설문을 만들어 종료 화면·라이브 푸시·링크로 응답을 모읍니다.", icon: ClipboardCheck },
  /**
   * 세 번째 그룹 '확인' — IA 가 세운 '사실 / 산출물' 2축을 흐리는 선택이다. 그래도 넣는 이유:
   * 점검은 값의 집이 아니라 **거울**이라 두 축 어디에도 안 들어가고, 그 자리에 이미 목적지 없는
   * 입구가 있었다('확인할 것' 카드의 "그리고 N건 더" 는 button 이 아니라 p 태그였다 — 전체를
   * 볼 화면이 코드에 없었다). 그 빈 목적지를 채우면서 ?sec=check 딥링크까지 얻는다.
   */
  { id: "check", group: "확인", label: "노출 점검", desc: "어떤 요소가 어느 공개 면에 나가는지 한 자리에서 봅니다 — 읽기 전용이에요.", icon: ListChecks },
];


export default function PageSetupTab({
  webinar,
  onUpdate,
  onSilentUpdate,
  section,
  onSectionChange,
  watchState,
  onWatchStateChange,
  isLive,
  canRegister,
  isEnded,
  onJumpToTab,
}: {
  webinar: Webinar;
  onUpdate: () => void;
  onSilentUpdate: () => void;
  section: PageSetupSection;
  onSectionChange: (section: PageSetupSection) => void;
  /** 시청 화면의 편집 상태 — URL 이 단일 소스라 page.tsx 가 들고 있다. */
  watchState: WatchState;
  onWatchStateChange: (next: WatchState) => void;
  /** 방송 중인가 — 상단 띠 표시용(상태 판정은 page.tsx 의 resolveWebinarStatus 가 단일 소스). */
  isLive?: boolean;
  /** 지금 등록을 받는가 — 레일 상태 점의 근거. 같은 판정을 여기서 다시 하지 않는다. */
  canRegister?: boolean;
  isEnded?: boolean;
  /**
   * 다른 탭으로 점프 — 안내 문구를 누를 수 있게 만들 때만 쓴다(껍데기가 소유한 navigate).
   * 목적지를 좁게 잡는다: 지금 필요한 건 배포 탭과 운영 콘솔뿐이고, string 으로 열어 두면
   * 오타가 타입에서 안 걸린다.
   */
  onJumpToTab?: (tab: "deploy" | "operate", sec?: OperateSection) => void;
}) {
  /**
   * 종료 화면에 실제로 연결된 자체 설문이 있는가 — 준비 상태의 '설문 영역' 판정 근거.
   * 서버(info 라우트)와 같은 조건을 쓴다: showOnEnded + isOpen + 마감 전.
   */
  /**
   * null = 아직 모른다(fetch 중 또는 실패).
   *
   * false 로 초기화하면 첫 200ms 동안, 그리고 **네트워크 실패 시 영구히** "설문 없음" 이라고
   * 단정한다 — 열려 있는 설문을 레일에서 '사용 안 함' 으로 오답하고, 이 화면이 스스로 세운
   * 규칙("모르는 값은 점을 안 그린다")을 깬다. 아래 catch 가 실패를 조용히 삼키므로 특히 위험하다.
   */
  const [hasLinkedEndedSurvey, setHasLinkedEndedSurvey] = useState<boolean | null>(null);
  /** 열려 있는 설문이 하나라도 있는가 — 레일에서 '사용 안 함' 과 '공개' 를 가른다. */
  const [hasOpenSurvey, setHasOpenSurvey] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/webinars/${webinar.id}/surveys`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        /* 판정은 공용 함수 하나로 — 여기서 손으로 다시 쓰면 필드가 늘 때(opensAt 이 그랬다)
           이 화면만 조용히 낡는다. 시작 예약이 걸린 설문을 "공개 중" 이라고 그리던 원인이다. */
        const list = (data.surveys ?? []) as { showOnEnded?: boolean; isOpen?: boolean; opensAt?: string | null; closesAt?: string | null }[];
        const isOpenNow = (v: { isOpen?: boolean; opensAt?: string | null; closesAt?: string | null }) =>
          v.isOpen === true && isSurveyAcceptingResponses({ isOpen: true, opensAt: v.opensAt, closesAt: v.closesAt });
        setHasLinkedEndedSurvey(list.some((v) => v.showOnEnded === true && isOpenNow(v)));
        setHasOpenSurvey(list.some(isOpenNow));
      } catch { /* 준비 상태는 부가 정보라 실패해도 화면을 막지 않는다 */ }
    })();
    return () => { cancelled = true; };
  }, [webinar.id]);

  /**
   * 종료 화면의 설문 영역이 켜져 있는가 — 설문 탭의 "켰는데 안 보인다" 안내 판정에 쓴다.
   * 저장 위치가 config 안쪽이라 여기서 읽어 내려보낸다(설문 탭은 config 를 받지 않는다).
   *
   * 경로를 손으로 파고들다 **한 층을 잘못 넣어** `livePage.screens.ended.survey` 를 읽고 있었다.
   * 실제 저장 형태에 screens 층은 없다(normalizeLivePageConfig 가 `lp.ended` 를 읽는다) —
   * 그래서 이 값은 구조적으로 항상 false 였고, 설문 탭의 "종료 화면 설문 영역이 꺼져 있어요"
   * 경고가 **토글과 무관하게 늘** 떠 있었다(실 데이터 확인: livePage 최상위 키에 ended 가 있고
   * ended.survey=true 인 웨비나에서도 false).
   *
   * 그래서 손파싱을 버리고 정규화 함수를 쓴다 — 경로 지식이 한 곳(webinar-config.ts)에만 있게.
   */
  const endedSurveyAreaOn = normalizeLivePageConfig(webinar.config ?? {}).ended.survey;


  /**
   * 미리보기 패널 열림 — 레이아웃 취향이라 세션 간 유지한다(매번 다시 열게 하면 성가시다).
   * 기본은 열림: AGENTS §2 가 요구하는 상태가 기본이어야 한다.
   */
  const [previewOpen, setPreviewOpen] = useState(true);
  /**
   * 노출 점검에서는 패널을 아예 렌더하지 않는다 — 미리볼 실물이 없는데 44% 를 차지하면
   * 표가 530px 로 눌려 매트릭스가 잘린다. **이 자리를 레일 칸으로 고른 이유가 전체 폭이다**
   * (미리보기 패널 안의 탭으로 넣는 안을 기각한 근거이기도 하다).
   * previewOpen 자체는 건드리지 않는다 — 다른 섹션으로 돌아가면 사용자의 선택이 그대로 살아 있게.
   */
  const showPreview = previewOpen && section !== "check";
  useEffect(() => {
    const saved = typeof window !== "undefined" && window.localStorage.getItem("mach:setupPreview");
    if (saved === "0") setPreviewOpen(false);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("mach:setupPreview", previewOpen ? "1" : "0");
  }, [previewOpen]);

  /**
   * 레일 상태 점 — IA 문서의 `.sd`(pub / priv / off).
   *
   * 문서는 원본 정보에도 점을 주지만 여기서는 주지 않는다 — 원본은 **공개 면이 아니다**
   * (문서 스스로 "네 산출물이 읽어가는 사실 한 벌" 이라고 쓴다). 산출물만 점을 갖는다.
   *
   * 점이 답하는 질문: **지금 시청자가 이 면에 닿을 수 있는가.**
   *   공개   — 누구나 닿는다(랜딩, 접수 중인 등록 폼, 열린 설문)
   *   등록자 — 등록한 사람만(시청 화면)
   *   미사용 — 아직 없거나 닫혔다(설문 0개, 접수 마감)
   * 판정 근거는 전부 실제 데이터다. 모르는 값은 점을 안 그린다(추측한 점이 더 나쁘다).
   * canRegister 는 page.tsx 의 resolveWebinarStatus 가 준 값 — 여기서 다시 계산하지 않는다.
   */
  const surfaceState = (id: PageSetupSection): "public" | "registrant" | "off" | null => {
    // 공개 면이 아닌 칸은 점을 안 그린다 — 원본 정보는 사실 한 벌, 노출 점검은 거울이다.
    if (id === "source" || id === "check") return null;
    if (id === "survey") return hasOpenSurvey === null ? null : hasOpenSurvey ? "public" : "off";
    // 랜딩 → 면 하나, 등록 폼 → 면 하나, 시청 화면 → 세 면(대기·입장·시청·종료)의 대표.
    const key = id === "landing" ? "landing" : id === "registration" ? "signup" : "live";
    const s = exposure.surfaces.find((x) => x.id === key);
    if (!s || s.use === "unknown") return null;        // 모르는 값은 점을 안 그린다
    if (s.use === "off") return "off";
    return s.audience === "등록자" ? "registrant" : "public";
  };
  const DOT: Record<"public" | "registrant" | "off", { cls: string; label: string }> = {
    public: { cls: "bg-emerald-500", label: "공개 중" },
    /**
     * 시청 화면 점의 라벨 — 면 단위로는 대기·입장·종료가 누구나 닿으므로 '등록자만' 은
     * 통째로는 거짓이다. 그래도 색은 유지한다(영상이 실제 제약이라 구분할 값이 있다).
     * 대신 문자열로 그 범위를 좁혀 말한다 — 색 어휘를 늘리는 대신 라벨을 정확히 한다.
     */
    registrant: { cls: "bg-violet-500", label: "공개 중 — 영상은 입장 확인 뒤" },
    // 미사용은 채우지 않는다 — 색으로만 구분하면 색각에서 '있음/없음' 이 안 갈린다
    off: { cls: "bg-transparent shadow-[inset_0_0_0_1.5px_var(--border)]", label: "사용 안 함" },
  };

  /**
   * 노출 리포트 — 레일 점과 노출 점검 표가 **같은 판정**을 읽는다.
   * 예전엔 레일 점이 자기 switch 문으로 랜딩을 무조건 "공개 중" 이라 그렸다(랜딩이 꺼져
   * 있어도 초록). 점이 답한다고 선언한 질문에 거짓을 말한 셈이라 판정을 순수 모듈로 옮겼다.
   */
  const exposure = useMemo(
    () => buildExposureReport({
      name: webinar.name, description: webinar.description, slug: webinar.slug,
      liveStartAt: webinar.liveStartAt, theme: webinar.theme, config: webinar.config,
      components: webinar.components, sessions: webinar.sessions,
      // 상태를 반드시 넘긴다 — 빠지면 랜딩 CTA 판정이 '등록중' 을 가정한다.
      status: isEnded ? "ended" : isLive ? "live" : undefined,
      entryOpen: isLive, canRegister,
      hasOpenSurvey, hasLinkedEndedSurvey,
    }),
    [webinar, isEnded, isLive, canRegister, hasOpenSurvey, hasLinkedEndedSurvey],
  );

  /**
   * 준비 상태 — 이제 **노출 리포트에서 파생**한다(webinar-readiness.ts 주석에 근거).
   *
   * 예전엔 여기서 checkWebinarReadiness 를 따로 불렀고, 그 함수가 config 를 다시 읽어
   * 자기 게이트 식을 갖고 있었다. 두 판정기가 갈린 자리마다 준비 상태가 틀린 쪽이었다 —
   * 특히 아젠다 세션 개수를 실제 세션만 세어(여기서 filter(isRealSession) 로 넘겼다)
   * 오프닝·Q&A 만 있는 웨비나에 "사라져요" 라는 거짓 경고를 냈다. 뷰어는 전체 행으로 그린다.
   */
  const issues = useMemo(() => readinessFromExposure(exposure), [exposure]);
  const issuesBySection = useMemo(() => readinessBySection(issues), [issues]);

  const activeMeta = sections.find((item) => item.id === section) ?? sections[0];
  const ActiveIcon = activeMeta.icon;

  // 라이브 중일 때만 요청한다 — 준비 중에는 폴러가 아예 돌지 않는다.
  // isLive 는 optional prop 이라 undefined 를 false 로 접는다(모를 때는 "라이브 아님" 취급).
  const liveViewers = useLiveViewers(webinar.id, isLive === true);
  // 라이브 중 "끄는" 스위치에만 확인을 붙인다(켜는 건 시청자에게 더 주는 변경이라 사고가 아니다).
  const confirmLiveOff = useLiveOffGuard(isLive === true, liveViewers);

  // 폼 탭은 자동저장이라 미저장 가드가 필요 없다 — 섹션 전환은 즉시(대기 중 저장은 각 탭이 언마운트 시 flush).
  const changeSection = (id: PageSetupSection) => {
    if (id === section) return;
    onSectionChange(id);
  };

  return (
    <AutosaveScope>
    <div className="flex min-h-0 flex-col lg:h-full lg:overflow-hidden">
    {/**
     * 방송 띠 — 라이브 중에는 이 화면의 자동저장이 **시청자에게 즉시 반영**된다.
     * 평소와 똑같이 보이면 운영자는 그 사실을 모른 채 문구를 고친다. 순수 표시(저장 없음).
     *
     * 사람 수를 함께 적는 이유: "바로 반영돼요" 는 규칙이고 "12명이 보고 있어요" 는 사실이다.
     * 규칙은 읽고 넘기지만 사실은 손을 멈추게 한다. 숫자를 못 가져와도 문구는 그대로 유효하다.
     */}
    {isLive && (
      <div
        role="status"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-destructive px-4 py-2 text-xs text-white dark:text-[oklch(0.205_0_0)] sm:px-6 lg:px-8"
      >
        <span className="inline-flex items-center gap-1.5 font-semibold tracking-wide">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
          ON AIR
        </span>
        {liveViewers !== null && (
          <span className="font-semibold tabular-nums">시청자 {liveViewers.toLocaleString()}명</span>
        )}
        <span className="opacity-90">지금 고치는 값은 시청자 화면에 바로 반영돼요.</span>
      </div>
    )}
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:overflow-hidden">
      <aside className="border-b lg:border-r border-border bg-secondary p-4 lg:p-5">
        <div className="mb-5">
          <h2 className="text-sm font-semibold">만들기</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            외부 페이지와 운영 기본값을 정리합니다.
          </p>
        </div>
        {/**
         * 준비 상태 — 완성도 점수가 아니다. "켜 놨는데 내용이 없어서 시청자 화면에서 조용히
         * 사라지는 것"만 모은다. 조용히 사라지는 게 문제인 이유: 운영자는 켰다고 믿는다.
         * 순수 읽기 — 여기서 저장하는 것은 없다.
         */}
        {issues.length > 0 && (
          <div className={`mb-4 bg-card p-3 ${R.surface} ${FINISH.s1}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold">확인할 것</span>
              <span className="text-[11px] font-semibold tabular-nums text-amber-700 dark:text-amber-400">{issues.length}건</span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {issues.slice(0, 4).map((it, i) => (
                <li key={`${it.section}-${i}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onSectionChange(it.section as PageSetupSection);
                      if (it.watchState) onWatchStateChange(it.watchState);
                    }}
                    className="block w-full text-left text-[11px] leading-snug text-muted-foreground transition-colors hover:text-foreground"
                    title={it.detail}
                  >
                    <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${it.severity === "blocking" ? "bg-destructive" : "bg-amber-500"}`} aria-hidden />
                    {it.title}
                  </button>
                </li>
              ))}
            </ul>
            {/* 예전엔 p 태그라 눌러도 아무 일이 없었다 — 전체를 볼 화면이 코드에 없었기 때문이다.
                이제 목적지가 있으니 링크로 만든다. 4건 이하일 때도 표로 가는 길은 열어 둔다. */}
            <p className="mt-1.5 text-[10.5px] text-muted-foreground/70">
              {issues.length > 4 && <>그리고 {issues.length - 4}건 더 · </>}
              <JumpLink onClick={() => onSectionChange("check")}>전체 노출 점검</JumpLink>
            </p>
            <p className="mt-2 border-t border-border pt-2 text-[10.5px] leading-relaxed text-muted-foreground/70">
              완성도가 아니라 <b className="font-semibold">켜져 있는데 내용이 없는 것</b>만 봐요.
            </p>
          </div>
        )}

        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0 lg:space-y-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((item, i) => {
            const Icon = item.icon;
            const active = item.id === section;
            // 묶음이 바뀌는 첫 항목 앞에만 라벨을 넣는다 — 데스크톱에서만(모바일은 가로 스크롤 한 줄).
            const groupStart = i === 0 || sections[i - 1].group !== item.group;

            return (
              // Fragment 라 DOM 노드를 만들지 않는다 — 라벨과 버튼이 nav 의 **직접 자식**이 되어야
              // lg:space-y-1 이 먹는다. 래퍼 div 에 display:contents 를 주면 박스가 없어서
              // space-y 의 margin-top 이 적용되지 않고 항목 간격이 사라진다.
              <Fragment key={item.id}>
              {groupStart && (
                <p className={`hidden px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/70 lg:block ${i === 0 ? "pt-0" : "pt-3"}`}>
                  {item.group}
                </p>
              )}
              <motion.button
                type="button"
                onClick={() => changeSection(item.id)}
                whileTap={{ scale: 0.98 }}
                className={`relative flex w-auto lg:w-full shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm whitespace-nowrap transition-colors ${
                  active ? SELECTED_TEXT : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="page-setup-section-bg"
                    className={`absolute inset-0 ${R.surface} ${SELECTED_SURFACE}`}
                    transition={{ type: "spring", stiffness: 420, damping: 30 }}
                    style={{ zIndex: 0 }}
                  />
                )}
                <Icon className="relative z-10 h-4 w-4 shrink-0" />
                <span className="relative z-10">{item.label}</span>
                {(() => {
                  const st = surfaceState(item.id);
                  if (!st) return null;
                  const d = DOT[st];
                  // 점만으로 상태를 말하지 않는다 — title 로 문자열도 준다(색각·스크린리더)
                  return (
                    <span
                      className={`relative z-10 h-1.5 w-1.5 shrink-0 rounded-full ${d.cls}`}
                      title={`${item.label} — ${d.label}`}
                      aria-label={`${item.label} ${d.label}`}
                      role="img"
                    />
                  );
                })()}
                {/* 미완 개수 — 색만으로 알리지 않고 숫자를 함께 둔다(색각·흑백 출력) */}
                {/* 노출 점검 칸에는 배지를 달지 않는다 — 달면 운영자가 'check 7' 과 'watch 3' 을
                    10건으로 읽는다. 총계는 표 안에서 한 줄로만 말한다. */}
                {item.id !== "check" && issuesBySection[item.id as ReadinessSection] > 0 && (
                  <span
                    className="relative z-10 ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-700 dark:text-amber-400"
                    title={`이 섹션에 확인할 것 ${issuesBySection[item.id as ReadinessSection]}건`}
                  >
                    {issuesBySection[item.id as ReadinessSection]}
                  </span>
                )}
              </motion.button>
              </Fragment>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 min-h-0 flex flex-col lg:overflow-hidden">
        <div className="shrink-0 border-b border-border px-4 sm:px-6 lg:px-8 py-4 lg:py-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={section}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.18 }}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center gap-2">
                  <ActiveIcon className="h-[18px] w-[18px] text-violet-500" />
                  <h2 className="text-base font-semibold tracking-tight">{activeMeta.label}</h2>
                </div>
                {/* 만들기 화면당 자동저장 표시 1개 — 각 편집 영역이 useReportAutosave 로 올려 보낸다.
                    긴 화면에서 표시가 스크롤 밖으로 밀려 "저장됐나?" 를 알 수 없던 문제를 없앤다. */}
                <span className="ml-auto shrink-0">
                  <AggregateAutosaveIndicator />
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{activeMeta.desc}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/**
         * 폼 + 인접 미리보기 2단.
         *
         * 로그인해서 실제 화면을 보고 나서 고친 것 — 폼이 max-w-2xl(약 490px)인데 이 영역이
         * 1050px 이라 **오른쪽 절반이 빈 흰 공간**이었다. AGENTS §2 는 고치는 영역에
         * "자동저장 + 인접 실시간 미리보기" 를 요구하는데 미리보기가 링크 하나였다.
         * 두 문제가 같은 자리에서 해결된다.
         *
         * 미리보기를 접으면 1단으로 돌아간다 — 넓은 폼이 필요한 작업(진행 순서 표 편집 등)을
         * 막지 않는다. lg 미만에서는 패널을 아예 렌더하지 않는다(폭이 없다).
         */}
        <div
          className={`relative min-h-0 flex-1 lg:overflow-hidden ${
            showPreview ? "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,44%)]" : ""
          }`}
        >
        {/**
         * `lg:h-full` 이 **없으면 미리보기를 끈 상태에서 스크롤이 죽는다.**
         *
         * 부모(위 div)는 미리보기가 켜져 있을 때만 lg:grid 다. 그때는 이 요소가 그리드 아이템이라
         * 늘어나서 높이가 정해지고, 안쪽 `h-full` → `lg:h-full overflow-auto` 사슬이 성립한다.
         * 미리보기를 끄면(그리고 노출 점검 섹션은 항상 끈다) 부모가 그냥 블록이 되어 이 요소의
         * 높이가 auto 로 풀리고, 그러면 스크롤러의 `h-full` 도 auto → **뷰포트가 없어 스크롤이
         * 생기지 않는다.** 그런데 부모에 lg:overflow-hidden 이 있어서 넘친 내용은 잘린다 —
         * 즉 아래쪽을 볼 방법이 사라진다. 실측(재현 하니스): inner 높이 1944px(=내용 높이),
         * scrollHeight === clientHeight, scrollTop 이 0 에서 움직이지 않음.
         *
         * flex-1 인 부모는 높이가 정해져 있으니 여기서 100% 를 잡으면 두 경우 모두 성립한다
         * (그리드일 때도 height:100% 는 그리드 영역 기준이라 안전).
         */}
        <div className="min-h-0 lg:h-full lg:overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={section}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
              className="h-full"
            >
              {section === "source" && (
                <div className="lg:h-full overflow-auto">
                  <SourceInfoTab webinar={webinar} onUpdate={onUpdate} onSilentUpdate={onSilentUpdate} />
                </div>
              )}
              {section === "landing" && (
                <div className="lg:h-full overflow-auto">
                  <LandingPageTab
                    webinar={{ id: webinar.id, slug: webinar.slug, name: webinar.name, description: webinar.description, config: webinar.config, liveStartAt: webinar.liveStartAt }}
                    onSilentUpdate={onSilentUpdate}
                    onGoToSource={() => onSectionChange("source")}
                    onGoToDeploy={onJumpToTab ? () => onJumpToTab("deploy") : undefined}
                    confirmLiveOff={confirmLiveOff}
                  />
                </div>
              )}
              {section === "registration" && (
                <div className="lg:h-full overflow-auto">
                  <RegistrationFormTab
                    webinar={{
                      id: webinar.id, slug: webinar.slug, config: webinar.config, theme: webinar.theme,
                      // 접수 창(마감·라이브 중 접수)이 이 탭으로 옮겨와 일정·components 가 필요하다.
                      // liveEndAt 은 마감 > 종료 조합을 제출 전에 인라인으로 막는 데 쓴다(안 넘기면
                      // 그 검증이 죽은 코드로 남는다 — 서버 400 은 여전히 뜨지만 이유는 안 보인다).
                      liveStartAt: webinar.liveStartAt, liveEndAt: webinar.liveEndAt, signupDeadline: webinar.signupDeadline, components: webinar.components,
                      workspace: webinar.workspace,
                    }}
                    onSilentUpdate={onSilentUpdate}
                    confirmLiveOff={confirmLiveOff}
                  />
                </div>
              )}
              {section === "watch" && (
                <div className="lg:h-full overflow-auto">
                  <LivePageTab
                    webinar={webinar}
                    slug={webinar.slug}
                    state={watchState}
                    onStateChange={onWatchStateChange}
                    onSilentUpdate={onSilentUpdate}
                    // 안내 문구를 누를 수 있게 — 목적지가 만들기 안이면 섹션 전환,
                    // 다른 탭이면 껍데기의 navigate. 문구가 말하는 곳으로 실제로 데려간다.
                    onGoToSurvey={() => onSectionChange("survey")}
                    onGoToConsole={onJumpToTab ? () => onJumpToTab("operate", "console") : undefined}
                    confirmLiveOff={confirmLiveOff}
                  />
                </div>
              )}
              {section === "check" && (
                <div className="lg:h-full overflow-auto">
                  <ExposureTab
                    report={exposure}
                    onGoToSection={(owner) => onSectionChange(owner as PageSetupSection)}
                    onGoToWatchState={(st) => { onSectionChange("watch"); onWatchStateChange(st); }}
                  />
                </div>
              )}
              {section === "survey" && (
                <div className="lg:h-full overflow-auto">
                  <SurveyTab
                    webinarId={webinar.id}
                    slug={webinar.slug}
                    webinarName={webinar.name}
                    theme={webinar.theme}
                    // '종료 화면에 연결' 을 켜도 이 영역이 꺼져 있으면 시청자에게 안 보인다 —
                    // 설문 탭이 그 사실을 알리고 고칠 자리로 보낼 수 있게 상태와 이동을 넘긴다.
                    endedSurveyAreaOn={endedSurveyAreaOn}
                    onGoToEndedScreen={() => {
                      onSectionChange("watch");
                      onWatchStateChange("ended");
                    }}
                  />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 노출 점검에서는 패널 자체를 렌더하지 않는다 — 위 showPreview 주석 참고. */}
        {section !== "check" && (
          <SetupPreview
            section={section}
            slug={webinar.slug}
            watchState={watchState}
            open={previewOpen}
            onOpenChange={setPreviewOpen}
          />
        )}
        </div>
      </div>
    </div>
    </div>
    </AutosaveScope>
  );
}
