import { describe, expect, it } from "vitest";
import { buildEntryExportTable, type ExportEntry } from "@/lib/competition-entry-export";
import type { CompetitionFormField } from "@/lib/competition-config";

const field = (patch: Partial<CompetitionFormField>): CompetitionFormField =>
  ({ id: patch.key, key: "k", label: "L", type: "text", placeholder: "", required: false, enabled: true, options: [], system: false, ...patch }) as CompetitionFormField;

const entry = (patch: Partial<ExportEntry>): ExportEntry => ({
  id: "e1", entryNo: "1", title: "Team A", teamName: "A", summary: null,
  data: {}, media: [], contactName: null, contactEmail: null, contactPhone: null,
  status: "approved", isPublished: true, advanced: false,
  agreePrivacy: true, agreeMarketing: false, agreeThirdParty: false,
  submittedAt: "2026-09-29T04:23:09Z", ...patch,
});

describe("대회 참가작 내보내기 표", () => {
  const fields = [
    field({ key: "leader", label: "Leader_name" }),
    field({ key: "photo", label: "Photo", type: "image" }),
    field({ key: "hidden", label: "Off", enabled: false }),
    field({ key: "members", label: "Members", type: "repeater", subFields: [{ key: "n", label: "Name", type: "text", required: true }, { key: "e", label: "Email", type: "email", required: false }] }),
  ];
  const rounds = [{ id: "r1", name: "예선" }];

  it("폼 항목은 켜 둔 답변 항목만, 반복 항목은 인원·명단 두 칸으로", () => {
    const [header] = buildEntryExportTable({ fields, entries: [], rounds, votes: new Map() });
    expect(header).toContain("Leader_name");
    expect(header).not.toContain("Photo");
    expect(header).not.toContain("Off");
    expect(header).toEqual(expect.arrayContaining(["Members 인원", "Members 명단", "투표 수 (예선)"]));
  });

  it("값을 사람이 읽는 모양으로 채우고, 모든 줄의 칸 수가 같다", () => {
    const table = buildEntryExportTable({
      fields,
      entries: [entry({
        data: { leader: "Jessica", members: [{ n: "Kim", e: "kim@x.com" }, { n: "Lee" }] },
        media: [{ kind: "image", url: "https://x/logo.png", role: "logo" }, { kind: "youtube", videoId: "abc123" }],
      })],
      rounds,
      votes: new Map([["r1:e1", 12]]),
    });
    const [header, row] = table;
    const col = (name: string) => row[header.indexOf(name)];
    expect(row).toHaveLength(header.length);
    expect(col("상태")).toBe("승인");
    expect(col("Leader_name")).toBe("Jessica");
    expect(col("Members 인원")).toBe("2");
    expect(col("Members 명단")).toBe("Kim / kim@x.com\nLee");
    expect(col("사진")).toBe("https://x/logo.png (로고)");
    expect(col("유튜브")).toBe("https://youtu.be/abc123");
    expect(col("투표 수 (예선)")).toBe("12");
  });

  it("참가번호를 숫자 순서로 정렬한다", () => {
    const table = buildEntryExportTable({
      fields: [], rounds: [], votes: new Map(),
      entries: [entry({ id: "a", entryNo: "10" }), entry({ id: "b", entryNo: "2" })],
    });
    expect(table.slice(1).map((r) => r[0])).toEqual(["2", "10"]);
  });
});
