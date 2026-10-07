/**
 * 공고 상세페이지 조립 — 어드민 미리보기 / 외부 사이트 임베드 공통 진입점.
 *
 * 껍데기의 스타일·효과를 그대로 쓴다. 웨비나 랜딩과 **같은 클래스·같은 변수 계약**이라
 * 스크롤 리빌·세로 목차·배경 모드가 별도 구현 없이 걸린다.
 */
import { onAccentColor } from "@/lib/competition-render";
import { clearNode, h } from "@/lib/dom/h";
import { attachReveal, attachTocSpy, attachTocVisibility } from "@/lib/landing/effects";
import { createTocLayer, releaseLayer } from "@/lib/landing/overlay";
import { NOTICE_CSS } from "./css";
import { buildNoticeModel } from "./build-model";
import { renderHero, renderToc } from "./view-hero";
import {
  renderApply,
  renderBanner,
  renderConcept,
  renderCountdown,
  renderCriteria,
  renderEligibility,
  renderFaq,
  renderForm,
  renderPrizes,
  renderSelection,
  renderSnapshot,
  renderSponsors,
  renderSplit,
  renderTimeline,
  renderVideo,
} from "./view-sections";
import { normalizeNoticePageConfig, type NoticeSectionKey } from "./config";
import type { NoticeModel } from "./types";
import type { NoticeCompetition } from "./types";
import { paperFor } from "@/lib/color";

const STYLE_ID = "mc-notice-styles";
const FONT_ID = "mc-notice-font";
const FONT_HREF = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

let seq = 0;
const nextUid = () => `n${(seq += 1)}`;

export interface MountNoticeOptions {
  mount: HTMLElement;
  competition: NoticeCompetition;
  /** Competition.config 원본 — 여기서 정규화한다(호출부마다 다르게 다루면 어긋난다). */
  config: unknown;
  embedded: boolean;
  isPreview: boolean;
  /** 신청 버튼을 눌렀을 때. 미리보기면 호출부가 저장하지 않는 핸들러를 준다. */
  onApply: () => void;
  /**
   * 세로 목차를 붙일지. 목차는 `position: fixed` 로 **body 직계**에 사는데,
   * 어드민 편집 화면의 축소 미리보기에서는 그게 편집 UI 위로 떠 버린다.
   * 기본값 true — 끄는 건 어드민 인라인 미리보기뿐이다.
   */
  attachToc?: boolean;
}

export interface NoticeHandle {
  destroy(): void;
}

/**
 * 스타일은 **마운트 대상이 속한 문서**에 넣는다.
 *
 * 어드민 미리보기는 공고를 iframe 안에 그린다 — 그래야 vw 와 미디어 쿼리가 브라우저 창이
 * 아니라 기기 폭을 본다. 여기서 전역 document 를 쓰면 CSS 는 바깥 문서에만 들어가고
 * iframe 안은 **스타일 없는 맨 HTML** 이 된다.
 */
function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = NOTICE_CSS;
  doc.head.appendChild(style);
}

function ensureFont(doc: Document): void {
  if (doc.getElementById(FONT_ID)) return;
  const link = doc.createElement("link");
  link.id = FONT_ID;
  link.rel = "stylesheet";
  link.href = FONT_HREF;
  doc.head.appendChild(link);
}


/**
 * 마감까지 남은 시간.
 *
 * 서버가 렌더한 값을 굳히지 않고 브라우저에서 1초마다 다시 센다 — 탭을 오래 열어 둔
 * 방문자에게 멈춘 숫자가 계속 보이면 안 된다. 마감이 지나면 0 으로 고정하고 타이머를 끈다.
 */
function attachCountdown(root: HTMLElement): () => void {
  const box = root.querySelector<HTMLElement>("[data-countdown]");
  const deadlineRaw = box?.getAttribute("data-countdown");
  if (!box || !deadlineRaw) return () => {};
  const deadline = new Date(deadlineRaw).getTime();
  if (Number.isNaN(deadline)) return () => {};

  const cell = (key: string) => box.querySelector<HTMLElement>(`[data-cd="${key}"]`);
  const nodes = { days: cell("days"), hours: cell("hours"), mins: cell("mins"), secs: cell("secs") };

  let timer = 0;
  const tick = () => {
    const diff = deadline - Date.now();
    if (diff <= 0) {
      for (const node of Object.values(nodes)) if (node) node.textContent = "0";
      window.clearInterval(timer);
      return;
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    if (nodes.days) nodes.days.textContent = String(Math.floor(diff / 86400000));
    if (nodes.hours) nodes.hours.textContent = pad(Math.floor((diff % 86400000) / 3600000));
    if (nodes.mins) nodes.mins.textContent = pad(Math.floor((diff % 3600000) / 60000));
    if (nodes.secs) nodes.secs.textContent = pad(Math.floor((diff % 60000) / 1000));
  };

  tick();
  timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);
}

/**
 * 신청 폼 섹션에 사전등록 폼을 채운다 — 등록 폼 로더(/f/{id})를 그대로 부른다.
 * 로더는 `data-mach-form="{id}"` 자리를 스스로 찾아 붙는다(같은 번들·같은 캐시 정책).
 * 같은 폼 스크립트가 이미 있으면 다시 넣지 않는다.
 */
function attachFormLoader(root: HTMLElement, m: NoticeModel): void {
  if (m.isPreview || !m.formOrigin) return;
  const slot = root.querySelector<HTMLElement>("[data-mach-form]");
  const sourceId = slot?.getAttribute("data-mach-form");
  if (!slot || !sourceId) return;
  const doc = root.ownerDocument ?? document;
  const src = `${m.formOrigin.replace(/\/$/, "")}/f/${sourceId}`;
  if (doc.querySelector(`script[src="${src}"]`)) return;
  const script = doc.createElement("script");
  script.async = true;
  script.src = src;
  slot.after(script);
}

export function mountNotice(opts: MountNoticeOptions): NoticeHandle {
  const { mount, competition, embedded, isPreview, onApply } = opts;
  const uid = nextUid();

  const doc = mount.ownerDocument ?? document;
  ensureStyles(doc);
  ensureFont(doc);

  const np = normalizeNoticePageConfig(opts.config);
  const m = buildNoticeModel(competition, np, { uid, embedded, isPreview });

  const root = h("div", {
    class: `lnd${embedded ? " embedded" : ""}`,
    lang: "ko",
    style: {
      "--primary": m.accent,
      "--on-primary": m.onPrimary,
      /*
        비우면 키컬러를 따른다 — 빈 값을 그대로 넣으면 var() 가 무효가 되어 상속으로
        떨어지므로, 여기서 키컬러로 확정해 준다. 버튼 글자색도 버튼 배경에서 다시 계산한다
        (키컬러는 흰 글자인데 버튼만 노랑으로 바꾸면 글자가 사라진다).
      */
      "--primary-alt": np.colors.accentAlt || m.accent,
      "--btn": np.colors.button || m.accent,
      "--on-btn": onAccentColor(np.colors.button || m.accent),
      "--bg-light": np.colors.lightBg,
      "--bg-dark": np.colors.darkBg,
      "--paper-light": paperFor(np.colors.lightBg),
      "--paper-dark": paperFor(np.colors.darkBg),
    },
    // 루트 모드 = 히어로 모드. 섹션은 각자 data-bg 로 자기 배경을 칠한다.
    "data-bg": np.sectionBg.hero,
  });

  // 공개 게이트 — 미공개 공고가 외부 사이트에 그대로 노출되면 안 된다.
  if (!np.enabled && !isPreview) {
    root.appendChild(
      h(
        "div",
        { style: { minHeight: "50vh", display: "grid", placeItems: "center", padding: "24px", textAlign: "center" } },
        "아직 공개되지 않은 페이지예요.",
      ),
    );
    clearNode(mount);
    mount.appendChild(root);
    return { destroy: () => root.remove() };
  }

  if (!np.enabled && isPreview) {
    root.appendChild(h("div", { class: "preview-badge" }, "비공개 상태 · 미리보기"));
  }

  // 섹션은 운영자가 정한 순서(np.order)대로 — 히어로만 늘 맨 위다.
  const renderers: Record<NoticeSectionKey, () => HTMLElement | null> = {
    concept: () => renderConcept(m),
    banner: () => renderBanner(m),
    split: () => renderSplit(m),
    video: () => renderVideo(m),
    snapshot: () => renderSnapshot(m),
    timeline: () => renderTimeline(m),
    apply: () => renderApply(m),
    eligibility: () => renderEligibility(m),
    selection: () => renderSelection(m),
    criteria: () => renderCriteria(m),
    prizes: () => renderPrizes(m),
    countdown: () => renderCountdown(m, onApply),
    form: () => renderForm(m),
    faq: () => renderFaq(m),
    sponsors: () => renderSponsors(m),
  };
  const body = h(
    "div",
    { class: "lnd-body" },
    renderHero(m, onApply),
    np.order.map((key) => renderers[key]()),
  );
  root.appendChild(body);

  clearNode(mount);
  mount.appendChild(root);

  const cleanups: Array<() => void> = [];

  // 목차는 body 직계 레이어에 산다 — 호스트 페이지의 스택 문맥에 갇히지 않게.
  const toc = opts.attachToc === false ? null : renderToc(m);
  let tocLayer: HTMLElement | null = null;
  if (toc) {
    tocLayer = createTocLayer(uid, m.accent, m.onPrimary, np.colors.lightBg, np.colors.darkBg);
    tocLayer.appendChild(toc);
    cleanups.push(() => releaseLayer(uid));
  }

  attachFormLoader(root, m);
  cleanups.push(attachReveal(root));
  cleanups.push(attachCountdown(root));
  if (toc) {
    // 미디어 히어로는 설정이 라이트여도 스크림이 어둡다 → 목차 글자는 항상 밝게(css 와 같은 규칙).
    const heroBg = np.hero.media ? "dark" : np.sectionBg.hero;
    cleanups.push(
      attachTocSpy(root, toc, m.tocItems.map((item) => m.sectionId(item.id)), tocLayer, heroBg),
    );
    // 임베드는 공고 위아래로 호스트 콘텐츠가 있다 → 공고를 벗어나면 고정 목차를 감춘다.
    cleanups.push(attachTocVisibility(body, toc));
  }

  return {
    destroy() {
      for (const cleanup of cleanups) cleanup();
      root.remove();
    },
  };
}
