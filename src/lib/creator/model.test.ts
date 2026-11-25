import { describe, expect, it } from "vitest";
import { creatorAccessEmail, creatorDriveFile, creatorDriveFolder, baseColumns, buildPublication, creatorColumns, defaultUtm, missionSchema, normalizeCell, removePublishedCreator, reviewState, trackingUrl, workQueue } from "./model";
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

  it("removes only the withdrawn creator from tagged and older published rosters", () => {
    const theme = { title: "선발 발표", background: "#ffffff", accent: "#4338ca" };
    const first = { id: "first", name: "유진", award: "", awardOrder: 0, profile: { region: "서울" } };
    const second = { ...first, id: "second", profile: { region: "도쿄" } };
    const published = buildPublication("roster", theme, [first, second]);
    expect(removePublishedCreator(published, { ...first, name: "새 이름" })?.entries).toEqual([published.entries[1]]);
    const legacy = { ...published, entries: published.entries.map(({ participantId, ...entry }) => {
      expect(participantId).toBeTruthy();
      return entry;
    }) };
    expect(removePublishedCreator(legacy, first)?.entries).toEqual([legacy.entries[1]]);
    expect(removePublishedCreator({ ...legacy, entries: [legacy.entries[0], legacy.entries[0]] }, first)).toBeUndefined();
  });

  it("validates tab-separated Excel data and protects CSV cells", () => {
    // 저장된 구성을 그대로 쓰므로 쓰려는 열을 모두 적는다 — 기본 열이 뒤에 저절로 붙지 않는다.
    const followers = baseColumns.find(({ key }) => key === "followers")!;
    const columns = creatorColumns([{ ...baseColumns[0], hidden: true }, followers, { key: "checked", label: "확인", type: "checkbox" }]);
    const rows = pasteCandidates('이름\t팔로워\t확인\r\n"유진, 하진"\t1,024\t예', columns);
    expect(rows).toEqual([{ name: "유진, 하진", followers: 1024, checked: true }]);
    expect(columns.find(({ key }) => key === "name")?.hidden).toBe(true);
    expect(candidateCsv(columns, [{ cells: { name: "=formula()", checked: true }, submitted: true }])).toContain('"' + "'=formula()" + '"');
    const exported = candidateCsv(columns, [{ cells: rows[0], submitted: true }]);
    expect(pasteCandidates(exported, columns)[0]).toMatchObject(rows[0]);
    expect(() => normalizeCell({ key: "url", label: "링크", type: "url" }, "javascript:alert(1)")).toThrow();
    expect(normalizeCell({ key: "url", label: "링크", type: "url" }, "https://example.test")).toBe("https://example.test");
  });

  it("저장한 열 구성을 그대로 쓴다 — 기본 열도 지울 수 있다", () => {
    // 예전에는 저장 목록에 없는 기본 열을 뒤에 다시 붙여서, 지워도 되살아났다.
    const kept = creatorColumns([{ key: "handle", label: "계정", type: "text" }]);
    expect(kept.map(({ key }) => key)).toEqual(["handle"]);

    // 기본 열의 이름과 형식도 마음대로 바꿀 수 있다.
    const renamed = creatorColumns([{ key: "memo", label: "비고", type: "text" }]);
    expect(renamed[0]).toMatchObject({ key: "memo", label: "비고" });

    // 아직 한 번도 저장하지 않았으면 기본 열로 시작한다.
    expect(creatorColumns([])).toEqual(baseColumns);
    expect(creatorColumns(null)).toEqual(baseColumns);
  });

  it("열 너비는 범위 안에서만 저장된다", () => {
    const withWidth = creatorColumns([{ key: "memo", label: "메모", type: "text", width: 240 }]);
    expect(withWidth[0].width).toBe(240);
    // 범위를 벗어난 값은 형식 오류라 저장분 전체가 무시되고 기본 열로 돌아간다 — 깨진 표를 그리지 않는다.
    expect(creatorColumns([{ key: "memo", label: "메모", type: "text", width: 5000 }])).toEqual(baseColumns);
  });

  it("keeps the creator folder and the submitted Drive file distinct", () => {
    expect(creatorAccessEmail.parse("  Creator@GMAIL.COM ")).toBe("creator@gmail.com");
    const folder = "https://drive.google.com/drive/u/0/folders/abc-123";
    const file = "https://drive.google.com/file/d/abc-123/view";
    expect(creatorDriveFolder.safeParse(folder).success).toBe(true);
    expect(creatorDriveFile.safeParse(folder).success).toBe(false);
    expect(creatorDriveFolder.safeParse(file).success).toBe(false);
    expect(creatorDriveFile.safeParse(file).success).toBe(true);
    expect(creatorDriveFile.safeParse("https://drive.google.com.bad.test/file/d/abc-123/view").success).toBe(false);

    const draft = { title: "원본 제출", guide: "", startsAt: null, dueAt: null, published: false, platforms: ["instagram"],
      linkCount: 0, proof: "off", driveProof: "required", draft: true };
    expect(missionSchema.safeParse(draft).success).toBe(true);
    expect(missionSchema.safeParse({ ...draft, driveProof: "optional" }).success).toBe(false);
  });

  it("validates posting windows and supports evidence-only missions", () => {
    const mission = { title: "스토리", guide: "", startsAt: "2026-11-24T00:00:00.000Z", dueAt: "2026-11-25T00:00:00.000Z", platforms: ["instagram"], draft: true, linkCount: 0, proof: "required" };
    expect(missionSchema.safeParse(mission).success).toBe(true);
    expect(missionSchema.safeParse({ ...mission, proof: "off" }).success).toBe(false);
    expect(missionSchema.safeParse({ ...mission, dueAt: mission.startsAt }).success).toBe(false);
  });
});
