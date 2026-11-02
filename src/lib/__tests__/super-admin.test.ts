import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// super-admin.ts evaluates env at import time → use dynamic re-imports per test.
async function load(envValue: string | undefined) {
  vi.resetModules();
  if (envValue === undefined) {
    delete process.env.SUPER_ADMIN_EMAILS;
  } else {
    process.env.SUPER_ADMIN_EMAILS = envValue;
  }
  return await import("@/lib/super-admin");
}

const ORIGINAL = process.env.SUPER_ADMIN_EMAILS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SUPER_ADMIN_EMAILS;
  else process.env.SUPER_ADMIN_EMAILS = ORIGINAL;
});

describe("isSuperAdmin", () => {
  it("parses CSV emails", async () => {
    const m = await load("a@x.com,b@x.com,c@x.com");
    expect(m.isSuperAdmin("a@x.com")).toBe(true);
    expect(m.isSuperAdmin("b@x.com")).toBe(true);
    expect(m.isSuperAdmin("c@x.com")).toBe(true);
    expect(m.isSuperAdmin("d@x.com")).toBe(false);
  });

  it("matches case-insensitively", async () => {
    const m = await load("Admin@Example.COM");
    expect(m.isSuperAdmin("admin@example.com")).toBe(true);
    expect(m.isSuperAdmin("ADMIN@EXAMPLE.COM")).toBe(true);
  });

  it("trims whitespace around emails", async () => {
    const m = await load(" a@x.com , b@x.com ");
    expect(m.isSuperAdmin("a@x.com")).toBe(true);
    expect(m.isSuperAdmin("b@x.com")).toBe(true);
  });

  it("returns false for empty/null/undefined email", async () => {
    const m = await load("admin@x.com");
    expect(m.isSuperAdmin("")).toBe(false);
    expect(m.isSuperAdmin(null)).toBe(false);
    expect(m.isSuperAdmin(undefined)).toBe(false);
  });

  it("falls back when SUPER_ADMIN_EMAILS is unset", async () => {
    const m = await load(undefined);
    // 기본 최고 관리자는 hook2 하나뿐이다(2026-11-02).
    expect(m.isSuperAdmin("hook2@exporum.com")).toBe(true);
    expect(m.isSuperAdmin("someone@exporum.com")).toBe(false);
    expect(m.isSuperAdmin("nobody@example.com")).toBe(false);
  });

  it("treats falsy env as fallback", async () => {
    const m = await load("");
    // Empty string means use fallback path.
    expect(m.isSuperAdmin("hook2@exporum.com")).toBe(true);
  });

  it("exposes isSuperAdminEmail alias", async () => {
    const m = await load("a@x.com");
    expect(m.isSuperAdminEmail("a@x.com")).toBe(true);
    expect(m.isSuperAdminEmail("b@x.com")).toBe(false);
  });
});
