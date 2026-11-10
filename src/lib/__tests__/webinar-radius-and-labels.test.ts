import { describe, expect, it } from "vitest";
import { webinarRadiusScale } from "@/lib/webinar-radius";
import { registrantFieldLabels, registrantFieldMaxLength } from "@/lib/webinar-config";
import { buildStkCss } from "@/app/webinar/[slug]/LiveContentStk";
import { buildRegistrantCsvColumns } from "@/lib/webinar-registrant-csv";

describe("테두리 둥글기 배율", () => {
  it("기본값 16px·미저장은 1이고, 선택값에 비례한다", () => {
    expect(webinarRadiusScale("16px")).toBe(1);
    expect(webinarRadiusScale(undefined)).toBe(1);
    expect(webinarRadiusScale("0px")).toBe(0);
    expect(webinarRadiusScale("8px")).toBe(0.5);
    expect(webinarRadiusScale("24px")).toBe(1.5);
    expect(webinarRadiusScale("1rem")).toBe(1);
  });

  it("STK 토큰이 테마를 따르고, 기본값이면 지금 디자인과 같다", () => {
    expect(buildStkCss("#000", "#fff", "#111")).toContain("--radius-sm:12px; --radius:20px; --radius-lg:28px;");
    expect(buildStkCss("#000", "#fff", "#111", "16px")).toContain("--radius-sm:12px; --radius:20px; --radius-lg:28px;");
    expect(buildStkCss("#000", "#fff", "#111", "8px")).toContain("--radius-sm:6px; --radius:10px; --radius-lg:14px;");
    expect(buildStkCss("#000", "#fff", "#111", "0px")).toContain("--radius-sm:0px; --radius:0px; --radius-lg:0px;");
  });
});

describe("등록 폼에서 바꾼 항목 이름", () => {
  const config = {
    registrationForm: {
      fields: [
        { key: "industry", label: "사전 질문", type: "text" },
        { key: "company", label: "회사명", type: "text" },
      ],
    },
  };

  it("바꾼 항목만 돌려준다", () => {
    expect(registrantFieldLabels(config)).toEqual({ industry: "사전 질문" });
    expect(registrantFieldLabels({})).toEqual({});
  });

  it("이름을 바꿔 질문으로 쓰는 칸은 긴 답을 받는다", () => {
    const labels = registrantFieldLabels(config);
    expect(registrantFieldMaxLength(labels, "industry")).toBe(2000);
    expect(registrantFieldMaxLength(labels, "company")).toBe(200);
  });

  it("CSV 열 이름도 폼을 따르고, 값은 그대로 industry 에서 나온다", () => {
    const columns = buildRegistrantCsvColumns({
      registrants: [],
      customFields: [],
      fieldLabels: { industry: "사전 질문" },
      surveys: [],
      answersByRegistrant: new Map(),
      qaByRegistrant: new Map(),
      engagementByRegistrant: new Map(),
    });
    const col = columns.find((c) => c.header === "사전 질문");
    expect(col).toBeTruthy();
    expect(columns.some((c) => c.header === "업종")).toBe(false);
    expect(columns.filter((c) => c.header === "메모")).toHaveLength(1);
    expect(col!.value({ industry: "답변" } as never)).toBe("답변");
  });
});
