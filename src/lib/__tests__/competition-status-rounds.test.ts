import { describe, expect, it } from "vitest";
import { currentRoundKind, isActiveCompetitionPhase, resolveCompetitionStatus, type RoundTiming } from "@/lib/competition-status";

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
  it("본선 종료 시각까지는 본선이고, 이후에는 결과를 정리하는 심사 단계다", () => {
    expect(resolveCompetitionStatus({ ...base, rounds }, new Date("2026-10-24T10:30:00Z")).phase).toBe("final");
    expect(resolveCompetitionStatus({ ...base, rounds }, new Date("2026-10-24T10:30:00.001Z")).phase).toBe("judging");
    expect(resolveCompetitionStatus({ ...base, rounds }, new Date("2026-11-02T00:00:00Z")).phase).toBe("judging");
  });
  it("결과 발행은 자동으로 발표 완료가 되고 진행 중 목록에서 제외된다", () => {
    const status = resolveCompetitionStatus({ ...base, rounds, resultPublishedAt: "2026-10-25T00:00:00Z" }, new Date("2026-11-02T00:00:00Z"));
    expect(status.phase).toBe("announced");
    expect(status.canApply).toBe(false);
    expect(isActiveCompetitionPhase(status.phase)).toBe(false);
  });
  it("명시적인 종료는 발행 여부·라운드 일정보다 우선하고 접수를 막는다", () => {
    const status = resolveCompetitionStatus({ ...base, rounds, phaseOverride: "closed" }, new Date("2026-10-18T00:00:00Z"));
    expect(status).toEqual({ phase: "closed", isOverridden: true, canApply: false });
    expect(isActiveCompetitionPhase(status.phase)).toBe(false);
  });
  it("운영자가 고정한 본선은 임의로 종료하지 않으며 진행 중 대회는 유지한다", () => {
    expect(resolveCompetitionStatus({ ...base, rounds, phaseOverride: "final" }, new Date("2026-11-02T00:00:00Z")).phase).toBe("final");
    for (const phase of ["upcoming", "recruiting", "prelim", "judging", "final"] as const) expect(isActiveCompetitionPhase(phase)).toBe(true);
  });
  it("잘못된 날짜나 미래의 발행 시각으로 발표 완료를 만들지 않는다", () => {
    for (const resultPublishedAt of ["invalid", "2027-01-01T00:00:00Z"]) expect(resolveCompetitionStatus({ ...base, rounds, resultPublishedAt }, new Date("2026-10-18T00:00:00Z")).phase).toBe("final");
  });
});
