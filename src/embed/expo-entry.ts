/**
 * 홈페이지 임베드 진입점 — 파트너 사이트(아임웹 등) 문서에서 실행된다.
 *
 * 스니펫:
 *   <!-- 페이지 통짜 -->
 *   <script async src="https://machstudio.vercel.app/h/PAGE_ID"></script>
 *   <div data-mach-expo></div>
 *
 *   <!-- 구획 하나만 -->
 *   <script async src="https://machstudio.vercel.app/h/PAGE_ID/SECTION_ID"></script>
 *   <div data-mach-expo-section></div>
 *
 * 이 파일은 esbuild 로 IIFE 번들(globalName=__msExpo)이 되고, `/h/...` 라우트가 번들 뒤에
 * `__msExpo.boot({...})` 를 붙여 내려보낸다. **payload 가 스크립트 본문에 실려 오므로**
 * 요청 1회로 최종 화면이 그려진다 — fetch 방식은 실측 10초 넘게 빈 화면이었다.
 *
 * ── 생성물 순서에 대한 기록 ───────────────────────────────────────────
 * 설계 문서는 홈페이지를 **다섯 번째 제품 파이프라인**이라 부른다. 그런데 main 에는 이미
 * 생성 IIFE 가 다섯 개 있다(랜딩 · 폼 · 대회 신청 · 대회 투표 · 대회 결과). 그래서
 * 홈페이지는 **여섯 번째 생성물**이다. 두 숫자가 다른 것은 착오가 아니다.
 */
import { EXPO_PAGE_MOUNT_ATTR, EXPO_SECTION_MOUNT_ATTR } from "@/lib/expo/snippet";
import { detectFormLocale } from "@/lib/form-locale";
import { mountExpo, type ExpoMountHandle, type ExpoRuntimePayload } from "@/lib/expo/mount";

export type ExpoBootConfig = ExpoRuntimePayload & {
  defaultLocale?: string;
  translations?: Record<string, ExpoRuntimePayload["sections"]>;
};

interface Instance {
  handle: ExpoMountHandle | null;
  payload: ExpoBootConfig;
  warningTimer: number | null;
}

type Registry = Record<string, Instance>;
type WindowWithRegistry = Window & { __MACH_EXPO__?: Registry };

const REGISTRY_KEY = "__MACH_EXPO__";

function registry(): Registry {
  const w = window as WindowWithRegistry;
  return (w[REGISTRY_KEY] = w[REGISTRY_KEY] ?? {});
}

function warn(message: string, error?: unknown): void {
  try {
    if (window.console && console.warn) console.warn("[mach expo] " + message, error ?? "");
  } catch {
    /* 호스트 콘솔이 막혀 있어도 진행 */
  }
}

/**
 * 붙여넣은 빈 `data-mach-expo*` 자리도 파트너 CSS의 직접 표적이 된다. Shadow host만
 * 리셋하면 그 부모인 이 div의 opacity/visibility/transform이 그대로 전체 임베드를
 * 숨긴다. 고정 폭·높이·좌표는 주장하지 않고, 파트너 레이아웃/숨김 규칙을 끊는 최소
 * 블록 기준만 인라인 important로 복원한다. 기존의 관계없는 인라인 장식은 보존한다.
 */
const MOUNT_CONTAINER_RESET = [
  ["display", "block"],
  ["box-sizing", "border-box"],
  ["margin", "0"],
  ["padding", "0"],
  ["overflow", "visible"],
  ["visibility", "visible"],
  ["opacity", "1"],
  ["pointer-events", "auto"],
  ["transform", "none"],
  ["filter", "none"],
  ["will-change", "auto"],
  ["contain", "none"],
  ["animation", "none"],
  ["transition", "none"],
  ["float", "none"],
  ["direction", "ltr"],
  ["unicode-bidi", "isolate"],
] as const;

function resetMountContainer(container: HTMLElement): void {
  try {
    for (const [property, value] of MOUNT_CONTAINER_RESET) {
      container.style.setProperty(property, value, "important");
    }
  } catch (error) {
    warn("마운트 자리 리셋 실패", error);
  }
}

/**
 * 마운트 자리 찾기.
 *
 * 지정(`data-mach-expo="ID"`) → 무지정(`data-mach-expo`) → **스크립트 태그 자리**.
 * 마지막 폴백이 중요하다 — 붙이는 사람이 `<div>` 를 빠뜨리는 일이 실제로 잦고,
 * 그러면 "스크립트는 넣었는데 아무것도 안 나온다" 가 된다(폼 로더와 같은 규칙).
 */
function findContainer(payload: ExpoBootConfig, script: HTMLScriptElement | null): HTMLElement | null {
  // 상수는 **스니펫을 만드는 쪽과 공유한다.** 각자 적어 두면 한쪽만 고쳐지는 날
  // 코드는 붙었는데 런타임이 그 자리를 못 찾는다(스크립트 태그 자리로 폴백되어
  // 엉뚱한 데 그려진다 — 아무도 못 알아챈다).
  const attr = payload.sectionId ? EXPO_SECTION_MOUNT_ATTR : EXPO_PAGE_MOUNT_ATTR;
  const key = payload.sectionId ?? payload.pageId;

  const exact = document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(key)}"]`);
  if (exact) return exact;

  const all = document.querySelectorAll<HTMLElement>(`[${attr}]`);
  for (let i = 0; i < all.length; i++) {
    // 다른 페이지·구획이 이미 잡은 자리는 건너뛴다(한 문서에 여러 개를 붙일 수 있다).
    const claimed = all[i].getAttribute("data-mach-expo-claimed");
    if (!claimed || claimed === key) return all[i];
  }

  if (script && script.parentNode) {
    const host = document.createElement("div");
    host.setAttribute(attr, key);
    script.parentNode.insertBefore(host, script.nextSibling);
    return host;
  }
  return null;
}

/**
 * 아임웹 위젯 애니메이션이 마운트를 숨겨 둔 채로 두는 경우가 있다
 * (`_widget_data.wg_animated` → visibility:hidden). 랜딩·폼 로더가 같은 처리를 하고 있고,
 * 같은 호스트에서 같은 이유로 필요하다.
 *
 * 호스트 리셋(`host-reset.ts`)이 **우리 호스트의** visibility 를 못 박지만, 그건 우리
 * 요소에만 해당한다 — 우리를 담은 **파트너의 래퍼**가 숨겨져 있으면 그 안이 다 안 보인다.
 *
 * ── 이건 되돌리지 않는다. 일부러다 ────────────────────────────────────
 * `destroy()` 는 이 변경을 복원하지 않는다. **되돌리는 쪽이 더 나쁘다:**
 *  · `wg_animated` 를 다시 붙이는 순간, 아임웹의 리빌 패스가 이미 지나갔으면 그 위젯은
 *    **영영 숨겨진다** — 떠나면서 파트너 자신의 콘텐츠를 지우는 셈이다.
 *  · 인라인 값의 원래 상태를 우리는 모른다. `style.visibility = ""` 는 복원이 아니라
 *    제3의 값이다(파트너가 직접 인라인 hidden 을 쓰는 경우가 실재한다).
 * 남는 흔적은 클래스 둘과 인라인 두 줄이고, 다음 로드에 파트너 HTML 이 그대로 돌아온다.
 * **지켜야 할 것은 복원이 아니라 재적용이다** — 마운트가 다시 붙을 때마다 여기를 지나간다.
 */
function unhideWidget(container: HTMLElement): void {
  try {
    const widget = container.closest ? (container.closest("._widget_data") as HTMLElement | null) : null;
    if (!widget) return;
    widget.classList.add("_ds_animated_except");
    widget.classList.remove("wg_animated");
    widget.style.visibility = "visible";
    widget.style.opacity = "1";
  } catch (error) {
    warn("widget unhide 실패", error);
  }
}

/** 재진입에도 **안정된** 열쇠. 폼 예약 열쇠의 접두사도 이 값이다. */
function instanceKey(payload: ExpoBootConfig): string {
  return `${payload.pageId}:${payload.sectionId ?? "page"}`;
}

function render(instance: Instance, script: HTMLScriptElement | null): void {
  const container = findContainer(instance.payload, script);
  if (!container) {
    warn("마운트 자리를 찾지 못했습니다: " + instanceKey(instance.payload));
    return;
  }
  container.setAttribute("data-mach-expo-claimed", instance.payload.sectionId ?? instance.payload.pageId);
  resetMountContainer(container);
  unhideWidget(container);

  if (instance.warningTimer !== null) {
    window.clearTimeout(instance.warningTimer);
    instance.warningTimer = null;
  }
  const previousHandle = instance.handle;
  const { translations, defaultLocale, ...payload } = instance.payload;
  if (translations && defaultLocale) {
    const locale = detectFormLocale(container, [defaultLocale, ...Object.keys(translations)], defaultLocale);
    payload.sections = translations[locale] ?? payload.sections;
  }
  const nextHandle = mountExpo({ container, payload });
  if (!nextHandle) {
    warn("마운트하지 못했습니다: " + instanceKey(instance.payload));
    return;
  }
  instance.handle = nextHandle;
  // mountExpo의 shell commit이 성공한 뒤에만 이전 observer/timer까지 정리한다.
  try {
    previousHandle?.destroy();
  } catch (error) {
    warn("이전 마운트 정리 실패", error);
  }
  reportIfInvisible(instance, container);
}

/**
 * 붙었는데 **자리가 없는** 경우를 알린다.
 *
 * ── 왜 이것만 따로 보나 ───────────────────────────────────────────────
 * 적대적 CSS 실측(`/dev/expo-hostile-harness`)에서, 아임웹 테마가 할 법한 공격은 전부
 * Shadow 격리와 호스트 리셋이 막았다 — 전역 리셋·스크롤 리빌(opacity:0)·전역 transition·
 * transform/filter·타이포 상속·body flex·쌓임/클리핑·빈 div 숨김·CSS 변수 충돌까지.
 *
 * **딱 하나 못 막는 것이 남는다: 붙여넣은 자리의 조상이 숨겨진 경우.** 마운트 자리 자체의
 * 직접 opacity/visibility/display 공격은 위 인라인 리셋으로 끊지만, 우리는 숨은 조상 안에
 * 있으므로 접힌 아코디언·숨은 탭·템플릿 블록은 구조적으로 못 이긴다.
 * 그때 화면에는 아무 일도 안 일어나고 **어디에도 단서가 없다** — "붙였는데 안 나와요" 의
 * 가장 흔한 정체다. 막을 수 없으면 최소한 **진단할 수 있게** 한다.
 *
 * 한 번만, 레이아웃이 끝난 뒤에 잰다. 나중에 보이게 되는 자리(탭·아코디언)를 거짓으로
 * 고발하지 않으려고 지연을 둔다 — 그래도 남아 있으면 그건 진짜 안 보이는 것이다.
 */
function reportIfInvisible(instance: Instance, container: HTMLElement): void {
  const key = instanceKey(instance.payload);
  try {
    if (instance.warningTimer !== null) window.clearTimeout(instance.warningTimer);
    instance.warningTimer = window.setTimeout(() => {
      instance.warningTimer = null;
      /**
       * 그 사이 정리됐으면 아무 말도 하지 않는다. **레지스트리로 판정한다** —
       * `destroy` 는 항목을 지우기만 하고 붙잡아 둔 instance 의 handle 은 비우지 않으므로,
       * 그걸 보면 이미 사라진 것에 대해 경고하게 된다.
       */
      if (registry()[key] !== instance || !container.isConnected) return;
      const box = container.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return;
      warn(
        "붙었지만 자리가 보이지 않습니다 — 이 코드를 붙인 자리가 숨겨져 있거나" +
        "(display:none·접힌 영역·숨은 탭) 높이가 0입니다: " + key,
      );
    }, 1200);
  } catch {
    /* setTimeout 이 막힌 환경에서도 렌더는 이미 끝났다 */
  }
}

export function boot(payload: ExpoBootConfig, bootScript?: HTMLScriptElement | null): void {
  try {
    /**
     * `document.currentScript` 는 **동기 실행 중에만** 값이 있다. 아래 어디서든 await 나
     * setTimeout 을 한 번 거치면 null 이 된다 — 그래서 제일 먼저 읽는다.
     */
    const script = bootScript ?? (document.currentScript as HTMLScriptElement | null);

    const key = instanceKey(payload);
    const reg = registry();
    const previous = reg[key];
    if (previous) {
      // 재진입은 조기 return 이 아니라 재마운트 — 호스트 재렌더 후 스크립트가 다시 돌 수 있다.
      previous.payload = payload;
      render(previous, script);
      return;
    }

    const instance: Instance = { handle: null, payload, warningTimer: null };
    reg[key] = instance;

    const run = () => {
      if (registry()[key] !== instance) return;
      render(instance, script);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  } catch (error) {
    // 호스트 페이지를 절대 깨뜨리지 않는다.
    warn("부트 실패", error);
  }
}

/** 붙인 것을 전부 되돌린다 — 어드민 미리보기가 다시 그릴 때 쓴다. */
export function destroy(payload: Pick<ExpoBootConfig, "pageId" | "sectionId">): void {
  try {
    const reg = registry();
    const key = instanceKey(payload as ExpoBootConfig);
    if (reg[key]?.warningTimer !== null && reg[key]?.warningTimer !== undefined) {
      window.clearTimeout(reg[key].warningTimer as number);
      reg[key].warningTimer = null;
    }
    reg[key]?.handle?.destroy();
    delete reg[key];
  } catch (error) {
    warn("정리 실패", error);
  }
}
