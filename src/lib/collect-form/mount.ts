/**
 * 등록 폼 마운트 — **하나뿐인 렌더러**(설계 §16.1).
 *
 * 세 소비처가 전부 이 함수를 탄다:
 *  · 아임웹 임베드 (`/f/{id}` 번들 → form-entry.boot)
 *  · 미리보기 링크 (`/p/{previewToken}`)
 *  · 빌더 옆칸 미리보기 (어드민)
 * 미리보기 전용 렌더러를 따로 두면 "미리보기와 실제가 다르다" 가 반드시 생긴다.
 *
 * React 를 쓰지 않는다 — 이 파일은 esbuild 로 번들되어 남의 사이트 문서에서 돈다.
 * DOM 은 `h()` 로만 만든다(innerHTML 금지 — src/lib/__tests__/embed-runtime.test.ts 가 강제).
 */
import { h, clearNode } from "@/lib/dom/h";
import { safeRichTextFragment } from "@/lib/dom/safe-rich-text";
import { onAccentColor } from "@/lib/competition-render";
import { ensureFormStyles } from "./css";
import {
  DEFAULT_LOCALE,
  REGISTRATION_STATUSES,
  canonicalBranchValue,
  companionTicketExtras,
  localize,
  noticeValueKey,
  resolveRegistrationPhase,
  resolveRegistrationStatus,
  validateSubmission,
  visibleFields,
  type CollectField,
  type CollectFormConfig,
  type Localized,
  type RegistrationStatus,
  type SubmissionIssue,
} from "@/lib/collect-form-config";
import { isValidCollectEmail } from "@/lib/collect-email";
import { COUNTRY_DIALS, flagEmoji, isKnownCountry } from "@/lib/collect-country";
import { resolveRedirect } from "@/lib/collect-redirect";

function safeHttpUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}
// 로더가 심어 둔 first-touch UTM 을 그대로 쓴다 — 파트너 사이트를 먼저 거친 방문자의 정본이다.
import { buildUtmEnvelope } from "@/lib/attribution-client";
import { resolveVisitorBadgeLabel, visitorBadgeCssVars, visitorBadgePalette } from "@/lib/collect-badge";
import { downloadTicketImage } from "./ticket-image";
import type { FormOverlayOpener, FormOverlaySlot } from "@/lib/collect-form/target-registry";
import { deepActiveElement } from "@/lib/dom/focus";


/**
 * 미리보기 완료 화면에 쓰는 더미 등록번호(설계 §16.1 "화면 확인용 더미 번호로 렌더").
 *
 * **체크digit 이 실제로 틀린 값이어야 한다** — 이 번호가 어딘가로 새어 나가 현장 조회에
 * 쓰이면 "없는 번호" 가 아니라 "잘못 입력하셨어요" 로 걸러진다.
 * 예전 값 `0000000000000` 은 Luhn 을 **통과했다**(0 이 올바른 체크digit 이다).
 */
const PREVIEW_REG_NO = "0000000000001";

function maskedEmail(value: string): string {
  const raw = value.trim();
  const at = raw.lastIndexOf("@");
  return at < 1 ? "" : `${raw[0]}•••${raw.slice(at)}`;
}

function maskedPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length < 8 ? "" : `•••••• ${digits.slice(-4)}`;
}

/** 안내 문구 — 로케일 대응은 §11 이후. 지금은 영어 단일 전시(LA)라 화면 문구도 여기 모은다. */
const COPY = {
  before: { title: "Registration hasn't opened yet", body: "The form will appear here once registration opens." },
  closed: { title: "Registration is closed", body: "On-site registration is available at the venue." },
  /** 운영 일정 — 사전등록 마감 뒤, 다음 현장등록 전. {next} 자리에 현지 시각이 들어간다(운영자가 문구를 바꿀 수 있다) */
  between: { title: "Pre-registration is closed", body: "On-site registration opens {next}. Please register at the venue." },
  submit: "Register",
  submitting: "Submitting…",
  empty: "This form has no fields yet.",
  required: "Required",
  invalidEmail: "Check the email format",
  invalidPhone: "This number isn't valid for the selected country",
  invalidNumber: "Numbers only",
  unknownKey: "Not part of this form",
  tooMany: "Too many selected",
  notAnOption: "Not one of the options",
  consentRequired: "Please agree to continue",
  duplicate: "This email is already registered.",
  networkError: "Couldn't submit. Please try again.",
  closedNow: "Registration just closed.",
  notOpenYet: "Registration hasn't opened yet.",
  doneTitle: "You're registered",
  checkinTitle: "Show this QR code at the check-in desk",
  checkinBodyWithEmail: "You can also find the same QR code in your confirmation email.",
  regNoLabel: "Registration number — show this at the venue",
  previewFlag: "Preview — nothing is saved",
  ticketLink: "Open my ticket page →",
  saveImage: "Save as Image",
  saveHint: "* If the button doesn't work, please take a screenshot.",
  previewDone: "Sample number — nothing was saved.",
  more: "Details",
  less: "Hide",
  close: "Close",
  agree: "I agree",
  period: "Period",
  venue: "Venue",
  openingHours: "Opening Hours",
} as const;

const ISSUE_COPY: Record<SubmissionIssue["code"], string> = {
  required: COPY.required,
  invalid_email: COPY.invalidEmail,
  invalid_phone: COPY.invalidPhone,
  invalid_number: COPY.invalidNumber,
  unknown_key: COPY.unknownKey,
  too_many: COPY.tooMany,
  not_an_option: COPY.notAnOption,
  consent_required: COPY.consentRequired,
};

export interface MountCollectFormOptions {
  mount: HTMLElement;
  config: CollectFormConfig;
  /** 제출·중복확인 절대 URL 의 기준. 임베드는 호스트 도메인에서 돌아 상대경로가 깨진다. */
  origin: string;
  sourceId: string;
  /**
   * 미리보기 — **부작용을 전부 막는다**(설계 §16.1). 저장·dataLayer 가 꺼지고,
   * 검증은 실제와 똑같이 돌린 뒤 저장 직전에 멈춘다. 중복확인 조회만 허용(읽기 전용).
   */
  preview?: boolean;
  /** 미리보기에서 상태를 강제로 본다(?status=). */
  forceStatus?: RegistrationStatus;
  /** 미리보기에서 특정 유형 문항이 펼쳐진 상태로 연다(?type=). */
  forceType?: string;
  locale?: string;
  /**
   * 서버가 스크립트에 실어 보낸 시각(ISO). 상태 판정을 **방문자 시계로 하지 않는다** —
   * 기기 시계가 틀어져 있으면 마감된 폼이 열리거나 열린 폼이 마감으로 보인다.
   */
  serverNow?: string | null;
  /** 응답이 CDN 캐시에 머문 시간(ms). serverNow 가 그만큼 과거라 되돌린다. */
  ageMs?: number;
  /**
   * 스타일을 넣을 루트. 홈페이지 섹션은 자기 ShadowRoot 를 준다 — 문서 head 에 넣으면
   * Shadow 안까지 닿지 않아 폼이 스타일 없이 그려진다. 안 주면 문서(지금까지와 같다).
   */
  styleRoot?: Document | ShadowRoot;
  /**
   * 전문 팝업을 놓을 자리를 빌려 준다. 안 주면 `document.body` — 지금까지의 동작이다.
   * Shadow 안에서 도는 경우(홈페이지 구획) 이걸 안 받으면 팝업이 **스타일을 하나도
   * 못 받은 채** 파트너 문서 맨 아래에 그려진다.
   */
  overlay?: FormOverlayOpener;
}

export interface CollectFormHandle {
  destroy(): void;
}

/** 스타일은 문서당 1벌. 폼이 두 개 붙어도 한 번만 넣는다. */


/**
 * dataLayer 단일 창구(설계 §18). Meta 픽셀·Google Ads 를 직접 부르지 않는다 —
 * 픽셀 ID 가 코드에 박히면 전시·계정마다 배포가 필요해진다.
 * **미리보기에서는 절대 발화하지 않는다** — 미리보기 클릭이 광고 전환으로 잡히면 데이터가 오염된다.
 */
type DataLayerWindow = Window & { dataLayer?: unknown[] };
function track(preview: boolean, event: string, params?: Record<string, unknown>): void {
  if (preview) return;
  try {
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer ?? [];
    w.dataLayer.push({ event, ...(params ?? {}) });
  } catch {
    /* 호스트를 깨뜨리지 않는다 */
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * 동의 전문 팝업 — 대회 폼(competition-entry.ts bindConsentPopups)·웨비나 로더(openTerms)와
 * 같은 패턴으로 맞춘다. 이 폼만 인라인 드롭다운이면 같은 방문자가 폼마다 다른 상호작용을
 * 겪는다. `document.body` 에 새 루트로 붙는 이유는 이 폼 자체가 호스트 문서 흐름 안에
 * 그대로 놓이기 때문 — 오버레이가 그 흐름 안에 있으면 부모의 overflow/position 에 잘린다.
 * `.msf` 리셋을 다시 받아야 해서 클래스에 msf 를 같이 건다(css.ts 주석 참고).
 */
function openTermsPopup(
  title: string,
  body: string,
  format: "text" | "html",
  onAgree: () => void,
  themeStyle: Record<string, string | null>,
  open?: FormOverlayOpener,
): () => void {
  const closeBtn = h("button", { type: "button", class: "msf-terms-close" }, COPY.close);
  const agreeBtn = h("button", { type: "button", class: "msf-terms-agree" }, COPY.agree);
  const bodyEl = h("div", { class: "msf-terms-body" });
  if (format === "html") bodyEl.appendChild(safeRichTextFragment(body));
  else bodyEl.appendChild(document.createTextNode(body));
  const overlay = h(
    "div",
    { class: "msf msf-overlay", style: themeStyle },
    h(
      "div",
      { class: "msf-terms" },
      h("div", { class: "msf-terms-head" }, title),
      bodyEl,
      h("div", { class: "msf-terms-actions" }, closeBtn, agreeBtn),
    ),
  );

  /** 열기 전에 잡아 둔다 — 닫을 때 여기로 포커스를 돌려준다. */
  const opener = deepActiveElement(document) as HTMLElement | null;
  let slot: FormOverlaySlot | null = null;
  let closed = false;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  function close(): void {
    if (closed) return;                 // 멱등 — 이중 해제가 무해한 no-op
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    const s = slot; slot = null;        // 먼저 비우고 반납한다(재진입 순서)
    s?.release();
    if (opener && opener.isConnected) {
      try { opener.focus({ preventScroll: true }); } catch { /* 호스트를 깨뜨리지 않는다 */ }
    }
  }

  closeBtn.addEventListener("click", close);
  agreeBtn.addEventListener("click", () => { onAgree(); close(); });

  slot = open ? open(() => { slot = null; close(); }) : null;

  if (slot) {
    /**
     * **빌린 자리** — 레이어가 이미 화면을 덮고 있다(`.msx-portal` 은 fixed·inset:0·
     * 스크림·가운데 정렬). 여기서 또 깔면 스크림이 두 겹이 되고 패딩이 겹친다.
     * 그래서 **레이어 쪽을 중화**하고 `.msf-overlay` 자신의 fixed·스크림·max-height 는
     * 한 글자도 안 건드린다 — 그래야 두 경로의 모양이 같다.
     */
    slot.layer.setAttribute("data-msx-bare", "1");
    slot.layer.style.background = "none";
    slot.layer.style.padding = "0";
    slot.layer.style.display = "block";
    ensureFormStyles(slot.root);        // ★ Shadow 안에서도 스타일이 닿는다
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    slot.layer.appendChild(overlay);
  } else {
    // ── 문서 경로(단독 /f · 아임웹 직접 임베드): 지금까지와 똑같다 ──
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  document.addEventListener("keydown", onKey, true);
  return close;
}

export function mountCollectForm(opts: MountCollectFormOptions): CollectFormHandle {
  ensureFormStyles(opts.styleRoot);

  const { config, mount } = opts;
  /**
   * 지금 열려 있는 전문 팝업을 닫는 함수. **인스턴스 스코프다** — 한 페이지에 폼이
   * 둘일 수 있다(인라인 구획 + CTA 모달). 모듈에 두면 서로의 팝업 참조를 덮어쓴다.
   */
  let closeTerms: (() => void) | null = null;
  const preview = opts.preview === true;
  const lang = opts.locale || config.defaultLocale || DEFAULT_LOCALE;
  const t = (v: Localized | undefined) => localize(v, lang);

  /**
   * 서버 시각 오프셋. Age 를 더하지 않으면 CDN 에 굳은 serverNow 를 "지금" 으로 믿어
   * 최대 s-maxage+SWR 만큼 과거가 된다(웨비나 로더가 실제로 겪은 지연).
   */
  /**
   * 기준 시각을 **서버가 준 값 + 단조 시계 경과분**으로 만든다.
   *
   * 기기 벽시계(Date.now)를 기준으로 오프셋을 계산하면, 시계가 틀어진 기기에서 그 오차가
   * 그대로 판정에 들어간다. 예전에는 "과거로 크게 벌어진 오프셋은 버린다" 는 상한을 뒀는데,
   * 그건 **기기 시계가 앞선 경우**(연도가 틀린 태블릿, 수동 설정 폰)에 보정이 통째로
   * 버려져 서버는 접수 중인데 화면만 "마감" 이 되는 방향으로 고장 났다.
   *
   * performance.now() 는 페이지 로드 기준의 단조 증가 값이라 사용자가 시계를 바꿔도
   * 흔들리지 않는다. 그래서 오차 상한이 **캐시 창(s-maxage+SWR ≈ 120초)** 으로 묶이고,
   * 기기 시계가 얼마나 틀어져 있든 판정은 서버 시각을 따른다.
   *
   * ageMs 를 더하는 이유: serverNow 는 스크립트 본문에 구워져 CDN 에 캐시된다 — 엣지가
   * stale 응답을 주면 그 시각이 그만큼 과거다(웨비나 로더가 실제로 겪은 지연).
   */
  let serverBaseMs: number | null = null;
  let monoBase = 0;
  if (opts.serverNow) {
    const parsed = Date.parse(opts.serverNow);
    if (!Number.isNaN(parsed)) {
      serverBaseMs = parsed + (opts.ageMs && opts.ageMs > 0 ? opts.ageMs : 0);
      monoBase = typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : 0;
    }
  }
  const nowDate = (): Date => {
    if (serverBaseMs === null) return new Date();
    const elapsed = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now() - monoBase
      : 0;
    return new Date(serverBaseMs + elapsed);
  };

  // ── 상태 ────────────────────────────────────────────────────────────
  /**
   * 값은 **JS 에 둔다.** 웨비나 로더는 DOM 을 스냅샷해서 되돌리는데(data-mw-key), 그러면
   * 재렌더마다 DOM 이 정본이라 허니팟·동의처럼 스냅샷에서 빼야 할 것을 매번 따로 챙겨야 한다.
   * 상태를 우리가 들고 있으면 유형을 바꿔도 공통 입력값이 그냥 남는다(설계 §4).
   */
  const values: Record<string, unknown> = {};
  const consent = {
    privacy: config.consent.privacy.defaultChecked,
    marketing: config.consent.marketing.defaultChecked,
    thirdParty: config.consent.thirdParty.defaultChecked,
  };
  let issues: SubmissionIssue[] = [];
  let submitting = false;
  /**
   * 중복확인이 "이미 있음" 이라고 답한 상태 — 제출 버튼을 잠근다.
   * 어느 항목에서 났는지 함께 들고 있어야 **재렌더 뒤에도 안내가 남는다.** 예전에는
   * 상태만 남고 문구가 사라져 "이유 없이 잠긴 버튼" 이 됐다.
   */
  let duplicate = false;
  let duplicateKey: string | null = null;
  /**
   * 서버가 403 으로 확정해 준 접수 상태. **로컬 config 판정을 이긴다.**
   *
   * 스크립트에 구워져 온 config 는 방문자가 탭을 연 시점의 것이고 폴링이 없다 —
   * 운영자가 '마감으로 고정' 을 눌러도 그 탭은 계속 open 이라 믿는다. 제출이 403 을
   * 받았다는 것은 서버가 이미 판정을 끝냈다는 뜻이므로, 그때부터는 그 값을 쓴다.
   */
  let serverStatus: RegistrationStatus | null = null;
  /**
   * 전화 항목별로 방문자가 고른 국가(§6.3). 기본값은 설정의 기본 국가다 —
   * "기본 국가를 박아두고 아닌 사람만 바꾼다" 가 설계가 정한 동작이다.
   */
  const phoneCountries: Record<string, string> = {};

  /**
   * 접수 상태의 단일 판정. 우선순위: **미리보기 강제 → 서버 확정 → 로컬 시각 계산.**
   * 화면 렌더와 제출 직전 재확인이 같은 식을 써야 "화면은 열려 있는데 눌러도 안 되는"
   * 상태가 생기지 않는다.
   */
  const currentStatus = (): RegistrationStatus =>
    opts.forceStatus ?? serverStatus ?? resolveRegistrationStatus(config, nowDate());
  let doneRegNo: string | null = null;
  let banner: { tone: "warn" | "ok"; text: string } | null = null;
  let startedTracked = false;
  let dupTimer: ReturnType<typeof setTimeout> | null = null;
  /** 완료 페이지 이동 타이머 — destroy() 때 반드시 끈다(빌더 옆칸은 재마운트가 잦다). */
  let redirectTimer: ReturnType<typeof setTimeout> | null = null;
  let dupSeq = 0;
  let destroyed = false;

  if (opts.forceType) {
    // ?type=buyer — 분기 기준 항목에 값을 미리 넣어 그 유형 문항이 펼쳐진 채로 연다.
    if (config.branch.enabled && config.branch.fieldKey) values[config.branch.fieldKey] = opts.forceType;
  }

  const issueFor = (key: string) => issues.find((i) => i.key === key);
  const clearIssue = (key: string) => {
    issues = issues.filter((i) => i.key !== key);
  };

  /*
   * 파트너 사이트 브랜드 톤에 맞추는 색 — 비워 두면 css.ts 기본값을 그대로 쓴다. 인라인
   * custom property 는 문서 공용 <style>(ensureStyles) 의 클래스 규칙을 항상 이긴다,
   * 그래서 같은 페이지에 다른 색의 폼이 두 개 붙어도 서로 안 섞인다.
   */
  const theme = config.theme;
  const themeStyle = {
    "--msf-accent": theme.accentColor || null,
    "--msf-accent-fg": theme.accentColor ? onAccentColor(theme.accentColor) : null,
    "--msf-fg": theme.textColor || null,
    "--msf-bg": theme.surfaceColor || null,
  };
  const root = h("div", {
    class: "msf",
    style: themeStyle,
  });
  const stack = h("div", { class: "msf-stack" });
  root.appendChild(stack);

  // ── 안내 블록 ───────────────────────────────────────────────────────
  function renderNotice(n: CollectFormConfig["notices"][number]): HTMLElement {
    const body = t(n.body);
    const box = h("div", { class: "msf-notice" });
    const title = t(n.title);
    if (title) box.appendChild(h("div", { class: "msf-notice-title" }, title));

    // 사용자 텍스트는 줄바꿈을 보존한다(AGENTS.md 공통) — CSS 의 white-space:pre-wrap.
    const bodyEl = h("div", { class: "msf-notice-body" }, body);
    if (body) box.appendChild(bodyEl);

    if (n.collapsible && body) {
      let open = false;
      bodyEl.style.display = "none";
      const btn = h("button", { type: "button", class: "msf-more" }, COPY.more);
      btn.addEventListener("click", () => {
        open = !open;
        bodyEl.style.display = open ? "" : "none";
        btn.textContent = open ? COPY.less : COPY.more;
      });
      box.appendChild(btn);
    }

    if (n.mode !== "notice") {
      const key = noticeValueKey(n.id);
      const errId = `msf-${opts.sourceId}-${key}-err`;
      const issue = issueFor(key);
      const errSlot = h("div", { class: "msf-err", id: errId, role: "alert" }, issue ? ISSUE_COPY[issue.code] : "");
      const cb = h("input", {
        type: "checkbox",
        "data-msf-key": key,
        "aria-invalid": issue ? "true" : "false",
        "aria-describedby": errId,
      }) as HTMLInputElement;
      cb.checked = values[key] === true;
      cb.addEventListener("change", () => {
        values[key] = cb.checked;
        clearIssue(key);
        errSlot.textContent = "";
        cb.setAttribute("aria-invalid", "false");
        updateSubmitState();
      });
      const mark = n.mode === "checkbox-required" ? "[required] " : "[optional] ";
      box.appendChild(h("label", { class: "msf-check" }, cb, h("span", null, mark + "I agree")));
      box.appendChild(errSlot);
    }
    return box;
  }

  const noticesAt = (placement: "top" | "above-consent" | "bottom") =>
    config.notices.filter((n) => n.enabled && n.placement === placement);

  /**
   * 안내 블록은 **자리마다 호스트를 두고 다시 그린다.**
   *
   * 예전에는 render() 에서 한 번만 만들어 붙였는데, 제출이 실패하면 renderFields()·
   * renderConsent() 만 다시 그려서 **필수 동의 안내의 오류가 화면에 영영 안 나타났다** —
   * 초상권 동의를 안 누른 사람에게 "Register 를 눌러도 아무 일도 안 일어난다" 가 된다.
   * 파리(GDPR 관할)는 이 동의가 법적 필수라 그 폼은 통째로 등록이 막힌다.
   */
  const noticeHosts: Record<"top" | "above-consent" | "bottom", HTMLElement> = {
    top: h("div", { class: "msf-stack" }),
    "above-consent": h("div", { class: "msf-stack" }),
    bottom: h("div", { class: "msf-stack" }),
  };
  function renderNotices(): void {
    for (const placement of ["top", "above-consent", "bottom"] as const) {
      const host = noticeHosts[placement];
      clearNode(host);
      for (const n of noticesAt(placement)) host.appendChild(renderNotice(n));
    }
  }

  // ── 항목 ────────────────────────────────────────────────────────────
  const fieldsHost = h("div", { class: "msf-stack" });

  function renderField(f: CollectField): HTMLElement {
    const wrap = h("div", { class: "msf-field" });
    const labelText = t(f.label) || f.key;
    const inputId = `msf-${opts.sourceId}-${f.key}`;

    wrap.appendChild(
      h("label", { class: "msf-label", for: inputId },
        labelText,
        f.required ? h("span", { class: "msf-req" }, "*") : null,
      ),
    );

    const issue = issueFor(f.key);
    const dupHere = duplicate && duplicateKey === f.key;
    const errId = `${inputId}-err`;
    /**
     * role="alert" — 오류가 **소리로도** 전달돼야 한다. 빨간 글씨만으로는 스크린리더
     * 사용자가 "왜 제출이 안 되지" 를 알 수 없다(AGENTS.md 접근성 기본).
     */
    const err = h("div", { class: "msf-err", id: errId, role: "alert" },
      issue ? ISSUE_COPY[issue.code] : dupHere ? COPY.duplicate : "");
    const invalid = issue || dupHere ? "true" : "false";

    const options = f.options.map((o) => t(o)).filter(Boolean);

    if (f.type === "select") {
      const sel = h("select", {
        class: "msf-select", id: inputId, "aria-invalid": invalid,
        "aria-describedby": errId, "data-msf-key": f.key,
      }) as HTMLSelectElement;
      sel.appendChild(h("option", { value: "" }, t(f.placeholder) || "Select"));
      for (const o of options) sel.appendChild(h("option", { value: o }, o));
      sel.value = str(values[f.key]);
      sel.addEventListener("change", () => {
        values[f.key] = sel.value;
        clearIssue(f.key);
        markStarted();
        if (config.branch.enabled && config.branch.fieldKey === f.key) {
          track(preview, "ms_visitor_type_selected", { visitor_type: canonicalBranchValue(config, sel.value) });
          // 분기 기준이 바뀌면 항목 목록 자체가 달라진다 — 이 영역만 다시 그리고 포커스를 되돌린다.
          renderFields();
          const again = fieldsHost.querySelector<HTMLSelectElement>(`#${cssId(inputId)}`);
          if (again) again.focus();
        } else {
          err.textContent = "";
        }
        updateSubmitState();
      });
      wrap.appendChild(sel);
    } else if (f.type === "radio") {
      if (options.length === 0) {
        wrap.appendChild(h("div", { class: "msf-hint" }, "No options configured"));
      } else {
        const group = h("div", {
          class: "msf-radio-group",
          id: inputId,
          role: "radiogroup",
          "aria-label": labelText,
          "aria-invalid": invalid,
          "aria-describedby": errId,
        });
        const paint = () => {
          const selected = str(values[f.key]);
          for (const option of Array.from(group.children) as HTMLElement[]) {
            const on = option.getAttribute("data-v") === selected;
            option.setAttribute("data-on", on ? "1" : "0");
            const radio = option.querySelector("input") as HTMLInputElement | null;
            if (radio) radio.checked = on;
          }
        };
        for (const option of options) {
          const radio = h("input", {
            type: "radio",
            name: inputId,
            value: option,
            "data-msf-key": f.key,
          }) as HTMLInputElement;
          const choice = h("label", { class: "msf-radio-option", "data-v": option },
            radio,
            h("span", { class: "msf-radio-mark", "aria-hidden": "true" }),
            h("span", null, option),
          );
          radio.addEventListener("focus", () => choice.classList.add("is-focus"));
          radio.addEventListener("blur", () => choice.classList.remove("is-focus"));
          radio.addEventListener("change", () => {
            if (!radio.checked) return;
            values[f.key] = option;
            clearIssue(f.key);
            markStarted();
            if (config.branch.enabled && config.branch.fieldKey === f.key) {
              track(preview, "ms_visitor_type_selected", { visitor_type: canonicalBranchValue(config, option) });
              renderFields();
              const again = fieldsHost.querySelector<HTMLInputElement>(`input[name="${cssId(inputId)}"]:checked`);
              if (again) again.focus();
            } else {
              err.textContent = "";
              paint();
            }
            updateSubmitState();
          });
          group.appendChild(choice);
        }
        paint();
        wrap.appendChild(group);
      }
    } else if (f.type === "multiple") {
      if (options.length === 0) {
        wrap.appendChild(h("div", { class: "msf-hint" }, "No options configured"));
      } else {
        const picked = () => (Array.isArray(values[f.key]) ? (values[f.key] as unknown[]).map(str) : []);
        const chips = h("div", { class: "msf-chips" });
        const atMax = () => f.maxSelect != null && picked().length >= f.maxSelect;
        const paint = () => {
          const list = picked();
          for (const el of Array.from(chips.children) as HTMLElement[]) {
            const v = el.getAttribute("data-v") ?? "";
            const on = list.indexOf(v) !== -1;
            el.setAttribute("data-on", on ? "1" : "0");
            el.setAttribute("data-disabled", !on && atMax() ? "1" : "0");
            const box = el.querySelector("input") as HTMLInputElement | null;
            if (box) { box.checked = on; box.disabled = !on && atMax(); }
          }
        };
        for (const o of options) {
          const box = h("input", { type: "checkbox", "data-msf-key": f.key }) as HTMLInputElement;
          const chip = h("label", { class: "msf-chip", "data-v": o }, box, h("span", null, o));
          // :has() 를 못 쓰는 브라우저에서도 포커스가 보이게 — 키보드 사용자가 위치를 잃지 않는다.
          box.addEventListener("focus", () => chip.classList.add("is-focus"));
          box.addEventListener("blur", () => chip.classList.remove("is-focus"));
          box.addEventListener("change", () => {
            const list = picked();
            values[f.key] = box.checked ? list.concat([o]) : list.filter((x) => x !== o);
            clearIssue(f.key);
            err.textContent = "";
            markStarted();
            paint();
            updateSubmitState();
          });
          chips.appendChild(chip);
        }
        paint();
        wrap.appendChild(chips);
        if (f.maxSelect != null) wrap.appendChild(h("div", { class: "msf-hint" }, `Choose up to ${f.maxSelect}`));
      }
    } else if (f.type === "checkbox") {
      const cb = h("input", {
        type: "checkbox", id: inputId, "aria-invalid": invalid,
        "aria-describedby": errId, "data-msf-key": f.key,
      }) as HTMLInputElement;
      cb.checked = values[f.key] === true;
      cb.addEventListener("change", () => {
        values[f.key] = cb.checked;
        clearIssue(f.key);
        err.textContent = "";
        markStarted();
        updateSubmitState();
      });
      wrap.appendChild(h("label", { class: "msf-check" }, cb, h("span", null, t(f.placeholder) || labelText)));
    } else {
      const input = h("input", {
        class: "msf-input",
        id: inputId,
        type: f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text",
        placeholder: t(f.placeholder),
        "aria-invalid": invalid,
        "aria-describedby": errId,
        "data-msf-key": f.key,
        name: f.key,
        /**
         * 자동완성 토큰은 **key 이름에서 추측**한다. 휴대폰에서 이름·회사를 다시 치는 것이
         * 이탈의 큰 몫이고, autocomplete="on" 만으로는 브라우저가 무엇을 채울지 모른다.
         */
        autocomplete: autocompleteToken(f),
      }) as HTMLInputElement;
      input.value = str(values[f.key]);

      if (f.type === "tel") {
        /**
         * numeric 이 아니라 tel 이다. iOS 의 numeric 키패드에는 **`+` 키가 없어서**
         * 기본 국가가 아닌 사람이 국제표기를 아예 칠 수 없다(우리는 값에서 `+` 를 살려 둔다).
         * tel 키패드에는 `+ * #` 가 있다.
         */
        input.inputMode = "tel";
        /**
         * 하이픈·괄호·공백은 **타이핑 즉시** 지운다(AGENTS.md "입력은 소스에서 정규화").
         * 값이 실제로 달라졌을 때만 되쓴다 — 매번 대입하면 커서가 끝으로 튄다.
         */
        input.addEventListener("input", () => {
          const digits = input.value.replace(/[^0-9+]/g, "");
          if (input.value !== digits) {
            const atEnd = input.selectionStart === input.value.length;
            input.value = digits;
            if (atEnd) input.setSelectionRange(digits.length, digits.length);
          }
          values[f.key] = input.value;
          clearIssue(f.key);
          err.textContent = "";
          markStarted();
          updateSubmitState();
        });
      } else if (f.type === "number") {
        // tel 과 같은 이유(AGENTS.md "입력은 소스에서 정규화") — 숫자 아닌 글자는 안내 문구가
        // 아니라 타이핑 즉시 지워서 애초에 "이상한 내용"이 들어갈 자리를 없앤다.
        input.inputMode = "numeric";
        input.addEventListener("input", () => {
          const digits = input.value.replace(/[^0-9]/g, "");
          if (input.value !== digits) {
            const atEnd = input.selectionStart === input.value.length;
            input.value = digits;
            if (atEnd) input.setSelectionRange(digits.length, digits.length);
          }
          values[f.key] = input.value;
          clearIssue(f.key);
          err.textContent = "";
          markStarted();
          updateSubmitState();
        });
      } else {
        input.addEventListener("input", () => {
          values[f.key] = input.value;
          clearIssue(f.key);
          err.textContent = "";
          markStarted();
          if (f.type === "email") scheduleDuplicateCheck(f.key, input.value, err);
          updateSubmitState();
        });
      }

      if (f.type === "tel") {
        /**
         * 국가 선택(§6.3 `[🇺🇸 United States +1 ▾] [2025550147]`).
         *
         * 고를 수 없으면 **등록을 끝내지 못하는 사람이 생긴다.** LA 파일럿의 기본 국가는
         * US 인데 한국 참관객이 `01012345678` 을 치면 서버는 invalid_phone 을 내고,
         * 화면에는 국가를 바꿀 컨트롤도 `+82` 를 붙이라는 안내도 없었다.
         *
         * 값은 국가번호를 붙여 보내지 않고 **고른 국가를 그대로 보낸다** — 앞 0 처리
         * 규칙이 나라마다 달라서(한국은 떼고 이탈리아는 안 뗀다) 붙이면 틀린다.
         */
        const current = phoneCountries[f.key] ?? config.validation.defaultCountry;
        const sel = h("select", {
          // data-msf-cc — 항목 select(data-msf-key)와 구분되는 표시. 없으면 폼 안의
          // `querySelector("select")` 가 전부 이 국가 칸을 먼저 잡는다.
          class: "msf-tel-cc", "data-msf-cc": f.key, "aria-label": `${labelText} — country`,
        }) as HTMLSelectElement;
        for (const c of COUNTRY_DIALS) {
          /**
           * 국가번호를 **이름 앞에** 둔다. select 는 닫혀 있을 때 선택된 항목의 글자를
           * 그대로 보여 주는데, 245개국 이름 중 긴 것에 폭을 맞추면 번호 입력칸이 사라져
           * 폭을 묶어 뒀다 — 그러면 뒤가 잘린다. 잘려도 남아야 하는 건 "+1" 쪽이다.
           */
          sel.appendChild(h("option", { value: c.code }, `${flagEmoji(c.code)} +${c.dial} ${c.name}`));
        }
        // 설정의 기본 국가가 아는 값이 아니면(운영자가 GB 를 UK 로 적는 식) 목록의 선택을
        // 강요하지 않는다 — 첫 항목이 조용히 선택되면 왜 안 되는지 아무도 모른다.
        if (isKnownCountry(current)) sel.value = current.toUpperCase();
        phoneCountries[f.key] = sel.value;
        sel.addEventListener("change", () => {
          phoneCountries[f.key] = sel.value;
          // 국가를 바꾼 건 "이 번호를 다시 봐 달라" 는 뜻이다 — 옛 오류를 남겨 두지 않는다.
          clearIssue(f.key);
          err.textContent = "";
          updateSubmitState();
        });
        wrap.appendChild(h("div", { class: "msf-tel" }, sel, input));
      } else {
        wrap.appendChild(input);
      }
    }

    wrap.appendChild(err);
    return wrap;
  }

  /**
   * 항목 key 에서 자동완성 토큰을 고른다. 표준 토큰이 아니면 브라우저가 무시할 뿐이라
   * 틀려도 손해가 없고, 맞으면 모바일에서 한 번에 채워진다.
   */
  function autocompleteToken(f: CollectField): string {
    if (f.type === "email") return "email";
    if (f.type === "tel") return "tel";
    const k = f.key.toLowerCase();
    if (/first.*name|given/.test(k)) return "given-name";
    if (/last.*name|family|surname/.test(k)) return "family-name";
    if (/full.*name|^name$/.test(k)) return "name";
    if (/company|organi[sz]ation|employer/.test(k)) return "organization";
    if (/job|title|position|role/.test(k)) return "organization-title";
    if (/country/.test(k)) return "country-name";
    if (/city/.test(k)) return "address-level2";
    return "on";
  }

  /** querySelector 용 id 이스케이프. 항목 key 는 운영자가 정하므로 점·콜론이 들어올 수 있다. */
  function cssId(id: string): string {
    return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/[^\w-]/g, "\\$&");
  }

  function renderFields(): void {
    clearNode(fieldsHost);
    const fields = visibleFields(config, values);
    if (fields.length === 0) {
      fieldsHost.appendChild(h("div", { class: "msf-hint" }, COPY.empty));
      return;
    }
    for (const f of fields) fieldsHost.appendChild(renderField(f));
  }

  function markStarted(): void {
    if (startedTracked) return;
    startedTracked = true;
    track(preview, "ms_form_start");
  }

  // ── 실시간 중복 확인(§6.2) ──────────────────────────────────────────
  /**
   * 유효한 이메일이 된 뒤 600ms 조용하면 조회한다. 조회는 **읽기 전용이라 미리보기에서도 돈다**
   * (설계 §16.1 표: 중복 확인 조회는 허용).
   *
   * 타이핑하는 순간 잠금을 먼저 푼다 — 고치는 중에 버튼이 잠겨 있으면 고장으로 보인다.
   * 그래서 이건 **안내이지 방어선이 아니다.** 진짜 방어선은 서버의 409 다(DB 유니크).
   */
  function scheduleDuplicateCheck(fieldKey: string, raw: string, errSlot: HTMLElement): void {
    if (dupTimer) clearTimeout(dupTimer);
    const mySeq = ++dupSeq;
    if (duplicate) { duplicate = false; duplicateKey = null; updateSubmitState(); }
    const value = raw.trim().toLowerCase();
    if (!isValidCollectEmail(value)) return;
    if (config.validation.onDuplicate !== "block") return;

    dupTimer = setTimeout(() => {
      fetch(`${opts.origin}/api/collect/${encodeURIComponent(opts.sourceId)}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ email: value }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { exists?: boolean } | null) => {
          if (destroyed || mySeq !== dupSeq) return;
          duplicate = Boolean(d && d.exists);
          duplicateKey = duplicate ? fieldKey : null;
          if (duplicate) {
            /**
             * **재렌더로 사라지지 않게 다시 그린다.**
             *
             * 여기 잡아 둔 `errSlot` 은 조회를 쏠 당시의 DOM 노드다. 조회가 도는 600ms+RTT
             * 사이에 분기 select 를 건드리면 항목이 다시 그려져 그 노드가 화면에서 빠지고,
             * 그러면 **제출 버튼만 회색으로 잠긴 채 이유가 안 보인다.** 어느 칸을 고쳐야
             * 할지 모르니 등록을 포기한다. 상태(duplicate/duplicateKey)는 이미 세웠으므로
             * renderFields() 가 새 노드에 같은 안내를 붙인다(409 경로가 쓰는 방식과 같다).
             */
            errSlot.textContent = COPY.duplicate;
            if (!errSlot.isConnected) renderFields();
            track(preview, "ms_form_duplicate");
          }
          updateSubmitState();
        })
        // 조회 실패는 통과시킨다(fail-open) — 네트워크가 잠깐 흔들렸다고 등록을 막을 수는 없다.
        .catch(() => {});
    }, 600);
  }

  // ── 동의 ────────────────────────────────────────────────────────────
  function renderConsentRow(
    item: CollectFormConfig["consent"]["privacy"],
    required: boolean,
    fallbackLabel: string,
    issueKey: string,
    onChange: (v: boolean) => void,
    initial: boolean,
  ): HTMLElement {
    const wrap = h("div", { class: "msf-field" });
    const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
    cb.checked = initial;
    const err = h("div", { class: "msf-err" }, issueFor(issueKey) ? COPY.consentRequired : "");
    cb.addEventListener("change", () => {
      onChange(cb.checked);
      clearIssue(issueKey);
      err.textContent = "";
      updateSubmitState();
    });

    /*
     * 법률 문구 생성기(legal-templates)가 만든 라벨은 "[Required] I have read…" 처럼
     * 필수·선택 표시를 이미 문장 앞에 박아서 준다(국가별 sections/*.ts). 그런데 여기서
     * "[required] "를 또 붙이면 "[required] [Required] I have read…"로 겹친다 — 아직
     * 문구를 안 만들어 label 이 비어 있을 때(fallbackLabel)만 표시를 붙인다.
     */
    const generatedLabel = t(item.label);
    const labelText = generatedLabel || `[${required ? "required" : "optional"}] ${fallbackLabel}`;

    const label = h("label", { class: "msf-check" }, cb, h("span", null, labelText));

    const body = t(item.body);
    const linkUrl = safeHttpUrl(item.linkUrl);
    if (item.bodyFormat === "link" && linkUrl) {
      const link = h("a", { class: "msf-more", href: linkUrl, target: "_blank", rel: "noopener noreferrer" }, COPY.more);
      link.addEventListener("click", (event) => event.stopPropagation());
      wrap.appendChild(h("div", { class: "msf-consent-row" }, label, link));
    } else if (body) {
      const btn = h("button", { type: "button", class: "msf-more" }, COPY.more);
      btn.addEventListener("click", () => {
        closeTerms?.();                       // 두 번 열지 않는다
        closeTerms = openTermsPopup(labelText, body, "text", () => {
          cb.checked = true;
          onChange(true);
          clearIssue(issueKey);
          err.textContent = "";
          updateSubmitState();
        }, themeStyle, opts.overlay);
      });
      // Details 를 라벨 아래 별도 줄이 아니라 같은 줄 오른쪽에 둔다 — 혼자 아래에
      // 떨어져 있으면 라벨과 상관없는 항목처럼 보인다.
      wrap.appendChild(h("div", { class: "msf-consent-row" }, label, btn));
    } else {
      wrap.appendChild(label);
    }
    wrap.appendChild(err);
    return wrap;
  }

  // ── 제출 ────────────────────────────────────────────────────────────
  const submitBtn = h("button", { type: "button", class: "msf-submit" },
    t(config.submitLabel) || COPY.submit,
  ) as HTMLButtonElement;
  const bannerEl = h("div", { class: "msf-banner" });
  bannerEl.style.display = "none";

  function updateSubmitState(): void {
    submitBtn.disabled = submitting || duplicate;
    submitBtn.textContent = submitting ? COPY.submitting : t(config.submitLabel) || COPY.submit;
  }

  function showBanner(tone: "warn" | "ok", text: string): void {
    banner = { tone, text };
    bannerEl.setAttribute("data-tone", tone);
    bannerEl.textContent = text;
    bannerEl.style.display = "";
  }
  function hideBanner(): void {
    banner = null;
    bannerEl.style.display = "none";
  }

  /** 제출에 실을 값 — **지금 보이는 항목만**. 분기를 되돌렸을 때 남은 값이 unknown_key 가 되지 않게. */
  function payloadValues(): Record<string, unknown> {
    const fields = visibleFields(config, values);
    const allowed = new Set(fields.map((f) => f.key));
    for (const n of config.notices) {
      if (n.enabled && n.mode !== "notice") allowed.add(noticeValueKey(n.id));
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(values)) if (allowed.has(k)) out[k] = values[k];
    return out;
  }

  /**
   * 첫 오류로 데려간다. **항목만 찾으면 안 된다** — 필수 안내 동의(notice_*)와 개인정보
   * 동의는 항목이 아니라서 그 id 가 없고, 그러면 "눌러도 아무 일 없다" 로 보인다.
   * 루트 전체에서 data-msf-key 로 찾는다.
   */
  function focusFirstIssue(): void {
    const first = issues[0];
    if (!first) return;
    const el =
      root.querySelector<HTMLElement>(`[data-msf-key="${cssId(first.key)}"]`) ??
      fieldsHost.querySelector<HTMLElement>(`#${cssId(`msf-${opts.sourceId}-${first.key}`)}`);
    if (el && typeof el.focus === "function") {
      el.focus();
      if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
    }
  }

  async function submit(): Promise<void> {
    if (submitting || duplicate) return;
    hideBanner();

    // canonicalBranchValue 로 로케일 라벨을 group.value 로 접는다 — 분석 이벤트가 언어별로
    // 갈라지지 않게(collect-form-config.ts 주석). generate_lead 도 이 값을 그대로 쓴다.
    const visitorType = config.branch.enabled
      ? canonicalBranchValue(config, str(values[config.branch.fieldKey]))
      : undefined;
    track(preview, "ms_form_submit", visitorType ? { visitor_type: visitorType } : undefined);

    // 접수 창을 **누를 때 다시 본다.** 폼을 열어 둔 채로 마감 시각이 지나갈 수 있다.
    if (!opts.forceStatus && currentStatus() !== "open") {
      render();
      return;
    }

    const body = payloadValues();
    issues = validateSubmission(config, body, {
      isValidEmail: isValidCollectEmail,
      // 전화 검증은 서버가 libphonenumber 로 한다 — 그 메타데이터를 번들에 넣으면
      // 임베드가 수백 KB 커진다(collect-phone.ts 주석). 여기서는 비어 있지 않은지만 본다.
      isValidPhone: (v) => v.trim().length > 0,
      countryFor: (key) => phoneCountries[key] ?? config.validation.defaultCountry,
      consent,
    });
    if (issues.length > 0) {
      renderFields();
      renderNotices();
      renderConsent();
      focusFirstIssue();
      track(preview, "ms_form_error", { error_code: issues[0].code });
      return;
    }

    /**
     * ── 미리보기는 **저장 직전에 멈춘다**(설계 §16.1) ────────────────
     * 검증까지는 실제와 똑같이 돌린 뒤 여기서 끊고, 완료 화면은 **더미 번호**로 그린다.
     * 배너 한 줄로 끝내면 운영자가 완료 화면을 영영 못 본다 — 이메일 연동 전에는 그 화면이
     * 등록자가 번호를 받는 유일한 경로라 확인이 꼭 필요하다(§2).
     */
    if (preview) {
      doneRegNo = PREVIEW_REG_NO;
      render();
      return;
    }

    submitting = true;
    updateSubmitState();
    try {
      const res = await fetch(`${opts.origin}/api/collect/${encodeURIComponent(opts.sourceId)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({
          values: body,
          consent,
          // 어느 나라 번호로 읽어야 하는지. 값에 국가번호를 붙이지 않는 이유는 §6.3 주석에.
          phoneCountries,
          locale: lang,
          _hp: honeypot.value || "",
          _utm: utmEnvelope(),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { registrationNo?: string | null; rid?: string; issues?: SubmissionIssue[]; duplicateField?: string; duplicateKey?: string; status?: string }
        | null;

      /**
       * 허니팟에 걸리면 서버는 **봇을 속이려고** 200 + registrationNo: null 을 준다.
       * 그 계약을 클라이언트가 모르면 사람에게 오탐이 났을 때 "Couldn't submit" 만 반복되고
       * 등록은 영영 안 된다. 성공처럼 보여 주되 번호는 없으므로 완료 화면 대신 안내를 남긴다.
       */
      if (res.status === 200 && data && data.registrationNo === null) {
        showBanner("warn", COPY.networkError);
        track(preview, "ms_form_error", { error_code: "rejected" });
        return;
      }

      if (res.status === 201 && data?.registrationNo) {
        doneRegNo = data.registrationNo;
        track(preview, "generate_lead", {
          visitor_type: visitorType,
          transaction_id: data.rid ?? data.registrationNo,
          /**
           * 마케팅 동의 상태를 같이 싣는다(§18 "동의 연동").
           * GTM 이 이 값으로 Consent Mode v2 의 ad_storage·ad_user_data 를 내린다 —
           * 없으면 미동의자에 대해 거절 상태를 만들 근거가 없다. 전시별 GTM 설정이
           * 이 키를 읽으므로 이름을 바꾸지 마라.
           */
          ms_consent: consent.marketing ? "granted" : "denied",
        });
        /**
         * 완료 화면을 **먼저** 그린다. 이동이 설정돼 있어도 그렇다 — 이동은 1초 뒤이고,
         * 그 사이에 폼이 그대로 남아 있으면 "제출이 안 됐나" 하고 한 번 더 누른다.
         */
        render();

        /**
         * 완료 페이지로 이동(설계 §8 "URL 조건으로 전환을 잡는 경우 — 권장").
         *
         * 미리보기는 이동하지 않는다(§16.1 "제출해도 아무 일이 없다"). 운영자가 옆칸
         * 미리보기에서 제출했다가 화면이 통째로 다른 사이트로 넘어가면 편집 중이던
         * 폼을 잃는다.
         *
         * 1초 기다리는 이유: dataLayer 에 방금 넣은 `generate_lead` 를 GTM 이 처리할
         * 시간을 준다. 이동이 즉시면 태그가 발화 전에 페이지가 사라진다. 연동형
         * 스크립트도 같은 이유로 같은 값을 쓴다(collect-script.ts).
         */
        if (!preview && config.completion.redirectUrlTemplate) {
          const target = resolveRedirect(config.completion.redirectUrlTemplate, {
            type: visitorType,
            regNo: data.registrationNo,
            rid: data.rid,
            lang,
          });
          // 이동할 수 없는 주소면 그냥 안 간다 — 등록은 이미 성공했고, 완료 카드가 떠 있다.
          if (target) redirectTimer = setTimeout(() => { window.location.href = target; }, 1000);
        }
        return;
      }
      if (res.status === 409) {
        duplicate = true;
        // 서버가 알려 준 항목에 인라인으로 붙인다 — 배너만 띄우면 어느 칸을 고쳐야 할지 모른다.
        /**
         * 서버가 **판정에 쓴 항목의 key** 를 그대로 쓴다.
         *
         * 예전에는 "email 형식의 첫 항목" 을 다시 골랐는데, 서버는 첫 항목이 아니라
         * **값이 채워진 첫 항목**으로 중복을 본다(collect-submit 의 primaryFieldKey).
         * 이메일 항목이 둘인 폼(본인/회사 대표)에서 위칸을 비우면, 안내가 방금 채운
         * 아래칸이 아니라 **빈 위칸** 밑에 붙어 멀쩡한 칸을 고치게 만든다.
         */
        duplicateKey = typeof data?.duplicateKey === "string" && data.duplicateKey
          ? data.duplicateKey
          : data?.duplicateField === "email"
            ? (visibleFields(config, values).find((x) => x.type === "email")?.key ?? null)
            : null;
        renderFields();
        track(preview, "ms_form_duplicate");
        showBanner("warn", COPY.duplicate);
      } else if (res.status === 403 && data?.status) {
        /**
         * 마감(또는 오픈 전)이 **서버에서 확정됐다.**
         *
         * 스크립트에 구워져 온 config 로 다시 판정하면 아무것도 안 바뀐다 — 운영자가
         * '마감으로 고정' 을 누른 뒤 이미 폼을 열어 둔 방문자는 config 를 다시 받지
         * 않기 때문이다(런타임에 폴링이 없다). 그러면 눌러도 403, 또 눌러도 403 이다.
         * 서버가 준 상태를 정본으로 세워 그 판정을 이기게 한다.
         */
        serverStatus = REGISTRATION_STATUSES.includes(data.status as RegistrationStatus)
          ? (data.status as RegistrationStatus)
          : null;
        showBanner("warn", serverStatus === "before" ? COPY.notOpenYet : COPY.closedNow);
        render();
      } else if (res.status === 400 && Array.isArray(data?.issues)) {
        issues = data.issues;
        renderFields();
        renderNotices();
        renderConsent();
        focusFirstIssue();
        track(preview, "ms_form_error", { error_code: issues[0]?.code ?? "invalid" });
      } else {
        showBanner("warn", COPY.networkError);
        track(preview, "ms_form_error", { error_code: "http_" + res.status });
      }
    } catch {
      showBanner("warn", COPY.networkError);
      track(preview, "ms_form_error", { error_code: "network" });
    } finally {
      submitting = false;
      updateSubmitState();
    }
  }

  submitBtn.addEventListener("click", () => { void submit(); });

  /** 봇이 자동완성하는 hidden 필드. 사람에게는 보이지 않고 스크린리더도 건너뛴다. */
  const honeypot = h("input", {
    type: "text", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true",
  }) as HTMLInputElement;
  honeypot.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";

  /** UTM 봉투 — 저장소 접근이 막힌 브라우저(사파리 프라이빗 등)에서 던질 수 있어 감싼다. */
  function utmEnvelope(): Record<string, unknown> | null {
    try {
      return buildUtmEnvelope();
    } catch {
      return null;
    }
  }

  /**
   * QR 카드. 이미지 하나짜리다 — 번호를 그림으로 바꾸는 일을 클라이언트에서 또 구현하면
   * 자리마다 옵션이 갈리고, 그 차이는 **현장에서 스캐너가 안 읽힐 때** 처음 드러난다.
   */
  function qrCard(regNo: string): HTMLElement {
    const img = h("img", {
      src: `${opts.origin}/api/collect/qr/${encodeURIComponent(regNo)}`,
      alt: `Registration QR for ${regNo}`,
      width: "200",
      height: "200",
      loading: "eager",
    });
    return h("div", { class: "msf-qr" }, img);
  }

  /**
   * 티켓 페이지 링크. 완료 화면을 떠나면 번호를 다시 볼 방법이 없다는 것이 이 슬라이스
   * 이전의 결함이었다 — 화면을 닫기 전에 **저장할 수 있는 주소**를 준다.
   */
  function ticketLink(regNo: string): HTMLElement | null {
    if (preview) return null;
    return h("a", {
      class: "msf-more",
      href: `${opts.origin}/t/${encodeURIComponent(regNo)}`,
      target: "_blank",
      rel: "noopener noreferrer",
      style: { marginTop: "10px", display: "inline-block" },
    }, COPY.ticketLink);
  }

  function saveTicketLink(regNo: string, identity: ReturnType<typeof completionIdentity>): HTMLElement | null {
    if (preview) return null;
    return h("button", {
      type: "button",
      class: "msf-save",
      onclick: () => { void downloadTicketImage({
        eventName: config.legal.eventName,
        registrationNo: regNo,
        qrUrl: `${opts.origin}/api/collect/qr/${encodeURIComponent(regNo)}`,
        ...identity,
        badgeBackgroundColor: visitorBadgePalette(identity.visitorType, config.badgeRules).background,
        accentColor: config.theme.accentColor,
      }).catch(() => window.alert("We couldn't save the ticket image. Please take a screenshot instead.")); },
    }, COPY.saveImage);
  }

  function completionIdentity(): {
    name: string; visitorType: string; maskedEmail: string; maskedPhone: string;
    extras: Array<{ label: string; value: string }>;
  } {
    const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
    const namePattern = /^(first|last|given|family|full)[_-]?names?$|^names?$|^surnames?$|^(first|last|given|family)$/i;
    const name = config.fields
      .filter((field) => [field.key, ...Object.values(field.label)]
        .map((value) => String(value).trim().replace(/\s+/g, "_"))
        .some((candidate) => namePattern.test(candidate)))
      .map((field) => text(values[field.key]))
      .filter(Boolean)
      .join(" ");
    const valueFor = (type: string) => {
      const field = config.fields.find((item) => item.type === type);
      return field ? text(values[field.key]) : "";
    };
    // 운영자가 항목별로 켠 값만(예: 동반 인원 수) — collect-lookup.buildTicketView 와 같은 규칙.
    const extras = companionTicketExtras(config, values);
    return {
      name,
      visitorType: resolveVisitorBadgeLabel(
        config,
        values,
        config.branch.enabled ? text(values[config.branch.fieldKey]) : "",
      ),
      maskedEmail: maskedEmail(valueFor("email")),
      maskedPhone: maskedPhone(valueFor("tel")),
      extras,
    };
  }

  /**
   * QR 을 등록 데스크에서 보여 달라는 요청 — 등록번호 아래 작은 캡션만으로는 놓치기 쉬워
   * QR 바로 아래 강조 박스로 한 번 더 짚는다(현장 문의를 줄이려는 것, 이메일·티켓 페이지와
   * 같은 문구·같은 강조 방식).
   */
  function checkinCallout(): HTMLElement {
    return h("div", { class: "msf-callout" },
      h("div", { class: "msf-callout-title" }, COPY.checkinTitle),
      config.confirmationEmail.enabled ? h("div", { class: "msf-callout-body" }, COPY.checkinBodyWithEmail) : null,
    );
  }

  // ── 렌더 ────────────────────────────────────────────────────────────
  const consentHost = h("div", { class: "msf-stack" });
  function renderConsent(): void {
    clearNode(consentHost);
    if (config.consent.privacy.enabled) {
      consentHost.appendChild(
        renderConsentRow(config.consent.privacy, true, "I agree to the privacy policy", "consent_privacy",
          (v) => { consent.privacy = v; }, consent.privacy),
      );
    }
    if (config.consent.marketing.enabled) {
      consentHost.appendChild(
        renderConsentRow(config.consent.marketing, false, "Send me updates", "consent_marketing",
          (v) => { consent.marketing = v; }, consent.marketing),
      );
    }
    if (config.consent.thirdParty.enabled) {
      consentHost.appendChild(
        renderConsentRow(config.consent.thirdParty, false, "Share my information with event partners", "consent_thirdParty",
          (v) => { consent.thirdParty = v; }, consent.thirdParty),
      );
    }
  }

  function render(): void {
    clearNode(stack);

    if (preview) stack.appendChild(h("div", { class: "msf-preview-flag" }, COPY.previewFlag));

    // 완료 화면 — 이메일 연동 전에는 **여기가 등록자가 번호를 받는 첫 경로**다(설계 §2·§8).
    if (doneRegNo) {
      const identity = completionIdentity();
      const identityRows = [
        ["Phone", identity.maskedPhone],
        ["E-mail", identity.maskedEmail],
      ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;
      // 운영자가 켠 항목(예: 동반 인원 수)도 같은 줄 목록에 이어 붙인다.
      for (const extra of identity.extras) identityRows.push([extra.label, extra.value]);
      stack.appendChild(
        h("div", { class: "msf-done" },
          h("div", { class: "msf-done-title" }, COPY.doneTitle),
          identity.visitorType ? h("div", { class: "msf-badge", style: visitorBadgeCssVars(identity.visitorType, config.badgeRules) }, identity.visitorType) : null,
          identity.name ? h("div", { class: "msf-found-name" }, identity.name) : null,
          /**
           * QR 을 여기서 보여 준다 — 이메일 연동 전에는 등록자가 QR 을 받는 **첫 경로**다
           * (설계 §2·§8). 서버에서 그리므로 §9.2 규칙(EC Q·여백 4모듈·불투명 흰 배경)이
           * 세 자리(완료·티켓·이메일)에서 같다.
           */
          config.completion.showQr ? qrCard(doneRegNo) : null,
          config.completion.showQr ? checkinCallout() : null,
          identityRows.length > 0 ? h("dl", { class: "msf-idcheck" },
            ...identityRows.flatMap(([label, value]) => [h("dt", null, label), h("dd", null, value)]),
          ) : null,
          h("div", { class: "msf-regno" }, doneRegNo),
          h("div", { class: "msf-regno-label" }, preview ? COPY.previewDone : COPY.regNoLabel),
          config.completion.showQr ? saveTicketLink(doneRegNo, identity) : null,
          !preview && config.completion.showQr ? h("div", { class: "msf-save-hint" }, COPY.saveHint) : null,
          ticketLink(doneRegNo),
        ),
      );
      return;
    }

    const status = currentStatus();
    if (status !== "open") {
      let copy: { title: string; body: string } = status === "before" ? COPY.before : COPY.closed;
      // 운영 일정: 사전등록이 끝났고 현장등록이 아직이면 "현장등록은 ○○부터" — 수동 고정·미리보기 강제엔 쓰지 않는다
      if (!opts.forceStatus && !serverStatus && !config.statusOverride && config.schedule.enabled) {
        const phase = resolveRegistrationPhase(config.schedule, nowDate());
        if (phase.status === "closed" && phase.nextOpenAt) {
          let next = phase.nextOpenAt;
          try {
            next = new Intl.DateTimeFormat(lang || "en", { timeZone: config.schedule.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(phase.nextOpenAt));
          } catch { /* 모르는 로케일·시간대면 ISO 그대로 */ }
          copy = {
            title: t(config.schedule.betweenTitle) || COPY.between.title,
            body: (t(config.schedule.betweenBody) || COPY.between.body).split("{next}").join(next),
          };
        }
      }
      stack.appendChild(
        h("div", { class: "msf-state" },
          h("div", { class: "msf-state-title" }, copy.title),
          h("div", { class: "msf-state-body" }, copy.body),
        ),
      );
      track(preview, "ms_form_view", { form_status: status });
      return;
    }

    if (config.eventInfo.enabled) {
      /*
       * "기간·장소·운영시간" 개요 표 — 아임웹에 따로 만들던 걸 여기서 대신한다(설계 요청:
       * "우리 자체 빌더에서 저것도 만들 수 있으면"). 값이 있는 행만 그린다 — 빈 껍데기를
       * 방문자에게 보이지 않는다.
       */
      const infoRow = (label: string, ...value: Array<Node | string | false>) =>
        h("div", { class: "msf-info-row" }, h("div", { class: "msf-info-label" }, label), h("div", { class: "msf-info-value" }, ...value));

      const dates = config.eventInfo.eventDates;
      const venue = t(config.eventInfo.venue);
      const hours = config.eventInfo.openingHours;
      const extraRows = config.eventInfo.extraRows
        .map((r) => ({ label: t(r.label), value: t(r.value) }))
        .filter((r) => r.label && r.value);

      if (dates.length > 0 || venue || hours.length > 0 || extraRows.length > 0) {
        const info = h("div", { class: "msf-info" });
        if (dates.length > 0) info.appendChild(infoRow(COPY.period, dates.join(" – ")));
        if (venue) info.appendChild(infoRow(COPY.venue, venue));
        if (hours.length > 0) {
          const lines = hours.map((row) => {
            const range = [row.open, row.close].filter(Boolean).join(" ~ ");
            const entrance = row.lastEntrance ? ` (Last Entrance ${row.lastEntrance})` : "";
            return h("div", null, [row.date, range].filter(Boolean).join(" : ") + entrance);
          });
          info.appendChild(infoRow(COPY.openingHours, ...lines));
        }
        for (const r of extraRows) info.appendChild(infoRow(r.label, r.value));
        stack.appendChild(info);
      }
    }

    renderNotices();
    stack.appendChild(noticeHosts.top);
    renderFields();
    stack.appendChild(fieldsHost);
    stack.appendChild(noticeHosts["above-consent"]);
    renderConsent();
    stack.appendChild(consentHost);
    stack.appendChild(noticeHosts.bottom);
    stack.appendChild(honeypot);
    stack.appendChild(submitBtn);
    stack.appendChild(bannerEl);
    if (banner) showBanner(banner.tone, banner.text);
    updateSubmitState();

    track(preview, "ms_form_view", { form_status: status });
  }

  /**
   * 접수 창 경계에서 **스스로 다시 그린다.**
   *
   * 없으면: 오픈 10분 전에 페이지를 열어 둔 사람은 오픈 시각이 지나도 "아직 안 열렸어요" 를
   * 계속 본다(상태를 마운트 때 한 번만 계산하기 때문). 오픈 직전은 트래픽이 가장 몰리는
   * 순간이고, 그 사람들은 새로고침해야 한다는 걸 모른다.
   *
   * setTimeout 은 ~24.8일(2^31ms)을 넘기면 즉시 발화하므로 12시간 상한을 씌운다. 일찍
   * 깨어나도 다시 계산할 뿐이라 안전하다(랜딩 로더의 scheduleBoundary 와 같은 패턴).
   */
  let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleBoundary(): void {
    if (opts.forceStatus) return; // 미리보기에서 상태를 고정했으면 바꾸지 않는다
    const { opensAt, closesAt } = config.eventInfo.registrationWindow;
    const now = nowDate().getTime();
    const next = [opensAt, closesAt]
      .map((iso) => (iso ? Date.parse(iso) : NaN))
      .filter((t) => Number.isFinite(t) && t > now)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const delay = Math.min(Math.max(next - now + 1000, 1000), 12 * 3600 * 1000);
    boundaryTimer = setTimeout(() => {
      if (destroyed) return;
      // 입력값은 JS 상태에 있으므로 다시 그려도 남는다.
      render();
      scheduleBoundary();
    }, delay);
  }

  clearNode(mount);
  mount.appendChild(root);
  render();
  scheduleBoundary();

  return {
    destroy() {
      destroyed = true;
      // 열려 있던 전문 팝업도 닫는다 — 빌린 자리를 반납해야 포털 호스트가 정리된다.
      // (문서 경로에서도 마찬가지다: 예전에는 폼이 사라져도 팝업이 body 에 남았다.)
      closeTerms?.();
      if (dupTimer) clearTimeout(dupTimer);
      if (boundaryTimer) clearTimeout(boundaryTimer);
      // 이동 예약을 안 끄면 빌더 옆칸을 다시 마운트한 뒤에도 1초 뒤 화면이 넘어간다.
      if (redirectTimer) clearTimeout(redirectTimer);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
