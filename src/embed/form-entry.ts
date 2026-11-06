/**
 * 등록 폼 임베드 진입점 — 외부 사이트(아임웹 등) 문서에서 실행된다 (설계 §17).
 *
 * 스니펫:
 *   <!-- 등록 폼 -->
 *   <script async src="https://machstudio.vercel.app/f/SOURCE_ID"></script>
 *   <div data-mach-form></div>
 *
 *   <!-- 등록 확인 (Find My QR) -->
 *   <script async src="https://machstudio.vercel.app/f/SOURCE_ID/check"></script>
 *   <div data-mach-form-check></div>
 *
 * 이 파일은 esbuild 로 IIFE 번들(globalName=__msForm)이 되고, /f/{id} 라우트가 번들 뒤에
 * `__msForm.boot({...})` 를 붙여 내려보낸다. **config 가 스크립트 본문에 실려 오므로**
 * 요청 1회로 최종 화면이 그려진다 — fetch 방식은 실측 10초 넘게 빈 화면이었다(랜딩의 교훈).
 */
import { mountCollectForm, type CollectFormHandle } from "@/lib/collect-form/mount";
import { mountCollectLookup, type LookupHandle } from "@/lib/collect-form/lookup-mount";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import {
  getFormTarget, isPreviewMode, unregisterOwnedFormTarget, type FormTargetRecord,
} from "@/lib/collect-form/target-registry";

export interface FormBootConfig {
  sourceId: string;
  origin: string;
  /** 저장된 formConfig 원본 — 정규화는 런타임이 한다(서버와 같은 함수). */
  formConfig: unknown;
  /** 서버 시각(ISO) — 접수 창 판정을 방문자 시계로 하지 않는다. */
  serverNow: string;
  /** 소스가 비활성이면 폼을 그리지 않는다. */
  active: boolean;
  /**
   * 무엇을 그리는가. `/f/{id}` 는 등록 폼, `/f/{id}/check` 는 등록 확인이다(설계 §17).
   * 한 번들에 둘 다 들어 있다 — 스타일·검증·DOM 빌더를 공유하고, 두 탭을 다 붙이는
   * 사이트에서 두 번째 스크립트는 캐시에서 온다.
   */
  view?: "form" | "check";
}

/**
 * 지정 자리에 붙는 경로.
 *
 * 홈페이지 섹션의 마운트 지점은 Shadow 안이라 `document.querySelector` 로 보이지 않는다.
 * 그래서 홈페이지 런타임이 **먼저 자리를 예약하고**, 스크립트 태그에 열쇠를 실어 보낸다.
 * 열쇠가 없으면 아래 탐색 경로를 그대로 탄다 — 단독 /f 는 아무것도 달라지지 않는다.
 */
type TargetMount = { record: FormTargetRecord; key: string };

interface Instance {
  handle: CollectFormHandle | LookupHandle | null;
  mount: HTMLElement | null;
  cfg: FormBootConfig;
  observer: MutationObserver | null;
  remounts: number;
  remountWindowStart: number;
  /** 지정 자리로 붙은 경우에만 채워진다. 문서 탐색 경로에서는 null 이다. */
  target: TargetMount | null;
}

type Registry = Record<string, Instance>;
type WindowWithRegistry = Window & { __MACH_FORM__?: Registry };

function registry(): Registry {
  const w = window as WindowWithRegistry;
  return (w.__MACH_FORM__ = w.__MACH_FORM__ ?? {});
}

function warn(msg: string, e?: unknown): void {
  try {
    if (window.console && console.warn) console.warn("[mach form] " + msg, e ?? "");
  } catch {
    /* 호스트 콘솔이 막혀 있어도 진행 */
  }
}

/**
 * 마운트 지점 찾기.
 *
 * 소스 지정(`data-mach-form="ID"`) → 무지정(`data-mach-form`) → **스크립트 태그 자리**.
 * 마지막 폴백이 중요하다 — 붙이는 사람이 `<div>` 를 빠뜨리는 일이 실제로 잦고, 그러면
 * "스크립트는 넣었는데 아무것도 안 나온다" 가 된다(설계 §17 "마운트 <div> 가 없으면
 * 스크립트 태그 위치에 자동 마운트").
 */
function findMount(sourceId: string, view: "form" | "check"): HTMLElement | null {
  // 등록 폼과 등록 확인은 **다른 마운트 속성**을 쓴다 — 한 페이지에 둘 다 붙는 경우가
  // 기본이고(등록 탭 + Registration Check 탭), 같은 속성이면 서로의 자리를 뺏는다.
  const attr = view === "check" ? "data-mach-form-check" : "data-mach-form";

  const exact = document.querySelector<HTMLElement>(
    "[" + attr + '="' + CSS.escape(sourceId) + '"]',
  );
  if (exact) return exact;

  const all = document.querySelectorAll<HTMLElement>("[" + attr + "]");
  for (let i = 0; i < all.length; i++) {
    // 다른 소스에 이미 잡힌 자리는 건너뛴다(한 페이지에 폼 2개를 붙일 수 있다).
    const claimed = all[i].getAttribute("data-mach-form-claimed");
    if (!claimed || claimed === sourceId) return all[i];
  }

  // 스크립트 태그 자리에 직접 만든다.
  const script = document.querySelector<HTMLScriptElement>(
    'script[src*="/f/' + sourceId + (view === "check" ? '/check' : '') + '"]',
  );
  if (script && script.parentNode) {
    const host = document.createElement("div");
    host.setAttribute(attr, sourceId);
    script.parentNode.insertBefore(host, script.nextSibling);
    return host;
  }
  return null;
}

/**
 * 아임웹 위젯 애니메이션이 마운트를 숨겨 둔 채로 두는 경우가 있다
 * (_widget_data.wg_animated → visibility:hidden). 폼이 통째로 안 보이는 사고라 풀어 준다.
 * 랜딩 로더가 같은 처리를 하고 있고, 같은 호스트에서 같은 이유로 필요하다.
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

function render(inst: Instance): void {
  const view = inst.cfg.view === "check" ? "check" : "form";

  // 지정 자리가 있으면 탐색하지 않는다 — 그 자리는 이미 예약된 것이다.
  const record = inst.target?.record ?? null;
  const mount = record ? record.container : findMount(inst.cfg.sourceId, view);
  if (!mount) {
    warn("마운트 지점을 찾지 못했습니다: " + inst.cfg.sourceId);
    return;
  }
  if (!record) mount.setAttribute("data-mach-form-claimed", inst.cfg.sourceId);
  inst.mount = mount;
  // 아임웹 위젯 처리는 문서에 직접 붙은 경우에만 뜻이 있다.
  if (!record) unhideWidget(mount);

  if (!inst.cfg.active) {
    // 비활성 소스는 **조용히 아무것도 그리지 않는다**(설계 §17). 방문자에게 오류를 보이면
    // 전시가 취소된 것처럼 읽힌다 — 운영자만 알면 되는 상태다.
    warn("비활성 소스입니다: " + inst.cfg.sourceId);
    return;
  }

  inst.handle?.destroy();
  const config = normalizeCollectForm(inst.cfg.formConfig);
  /**
   * **부작용 판정은 예약 정보에서만 온다.** payload 에 실린 값을 믿으면 미리보기 화면에서
   * 실제 등록이 저장된다 — payload 는 캐시된 스크립트에 실려 오고 그 스크립트는 라이브와
   * 같은 파일이다.
   */
  const preview = record ? isPreviewMode(record.mode) : false;
  const styleRoot = record?.styleRoot;
  inst.handle = view === "check"
    ? mountCollectLookup({ mount, config, origin: inst.cfg.origin, sourceId: inst.cfg.sourceId, preview, styleRoot })
    : mountCollectForm({
        mount,
        config,
        origin: inst.cfg.origin,
        sourceId: inst.cfg.sourceId,
        serverNow: inst.cfg.serverNow,
        forceType: config.builderVariant === "domestic" ? mount.getAttribute("data-mach-form-type") ?? new URLSearchParams(window.location.search).get("type") ?? undefined : undefined,
        preview,
        styleRoot,
        // 예약이 자리를 함께 줬으면 전문 팝업이 거기로 간다. 안 줬으면 document.body.
        overlay: record?.overlay,
        /**
         * 라우트가 SWR 을 짧게(60초) 잡아 두므로 남는 지연은 작고, 런타임에도 5분 넘게
         * 과거인 serverNow 를 버리는 가드가 있다. 스크립트 태그로는 응답 헤더(Age)를
         * 읽을 수 없어 여기서 보정할 방법이 없다 — 그 사실을 남겨 둔다.
         */
        ageMs: 0,
      });
}

/**
 * 호스트가 위젯을 다시 그리면 우리 폼이 지워진다. 복원된 HTML 안의 <script> 는 innerHTML
 * 경로라 재실행되지 않으므로 직접 감시해 다시 붙인다. 폭주 방지: 1분에 5회까지.
 *
 * **입력값은 잃는다** — 재마운트는 새 폼이다. 그래서 한도를 낮게 잡는다(무한 재마운트가
 * 타이핑 중인 사람의 입력을 계속 날리는 것보다 폼이 사라진 채 두는 편이 낫다).
 */
function watchForRerender(inst: Instance): void {
  if (typeof MutationObserver === "undefined") return;
  // 지정 자리는 자기 루트의 생존만 본다 — 문서 재렌더와 무관하다.
  if (inst.target) return watchTargetLifetime(inst);
  const target = inst.mount?.parentElement;
  if (!target) return;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    const root = inst.mount && inst.mount.querySelector(".msf");
    if (root && document.contains(root)) return;
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

/**
 * 지정 자리의 **생존**만 본다.
 *
 * 문서 기준(`document.contains`)으로 보면 안 된다. 우리 폼은 Shadow 안에 있어서
 * `document.contains(root)` 는 **항상 false** 다 — 그대로 두면 호스트가 무엇을 하든
 * 재마운트가 끝없이 돌고, 타이핑 중인 입력이 계속 날아가며, 재마운트 한도만 헛되이 태운다.
 *
 * 그리고 여기서는 **다시 붙이지 않는다.** 자리가 사라졌다는 것은 홈페이지 섹션이 정리됐다는
 * 뜻이고, 다시 그리는 것은 그쪽의 일이다(새 자리를 예약하고 다시 부른다).
 * 여기서 할 일은 한 번 정리하는 것뿐이다.
 */
function watchTargetLifetime(inst: Instance): void {
  const target = inst.target;
  if (!target) return;

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    inst.observer?.disconnect();
    inst.observer = null;
    inst.handle?.destroy();
    inst.handle = null;
    unregisterOwnedFormTarget(target.key, target.record);
    delete registry()[target.key];
  };

  // 예약한 쪽이 먼저 끊어 주면 그걸 따른다 — 가장 정확한 신호다.
  target.record.disposeSignal?.addEventListener("abort", cleanup, { once: true });

  if (typeof MutationObserver === "undefined") return;
  const parent = target.record.container.parentNode;
  if (!parent) return;
  const observer = new MutationObserver(() => {
    if (target.record.container.isConnected) return;
    cleanup();
  });
  observer.observe(parent, { childList: true });
  inst.observer = observer;
}

/**
 * 예약된 자리에 붙인다. 홈페이지 런타임이 쓰는 진입점이다.
 * `boot` 도 열쇠가 있으면 여기로 온다 — 경로가 하나다.
 */
export function bootInto(cfg: FormBootConfig, record: FormTargetRecord, key: string): void {
  start(cfg, key, { record, key });
}

export function boot(cfg: FormBootConfig, bootScript?: HTMLScriptElement | null): void {
  try {
    /**
     * `document.currentScript` 는 **동기 실행 중에만** 값이 있다. 아래 어디서든 await 나
     * setTimeout 을 한 번 거치면 null 이 된다 — 그래서 제일 먼저 읽는다.
     */
    const script = bootScript ?? (typeof document !== "undefined"
      ? (document.currentScript as HTMLScriptElement | null)
      : null);
    const targetKey = script?.dataset?.msFormTarget;

    if (targetKey) {
      const record = getFormTarget(targetKey);
      if (!record) {
        // 이미 정리된 자리다. 문서 탐색으로 **떨어지지 않는다** — 홈페이지용 폼이 엉뚱한
        // 자리에 붙으면 미리보기 폼이 라이브 자리에 앉는 일이 생긴다.
        warn("예약된 자리를 찾지 못했습니다: " + targetKey);
        return;
      }
      bootInto(cfg, record, targetKey);
      return;
    }

    // 같은 소스라도 폼과 등록 확인은 별개 인스턴스다 — 한 키를 쓰면 나중에 부트된 쪽이
    // 앞의 것을 destroy 해 버린다(둘 다 붙은 페이지가 기본 구성이다).
    start(cfg, cfg.sourceId + ":" + (cfg.view === "check" ? "check" : "form"), null);
  } catch (e) {
    // 호스트 페이지를 절대 깨뜨리지 않는다.
    warn("부트 실패", e);
  }
}

function start(cfg: FormBootConfig, key: string, target: TargetMount | null): void {
  try {
    const reg = registry();
    const prev = reg[key];
    if (prev) {
      // 재진입은 조기 return 이 아니라 재마운트 — 호스트 재렌더 후 스크립트가 다시 돌 수 있다.
      prev.cfg = cfg;
      prev.target = target;
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
      target,
    };
    reg[key] = inst;

    const run = () => {
      render(inst);
      watchForRerender(inst);
    };
    // 지정 자리는 이미 만들어져 있다 — 문서 로딩을 기다릴 이유가 없다.
    if (!target && document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  } catch (e) {
    // 호스트 페이지를 절대 깨뜨리지 않는다.
    warn("부트 실패", e);
  }
}
