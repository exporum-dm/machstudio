/**
 * 등록 확인(Find My QR) 마운트 — 설계 §10.
 *
 * 아임웹의 별도 코드블럭(`Registration Check` 탭)에 붙고, 미리보기(/p/{token}/check)도
 * 같은 함수를 탄다. 등록 폼과 **같은 스타일·같은 DOM 빌더**를 쓴다 — 두 화면이 나란히
 * 놓이는데 폰트와 모서리가 다르면 그게 곧 "다른 서비스" 로 보인다.
 *
 * 이메일 연동 전에는 등록자가 QR 을 되찾는 **유일한 경로**다(§2). 그래서 이 화면이
 * 조용히 고장 나면 현장 문의가 그대로 늘어난다.
 */
import { h, clearNode } from "@/lib/dom/h";
import { ensureFormStyles } from "./css";
import { onAccentColor } from "@/lib/competition-render";
import { COUNTRY_DIALS, flagEmoji, isKnownCountry } from "@/lib/collect-country";
import type { CollectFormConfig } from "@/lib/collect-form-config";
import { visitorBadgeCssVars, visitorBadgePalette } from "@/lib/collect-badge";
import { downloadTicketImage } from "./ticket-image";
import { lookupCopy } from "./copy";



export interface MountLookupOptions {
  mount: HTMLElement;
  config: CollectFormConfig;
  origin: string;
  sourceId: string;
  /** 미리보기 — 조회를 실제로 보내지 않고 표본 결과를 그린다. */
  preview?: boolean;
  /** 스타일을 넣을 루트. 안 주면 문서(지금까지와 같다). */
  styleRoot?: Document | ShadowRoot;
}

export interface LookupHandle {
  destroy(): void;
}

/**
 * 미리보기용 표본 번호.
 *
 * 예전 값 `0000000000000` 은 **Luhn 이 통과한다**(체크digit 0 이 맞다) — "일부러 틀린
 * 값" 이라던 주석이 사실과 반대였고, 그러면 이 번호로 만든 QR 이 형식 검증을 통과한다.
 * 마지막 자리를 1 로 바꿔 실제로 무효하게 만든다.
 */
const PREVIEW_REG_NO = "0000000000001";



type DataLayerWindow = Window & { dataLayer?: unknown[] };
function track(preview: boolean, event: string): void {
  if (preview) return;
  try {
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer ?? [];
    w.dataLayer.push({ event });
  } catch {
    /* 호스트를 깨뜨리지 않는다 */
  }
}

export function mountCollectLookup(opts: MountLookupOptions): LookupHandle {
  ensureFormStyles(opts.styleRoot);
  const { config, mount } = opts;
  const preview = opts.preview === true;
  // 기본 문구 — "기본 정보 › 폼 언어"(config.defaultLocale)를 따른다(copy.ts)
  const COPY = lookupCopy(config.defaultLocale);

  const useEmail = config.lookup.fields.includes("email");
  const usePhone = config.lookup.fields.includes("phone");
  const needBoth = config.lookup.logic === "and";

  // 등록 폼(mount.ts)과 같은 규칙 — 테마 색을 인라인 custom property 로 심는다. 여기서
  // 빠지면 등록 폼은 브랜드 키컬러가 입혀지는데 바로 옆 "Find my QR" 화면만 기본색으로
  // 남아 두 화면이 다른 서비스처럼 보인다.
  const theme = config.theme;
  const root = h("div", {
    class: "msf",
    style: {
      "--msf-accent": theme.accentColor || null,
      "--msf-accent-fg": theme.accentColor ? onAccentColor(theme.accentColor) : null,
      "--msf-fg": theme.textColor || null,
      "--msf-bg": theme.surfaceColor || null,
    },
  });
  const stack = h("div", { class: "msf-lookup" });
  root.appendChild(stack);

  let busy = false;
  let destroyed = false;

  const idFor = (k: string) => `msf-lk-${opts.sourceId}-${k}`;

  const emailInput = h("input", {
    class: "msf-input", type: "email", id: idFor("email"),
    autocomplete: "email", placeholder: "you@example.com",
  }) as HTMLInputElement;
  const phoneInput = h("input", {
    class: "msf-input", type: "tel", id: idFor("phone"),
    autocomplete: "tel", placeholder: config.validation.defaultCountry === "US" ? "2025550147" : "",
  }) as HTMLInputElement;
  // 등록 폼과 같은 규칙 — 하이픈·괄호는 타이핑 즉시 지운다(AGENTS.md "입력은 소스에서 정규화").
  phoneInput.inputMode = "tel";
  phoneInput.addEventListener("input", () => {
    const digits = phoneInput.value.replace(/[^0-9+]/g, "");
    if (phoneInput.value !== digits) phoneInput.value = digits;
  });

  /**
   * 국가 선택 — 등록 폼(mount.ts)과 **같은 컨트롤**이다.
   *
   * 등록자가 기본 국가가 아닌 나라를 골라 등록했다면(§6.3) 저장된 번호는 그 나라 기준
   * E.164 다. 조회 칸이 국가를 못 고르면 서버는 항상 `defaultCountry` 로 해석하는데,
   * 그러면 자기 번호를 정확히 쳐도 못 찾는다 — 입력 화면과 확인 화면의 형식이 갈리는 것.
   */
  const phoneCountrySel = h("select", {
    class: "msf-tel-cc", "data-msf-cc": "phone", "aria-label": `${COPY.phone} — country`,
  }) as HTMLSelectElement;
  for (const c of COUNTRY_DIALS) {
    phoneCountrySel.appendChild(h("option", { value: c.code }, `${flagEmoji(c.code)} +${c.dial} ${c.name}`));
  }
  if (isKnownCountry(config.validation.defaultCountry)) {
    phoneCountrySel.value = config.validation.defaultCountry.toUpperCase();
  }
  const phoneWrap = h("div", { class: "msf-tel" }, phoneCountrySel, phoneInput);

  const banner = h("div", { class: "msf-banner", role: "alert" });
  banner.style.display = "none";
  /**
   * 조회 결과는 **소리로도 전달돼야 한다.** 시각장애 사용자가 Enter 를 치면 버튼 라벨이
   * 잠깐 바뀔 뿐, 티켓을 찾았다는 사실도 등록번호도 낭독되지 않았다(WCAG 4.1.3).
   */
  const resultHost = h("div", { role: "status", "aria-live": "polite" });
  const submitBtn = h("button", { type: "button", class: "msf-submit" }, COPY.submit) as HTMLButtonElement;

  function showBanner(text: string): void {
    banner.setAttribute("data-tone", "warn");
    banner.textContent = text;
    banner.style.display = "";
  }
  function hideBanner(): void {
    banner.style.display = "none";
  }

  function field(label: string, forId: string, content: HTMLElement): HTMLElement {
    return h("div", { class: "msf-field" },
      h("label", { class: "msf-label", for: forId }, label),
      content,
    );
  }

  /**
   * QR 을 파일로 내려준다.
   *
   * `<a download>` 만으로는 안 된다 — 임베드는 **다른 도메인**(아임웹 등)에서 도는데,
   * 교차 출처 링크에서는 브라우저가 download 속성을 무시하고 그냥 새 탭으로 연다.
   * 그래서 직접 받아서 blob 으로 저장한다(QR 라우트는 CORS 를 열어 두었다).
   * 그마저 막히면 새 탭으로 열어 준다 — 그때는 길게 눌러 저장하면 된다.
   */
  function renderResult(view: {
    registrationNo: string;
    name: string;
    visitorType: string;
    showQr: boolean;
    maskedEmail: string;
    maskedPhone: string;
    extras: Array<{ label: string; value: string }>;
  }): void {
    clearNode(resultHost);
    // 결과 카드로 데려간다 — 긴 페이지에서는 결과가 화면 밖에 그려질 수 있다.
    queueMicrotask(() => {
      if (typeof resultHost.scrollIntoView === "function") resultHost.scrollIntoView({ block: "nearest" });
    });
    const card = h("div", { class: "msf-found" });

    /*
      유형을 **배지로** 올린다. 예전에는 이름 밑의 작은 회색 글씨라, 현장에서 "나 지금
      general 인가 buyer 인가" 를 확인하려고 화면을 들여다봐야 했다. 입장 동선이 유형마다
      다르므로 이건 이름보다 먼저 눈에 들어와야 한다.
    */
    if (view.visitorType) card.appendChild(h("div", {
      class: "msf-badge",
      style: visitorBadgeCssVars(view.visitorType, config.badgeRules),
    }, view.visitorType));
    if (view.name) card.appendChild(h("div", { class: "msf-found-name" }, view.name));

    /*
      본인 확인용 — 이름만으로는 동명이인을 못 가른다. 연락처는 **가려서** 온다
      (collect-lookup 의 maskEmail/maskPhone). 가리는 이유는 그쪽 주석 참고.
    */
    const rows: [string, string][] = [
      [COPY.phone, view.maskedPhone],
      [COPY.email, view.maskedEmail],
    ].filter(([, value]) => !!value) as [string, string][];
    for (const extra of view.extras) rows.push([extra.label, extra.value]);

    if (view.showQr) {
      /**
       * QR 은 서버에서 그린다 — §9.2 규칙(EC Q·여백 4모듈·불투명 흰 배경)을 완료 화면·
       * 티켓·이메일과 **같은 한 곳**에서 지키기 위해서다.
       */
      card.appendChild(
        h("div", { class: "msf-qr" },
          h("img", {
            src: `${opts.origin}/api/collect/qr/${encodeURIComponent(view.registrationNo)}`,
            alt: `Registration QR for ${view.registrationNo}`,
            width: "200", height: "200",
          }),
        ),
      );
      if (rows.length > 0) {
        card.appendChild(
          h("dl", { class: "msf-idcheck" },
            ...rows.flatMap(([label, value]) => [
              h("dt", null, label),
              h("dd", null, value),
            ]),
          ),
        );
      }
      card.appendChild(h("div", { class: "msf-regno" }, view.registrationNo));
      card.appendChild(h("div", { class: "msf-regno-label" }, COPY.regNoLabel));

      if (!preview) {
        const save = h("button", {
          type: "button",
          class: "msf-save",
          onclick: () => { void downloadTicketImage({
            eventName: config.legal.eventName,
            registrationNo: view.registrationNo,
            qrUrl: `${opts.origin}/api/collect/qr/${encodeURIComponent(view.registrationNo)}`,
            name: view.name,
            visitorType: view.visitorType,
            badgeBackgroundColor: visitorBadgePalette(view.visitorType, config.badgeRules).background,
            maskedEmail: view.maskedEmail,
            maskedPhone: view.maskedPhone,
            extras: view.extras,
            accentColor: config.theme.accentColor,
          }).catch(() => window.alert("We couldn't save the ticket image. Please take a screenshot instead.")); },
        }, COPY.saveImage);
        card.appendChild(save);
        card.appendChild(h("div", { class: "msf-save-hint" }, COPY.saveHint));
      }

      if (!preview) {
        card.appendChild(
          h("a", {
            class: "msf-more",
            href: `${opts.origin}/t/${encodeURIComponent(view.registrationNo)}`,
            target: "_blank", rel: "noopener noreferrer",
            style: { marginTop: "10px", display: "inline-block" },
          }, COPY.ticketLink),
        );
      }
    } else {
      // showQr 이 꺼져 있으면 번호도 보여주지 않는다 — 그 설정의 의도가 "화면에 티켓을
      // 띄우지 않는다" 이기 때문이다(§10.1).
      card.appendChild(h("div", { class: "msf-state-body" }, COPY.noQr));
    }

    /*
      다시 찾기 — 일행 것을 이어서 찾는 경우가 많다(가족·팀 단위 등록). 결과가 남아 있으면
      입력칸이 안 보여서 새로고침을 해야 했다.
    */
    card.appendChild(
      h("button", {
        type: "button",
        class: "msf-again",
        onclick: () => {
          clearNode(resultHost);
          // 두 칸 다 비운다 — 조회 설정이 and 면 둘 다 쓰고, or 면 아무 쪽이나 쓴다.
          emailInput.value = "";
          phoneInput.value = "";
          emailInput.focus();
        },
      }, COPY.searchAgain),
    );

    resultHost.appendChild(card);
  }

  async function search(): Promise<void> {
    if (busy) return;
    hideBanner();
    /**
     * **결과를 먼저 지우지 않는다.** 예전에는 fetch 전에 비웠는데, 줄에 서서 QR 을 띄워
     * 둔 사람이 실수로 버튼을 한 번 더 눌렀다가 그 순간 전파가 끊기면(입구는 가장 혼잡한
     * 셀이다) 방금 있던 티켓이 사라지고 오류 문구만 남았다. 새 결과가 왔을 때만 바꾼다.
     */

    const email = useEmail ? emailInput.value.trim() : "";
    const phone = usePhone ? phoneInput.value.trim() : "";
    /**
     * 빈 칸으로 눌러도 **반응이 있어야 한다.** 예전에는 조용히 return 해서 화면이 정지한
     * 것처럼 보였다 — 모바일에서 입력칸이 화면 밖에 있으면 버튼부터 누르는 사람이 흔하고,
     * 그 사람은 두세 번 더 누르고 "고장 났다" 로 판단한다.
     */
    if (!email && !phone) {
      showBanner(COPY.needSomething);
      (useEmail ? emailInput : phoneInput).focus();
      return;
    }
    if (needBoth && !(email && phone)) {
      // 상단 힌트와 **다른 문장**이어야 오류로 읽힌다. 같은 문장을 또 띄우면 화면에 이미
      // 있던 안내가 하나 더 생긴 것으로 보이고, 스크린리더는 방금 읽은 것을 다시 읽는다.
      showBanner(email ? COPY.needPhone : COPY.needEmail);
      (email ? phoneInput : emailInput).focus();
      return;
    }

    track(preview, "ms_lookup_request");

    // 미리보기는 조회를 보내지 않는다 — 표본으로 화면만 확인한다(부작용 차단, §16.1).
    if (preview) {
      renderResult({
        registrationNo: PREVIEW_REG_NO, name: "Jane Doe", visitorType: "Buyer",
        showQr: config.lookup.showQr, maskedEmail: "j•••@example.com", maskedPhone: "•••••• 1234",
        extras: [{ label: "Companions", value: "2" }],
      });
      return;
    }

    busy = true;
    /**
     * **disabled 를 걸지 않는다.** 포커스를 가진 버튼을 disabled 로 만들면 브라우저가
     * 포커스를 body 로 되돌리고, 해제해도 돌아오지 않는다 — 키보드 사용자는 파트너 페이지
     * 맨 위부터 다시 Tab 을 눌러야 한다. 중복 실행은 위의 busy 플래그가 이미 막는다.
     */
    submitBtn.setAttribute("aria-busy", "true");
    submitBtn.textContent = COPY.searching;
    try {
      const res = await fetch(`${opts.origin}/api/collect/${encodeURIComponent(opts.sourceId)}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ email, phone, phoneCountry: usePhone ? phoneCountrySel.value : "" }),
      });
      if (res.status === 429) { showBanner(COPY.tooMany); return; }
      const data = (await res.json().catch(() => null)) as
        | {
            found?: boolean; registrationNo?: string; name?: string; visitorType?: string;
            showQr?: boolean; maskedEmail?: string; maskedPhone?: string;
            extras?: Array<{ label: string; value: string }>;
          }
        | null;
      if (!res.ok || !data) { showBanner(COPY.networkError); return; }
      if (!data.found || !data.registrationNo) { showBanner(COPY.notFound); return; }
      renderResult({
        registrationNo: data.registrationNo,
        name: data.name ?? "",
        visitorType: data.visitorType ?? "",
        showQr: data.showQr !== false,
        maskedEmail: data.maskedEmail ?? "",
        maskedPhone: data.maskedPhone ?? "",
        extras: data.extras ?? [],
      });
    } catch {
      if (!destroyed) showBanner(COPY.networkError);
    } finally {
      busy = false;
      submitBtn.removeAttribute("aria-busy");
      submitBtn.textContent = COPY.submit;
    }
  }

  submitBtn.addEventListener("click", () => { void search(); });
  // Enter 로도 찾는다 — 입력칸이 한둘뿐인 화면에서 버튼까지 가는 건 불필요한 단계다.
  for (const input of [emailInput, phoneInput]) {
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") { e.preventDefault(); void search(); }
    });
  }

  function render(): void {
    clearNode(stack);
    if (preview) stack.appendChild(h("div", { class: "msf-preview-flag" }, COPY.previewFlag));

    // 운영자가 꺼 두면 아무것도 그리지 않는다 — 빈 껍데기를 시청자에게 노출하지 않는다
    // (AGENTS.md §4 "config 토글 ON + 실제 데이터 있음" 이중 게이트).
    if (!config.lookup.enabled) return;

    stack.appendChild(h("div", { class: "msf-state-title" }, COPY.title));
    stack.appendChild(h("div", { class: "msf-hint" }, needBoth ? COPY.needBoth : COPY.desc));
    if (useEmail) stack.appendChild(field(COPY.email, emailInput.id, emailInput));
    if (usePhone) stack.appendChild(field(COPY.phone, phoneInput.id, phoneWrap));
    stack.appendChild(submitBtn);
    stack.appendChild(banner);
    stack.appendChild(resultHost);
  }

  clearNode(mount);
  mount.appendChild(root);
  render();

  return {
    destroy() {
      destroyed = true;
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
