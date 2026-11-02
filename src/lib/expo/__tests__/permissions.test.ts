import { describe, expect, it } from "vitest";
import { canAccessExpoProject, deriveExpoPermissions } from "@/lib/expo/permissions";

describe("Expo project permissions", () => {
  it.each([
    ["OWNER", null, true, true, true, true],
    ["ADMIN", null, true, true, true, true],
    ["MEMBER", "ADMIN", true, true, true, false],
    ["MEMBER", "EDITOR", true, true, false, false],
    // 2026-11-02: 워크스페이스 멤버는 배정이 없거나 VIEWER 여도 편집·발행한다(삭제는 프로젝트 ADMIN 만).
    ["MEMBER", "VIEWER", true, true, false, false],
    ["MEMBER", null, true, true, false, false],
    [null, null, false, false, false, false],
  ] as const)("maps %s/%s", (workspaceRole, projectRole, canEdit, canPublish, canManageSite, canManageTemplates) => {
    expect(deriveExpoPermissions(workspaceRole, projectRole)).toEqual({
      canEdit,
      canPublish,
      canManageSite,
      canManageTemplates,
    });
  });

  it("워크스페이스 멤버는 배정 없이도 모든 프로젝트를 본다, 밖의 사람은 못 본다", () => {
    expect(canAccessExpoProject("MEMBER", null)).toBe(true);
    expect(canAccessExpoProject("MEMBER", "VIEWER")).toBe(true);
    expect(canAccessExpoProject(null, null)).toBe(false);
  });
});
