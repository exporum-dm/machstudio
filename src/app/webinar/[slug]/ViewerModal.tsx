"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export const viewerOverlayBottom = "calc(var(--webinar-viewport-bottom, 0px) + max(1rem, env(safe-area-inset-bottom, 0px)))";

/**
 * 시청자용 모달 껍데기 — 배경·카드·닫기 버튼·스크롤 컨테이너.
 *
 * 왜 뺐나: 라이브 푸시 설문 모달의 껍데기를 종료 화면 설문·등록 완료 팝업이 그대로 필요로 했다.
 * 세 곳에 같은 마크업을 두면 한 곳만 고쳐져 갈라진다(모바일에서 긴 내용이 닫기 버튼을 밀어내는
 * 문제를 예전에 여기서 한 번 고쳤는데, 그게 사본에는 반영되지 않는다).
 *
 * 스크롤 규칙이 이 컴포넌트의 핵심이다: **콘텐츠만** 스크롤하고 ×·카드 테두리는 고정한다
 * (min-h-0 + overflow-y-auto). 카드 전체를 스크롤하게 두면 모바일에서 닫기 버튼이 화면 밖으로
 * 밀려 나가 모달을 닫을 수 없다.
 *
 * 테마: .stk-live 스코프를 스스로 붙인다 — 호스트가 buildStkCss 를 이미 주입했다는 전제.
 */
export default function ViewerModal({
  surface,
  text,
  soft,
  label,
  onClose,
  restoreFocusTo,
  zIndex = 65,
  maxWidthClass = "max-w-lg",
  children,
}: {
  surface: string;
  text: string;
  /** 텍스트 색에서 파생한 반투명 색 — 호출부의 soft() 를 그대로 받는다(테마 일관). */
  soft: (pct: number) => string;
  /** 스크린리더용 이름 — 모달이 무엇인지 말한다. */
  label: string;
  /** 닫기(× · 배경 클릭). 닫을 수 없는 모달은 이 값을 주지 않는다. */
  onClose?: () => void;
  /** 호출부가 보존한 열기 버튼. 없으면 모달이 열릴 때의 포커스 요소를 사용한다. */
  restoreFocusTo?: HTMLElement | null;
  zIndex?: number;
  maxWidthClass?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeBeforeOpen =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const restoreTarget = restoreFocusTo ?? activeBeforeOpen;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onCloseRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    (dialog.querySelector<HTMLElement>("[autofocus]") ?? focusable()[0] ?? dialog).focus({ preventScroll: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      // Strict Mode의 이펙트 재실행 cleanup에서는 DOM이 그대로 연결돼 있다. 실제 언마운트 뒤에만
      // 한 번 복원해 열기 버튼 ↔ 모달 사이 포커스가 왕복하지 않게 한다.
      queueMicrotask(() => {
        if (dialog.isConnected) return;
        if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
      });
    };
  }, [restoreFocusTo]);

  return (
    <div
      className="stk-live fixed inset-x-0 flex items-center justify-center overflow-hidden px-4 [visibility:var(--webinar-viewport-visibility,visible)]"
      style={{
        zIndex,
        top: "var(--webinar-viewport-top, 0px)",
        height: "var(--webinar-viewport-height, 100dvh)",
        paddingTop: "max(1rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",
      }}
      // 배경 클릭만 닫는다 — 카드 안에서 시작한 클릭이 올라와 닫히는 일이 없게 target 을 대조한다.
      onClick={(e) => { if (onClose && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className={`relative flex max-h-full w-full ${maxWidthClass} flex-col overflow-hidden rounded-2xl shadow-2xl sm:max-h-[min(85dvh,100%)]`}
        style={{ background: surface, color: text }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {onClose && (
          <button
            onClick={onClose}
            aria-label="닫기"
            className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-xl text-base transition-colors sm:h-8 sm:w-8"
            style={{ color: soft(50), background: soft(6) }}
          >
            ×
          </button>
        )}
        <div className="min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-7">{children}</div>
      </div>
    </div>
  );
}
