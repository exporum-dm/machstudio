/**
 * 상세페이지 임베드 런타임 — 아임웹 코드블럭에 한 줄로 붙는다.
 *
 *   <script async src="https://…/d/{pageId}"></script>
 *   <div data-mach-page></div>
 *
 * 대회 공고와 **같은 mountNotice** 로 그린다 — 어드민 미리보기도 같은 함수라 "미리보기에서는
 * 괜찮았는데" 가 안 생긴다. 신청 폼이 없으므로 주 버튼은 링크다(detail-page/config.ts).
 *
 * 전체 try/catch — 실패해도 호스트 페이지를 건드리지 않고 조용히 끝낸다.
 */
import { detailPageNoticeCompetition, normalizeDetailPageSettings } from "@/lib/detail-page/config";
import { mountNotice } from "@/lib/notice/mount";

interface BootPayload {
  pageId: string;
  name: string;
  /** machstudio 주소 — 신청 폼 섹션이 등록 폼 로더를 부를 때 쓴다. */
  origin: string;
  theme: Record<string, string>;
  /** { noticePage, page } — 서버가 정규화해 실어 보낸다. */
  config: unknown;
}

const MOUNT_ATTR = "data-mach-page";

function warn(message: string, error?: unknown) {
  try {
    if (typeof console !== "undefined" && console.warn) console.warn("[mach page] " + message, error ?? "");
  } catch {
    /* 로깅 실패는 무시 */
  }
}

/**
 * 붙일 자리. 한 페이지에 상세페이지가 둘 이상 붙을 수 있어서 **아직 안 쓴 자리**를 고른다.
 * 마운트 div 를 빠뜨리는 실수가 잦다 — 그때는 스크립트 태그 바로 뒤에 직접 만든다.
 */
function findMount(pageId: string): HTMLElement | null {
  const own = document.querySelector<HTMLElement>(`[${MOUNT_ATTR}="${CSS.escape(pageId)}"]`);
  if (own) return own;
  const free = document.querySelector<HTMLElement>(`[${MOUNT_ATTR}]:not([data-mach-page-mounted])`);
  if (free) return free;
  const current = document.currentScript as HTMLScriptElement | null;
  const scripts = current ? [current] : Array.from(document.querySelectorAll(`script[src*='/d/${pageId}']`));
  const script = scripts[scripts.length - 1] as HTMLScriptElement | undefined;
  if (!script || !script.parentNode) return null;
  const host = document.createElement("div");
  host.setAttribute(MOUNT_ATTR, "");
  script.parentNode.insertBefore(host, script.nextSibling);
  return host;
}

export function boot(payload: BootPayload) {
  try {
    const mount = findMount(payload.pageId);
    if (!mount) {
      warn("마운트 지점을 찾지 못했어요 — <div data-mach-page></div> 를 넣어주세요.");
      return;
    }
    mount.setAttribute("data-mach-page-mounted", "");
    mountNotice({
      mount,
      competition: detailPageNoticeCompetition({
        id: payload.pageId,
        name: payload.name,
        theme: payload.theme,
        settings: normalizeDetailPageSettings(payload.config),
        formOrigin: payload.origin,
      }),
      config: payload.config,
      embedded: true,
      isPreview: false,
      // 주 버튼은 링크라 이 콜백이 불릴 일이 없다(링크가 없으면 버튼 자체가 안 그려진다).
      onApply: () => {},
    });
  } catch (error) {
    warn("render failed", error);
  }
}
