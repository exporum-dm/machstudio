"use client";

/**
 * 보드(칸반) 보기 — 상태별 열. 카드를 다른 열로 끌면 상태가 바뀐다.
 * 열 안은 발행일 순(날짜 미정은 아래). 터치 화면은 끌기가 안 되므로 카드를 열어 상태를 고른다.
 */
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { R } from "@/components/ui/primitives";
import { CONTENT_STATUSES, compareItems, type ContentStatus } from "@/lib/content-calendar";
import { DRAG_TYPE, ItemCard, StatusDot, type ViewProps } from "./parts";

export default function BoardView({ items, projectName, projectColor, showProject, onOpen, onCreate, onPatch }: ViewProps) {
  const [over, setOver] = useState<ContentStatus | null>(null);
  const columns = useMemo(() => {
    const sorted = [...items].sort(compareItems);
    return CONTENT_STATUSES.map((s) => ({ ...s, items: sorted.filter((i) => i.status === s.id) }));
  }, [items]);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
      <div className="grid min-w-max grid-flow-col auto-cols-[17rem] gap-3 lg:min-w-0 lg:auto-cols-fr">
        {columns.map((col) => (
          <section
            key={col.id}
            aria-label={col.label}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(col.id);
            }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(DRAG_TYPE);
              setOver(null);
              if (!id) return;
              e.preventDefault();
              const item = items.find((i) => i.id === id);
              if (item && item.status !== col.id) onPatch(id, { status: col.id });
            }}
            className={`flex min-h-48 flex-col gap-2 p-2 transition-colors ${R.panel} ${over === col.id ? "bg-violet-500/10" : "bg-secondary/50"}`}
          >
            <header className="flex items-center justify-between px-1 pt-1">
              <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                <StatusDot status={col.id} />{col.label}
                <span className="text-xs font-normal tabular-nums text-muted-foreground">{col.items.length}</span>
              </h2>
              <button
                type="button"
                aria-label={`${col.label}에 콘텐츠 추가`}
                onClick={() => onCreate({ status: col.id })}
                className={`inline-flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground ${R.control}`}
              ><Plus className="h-4 w-4" aria-hidden /></button>
            </header>
            {col.items.map((item) => (
              <ItemCard key={item.id} item={item} color={projectColor(item.projectId)} projectName={projectName(item.projectId)} showProject={showProject} onOpen={() => onOpen(item.id)} />
            ))}
            {col.items.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">비어 있어요</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
