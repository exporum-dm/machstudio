/**
 * 랜딩 마운트 — 단독 페이지 / 어드민 미리보기 / 외부 사이트(아임웹) 임베드가 모두 이 함수를 탄다.
 *
 * 뷰 모듈들은 "그리기"만 하고, 문서 단위 관심사는 전부 여기서 소유한다:
 *  - 공개 게이트(비공개 랜딩이 외부 사이트에 새지 않게)
 *  - .lnd 루트 + 키컬러 변수 + 스타일/폰트 주입
 *  - 섹션별 배경 모드(data-bg) + 같은 모드가 연달아 올 때의 지브라(data-band)
 *  - 모달 수명주기: body 직계 레이어 포털 + 스크롤 잠금 + 포커스 트랩 + ESC
 *  - 목차: 별도 body 직계 레이어 포털 + 랜딩 이탈 시 감춤 (fixed 가 호스트 조상에 안 걸리게)
 *  - 부분 재렌더(FAQ 탭) 후 reveal 재관찰
 *  - destroy(): 붙인 것 전부 원복 (호스트 문서를 더럽힌 채 떠나지 않는다)
 */

import { LANDING_CSS } from "./css";
import { buildLandingModel } from "./build-model";
import { h, clearNode } from "@/lib/dom/h";
import { renderHero, renderToc, scrollToSectionIn } from "./view-hero";
import { renderIntro, renderAudience, renderPrograms, renderHighlights, renderJoin, renderFaq, renderSponsors } from "./view-sections";
import { renderSessions, renderTimetable, createSessionDialog } from "./view-sessions";
import { attachAccordion, attachReveal, attachAccentZone, attachTocSpy, attachTocVisibility } from "./effects";
import { acquireLayer, createTocLayer, releaseLayer, lockScroll, unlockScroll, trapFocus } from "./overlay";
import type { LandingSession, LandingWebinar } from "./types";
import { IMAGE_PRESETS, transformedImageUrl } from "@/lib/webinar-image";
import { paperFor } from "@/lib/color";

const STYLE_ID = "lnd-css";
const FONT_ID = "lnd-font";
const FONT_HREF =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

/**
 * uid 카운터는 **문서 전역**에 둔다. 임베드는 소비처마다 별도 IIFE 번들이라 모듈 스코프
 * 변수가 각자 0 에서 시작해, 랜딩 2개를 붙이면 둘 다 uid="lnd1" 을 받았다.
 * 그러면 섹션 id·aria-labelledby 가 중복되고 모달 레이어(uid 셀렉터)를 공유해 키컬러가 섞인다.
 */
function nextUid(): string {
  const w = globalThis as typeof globalThis & { __machLandingUid?: number };
  w.__machLandingUid = (w.__machLandingUid ?? 0) + 1;
  return `lnd${w.__machLandingUid}`;
}

export interface MountLandingOptions {
  mount: HTMLElement;
  webinar: LandingWebinar;
  embedded: boolean;
  isPreview: boolean;
  /** 임베드는 호스트 도메인이 달라 상대경로가 깨진다 → 절대 URL 생성용. */
  origin?: string;
  /** 레거시 iframe 임베드 경로에서만 true — 히어로 높이를 --lnd-vh 로 잡는다. */
  legacyIframe?: boolean;
}

export interface LandingHandle {
  destroy(): void;
}

/** 스타일은 문서당 1회. 여러 랜딩이 붙어도 한 벌만 쓴다. */
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = LANDING_CSS;
  document.head.appendChild(style);
}

/**
 * 히어로 이미지를 DOM 조립보다 먼저 받기 시작한다.
 * 임베드는 페이로드가 스크립트에 실려 와 URL 을 즉시 알 수 있으므로, 트리를 다 만든 뒤
 * <img> 가 붙기를 기다릴 이유가 없다. 첫 화면에서 배경이 비어 보이는 시간을 줄인다.
 */
function preloadHeroImage(url: string): void {
  if (document.querySelector(`link[rel="preload"][href="${CSS.escape(url)}"]`)) return;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = url;
  link.setAttribute("fetchpriority", "high");
  document.head.appendChild(link);
}

/** Pretendard — 호스트가 이미 로드했을 수 있으니 중복 주입만 피한다. */
function ensureFont(): void {
  if (document.getElementById(FONT_ID)) return;
  const link = document.createElement("link");
  link.id = FONT_ID;
  link.rel = "stylesheet";
  link.href = FONT_HREF;
  document.head.appendChild(link);
}



export function mountLanding(opts: MountLandingOptions): LandingHandle {
  const { mount, webinar, embedded, isPreview } = opts;
  const uid = nextUid();

  ensureStyles();
  ensureFont();

  const m = buildLandingModel(webinar, { uid, embedded, isPreview, origin: opts.origin });

  // 장식 링을 안 그리는 대신(첫 화면 교체 방지) 이미지가 최대한 빨리 오게 한다.
  // preload 는 렌더와 **똑같은 URL** 이어야 한다 — 파라미터가 다르면 브라우저가 별개 리소스로
  // 보고 같은 이미지를 두 번 받는다(egress 2배 + preload 경고).
  if (m.lp.heroMedia?.type === "image" && m.lp.heroMedia.url) {
    preloadHeroImage(transformedImageUrl(m.lp.heroMedia.url, IMAGE_PRESETS.heroBackground));
  }

  const root = h("div", {
    class: `lnd${embedded ? " embedded" : ""}`,
    lang: "ko",
    style: {
      "--primary": m.accent,
      "--on-primary": m.onPrimary,
      // 배경 키컬러 두 개 — 나머지 색(선·카드)은 CSS 가 이 둘에서 파생한다.
      "--bg-light": m.lp.colors.lightBg,
      "--bg-dark": m.lp.colors.darkBg,
      // 글자색은 각 배경의 휘도에서 정한다(paperFor) — 운영자가 모드에 어긋난 색을
      // 골라도 읽히게. CSS 의 모드 블록이 이 두 변수를 --paper 로 집어간다.
      "--paper-light": paperFor(m.lp.colors.lightBg),
      "--paper-dark": paperFor(m.lp.colors.darkBg),
      // 히어로 커스텀 — 배경 스크림 세기(0~100 → 0~1 배율)와 대형 타이틀 자간(%).
      "--lnd-hero-overlay": String(m.lp.heroOverlayOpacity / 100),
      "--lnd-hero-tracking": String(m.lp.heroTitleTracking),
    },
    // 루트 모드 = 세션·타임테이블 구간의 바탕. 그 구간은 자기 배경을 칠하면
    // 키컬러 전환(.on-accent)이 가려지므로 루트가 칠한다.
    "data-bg": m.lp.sectionBg.sessions,
  });
  if (opts.legacyIframe) root.setAttribute("data-legacy-iframe", "");

  // 공개 게이트 — 미공개 랜딩이 외부 사이트에 그대로 노출되면 안 된다.
  if (!m.lp.enabled && !isPreview) {
    root.appendChild(
      h(
        "div",
        { style: { minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--muted)", padding: "24px", textAlign: "center" } },
        "아직 공개되지 않은 페이지예요.",
      ),
    );
    clearNode(mount);
    mount.appendChild(root);
    return { destroy: () => root.remove() };
  }

  if (!m.lp.enabled && isPreview) {
    root.appendChild(h("div", { class: "preview-badge" }, "비공개 상태 · 미리보기"));
  }

  const cleanups: Array<() => void> = [];

  // ── 모달 ──────────────────────────────────────────────────────────────
  let closeActive: (() => void) | null = null;

  const openSession = (session: LandingSession, opener: HTMLElement) => {
    closeActive?.();
    const layer = acquireLayer(uid);
    // 레이어는 body 직계라 루트의 인라인 키컬러 변수를 못 받는다 → 여기서 다시 심는다.
    layer.style.setProperty("--primary", m.accent);
    layer.style.setProperty("--on-primary", m.onPrimary);

    const close = () => {
      closeActive = null;
      document.removeEventListener("keydown", onKey, true);
      releaseTrap();
      unlockScroll();
      dialog.remove();
      releaseLayer(uid);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };

    const dialog = createSessionDialog(m, session, { onClose: () => close() });
    layer.appendChild(dialog);
    lockScroll();
    document.addEventListener("keydown", onKey, true);
    const releaseTrap = trapFocus(dialog, opener);
    dialog.querySelector<HTMLElement>("[data-ms-modal-close]")?.focus();
    closeActive = close;
  };
  cleanups.push(() => closeActive?.());

  // ── 본문 조립 ─────────────────────────────────────────────────────────
  // 임베드에선 호스트에 이미 <main> 이 있으므로 랜드마크를 중복시키지 않는다.
  const body = h(embedded ? "div" : "main", null);

  /**
   * 섹션 배경 모드 — 섹션마다 `data-bg` 를 붙인다. 예전에는 `.dark-zone` 래퍼 하나가
   * Programs~FAQ 를 덮었고, 그래서 그 밖의 섹션은 자기 배경이 없어 키컬러 전환이 켜지는
   * 동안 키컬러가 그대로 비쳤다("이런 분들께" 를 존 안으로 옮겨야 했던 이유). 이제 각
   * 섹션이 자기 배경을 칠하므로 그 제약이 없고, 배치는 순서만 따른다.
   *
   * 지브라는 `nth-of-type` 이 아니라 여기서 계산한다 — 라이트와 다크가 섞이면 순서 기반
   * 교대는 무작위로 보인다. **같은 모드가 연달아 올 때만** 한 칸씩 톤을 낮춘다.
   */
  let prevMode: string | null = null;
  let runIndex = 0;
  /**
   * inRun: 지브라 교대에 참여하는가. 히어로는 **참여하지 않는다** — 화면을 꽉 채우고
   * 자기 배경 처리(원형 장식·미디어 스크림)를 따로 갖는 면이라 띠의 짝이 아니다.
   * 참여시켰더니 기본값(전부 다크)에서 히어로가 run 0 을 먹고 About 이 run 1 → 밴드를
   * 받아, 예전에 #000 이던 About 이 rgb(20,22,28) 로 밝아졌다(실측). 교대는 About 부터 센다.
   */
  const paintBg = (el: HTMLElement, key: keyof typeof m.lp.sectionBg, inRun = true): HTMLElement => {
    const mode = m.lp.sectionBg[key];
    el.setAttribute("data-bg", mode);
    if (!inRun) return el;
    if (mode === prevMode) runIndex += 1;
    else {
      runIndex = 0;
      prevMode = mode;
    }
    if (runIndex % 2 === 1) el.setAttribute("data-band", "alt");
    else el.removeAttribute("data-band");
    return el;
  };

  body.appendChild(paintBg(renderHero(m), "hero", false));
  const intro = renderIntro(m);
  if (intro) body.appendChild(paintBg(intro, "intro"));
  // 세션·타임테이블은 data-bg 를 받지 않는다 — 루트가 칠한다(위 root 주석).
  const sessions = renderSessions(m, openSession);
  if (sessions) body.appendChild(sessions);
  const timetable = renderTimetable(m);
  if (timetable) body.appendChild(timetable);
  // 두 섹션이 지브라 흐름을 끊는다(자기 배경이 없으므로 교대 대상이 아니다).
  if (sessions || timetable) {
    prevMode = null;
    runIndex = 0;
  }

  const programs = renderPrograms(m);
  if (programs) body.appendChild(paintBg(programs, "programs"));
  /**
   * "이런 분들께 추천합니다" 가 혜택보다 **앞**이다.
   *
   * 두 섹션의 역할이 다르다 — Audience 는 조건("~하고 싶은 기업")이고 혜택은 보상("얻어가는 것")이다.
   * 조건으로 걸러낸 다음 보상을 제시하는 게 순서다: 자기 얘기가 아니라고 판단한 사람에게 혜택을
   * 읽히는 건 낭비고, 자기 얘기라고 확인한 사람에게는 그 직후 보상이 가장 세게 박힌다.
   *
   * (예전에는 Audience 가 Join 바로 위였다 — "참여 방법을 읽기 직전에 내 얘기인가를 한 번 더
   * 확인시킨다" 는 근거였다. 그것도 일리가 있었지만, 마지막 자리는 더 강한 설득인 혜택에 준다.)
   */
  const audience = renderAudience(m);
  if (audience) body.appendChild(paintBg(audience, "audience"));
  /* 혜택은 자기 배경을 칠하고 지브라 교대에 참여한다 — Audience·Join 과 같은 규칙이라
     세 섹션의 색 경계가 순서대로 읽힌다. */
  const highlights = renderHighlights(m);
  if (highlights) body.appendChild(paintBg(highlights, "highlights"));
  const join = renderJoin(m);
  if (join) body.appendChild(paintBg(join, "join"));

  // FAQ 는 카테고리 탭 상태가 있어 부분 재렌더된다.
  // 배경 모드·지브라는 **재렌더마다 다시 붙여야 한다** — 노드가 새로 만들어지므로
  // 한 번만 붙이면 카테고리를 누른 순간 배경이 사라진다. 그래서 값을 미리 굳혀 둔다.
  const faqMode = m.lp.sectionBg.faq;
  const faqBand = faqMode === prevMode && runIndex % 2 === 0;
  let faqCategory: string | null = null;
  const faqSlot = h("div", null);
  /**
   * 목차 스크롤 스파이 재부착 훅. paintFaq() 는 카테고리를 바꿀 때마다 FAQ 섹션 노드를
   * 통째로 새로 만든다 — attachTocSpy 가 부착 시점에 찾아 둔 옛 노드는 DOM 에서 떨어져 나가
   * 다시는 교차하지 않으므로, 그 순간부터 목차 활성 표시·배경 모드 판정이 FAQ 구간에서 멈춘다.
   * 배경·지브라(faqMode/faqBand)를 재렌더마다 다시 붙이는 것과 같은 이유·같은 자리다.
   * toc 부착이 끝나는 "이펙트" 구간에서 실제 함수가 채워진다 — 첫 렌더(paintFaq() 최초 호출)는
   * toc 가 아직 없어 필요 없고, 카테고리를 눌러 재렌더될 때는 이미 채워져 있다(전체 마운트가
   * 끝난 뒤에야 사용자가 누를 수 있으므로).
   */
  let onFaqRerender: (() => void) | null = null;
  const paintFaq = () => {
    clearNode(faqSlot);
    const faq = renderFaq(m, {
      activeCategory: faqCategory,
      onSelectCategory: (c) => {
        faqCategory = c;
        paintFaq();
        // 새로 생긴 .rv 노드는 관찰 대상이 아니므로 즉시 노출시킨다
        // (안 그러면 translateY(12px) 상태로 굳는다).
        faqSlot.querySelectorAll(".rv").forEach((el) => el.classList.add("in"));
        onFaqRerender?.();
      },
    });
    if (faq) {
      faq.setAttribute("data-bg", faqMode);
      if (faqBand) faq.setAttribute("data-band", "alt");
      faqSlot.appendChild(faq);
    }
  };
  paintFaq();
  body.appendChild(faqSlot);
  /**
   * FAQ 는 슬롯 안에서 직접 칠하므로 지브라 상태(prevMode/runIndex)가 자동으로 넘어가지 않는다.
   * 여기서 손으로 이어 준다 — 안 하면 바로 아래 스폰서가 FAQ 를 못 보고 Join 까지의 흐름만
   * 이어받아, FAQ 와 같은 모드인데도 띠가 안 생겨 두 섹션이 한 덩어리로 붙어 보인다.
   */
  if (faqSlot.firstChild) {
    if (faqMode === prevMode) runIndex += 1;
    else {
      runIndex = 0;
      prevMode = faqMode;
    }
  }

  // 스폰서는 최하단 — FAQ 다음이 페이지의 끝이다.
  const sponsors = renderSponsors(m);
  if (sponsors) body.appendChild(paintBg(sponsors, "sponsors"));

  // 목차는 body 직계 전용 레이어로 포털한다. 지금 아임웹에는 fixed 를 가로채는 조상이 없지만
  // (실측: transform/filter/contain 조상 0개), 호스트가 섹션 애니메이션을 켜면 조상에 transform 이
  // 생겨 목차가 조용히 엉뚱한 곳에 떠 버린다. 모달과 같은 방식으로 미리 격리해 둔다.
  // 포털하면 closest('.lnd') 가 레이어를 가리켜 섹션을 못 찾으므로 onNavigate 로 실제 루트를 넘긴다.
  const toc = renderToc(m, (fullId) => scrollToSectionIn(root, fullId));
  let tocLayer: HTMLElement | null = null;
  if (toc) {
    tocLayer = createTocLayer(uid, m.accent, m.onPrimary, m.lp.colors.lightBg, m.lp.colors.darkBg);
    tocLayer.appendChild(toc);
    // root.remove() 로는 안 지워진다(루트 밖에 있다) → 명시적으로 정리.
    cleanups.push(() => {
      toc.remove();
      tocLayer?.remove();
    });
  }
  root.appendChild(body);

  clearNode(mount);
  mount.appendChild(root);

  // ── 호스트 크롬(헤더) 높이 보정 ───────────────────────────────────────
  // 임베드는 호스트 헤더 아래에서 시작하는데 히어로가 100svh 면 바닥의 일시·CTA 가 헤더 높이만큼
  // 화면 밖으로 밀린다(실측: 아임웹 헤더 130px → CTA 가 fold 아래).
  // 단독 페이지는 마운트가 문서 최상단이라 자연히 0 → 기존 동작 그대로.
  // 마운트의 **문서상 절대 Y** 를 쓴다(뷰포트 상대 top + 현재 스크롤). 스크롤 위치와 무관하게
  // 항상 같은 값이 나오므로, 사용자가 스크롤한 상태에서 창을 최대화해도 정확히 재측정된다.
  // (뷰포트 상대 top 만 쓰고 "최상단일 때만 갱신" 가드를 두면, 스크롤 중 리사이즈가 통째로
  //  건너뛰어져 낡은 값이 남는다 — 실제로 창 최대화 시 히어로 하단이 잘리는 버그였다.)
  const applyTopInset = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const absTop = mount.getBoundingClientRect().top + scrollTop;
    const top = Math.max(0, Math.min(240, Math.round(absTop)));
    root.style.setProperty("--lnd-topinset", `${top}px`);
  };
  applyTopInset();
  // 동기로 즉시 반영한다. requestAnimationFrame 으로만 미루면 rAF 가 스로틀되는 상황
  // (백그라운드 탭·절전·일부 자동화 환경)에서 재측정이 통째로 유실된다 — 실제로 그렇게 재현됐다.
  // resize/ResizeObserver 는 이미 레이아웃 이후에 오므로 여기서 바로 재도 정확하다.
  window.addEventListener("resize", applyTopInset);
  window.addEventListener("orientationchange", applyTopInset);
  // 창 크기 변화 없이 호스트 헤더만 다시 접히는 경우(반응형 내비 등)도 잡는다.
  const insetRo = typeof ResizeObserver !== "undefined" ? new ResizeObserver(applyTopInset) : null;
  insetRo?.observe(document.body);
  cleanups.push(() => {
    window.removeEventListener("resize", applyTopInset);
    window.removeEventListener("orientationchange", applyTopInset);
    insetRo?.disconnect();
  });

  // ── 이펙트 ────────────────────────────────────────────────────────────
  cleanups.push(attachReveal(root));
  // 타임테이블·FAQ 아코디언 모션. 재렌더(FAQ 카테고리 전환)마다 다시 붙는 자리라야 한다 —
  // 새로 그려진 details 에는 리스너가 없다.
  cleanups.push(attachAccordion(root));
  /* 키컬러 구간은 세션·타임테이블 둘만. 혜택도 넣어 봤지만 전환이 잦아지고 위아래 섹션과의
     색 경계가 읽히지 않아 되돌렸다 — 혜택은 자기 배경을 칠하는 일반 섹션이다. */
  const accentZones = [m.sectionId("lnd-sessions"), m.sectionId("lnd-timetable")];
  // 목차 레이어에도 on-accent 를 미러링한다 — 루트 밖으로 나갔으니 후손 선택자가 안 걸린다.
  cleanups.push(attachAccentZone(root, accentZones, tocLayer ? [tocLayer] : []));
  // 목차 레이어는 루트 밖이라 섹션 모드를 못 받는다 → 스파이가 활성 섹션 모드를 미러링한다.
  // 첫 화면(히어로)에는 활성 섹션이 없으므로 히어로 모드를 따로 넘긴다. 미디어 히어로는
  // 설정이 라이트여도 스크림이 어둡다 → 항상 다크로 본다(css .hero-has-media 와 같은 규칙).
  const heroBg = m.lp.heroMedia ? "dark" : m.lp.sectionBg.hero;
  // FAQ 재렌더마다 다시 붙일 수 있도록 변수에 담는다(위 onFaqRerender 주석 참고) — 배경·지브라를
  // 재적용하는 자리와 같은 원리로, 여기서도 "다시 붙이는 방법"을 남겨 둬야 재렌더가 써먹는다.
  let tocSpyCleanup: (() => void) | null = null;
  onFaqRerender = () => {
    tocSpyCleanup?.();
    tocSpyCleanup = attachTocSpy(root, toc, m.tocItems.map((t) => m.sectionId(t.id)), tocLayer, heroBg);
  };
  onFaqRerender();
  cleanups.push(() => tocSpyCleanup?.());
  // 임베드는 랜딩 위아래로 호스트 콘텐츠가 있다 → 랜딩을 벗어나면 고정 목차를 감춘다.
  cleanups.push(attachTocVisibility(body, toc));

  return {
    destroy() {
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch {
          /* 정리 중 예외가 나머지 정리를 막지 않게 */
        }
      }
      releaseLayer(uid);
      root.remove();
    },
  };
}
