"use client";

// 운영 탭 — 라이브 콘솔(기본)과 등록자 관리를 하나의 탭 아래 묶는다.
// 설계 §2: RegistrantsTab 은 "운영 > 등록자"로 이동.

import { motion } from "framer-motion";
import { Radio, Users } from "lucide-react";
import LiveConsoleTab from "./LiveConsoleTab";
import RegistrantsTab from "./RegistrantsTab";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

export type OperateSection = "console" | "registrants";

interface WebinarForConsole {
  config: Record<string, unknown>;
  components?: Record<string, unknown> | null;
  liveStartAt?: string;
  liveEndAt?: string;
  sessions: { id: string; number: number; type: string; title: string; startTime: string; endTime: string }[];
  _count: { registrations: number };
}

export default function OperateTab({
  webinarId,
  webinar,
  onNavigate,
  onSilentUpdate,
  section,
  onSectionChange,
}: {
  webinarId: string;
  webinar?: WebinarForConsole;
  onNavigate?: (target: string) => void;
  onSilentUpdate?: () => Promise<void>;
  section: OperateSection;
  onSectionChange: (section: OperateSection) => void;
}) {
  const setSection = onSectionChange;

  const items: { id: OperateSection; label: string; icon: typeof Radio }[] = [
    { id: "console", label: "라이브 콘솔", icon: Radio },
    { id: "registrants", label: "등록자", icon: Users },
  ];

  return (
    <div className="min-h-full bg-background p-4 dark:bg-transparent sm:p-6 lg:p-8 space-y-4">
      <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-background p-1">
        {items.map(({ id, label, icon: Icon }) => (
          <motion.button
            key={id}
            onClick={() => setSection(id)}
            aria-current={section === id ? "page" : undefined}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              section === id ? "text-white" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {section === id && (
              <motion.span
                layoutId="op-seg"
                transition={spring}
                className="absolute inset-0 z-0 rounded-lg bg-violet-500"
              />
            )}
            <Icon className="relative z-10 h-3.5 w-3.5" />
            <span className="relative z-10">{label}</span>
          </motion.button>
        ))}
      </div>

      {section === "console" ? (
        <LiveConsoleTab webinarId={webinarId} webinar={webinar} onNavigate={onNavigate} onSilentUpdate={onSilentUpdate} />
      ) : (
        <div className="-m-4 sm:-m-6 lg:-m-8 lg:-mt-4">
          <RegistrantsTab webinarId={webinarId} />
        </div>
      )}
    </div>
  );
}
