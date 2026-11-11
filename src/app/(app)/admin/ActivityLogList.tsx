import { formatKst } from "@/lib/datetime";
import {
  ACTIVITY_CATEGORIES,
  activityDetails,
  activityLabel,
  activityTarget,
  type ActivityNames,
} from "@/lib/activity-labels";

export interface AdminActivityRow {
  id: string;
  action: string;
  createdAt: Date;
  meta: unknown;
  workspace: { name: string };
  user: { email: string; name: string | null } | null;
  source: { name: string } | null;
}

/** 한 줄에 펼쳐 보이는 세부 문장 수 — 나머지는 접어 둔다. */
const SHOWN_DETAILS = 4;

const dayKey = (d: Date) => formatKst(d, { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
const timeOf = (d: Date) => formatKst(d, { hour: "2-digit", minute: "2-digit" });

/** 활동 로그 거르기 칩 — 링크라 서버 컴포넌트에서 그대로 쓴다. */
export function ActivityCategoryChips({ current }: { current: string }) {
  const chips = [{ id: "", label: "전체" }, ...ACTIVITY_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))];
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => {
        const active = chip.id === current;
        const href = chip.id ? `/admin?view=activity&cat=${chip.id}` : "/admin?view=activity";
        return (
          <a
            key={chip.id || "all"}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${active ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
          >
            {chip.label}
          </a>
        );
      })}
    </div>
  );
}

/**
 * 관리자 활동 로그 — 날짜별로 묶고, 한 줄에 "무엇을 · 어디에 · 누가 · 몇 시"와 세부 내용을 보여준다.
 * 예전엔 action 코드(webinar.updated)와 워크스페이스·사람만 떠서 무엇을 했는지 알 수 없었다.
 */
export function ActivityLogList({ rows, names }: { rows: AdminActivityRow[]; names: ActivityNames }) {
  if (rows.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">이 조건의 활동 로그가 없습니다.</p>;
  }
  const groups: Array<{ day: string; items: AdminActivityRow[] }> = [];
  for (const row of rows) {
    const day = dayKey(row.createdAt);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(row);
    else groups.push({ day, items: [row] });
  }
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.day}>
          <h3 className="sticky top-0 z-[1] bg-background/95 py-2 text-xs font-semibold text-muted-foreground backdrop-blur">
            {group.day} · {group.items.length}건
          </h3>
          <ul className="divide-y divide-border border-y border-border">
            {group.items.map((log) => {
              const target = activityTarget(log.meta, names, log.source?.name);
              const details = activityDetails(log.action, log.meta);
              const hidden = details.length - SHOWN_DETAILS;
              return (
                <li key={log.id} className="grid grid-cols-[3.25rem_1fr] gap-3 py-3">
                  <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">{timeOf(log.createdAt)}</span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                      <span className="font-medium">{activityLabel(log.action)}</span>
                      {target && <span className="min-w-0 break-words text-muted-foreground">{target}</span>}
                    </p>
                    {details.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-foreground/80">
                        {details.slice(0, SHOWN_DETAILS).map((line, i) => (
                          <li key={i} className="break-words before:mr-1.5 before:text-muted-foreground before:content-['·']">{line}</li>
                        ))}
                        {hidden > 0 && (
                          <li>
                            <details>
                              <summary className="cursor-pointer text-muted-foreground">외 {hidden}건 더 보기</summary>
                              <ul className="mt-0.5 space-y-0.5">
                                {details.slice(SHOWN_DETAILS).map((line, i) => (
                                  <li key={i} className="break-words before:mr-1.5 before:text-muted-foreground before:content-['·']">{line}</li>
                                ))}
                              </ul>
                            </details>
                          </li>
                        )}
                      </ul>
                    )}
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {log.user?.name || log.user?.email || "시스템"} · {log.workspace.name}
                      <span className="ml-1.5 font-mono opacity-60">{log.action}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
