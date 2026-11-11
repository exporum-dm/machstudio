import { formatKst } from "@/lib/datetime";
import type { DevLogEntry } from "@/lib/dev-log";

const dayKey = (iso: string) => formatKst(iso, { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
const timeOf = (iso: string) => formatKst(iso, { hour: "2-digit", minute: "2-digit" });

/**
 * 개발 로그 — main 에 병합된(= 운영에 배포된) 변경을 날짜별로.
 * 제목과 PR 본문 앞 몇 줄로 "무엇이 바뀌었나"를 보여주고, 자세한 건 PR 링크로 넘긴다.
 */
export function DevLogList({
  entries,
  error,
  repo,
  deployed,
}: {
  entries: DevLogEntry[];
  error: string | null;
  repo: string;
  /** 지금 운영 중인 버전(Vercel 이 빌드한 커밋) — 로컬 개발 서버에서는 없다. */
  deployed: { sha: string; message: string } | null;
}) {
  const groups: Array<{ day: string; items: DevLogEntry[] }> = [];
  for (const entry of entries) {
    const day = dayKey(entry.mergedAt);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(entry);
    else groups.push({ day, items: [entry] });
  }
  return (
    <div className="space-y-6">
      <p className="text-xs leading-5 text-muted-foreground">
        main 에 병합된 변경이에요. 병합되면 몇 분 안에 운영에 배포돼요.
        {deployed && (
          <>
            {" "}지금 운영 중인 버전: <span className="font-mono">{deployed.sha}</span>
            {deployed.message && <> · {deployed.message}</>}
          </>
        )}
      </p>
      {error && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{error}</p>}
      {!error && entries.length === 0 && <p className="text-sm text-muted-foreground">병합된 변경이 아직 없어요.</p>}
      {groups.map((group) => (
        <section key={group.day}>
          <h3 className="py-2 text-xs font-semibold text-muted-foreground">{group.day} · {group.items.length}건</h3>
          <ul className="divide-y divide-border border-y border-border">
            {group.items.map((entry) => (
              <li key={entry.number} className="grid grid-cols-[3.25rem_1fr] gap-3 py-3">
                <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">{timeOf(entry.mergedAt)}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">
                    {entry.title}
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 font-mono text-xs font-normal text-violet-500 hover:underline"
                    >
                      #{entry.number}
                    </a>
                  </p>
                  {entry.summary.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-foreground/80">
                      {entry.summary.map((line, i) => (
                        <li key={i} className="break-words before:mr-1.5 before:text-muted-foreground before:content-['·']">{line}</li>
                      ))}
                    </ul>
                  )}
                  {entry.author && <p className="mt-1 text-[11px] text-muted-foreground">{entry.author}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-[11px] text-muted-foreground">
        출처: <a className="hover:underline" href={`https://github.com/${repo}/pulls?q=is%3Apr+is%3Amerged`} target="_blank" rel="noreferrer">github.com/{repo}</a>
      </p>
    </div>
  );
}
