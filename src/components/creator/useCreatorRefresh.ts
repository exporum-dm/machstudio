"use client";

import { useEffect } from "react";

export function useCreatorRefresh(refresh: () => void | Promise<void>, enabled: boolean, intervalMs: number | null) {
  useEffect(() => {
    if (!enabled) return;
    let refreshing = false;
    async function tick() {
      if (document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      try { await refresh(); }
      catch { /* Keep the current view until the next successful refresh. */ }
      finally { refreshing = false; }
    }

    const timer = intervalMs === null ? undefined : window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh, enabled, intervalMs]);
}
