import { describe, expect, it } from "vitest";
import { mergeChangeLines, summarizeWebinarChanges } from "@/lib/webinar-change-summary";
import { activityCategory, activityDetails, activityLabel, activityTarget } from "@/lib/activity-labels";
import { summarizePrBody } from "@/lib/dev-log";

const field = (key: string, label: string, extra: Record<string, unknown> = {}) => ({
  id: key, key, label, type: "text", placeholder: "", required: false, enabled: true, options: [], ...extra,
});

describe("웨비나 변경 요약", () => {
  const base = {
    name: "인디뷰티 웨비나",
    description: "설명",
    liveStartAt: "2026-11-24T05:00:00.000Z",
    liveEndAt: "2026-11-24T07:30:00.000Z",
    signupDeadline: null,
    statusOverride: null,
    theme: { accentColor: "#6d28d9", borderRadius: "16px" },
    config: { registrationForm: { fields: [field("industry", "업종")] } },
    components: { chatEnabled: true },
  };

  it("자동 저장이 같은 값을 다시 보내면 아무것도 남기지 않는다", () => {
    expect(summarizeWebinarChanges(base, JSON.parse(JSON.stringify(base)))).toEqual([]);
  });

  it("바뀐 것만 사람이 읽는 문장으로 남긴다", () => {
    const after = {
      ...base,
      statusOverride: "live",
      theme: { accentColor: "#e11d48", borderRadius: "8px" },
      config: {
        registrationForm: {
          fields: [
            field("industry", "강연에서 다루었으면 하는 질문", { required: true }),
            field("custom_ab12cd34", "관심 세션", { type: "multiple", options: ["A", "B"] }),
          ],
        },
      },
      components: { chatEnabled: false },
    };
    const lines = summarizeWebinarChanges(base, after);
    expect(lines).toContain("방송 상태: 자동 → 라이브");
    expect(lines).toContain("키 컬러: #6d28d9 → #e11d48");
    expect(lines).toContain("테두리 둥글기: 기본 → 약간");
    expect(lines).toContain("등록 폼 · ‘관심 세션’ 항목 추가");
    expect(lines.some((l) => l.startsWith("등록 폼 · 항목 이름 ‘업종’ → "))).toBe(true);
    expect(lines.some((l) => l.includes("필수로 변경"))).toBe(true);
    expect(lines).toContain("채팅 끄기");
  });

  it("연달아 바꾼 값은 처음과 마지막만 남긴다", () => {
    expect(mergeChangeLines(["키 컬러: #a → #b", "등록 폼 · 동의 문구 수정"], ["키 컬러: #b → #c", "등록 폼 · 동의 문구 수정"]))
      .toEqual(["등록 폼 · 동의 문구 수정", "키 컬러: #a → #c"]);
    expect(mergeChangeLines(["키 컬러: #a → #b"], ["키 컬러: #b → #a"])).toEqual([]);
  });
});

describe("활동 로그 문장", () => {
  it("코드 대신 한국어 제목과 대상 이름을 보여준다", () => {
    expect(activityLabel("webinar.updated")).toBe("웨비나 설정 변경");
    expect(activityLabel("webinar.unknown_thing")).toBe("기타 변경");
    const names = { webinars: new Map([["w1", "인디뷰티 글로벌 진출 솔루션 데스크"]]) };
    expect(activityTarget({ webinarId: "w1" }, names)).toBe("인디뷰티 글로벌 진출 솔루션 데스크");
    expect(activityTarget({ webinarId: "gone", webinarName: "지운 웨비나" })).toBe("지운 웨비나");
  });

  it("새 기록은 details 를, 예전 기록은 바뀐 키를 풀어서 보여준다", () => {
    expect(activityDetails("webinar.updated", { details: ["키 컬러: #a → #b"] })).toEqual(["키 컬러: #a → #b"]);
    expect(activityDetails("webinar.updated", { changes: ["config", "theme"] })).toEqual(["바뀐 곳: 페이지·폼 설정, 브랜드(색·폰트·둥글기)"]);
    expect(activityDetails("records.imported", { imported: 120, skipped: 3 })).toEqual(["120건 추가 · 3건 건너뜀"]);
  });

  it("거르기 묶음", () => {
    expect(activityCategory("webinar.poll_created")).toBe("webinar");
    expect(activityCategory("records.imported")).toBe("collect");
    expect(activityCategory("utmPreset.created")).toBe("marketing");
  });
});

describe("개발 로그 요약", () => {
  it("PR 본문에서 바뀐 내용만 뽑고 검증·서명은 뺀다", () => {
    const body = [
      "인디뷰티 웨비나 등록 중 발견한 오류 수정.",
      "",
      "## 등록자 관리",
      "- 열 이름이 **폼 이름 그대로** 보인다.",
      "- [x] 2000자까지 받는다",
      "",
      "## 검증",
      "- tsc 0",
      "",
      "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    ].join("\n");
    expect(summarizePrBody(body)).toEqual([
      "인디뷰티 웨비나 등록 중 발견한 오류 수정.",
      "열 이름이 폼 이름 그대로 보인다.",
      "2000자까지 받는다",
    ]);
  });
});
