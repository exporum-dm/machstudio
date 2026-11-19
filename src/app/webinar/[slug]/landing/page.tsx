"use client";

// 랜딩 상세페이지(공개) — 이 파일은 얇은 셸이다.
// 마크업·CSS·인터랙션은 전부 src/lib/landing 에 있고, 단독 페이지 / 어드민 미리보기 /
// 외부 사이트(아임웹) 임베드가 **같은 렌더러**를 쓴다(두 벌 유지로 인한 드리프트 방지).
//
// 레거시 iframe 임베드 경로는 전환 기간 동안만 유지한다:
//  - auto-height iframe 안에서는 100svh 가 문서 전체 높이가 되어 무한 성장하므로,
//    호스트가 postMessage 로 넘겨준 뷰포트 높이를 --lnd-vh 로 받아 히어로 높이를 잡는다.
//  - 호스트 DOM 직접 마운트로 완전히 넘어가면 이 브리지는 삭제한다.

import { use, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { mountLanding } from "@/lib/landing/mount";
import { landingTranslatedLocales, normalizeLandingPageConfig } from "@/lib/webinar-config";
import { resolveLocaleFromRawSignals } from "@/lib/form-locale";
import type { LandingWebinar } from "@/lib/landing/types";
import { sendVisitBeacon } from "@/lib/attribution-client";

/**
 * /info 는 liveEndAt·signupDeadline 도 함께 내려주지만 LandingWebinar 타입은 뷰가 실제로
 * 쓰는 liveStartAt 만 선언한다(webinar-loader-script.ts 의 CFG 와 달리 이 타입은 렌더 계약이라
 * 필드를 늘리지 않는다). 경계 계산에만 쓰는 값이라 여기서 지역적으로 넓혀 읽는다.
 */
type LandingBoundaryFields = { liveStartAt?: string | null; liveEndAt?: string | null; signupDeadline?: string | null };

/** 라이브 시작·마감·종료 중 가장 가까운 **미래** 시각(ms). 남은 경계가 없으면 null. */
function nextLandingBoundaryMs(w: LandingBoundaryFields): number | null {
  const now = Date.now();
  const times = [w.liveStartAt, w.liveEndAt, w.signupDeadline]
    .map((iso) => (iso ? new Date(iso).getTime() : NaN))
    .filter((t) => Number.isFinite(t) && t > now);
  return times.length ? Math.min(...times) : null;
}

export default function WebinarLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [webinar, setWebinar] = useState<LandingWebinar | null>(null);
  // ?preview 는 요청만이고, 허용 여부는 서버(/info)가 멤버십으로 판정한다.
  const [previewAllowed, setPreviewAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  /**
   * 방문 1회 기록(세션당 1회) — 퍼널의 "방문" 분모.
   * 랜딩은 등록의 주 진입점인데 방문이 임베드 로더 비콘으로만 쌓여서, 이 페이지로 온 캠페인은
   * 분석 표에서 분모 0(등록률 0%) 이었다. 미리보기 가드는 sendVisitBeacon 안에 있다.
   */
  useEffect(() => {
    sendVisitBeacon(slug);
  }, [slug]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/webinar/${slug}/info`);
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !data?.webinar) {
          setError(data?.error ?? "웨비나를 찾을 수 없어요");
          return;
        }
        setPreviewAllowed(data.landingPreviewAllowed === true);
        // info 는 상태를 webinar 밖(top-level)에 준다 → 모델이 읽는 자리로 합친다.
        setWebinar({
          ...(data.webinar as LandingWebinar),
          status: data.status,
          entryOpen: data.entryOpen,
          canRegister: data.canRegister,
        });
      } catch {
        if (alive) setError("불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  /**
   * 상태 경계(라이브 시작·마감·종료) 통과 시 /info 를 다시 불러 상태를 갱신한다.
   *
   * 마운트 시 한 번만 상태를 굳히면, 시청자가 랜딩을 열어 둔 채 기다리다 라이브 시작 시각이
   * 지나도 CTA 가 "사전 등록하기" 로 남는다. 그 링크의 ?view=signup 은 라이브 페이지의 대기
   * 화면을 고정시켜, 등록자가 눌러도 입장이 안 된다(buildLiveUrl 근처 주석 참고).
   *
   * 다음 경계가 setTimeout 상한(~24.8일 = 2^31ms)보다 멀 수 있으므로 12시간으로 캡을 씌운다.
   * 캡에 걸려 일찍 깨어나도 그냥 다시 fetch 하고 재계산할 뿐이라 안전하다 — 실제 경계가
   * 아니면 상태가 그대로라 다음 스케줄도 같은 시각으로 다시 잡힌다
   * (webinar-loader-script.ts 의 scheduleBoundary 와 같은 패턴).
   */
  useEffect(() => {
    if (!webinar) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      const boundary = nextLandingBoundaryMs(webinar);
      if (boundary === null) return;
      const delay = Math.min(boundary - Date.now() + 1000, 12 * 3600 * 1000);
      timer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/webinar/${slug}/info`);
          const data = await res.json().catch(() => null);
          if (!alive || !res.ok || !data?.webinar) return;
          setWebinar({
            ...(data.webinar as LandingWebinar),
            status: data.status,
            entryOpen: data.entryOpen,
            canRegister: data.canRegister,
          });
        } catch {
          /* 실패해도 조용히 넘어가고 다음 경계에서 다시 시도한다 */
        } finally {
          if (alive) scheduleNext();
        }
      }, Math.max(delay, 1000));
    };

    scheduleNext();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [webinar, slug]);

  useEffect(() => {
    if (webinar?.name) document.title = `${webinar.name} — 사전 등록`;
  }, [webinar?.name]);

  // 렌더 + 정리. StrictMode 이중 호출에도 안전하도록 destroy 는 멱등.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !webinar) return;
    const embedded = window.self !== window.top;
    /**
     * 이 화면은 **우리가 직접 서빙**하므로 읽을 신호가 ?lang= 뿐이다 — 국문 홈페이지의
     * 버튼은 그냥 링크를, 영문 홈페이지의 버튼은 ?lang=en 을 걸면 된다.
     * (호스트 사이트에 **임베드**된 상세페이지는 그 페이지의 경로·서브도메인·html lang 까지
     *  읽는다 — embed/landing-entry.ts.)
     *
     * 번역이 들어 있는 언어로만 좁힌다. 빈 언어를 고르면 칸마다 원문으로 폴백해
     * 화면이 그대로인데, 그러면 "?lang 을 붙였는데 안 바뀐다" 로 보인다.
     */
    const landingBase = normalizeLandingPageConfig(webinar.config);
    const locale = resolveLocaleFromRawSignals(
      [new URLSearchParams(window.location.search).get("lang")],
      landingTranslatedLocales(landingBase),
      landingBase.defaultLocale,
    );
    const handle = mountLanding({
      mount: host,
      webinar,
      embedded,
      isPreview: previewAllowed && new URLSearchParams(window.location.search).has("preview"),
      origin: window.location.origin,
      legacyIframe: embedded,
      locale,
    });
    return () => handle.destroy();
  }, [webinar, previewAllowed]);

  // 레거시 iframe 브리지 — 문서 높이를 부모로, 호스트 뷰포트 높이를 --lnd-vh 로.
  useEffect(() => {
    if (typeof window === "undefined" || window.self === window.top || !webinar) return;
    let raf = 0;
    const post = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        window.parent.postMessage(
          { type: "machstudio:landing-height", slug, height: document.documentElement.scrollHeight },
          "*",
        );
      });
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; vh?: number; top?: number } | null;
      if (d?.type === "machstudio:host-viewport" && typeof d.vh === "number") {
        const top = typeof d.top === "number" ? d.top : 0;
        const usable = Math.max(480, Math.min(1400, Math.round(d.vh - top)));
        document.querySelector<HTMLElement>(".lnd")?.style.setProperty("--lnd-vh", `${usable}px`);
        post();
      }
    };
    const ro = new ResizeObserver(post);
    ro.observe(document.documentElement);
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "machstudio:landing-ready", slug }, "*");
    post();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("message", onMsg);
    };
  }, [slug, webinar]);

  if (error) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", background: "#06080d", color: "#abb5c7", fontFamily: "Pretendard, sans-serif", padding: 24, textAlign: "center" }}>
        {error}
      </div>
    );
  }

  return (
    <div ref={hostRef} style={{ minHeight: "100svh", background: "#06080d" }}>
      {!webinar && (
        <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#abb5c7" }} />
        </div>
      )}
    </div>
  );
}
