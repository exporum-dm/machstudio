/**
 * 브리프 서버 공통 — 권한 관문, 주소 만들기, 단축링크 보장.
 *
 * ── 권한은 URL 이 지목한 자원 기준으로 본다 ─────────────────────────────
 * (AGENTS.md "새 면을 만들 때" ②) 사이드바에서 고른 프로젝트가 아니라 **요청한 브리프가 속한
 * 프로젝트**로 판정한다. 규칙은 홈페이지(requireProjectAccess)와 같다:
 *   · 그 프로젝트의 워크스페이스 멤버(OWNER·ADMIN·MEMBER) → 읽기·쓰기. 프로젝트 배정은 보지 않는다(2026-11-02)
 *   · 그 밖 → 404 (브리프 id 로 존재 여부를 떠볼 수 없게)
 */
import { customAlphabet } from "nanoid";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getPublicAppOrigin } from "@/lib/app-url";
import type { BriefPreset } from "./sources";


const notFound = () => NextResponse.json({ error: "찾을 수 없어요" }, { status: 404 });

export interface ProjectGuardOk {
  ok: true;
  userId: string;
  workspaceId: string;
  canWrite: boolean;
}
type GuardFail = { ok: false; response: NextResponse };

/** 프로젝트 단위 관문 — 목록·생성처럼 아직 브리프 id 가 없을 때. */
export async function guardProject(projectId: string, { write }: { write: boolean }): Promise<ProjectGuardOk | GuardFail> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "인증 필요" }, { status: 401 }) };

  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, workspaceId: true },
  });
  if (!project) return { ok: false, response: notFound() };

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: project.workspaceId } },
    select: { role: true },
  });
  if (!membership) return { ok: false, response: notFound() };
  // 워크스페이스 멤버면 배정 없이 모든 프로젝트를 보고 고친다 — write 요청도 통과(2026-11-02).
  void write;
  return { ok: true, userId: user.id, workspaceId: project.workspaceId, canWrite: true };
}

/** 브리프 단위 관문 — 브리프가 속한 프로젝트로 판정한다. */
export async function guardBrief(briefId: string, { write }: { write: boolean }) {
  const brief = await prisma.brief.findFirst({ where: { id: briefId, deletedAt: null } });
  if (!brief) return { ok: false as const, response: notFound() };
  const g = await guardProject(brief.projectId, { write });
  if (!g.ok) return g;
  return { ...g, brief };
}

/**
 * 밖으로 나가는 주소의 뿌리(카톡 텍스트·공개 페이지 링크).
 *
 * 운영에서는 **정식 공개 주소만** 쓴다(getPublicAppOrigin). 요청 주소로 대신하면 미리보기
 * 배포 주소가 카톡에 한 번 박히고, 그 배포가 사라지면 링크가 죽는다(AGENTS.md ①).
 * 로컬 개발에서는 그 설정이 비어 있으므로(localhost 는 거절됨) 요청 주소로 대신한다.
 */
export function outboundOrigin(request: Request): string {
  const canonical = getPublicAppOrigin();
  if (canonical) return canonical;
  if (process.env.NODE_ENV !== "production") return new URL(request.url).origin;
  return "";
}

/** 단축링크 뿌리 — 기존 단축 URL 기능(api/shorten-url)과 같은 설정을 따른다. */
export function shortBase(request: Request): string {
  const configured = process.env.SHORT_URL_BASE || process.env.NEXT_PUBLIC_SHORT_URL_BASE;
  return (configured || outboundOrigin(request)).replace(/\/+$/, "");
}

export function publicBriefUrl(request: Request, slug: string): string {
  const origin = outboundOrigin(request);
  return origin ? `${origin}/b/${slug}` : "";
}

const makeCode = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 7);

/**
 * 채택된 링크에 단축링크가 있게 한다. 한 번 만든 건 다시 쓴다 — 코드가 바뀌면 이미 카톡에 나간
 * 주소와 대시보드 집계가 갈라진다.
 */
export async function ensureShortLink(
  item: { id: string; url: string; shortLinkId: string | null },
  ctx: { workspaceId: string; userId: string },
): Promise<{ id: string; code: string }> {
  if (item.shortLinkId) {
    const existing = await prisma.shortLink.findUnique({ where: { id: item.shortLinkId }, select: { id: true, code: true } });
    if (existing) return existing;
  }
  for (let i = 0; i < 8; i += 1) {
    try {
      const link = await prisma.shortLink.create({
        data: { code: makeCode(), longUrl: item.url, workspaceId: ctx.workspaceId, createdById: ctx.userId },
        select: { id: true, code: true },
      });
      await prisma.briefItem.update({ where: { id: item.id }, data: { shortLinkId: link.id } });
      return link;
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") continue;
      throw error;
    }
  }
  throw new Error("SHORT_CODE_COLLISION");
}

/** 프리셋의 수집 소스를 브리프에 붙인다. 같은 이름이 이미 있으면 건너뛴다(두 번 눌러도 두 벌 안 생기게). */
export async function applyPreset(briefId: string, preset: BriefPreset): Promise<number> {
  const existing = await prisma.briefSource.findMany({ where: { briefId }, select: { name: true, sortOrder: true } });
  const names = new Set(existing.map((e) => e.name));
  let order = existing.reduce((m, e) => Math.max(m, e.sortOrder), -1) + 1;
  const data = preset.sources
    .filter((s) => !names.has(s.name))
    .map((s) => ({ briefId, kind: s.kind, name: s.name, category: s.category, config: s.config as object, sortOrder: order++ }));
  if (data.length) await prisma.briefSource.createMany({ data });
  return data.length;
}
