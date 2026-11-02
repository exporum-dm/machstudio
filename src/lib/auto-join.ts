/**
 * 회사 메일로 가입한 사람은 초대 없이 회사 워크스페이스에 들어간다(2026-11-02).
 *
 * 왜: 예전엔 가입해도 누군가 워크스페이스로 초대해 줄 때까지 빈 화면이었다. 팀 안에서 닫아 둘
 * 이유가 없어서 연다. 다만 사전등록 명단·연락처 같은 개인정보가 있으니 **회사 메일 주인만** 들인다.
 *
 * 그래서 두 가지를 다 봐야 한다:
 *   · 도메인 — @exporum.com (AUTO_JOIN_EMAIL_DOMAIN 으로 바꿀 수 있다)
 *   · 메일이 **확인된** 계정 — 이메일 가입은 확인 링크를 눌러야(Supabase mailer_autoconfirm=false),
 *     Google 로그인은 Google 이 확인한 메일이라 email_confirmed_at 이 찬다. 확인 전 계정을 들이면
 *     아무나 남의 회사 메일 주소를 적어 넣고 들어올 수 있다.
 *
 * 워크스페이스가 하나도 없을 때만 부른다 — 관리자가 일부러 뺀 사람을 매번 다시 넣지 않게.
 */
import { prisma } from "@/lib/prisma";

/** DM 워크스페이스. 다른 곳으로 바꾸려면 AUTO_JOIN_WORKSPACE_ID. */
const DEFAULT_WORKSPACE_ID = "cmp6zn9t600005csaxd2uno40";
const DEFAULT_DOMAIN = "exporum.com";

interface AuthUserLike {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}

/** 순수 판정 — 확인된 회사 메일인지. */
export function isCompanyEmail(user: AuthUserLike, domain = process.env.AUTO_JOIN_EMAIL_DOMAIN?.trim() || DEFAULT_DOMAIN): boolean {
  const email = user.email?.trim().toLowerCase();
  if (!email || !user.email_confirmed_at) return false;
  return email.endsWith(`@${domain.toLowerCase().replace(/^@/, "")}`);
}

/** 들였으면 true. 실패해도 던지지 않는다 — 앱 첫 화면의 필수 경로라서. */
export async function autoJoinCompanyWorkspace(user: AuthUserLike): Promise<boolean> {
  if (!isCompanyEmail(user)) return false;
  const workspaceId = process.env.AUTO_JOIN_WORKSPACE_ID?.trim() || DEFAULT_WORKSPACE_ID;
  try {
    const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null }, select: { id: true } });
    if (!workspace) return false;
    await prisma.workspaceMember.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
      create: { userId: user.id, workspaceId, role: "MEMBER" },
      update: {},
    });
    return true;
  } catch (err) {
    console.error("[auto-join] failed:", user.id, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * 최고 관리자는 모든 워크스페이스에 들어간다(2026-11-02) — 새로 생기는 워크스페이스까지.
 *
 * 화면·API 의 권한 검사는 전부 "그 워크스페이스 멤버인가"로 한다. 검사마다 최고 관리자 예외를 다는 대신
 * 빠진 워크스페이스에 ADMIN 멤버로 넣는다 — 한 곳만 고치면 모든 메뉴가 그대로 열린다.
 * 이미 OWNER·ADMIN·MEMBER 로 들어가 있는 곳은 건드리지 않는다. 넣었으면 true.
 */
export async function ensureSuperAdminEverywhere(userId: string): Promise<boolean> {
  try {
    const missing = await prisma.workspace.findMany({
      where: { deletedAt: null, members: { none: { userId } } },
      select: { id: true },
    });
    if (missing.length === 0) return false;
    await prisma.workspaceMember.createMany({
      data: missing.map((w) => ({ userId, workspaceId: w.id, role: "ADMIN" as const })),
      skipDuplicates: true,
    });
    return true;
  } catch (err) {
    console.error("[auto-join] super admin membership failed:", userId, err instanceof Error ? err.message : err);
    return false;
  }
}
