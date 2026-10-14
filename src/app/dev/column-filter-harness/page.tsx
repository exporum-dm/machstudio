"use client";

/**
 * 등록자 DB 열 필터 하니스 — 개발 환경 전용(프로덕션 404).
 * 값 목록 API 는 로그인 뒤라, 여기서는 fetch 를 가로채 고정 값을 돌려준다(Oneday Class 실측 분포).
 */
import { useState } from "react";
import { notFound } from "next/navigation";
import ColumnFilterButton, { summarizeFilter } from "@/app/(app)/collect/[id]/ColumnFilterButton";
import type { ColumnFilter, ColumnFilterKey } from "@/lib/collect-record-filter-model";

const VALUES: Record<string, Array<{ value: string; count: number }>> = {
  "field:age": [{ value: "16-24", count: 57 }, { value: "25-34", count: 43 }, { value: "35-44", count: 36 }, { value: "45-54", count: 11 }, { value: "55-64", count: 6 }, { value: "Aged 65 and older", count: 2 }],
  "field:gender": [{ value: "Female", count: 139 }, { value: "Male", count: 16 }],
  "field:schedule_check": [{ value: "true", count: 155 }],
  utmSource: [{ value: "meta", count: 79 }, { value: "newsletter", count: 44 }, { value: "", count: 22 }, { value: "instagram", count: 10 }],
};

if (typeof window !== "undefined" && !(window as { __cfHarness?: boolean }).__cfHarness) {
  (window as { __cfHarness?: boolean }).__cfHarness = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/records/values")) {
      const c = new URL(url, location.origin).searchParams.get("c") ?? "";
      return new Response(JSON.stringify({ values: VALUES[c] ?? [], truncated: false }), { headers: { "Content-Type": "application/json" } });
    }
    return orig(input, init);
  };
}

const COLUMNS: Array<{ key: ColumnFilterKey; label: string; kind?: "checkin" }> = [
  { key: "field:age", label: "Age group" },
  { key: "field:gender", label: "Gender" },
  { key: "field:schedule_check", label: "Schedule Check (Oct 24, 13:30~14:10)" },
  { key: "checkin", label: "입장", kind: "checkin" },
  { key: "utmSource", label: "UTM 소스" },
];

export default function ColumnFilterHarness() {
  if (process.env.NODE_ENV === "production") notFound();
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  return (
    <div className="space-y-4 p-4">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className="max-w-[200px] px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <span className="truncate">{c.label}</span>
                    <ColumnFilterButton
                      sourceId="harness"
                      column={c.key}
                      kind={c.kind}
                      label={c.label}
                      value={filters[c.key]}
                      onChange={(next) => setFilters((prev) => {
                        const copy = { ...prev };
                        if (next) copy[c.key] = next;
                        else delete copy[c.key];
                        return copy;
                      })}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
      <pre data-testid="state" className="text-xs">{JSON.stringify(Object.values(filters).map((f) => [f.c, summarizeFilter(f)]))}</pre>
    </div>
  );
}
