import { describe, expect, it } from "vitest";
import { kstToday, parseRange, rangeContains, rangeDays, rangeLabel, recentRange } from "../range";
import { buildResearchPrompt } from "../model";
import { prRoomGoogleNewsUrl } from "../collect";

describe("조사 기간", () => {
  it("한국 날짜 기준으로 오늘·최근 N일을 만든다", () => {
    // 11월 10일 23시(UTC) = 11월 11일 08시(KST)
    const now = new Date("2026-11-10T23:00:00Z");
    expect(kstToday(now)).toBe("2026-11-11");
    expect(recentRange(7, now)).toEqual({ from: "2026-11-05", to: "2026-11-11" });
    expect(rangeDays(recentRange(30, now))).toBe(30);
  });

  it("잘못된 값은 버리고, 앞뒤가 바뀌면 바로잡는다", () => {
    expect(parseRange({ from: "2026-11-01", to: "2026-11-10" })).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(parseRange({ from: "2026-11-10", to: "2026-11-01" })).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(parseRange({ from: "11월", to: "2026-11-10" })).toBeNull();
    expect(parseRange(null)).toBeNull();
  });

  it("양끝 날짜를 포함하고, 날짜를 모르는 글은 따로 구분한다", () => {
    const range = { from: "2026-11-01", to: "2026-11-10" };
    expect(rangeContains(range, "2026-10-31T15:00:00Z")).toBe(true); // 11/1 00:00 KST
    expect(rangeContains(range, "2026-10-31T14:59:00Z")).toBe(false);
    expect(rangeContains(range, "2026-11-10T14:59:00Z")).toBe(true); // 11/10 23:59 KST
    expect(rangeContains(range, "2026-11-10T15:00:00Z")).toBe(false);
    expect(rangeContains(range, null)).toBe("unknown");
    expect(rangeLabel(range)).toBe("2026.11.01 ~ 2026.11.10");
  });
});

describe("기간을 담은 조사", () => {
  const range = { from: "2026-11-01", to: "2026-11-10" };

  it("Aside 조사문은 기간·플랫폼 검색법·읽기 전용 규칙을 담는다", () => {
    const prompt = buildResearchPrompt({ eventNames: ["인디뷰티 서울"], agent: "aside", range });
    expect(prompt).toContain("Aside");
    expect(prompt).toContain("2026.11.01 ~ 2026.11.10");
    expect(prompt).toContain("since:2026-11-01 until:2026-11-11");
    expect(prompt).toContain("읽기만 하세요");
    expect(prompt).not.toContain("전체 기간");
  });

  it("Claude 조사문은 브라우저 안내 없이 기간만 담는다", () => {
    const prompt = buildResearchPrompt({ eventNames: ["인디뷰티 서울"], agent: "claude", range });
    expect(prompt).toContain("웹 검색을 사용해");
    expect(prompt).not.toContain("Aside 브라우저 사용 방법");
    expect(prompt).toContain("2026.11.01 ~ 2026.11.10");
  });

  it("무료 검색(Google 뉴스)은 after/before 로 기간을 묻는다", () => {
    const q = new URL(prRoomGoogleNewsUrl('"인디뷰티"', 30, range)).searchParams.get("q");
    expect(q).toBe('"인디뷰티" after:2026-11-01 before:2026-11-11');
    expect(new URL(prRoomGoogleNewsUrl('"인디뷰티"', 30, null)).searchParams.get("q")).toContain("when:30d");
  });
});
