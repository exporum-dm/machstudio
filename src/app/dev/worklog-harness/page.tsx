"use client";

/**
 * 업무일지 하니스 — 개발 환경 전용(프로덕션 404).
 * 일지·주간 보고 탭을 로그인 없이 확인한다. API 는 메모리 저장소로 가로챈다(보고서는 실제 lib 로 만든다).
 */
import { useState } from "react";
import { notFound } from "next/navigation";
import JournalTab from "@/app/(app)/worklog/JournalTab";
import ReportTab from "@/app/(app)/worklog/ReportTab";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { buildWeeklyReport, kstToday, reportTable, shiftDay, weekOf, type WorkEntryInput } from "@/lib/worklog";
import type { WorkGroupDto } from "@/app/(app)/worklog/types";

const GROUPS: WorkGroupDto[] = [
  { id: "la", name: "코리아 엑스포 LA", projectId: null, startDate: "2026-10-22", endDate: "2026-10-24", archived: false, sortOrder: 1, aliases: ["코엑"] },
  { id: "stk", name: "STK", projectId: null, startDate: "2027-06-02", endDate: "2027-06-04", archived: false, sortOrder: 2, aliases: [] },
];

type Row = Omit<WorkEntryInput, "date"> & { createdById?: string; date: string | null; common: boolean; sortOrder: number; authorName: string; createdAt: string; updatedAt: string };
let n = 0;
const savedReports = new Map<string, { rows: ReturnType<typeof buildWeeklyReport>["rows"]; source: string; updatedAt: string }>();
const store: Row[] = (() => {
  const mon = weekOf(kstToday()).start;
  const last = shiftDay(mon, -7);
  const mk = (p: Partial<Row>): Row => ({ id: Math.random().toString(36).slice(2), groupId: "la", authorId: "me", authorName: "이창환", date: mon, common: false, sortOrder: ++n, category: "운영", content: "", status: "done", result: "", note: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...p });
  return [
    mk({ date: shiftDay(last, 1), content: "엠버서더 3차 미션 운영" }),
    mk({ date: shiftDay(last, 2), groupId: null, category: "코엑", content: "바닐라코 협찬 소통" }),
    mk({ date: shiftDay(last, 2), groupId: null, category: "", content: "주간업무보고 작성", common: true }),
    mk({ date: shiftDay(last, 2), category: "콘텐츠", content: "D-10 스토리 업로드", result: "인스타 스토리 2건" }),
    mk({ date: shiftDay(last, 3), category: "퍼포먼스", content: "메타 광고비 증액, 소재 추가", status: "doing" }),
    mk({ date: mon, content: "현장 미션 전달", status: "planned", note: "10/22 전" }),
    mk({ date: mon, groupId: "stk", category: "홈페이지", content: "FAQ 메뉴 생성", status: "doing", authorId: "u2", authorName: "소현지" }),
    mk({ date: kstToday(), groupId: null, category: "", content: "주간업무회의", status: "planned", common: true }),
    mk({ date: shiftDay(kstToday(), 3), category: "", content: "현장 리허설", status: "planned" }),
    mk({ date: null, groupId: null, category: "기타", content: "월간엑스포럼 형식 변경 검토", status: "planned" }),
  ];
})();

if (typeof window !== "undefined" && !(window as { __wl?: boolean }).__wl) {
  (window as { __wl?: boolean }).__wl = true;
  const orig = window.fetch.bind(window);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/api/worklog/entries") {
      if (!init?.method || init.method === "GET") {
        const from = url.searchParams.get("from")!, to = url.searchParams.get("to")!;
        const someday = url.searchParams.get("someday") === "1";
        return json({
          entries: store.filter((e) => (e.date === null ? someday : e.date >= from && e.date <= to)),
          members: [{ id: "me", name: "이창환" }, { id: "u2", name: "소현지" }, { id: "u3", name: "김주현" }],
          me: "me", isAdmin: false,
        });
      }
      const body = init.body ? JSON.parse(String(init.body)) : {};
      if (init.method === "POST") {
        const NAMES: Record<string, string> = { me: "이창환", u2: "소현지", u3: "김주현" };
        const mkRow = (b: Record<string, unknown>): Row => ({ id: Math.random().toString(36).slice(2), authorId: (b.authorId as string) || "me", authorName: NAMES[(b.authorId as string) || "me"], createdById: "me", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), groupId: (b.groupId as string) ?? null, date: (b.date as string | null) ?? null, common: !!b.common, sortOrder: Number(b.sortOrder) || 0, category: (b.category as string) ?? "", content: b.content as string, status: (b.status as Row["status"]) ?? "planned", result: (b.result as string) ?? "", note: (b.note as string) ?? "" });
        if (Array.isArray(body.items)) {
          const rows = body.items.map(mkRow);
          store.push(...rows);
          return json({ entries: rows }, 201);
        }
        const row = mkRow(body);
        store.push(row);
        return json({ entry: row }, 201);
      }
      if (init.method === "PATCH") {
        const row = store.find((e) => e.id === body.id)!;
        Object.assign(row, body);
        return json({ entry: row });
      }
      if (init.method === "DELETE") {
        const id = url.searchParams.get("id");
        store.splice(store.findIndex((e) => e.id === id), 1);
        return json({ ok: true });
      }
    }
    if (url.pathname === "/api/worklog/report") {
      const date = url.searchParams.get("date")!;
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        savedReports.set(body.date, { rows: body.rows, source: body.source, updatedAt: new Date().toISOString() });
        return json({ saved: { source: body.source, updatedAt: new Date().toISOString() } });
      }
      if (init?.method === "DELETE") { savedReports.delete(date); return json({ ok: true }); }
      const draft = buildWeeklyReport({
        reportDate: date,
        groups: GROUPS,
        entries: store.filter((e): e is Row & { date: string } => e.date !== null),
        authorName: (id) => store.find((e) => e.authorId === id)?.authorName ?? id,
      });
      const hit = url.searchParams.get("fresh") === "1" ? undefined : savedReports.get(date);
      const report = hit ? { ...draft, rows: hit.rows } : draft;
      return json({ report, table: reportTable(report), saved: hit ? { source: hit.source, updatedAt: hit.updatedAt } : null, aiAvailable: false });
    }
    return orig(input, init);
  };
}

export default function WorklogHarness() {
  if (process.env.NODE_ENV === "production") notFound();
  const [tab, setTab] = useState<"journal" | "report">("journal");
  return (
    <ConfirmProvider>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex gap-2 text-sm">
          <button data-testid="tab-journal" onClick={() => setTab("journal")} className={tab === "journal" ? "font-semibold" : ""}>일지</button>
          <button data-testid="tab-report" onClick={() => setTab("report")} className={tab === "report" ? "font-semibold" : ""}>주간 보고</button>
        </div>
        {tab === "journal" ? <JournalTab workspaceId="ws" groups={GROUPS} onGoGroups={() => {}} /> : <ReportTab workspaceId="ws" hasGroups />}
      </div>
    </ConfirmProvider>
  );
}
