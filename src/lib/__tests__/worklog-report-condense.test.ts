import { describe, expect, it } from "vitest";
import {
  buildWeeklyReport, groupFromContent, isRoutineWork, isStandingWork, mergeSimilarLines, sameWork, shortDates,
  type ReportRow, type WorkEntryInput,
} from "@/lib/worklog";

// 초안 정리 규칙(2026-10-29) — 일지를 통째로 옮기지 않고 실제 보고서처럼.
const entry = (patch: Partial<WorkEntryInput>): WorkEntryInput => ({
  id: Math.random().toString(36).slice(2), groupId: "la", authorId: "u1", date: "2026-10-27",
  category: "", content: "엠버서더 미션 운영", status: "done", result: "", note: "", ...patch,
});
const groups = [
  { id: "la", name: "코리아 엑스포 LA", startDate: "2026-10-22", endDate: "2026-10-24", sortOrder: 1, aliases: ["코엑", "LA"] },
  { id: "deep", name: "대한민국 딥테크 사업화 페스티벌", startDate: "2026-11-12", endDate: "2026-11-13", sortOrder: 2, aliases: ["딥테크"] },
];
const report = (entries: WorkEntryInput[], previous?: ReportRow[]) =>
  buildWeeklyReport({ reportDate: "2026-10-29", groups, entries, authorName: () => "", previous });
const lines = (r: ReturnType<typeof report>, groupId: string | null, side: "last" | "next") =>
  r.rows.find((row) => row.groupId === groupId)!.pairs.flatMap((p) => p[side]?.lines ?? []);

describe("잔손 일은 보고서에 쓰지 않는다", () => {
  it("회의·미팅 일정, 지출결의·품의, 아젠다, 사진·폴더·주소록 정리, 해지", () => {
    for (const c of [
      "사장님 강평회의 15:00", "회의 11:00 & 피드백 정리", "11:30 웨비나 미팅", "15:00 홈페이지 논의 미팅 (1번 회의실)",
      "지출결의(11/30) - 우일/메가마케팅", "정산품의", "주간업무회의 아젠다 작성", "사진 정리", "폴더 정리", "스티비 주소록 정리",
      "자동이메일(resend) 해지", "조직개편의견 전달", "현장",
    ]) expect(isRoutineWork(c), c).toBe(true);
    for (const c of ["보도자료 정리", "댓글 반응 정리", "Clear Channel 미팅", "결과 정리", "땡스 레터 예약발송"]) expect(isRoutineWork(c), c).toBe(false);
  });
});

describe("행사 찾기 · 줄 합치기", () => {
  it("머리표가 없어도 내용에 행사 이름·줄임말이 있으면 그 행사", () => {
    expect(groupFromContent("딥테크 메타 광고 기본 세팅", groups)?.id).toBe("deep");
    expect(groupFromContent("코리아엑스포 LA 개막 업로드", groups)?.id).toBe("la");
    expect(groupFromContent("랜덤 PLAY 댄스", groups)).toBeNull();
  });

  it("발송은 날짜를, 며칠 한 업로드도 날짜를 붙여 한 줄", () => {
    const r = report([
      entry({ date: "2026-10-23", content: "사전등록자 대상 뉴스레터 발송" }),
      entry({ date: "2026-10-26", content: "할로윈 콘텐츠 업로드" }),
      entry({ date: "2026-10-27", content: "할로윈 콘텐츠 업로드" }),
      entry({ date: "2026-10-27", content: "카드뉴스 업로드" }),
    ]);
    expect(lines(r, "la", "last")).toEqual(expect.arrayContaining(["사전등록자 대상 뉴스레터 발송(10/23)", "할로윈 콘텐츠 업로드(10/26,27)", "카드뉴스 업로드"]));
    expect(shortDates(["2026-11-02", "2026-10-30", "2026-10-31"])).toBe("10/30,31, 11/2");
  });

  it("같은 끝말의 게시물 업로드는 한 줄로", () => {
    expect(mergeSimilarLines(["누들,스낵존 게시물 업로드", "엠버서더 운영", "FAQ 게시물 업로드", "부스배치도 게시물 업로드"]))
      .toEqual(["누들,스낵존 / FAQ / 부스배치도 게시물 업로드", "엠버서더 운영"]);
  });

  it("고르다 만 [기타] 분류는 낱말로 다시 고른다", () => {
    const r = report([entry({ category: "기타", content: "코리아엑스포 LA 개막 업로드", groupId: null })]);
    const la = r.rows.find((row) => row.groupId === "la")!;
    expect(la.pairs.map((p) => p.last?.category)).toEqual(["콘텐츠"]);
  });
});

describe("지난 보고서의 금주 목표에서 출발한다", () => {
  const previous: ReportRow[] = [{
    groupId: "la",
    groupName: "코리아 엑스포 LA\n(2026. 10. 22 - 24)",
    pairs: [
      { last: null, next: { category: "운영", lines: ["크리에이터 제휴사(ThePicks) 협약 및 소통", "웰컴키트 배분"], owners: [], status: "진행", extra: [] } },
      { last: null, next: { category: "퍼포먼스", lines: ["참관객 사전등록 캠페인 모니터링(구글, 메타)"], owners: [], status: "진행", extra: [] } },
    ],
  }];

  it("일지에 근거가 있으면 지난 목표 문장으로, 상시 일은 일지에 없어도 잇고, 근거 없는 목표는 뺀다", () => {
    const r = report([entry({ content: "ThePicks 소통" })], previous);
    const last = lines(r, "la", "last");
    expect(last).toContain("크리에이터 제휴사(ThePicks) 협약 및 소통");
    expect(last).not.toContain("ThePicks 소통");
    expect(last).toContain("참관객 사전등록 캠페인 모니터링(구글, 메타)");
    expect(last).not.toContain("웰컴키트 배분");
    expect(lines(r, "la", "next")).toContain("참관객 사전등록 캠페인 모니터링(구글, 메타)");
  });

  it("같은 일 판단 — 한쪽이 품거나 핵심 낱말 둘 이상", () => {
    expect(sameWork("ThePicks 소통", "크리에이터 제휴사(ThePicks) 협약 및 소통")).toBe(true);
    expect(sameWork("광고 모니터링", "참관객 사전등록 캠페인 모니터링(구글, 메타)")).toBe(false);
    expect(isStandingWork("광고 모니터링 (메타, 구글, 링크드인)")).toBe(true);
    expect(isStandingWork("개막 보도자료 확정")).toBe(false);
  });
});
