"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

/**
 * 공용 인라인 오류/재시도 블록 — 로드 실패를 '빈 상태'로 위장하지 않기 위한 표준 패턴.
 * fetch 실패(네트워크·5xx) 시 이 컴포넌트를 렌더해 원인과 회복 경로(다시 시도)를 함께 제공한다.
 */
export function InlineError({
  message = "불러오지 못했어요",
  hint = "잠시 후 다시 시도해주세요.",
  onRetry,
  className = "",
}: {
  message?: string;
  hint?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
      <AlertCircle className="mb-3 h-9 w-9 text-muted-foreground/50" aria-hidden />
      <p className="text-sm font-medium">{message}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          다시 시도
        </button>
      )}
    </div>
  );
}
