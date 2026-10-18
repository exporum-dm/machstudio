import { describe, expect, it } from "vitest";
import { blockText, buildWeeklyReport, effectiveStatus, groupDateLabel, openStatus, parsePastedWork, reportTable, resolveWorkTag, splitWorkTag, weekOf, type WorkEntryInput } from "@/lib/worklog";

const entry = (patch: Partial<WorkEntryInput>): WorkEntryInput => ({
  id: Math.random().toString(36).slice(2), groupId: "la", authorId: "u1", date: "2026-10-14",
  category: "운영", content: "엠버서더 미션 운영", status: "done", result: "", note: "", ...patch,
});
const names: Record<string, string> = { u1: "이창환", u2: "소현지" };
const groups = [
  { id: "la", name: "코리아 엑스포 LA", startDate: "2026-10-22", endDate: "2026-10-24", sortOrder: 1 },
  { id: "stk", name: "STK", startDate: "2027-06-02", endDate: "2027-06-04", sortOrder: 2 },
];
const report = (entries: WorkEntryInput[], reportDate = "2026-10-16") =>
  buildWeeklyReport({ reportDate, groups, entries, authorName: (id) => names[id] ?? id });

describe("주(월~일)", () => {
  it("보고일이 속한 주와 그 앞 주", () => {
    expect(weekOf("2026-10-16")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(weekOf("2026-10-12")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(weekOf("2026-10-18")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(report([]).lastWeek).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });

  it("행사 날짜는 시트 모양으로", () => {
    expect(groupDateLabel("2026-10-22", "2026-10-24")).toBe("(2026. 10. 22 - 24)");
    expect(groupDateLabel("2026-09-29", "2026-10-02")).toBe("(2026. 9. 29 - 10. 2)");
    expect(groupDateLabel(null, null)).toBe("");
  });
});

describe("주간 보고 만들기", () => {
  it("전주 줄은 전주 달성, 금주 줄은 금주 목표 — 행사·분류로 묶는다", () => {
    const r = report([
      entry({ date: "2026-10-08", content: "엠버서더 3차 미션 운영", status: "done" }),
      entry({ date: "2026-10-09", category: "콘텐츠", content: "D-10 스토리 업로드", status: "done", result: "인스타 스토리 2건" }),
      entry({ date: "2026-10-14", content: "현장 미션 전달", status: "planned", note: "10/22 전까지" }),
    ]);
    const la = r.rows.find((row) => row.groupId === "la")!;
    expect(la.groupName).toBe("코리아 엑스포 LA (2026. 10. 22 - 24)");
    const ops = la.pairs.find((p) => (p.last ?? p.next)!.category === "운영")!;
    expect(ops.last!.lines).toEqual(["엠버서더 3차 미션 운영"]);
    expect(ops.last!.status).toBe("완료");
    expect(ops.next!.lines).toEqual(["현장 미션 전달"]);
    expect(ops.next!.status).toBe("예정");
    expect(ops.next!.extra).toEqual(["10/22 전까지"]);
    const content = la.pairs.find((p) => (p.last ?? p.next)!.category === "콘텐츠")!;
    expect(content.last!.extra).toEqual(["인스타 스토리 2건"]);
  });

  it("며칠 적은 같은 내역은 한 줄, 담당자는 모아서", () => {
    const r = report([
      entry({ date: "2026-10-06", category: "퍼포먼스", content: "광고 모니터링" }),
      entry({ date: "2026-10-07", category: "퍼포먼스", content: "광고 모니터링 ", authorId: "u2" }),
    ]);
    const perf = r.rows.find((row) => row.groupId === "la")!.pairs[0].last!;
    expect(perf.lines).toEqual(["광고 모니터링"]);
    expect(perf.owners).toEqual(["이창환", "소현지"]);
  });

  it("전주에 진행으로 끝난 일은 금주 목표로 이월된다", () => {
    const r = report([entry({ date: "2026-10-07", content: "크리에이터 협약", status: "doing" })]);
    const pair = r.rows.find((row) => row.groupId === "la")!.pairs[0];
    expect(pair.last!.status).toBe("진행");
    expect(pair.next!.lines).toEqual(["크리에이터 협약"]);
  });

  it("완료와 예정이 섞이면 진행, 행사 없는 줄은 기타로", () => {
    const r = report([
      entry({ date: "2026-10-13", status: "done", content: "a" }),
      entry({ date: "2026-10-14", status: "planned", content: "b" }),
      entry({ date: "2026-10-14", groupId: null, category: "기획", content: "인수인계서 작성" }),
    ]);
    expect(r.rows.find((row) => row.groupId === "la")!.pairs[0].next!.status).toBe("진행");
    expect(r.rows.at(-1)!.groupName).toBe("기타");
  });

  it("줄이 없는 행사도 시트처럼 이름은 남긴다(보관한 행사·빈 기타는 뺀다)", () => {
    const r = buildWeeklyReport({
      reportDate: "2026-10-16",
      groups: [...groups, { id: "old", name: "지난 행사", startDate: null, endDate: null, sortOrder: 3, archived: true }],
      entries: [],
      authorName: () => "",
    });
    expect(r.rows.map((row) => row.groupId)).toEqual(["la", "stk"]);
  });

  it("시트에 붙일 표 — 행사 이름은 묶음 첫 줄에만, 담당 숨기기", () => {
    const r = report([
      entry({ date: "2026-10-08", content: "a" }),
      entry({ date: "2026-10-08", category: "콘텐츠", content: "b", result: "결과물" }),
    ]);
    const table = reportTable(r, { hideOwners: true });
    expect(table[1]).toEqual(["행사", "내역", "담당", "달성", "결과 및 산출물", "내역", "담당", "달성", "비고"]);
    const laRows = table.filter((row) => row[1].includes("- a") || row[1].includes("- b"));
    expect(laRows[0][0]).toContain("코리아 엑스포 LA");
    expect(laRows[1][0]).toBe("");
    expect(laRows[1][2]).toBe("");
    expect(laRows[1][4]).toBe("");
    expect(blockText(r.rows[0].pairs[0].last)).toBe("[운영]\n- a");
  });
});

describe("시트처럼 적기", () => {
  const groups = [
    { id: "la", name: "코리아 엑스포 LA", sortOrder: 1 },
    { id: "stk", name: "STK", sortOrder: 2 },
  ];

  it("머리표를 떼고 글머리도 뗀다", () => {
    expect(splitWorkTag("[LA] - 배너 교체")).toEqual({ tag: "LA", content: "배너 교체" });
    expect(splitWorkTag("- 스토리 업로드")).toEqual({ tag: null, content: "스토리 업로드" });
  });

  it("머리표 → 행사(이름 일부도), 아니면 분류", () => {
    expect(resolveWorkTag("LA", groups)).toEqual({ groupId: "la", category: "" });
    expect(resolveWorkTag("stk", groups)).toEqual({ groupId: "stk", category: "" });
    expect(resolveWorkTag("운영", groups)).toEqual({ groupId: null, category: "운영" });
  });

  it("시트 칸을 붙여 넣으면 머리표가 아래 줄로 이어진다", () => {
    expect(parsePastedWork("[STK]\n- 웨비나 예정\n- GEO\n\n[IB]\n- 사전등록 데이터")).toEqual([
      { tag: "STK", content: "웨비나 예정" },
      { tag: "STK", content: "GEO" },
      { tag: "IB", content: "사전등록 데이터" },
    ]);
  });

  it("취소선이 아니면 날짜로 진행/예정", () => {
    expect(effectiveStatus("done", "2026-10-30", "2026-10-18")).toBe("done");
    expect(effectiveStatus("planned", "2026-10-12", "2026-10-18")).toBe("doing");
    expect(effectiveStatus("doing", "2026-10-30", "2026-10-18")).toBe("planned");
    expect(openStatus(null, "2026-10-18")).toBe("planned");
  });
});
