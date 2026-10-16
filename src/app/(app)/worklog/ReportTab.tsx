"use client";

/**
 * 주간 보고 — 업무일지로 DM 주간 업무 보고 표를 만든다(lib/worklog.ts).
 * 보고일이 속한 주 = 금주 목표, 그 앞 주 = 전주 달성. 엑셀은 시트와 같은 자리(B2~)·같은 시트 이름(YYMMDD).
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { kstToday, type WeeklyReport } from "@/lib/worklog";

const md = (day: string) => {
  const [, m, d] = day.split("-");
  return `${Number(m)}/${Number(d)}`;
};

export default function ReportTab({ workspaceId, hasGroups }: { workspaceId: string; hasGroups: boolean }) {
  const [date, setDate] = useState(kstToday());
  const [hideOwners, setHideOwners] = useState(false);
  const [metrics, setMetrics] = useState(true);
  const [data, setData] = useState<{ report: WeeklyReport; table: string[][] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const query = `workspaceId=${workspaceId}&date=${date}${hideOwners ? "&hideOwners=1" : ""}${metrics ? "&metrics=1" : ""}`;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/worklog/report?${query}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) { toast.error(json?.error ?? "보고서를 만들지 못했어요"); return; }
      setData(json);
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  /** 메신저·메일에 바로 붙일 글 — 행사별로 전주/금주. */
  const asText = () => {
    if (!data) return "";
    const lines: string[] = [`[주간 업무 보고] ${date}`, ""];
    const body = data.table.slice(2);
    let current = "";
    for (const row of body) {
      if (row[0]) { current = row[0]; lines.push(`■ ${current}`); }
      if (row[1]) lines.push(`  전주 (${row[3]}) ${row[1].replace(/\n/g, " ")}`);
      if (row[5]) lines.push(`  금주 (${row[7]}) ${row[5].replace(/\n/g, " ")}`);
    }
    return lines.join("\n");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      toast.success("복사했어요");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("복사하지 못했어요");
    }
  };

  const body = data?.table.slice(2) ?? [];
  const filled = body.filter((row) => row[1] || row[5]).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-[11px] text-muted-foreground">보고일</span>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${FIELD_CLS} h-8 w-40 text-xs`} />
          </label>
          {data && (
            <p className="pb-1.5 text-xs text-muted-foreground">
              전주 <b className="text-foreground">{md(data.report.lastWeek.start)}~{md(data.report.lastWeek.end)}</b> · 금주 <b className="text-foreground">{md(data.report.thisWeek.start)}~{md(data.report.thisWeek.end)}</b>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={metrics} onChange={(e) => setMetrics(e.target.checked)} className="accent-violet-500" />
            지표 붙이기
          </label>
          <label className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" title="회사 보고용 — 담당자·결과 칸을 비워요">
            <input type="checkbox" checked={hideOwners} onChange={(e) => setHideOwners(e.target.checked)} className="accent-violet-500" />
            담당·결과 숨기기
          </label>
          <button onClick={() => void load()} className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground ${R.control}`}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />다시 만들기
          </button>
          <button onClick={() => void copy()} disabled={!data} className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 ${R.control}`}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}글로 복사
          </button>
          <a href={`/api/worklog/report?${query}&format=xlsx`} download
            className={`flex items-center gap-1 bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-600 ${R.control}`}>
            <Download className="h-3 w-3" />엑셀 다운로드
          </a>
        </div>
      </div>

      {!hasGroups && (
        <p className={`bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 ${R.control}`}>
          행사가 없어서 모든 줄이 &ldquo;기타&rdquo;로 묶여요 — 행사 관리 탭에서 행사를 만들어 주세요.
        </p>
      )}
      {metrics && (
        <p className="text-[11px] text-muted-foreground">지표: 프로젝트와 이어진 행사에 전주 사전등록 증가·누적, 광고비·결과가 &ldquo;[지표]&rdquo; 줄로 붙어요(같은 프로젝트 행사가 여럿이면 가장 가까운 행사 하나에만).</p>
      )}

      {loading && !data ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : data && (
        <div className={`overflow-x-auto bg-background ${R.panel} ${FINISH.s1}`}>
          <table className="w-full min-w-[960px] border-collapse text-xs">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground">
                <th className="w-44 px-3 py-2" />
                <th colSpan={4} className="border-l border-border px-3 py-2 text-left font-semibold text-foreground">전주 달성</th>
                <th colSpan={4} className="border-l border-border px-3 py-2 text-left font-semibold text-foreground">금주 목표</th>
              </tr>
              <tr className="bg-secondary/30 text-left text-muted-foreground">
                {data.table[1].map((h, i) => (
                  <th key={i} className={`px-3 py-1.5 font-medium ${i === 1 || i === 5 ? "border-l border-border" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, i) => (
                <tr key={i} className={`align-top ${row[0] ? "border-t-2 border-border" : "border-t border-border/50"}`}>
                  {row.map((cell, c) => (
                    <td key={c}
                      className={`whitespace-pre-line px-3 py-2 ${c === 0 ? "font-medium" : ""} ${c === 1 || c === 5 ? "border-l border-border" : ""} ${c === 3 || c === 7 ? "whitespace-nowrap text-center" : ""} ${c === 2 || c === 4 || c === 6 || c === 8 ? "text-muted-foreground" : ""}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {filled === 0 && <p className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground">이 두 주에 적은 일지가 없어요 — 일지 탭에서 적으면 여기 채워져요.</p>}
        </div>
      )}
    </div>
  );
}
