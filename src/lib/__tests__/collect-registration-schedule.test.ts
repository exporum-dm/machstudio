import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM_CONFIG,
  entryChannelAt,
  mergeFormConfigUpdate,
  normalizeCollectForm,
  resolveRegistrationPhase,
  resolveRegistrationStatus,
  type RegistrationSchedule,
} from "@/lib/collect-form-config";

// LA 2026 실제 운영: 사전등록 10/21 14:00 PT 마감, 현장등록 10/22~24 08:00~17:00 PT (PDT = UTC-7)
const LA: RegistrationSchedule = {
  enabled: true,
  timezone: "America/Los_Angeles",
  preOpensAt: "2026-09-01T09:00",
  preClosesAt: "2026-10-21T14:00",
  onsite: [
    { date: "2026-10-22", open: "08:00", close: "17:00" },
    { date: "2026-10-23", open: "08:00", close: "17:00" },
    { date: "2026-10-24", open: "08:00", close: "17:00" },
  ],
  betweenTitle: {},
  betweenBody: {},
};
const at = (iso: string) => new Date(iso);

describe("resolveRegistrationPhase", () => {
  it("is before pre-registration opens", () => {
    expect(resolveRegistrationPhase(LA, at("2026-09-01T15:59:00Z"))).toEqual({ status: "before", phase: null, nextOpenAt: "2026-09-01T16:00:00.000Z" });
  });
  it("takes pre-registrations until the local deadline", () => {
    expect(resolveRegistrationPhase(LA, at("2026-10-21T20:59:00Z"))).toMatchObject({ status: "open", phase: "pre" });
    // 14:00 PT = 21:00Z — 그 순간부터 닫힘, 다음은 10/22 08:00 PT = 15:00Z
    expect(resolveRegistrationPhase(LA, at("2026-10-21T21:00:00Z"))).toEqual({ status: "closed", phase: null, nextOpenAt: "2026-10-22T15:00:00.000Z" });
  });
  it("opens on-site windows only during the day's hours", () => {
    expect(resolveRegistrationPhase(LA, at("2026-10-22T15:00:00Z"))).toMatchObject({ status: "open", phase: "onsite" });
    expect(resolveRegistrationPhase(LA, at("2026-10-22T23:59:00Z"))).toMatchObject({ status: "open", phase: "onsite" });
    // 17:00 PT = 00:00Z 다음 날 — 닫히고 다음 날 08:00 을 알려 준다
    expect(resolveRegistrationPhase(LA, at("2026-10-23T00:00:00Z"))).toEqual({ status: "closed", phase: null, nextOpenAt: "2026-10-23T15:00:00.000Z" });
  });
  it("is closed for good after the last window", () => {
    expect(resolveRegistrationPhase(LA, at("2026-10-25T00:30:00Z"))).toEqual({ status: "closed", phase: null, nextOpenAt: null });
  });
  it("keeps pre-registration open until the first on-site window when there is no deadline", () => {
    const noDeadline = { ...LA, preClosesAt: null };
    expect(resolveRegistrationPhase(noDeadline, at("2026-10-22T14:59:00Z"))).toMatchObject({ status: "open", phase: "pre" });
    expect(resolveRegistrationPhase(noDeadline, at("2026-10-22T15:00:00Z"))).toMatchObject({ status: "open", phase: "onsite" });
  });
});

describe("resolveRegistrationStatus with a schedule", () => {
  const base = normalizeCollectForm({ eventInfo: { registrationWindow: { opensAt: null, closesAt: "2026-01-01T00:00:00Z" } } });
  it("uses the schedule instead of the old window when enabled", () => {
    expect(resolveRegistrationStatus(base, at("2026-10-22T16:00:00Z"))).toBe("closed");
    expect(resolveRegistrationStatus({ ...base, schedule: LA }, at("2026-10-22T16:00:00Z"))).toBe("open");
  });
  it("still lets the manual override win", () => {
    expect(resolveRegistrationStatus({ ...base, schedule: LA, statusOverride: "closed" }, at("2026-10-22T16:00:00Z"))).toBe("closed");
  });
  it("ignores a disabled schedule", () => {
    expect(resolveRegistrationStatus({ ...base, schedule: { ...LA, enabled: false } }, at("2026-10-22T16:00:00Z"))).toBe("closed");
  });
});

describe("entryChannelAt", () => {
  const config = normalizeCollectForm({ schedule: LA });
  it("marks registrations inside an on-site window as onsite", () => {
    expect(entryChannelAt(config, at("2026-10-22T16:00:00Z"))).toBe("onsite");
    expect(entryChannelAt(config, at("2026-10-20T16:00:00Z"))).toBe("online");
    expect(entryChannelAt({ schedule: { ...LA, enabled: false } }, at("2026-10-22T16:00:00Z"))).toBe("online");
  });
});

describe("normalizeCollectForm schedule", () => {
  it("defaults to off and drops malformed values", () => {
    expect(normalizeCollectForm({}).schedule).toEqual({ enabled: false, timezone: "Asia/Seoul", preOpensAt: null, preClosesAt: null, onsite: [], betweenTitle: {}, betweenBody: {} });
    const n = normalizeCollectForm({
      schedule: { enabled: true, timezone: "Mars/Base", preClosesAt: "2026-10-21 14:00", onsite: [{ date: "2026-10-22", open: "8:00", close: "17:00" }, { date: "bad", open: "08:00", close: "17:00" }, { date: "2026-10-23", open: "08:00", close: "17:00" }] },
    }).schedule;
    expect(n.timezone).toBe("Asia/Seoul");
    expect(n.preClosesAt).toBeNull();
    expect(n.onsite).toEqual([{ date: "2026-10-23", open: "08:00", close: "17:00" }]);
  });
});

describe("mergeFormConfigUpdate — 등록 시간은 기본 정보 탭만 바꾼다", () => {
  const la = { enabled: true, timezone: "America/Los_Angeles", preOpensAt: null, preClosesAt: "2026-10-21T14:00", onsite: [{ date: "2026-10-22", open: "08:00", close: "17:00" }], betweenTitle: {}, betweenBody: {} };
  const stored = { ...EMPTY_FORM_CONFIG, statusOverride: "closed", schedule: la };

  it("폼 빌더가 낡은 일정을 들고 통째로 저장해도 DB 일정을 지킨다", () => {
    const fromBuilder = { ...EMPTY_FORM_CONFIG, statusOverride: "open", schedule: { ...la, enabled: false, onsite: [] } };
    const next = mergeFormConfigUpdate(stored, fromBuilder, undefined)!;
    expect(next.statusOverride).toBe("open");
    expect(next.schedule).toEqual(normalizeCollectForm(stored).schedule);
  });

  it("일정만 오면 나머지 폼 정의는 DB 그대로 두고 일정만 바꾼다", () => {
    const next = mergeFormConfigUpdate(stored, undefined, { ...la, preClosesAt: "2026-10-21T15:00" })!;
    expect(next.statusOverride).toBe("closed");
    expect(next.schedule.preClosesAt).toBe("2026-10-21T15:00");
    expect(next.schedule.onsite).toHaveLength(1);
  });

  it("둘 다 없으면 폼 정의를 건드리지 않는다", () => {
    expect(mergeFormConfigUpdate(stored, undefined, undefined)).toBeUndefined();
  });
});
