import { describe, expect, it } from "vitest";
import { analyzeMention, isCollectionDue } from "../model";

describe("홍보실 조사", () => {
  it("설정한 주기가 지난 경우에만 조사한다", () => {
    const now = new Date("2026-10-29T00:00:00Z");
    expect(isCollectionDue({ collectEveryDays: 3, lastCollectedAt: "2026-10-26T00:00:00Z" }, now)).toBe(true);
    expect(isCollectionDue({ collectEveryDays: 3, lastCollectedAt: "2026-10-27T00:00:00Z" }, now)).toBe(false);
  });
  it("부정 이슈를 보수적으로 올린다", () => expect(analyzeMention("운영 부실 논란")).toMatchObject({ sentiment: "negative", status: "issue" }));
});
