import { describe, expect, it } from "vitest";
import { isColumnFilterActive, parseColumnFilters } from "@/lib/collect-record-filter-model";
import { columnFilterConditions } from "@/lib/collect-record-filters";
import { filterValueLabel, summarizeFilter } from "@/app/(app)/collect/[id]/ColumnFilterButton";

/** 등록자 DB 열 필터 — 목록·CSV·전체 선택(삭제)이 같은 cf 를 쓴다(2026-10-14). */
describe("열 필터 파싱", () => {
  it("항목 열·고정 열만 받고, 모르는 열·빈 필터는 버린다", () => {
    const parsed = parseColumnFilters(JSON.stringify([
      { c: "field:age", values: ["25-34", "25-34", ""] },
      { c: "utmSource", contains: " meta " },
      { c: "checkin", values: ["입장"] },
      { c: "createdAt", contains: "x" },
      { c: "field:", contains: "x" },
      { c: "field:email" },
    ]));
    expect(parsed).toEqual([
      { c: "field:age", values: ["25-34"] },
      { c: "utmSource", contains: "meta" },
      { c: "checkin", values: ["입장"] },
    ]);
  });

  it("깨진 값은 빈 목록 — 목록 전체가 깨지지 않는다", () => {
    expect(parseColumnFilters("{not json")).toEqual([]);
    expect(parseColumnFilters(JSON.stringify({ c: "field:a" }))).toEqual([]);
    expect(parseColumnFilters(null)).toEqual([]);
  });

  it("조건은 필터마다 들어가고, 입장 열은 둘 다 고르면 거르지 않는다", () => {
    expect(columnFilterConditions(parseColumnFilters(JSON.stringify([
      { c: "field:age", values: ["25-34"], contains: "2", empty: "notEmpty" },
    ])))).toHaveLength(3);
    expect(columnFilterConditions([{ c: "checkin", values: ["입장", "미입장"] }])).toHaveLength(0);
    expect(columnFilterConditions([{ c: "checkin", values: ["입장"] }])).toHaveLength(1);
  });

  it("항목 키와 값은 SQL 에 그대로 붙지 않고 파라미터로 간다", () => {
    const [sql] = columnFilterConditions([{ c: "field:a'; drop table x;--", contains: "x' or 1=1" }]);
    expect(sql.sql).not.toContain("drop table");
    expect(sql.values).toContain("a'; drop table x;--");
  });
});

describe("열 필터 표시", () => {
  it("참/거짓·빈 값은 표와 같은 글자로", () => {
    expect(filterValueLabel("true")).toBe("TRUE");
    expect(filterValueLabel("__empty__")).toBe("(비어 있음)");
  });

  it("칩 요약", () => {
    expect(summarizeFilter({ c: "field:age", values: ["16-24", "25-34"] })).toBe("16-24, 25-34");
    expect(summarizeFilter({ c: "field:email", contains: "gmail", empty: "notEmpty" })).toBe("‘gmail’ 포함 · 비어 있지 않음");
    expect(isColumnFilterActive({ c: "field:a" })).toBe(false);
  });
});
