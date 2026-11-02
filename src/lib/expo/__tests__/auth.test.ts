import { describe, expect, it } from "vitest";
import {
  messageFor, requireExpoAdmin, requireMembership, requireOwnedPage,
  requireOwnedSite, requireOwnedTemplate, requireProjectAccess, requireSameProjectSource, requireSameSite,
  statusFor, type OwnedSite,
} from "@/lib/expo/auth";

/**
 * 소유권 판정.
 *
 * 이 저장소는 실제로 사고를 겪었다 — 웨비나 배포 탭이 **사이드바에 떠 있는 프로젝트**로
 * 아임웹 사이트를 조회·변경해서, 딥링크로 들어오면 다른 전시의 공개 노출이 성공 토스트와
 * 함께 바뀌었다. 그래서 규칙이 하나다: **소속은 URL 이 지목한 자원에서 온다.**
 */

const site: OwnedSite = { id: "s1", workspaceId: "w1", projectId: "p1" };
const mine = ["w1", "w2"];

describe("기능 게이트가 첫 관문", () => {
  it("어드민이 안 열렸으면 조회를 시작하지 않는다", () => {
    const r = requireExpoAdmin({ admin: false, preview: false, publicEmbed: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(statusFor(r.failure)).toBe(503);
  });

  it("열려 있으면 통과", () => {
    expect(requireExpoAdmin({ admin: true, preview: true, publicEmbed: false }).ok).toBe(true);
  });
});

describe("멤버십", () => {
  it("로그인 안 했으면 401", () => {
    const r = requireMembership(null, mine, "w1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(statusFor(r.failure)).toBe(401);
  });

  /** 워크스페이스 목록 조작은 403 이 맞다 — 그 워크스페이스의 존재는 이미 아는 문맥이다. */
  it("멤버가 아니면 403", () => {
    const r = requireMembership("u1", mine, "남의워크스페이스");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(statusFor(r.failure)).toBe(403);
  });

  it("멤버면 통과", () => {
    expect(requireMembership("u1", mine, "w1").ok).toBe(true);
  });
});

describe("자원 소유 — 남의 것은 404", () => {
  /**
   * 403 은 "그 id 는 존재한다" 를 알려 준다. 남의 워크스페이스 자원은 **없는 것으로** 답한다.
   */
  it("남의 워크스페이스 사이트는 없는 것으로 답한다", () => {
    const r = requireOwnedSite({ ...site, workspaceId: "남의것" }, "u1", mine);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(statusFor(r.failure)).toBe(404);
  });

  it("없는 사이트도 404", () => {
    const r = requireOwnedSite(null, "u1", mine);
    if (!r.ok) expect(r.failure.kind).toBe("not-found");
  });

  it("내 사이트면 통과", () => {
    const r = requireOwnedSite(site, "u1", mine);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.id).toBe("s1");
  });

  it("페이지는 사이트의 소유를 따른다", () => {
    expect(requireOwnedPage({ id: "pg1", siteId: "s1", site }, "u1", mine).ok).toBe(true);
    expect(requireOwnedPage({ id: "pg1", siteId: "s1", site: { ...site, workspaceId: "남의것" } }, "u1", mine).ok)
      .toBe(false);
  });

  it("템플릿은 워크스페이스 소유를 따른다", () => {
    expect(requireOwnedTemplate({ id: "t1", workspaceId: "w1" }, "u1", mine).ok).toBe(true);
    expect(requireOwnedTemplate({ id: "t1", workspaceId: "남의것" }, "u1", mine).ok).toBe(false);
  });
});

describe("프로젝트 배정", () => {
  it("워크스페이스 MEMBER 는 배정 없이도 접근한다(2026-11-02)", () => {
    expect(requireProjectAccess("MEMBER", null).ok).toBe(true);
  });

  it("워크스페이스 밖의 사람은 존재를 알 수 없다", () => {
    const result = requireProjectAccess(null, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("not-found");
  });

  it("프로젝트 VIEWER 는 읽기 접근을 받는다", () => {
    expect(requireProjectAccess("MEMBER", "VIEWER").ok).toBe(true);
  });
});

describe("형제 자원 — 서버가 마지막으로 확인한다", () => {
  /**
   * 클라이언트를 고쳐도 이 검증이 없으면 같은 사고가 다른 경로로 재발한다.
   * 딥링크 사고의 서버측 방어가 정확히 이 모양이었다.
   */
  it("다른 사이트의 페이지를 섞으면 막는다", () => {
    expect(requireSameSite({ siteId: "s1" }, { siteId: "s1" }).ok).toBe(true);
    const r = requireSameSite({ siteId: "s1" }, { siteId: "s2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe("not-found");
  });

  /** 아니면 홈페이지의 등록 폼이 **다른 전시의 등록**을 받는다. */
  it("사전등록 소스는 같은 프로젝트여야 연결된다", () => {
    expect(requireSameProjectSource(site, { id: "src1", projectId: "p1" }).ok).toBe(true);
    expect(requireSameProjectSource(site, { id: "src1", projectId: "다른전시" }).ok).toBe(false);
    expect(requireSameProjectSource(site, null).ok).toBe(false);
  });
});

describe("문구", () => {
  it("모든 실패에 사람이 읽을 문구가 있다", () => {
    for (const kind of ["unauthenticated", "forbidden", "not-found", "unavailable"] as const) {
      const msg = messageFor({ kind });
      expect(`${kind}: ${msg.trim() !== ""}`).toBe(`${kind}: true`);
      expect(msg).not.toMatch(/undefined|null|Error/);
    }
  });
});
