import { describe, expect, it } from "vitest";
import { baseColumns, buildPublication, creatorColumns, defaultUtm, missionSchema, normalizeCell, reviewState, trackingUrl, workQueue } from "./model";
import { candidateCsv, pasteCandidates } from "./sheet";

describe("creator operations", () => {
  it("keeps a stable channel ID when UTM rules change", () => {
    const context = { code: "cr_test", platform: "instagram", handle: "@hajin", creator: "하진", program: "도쿄 교육" };
    const destination = "https://example.test/apply?lang=ko&utm_content=old#form";
    const first = trackingUrl(destination, defaultUtm, context);
    const second = trackingUrl(destination, { ...defaultUtm, term: { mode: "creator", value: "" } }, context);
    expect(first.searchParams.get("utm_id")).toBe(second.searchParams.get("utm_id"));
    expect(first.searchParams.get("utm_medium")).toBe("instagram");
    expect(second.searchParams.get("utm_term")).toBe("하진");
    expect(second.searchParams.get("utm_content")).toBeNull();
    expect(second.searchParams.get("lang")).toBe("ko");
    expect(second.hash).toBe("#form");
  });

  it("keeps work awaiting review outside the reminder queues and requires final review", () => {
    const now = Date.parse("2026-11-24T00:00:00Z");
    const mission = { dueAt: "2026-11-23T23:00:00Z" };
    expect(workQueue({ status: "todo", mission }, now)).toBe("overdue");
    expect(workQueue({ status: "review", mission }, now)).toBe("review");
    expect(workQueue({ status: "done", mission }, now)).toBeNull();
    expect(reviewState({ stage: "draft", status: "review" }, true)).toEqual({ stage: "final", status: "todo" });
    expect(reviewState({ stage: "final", status: "review" }, false)).toEqual({ stage: "final", status: "revision" });
    expect(reviewState({ stage: "final", status: "review" }, true)).toEqual({ stage: "final", status: "done" });
    expect(reviewState({ stage: "final", status: "done" }, false)).toBeNull();
  });

  it("uses an allowlist for public profiles and publishes awards separately", () => {
    const theme = { title: "앰배서더", background: "#ffffff", accent: "#4338ca" };
    const participants = [
      { name: "하진", award: "", awardOrder: 0, profile: { region: "서울", email: "private@example.test", token: "private" } },
      { name: "유진", award: "최우수상", awardOrder: 1, profile: {} },
    ];
    const roster = buildPublication("roster", theme, participants);
    expect(roster.entries).toHaveLength(2);
    expect(roster.entries.find(({ name }) => name === "하진")).toEqual({ name: "하진", region: "서울" });
    expect(roster.entries.every(({ award }) => !award)).toBe(true);
    expect(buildPublication("awards", theme, participants).entries).toEqual([{ name: "유진", award: "최우수상" }]);
  });

  it("validates tab-separated Excel data and protects CSV cells", () => {
    const columns = creatorColumns([{ key: "checked", label: "확인", type: "checkbox" }, { ...baseColumns[0], hidden: true }]);
    const rows = pasteCandidates('이름\t팔로워\t확인\r\n"유진, 하진"\t1,024\t예', columns);
    expect(rows).toEqual([{ name: "유진, 하진", followers: 1024, checked: true }]);
    expect(columns.find(({ key }) => key === "name")?.hidden).toBe(true);
    expect(candidateCsv(columns, [{ cells: { name: "=formula()", checked: true }, submitted: true }])).toContain('"' + "'=formula()" + '"');
    const exported = candidateCsv(columns, [{ cells: rows[0], submitted: true }]);
    expect(pasteCandidates(exported, columns)[0]).toMatchObject(rows[0]);
    expect(() => normalizeCell({ key: "url", label: "링크", type: "url" }, "javascript:alert(1)")).toThrow();
    expect(normalizeCell({ key: "url", label: "링크", type: "url" }, "https://example.test")).toBe("https://example.test");
  });

  it("validates posting windows and supports evidence-only missions", () => {
    const mission = { title: "스토리", guide: "", startsAt: "2026-11-24T00:00:00.000Z", dueAt: "2026-11-25T00:00:00.000Z", platforms: ["instagram"], draft: true, linkCount: 0, proof: "required" };
    expect(missionSchema.safeParse(mission).success).toBe(true);
    expect(missionSchema.safeParse({ ...mission, proof: "off" }).success).toBe(false);
    expect(missionSchema.safeParse({ ...mission, dueAt: mission.startsAt }).success).toBe(false);
  });
});
