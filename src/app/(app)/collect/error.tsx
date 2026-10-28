"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10">
        <AlertTriangle className="h-6 w-6 text-red-500" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">문제가 발생했어요</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          등록 데이터를 불러오는 중 오류가 났어요. 잠시 후 다시 시도해주세요.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground/60">오류 코드: {error.digest}</p>
        )}
      </div>
      <button
        onClick={reset}
        className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-600"
      >
        <RotateCw className="h-3.5 w-3.5" />
        다시 시도
      </button>
    </div>
  );
}
