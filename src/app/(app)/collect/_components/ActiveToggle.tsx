"use client";

import { motion } from "framer-motion";
import { useState } from "react";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

interface Props {
  active: boolean;
  onChange: (next: boolean) => void | Promise<void>;
  label?: string;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}

export default function ActiveToggle({ active, onChange, size = "sm", showLabel = true, className, label = "등록 접수" }: Props) {
  const [pending, setPending] = useState(false);
  const dim = size === "md"
    ? { pill: "w-8 h-4", dot: "w-3 h-3", translate: active ? "translate-x-4" : "translate-x-0.5" }
    : { pill: "w-6 h-3.5", dot: "w-2.5 h-2.5", translate: active ? "translate-x-2.5" : "translate-x-0.5" };

  return (
    <motion.button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={active}
      aria-busy={pending}
      disabled={pending}
      whileTap={{ scale: 0.96 }}
      transition={spring}
      onClick={async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (pending) return;
        setPending(true);
        try { await onChange(!active); } finally { setPending(false); }
      }}
      title={active ? "클릭해서 비활성화" : "클릭해서 활성화"}
      className={`flex min-h-9 min-w-11 items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
          : "bg-secondary text-muted-foreground hover:text-foreground"
      } ${className ?? ""}`}
    >
      <div className={`relative ${dim.pill} rounded-full transition-colors shrink-0 ${active ? "bg-violet-500" : "bg-muted-foreground/30"}`}>
        <div
          className={`absolute top-0.5 ${dim.dot} rounded-full bg-white shadow-sm transition-transform ${dim.translate}`}
        />
      </div>
      {showLabel && (active ? "활성" : "비활성")}
    </motion.button>
  );
}
