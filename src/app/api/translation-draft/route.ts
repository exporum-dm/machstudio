/**
 * 번역 초안 — POST { scope, resourceId, from, to, subject?, items: [{ id, context, base }] }
 *
 * 비어 있는 번역 칸의 초안을 돌려준다. **저장하지 않는다** — 화면이 받아서 칸에 꽂고,
 * 운영자가 검토한 뒤 평소 자동저장으로 저장된다(주간 보고 AI 다듬기와 같은 계약).
 *
 * 왜 인증이 필요한가: 운영자가 쓴 글(아직 공개 전인 행사 카피까지)이 외부 모델로 나가고,
 * 우리 모델 키를 쓴다. 그래서 그 글이 속한 자원의 **워크스페이스 멤버**만 부를 수 있다.
 *
 * 소속은 `workspaceId` 를 받아서 믿지 않고 **자원 id 로 서버가 찾는다**(AGENTS.md ②) —
 * 화면이 사이드바 컨텍스트의 워크스페이스를 보내면, 다른 워크스페이스의 웨비나를 편집하는
 * 동안 그 컨텍스트가 어긋나 있어도 통과해 버린다.
 */
import { NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/workspace-access";
import { prisma } from "@/lib/prisma";
import { rateLimitAsync } from "@/lib/ratelimit";
import { DRAFT_MAX_ITEMS, type DraftRequestItem } from "@/lib/translation-draft";
import { draftTranslations, translationDraftAvailable } from "@/lib/translation-draft-server";
import { normalizeLocaleTag } from "@/lib/form-locale";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) ?? {};

  const scope = body.scope;
  const resourceId = typeof body.resourceId === "string" ? body.resourceId : "";
  if (!["webinar", "collect", "competition", "detail-page", "expo"].includes(scope) || !resourceId) {
    return NextResponse.json({ error: "어느 자원의 번역인지 알 수 없어요" }, { status: 400 });
  }

  // 자원 → 워크스페이스. 없는 자원은 "접근 권한 없음" 과 같이 다룬다(존재 여부를 알려 줄 이유가 없다).
  const args = { where: { id: resourceId }, select: { workspaceId: true } } as const;
  const owner = await (async () => {
    switch (scope) {
      case "webinar": return prisma.webinar.findUnique(args);
      case "collect": return prisma.collectSource.findUnique(args);
      case "competition": return prisma.competition.findUnique(args);
      case "detail-page": return prisma.detailPage.findFirst({ ...args, where: { ...args.where, deletedAt: null } });
      case "expo": {
        const page = await prisma.expoPage.findFirst({
          where: { id: resourceId, deletedAt: null, site: { deletedAt: null } },
          select: { site: { select: { workspaceId: true } } },
        });
        return page?.site;
      }
    }
  })();

  const access = await requireWorkspaceMember(owner?.workspaceId ?? null);
  if ("error" in access) {
    return NextResponse.json({ error: owner ? access.error : "접근 권한 없음" }, { status: owner ? access.status : 403 });
  }

  if (!translationDraftAvailable()) {
    return NextResponse.json(
      { error: "번역 초안은 Vercel 환경 변수 ANTHROPIC_API_KEY 를 넣으면 켜져요" },
      { status: 501 },
    );
  }

  // 지원 목록 밖 언어는 거부한다 — 시스템 문구 사전이 없는 언어로 번역해 두면 라벨만
  // 번역되고 버튼·검증 문구는 원문으로 남는다(form-locale 의 FORM_LOCALES 주석).
  const from = normalizeLocaleTag(body.from);
  const to = normalizeLocaleTag(body.to);
  if (!from || !to || from === to) {
    return NextResponse.json({ error: "번역할 언어를 확인해주세요" }, { status: 400 });
  }

  const items: DraftRequestItem[] = Array.isArray(body.items)
    ? body.items
        .map((raw: unknown) => {
          const r = (raw ?? {}) as Record<string, unknown>;
          return {
            id: typeof r.id === "string" ? r.id : "",
            context: typeof r.context === "string" ? r.context : "",
            base: typeof r.base === "string" ? r.base : "",
          };
        })
        .filter((i: DraftRequestItem) => i.id && i.base.trim())
        .slice(0, DRAFT_MAX_ITEMS)
    : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "번역할 문구가 없어요" }, { status: 400 });
  }

  /**
   * 사용자당 한도. 한 번 누르면 수십 칸이 한꺼번에 나가므로 연타가 그대로 비용이 된다.
   * 주간 보고 AI 다듬기와 같은 창(10분)을 쓰되, 번역은 언어마다 한 번씩 누를 일이 있어
   * 조금 넉넉하게 둔다.
   */
  const limit = await rateLimitAsync(`translation-draft:${access.userId}`, { limit: 12, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "번역 초안을 너무 자주 눌렀어요 — 잠시 후 다시 시도해 주세요" },
      { status: 429 },
    );
  }

  try {
    const drafts = await draftTranslations({
      items,
      from,
      to,
      subject: typeof body.subject === "string" ? body.subject.slice(0, 80) : undefined,
    });
    return NextResponse.json({ items: drafts });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "번역 초안을 받지 못했어요" },
      { status: 502 },
    );
  }
}
