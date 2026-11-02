import { describe, expect, it } from "vitest";
import { isCompanyEmail } from "@/lib/auto-join";

/** 회사 메일 주인만 초대 없이 들어온다 — 사전등록 개인정보가 있는 워크스페이스라서. */
describe("회사 메일 자동 가입", () => {
  const confirmed = "2026-11-02T00:00:00Z";

  it("확인된 @exporum.com 만", () => {
    expect(isCompanyEmail({ id: "1", email: "new@exporum.com", email_confirmed_at: confirmed }, "exporum.com")).toBe(true);
    expect(isCompanyEmail({ id: "1", email: "New@Exporum.COM", email_confirmed_at: confirmed }, "exporum.com")).toBe(true);
  });

  /** 확인 링크를 안 누른 계정은 남의 회사 메일을 적어 넣었을 수 있다. */
  it("메일 확인 전이면 안 들인다", () => {
    expect(isCompanyEmail({ id: "1", email: "new@exporum.com", email_confirmed_at: null }, "exporum.com")).toBe(false);
  });

  it("다른 도메인·비슷한 도메인은 안 들인다", () => {
    expect(isCompanyEmail({ id: "1", email: "a@gmail.com", email_confirmed_at: confirmed }, "exporum.com")).toBe(false);
    expect(isCompanyEmail({ id: "1", email: "a@notexporum.com", email_confirmed_at: confirmed }, "exporum.com")).toBe(false);
    expect(isCompanyEmail({ id: "1", email: "a@exporum.com.evil.io", email_confirmed_at: confirmed }, "exporum.com")).toBe(false);
  });
});
