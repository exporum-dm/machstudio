/**
 * 랜딩 임베드 진입점 — 외부 사이트(아임웹 등) 문서에서 실행된다.
 *
 * 스니펫:
 *   <div id="ms-landing-{slug}" data-ms-landing-mount data-ms-slug="{slug}">…폴백 링크…</div>
 *   <script async src="https://machstudio.vercel.app/w/l/{slug}"></script>
 *
 * 이 파일은 esbuild 로 IIFE 번들(globalName=__msLanding)이 되고, /w/l/{slug} 라우트가
 * 번들 뒤에 `__msLanding.boot({...페이로드...})` 를 붙여 내려보낸다.
 * → 데이터 fetch 왕복이 0이라 스크립트가 도착하는 순간 최종 콘텐츠가 그려진다
 *   (iframe 시절 10초 넘게 보이던 빈 화면의 근본 원인 제거).
 */

import { mountLanding, type LandingHandle } from "@/lib/landing/mount";
import { landingTranslatedLocales, normalizeLandingPageConfig } from "@/lib/webinar-config";
import { detectFormLocale } from "@/lib/form-locale";
import type { LandingWebinar } from "@/lib/landing/types";
import { sendVisitBeacon } from "@/lib/attribution-client";

export interface BootConfig {
  slug: string;
  origin: string;
  /** 서버가 스크립트에 실어 보낸 스냅샷. null 이면 런타임 fetch 로 폴백. */
  webinar: LandingWebinar | null;
}

interface Instance {
  handle: LandingHandle | null;
  mount: HTMLElement | null;
  cfg: BootConfig;
  observer: MutationObserver | null;
  cleanupHero?: (() => void) | null;
  remounts: number;
  remountWindowStart: number;
}

type Registry = Record<string, Instance>;
type WindowWithRegistry = Window & { __MACH_LANDING__?: Registry };

function registry(): Registry {
  const w = window as WindowWithRegistry;
  return (w.__MACH_LANDING__ = w.__MACH_LANDING__ ?? {});
}

function warn(msg: string, e?: unknown): void {
  try {
    if (window.console && console.warn) console.warn("[mach landing] " + msg, e ?? "");
  } catch {
    /* 호스트 콘솔이 막혀 있어도 진행 */
  }
}

function findMount(slug: string): HTMLElement | null {
  const byAttr = document.querySelector<HTMLElement>(
    '[data-ms-landing-mount][data-ms-slug="' + CSS.escape(slug) + '"]',
  );
  if (byAttr) return byAttr;
  // 구 스니펫 호환 — id 만 있는 경우
  const all = document.querySelectorAll<HTMLElement>("[id]");
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === "ms-landing-" + slug) return all[i];
  }
  return null;
}

/**
 * 아임웹 위젯 애니메이션이 마운트를 숨겨 둔 채로 두는 경우가 있다(_widget_data.wg_animated
 * → visibility:hidden). 우리 콘텐츠가 통째로 안 보이는 사고라 인라인으로 풀어 준다.
 */
function unhideWidget(mount: HTMLElement): void {
  try {
    const wd = mount.closest ? (mount.closest("._widget_data") as HTMLElement | null) : null;
    if (!wd) return;
    wd.classList.add("_ds_animated_except");
    wd.classList.remove("wg_animated");
    wd.style.visibility = "visible";
    wd.style.opacity = "1";
  } catch (e) {
    warn("widget unhide 실패", e);
  }
}

/** 마운트 안에 남아 있는 옛 iframe 임베드를 제거한다(스니펫 이중 부착 방어). */
function dropLegacyIframes(mount: HTMLElement): void {
  const frames = mount.querySelectorAll("iframe");
  for (let i = 0; i < frames.length; i++) {
    const src = frames[i].getAttribute("src") || "";
    if (src.indexOf("/landing") !== -1) frames[i].remove();
  }
}

/** /w 로더의 하단 배너와 히어로 CTA 가 겹치지 않게 상태를 <html> 에 게시한다. */
function publishHeroVisibility(root: HTMLElement): () => void {
  const hero = root.querySelector(".hero");
  if (!hero || typeof IntersectionObserver === "undefined") return () => {};
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        document.documentElement.setAttribute(
          "data-ms-landing-hero",
          entry.isIntersecting ? "in" : "out",
        );
      }
    },
    { threshold: 0.35 },
  );
  io.observe(hero);
  return () => {
    io.disconnect();
    document.documentElement.removeAttribute("data-ms-landing-hero");
  };
}

async function fetchWebinar(cfg: BootConfig): Promise<LandingWebinar | null> {
  try {
    const res = await fetch(cfg.origin + "/api/webinar/" + encodeURIComponent(cfg.slug) + "/info", {
      credentials: "omit",
      mode: "cors",
    });
    const data = (await res.json()) as
      | { webinar?: LandingWebinar; status?: string; entryOpen?: boolean; canRegister?: boolean }
      | null;
    if (!data?.webinar) return null;
    // /info 는 status/entryOpen/canRegister 를 webinar 밖(top-level)에 준다 — 모델이 읽는
    // 자리로 합친다(landing/page.tsx 의 초기 fetch 와 같은 규칙). 이게 없으면 buildLandingModel
    // 이 상태를 "등록중"으로 기본 취급해(build-model.ts) 재조회해도 CTA 가 갱신되지 않는다.
    return { ...data.webinar, status: data.status, entryOpen: data.entryOpen, canRegister: data.canRegister };
  } catch (e) {
    warn("데이터 요청 실패", e);
    return null;
  }
}

/**
 * /info(과 부트 스냅샷) 는 liveEndAt·signupDeadline 도 함께 주지만 LandingWebinar 타입은
 * 뷰가 쓰는 liveStartAt 만 선언한다 — 경계 계산에만 쓰는 값이라 여기서 지역적으로 넓혀 읽는다.
 */
type BootBoundaryFields = { liveStartAt?: string | null; liveEndAt?: string | null; signupDeadline?: string | null };

/** 라이브 시작·마감·종료 중 가장 가까운 **미래** 시각(ms). 남은 경계가 없으면 null. */
function nextBoundaryMs(w: BootBoundaryFields | null): number | null {
  if (!w) return null;
  const now = Date.now();
  const times = [w.liveStartAt, w.liveEndAt, w.signupDeadline]
    .map((iso) => (iso ? new Date(iso).getTime() : NaN))
    .filter((t) => Number.isFinite(t) && t > now);
  return times.length ? Math.min(...times) : null;
}

/**
 * 상태 경계(라이브 시작·마감·종료) 통과 시 데이터를 다시 받아 렌더를 갱신한다.
 *
 * boot() 는 서버가 스크립트에 구워 보낸 스냅샷을 한 번 그리고 끝났다 — 시청자가 랜딩을 열어
 * 둔 채 기다리면 경계를 지나도 CTA 가 그대로 남는다(landing/page.tsx 와 같은 문제, 같은 고침).
 *
 * setTimeout 은 ~24.8일(2^31ms)을 넘기면 즉시 발화하므로 12시간 상한을 씌운다. 상한에 걸려
 * 일찍 깨어나도 다시 fetch·재계산할 뿐이라 안전하다(webinar-loader-script.ts scheduleBoundary
 * 와 같은 패턴) — 실제 경계가 아니면 데이터가 그대로라 다음 스케줄도 같은 시각으로 다시 잡힌다.
 */
function scheduleBoundary(inst: Instance): void {
  const boundary = nextBoundaryMs(inst.cfg.webinar);
  if (boundary === null) return;
  const delay = Math.min(boundary - Date.now() + 1000, 12 * 3600 * 1000);
  setTimeout(() => {
    void fetchWebinar(inst.cfg).then((w) => {
      if (w) {
        inst.cfg = { ...inst.cfg, webinar: w };
        render(inst);
      }
      scheduleBoundary(inst);
    });
  }, Math.max(delay, 1000));
}

function render(inst: Instance): void {
  const mount = findMount(inst.cfg.slug);
  if (!mount) {
    warn("마운트 지점을 찾지 못했습니다: " + inst.cfg.slug);
    return;
  }
  inst.mount = mount;
  unhideWidget(mount);
  dropLegacyIframes(mount);

  const webinar = inst.cfg.webinar;
  if (!webinar) return;

  inst.handle?.destroy();
  inst.cleanupHero?.();

  /**
   * **호스트 페이지의 언어에 맞춰 상세페이지를 그린다**(설계 §11).
   *
   * 같은 스니펫을 국문 페이지와 영문 페이지에 똑같이 붙이면 된다 — 상세페이지를 언어마다
   * 따로 만들면 운영자가 관리할 산출물이 언어 수만큼 늘어나고, 고칠 때마다 전부를 고쳐야 한다.
   *
   * 판정은 브라우저에서 한다. 스크립트에 config 원본이 실려 오므로 **모든 언어가 번들 안에
   * 있고**, 서버가 언어를 고르면 CDN 캐시가 언어 수만큼 갈라진다(등록 폼과 같은 이유).
   * 자동 판정이 틀리면 마운트 자리에 data-mach-lang="ja" 를 달아 덮어쓴다.
   */
  const landingBase = normalizeLandingPageConfig(webinar.config);
  const locale = detectFormLocale(mount, landingTranslatedLocales(landingBase), landingBase.defaultLocale);
  const handle = mountLanding({
    mount,
    webinar,
    embedded: true,
    isPreview: false, // 호스트 URL 쿼리는 신뢰하지 않는다 — 비공개 랜딩이 새면 안 된다
    origin: inst.cfg.origin,
    locale,
  });
  inst.handle = handle;

  const root = mount.querySelector<HTMLElement>(".lnd");
  if (root) inst.cleanupHero = publishHeroVisibility(root);
  document.documentElement.setAttribute("data-ms-landing", "1");
}

/**
 * 호스트가 위젯을 다시 그리면 우리 콘텐츠가 지워진다. 복원된 HTML 안의 <script> 는
 * innerHTML 경로라 재실행되지 않으므로, 우리가 직접 감시해서 다시 붙인다.
 * 폭주 방지: 1분에 5회까지만.
 */
function watchForRerender(inst: Instance): void {
  if (typeof MutationObserver === "undefined") return;
  const target = inst.mount?.parentElement;
  if (!target) return;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    const root = inst.mount && inst.mount.querySelector(".lnd");
    if (root && document.contains(root)) return; // 우리 콘텐츠가 살아 있으면 무시
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const now = Date.now();
      if (now - inst.remountWindowStart > 60_000) {
        inst.remountWindowStart = now;
        inst.remounts = 0;
      }
      if (++inst.remounts > 5) {
        warn("재마운트 한도 초과 — 관측만 계속합니다");
        return;
      }
      render(inst);
    }, 200);
  });
  observer.observe(target, { childList: true });
  inst.observer = observer;
}

export function boot(cfg: BootConfig): void {
  try {
    const reg = registry();
    const prev = reg[cfg.slug];
    if (prev) {
      // 재진입은 조기 return 이 아니라 재마운트 — 호스트 재렌더 후 스크립트가 다시 돌 수 있다.
      prev.cfg = cfg;
      render(prev);
      return;
    }
    const inst: Instance = {
      handle: null,
      mount: null,
      cfg,
      observer: null,
      remounts: 0,
      remountWindowStart: Date.now(),
    };
    reg[cfg.slug] = inst;

    /* 첫 렌더 성공 후에만 방문 1회 — 폴백 링크만 남은 실패 경로는 세지 않는다.
       세션당 1회 가드는 sendVisitBeacon 안에 있고, 절대 URL 이어야 하므로 origin 을 넘긴다
       (호스트 문서에서 돌기 때문에 상대경로면 호스트 도메인으로 POST 된다).
       이 비콘이 없던 동안 **등록이 일어나는 유일한 페이지의 방문이 0** 이었다 — 로더의
       seen 비콘은 `data-mach-webinar-mount` 만 찾아서 랜딩 마운트를 보지 못한다. */
    const rendered = () => {
      render(inst);
      watchForRerender(inst);
      scheduleBoundary(inst);
      try { sendVisitBeacon(inst.cfg.slug, { origin: inst.cfg.origin }); } catch { /* 호스트를 깨뜨리지 않는다 */ }
    };

    const start = () => {
      if (!inst.cfg.webinar) {
        void fetchWebinar(inst.cfg).then((w) => {
          inst.cfg = { ...inst.cfg, webinar: w };
          if (!w) {
            warn("데이터를 가져오지 못해 폴백 링크를 유지합니다");
            return;
          }
          rendered();
        });
        return;
      }
      rendered();
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  } catch (e) {
    // 호스트 페이지를 절대 깨뜨리지 않는다.
    warn("부트 실패", e);
  }
}
