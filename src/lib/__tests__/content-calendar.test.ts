import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER, assigneeOptions, channelOptions, compareItems, groupByDay, isValidMonth, isValidTime, matchesFilter, monthGrid, monthRange,
  normalizeTags, parseAssignees, shiftMonth, type ContentItemDto,
} from "@/lib/content-calendar";

const item = (over: Partial<ContentItemDto>): ContentItemDto => ({
  id: "x", projectId: null, title: "제목", date: null, time: "", status: "waiting", channels: [], formats: [], campaign: "",
  assignees: [], body: "", link: "", sourceUrl: "", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});
const all = { project: "all", ...EMPTY_FILTER };

describe("monthGrid", () => {
  it("일요일부터 토요일까지, 앞뒤 달 날짜로 채운다", () => {
    const weeks = monthGrid("2026-11"); // 11/1 은 일요일
    expect(weeks[0][0]).toBe("2026-11-01");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.at(-1)!.at(-1)).toBe("2026-12-05");
    expect(weeks).toHaveLength(5);
  });
  it("달 첫날이 토요일이면 앞달 날짜로 시작하고 6줄까지 늘어난다", () => {
    const weeks = monthGrid("2026-08"); // 8/1 토요일, 8/31 월요일
    expect(weeks[0][0]).toBe("2026-07-26");
    expect(weeks[0][6]).toBe("2026-08-01");
    expect(weeks).toHaveLength(6);
  });
});

describe("달 계산", () => {
  it("해를 넘겨 앞뒤로 간다", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("달의 첫날·마지막 날(윤년 포함)", () => {
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthRange("2026-11")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });
  it("주소의 month 값 검사", () => {
    expect(isValidMonth("2026-11")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-1")).toBe(false);
  });
});

describe("값 정리", () => {
  it("시간은 HH:MM 또는 빈 값만", () => {
    expect(isValidTime("")).toBe(true);
    expect(isValidTime("09:30")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("9:30")).toBe(false);
  });
  it("채널·형식은 공백·중복을 걷어낸다", () => {
    expect(normalizeTags([" 인스타그램 ", "인스타그램", "", 3, "블로그"])).toEqual(["인스타그램", "블로그"]);
    expect(normalizeTags("인스타그램")).toEqual([]);
  });
  it("담당자 JSON — 계정 없는 사람은 이름만, 이상한 값·중복은 버린다", () => {
    expect(parseAssignees([{ id: "u1", name: "이창환" }, { id: null, name: "엄재호" }, { id: "u1", name: "x" }, 3, { name: "" }, null]))
      .toEqual([{ id: "u1", name: "이창환" }, { id: null, name: "엄재호" }]);
    expect(parseAssignees("x")).toEqual([]);
  });
});

describe("필터", () => {
  it("프로젝트 범위 — none 은 프로젝트 없는 항목", () => {
    expect(matchesFilter(item({ projectId: "p1" }), { ...all, project: "p1" })).toBe(true);
    expect(matchesFilter(item({ projectId: "p2" }), { ...all, project: "p1" })).toBe(false);
    expect(matchesFilter(item({ projectId: null }), { ...all, project: "none" })).toBe(true);
    expect(matchesFilter(item({ projectId: "p1" }), all)).toBe(true);
  });
  it("채널은 하나라도 겹치면 통과, 담당 none 은 담당 없음", () => {
    expect(matchesFilter(item({ channels: ["블로그", "인스타그램"] }), { ...all, channels: ["인스타그램"] })).toBe(true);
    expect(matchesFilter(item({ channels: ["블로그"] }), { ...all, channels: ["인스타그램"] })).toBe(false);
    expect(matchesFilter(item({ assignees: [] }), { ...all, assignees: ["none"] })).toBe(true);
    expect(matchesFilter(item({ assignees: [{ id: "u1", name: "a" }] }), { ...all, assignees: ["none"] })).toBe(false);
    expect(matchesFilter(item({ assignees: [{ id: "u1", name: "a" }, { id: "u2", name: "b" }] }), { ...all, assignees: ["u2"] })).toBe(true);
    expect(matchesFilter(item({ assignees: [{ id: null, name: "엄재호" }] }), { ...all, assignees: ["~엄재호"] })).toBe(true);
  });
  it("형식은 하나라도 겹치면, 캠페인 none 은 캠페인 없음", () => {
    expect(matchesFilter(item({ formats: ["카드뉴스", "스토리"] }), { ...all, formats: ["스토리"] })).toBe(true);
    expect(matchesFilter(item({ campaign: "" }), { ...all, campaigns: ["none"] })).toBe(true);
    expect(matchesFilter(item({ campaign: "바이럴" }), { ...all, campaigns: ["티켓 판매"] })).toBe(false);
  });
  it("검색은 제목·내용을 대소문자 없이 본다", () => {
    expect(matchesFilter(item({ title: "STK 티저" }), { ...all, query: "stk" })).toBe(true);
    expect(matchesFilter(item({ body: "해시태그 #코엑스" }), { ...all, query: "코엑스" })).toBe(true);
    expect(matchesFilter(item({ title: "a" }), { ...all, query: "b" })).toBe(false);
  });
});

describe("정렬·묶기", () => {
  it("날짜 → 시간(빈 시간은 뒤) → 만든 순, 날짜 미정은 맨 뒤", () => {
    const list = [
      item({ id: "undated" }),
      item({ id: "d2", date: "2026-11-02" }),
      item({ id: "d1-notime", date: "2026-11-01" }),
      item({ id: "d1-10", date: "2026-11-01", time: "10:00" }),
      item({ id: "d1-09", date: "2026-11-01", time: "09:00" }),
    ];
    expect([...list].sort(compareItems).map((i) => i.id)).toEqual(["d1-09", "d1-10", "d1-notime", "d2", "undated"]);
  });
  it("날짜별로 묶고 날짜 미정은 뺀다", () => {
    const map = groupByDay([item({ id: "a", date: "2026-11-01" }), item({ id: "b" }), item({ id: "c", date: "2026-11-01", time: "08:00" })]);
    expect([...map.keys()]).toEqual(["2026-11-01"]);
    expect(map.get("2026-11-01")!.map((i) => i.id)).toEqual(["c", "a"]);
  });
  it("채널 후보 — 쓰인 기본 채널 먼저, 직접 적은 채널은 뒤", () => {
    expect(channelOptions([item({ channels: ["팝업", "블로그", "인스타그램"] })])).toEqual(["인스타그램", "블로그", "팝업"]);
  });
  it("담당 후보 — 팀원 + 계정 없는 사람", () => {
    expect(assigneeOptions([item({ assignees: [{ id: null, name: "엄재호" }, { id: "u1", name: "이창환" }] })], [{ id: "u1", name: "이창환" }]))
      .toEqual([{ value: "u1", label: "이창환" }, { value: "~엄재호", label: "엄재호 (계정 없음)" }]);
  });
});
