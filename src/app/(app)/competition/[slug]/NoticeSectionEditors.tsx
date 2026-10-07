"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { FIELD_CLS, R } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/switch";

/**
 * 공고 편집의 반복 행 도구들.
 *
 * AGENTS.md 의 "고치는 영역" 원칙대로 **한 행 = 한 항목, 열 = 속성**의 인라인 테이블이다.
 * 값을 바꾸는 데 0클릭(바로 타이핑)이어야 하므로 모달·아코디언 뒤에 숨기지 않는다.
 */

/** 행 껍데기 — 순서 이동과 삭제는 모든 반복 항목이 똑같이 갖는다. */
export function Row({
  index,
  count,
  onMove,
  onRemove,
  children,
}: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-secondary/20 p-2.5 ${R.surface}`}>
      <div className="flex items-start gap-2">
        <div className="flex shrink-0 flex-col pt-1">
          <button
            onClick={() => onMove(index, index - 1)}
            disabled={index === 0}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25"
            aria-label="위로"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onMove(index, index + 1)}
            disabled={index === count - 1}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25"
            aria-label="아래로"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
        <button
          onClick={() => onRemove(index)}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-red-500"
          aria-label="삭제"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
    >
      <Plus className="h-3 w-3" /> {label}
    </button>
  );
}

/** 섹션 카드 — 헤더에 토글과 라이트/다크가 항상 보인다(끄고 켜는 게 이 탭의 주 조작이라). */
export function SectionCard({
  label,
  note,
  enabled,
  bg,
  onToggle,
  onBg,
  onMove,
  hiddenReason,
  children,
}: {
  label: string;
  note?: string;
  enabled: boolean;
  bg: "light" | "dark";
  onToggle: (value: boolean) => void;
  onBg: (value: "light" | "dark") => void;
  /** 순서 바꾸기 — 위(-1)/아래(+1). 맨 위·맨 아래면 그 방향 버튼이 잠긴다. */
  onMove?: { up: (() => void) | null; down: (() => void) | null };
  /**
   * 켜 뒀는데 방문자에게 안 보이는 이유. 공개 페이지는 "켬 + 내용 있음" 일 때만 섹션을 그리는데
   * (빈 껍데기 금지), 그걸 편집 화면이 말해 주지 않아 "켰는데 안 나온다 = 오류" 로 보였다
   * (2026-10-07 실제 사례 — 한눈에 보기에 제목·배경만 넣고 카드는 비워 둠).
   */
  hiddenReason?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className={`bg-background p-4 ${R.panel} ${enabled ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold">{label}</span>
          {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onMove && (
            <div className="flex gap-0.5">
              <button
                onClick={onMove.up ?? undefined}
                disabled={!onMove.up}
                aria-label={`${label} 위로`}
                className={`grid h-6 w-6 place-items-center bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 ${R.control}`}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onMove.down ?? undefined}
                disabled={!onMove.down}
                aria-label={`${label} 아래로`}
                className={`grid h-6 w-6 place-items-center bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 ${R.control}`}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex gap-0.5">
            {(["light", "dark"] as const).map((value) => (
              <button
                key={value}
                onClick={() => onBg(value)}
                className={`px-2 py-1 text-[10px] font-medium transition-colors ${R.control} ${
                  bg === value ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {value === "light" ? "라이트" : "다크"}
              </button>
            ))}
          </div>
          <Switch checked={enabled} onChange={onToggle} label={`${label} 사용`} />
        </div>
      </div>
      {enabled && hiddenReason && (
        <p role="status" className={`mt-2 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400 ${R.control}`}>
          지금은 방문자에게 안 보여요 — {hiddenReason}
        </p>
      )}
      {enabled && <div className="mt-3 space-y-2">{children}</div>}
    </section>
  );
}

/** 머리글 3종(키커·제목·설명)은 거의 모든 섹션이 갖는다 — 반복을 줄인다. */
export function HeadFields({
  kicker,
  title,
  description,
  onChange,
  showDescription = true,
}: {
  kicker: string;
  title: string;
  description?: string;
  onChange: (patch: { kicker?: string; title?: string; description?: string }) => void;
  showDescription?: boolean;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      <input
        value={kicker}
        onChange={(e) => onChange({ kicker: e.target.value })}
        placeholder="작은 라벨 (예: The Concept)"
        className={`${FIELD_CLS} h-8`}
      />
      <input
        value={title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="섹션 제목"
        className={`${FIELD_CLS} h-8`}
      />
      {showDescription && (
        <input
          value={description ?? ""}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="한 줄 설명 (선택)"
          className={`${FIELD_CLS} h-8 sm:col-span-2`}
        />
      )}
    </div>
  );
}

/** 배열 항목 이동 — 편집 컴포넌트마다 다시 짜지 않게 한 곳에 둔다. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
