import { describe, expect, it } from "vitest";
import { creatorEmailHtml, personalize, recipientEmail } from "./mail";

describe("recipientEmail", () => {
  it("운영 연락처가 이메일이면 그걸 쓴다", () => {
    expect(recipientEmail("Owner@Example.com", "form@example.com")).toBe("owner@example.com");
  });

  it("운영 연락처가 DM 주소면 신청서 이메일로 간다", () => {
    expect(recipientEmail("https://instagram.com/direct/t/123", "form@example.com")).toBe("form@example.com");
  });

  it("둘 다 없으면 빈 문자열 — 호출부가 제외 대상으로 센다", () => {
    expect(recipientEmail("", null)).toBe("");
    expect(recipientEmail("010-1234-5678", "")).toBe("");
  });
});

describe("personalize", () => {
  it("{{이름}} 을 사람 이름으로 바꾼다", () => {
    expect(personalize("{{이름}} 님, 축하합니다", "김미은")).toBe("김미은 님, 축하합니다");
    expect(personalize("{{ 이름 }} 님", "김미은")).toBe("김미은 님");
  });

  it("다른 중괄호는 건드리지 않는다", () => {
    expect(personalize("{{미션}} 안내", "김미은")).toBe("{{미션}} 안내");
  });
});

describe("creatorEmailHtml", () => {
  it("개인 페이지 링크를 버튼으로 넣는다", () => {
    const html = creatorEmailHtml({
      subject: "선발 안내", body: "{{이름}} 님 축하합니다", name: "김미은",
      portalUrl: "https://machstudio.vercel.app/creator-portal/cp_abc", buttonLabel: "활동 페이지",
    });
    expect(html).toContain("김미은 님 축하합니다");
    expect(html).toContain("https://machstudio.vercel.app/creator-portal/cp_abc");
    expect(html).toContain("활동 페이지");
  });

  it("링크가 없으면 버튼도 없다", () => {
    const html = creatorEmailHtml({ subject: "안내", body: "본문", name: "김미은" });
    expect(html).not.toContain("<a href");
  });

  it("본문의 HTML 은 그대로 글자로 보여 준다", () => {
    const html = creatorEmailHtml({ subject: "안내", body: "<script>alert(1)</script>", name: "김미은" });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});
