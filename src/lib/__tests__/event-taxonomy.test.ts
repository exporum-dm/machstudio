import { describe, expect, it } from "vitest";
import { normalizeTaxonomyInput } from "@/lib/event-taxonomy";

describe("normalizeTaxonomyInput", () => {
  it("워크스페이스 공통 이벤트 사전(projectId 없음)은 이름을 GA4 snake_case 로 강제한다", () => {
    // toEventName 이 공백·대문자는 고쳐주지만, 숫자로 시작하는 건 고쳐도 GA4 규칙(문자로 시작)을 못 맞춰 거부된다
    const bad = normalizeTaxonomyInput({ name: "123_click" });
    expect(bad).toEqual({ error: expect.stringContaining("영문 소문자") });

    const ok = normalizeTaxonomyInput({ name: "Booth-Click" });
    expect("data" in ok && ok.data.name).toBe("booth_click");
    expect("data" in ok && ok.data.projectId).toBeNull();
  });

  it("프로젝트별 설치 체크리스트(projectId 있음)는 이름을 자유 텍스트로 받는다", () => {
    const result = normalizeTaxonomyInput({
      projectId: "proj1",
      groupId: "group1",
      name: "GTM & GA4 연결",
      step: 1,
      trigger: "맞춤 HTML",
      triggerCondition: "CE-generate_lead",
      content: "<script>fbq('track','Lead')</script>",
      className: "cta-button",
      tagged: true,
      note: "LA 전용",
    });
    expect("error" in result).toBe(false);
    if ("data" in result) {
      expect(result.data.name).toBe("GTM & GA4 연결");
      expect(result.data.projectId).toBe("proj1");
      expect(result.data.groupId).toBe("group1");
      expect(result.data.step).toBe(1);
      expect(result.data.triggerCondition).toBe("CE-generate_lead");
      expect(result.data.content).toContain("fbq");
      expect(result.data.tagged).toBe(true);
    }
  });

  it("설치 체크리스트 항목은 빈 이름을 거부한다", () => {
    const result = normalizeTaxonomyInput({ projectId: "proj1", name: "   " });
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("partial 모드에서 projectId 를 함께 보내지 않으면 기존 체크리스트 항목의 name patch 도 snake_case 로 강제된다 — 호출부는 projectId 를 항상 같이 보내야 한다", () => {
    const result = normalizeTaxonomyInput({ id: "x", name: "1단계 연결" }, { partial: true });
    expect(result).toEqual({ error: expect.stringContaining("영문 소문자") });
  });
});
