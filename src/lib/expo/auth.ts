/**
 * 홈페이지 어드민의 **소유권 판정** — 누가 무엇을 볼 수 있고 고칠 수 있는가.
 *
 * ── 왜 한 곳에 모으나 ─────────────────────────────────────────────────
 * 라우트마다 직접 판정하면 한 곳만 빠뜨려도 남의 전시 데이터가 열린다. 실제로 이 저장소는
 * 그 사고를 겪었다 — 웨비나 배포 탭이 **사이드바에 떠 있는 프로젝트**로 아임웹 사이트를
 * 조회·변경해서, 딥링크로 들어오면 다른 전시의 공개 노출이 성공 토스트와 함께 바뀌었다.
 *
 * 그래서 규칙이 하나다(`AGENTS.md` 의 "새 면을 만들 때" ②):
 * **상세 화면이 형제 자원을 다룰 때 소속은 URL 이 지목한 자원에서 온다.**
 * 사이드바의 현재 프로젝트는 목록을 그릴 때만 쓰고, 여기서는 절대 쓰지 않는다.
 *
 * ── 없는 것과 권한 없는 것을 구분하지 않는다 ──────────────────────────
 * 남의 워크스페이스 자원은 403 이 아니라 **404** 다. 403 은 "그 id 는 존재한다" 를 알려 준다.
 */
import type { ExpoCapabilities } from "@/lib/expo/capability";

export type ExpoAuthFailure =
  | { kind: "unauthenticated" }        // 401
  | { kind: "forbidden" }              // 403 — 로그인은 했지만 이 워크스페이스 멤버가 아니다
  | { kind: "not-found" }              // 404 — 없거나, 남의 것이거나
  | { kind: "unavailable" };           // 503 — 기능이 아직 안 열렸다(스키마 미적용)

export type ExpoAuthResult<T> = { ok: true; value: T } | { ok: false; failure: ExpoAuthFailure };

export const fail = <T>(kind: ExpoAuthFailure["kind"]): ExpoAuthResult<T> => ({ ok: false, failure: { kind } });
export const ok = <T>(value: T): ExpoAuthResult<T> => ({ ok: true, value });

/** 실패를 HTTP 상태로. 라우트마다 다른 숫자를 쓰지 않게 한 곳에 둔다. */
export function statusFor(failure: ExpoAuthFailure): number {
  switch (failure.kind) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "not-found": return 404;
    case "unavailable": return 503;
  }
}

export function messageFor(failure: ExpoAuthFailure): string {
  switch (failure.kind) {
    case "unauthenticated": return "로그인이 필요해요";
    case "forbidden": return "이 워크스페이스에 접근할 수 없어요";
    case "not-found": return "찾을 수 없어요";
    case "unavailable": return "홈페이지 기능이 아직 열리지 않았어요";
  }
}

/** 소유권 판정에 필요한 최소한 — Prisma 레코드를 그대로 넘기지 않는다. */
export interface OwnedSite {
  id: string;
  workspaceId: string;
  projectId: string;
}

export interface OwnedPage {
  id: string;
  siteId: string;
  site: OwnedSite;
}

export interface OwnedTemplate {
  id: string;
  workspaceId: string;
}

/**
 * 기능이 열려 있는가 — 모든 홈페이지 라우트의 **첫 관문**.
 * 스키마가 아직 없는 배포에서 조회를 시작하면 안 된다.
 */
export function requireExpoAdmin(caps: ExpoCapabilities): ExpoAuthResult<true> {
  return caps.admin ? ok(true as const) : fail("unavailable");
}

/**
 * 이 사람이 이 워크스페이스의 멤버인가.
 * `memberWorkspaceIds` 는 세션에서 온 목록이다 — 라우트가 매번 다시 조회하지 않게.
 */
export function requireMembership(
  userId: string | null,
  memberWorkspaceIds: readonly string[],
  workspaceId: string,
): ExpoAuthResult<true> {
  if (!userId) return fail("unauthenticated");
  return memberWorkspaceIds.includes(workspaceId) ? ok(true as const) : fail("forbidden");
}

/**
 * URL 이 지목한 사이트를 소유하는가.
 *
 * **사이드바의 현재 프로젝트를 보지 않는다.** 소속은 이 사이트 레코드에서 온다 —
 * 그게 딥링크 사고를 막는 규칙이다.
 */
export function requireOwnedSite(
  site: OwnedSite | null,
  userId: string | null,
  memberWorkspaceIds: readonly string[],
): ExpoAuthResult<OwnedSite> {
  if (!userId) return fail("unauthenticated");
  if (!site) return fail("not-found");
  // 남의 워크스페이스면 **없는 것으로** 답한다 — 403 은 그 id 의 존재를 알려 준다.
  if (!memberWorkspaceIds.includes(site.workspaceId)) return fail("not-found");
  return ok(site);
}

export function requireOwnedPage(
  page: OwnedPage | null,
  userId: string | null,
  memberWorkspaceIds: readonly string[],
): ExpoAuthResult<OwnedPage> {
  if (!userId) return fail("unauthenticated");
  if (!page) return fail("not-found");
  const site = requireOwnedSite(page.site, userId, memberWorkspaceIds);
  return site.ok ? ok(page) : fail("not-found");
}

export function requireOwnedTemplate(
  template: OwnedTemplate | null,
  userId: string | null,
  memberWorkspaceIds: readonly string[],
): ExpoAuthResult<OwnedTemplate> {
  if (!userId) return fail("unauthenticated");
  if (!template) return fail("not-found");
  if (!memberWorkspaceIds.includes(template.workspaceId)) return fail("not-found");
  return ok(template);
}

/** 워크스페이스 역할 — Prisma 의 `Role` 과 같은 값이다. */
export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";
export type ProjectRole = "VIEWER" | "EDITOR" | "ADMIN";

/**
 * 워크스페이스 멤버면 그 워크스페이스의 모든 프로젝트를 본다(2026-11-02, 배정 불필요).
 * 워크스페이스 밖이면 404 — 프로젝트 id 로 존재 여부를 떠볼 수 없게.
 */
export function requireProjectAccess(
  workspaceRole: WorkspaceRole | null,
  projectRole: ProjectRole | null,
): ExpoAuthResult<true> {
  void projectRole;
  return workspaceRole === "OWNER" || workspaceRole === "ADMIN" || workspaceRole === "MEMBER"
    ? ok(true as const)
    : fail("not-found");
}

/**
 * 워크스페이스 **전역** 자원을 관리해도 되는가 — 템플릿 이름 변경·영구 삭제.
 *
 * 템플릿은 프로젝트가 아니라 워크스페이스에 매달려 있다. 한 전시의 관리자가 지우면
 * **다른 전시들이 쓰던 틀이 같이 사라진다.** 그래서 프로젝트 권한으로는 부족하고
 * 워크스페이스 OWNER·ADMIN 만 손댈 수 있다.
 */
export function requireWorkspaceAdmin(
  userId: string | null,
  role: WorkspaceRole | null,
): ExpoAuthResult<WorkspaceRole> {
  if (!userId) return fail("unauthenticated");
  // 멤버가 아닌 경우는 호출부의 소유권 판정이 이미 404 로 막았다 — 여기 오면 권한 문제다.
  if (!role) return fail("not-found");
  return role === "OWNER" || role === "ADMIN" ? ok(role) : fail("forbidden");
}

/**
 * 두 자원이 **같은 사이트** 소속인가 — 형제 자원을 다룰 때 서버가 마지막으로 확인한다.
 * 클라이언트를 고쳐도 이 검증이 없으면 같은 사고가 다른 경로로 재발한다.
 */
export function requireSameSite(a: { siteId: string }, b: { siteId: string }): ExpoAuthResult<true> {
  return a.siteId === b.siteId ? ok(true as const) : fail("not-found");
}

/**
 * 사전등록 소스를 이 사이트에 연결해도 되는가 — **같은 프로젝트**여야 한다.
 * 아니면 홈페이지의 등록 폼이 다른 전시의 등록을 받는다.
 */
export function requireSameProjectSource(
  site: OwnedSite,
  source: { id: string; projectId: string } | null,
): ExpoAuthResult<{ id: string; projectId: string }> {
  if (!source) return fail("not-found");
  return source.projectId === site.projectId ? ok(source) : fail("not-found");
}
