import { describe, expect, it } from "vitest";
import {
  blockText, buildWeeklyReport, classifyWork, orderGroupsForReport, defaultReportDate, effectiveStatus, groupDateLabel, isRoutineWork, openStatus,
  parseBlockText, parsePastedWork, reportTable, reportWindows, resolveWorkTag, splitWorkTag, weekOf, type WorkEntryInput,
} from "@/lib/worklog";

const entry = (patch: Partial<WorkEntryInput>): WorkEntryInput => ({
  id: Math.random().toString(36).slice(2), groupId: "la", authorId: "u1", date: "2026-10-06",
  category: "", content: "엠버서더 미션 운영", status: "done", result: "", note: "", ...patch,
});
const names: Record<string, string> = { u1: "이창환", u2: "소현지" };
const groups = [
  { id: "la", name: "코리아 엑스포 LA", startDate: "2026-10-22", endDate: "2026-10-24", sortOrder: 1, aliases: ["코엑"] },
  { id: "stk", name: "STK", startDate: "2027-06-02", endDate: "2027-06-04", sortOrder: 2 },
];
// 261008 시트와 같은 보고일(목)
const report = (entries: WorkEntryInput[], reportDate = "2026-10-08") =>
  buildWeeklyReport({ reportDate, groups, entries, authorName: (id) => names[id] ?? id });

describe("보고일 · 기간", () => {
  it("보고일은 그 주 목요일, 전주 달성은 보고일까지 7일 · 금주 목표는 다음 7일", () => {
    expect(weekOf("2026-10-16")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(defaultReportDate("2026-10-18")).toBe("2026-10-15");
    expect(defaultReportDate("2026-10-12")).toBe("2026-10-15");
    expect(reportWindows("2026-10-08")).toEqual({ last: { start: "2026-10-02", end: "2026-10-08" }, next: { start: "2026-10-09", end: "2026-10-15" } });
  });

  it("행사 날짜는 시트 모양으로", () => {
    expect(groupDateLabel("2026-10-22", "2026-10-24")).toBe("(2026. 10. 22 - 24)");
    expect(groupDateLabel("2026-09-29", "2026-10-02")).toBe("(2026. 9. 29 - 10. 2)");
    expect(groupDateLabel(null, null)).toBe("");
  });
});

describe("행사 줄 순서", () => {
  it("행사 날짜가 가까운 순 — 이번 기간에 끝난 행사는 위, 오래전에 끝난 행사·날짜 없는 행사는 아래", () => {
    const g = (id: string, startDate: string | null, endDate: string | null, sortOrder: number) => ({ id, startDate, endDate, sortOrder });
    const order = orderGroupsForReport([
      g("bar", "2027-11-12", "2027-11-14", 1),
      g("edu-past", "2026-09-17", "2026-09-19", 2),
      g("la", "2026-10-22", "2026-10-24", 3),
      g("tokyo", "2027-04-02", "2027-04-04", 4),
      g("mint", "2027-04-15", "2027-04-16", 5),
      g("undated", null, null, 6),
      g("xspace", "2026-10-13", "2026-10-16", 7),
      g("old", "2026-05-01", "2026-05-03", 8),
    ], "2026-10-15").map((x) => x.id);
    expect(order).toEqual(["xspace", "la", "tokyo", "mint", "bar", "undated", "edu-past", "old"]);
    // 10/1 보고서: 9/19 에 끝난 에듀테크는 전주 달성 기간(9/25~10/1) 전이라 아래
    expect(orderGroupsForReport([g("edu", "2026-09-17", "2026-09-19", 2), g("la", "2026-10-22", "2026-10-24", 1)], "2026-09-24").map((x) => x.id)).toEqual(["edu", "la"]);
  });
});

describe("분류 · 일상 업무", () => {
  it("실제 보고서처럼 낱말로 나눈다", () => {
    expect(classifyWork("참관객 사전등록 캠페인 모니터링")).toBe("퍼포먼스");
    expect(classifyWork("에일린 킴 영상 편집")).toBe("콘텐츠");
    expect(classifyWork("oneday class 페이지 제작 & 포스터 제작")).toBe("제작");
    expect(classifyWork("2027 마케팅 전략 기획서 작성")).toBe("기획");
    expect(classifyWork("바닐라코 협찬 문의")).toBe("운영");
  });
  it("회의·연차·전표·주간보고는 보고서에 쓰지 않는다", () => {
    for (const c of ["연차", "주간업무회의", "주간업무보고 작성", "전표 입력", "9시 회의 & 11시 킥오프회의", "15:30 회의"]) expect(isRoutineWork(c)).toBe(true);
    expect(isRoutineWork("웨비나 기획 논의 (w.전시팀)")).toBe(false);
  });
});

describe("주간 보고 만들기", () => {
  it("일지 머리표 [코엑] 는 행사, 분류는 낱말로 — 전주 달성/금주 목표", () => {
    const r = report([
      entry({ groupId: null, category: "코엑", date: "2026-10-06", content: "엠버서더 3차 미션 운영" }),
      entry({ groupId: null, category: "코엑", date: "2026-10-07", content: "D-10 스토리 업로드", result: "인스타 스토리 2건" }),
      entry({ groupId: null, category: "코엑", date: "2026-10-08", content: "사전등록자 대상 뉴스레터 발송(10/8)" }),
      entry({ date: "2026-10-12", content: "현장 미션 전달", status: "planned", note: "10/22 전까지" }),
    ]);
    const la = r.rows.find((row) => row.groupId === "la")!;
    expect(la.groupName).toBe("코리아 엑스포 LA\n(2026. 10. 22 - 24)");
    const ops = la.pairs.find((p) => (p.last ?? p.next)!.category === "운영")!;
    expect(ops.last!.lines).toEqual(["엠버서더 3차 미션 운영", "사전등록자 대상 뉴스레터 발송(10/8)"]);
    expect(ops.last!.status).toBe("완료");
    expect(ops.next!.lines).toEqual(["현장 미션 전달"]);
    expect(ops.next!.status).toBe("예정");
    expect(ops.next!.extra).toEqual(["10/22 전까지"]);
    const content = la.pairs.find((p) => (p.last ?? p.next)!.category === "콘텐츠")!;
    expect(content.last!.extra).toEqual(["인스타 스토리 2건"]);
  });

  it("며칠 적은 같은 내역은 한 줄, 담당자는 모아서, 일상 업무는 뺀다", () => {
    const r = report([
      entry({ date: "2026-10-05", content: "광고 모니터링" }),
      entry({ date: "2026-10-06", content: "광고  모니터링", authorId: "u2" }),
      entry({ date: "2026-10-06", content: "주간업무보고 작성" }),
    ]);
    const la = r.rows.find((row) => row.groupId === "la")!;
    expect(la.pairs).toHaveLength(1);
    expect(la.pairs[0].last!.lines).toEqual(["광고 모니터링"]);
    expect(la.pairs[0].last!.owners).toEqual(["이창환", "소현지"]);
  });

  it("전주에 끝내지 못한 일은 금주 목표로 이월된다", () => {
    const r = report([entry({ date: "2026-10-07", content: "크리에이터 협약", status: "doing" })]);
    const pair = r.rows.find((row) => row.groupId === "la")!.pairs[0];
    expect(pair.last!.status).toBe("진행");
    expect(pair.next!.lines).toEqual(["크리에이터 협약"]);
  });

  it("행사를 못 찾은 머리표는 기타 줄에 그 이름으로", () => {
    const r = report([entry({ groupId: null, category: "더모스트", date: "2026-10-06", content: "홈페이지 업데이트 f/u" })]);
    const etc = r.rows.at(-1)!;
    expect(etc.groupName).toBe("기타");
    expect(etc.pairs[0].last!.category).toBe("더모스트");
  });

  it("줄이 없는 행사도 이름은 남기고 기타는 늘 끝에(보관한 행사는 뺀다)", () => {
    const r = buildWeeklyReport({
      reportDate: "2026-10-08",
      groups: [...groups, { id: "old", name: "지난 행사", startDate: null, endDate: null, sortOrder: 3, archived: true }],
      entries: [],
      authorName: () => "",
    });
    expect(r.rows.map((row) => row.groupId)).toEqual(["la", "stk", null]);
  });

  it("시트에 붙일 표 — 행사 이름은 묶음 첫 줄에만, 담당 숨기기 · 칸 글은 다시 읽힌다", () => {
    const r = report([
      entry({ date: "2026-10-06", content: "협찬 소통" }),
      entry({ date: "2026-10-06", content: "축전 영상 업로드", result: "결과물" }),
    ]);
    const table = reportTable(r, { hideOwners: true });
    expect(table[1]).toEqual(["행사", "내역", "담당", "달성", "결과 및 산출물", "내역", "담당", "달성", "비고"]);
    const laRows = table.filter((row) => row[1].includes("협찬") || row[1].includes("축전"));
    expect(laRows[0][0]).toContain("코리아 엑스포 LA");
    expect(laRows[1][0]).toBe("");
    expect(laRows[1][4]).toBe("");
    const text = blockText(r.rows[0].pairs[0].last);
    expect(text).toBe("[운영]\n- 협찬 소통");
    expect(parseBlockText(text)).toEqual({ category: "운영", lines: ["협찬 소통"] });
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
    expect(resolveWorkTag("코엑", [{ id: "la", name: "코리아 엑스포 LA", aliases: ["코엑"] }])).toEqual({ groupId: "la", category: "" });
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
