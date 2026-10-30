/**
 * 웨비나 로더 스크립트 생성 — 아임웹 등 외부 사이트에 1회 부착되는 클라이언트 코드.
 *
 *   <script async src="https://machstudio.vercel.app/w/SITE_ID"></script>
 *
 * 동작:
 *  - /api/webinar-embed/{siteId}/config 를 런타임 fetch (sessionStorage 60초 SWR)
 *    → 문구·테마·일정 변경이 코드 재부착 없이 반영된다.
 *  - 마운트 마커에 컴포넌트 렌더:
 *      <div data-mach-webinar-mount="hero-button"></div>
 *      <div data-mach-webinar-mount="register-form"></div>
 *      <div data-mach-webinar-mount="live"></div>   (라이브 전용 페이지)
 *    하단 배너는 마커 없이 body 에 부착 (live 마운트가 있는 페이지에서는 미표시).
 *  - 상태 머신(webinar-status.ts 와 동일 값): upcoming/registration/live/ended + entryOpen.
 *    serverNow 오프셋 보정 + 경계 통과 시 재렌더 + 라이브 윈도(시작−30분~종료+30분) 120초 폴링
 *    + visibilitychange 재fetch(30초 스로틀).
 *  - 등록 제출: /api/webinar/{slug}/register 로 직행, _utm 봉투(attribution-core)와 _hp 허니팟 동봉.
 *  - seen 비콘: 세션당 1회 — 연결 감지 + 방문 집계.
 *  - 전체 try/catch — 실패 시 호스트 페이지를 건드리지 않고 조용히 종료.
 *
 * 주의: 클라이언트 코드 안에서 백틱과 "달러+중괄호" 시퀀스를 쓰지 않는다 (TS 템플릿 리터럴 안전).
 * 정규식 백슬래시 이스케이프 사고를 피하기 위해 글로브 매칭은 indexOf 워크로 구현.
 */
import { ATTRIBUTION_CORE_JS } from "./attribution-core";
import { PHONE_MIN_DIGITS, PHONE_MAX_DIGITS, EMAIL_REGEX } from "./webinar-config";
import { PUBLIC_REGISTRATION_FORM_CSS } from "./webinar-public-form-css";
import { ON_ACCENT_JS } from "./color-embed-js";

export function buildWebinarLoaderScript({ siteId, baseUrl }: { siteId: string; baseUrl: string }): string {
  return `(function() {
  var SITE_ID = ${JSON.stringify(siteId)};
  // 가드는 사이트 단위 — 같은 페이지에 다른 임베드 사이트의 옛 로더 태그가 남아 있어도
  // 두 번째가 조용히 죽지 않고 경고를 남긴다 (동일 사이트 이중 부착은 여전히 1회만 실행).
  if (window.__MACH_WEBINAR_LOADER__) {
    if (window.__MACH_WEBINAR_LOADER__ !== SITE_ID) {
      try { if (window.console && console.warn) console.warn("[mach webinar] 다른 사이트 로더가 이미 로드됨 — 이 태그(" + SITE_ID + ")는 무시됩니다. 아임웹에 남은 옛 임베드 태그를 제거해주세요."); } catch (e) {}
    }
    return;
  }
  window.__MACH_WEBINAR_LOADER__ = SITE_ID;

  var BASE = ${JSON.stringify(baseUrl)};
  var CONFIG_URL = BASE + "/api/webinar-embed/" + SITE_ID + "/config";
  var SEEN_URL = BASE + "/api/webinar-embed/" + SITE_ID + "/seen";
  var CFG_CACHE_KEY = "mw_cfg_" + SITE_ID;
  var CFG_CACHE_TTL = 60 * 1000;
  var LIVE_WINDOW_PAD_MS = 30 * 60 * 1000;
  var LIVE_POLL_MS = 120 * 1000;
  var VIS_REFETCH_THROTTLE_MS = 30 * 1000;

${ATTRIBUTION_CORE_JS}

  try { migrateLegacyUtm(); } catch (e) {}
  try { captureUtm(); } catch (e) {}

  var CFG = null;
  var serverOffsetMs = 0;
  var lastRenderKey = "";
  var lastVisRefetchAt = 0;
  var pollTimer = null;
  var boundaryTimer = null;

  function warn(msg, e) {
    try { if (window.console && console.warn) console.warn("[mach webinar] " + msg, e || ""); } catch (e2) {}
  }

  function serverNowMs() { return Date.now() + serverOffsetMs; }

  function parseMs(iso) {
    var t = new Date(iso).getTime();
    return isNaN(t) ? null : t;
  }

  /* ── 상태 판정 (webinar-status.ts 와 동일 규칙) ── */
  function computeStatus() {
    if (!CFG) return "upcoming";
    if (CFG.statusOverride === "registration" || CFG.statusOverride === "live" || CFG.statusOverride === "ended") {
      return CFG.statusOverride;
    }
    var now = serverNowMs();
    var start = parseMs(CFG.liveStartAt);
    var end = parseMs(CFG.liveEndAt);
    var deadline = parseMs(CFG.signupDeadline);
    if (end !== null && now >= end) return "ended";
    if (start !== null && now >= start) return "live";
    if (deadline !== null && now <= deadline) return "registration";
    return "upcoming";
  }

  function isEntryOpen(status) {
    if (status === "live") return true;
    if (status === "ended") return false;
    // 서버(webinar-status.ts)와 동일: 수동 override 가 있으면 시간 기반 입장오픈을 억제한다.
    // (운영자가 종료된 방송을 'registration'으로 되돌려 접수 재개하는 경우 등)
    if (CFG.statusOverride) return false;
    var openAt = parseMs(CFG.entryOpenAt);
    return openAt !== null && serverNowMs() >= openAt;
  }

  function canRegisterNow(status) {
    if (status === "registration") return true;
    if (status === "live") {
      // 명시 설정이 있으면 그대로, 없으면(null) 서버 마감 규칙과 동일하게 deadline 을 실시간 비교.
      // (config 가 fetch 시점 boolean 으로 굳으면 마감→라이브 전환 구간에 서버가 거절할 폼을 노출할 수 있음)
      if (CFG.allowLiveRegistration === true) return true;
      if (CFG.allowLiveRegistration === false) return false;
      var deadline = parseMs(CFG.signupDeadline);
      return deadline !== null && serverNowMs() <= deadline;
    }
    return false;
  }

  /* ── 글로브 매칭 (백슬래시 없는 indexOf 워크) ── */
  function normPath(p) {
    p = (p || "/").toLowerCase();
    if (p.length > 1 && p.charAt(p.length - 1) === "/") p = p.slice(0, -1);
    return p;
  }
  function pathMatchesPattern(pathname, pattern) {
    var path = normPath(pathname);
    var pat = normPath(pattern);
    var parts = pat.split("*");
    if (parts.length === 1) return path === pat;
    if (parts[0] && path.indexOf(parts[0]) !== 0) return false;
    var pos = parts[0].length;
    for (var i = 1; i < parts.length; i++) {
      if (!parts[i]) continue;
      var idx = path.indexOf(parts[i], pos);
      if (idx === -1) return false;
      pos = idx + parts[i].length;
    }
    var lastPart = parts[parts.length - 1];
    if (lastPart && path.slice(-lastPart.length) !== lastPart) return false;
    return true;
  }
  function bannerAllowedOnPage() {
    var patterns = (CFG && CFG.bannerPagePatterns) || [];
    if (!patterns.length) return true;
    var path = window.location.pathname || "/";
    for (var i = 0; i < patterns.length; i++) {
      if (pathMatchesPattern(path, patterns[i])) return true;
    }
    return false;
  }

  /* ── 설정 fetch (sessionStorage 60초 SWR) ── */
  function readCachedCfg() {
    try {
      var raw = sessionStorage.getItem(CFG_CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.cfg) return null;
      return parsed;
    } catch (e) { return null; }
  }
  function writeCachedCfg(cfg, ageMs) {
    try { sessionStorage.setItem(CFG_CACHE_KEY, JSON.stringify({ t: Date.now(), cfg: cfg, a: ageMs || 0 })); } catch (e) {}
  }
  var lastAgeMs = 0; /* 마지막 응답의 CDN 캐시 경과(ms) */
  function applyConfig(cfg, fetchedAtMs, ageMs) {
    if (!cfg || !cfg.slug) return;
    CFG = cfg;
    var serverNow = parseMs(cfg.serverNow);
    /* serverNow 는 응답 **본문**에 있어 CDN 캐시와 함께 굳는다(s-maxage 60 + SWR 300).
       보정 없이 쓰면 최대 6분 과거의 시각을 "지금"으로 믿어 serverOffsetMs 가 그만큼 음수가 되고,
       경계 타이머가 늦게 잡혀 라이브 전환이 지연됐다. Age 헤더로 캐시에 머문 시간을 더해 되돌린다. */
    if (serverNow !== null) serverNow += (typeof ageMs === "number" && ageMs > 0 ? ageMs : 0);
    if (serverNow !== null && fetchedAtMs) serverOffsetMs = serverNow - fetchedAtMs;
    renderAll();
    scheduleBoundary();
    schedulePolling();
  }
  function fetchConfig(force) {
    var fetchedAt = Date.now();
    // no-store: 브라우저 캐시 우회 (신선도는 sessionStorage SWR + CDN s-maxage 가 담당 —
    // 브라우저 휴리스틱 캐시가 끼면 상태 전환이 페이지에 반영되지 않는다)
    fetch(CONFIG_URL, { method: "GET", cache: "no-store" }).then(function(res) {
      if (!res.ok) throw new Error("config " + res.status);
      /* Age = 응답이 CDN 캐시에 머문 초. 본문의 serverNow 가 그만큼 과거라 보정에 쓴다. */
      var ageSec = parseInt(res.headers.get("age") || "0", 10);
      lastAgeMs = isNaN(ageSec) || ageSec < 0 ? 0 : ageSec * 1000;
      return res.json();
    }).then(function(cfg) {
      writeCachedCfg(cfg, lastAgeMs);
      applyConfig(cfg, fetchedAt, lastAgeMs);
    }).catch(function(e) {
      if (!CFG) warn("config fetch failed — 렌더 생략", e);
    });
  }
  function initConfig() {
    var cached = readCachedCfg();
    if (cached) {
      // cached.t(= fetch 시각)를 넘겨 serverNow 오프셋을 복원 — 캐시 신선(<60초)해서 재fetch 를
      // 건너뛰는 페이지뷰에서도 클럭 스큐 보정이 유지된다 (절대시각 차이라 경과시간 무관).
      applyConfig(cached.cfg, cached.t, cached.a);
      if (Date.now() - cached.t < CFG_CACHE_TTL) return;
    }
    fetchConfig(false);
  }

  /* ── seen 비콘: 연결 감지(어느 페이지든 1회) + 방문 집계(웨비나 컴포넌트가 있는 페이지 1회) ──
   * 배너는 사이트 전역에 붙을 수 있어, 배너만 뜨는 일반 페이지를 "방문"으로 세면 퍼널 상단이 부풀려진다.
   * 따라서 mount 마커(hero/form/live)가 있는 페이지에서만 visit=true 로 집계한다. dedup 키를 분리해
   * 배너 페이지 → 웨비나 페이지로 이동해도 방문이 1회 정확히 기록되게 한다. */
  function sendSeen() {
    try {
      var last = storageGet(UTM_LAST_KEY) || emptyUtm();
      var hasMount = !!document.querySelector("[data-mach-webinar-mount]");
      var seenKey = "mw_seen_" + SITE_ID;
      var visitKey = "mw_visit_" + SITE_ID;
      // 스토리지 접근 실패가 비콘 전송을 막지 않도록 dedup 가드는 best-effort 로 분리
      var seenDone = false, visitDone = false;
      try { seenDone = !!sessionStorage.getItem(seenKey); } catch (e) {}
      try { visitDone = !!sessionStorage.getItem(visitKey); } catch (e) {}
      var needSeen = !seenDone;
      var needVisit = hasMount && !visitDone;
      if (!needSeen && !needVisit) return;
      if (needSeen) { try { sessionStorage.setItem(seenKey, "1"); } catch (e) {} }
      if (needVisit) { try { sessionStorage.setItem(visitKey, "1"); } catch (e) {} }
      var payload = JSON.stringify({ utmSource: last.utmSource || "", utmMedium: last.utmMedium || "", visit: needVisit });
      // 순수 문자열 = text/plain simple request — sendBeacon 은 CORS preflight 를 못 하므로
      // application/json Blob 을 쓰면 크로스오리진에서 차단된다 (서버는 text 바디도 JSON 파싱함)
      if (navigator.sendBeacon) {
        navigator.sendBeacon(SEEN_URL, payload);
      } else {
        fetch(SEEN_URL, { method: "POST", body: payload, keepalive: true });
      }
    } catch (e) {}
  }

  /* ── UTM 봉투 (register 동봉 — 서버 parseUtmEnvelope 와 flat 키 계약) ── */
  function buildUtmEnvelope() {
    try {
      var last = storageGet(UTM_LAST_KEY) || emptyUtm();
      var first = storageGet(UTM_FIRST_KEY) || last;
      var journey = storageGet(JOURNEY_KEY) || [];
      if (!Array.isArray(journey)) journey = [];
      return {
        utmSource: last.utmSource || null, utmMedium: last.utmMedium || null,
        utmCampaign: last.utmCampaign || null, utmTerm: last.utmTerm || null,
        utmContent: last.utmContent || null, utmId: last.utmId || null,
        firstUtmSource: first.utmSource || null, firstUtmMedium: first.utmMedium || null,
        firstUtmCampaign: first.utmCampaign || null, firstUtmTerm: first.utmTerm || null,
        firstUtmContent: first.utmContent || null, firstUtmId: first.utmId || null,
        firstReferrer: first.referrer || null, firstSeenAt: first.seenAt || null,
        journey: journey, referrer: document.referrer || null
      };
    } catch (e) { return null; }
  }

  /* ── 테마/스타일 ── */
${ON_ACCENT_JS}  function theme() {
    var t = (CFG && CFG.theme) || {};
    var accent = t.accentColor || "#6d28d9";
    return {
      accent: accent,
      onAccent: publicFormOnAccent(accent),
      radius: t.borderRadius || "12px",
      text: t.textColor || "#111",
      surface: t.surfaceColor || "#ffffff"
    };
  }
  function injectStyles() {
    if (document.getElementById("mw-styles")) {
      document.getElementById("mw-styles").textContent = buildCss();
      return;
    }
    var style = document.createElement("style");
    style.id = "mw-styles";
    style.textContent = buildCss();
    document.head.appendChild(style);
  }
  function buildCss() {
    var t = theme();
    return [
      ".mw-reset { --mw-accent:" + t.accent + "; --mw-on-accent:" + t.onAccent + "; --mw-radius:" + t.radius + "; --mw-text:" + t.text + "; --mw-surface:" + t.surface + "; }",
      ".mw-reset, .mw-reset * { box-sizing: border-box; margin: 0; }",
      ".mw-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 28px; border: 0; border-radius: " + t.radius + "; font-size: 15px; font-weight: 700; line-height: 1.2; cursor: pointer; text-decoration: none !important; white-space: nowrap; transition: transform .18s ease, opacity .18s ease, box-shadow .18s ease; }",
      ".mw-btn:hover { transform: translateY(-1px); }",
      ".mw-btn-primary { background: " + t.accent + " !important; color: var(--mw-on-accent) !important; -webkit-text-fill-color: var(--mw-on-accent) !important; box-shadow: 0 4px 16px rgba(0,0,0,0.18); }",
      ".mw-btn-primary:hover { opacity: .92; }",
      ".mw-btn-secondary { background: rgba(120,120,128,0.12) !important; color: #333 !important; -webkit-text-fill-color: #333 !important; border: 1px solid rgba(120,120,128,0.25) !important; }",
      ".mw-btn-disabled { background: rgba(120,120,128,0.16) !important; color: #999 !important; -webkit-text-fill-color: #999 !important; cursor: not-allowed; }",
      ".mw-btn-disabled:hover { transform: none; }",
      ".mw-hero { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }",
      ${JSON.stringify(PUBLIC_REGISTRATION_FORM_CSS)},
      ".mw-live-frame { width: 100%; border: 0; display: block; min-height: 520px; }",
      ".mw-banner { position: fixed !important; left: 50% !important; bottom: 24px !important; transform: translateX(-50%) !important; width: 680px; max-width: calc(100vw - 32px); z-index: 999900 !important; border-radius: 16px; background: linear-gradient(180deg, rgba(24,24,28,0.92), rgba(14,14,18,0.88)); border: 1px solid rgba(255,255,255,0.14); color: #fff !important; box-shadow: 0 16px 48px rgba(0,0,0,0.4); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); overflow: hidden; }",
      // 랜딩(호스트 DOM 마운트)이 히어로를 보여주는 동안에는 배너를 비운다 — 랜딩 자체 CTA 와 겹치기 때문.
      // 정적 DOM 존재가 아니라 **런타임 신호**로 판정한다: 랜딩 스크립트가 실패하면 신호가 안 서고
      // 배너가 정상 노출되므로 CTA 가 하나도 없는 상태가 생기지 않는다.
      ".mw-banner { transition: opacity .28s ease, transform .28s ease; }",
      'html[data-ms-landing-hero="in"] .mw-banner, html[data-ms-landing-modal="open"] .mw-banner { opacity: 0 !important; pointer-events: none !important; transform: translateX(-50%) translateY(12px) !important; }',
      ".mw-banner-inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px 14px 20px; }",
      ".mw-banner-text { min-width: 0; }",
      ".mw-banner-title { font-size: 14px; font-weight: 700; color: rgba(255,255,255,0.95) !important; -webkit-text-fill-color: rgba(255,255,255,0.95) !important; line-height: 1.45; word-break: keep-all; }",
      ".mw-banner-ctas { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }",
      ".mw-banner .mw-btn { padding: 11px 18px; font-size: 13px; }",
      ".mw-banner .mw-btn-secondary { background: rgba(255,255,255,0.09) !important; color: #fff !important; -webkit-text-fill-color: #fff !important; border: 1px solid rgba(255,255,255,0.18) !important; }",
      ".mw-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; animation: mw-pulse 1.5s ease-in-out infinite; }",
      ".mw-live-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; margin-right: 6px; border-radius: 6px; background: rgba(34,197,94,0.16); border: 1px solid rgba(34,197,94,0.32); color: #4ade80 !important; -webkit-text-fill-color: #4ade80 !important; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; }",
      "@keyframes mw-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }",
      ".mw-reg-dot { width: 7px; height: 7px; border-radius: 50%; background: #fbbf24; animation: mw-pulse 1.5s ease-in-out infinite; }",
      ".mw-reg-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; margin-right: 6px; border-radius: 6px; background: rgba(251,191,36,0.16); border: 1px solid rgba(251,191,36,0.32); color: #fbbf24 !important; -webkit-text-fill-color: #fbbf24 !important; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; }",
      /* overlay/shell/body 구조는 PUBLIC_REGISTRATION_FORM_CSS 단일 계약을 쓴다.
         로더는 호스트 페이지 위에 올라가는 z-index 만 소비처 값으로 덮는다. */
      ".mw-modal-overlay { z-index: 999950; }",
      /* 등록 완료 팝업 — 인라인 성공 문구는 폼 아래에 붙어서, 스크롤하지 않으면
         아무 반응이 없는 것처럼 보였다(제출 버튼이 화면 하단이면 문구가 접힌 곳에 생긴다). */
      /* 문구 길이를 가정하지 않는다: successMessage 는 주최측이 쓰는 값이라 길어질 수 있다.
         실측(375×812, 30줄) — max-height 없이는 카드가 1490px 로 자라 제목이 화면 위로(-339px)
         잘리고 확인 버튼이 Y=1125 에 놓여 누를 수 없었다. 그래서 **본문만** 스크롤하고
         체크·제목·확인은 고정한다(시청자 모달 ViewerModal 과 같은 규칙).
         dvh: 모바일 주소창이 접히면 vh 는 실제보다 커서 아래가 잘린다. */
      ".mw-done-card { position: relative; display: flex; flex-direction: column; width: 100%; max-width: 380px; max-height: calc(100dvh - 32px); padding: 32px 26px 26px; border-radius: 16px; background: var(--mw-surface); color: var(--mw-text); box-shadow: 0 24px 64px rgba(0,0,0,0.28); text-align: center; }",
      ".mw-done-mark { flex: none; width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 999px; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb,var(--mw-accent) 14%,var(--mw-surface)); color: var(--mw-accent); font-size: 26px; line-height: 1; }",
      ".mw-done-title { flex: none; margin: 0 0 8px; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }",
      ".mw-done-desc { min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; margin: 0; font-size: 13.5px; line-height: 1.65; color: color-mix(in srgb,var(--mw-text) 68%,transparent); white-space: pre-line; word-break: keep-all; }",
      ".mw-done-btn { flex: none; margin-top: 22px; width: 100%; height: 46px; border: 0; border-radius: 11px; font: inherit; font-size: 14.5px; font-weight: 700; color: var(--mw-on-accent); cursor: pointer; }",
      ".mw-done-cta { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }",
      ".mw-done-close { flex: none; width: 100%; min-height: 44px; margin-top: 8px; border: 0; border-radius: 11px; background: transparent; color: color-mix(in srgb,var(--mw-text) 68%,transparent); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }",
      ".mw-done-close:focus-visible { outline: 2px solid " + t.accent + "; outline-offset: 2px; }",
      // 캘린더 추가는 모바일에서만 — PC 는 네이티브 캘린더 연동이 없어 실효가 낮고 배너만 붐빈다.
      "@media (min-width: 601px) { .mw-banner .mw-btn-cal { display: none !important; } }",
      "@media (max-width: 600px) { .mw-banner { left: 12px !important; right: 12px !important; bottom: 12px !important; width: auto; transform: none !important; } .mw-banner-inner { flex-direction: column; align-items: stretch; gap: 10px; } .mw-banner-ctas { width: 100%; } .mw-banner .mw-btn { flex: 1; } }"
    ].join("\\n");
  }

  /* ── 유틸 ── */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function safeHttpCtaUrl(value) {
    try {
      var parsed = new URL(String(value || ""));
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch (e) {
      return "";
    }
  }
  function mounts(kind) {
    return Array.prototype.slice.call(document.querySelectorAll('[data-mach-webinar-mount="' + kind + '"]'));
  }
  function labels() {
    var c = (CFG && CFG.components) || {};
    var hb = c.heroButton || {};
    return hb.labelByStatus || {};
  }
  function bannerTexts() {
    var c = (CFG && CFG.components) || {};
    var b = c.banner || {};
    return b.textByStatus || {};
  }
  function componentEnabled(name, defaultOn) {
    var c = (CFG && CFG.components) || {};
    var comp = c[name];
    if (!comp || typeof comp.enabled !== "boolean") return defaultOn;
    return comp.enabled;
  }
  function livePageUrl() {
    return (CFG.links && CFG.links.livePageUrl) || (BASE + "/webinar/" + CFG.slug + "/live");
  }
  function surveyUrl() { return (CFG.links && CFG.links.surveyUrl) || ""; }
  function endedMode() {
    var c = (CFG && CFG.components) || {};
    return c.endedMode === "hidden" ? "hidden" : "survey";
  }

  /* ── 캘린더 ── */
  function toGoogleDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().split(".")[0].split("-").join("").split(":").join("") + "Z";
  }
  function openCalendar() {
    try {
      var isMobile = window.innerWidth <= 1024;
      if (isMobile && CFG.ics) {
        var blob = new Blob([CFG.ics], { type: "text/calendar;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = (CFG.name || "webinar") + ".ics";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
      var calUrl = (CFG.links && CFG.links.calendarUrl) || "";
      if (!calUrl) {
        calUrl = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" +
          encodeURIComponent(CFG.name || "Webinar") +
          "&dates=" + toGoogleDate(CFG.liveStartAt) + "/" + toGoogleDate(CFG.liveEndAt) +
          "&ctz=Asia/Seoul";
      }
      window.open(calUrl, "_blank", "noopener");
    } catch (e) { warn("calendar open failed", e); }
  }

  /* ── 등록 폼 ── */
  function buildFormInto(container, opts) {
    clear(container);
    container.classList.add("mw-reset");
    var status = computeStatus();
    var card = el("div", "mw-form-card");
    var titleTarget = opts && opts.titleTarget;
    if (titleTarget) clear(titleTarget);
    function appendTitle(text) {
      var title = el("div", "mw-form-title", text);
      (titleTarget || card).appendChild(title);
    }

    if (status === "ended") {
      appendTitle((CFG.name || "웨비나") + "가 종료되었습니다");
      if (endedMode() === "survey" && surveyUrl()) {
        var sBtn = el("a", "mw-btn mw-btn-primary mw-submit", "만족도 조사 참여하기");
        sBtn.href = surveyUrl();
        sBtn.target = "_blank";
        sBtn.rel = "noopener noreferrer";
        card.appendChild(sBtn);
      }
      container.appendChild(card);
      return;
    }

    if (!canRegisterNow(status)) {
      appendTitle("사전등록이 마감되었습니다");
      if (isEntryOpen(status)) {
        var eBtn = el("a", "mw-btn mw-btn-primary mw-submit", labels().live || "웨비나 입장하기");
        eBtn.href = livePageUrl();
        card.appendChild(eBtn);
      }
      container.appendChild(card);
      return;
    }

    var form = (CFG.registrationForm || {});
    var fields = form.fields || [];
    appendTitle((CFG.name || "웨비나") + " 사전등록");

    var formEl = document.createElement("form");
    formEl.noValidate = true;
    var inputs = {};
    var dupFlags = {}; /* 연락처/이메일 실시간 중복 확인 결과 — true 면 제출 버튼을 막는다 */
    var submitBtn; /* 아래에서 생성 — updateSubmitState 는 클로저로 참조(생성 이후에만 호출됨) */
    function updateSubmitState() {
      if (!submitBtn) return;
      submitBtn.disabled = !!(dupFlags.phone || dupFlags.email);
    }

    for (var i = 0; i < fields.length; i++) {
      (function(field) {
        var wrap = el("div", "mw-field");
        if (field.type === "checkbox") {
          var lab = el("label", "mw-check");
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.setAttribute("data-mw-key", field.key);
          lab.appendChild(cb);
          var span = el("span", "", field.label + (field.required ? " (필수)" : ""));
          lab.appendChild(span);
          wrap.appendChild(lab);
          inputs[field.key] = { el: cb, field: field };
        } else {
          var label = el("label", "mw-label", field.label);
          if (field.required) label.appendChild(el("span", "mw-req", "*"));
          wrap.appendChild(label);
          var input;
          if (field.type === "multiple") {
            /* 복수 선택 — 체크박스 묶음. 값은 고른 것을 ", " 로 합친 문자열이다
               (배열이면 register 라우트가 거부한다 — webinar-config.ts 주석 참고).
               상한에 닿으면 안 고른 칸만 잠근다: 고른 칸은 항상 해제할 수 있어야 빠져나온다. */
            input = document.createElement("div");
            input.className = "mw-multi";
            var mOpts = field.options || [];
            var mMax = (typeof field.maxSelect === "number" && field.maxSelect >= 1 && field.maxSelect < mOpts.length) ? field.maxSelect : 0;
            var boxes = [];
            var otherBox = null, otherText = null;
            var syncLocks = function() {
              if (!mMax) return;
              var n = 0;
              for (var b = 0; b < boxes.length; b++) if (boxes[b].checked) n++;
              if (otherBox && otherBox.checked) n++;
              for (var c = 0; c < boxes.length; c++) boxes[c].disabled = (n >= mMax && !boxes[c].checked);
              if (otherBox) otherBox.disabled = (n >= mMax && !otherBox.checked);
            };
            for (var mi = 0; mi < mOpts.length; mi++) {
              var mLab = el("label", "mw-check");
              var mCb = document.createElement("input");
              mCb.type = "checkbox";
              mCb.value = mOpts[mi];
              mCb.addEventListener("change", syncLocks);
              boxes.push(mCb);
              mLab.appendChild(mCb);
              mLab.appendChild(el("span", "", mOpts[mi]));
              input.appendChild(mLab);
            }
            if (field.allowOther) {
              var oLab = el("label", "mw-check");
              otherBox = document.createElement("input");
              otherBox.type = "checkbox";
              oLab.appendChild(otherBox);
              oLab.appendChild(el("span", "", "기타(직접입력)"));
              input.appendChild(oLab);
              otherText = document.createElement("input");
              otherText.className = "mw-input";
              otherText.type = "text";
              otherText.placeholder = "직접 입력해주세요";
              otherText.style.display = "none";
              otherText.setAttribute("aria-label", field.label + " 직접 입력");
              /* 값은 ", " 로 합쳐 저장된다 — 자유입력의 쉼표는 항목 경계로 오해되어
                 최대 개수 검증이 정상 답변을 거절한다. 입력 시점에 막는다. */
              otherText.addEventListener("input", function() {
                var clean = otherText.value.replace(/,/g, " ");
                if (otherText.value !== clean) otherText.value = clean;
              });
              input.appendChild(otherText);
              otherBox.addEventListener("change", function() {
                otherText.style.display = otherBox.checked ? "" : "none";
                if (!otherBox.checked) otherText.value = "";
                syncLocks();
              });
            }
            if (mMax) input.appendChild(el("div", "mw-hint", "최대 " + mMax + "개까지 선택할 수 있어요"));
            /* 값 읽기를 엔트리에 붙인다 — 아래 수집 루프가 el.value 하나만 읽기 때문이다. */
            input.__mwRead = function() {
              var out = [];
              for (var r = 0; r < boxes.length; r++) if (boxes[r].checked) out.push(boxes[r].value);
              if (otherBox && otherBox.checked && String(otherText.value || "").trim()) out.push(String(otherText.value).trim());
              return out.join(", ");
            };
          } else if (field.type === "select") {
            input = document.createElement("select");
            input.className = "mw-select";
            var empty = document.createElement("option");
            empty.value = "";
            empty.textContent = "선택해주세요";
            input.appendChild(empty);
            var options = field.options || [];
            for (var j = 0; j < options.length; j++) {
              var opt = document.createElement("option");
              opt.value = options[j];
              opt.textContent = options[j];
              input.appendChild(opt);
            }
            if (field.allowOther) {
              /* 기타를 고르면 자유 입력칸이 뜬다. 저장 값은 마커가 아니라 사용자가 쓴 문장이다 —
                 마커를 저장하면 등록자 목록·CSV 에 "기타" 만 남아 아무 정보가 없다. */
              var sOther = document.createElement("option");
              sOther.value = "__mw_other__";
              sOther.textContent = "기타(직접입력)";
              input.appendChild(sOther);
              var sText = document.createElement("input");
              sText.className = "mw-input";
              sText.type = "text";
              sText.placeholder = "직접 입력해주세요";
              sText.style.display = "none";
              sText.setAttribute("aria-label", field.label + " 직접 입력");
              var sel = input;
              sel.addEventListener("change", function() {
                sText.style.display = sel.value === "__mw_other__" ? "" : "none";
                if (sel.value !== "__mw_other__") sText.value = "";
              });
              sel.__mwOtherText = sText;
              sel.__mwRead = function() {
                return sel.value === "__mw_other__" ? String(sText.value || "").trim() : String(sel.value || "");
              };
            }
          } else {
            input = document.createElement("input");
            input.className = "mw-input";
            input.type = field.type === "tel" ? "tel" : field.type === "email" ? "email" : "text";
            /* placeholder 는 저장된 값 그대로 — 하이픈 제거는 입력 '값'에만 적용 */
            input.placeholder = field.placeholder || (field.type === "tel" ? "01012345678" : "");
            if (field.type === "tel") {
              input.inputMode = "numeric";
              input.addEventListener("input", function() {
                var digits = input.value.replace(/[^0-9]/g, "");
                if (input.value !== digits) input.value = digits;
              });
            }
          }
          input.setAttribute("data-mw-key", field.key);
          wrap.appendChild(input);
          if (input.__mwOtherText) wrap.appendChild(input.__mwOtherText);
          inputs[field.key] = { el: input, field: field };

          /* 연락처·이메일 실시간 중복 확인 — 입력이 유효해지면 디바운스 후 조회 */
          if (field.key === "phone" || field.key === "email") {
            var dupNote = el("div", "mw-dup");
            dupNote.style.cssText = "display:none;margin-top:4px;font-size:11px;color:#b45309;";
            wrap.appendChild(dupNote);
            var dupTimer = null;
            var dupSeq = 0; /* 이전 값의 늦은 응답이 지워진 필드에 경고를 세우지 않게 하는 시퀀스 가드 */
            input.addEventListener("input", function() {
              if (dupTimer) clearTimeout(dupTimer);
              var mySeq = ++dupSeq;
              dupNote.style.display = "none";
              dupFlags[field.key] = false;
              updateSubmitState();
              var raw = String(input.value || "");
              var val = field.key === "phone" ? raw.replace(/[^0-9]/g, "") : raw.trim().toLowerCase();
              var ready = field.key === "phone"
                ? (val.length >= ${PHONE_MIN_DIGITS} && val.length <= ${PHONE_MAX_DIGITS})
                : ${EMAIL_REGEX}.test(val);
              if (!ready) return;
              dupTimer = setTimeout(function() {
                var payload = {};
                payload[field.key] = val;
                fetch(BASE + "/api/webinar/" + CFG.slug + "/register/check", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload)
                }).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
                  if (mySeq !== dupSeq) return; /* 그 사이 입력이 바뀜 — 스테일 응답 폐기 */
                  var exists = !!(d && d.exists && d.exists[field.key]);
                  dupFlags[field.key] = exists;
                  updateSubmitState();
                  if (exists) {
                    dupNote.textContent = "이미 사전등록된 " + (field.key === "phone" ? "연락처" : "이메일") + "예요. 웨비나 당일 이 정보로 바로 입장할 수 있어요.";
                    dupNote.style.display = "block";
                  }
                }).catch(function() {});
              }, 600);
            });
          }
        }
        formEl.appendChild(wrap);
      })(fields[i]);
    }

    /* 동의 약관 전문 팝업 — 본문이 설정된 경우 동의 문구 텍스트 클릭으로 연다 */
    function openTerms(title, body, onAgree) {
      var ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;";
      var tCard = document.createElement("div");
      tCard.style.cssText = "background:#fff;color:#111;max-width:520px;width:100%;max-height:70vh;border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.28);padding:20px;display:flex;flex-direction:column;font-size:14px;";
      var th = document.createElement("div");
      th.textContent = title;
      th.style.cssText = "font-weight:700;margin-bottom:10px;";
      var tb = document.createElement("div");
      tb.textContent = body;
      tb.style.cssText = "white-space:pre-wrap;overflow:auto;flex:1;line-height:1.6;color:#444;";
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;margin-top:14px;";
      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "닫기";
      closeBtn.style.cssText = "flex:1;padding:10px;border:1px solid rgba(0,0,0,.15);border-radius:10px;background:#fff;color:#333;font:inherit;cursor:pointer;";
      var agreeBtn = document.createElement("button");
      agreeBtn.type = "button";
      agreeBtn.textContent = "동의합니다";
      agreeBtn.style.cssText = "flex:1;padding:10px;border:0;border-radius:10px;background:#111;color:#fff;font:inherit;font-weight:700;cursor:pointer;";
      function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
      closeBtn.addEventListener("click", close);
      agreeBtn.addEventListener("click", function() { onAgree(); close(); });
      ov.addEventListener("click", function(e) { if (e.target === ov) close(); });
      row.appendChild(closeBtn);
      row.appendChild(agreeBtn);
      tCard.appendChild(th);
      tCard.appendChild(tb);
      tCard.appendChild(row);
      ov.appendChild(tCard);
      document.body.appendChild(ov);
    }
    function consentSpan(text, body, cb) {
      var span = el("span", "", text);
      if (body) {
        span.style.cssText = "text-decoration:underline;text-underline-offset:2px;cursor:pointer;";
        span.addEventListener("click", function(e) {
          e.preventDefault();
          e.stopPropagation();
          openTerms(text, body, function() { cb.checked = true; });
        });
      }
      return span;
    }

    /* 개인정보/마케팅 동의 */
    var privacyLab = el("label", "mw-check");
    var privacyCb = document.createElement("input");
    privacyCb.type = "checkbox";
    privacyCb.checked = form.privacyDefaultChecked === true;
    privacyCb.setAttribute("data-mw-key", "__privacy");
    privacyLab.appendChild(privacyCb);
    privacyLab.appendChild(consentSpan(form.privacyText || "[필수] 개인정보 수집 및 이용에 동의합니다", form.privacyBody || "", privacyCb));
    formEl.appendChild(privacyLab);

    var mktLab = el("label", "mw-check");
    var mktCb = document.createElement("input");
    mktCb.type = "checkbox";
    mktCb.checked = form.marketingDefaultChecked === true;
    mktCb.setAttribute("data-mw-key", "__marketing");
    mktLab.appendChild(mktCb);
    mktLab.appendChild(consentSpan(form.marketingText || "[선택] 마케팅 정보 수신에 동의합니다", form.marketingBody || "", mktCb));
    formEl.appendChild(mktLab);

    /* 제3자 제공 동의 — 쓰는 웨비나만(thirdPartyEnabled) 렌더한다. */
    var tpCb = null;
    if (form.thirdPartyEnabled === true) {
      var tpLab = el("label", "mw-check");
      tpCb = document.createElement("input");
      tpCb.type = "checkbox";
      tpCb.checked = form.thirdPartyDefaultChecked === true;
      tpCb.setAttribute("data-mw-key", "__thirdParty");
      tpLab.appendChild(tpCb);
      tpLab.appendChild(consentSpan(form.thirdPartyText || "[선택] 개인정보 제3자 제공에 동의합니다", form.thirdPartyBody || "", tpCb));
      formEl.appendChild(tpLab);
    }

    /* 허니팟 — 화면 밖 배치, 봇만 채운다 */
    var hp = document.createElement("input");
    hp.type = "text";
    hp.name = "website";
    hp.tabIndex = -1;
    hp.autocomplete = "off";
    hp.setAttribute("aria-hidden", "true");
    hp.style.cssText = "position:absolute;left:-9999px;top:-9999px;height:1px;width:1px;opacity:0;";
    formEl.appendChild(hp);

    submitBtn = el("button", "mw-btn mw-btn-primary mw-submit", form.submitLabel || "사전 등록하기");
    submitBtn.type = "submit";
    formEl.appendChild(submitBtn);
    updateSubmitState(); /* 프리필 등으로 이미 dupFlags 가 채워져 있었을 수 있으니 생성 직후 한 번 반영 */

    var msg = el("div", "mw-msg");
    formEl.appendChild(msg);

    function showMsg(kind, text) {
      msg.className = "mw-msg mw-msg-" + kind;
      msg.textContent = text;
    }

    formEl.addEventListener("submit", function(ev) {
      ev.preventDefault();
      if (submitBtn.disabled) return;

      if (!privacyCb.checked) { showMsg("error", "개인정보 수집 및 이용에 동의해주세요."); return; }
      if (dupFlags.phone || dupFlags.email) {
        showMsg("error", "이미 사전등록된 " + (dupFlags.phone ? "연락처" : "이메일") + "예요. 웨비나 당일 이 정보로 바로 입장할 수 있어요.");
        return;
      }

      var systemBody = {};
      var customBody = {};
      for (var key in inputs) {
        if (!Object.prototype.hasOwnProperty.call(inputs, key)) continue;
        var entry = inputs[key];
        /* 복수 선택·기타 입력은 el.value 하나로 읽을 수 없어 렌더가 붙여 둔 읽기 함수를 쓴다. */
        var value = entry.el.__mwRead
          ? entry.el.__mwRead()
          : entry.field.type === "checkbox" ? (entry.el.checked ? "동의" : "") : String(entry.el.value || "").trim();
        if (entry.field.required && !value) {
          showMsg("error", entry.field.label + " 항목을 입력해주세요.");
          return;
        }
        if (entry.field.system) systemBody[key] = value;
        else customBody[key] = value;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "등록 중...";
      msg.className = "mw-msg";

      var payload = systemBody;
      payload.customFields = customBody;
      payload.agreePrivacy = true;
      payload.agreeMarketing = mktCb.checked;
      payload.agreeThirdParty = tpCb ? tpCb.checked : false;
      payload._hp = hp.value || "";
      payload._utm = buildUtmEnvelope();

      fetch(BASE + "/api/webinar/" + CFG.slug + "/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function(res) {
        return res.json().then(function(data) { return { ok: res.ok, data: data }; });
      }).then(function(result) {
        if (!result.ok) {
          showMsg("error", (result.data && result.data.error) || "등록에 실패했어요. 잠시 후 다시 시도해주세요.");
          /* 서버가 뒤늦게 중복을 판정한 경우(디바운스 레이스) — dupFlags 에도 반영해 계속 막는다 */
          if (result.data && result.data.duplicateField) dupFlags[result.data.duplicateField] = true;
          submitBtn.textContent = form.submitLabel || "사전 등록하기";
          updateSubmitState();
          return;
        }
        var c = (CFG.components || {});
        var fw = c.formWidget || {};
        /* 팝업으로 알린다(openDonePopup 주석 참고). 인라인 문구도 남긴다 — 팝업을 닫은 뒤
           폼 자리에 아무 흔적이 없으면 "등록됐나?" 를 다시 묻게 된다. */
        var doneText = fw.successMessage || "웨비나 당일 등록하신 연락처·이메일로 바로 입장할 수 있어요.";
        showMsg("success", doneText);
        formEl.querySelectorAll("input, select, button").forEach(function(node) { node.disabled = true; });
        submitBtn.textContent = "등록 완료";
        openDonePopup(doneText, card);
        if (opts && opts.onSuccess) opts.onSuccess();
      }).catch(function() {
        showMsg("error", "네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.");
        submitBtn.disabled = false;
        submitBtn.textContent = form.submitLabel || "사전 등록하기";
      });
    });

    // 재렌더 시 작성 중이던 입력값 복원 (경계 통과·문구 수정으로 폼이 다시 그려져도 유실 방지)
    if (opts && opts.prefill) {
      try {
        var pf = opts.prefill;
        var nodes = formEl.querySelectorAll("[data-mw-key]");
        for (var r = 0; r < nodes.length; r++) {
          var rk = nodes[r].getAttribute("data-mw-key");
          if (pf[rk] === undefined) continue;
          if (nodes[r].type === "checkbox") nodes[r].checked = !!pf[rk];
          else nodes[r].value = pf[rk];
        }
      } catch (e) {}
    }

    card.appendChild(formEl);
    container.appendChild(card);
  }

  function snapshotForm(container) {
    var snap = {};
    try {
      var nodes = container.querySelectorAll("[data-mw-key]");
      for (var i = 0; i < nodes.length; i++) {
        var k = nodes[i].getAttribute("data-mw-key");
        snap[k] = nodes[i].type === "checkbox" ? nodes[i].checked : nodes[i].value;
      }
    } catch (e) {}
    return snap;
  }

  /* ── 폼 모달 (폼 마운트가 없는 페이지에서 등록 CTA 클릭 시) ──
     배너 CTA 와 랜딩 히어로 CTA 가 같이 쓴다(machstudio:open-register). 랜딩의 세션 팝업과
     같은 수준으로 동작해야 하므로 배경 스크롤 잠금·ESC·포커스를 여기서 책임진다.
     (예전엔 셋 다 없어서 팝업 뒤 페이지가 그대로 스크롤됐다.)
     배너는 따로 감추지 않는다 — 오버레이(999950)가 배너(999900)보다 위라 이미 덮인다. */
  var lockSavedStyle = null;
  var lockSavedY = 0;
  var scrollLocked = false;
  var modalKeyHandler = null;
  var doneKeyHandler = null;
  var modalOpener = null;

  function lockPageScroll() {
    if (scrollLocked) return;
    /* 랜딩 팝업이 이미 잠근 상태면 손대지 않는다 — 두 번 잠그면 복원 값이 엉킨다 */
    if (document.documentElement.getAttribute("data-ms-landing-modal") === "open") return;
    var b = document.body;
    lockSavedY = window.scrollY || document.documentElement.scrollTop || 0;
    lockSavedStyle = b.getAttribute("style");
    b.style.position = "fixed";
    b.style.top = (-lockSavedY) + "px";
    b.style.left = "0";
    b.style.right = "0";
    b.style.width = "100%";
    b.style.overflow = "hidden";
    scrollLocked = true;
  }
  function unlockPageScroll() {
    if (!scrollLocked) return;
    var b = document.body;
    /* style 속성을 통째로 되돌린다 — 호스트가 body 에 걸어 둔 인라인 스타일을 지우지 않기 위해 */
    if (lockSavedStyle === null) b.removeAttribute("style");
    else b.setAttribute("style", lockSavedStyle);
    scrollLocked = false;
    window.scrollTo(0, lockSavedY);
  }

  var FOCUSABLE = "input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href]";

  function closeFormModal() {
    var overlay = document.getElementById("mw-form-modal");
    /* display:none 으로 닫는다 — DOM 과 입력값을 살려 두어 다시 열면 이어서 쓸 수 있다 */
    if (overlay) overlay.style.display = "none";
    if (modalKeyHandler) {
      document.removeEventListener("keydown", modalKeyHandler, true);
      modalKeyHandler = null;
    }
    unlockPageScroll();
    if (modalOpener && document.contains(modalOpener)) {
      try { modalOpener.focus(); } catch (e) {}
    }
    modalOpener = null;
  }

  /* 완료 팝업은 폼 모달의 다음 화면이다. 폼을 숨긴 채 키 리스너를 남기면 Tab/Escape 가
     보이지 않는 폼으로 새어 나가므로, 완료 팝업이 열리기 전에 DOM과 캡처 리스너를 함께 제거한다.
     스크롤 잠금은 완료 팝업이 그대로 이어받아 닫을 때 한 번만 해제한다. */
  function releaseFormModalForCompletion() {
    var overlay = document.getElementById("mw-form-modal");
    if (!overlay) return;
    if (modalKeyHandler) {
      document.removeEventListener("keydown", modalKeyHandler, true);
      modalKeyHandler = null;
    }
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function activateFormModal(overlay) {
    lockPageScroll();
    modalKeyHandler = function(ev) {
      if (ev.key === "Escape") { ev.stopPropagation(); closeFormModal(); return; }
      if (ev.key !== "Tab") return;
      /* 포커스를 모달 안에 가둔다 — 없으면 Tab 이 오버레이 뒤 호스트 페이지로 새어 나간다 */
      var items = Array.prototype.slice.call(overlay.querySelectorAll(FOCUSABLE)).filter(function(n) {
        return n.offsetParent !== null || n === document.activeElement;
      });
      if (!items.length) { ev.preventDefault(); return; }
      var first = items[0], last = items[items.length - 1];
      if (ev.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
        ev.preventDefault(); last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", modalKeyHandler, true);
    var firstField = overlay.querySelector("input:not([type=hidden]):not([disabled]),select,textarea");
    try { (firstField || overlay.querySelector(".mw-modal-close")).focus(); } catch (e) {}
  }

  function openFormModal() {
    /* config 전이면 열지 않는다 — buildFormInto 가 CFG 를 읽어 throw 하고, 빈 오버레이만 남는다.
       (배너·히어로 버튼은 config 후에만 생기지만 openRegister 는 외부에서 언제든 불릴 수 있다) */
    if (!CFG) return;
    modalOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    var existing = document.getElementById("mw-form-modal");
    if (existing) { existing.style.display = "flex"; activateFormModal(existing); return; }
    var overlay = el("div", "mw-modal-overlay mw-reset");
    overlay.id = "mw-form-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", (CFG && CFG.name ? CFG.name + " " : "") + "사전등록");
    var cardWrap = el("div", "mw-modal-card");
    var modalHead = el("div", "mw-modal-head");
    var titleTarget = el("div", "");
    var closeBtn = el("button", "mw-modal-close", "\\u00d7");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "닫기");
    closeBtn.addEventListener("click", closeFormModal);
    overlay.addEventListener("click", function(ev) { if (ev.target === overlay) closeFormModal(); });
    modalHead.appendChild(titleTarget);
    modalHead.appendChild(closeBtn);
    cardWrap.appendChild(modalHead);
    var formHost = el("div", "mw-modal-body");
    cardWrap.appendChild(formHost);
    overlay.appendChild(cardWrap);
    document.body.appendChild(overlay);
    buildFormInto(formHost, { titleTarget: titleTarget });
    activateFormModal(overlay);
  }

  /**
   * 등록 완료 팝업.
   *
   * 왜 인라인 문구를 버렸나: 성공 문구가 폼 **아래**에 생겨서, 제출 버튼이 화면 하단에 있으면
   * 문구가 접힌 영역에 나타난다. 그러면 눌렀는데 아무 반응이 없는 것처럼 보이고 다시 누른다
   * (그러면 중복 안내를 만난다). 자체 페이지의 완료 팝업과 같은 판단이다.
   *
   * 폼 모달 위에도 뜰 수 있어야 하므로 z-index 를 폼 모달(999950)보다 높게 잡는다.
   * 자동으로 닫지 않는다 — 시간으로 닫으면 봤는지를 보장할 수 없다.
   */
  function openDonePopup(message, inlineRestoreTarget) {
    var accent = theme().accent;
    var form = CFG.registrationForm || {};
    var successCta = form.successCta || {};
    var successCtaUrl = safeHttpCtaUrl(successCta.url);
    var showCta = successCta.enabled === true && !!String(successCta.label || "").trim() && !!successCtaUrl;
    /**
     * 확인(또는 닫기)이 이동할 주소. 비면 종전처럼 모달만 닫는다.
     * 자체 대기 화면(live/page.tsx confirmCompletion)과 **같은 규칙**이어야 한다 — 한 사람이
     * 랜딩에서 등록했는지 대기 화면에서 등록했는지에 따라 다음 걸음이 달라지면 안 된다.
     * 서버(embed config)가 safeHttpUrl 로 걸러 보내지만, 로더가 다른 소비처에서도 쓰이므로
     * 여기서 한 번 더 통과시킨다(javascript: 방어).
     */
    var redirectUrl = safeHttpCtaUrl(form.successRedirectUrl);
    var restoreTarget = modalOpener;
    if (!restoreTarget && inlineRestoreTarget && document.contains(inlineRestoreTarget)) {
      inlineRestoreTarget.setAttribute("tabindex", "-1");
      restoreTarget = inlineRestoreTarget;
    }
    releaseFormModalForCompletion();
    lockPageScroll();
    var overlay = el("div", "mw-modal-overlay mw-reset");
    overlay.style.zIndex = "999955";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "사전등록 완료");
    var card = el("div", "mw-done-card");
    card.appendChild(el("div", "mw-done-mark", "\u2713"));
    card.appendChild(el("p", "mw-done-title", "사전등록이 완료됐어요"));
    card.appendChild(el("p", "mw-done-desc", message));
    function close() {
      modalOpener = null;
      if (doneKeyHandler) {
        document.removeEventListener("keydown", doneKeyHandler, true);
        doneKeyHandler = null;
      }
      try { overlay.remove(); } catch (e) {}
      unlockPageScroll();
      if (restoreTarget && document.contains(restoreTarget)) {
        try { restoreTarget.focus(); } catch (e) {}
      }
    }
    /* 목적지가 있으면 같은 탭에서 이동한다. CTA(새 탭)와 달리 이건 다음 걸음이다. */
    function confirmDone() {
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
      close();
    }
    var focusTarget;
    if (showCta) {
      var cta = el("a", "mw-done-btn mw-done-cta", String(successCta.label).trim());
      cta.href = successCtaUrl;
      cta.target = "_blank";
      cta.rel = "noopener noreferrer";
      cta.style.background = accent;
      cta.style.color = theme().onAccent;
      card.appendChild(cta);

      var closeBtn = el("button", "mw-done-close", "닫기");
      closeBtn.type = "button";
      closeBtn.addEventListener("click", confirmDone);
      card.appendChild(closeBtn);
      focusTarget = cta;
    } else {
      var ok = el("button", "mw-done-btn", "확인");
      ok.type = "button";
      ok.style.background = accent;
      ok.style.color = theme().onAccent;
      ok.addEventListener("click", confirmDone);
      card.appendChild(ok);
      focusTarget = ok;
    }
    overlay.addEventListener("click", function(ev) { if (ev.target === overlay) close(); });
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    doneKeyHandler = function(ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        close();
        return;
      }
      if (ev.key !== "Tab") return;
      var items = Array.prototype.slice.call(card.querySelectorAll(FOCUSABLE)).filter(function(node) {
        return !node.disabled;
      });
      if (!items.length) { ev.preventDefault(); return; }
      var first = items[0], last = items[items.length - 1];
      if (ev.shiftKey && (document.activeElement === first || !card.contains(document.activeElement))) {
        ev.preventDefault(); last.focus();
      } else if (!ev.shiftKey && (document.activeElement === last || !card.contains(document.activeElement))) {
        ev.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", doneKeyHandler, true);
    try { focusTarget.focus(); } catch (e) {}
  }

  /* 랜딩 런타임(/w/l/{slug})은 별도 번들이라 함수를 직접 못 부른다 → 문서 이벤트로 연결한다.
     cancelable: 우리가 처리하면 preventDefault 로 알린다. 로더가 없는 페이지(단독 랜딩·미리보기)
     에서는 아무도 처리하지 않아 랜딩이 기존 링크 이동으로 폴백한다. */
  document.addEventListener("machstudio:open-register", function(ev) {
    try {
      if (!CFG) return;          /* 아직 config 로딩 전 — 링크 이동에 맡긴다 */
      /* 이벤트에 slug 가 실려 있고 이 로더의 웨비나와 다르면(파트너 페이지에 다른 웨비나의
         랜딩이 함께 붙어 있는 경우) 손대지 않고 반환한다 — preventDefault 를 안 하면 랜딩이
         자기 href 로 폴백해 올바른 웨비나로 이동한다. slug 가 없는 옛 이벤트는 그대로 처리한다. */
      if (ev.detail && ev.detail.slug && ev.detail.slug !== CFG.slug) return;
      openFormModal();
      if (ev.cancelable) ev.preventDefault();
    } catch (e) { warn("open-register failed", e); }
  });

  function goRegister() {
    var formMounts = mounts("register-form");
    if (formMounts.length) {
      try { formMounts[0].scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) { formMounts[0].scrollIntoView(); }
      return;
    }
    openFormModal();
  }

  /* ── 히어로 버튼 ── */
  function renderHero() {
    var heroMounts = mounts("hero-button");
    if (!heroMounts.length || !componentEnabled("heroButton", true)) return;
    var status = computeStatus();
    var entry = isEntryOpen(status);
    var lb = labels();

    heroMounts.forEach(function(mount) {
      clear(mount);
      mount.classList.add("mw-reset");
      var row = el("div", "mw-hero");

      if (status === "ended") {
        var c = (CFG.components || {});
        var hb = c.heroButton || {};
        var links = Array.isArray(hb.endedLinks) ? hb.endedLinks : [];
        if (!links.length && endedMode() === "survey" && surveyUrl()) {
          links = [{ label: "만족도 조사 참여하기", url: surveyUrl(), style: "primary" }];
        }
        links.forEach(function(link) {
          if (!link || !link.url || !link.label) return;
          var a = el("a", "mw-btn " + (link.style === "secondary" ? "mw-btn-secondary" : "mw-btn-primary"), link.label);
          a.href = link.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          row.appendChild(a);
        });
      } else if (entry) {
        var enterBtn = el("a", "mw-btn mw-btn-primary", lb.live || "웨비나 입장하기");
        enterBtn.href = livePageUrl();
        row.appendChild(enterBtn);
        if (canRegisterNow(status)) {
          var regBtn2 = el("button", "mw-btn mw-btn-secondary", lb.registration || "사전등록하기");
          regBtn2.type = "button";
          regBtn2.addEventListener("click", goRegister);
          row.appendChild(regBtn2);
        }
      } else if (canRegisterNow(status)) {
        var regBtn = el("button", "mw-btn mw-btn-primary", lb.registration || "웨비나 사전등록");
        regBtn.type = "button";
        regBtn.addEventListener("click", goRegister);
        row.appendChild(regBtn);
      } else {
        row.appendChild(el("span", "mw-btn mw-btn-disabled", lb.upcoming || "사전등록 마감"));
      }

      mount.appendChild(row);
    });
  }

  /* ── 등록 폼 마운트 ── */
  function renderForms() {
    if (!componentEnabled("formWidget", true)) return;
    mounts("register-form").forEach(function(mount) {
      buildFormInto(mount, { prefill: snapshotForm(mount) });
    });
  }

  /* ── 라이브 iframe ── */
  function renderLive() {
    var liveMounts = mounts("live");
    if (!liveMounts.length) return;
    liveMounts.forEach(function(mount) {
      // slug 기준 가드 — activeWebinar 전환(전시 교체)이 config 로 오면 iframe 을 새 슬러그로 재렌더.
      if (mount.getAttribute("data-mw-slug") === CFG.slug) return;
      mount.setAttribute("data-mw-slug", CFG.slug);
      clear(mount);
      var frame = document.createElement("iframe");
      frame.className = "mw-live-frame";
      frame.src = BASE + "/webinar/" + CFG.slug + "/live";
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";
      frame.setAttribute("allowfullscreen", "true");
      mount.appendChild(frame);
      window.addEventListener("message", function(ev) {
        try {
          // 이 프레임이 보낸 메시지만 신뢰 — 호스트 페이지의 다른 iframe/스크립트 위조 차단
          if (ev.source !== frame.contentWindow) return;
          var data = ev.data;
          if (data && data.type === "mach-resize" && typeof data.height === "number" && data.height > 200) {
            frame.style.height = Math.ceil(data.height) + "px";
          }
        } catch (e) {}
      });
    });
  }

  /* ── 하단 배너 ── */
  function bannerDismissKey(status) { return "mw_banner_off_" + SITE_ID + "_" + status; }
  function renderBanner() {
    var old = document.getElementById("mw-banner");
    if (old) old.parentNode.removeChild(old);

    if (mounts("live").length) return;
    if (!componentEnabled("banner", true)) return;
    if (!bannerAllowedOnPage()) return;

    var status = computeStatus();
    var entry = isEntryOpen(status);
    var c = (CFG.components || {});
    var bc = c.banner || {};
    var texts = bannerTexts();

    // 설문 링크가 없어도 "종료됐다"는 안내는 남긴다(아래에서 설문 버튼만 조건부로 붙인다).
    // 예전엔 !surveyUrl() 이면 배너를 포기해서, 어드민이 편집한 종료 문구가 영원히 렌더되지 않았다.
    if (status === "ended" && endedMode() === "hidden") return;
    try { if (bc.dismissible !== false && sessionStorage.getItem(bannerDismissKey(status))) return; } catch (e) {}

    var banner = el("div", "mw-banner mw-reset");
    banner.id = "mw-banner";
    var inner = el("div", "mw-banner-inner");
    var textArea = el("div", "mw-banner-text");
    var title = el("div", "mw-banner-title");
    var ctas = el("div", "mw-banner-ctas");

    if (status === "ended") {
      title.textContent = texts.ended || ((CFG.name || "웨비나") + "가 종료되었습니다. 참여해주셔서 감사합니다!");
      if (surveyUrl()) {
        var sv = el("a", "mw-btn mw-btn-primary", "만족도 조사 참여하기");
        sv.href = surveyUrl();
        sv.target = "_blank";
        sv.rel = "noopener noreferrer";
        ctas.appendChild(sv);
      }
    } else if (entry) {
      var badge = el("span", "mw-live-badge");
      badge.appendChild(el("span", "mw-live-dot"));
      badge.appendChild(document.createTextNode(status === "live" ? "LIVE" : "OPEN"));
      title.appendChild(badge);
      title.appendChild(document.createTextNode(
        texts.live || ((CFG.name || "웨비나") + (status === "live" ? "가 지금 진행 중입니다!" : " 입장이 시작됐어요!"))
      ));
      if (canRegisterNow(status)) {
        var rBtn = el("button", "mw-btn mw-btn-secondary", "사전등록");
        rBtn.type = "button";
        rBtn.addEventListener("click", openFormModal);
        ctas.appendChild(rBtn);
      }
      var goBtn = el("a", "mw-btn mw-btn-primary", "웨비나 입장하기");
      goBtn.href = livePageUrl();
      ctas.appendChild(goBtn);
    } else if (canRegisterNow(status)) {
      // 등록 중: 사전등록만 강조(입장 버튼은 오픈 전이므로 노출하지 않음). 앰버 펄스 배지로 "접수 중" 표시.
      var regBadge = el("span", "mw-reg-badge");
      regBadge.appendChild(el("span", "mw-reg-dot"));
      regBadge.appendChild(document.createTextNode("사전등록"));
      title.appendChild(regBadge);
      title.appendChild(document.createTextNode(
        texts.registration || ((CFG.name || "웨비나") + " 사전등록이 진행 중입니다.")
      ));
      if (bc.showCalendarButton !== false) {
        var calBtn = el("button", "mw-btn mw-btn-secondary mw-btn-cal", "캘린더 추가");
        calBtn.type = "button";
        calBtn.addEventListener("click", openCalendar);
        ctas.appendChild(calBtn);
      }
      var regBtn = el("button", "mw-btn mw-btn-primary", "웨비나 사전등록");
      regBtn.type = "button";
      regBtn.addEventListener("click", openFormModal);
      ctas.appendChild(regBtn);
    } else {
      title.textContent = texts.upcoming || ((CFG.name || "웨비나") + "가 곧 시작됩니다.");
      if (bc.showCalendarButton !== false) {
        /* mw-btn-cal(PC 숨김)을 붙이지 않는다 — 이 분기에선 캘린더가 유일한 액션이라
           숨기면 버튼 0개인 배너가 남는다. 사전등록 중 배너처럼 다른 CTA 가 있을 때만 숨긴다. */
        var calBtn2 = el("button", "mw-btn mw-btn-secondary", "캘린더 추가");
        calBtn2.type = "button";
        calBtn2.addEventListener("click", openCalendar);
        ctas.appendChild(calBtn2);
      }
    }

    if (!textArea.firstChild) textArea.appendChild(title);
    inner.appendChild(textArea);
    inner.appendChild(ctas);
    banner.appendChild(inner);

    document.body.appendChild(banner);
  }


  /* ── 렌더 오케스트레이션 ── */
  function renderAll() {
    if (!CFG) return;
    var status = computeStatus();
    var key = status + "|" + (isEntryOpen(status) ? "1" : "0") + "|" + (CFG.updatedKey || "");
    injectStyles();
    renderLive();
    if (key === lastRenderKey) return;
    lastRenderKey = key;
    renderHero();
    renderForms();
    renderBanner();
  }

  function scheduleBoundary() {
    if (boundaryTimer) clearTimeout(boundaryTimer);
    if (!CFG) return;
    var now = serverNowMs();
    var candidates = [parseMs(CFG.entryOpenAt), parseMs(CFG.liveStartAt), parseMs(CFG.liveEndAt), parseMs(CFG.signupDeadline)];
    var next = null;
    for (var i = 0; i < candidates.length; i++) {
      var t = candidates[i];
      if (t !== null && t > now && (next === null || t < next)) next = t;
    }
    if (next === null) return;
    var delay = Math.min(next - now + 1000, 12 * 60 * 60 * 1000);
    boundaryTimer = setTimeout(function() {
      renderAll();
      fetchConfig(true);
      scheduleBoundary();
    }, delay);
  }

  function inLiveWindow() {
    if (!CFG) return false;
    var now = serverNowMs();
    var start = parseMs(CFG.liveStartAt);
    var end = parseMs(CFG.liveEndAt);
    if (start === null || end === null) return false;
    return now >= start - LIVE_WINDOW_PAD_MS && now <= end + LIVE_WINDOW_PAD_MS;
  }
  function schedulePolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function() {
      if (inLiveWindow()) fetchConfig(true);
    }, LIVE_POLL_MS);
  }

  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState !== "visible") return;
    var now = Date.now();
    if (now - lastVisRefetchAt < VIS_REFETCH_THROTTLE_MS) return;
    lastVisRefetchAt = now;
    fetchConfig(true);
  });

  /* ── 부트 ── */
  function boot() {
    try {
      sendSeen();
      initConfig();
    } catch (e) { warn("boot failed", e); }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.MachWebinar = {
    refresh: function() { fetchConfig(true); },
    openRegister: function() { openFormModal(); },
    getState: function() { return { cfg: CFG, status: computeStatus(), entryOpen: CFG ? isEntryOpen(computeStatus()) : null }; }
  };
})();`;
}
