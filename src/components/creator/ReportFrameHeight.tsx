"use client";

import { useEffect } from "react";

export function ReportFrameHeight({ empty = false }: { empty?: boolean }) {
  useEffect(() => {
    if (window.parent === window) return;
    const content = document.querySelector<HTMLElement>("[data-creator-publication]");
    const notify = () => window.parent.postMessage({ type: "mach-creator-height", height: empty || !content ? 0 : Math.ceil(content.getBoundingClientRect().height) }, "*");
    const observer = new ResizeObserver(notify);
    if (content) observer.observe(content);
    notify();
    return () => observer.disconnect();
  }, [empty]);
  return null;
}
