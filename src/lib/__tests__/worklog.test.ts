import { describe, expect, it } from "vitest";
import {
  blockText, buildWeeklyReport, orderCellLines, shiftInCell, sortOrderNeighbors, classifyWork, orderGroupsForReport, defaultReportDate, effectiveStatus, groupDateLabel, isRoutineWork, openStatus,
  parseBlockText, parsePastedWork, reportTable, reportWindows, resolveWorkTag, resolveWorkTagInContext, splitWorkTag, weekOf, type WorkEntryInput,
  isValidDay, mergeAiRows, normalizeReportRows, type ReportBlock, type WeeklyReport,
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

describe("일지 머리표", () => {
  it("행사 안의 분류는 행사를 유지하고, 행사 머리표는 행사만 바꾼다", () => {
    const current = { groupId: "la", category: "운영" };
    expect(resolveWorkTagInContext("퍼포먼스", groups, current)).toEqual({ groupId: "la", category: "퍼포먼스" });
    expect(resolveWorkTagInContext("STK", groups, current)).toEqual({ groupId: "stk", category: "" });
  });
});

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

describe("칸 안의 줄 순서", () => {
  const line = (id: string, groupId: string | null, sortOrder: number, content = id, temp = false) =>
    ({ id, groupId, sortOrder, content, temp, createdAt: "2026-10-20T00:00:" + String(sortOrder).padStart(2, "0") + "Z" });
  const ids = (list: Array<{ id: string }>) => list.map((l) => l.id);

  it("같은 행사는 첫 줄 자리에 모은다", () => {
    expect(ids(orderCellLines([line("a", "la", 1), line("x", "stk", 2), line("b", "la", 3), line("n", null, 4)]))).toEqual(["a", "b", "x", "n"]);
  });

  it("아직 글이 없는 새 줄은 적던 자리에 — 바로 위 줄 다음, 맨 끝이면 맨 끝", () => {
    const list = [line("a", "la", 1), line("x", "stk", 2), line("b", "la", 3)];
    expect(ids(orderCellLines([...list, line("d", "la", 3.5, "", true)]))).toEqual(["a", "b", "d", "x"]);
    expect(ids(orderCellLines([...list, line("e", null, 4, "", true)]))).toEqual(["a", "b", "x", "e"]);
  });

  it("위·아래 — 같은 행사 안에선 한 줄, 묶음 끝에선 묶음째", () => {
    const ordered = [line("a", "la", 1), line("b", "la", 3), line("x", "stk", 2)];
    expect(ids(shiftInCell(ordered, 1, -1))).toEqual(["b", "a", "x"]);
    expect(ids(shiftInCell(ordered, 1, 1))).toEqual(["x", "a", "b"]);
    expect(ids(shiftInCell(ordered, 2, -1))).toEqual(["x", "a", "b"]);
    expect(shiftInCell(ordered, 0, -1)).toBe(ordered);
  });

  it("sortOrder 이웃 — 같은 값은 건너뛴다", () => {
    expect(sortOrderNeighbors([1, 1, 2, 5], 2)).toEqual({ below: 1, above: 5 });
    expect(sortOrderNeighbors([3], 3)).toEqual({ below: null, above: null });
  });
});

describe("날짜 검사", () => {
  /** 2/31 을 받으면 JS 가 3/3 으로 바꿔 저장한다 — 사람이 적은 날짜와 다른 날에 일지가 들어간다. */
  it("달력에 없는 날은 거절", () => {
    expect(isValidDay("2026-10-29")).toBe(true);
    expect(isValidDay("2028-02-29")).toBe(true);
    expect(isValidDay("2026-02-29")).toBe(false);
    expect(isValidDay("2026-02-31")).toBe(false);
    expect(isValidDay("2026-99-99")).toBe(false);
    expect(isValidDay("2026-1-5")).toBe(false);
    expect(isValidDay(null)).toBe(false);
  });
});

describe("보고서 저장 크기", () => {
  it("묶음 안 줄·담당·비고 개수를 자른다", () => {
    const big = Array.from({ length: 500 }, (_, i) => `줄 ${i}`);
    const [row] = normalizeReportRows([{ groupId: "la", groupName: "LA", pairs: [{ last: { category: "운영", lines: big, owners: big, extra: big, status: "진행" }, next: null }] }]);
    expect(row.pairs[0].last!.lines).toHaveLength(60);
    expect(row.pairs[0].last!.owners).toHaveLength(20);
    expect(row.pairs[0].last!.extra).toHaveLength(30);
  });
});

describe("AI 다듬기 결과 합치기", () => {
  const block = (patch: Partial<ReportBlock>): ReportBlock => ({ category: "운영", lines: ["초안 줄"], owners: ["이창환"], status: "진행", extra: [], ...patch });
  const draft: WeeklyReport = {
    reportDate: "2026-10-08",
    lastWeek: { start: "2026-10-02", end: "2026-10-08" },
    thisWeek: { start: "2026-10-09", end: "2026-10-15" },
    rows: [
      { groupId: "a", groupName: "코리아 엑스포 LA", pairs: [{ last: block({ extra: ["결과 링크"] }), next: block({ category: "콘텐츠", extra: ["비고 메모"] }) }] },
      { groupId: "b", groupName: "STK", pairs: [{ last: block({ lines: ["STK 초안"] }), next: null }] },
      { groupId: "c", groupName: "X-Space", pairs: [{ last: block({ lines: ["X 초안"] }), next: null }] },
    ],
  };

  /** 예전에는 이름으로 못 찾으면 같은 순번의 AI 행을 썼다 — B 를 빠뜨리면 C 내용이 B 에 복사됐다. */
  it("AI 가 행사를 빠뜨리면 그 행사는 초안 그대로", () => {
    const out = [
      { groupId: "a", groupName: "코리아 엑스포 LA", pairs: [{ last: { category: "운영", lines: ["다듬은 줄"], status: "완료" }, next: null }] },
      { groupId: "c", groupName: "X-Space", pairs: [{ last: { category: "운영", lines: ["X 다듬음"], status: "진행" }, next: null }] },
    ];
    const rows = mergeAiRows(draft, out);
    expect(rows[1]).toEqual(draft.rows[1]);
    expect(rows[2].pairs[0].last!.lines).toEqual(["X 다듬음"]);
  });

  it("groupId 가 이름보다 먼저 — 이름을 바꿔 써도 맞는 행사로", () => {
    const out = [{ groupId: "b", groupName: "엉뚱한 이름", pairs: [{ last: { category: "운영", lines: ["STK 다듬음"] }, next: null }] }];
    expect(mergeAiRows(draft, out)[1].pairs[0].last!.lines).toEqual(["STK 다듬음"]);
  });

  /** AI 는 결과 및 산출물·비고 칸을 모른다 — 예전엔 AI 를 누르면 전부 비워져 저장됐다. */
  it("결과 및 산출물·비고·담당을 초안에서 옮긴다", () => {
    const out = [{ groupId: "a", groupName: "코리아 엑스포 LA", pairs: [
      { last: { category: "운영", lines: ["다듬은 줄"] }, next: { category: "콘텐츠", lines: ["다음 주"] } },
    ] }];
    const [row] = mergeAiRows(draft, out);
    expect(row.pairs[0].last).toMatchObject({ extra: ["결과 링크"], owners: ["이창환"] });
    expect(row.pairs[0].next).toMatchObject({ extra: ["비고 메모"] });
  });

  it("AI 가 분류 이름을 바꿔도 결과·비고는 한 번만, 첫 블록에", () => {
    const out = [{ groupId: "a", groupName: "코리아 엑스포 LA", pairs: [
      { last: { category: "퍼포먼스", lines: ["하나"] }, next: null },
      { last: { category: "퍼포먼스", lines: ["둘"] }, next: { category: "기획", lines: ["다음"] } },
    ] }];
    const [row] = mergeAiRows(draft, out);
    const lastExtras = row.pairs.flatMap((p) => p.last?.extra ?? []);
    expect(lastExtras).toEqual(["결과 링크"]);
    expect(row.pairs[0].last!.extra).toEqual(["결과 링크"]);
    expect(row.pairs.flatMap((p) => p.next?.extra ?? [])).toEqual(["비고 메모"]);
  });
});
