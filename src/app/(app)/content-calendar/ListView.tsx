"use client";

/**
 * 목록 보기 — 한 줄 = 한 콘텐츠. 발행일·상태는 줄에서 바로 고치고, 제목을 누르면 상세가 열린다.
 * 발행일 순, 날짜 미정은 맨 아래.
 */
import { useMemo } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { FINISH, R } from "@/components/ui/primitives";
import { CONTENT_STATUSES, compareItems, dayLabel, isContentStatus, isValidDay } from "@/lib/content-calendar";
import { ItemCard, StatusDot, type ViewProps } from "./parts";

const CELL_INPUT = `w-full bg-transparent px-2 py-1.5 text-sm transition-colors hover:bg-secondary ${R.control}`;

export default function ListView({ items, projectName, projectColor, showProject, onOpen, onCreate, onPatch }: ViewProps) {
  const rows = useMemo(() => [...items].sort(compareItems), [items]);

  if (rows.length === 0) {
    return (
      <div className={`flex flex-col items-center gap-3 bg-card px-6 py-14 text-center ${R.panel} ${FINISH.s1}`}>
        <p className="text-sm text-muted-foreground">이 달에 올릴 콘텐츠가 없어요.</p>
        <button type="button" onClick={() => onCreate({})} className={`inline-flex min-h-9 items-center gap-1.5 bg-violet-500 px-3 text-sm font-medium text-white hover:bg-violet-600 ${R.control}`}>
          <Plus className="h-4 w-4" aria-hidden />새 콘텐츠
        </button>
      </div>
    );
  }

  return (
    <>
      {/* 좁은 화면: 카드 */}
      <div className="space-y-2 sm:hidden">
        {rows.map((item, i) => {
          const head = i === 0 || rows[i - 1].date !== item.date;
          return (
            <div key={item.id} className="space-y-2">
              {head && <h3 className="pt-2 text-xs font-semibold text-muted-foreground">{item.date ? dayLabel(item.date) : "날짜 미정"}</h3>}
              <ItemCard item={item} color={projectColor(item.projectId)} projectName={projectName(item.projectId)} showProject={showProject} showDate={false} onOpen={() => onOpen(item.id)} />
            </div>
          );
        })}
      </div>

      {/* 넓은 화면: 표 */}
      <div className={`hidden overflow-x-auto bg-card sm:block ${R.panel} ${FINISH.s1}`}>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-40 px-3 py-2.5 font-medium">발행일</th>
              <th className="px-3 py-2.5 font-medium">제목</th>
              {showProject && <th className="w-36 px-3 py-2.5 font-medium">프로젝트</th>}
              <th className="w-40 px-3 py-2.5 font-medium">채널</th>
              <th className="w-24 px-3 py-2.5 font-medium">형식</th>
              <th className="w-32 px-3 py-2.5 font-medium">상태</th>
              <th className="w-24 px-3 py-2.5 font-medium">담당</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id} className="border-b border-border last:border-b-0 hover:bg-secondary/40">
                <td className="px-1 py-1">
                  <input
                    type="date"
                    aria-label={`${item.title} 발행일`}
                    value={item.date ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") onPatch(item.id, { date: null });
                      else if (isValidDay(v)) onPatch(item.id, { date: v });
                    }}
                    className={`${CELL_INPUT} tabular-nums ${item.date ? "" : "text-muted-foreground"}`}
                  />
                </td>
                <td className="px-3 py-1">
                  <button type="button" onClick={() => onOpen(item.id)} className="w-full py-1.5 text-left font-medium hover:underline">
                    {item.title}
                  </button>
                  {item.link && (
                    <a href={item.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3 w-3" aria-hidden />게시물
                    </a>
                  )}
                </td>
                {showProject && (
                  <td className="px-3 py-1">
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
                      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${projectColor(item.projectId)}`} /><span className="truncate">{projectName(item.projectId)}</span>
                    </span>
                  </td>
                )}
                <td className="px-3 py-1">
                  <span className="flex flex-wrap gap-1">{item.channels.map((c) => <span key={c} className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">{c}</span>)}</span>
                </td>
                <td className="px-3 py-1 text-xs">{item.format}</td>
                <td className="px-1 py-1">
                  <label className="relative flex items-center">
                    <span className="sr-only">{item.title} 상태</span>
                    <StatusDot status={item.status} className="pointer-events-none absolute left-2.5" />
                    <select
                      value={item.status}
                      onChange={(e) => { if (isContentStatus(e.target.value)) onPatch(item.id, { status: e.target.value }); }}
                      className={`${CELL_INPUT} appearance-none pl-6`}
                    >
                      {CONTENT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </label>
                </td>
                <td className="px-3 py-1 text-xs">{item.assigneeName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
