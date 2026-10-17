import { describe, expect, it } from "vitest";
import { currentRoundKind, resolveCompetitionStatus, type RoundTiming } from "@/lib/competition-status";

// LA K-POP 대회 실데이터 모양 — 본선 투표 기간인데 예선으로만 잡히던 문제(2026-10-18).
const rounds: RoundTiming[] = [
  { kind: "prelim", voteEnabled: false, voteOpenAt: "2026-09-20T22:00:00Z", voteCloseAt: "2026-10-01T22:00:00Z" },
  { kind: "final", voteEnabled: true, voteOpenAt: "2026-10-15T09:30:00Z", voteCloseAt: "2026-10-24T10:30:00Z" },
];
const base = { recruitOpenAt: "2026-08-01T00:00:00Z", recruitCloseAt: "2026-10-14T22:00:00Z", phaseOverride: null };

describe("currentRoundKind", () => {
  it("본선 투표 기간엔 본선", () => {
    expect(currentRoundKind(rounds, new Date("2026-10-18T00:00:00Z"))).toBe("final");
  });
  it("예선 투표 중엔 예선", () => {
    const open = [{ ...rounds[0], voteEnabled: true }, rounds[1]];
    expect(currentRoundKind(open, new Date("2026-09-25T00:00:00Z"))).toBe("prelim");
  });
  it("라운드가 없으면 예선", () => {
    expect(currentRoundKind([], new Date())).toBe("prelim");
  });
});

describe("resolveCompetitionStatus with rounds", () => {
  it("접수 마감 뒤 본선 투표가 열렸으면 final", () => {
    expect(resolveCompetitionStatus({ ...base, rounds }, new Date("2026-10-18T00:00:00Z")).phase).toBe("final");
  });
  it("라운드 정보가 없으면 예전처럼 예선", () => {
    expect(resolveCompetitionStatus(base, new Date("2026-10-18T00:00:00Z")).phase).toBe("prelim");
  });
});
