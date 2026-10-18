import "server-only";
/**
 * 주간 보고 AI 다듬기 — 낱말 규칙으로 만든 초안(일지 줄을 행사·분류로 나눈 것)을
 * 지난 보고서들의 문체와 흐름대로 합치고 다듬는다. 사람이 매주 하던 일: 비슷한 일 여러 줄을
 * "엠버서더 2차 미션 운영, 3차 미션 전달" 처럼 한 줄로, 금주 목표는 지난 보고의 흐름을 이어서.
 *
 * ANTHROPIC_API_KEY 가 있을 때만 켜진다(Vercel 환경 변수). 키는 서버에서만 쓴다.
 */
import { blockText, type ReportRow, type WeeklyReport } from "@/lib/worklog";

export function worklogAiAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function reportAsText(rows: ReportRow[]): string {
  const out: string[] = [];
  for (const row of rows) {
    if (row.pairs.length === 0) continue;
    out.push(`■ ${row.groupName.replace(/\n/g, " ")}`);
    for (const p of row.pairs) {
      if (p.last) out.push(`  전주 달성 (${p.last.status || "-"})\n${indent(blockText(p.last))}`);
      if (p.next) out.push(`  금주 목표 (${p.next.status || "-"})\n${indent(blockText(p.next))}`);
    }
  }
  return out.join("\n");
}
const indent = (s: string) => s.split("\n").map((l) => `    ${l}`).join("\n");

const SYSTEM = `너는 전시 회사 디지털마케팅(DM)팀의 주간 업무 보고를 쓰는 사람이다.
팀원들이 매일 적은 업무일지 줄(행사·분류로 1차 정리된 초안)을 받아, 회사에 내는 "DM 주간 업무 보고" 칸 글로 다듬는다.

규칙
- 행사 줄은 주어진 목록 그대로, 같은 순서·같은 이름(groupName 을 글자 그대로 복사)으로 낸다. 줄을 빼거나 새로 만들지 않는다.
- 한 행사 안에서 분류 묶음은 [운영] [콘텐츠] [퍼포먼스] [제작] [기획] [홈페이지] [SNS] 중에서 고른다(지난 보고서에서 그 행사에 쓰던 분류를 우선).
  행사를 못 찾은 "기타" 줄은 초안의 분류(행사 줄임말일 수 있음)를 그대로 둬도 된다.
- 같은 일을 가리키는 여러 줄은 한 줄로 합친다. 한 묶음에 보통 2~7줄. 명사형으로 짧게 끝낸다("~ 운영", "~ 제작 및 업로드", "~ 모니터링", "~ 소통").
  날짜가 의미 있으면 괄호로 "(10/8)" 처럼. 사람 이름·내부 메모·감탄·이모지·시각(9시 등)은 뺀다.
- 회의, 연차, 전표 입력, 주간업무보고 작성 같은 일상 업무는 쓰지 않는다.
- 전주 달성은 실제로 한 일을 쓴다. 달성: 전부 끝났으면 "완료", 이어지는 일이면 "진행".
- 금주 목표는 초안의 금주 줄(미리 적은 일·이월된 일)을 바탕으로, 지난 보고서의 흐름(지난 금주 목표 → 이번 전주 달성 → 다음 단계)을 이어 현실적으로 쓴다.
  근거 없는 새 일을 지어내지 않는다. 달성: 시작 전이면 "예정", 하고 있으면 "진행".
- [지표] 묶음은 글자 그대로 둔다.
- 초안에 줄이 하나도 없는 행사는 pairs 를 빈 배열로 둔다.

출력은 JSON 하나만(설명·코드블록 없이):
{"rows":[{"groupName":"...","pairs":[{"last":{"category":"운영","lines":["..."],"status":"진행"}|null,"next":{"category":"운영","lines":["..."],"status":"진행"}|null}]}]}`;

export async function polishReportWithAi(input: {
  draft: WeeklyReport;
  previous: Array<{ reportDate: string; rows: ReportRow[] }>;
}): Promise<ReportRow[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI 키가 없어요");
  const { draft, previous } = input;

  const examples = previous
    .map((p) => `### ${p.reportDate} 보고서\n${reportAsText(p.rows)}`)
    .join("\n\n");
  const rowsJson = JSON.stringify(
    draft.rows.map((r) => ({
      groupName: r.groupName,
      pairs: r.pairs.map((p) => ({
        last: p.last && { category: p.last.category, lines: p.last.lines, status: p.last.status },
        next: p.next && { category: p.next.category, lines: p.next.lines, status: p.next.status },
      })),
    })),
  );
  const user = [
    `보고일: ${draft.reportDate} (전주 달성 ${draft.lastWeek.start}~${draft.lastWeek.end}, 금주 목표 ${draft.thisWeek.start}~${draft.thisWeek.end})`,
    examples ? `\n## 지난 보고서(문체·분류·흐름을 따라 할 것, 최근 순)\n${examples}` : "",
    `\n## 이번 주 업무일지 초안(행사·분류로 1차 정리, 일지 원문 그대로)\n${rowsJson}`,
    `\n위 규칙대로 이번 보고서를 JSON 으로 써 줘.`,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.WORKLOG_AI_MODEL || "claude-sonnet-5-5",
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(55_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? `AI 응답 오류(${res.status})`);
  const text: string = (data?.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as { rows?: Array<{ groupName?: string; pairs?: unknown[] }> };
  const out = Array.isArray(parsed.rows) ? parsed.rows : [];

  // 행사 줄은 초안 기준으로 — 이름으로 찾고, 못 찾으면 같은 자리.
  return draft.rows.map((row, i) => {
    const hit = out.find((r) => (r.groupName ?? "").replace(/\s+/g, "") === row.groupName.replace(/\s+/g, "")) ?? out[i];
    const pairs = Array.isArray(hit?.pairs) ? hit!.pairs : [];
    const owners = (cat: string, side: "last" | "next") =>
      [...new Set(row.pairs.flatMap((p) => (p[side] && p[side]!.category === cat ? p[side]!.owners : [])))];
    const block = (b: unknown, side: "last" | "next") => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, unknown>;
      const lines = Array.isArray(o.lines) ? o.lines.filter((l): l is string => typeof l === "string" && !!l.trim()).map((l) => l.trim()) : [];
      const category = typeof o.category === "string" ? o.category.trim().slice(0, 40) : "";
      if (!lines.length) return null;
      return { category, lines, owners: owners(category, side), status: typeof o.status === "string" ? o.status.slice(0, 10) : "", extra: [] };
    };
    return {
      groupId: row.groupId,
      groupName: row.groupName,
      pairs: pairs
        .map((p) => { const po = (p ?? {}) as Record<string, unknown>; return { last: block(po.last, "last"), next: block(po.next, "next") }; })
        .filter((p) => p.last || p.next),
    };
  });
}
