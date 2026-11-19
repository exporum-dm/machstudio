/**
 * 공개 페이로드를 만드는 **유일한 경계**.
 *
 * 여기를 지나야 로케일 맵이 문자열이 되고, `page:{id}` 내부 참조가 실제 주소가 되고,
 * 사전등록 소스 참조가 id 하나로 좁혀진다. 로더는 이 함수의 결과만 실어 보낸다 —
 * Prisma 레코드를 통째로 넣는 경로를 만들지 않기 위해서다.
 *
 * ── 무엇을 절대 내보내지 않나 ─────────────────────────────────────────
 * 페이지·소스 레코드 전체, 다른 사이트의 주소, 삭제된 페이지의 주소, 미리보기 토큰.
 * 내부 링크는 **같은 사이트의 살아 있는 페이지**이고 아임웹 주소가 있을 때만 풀린다 —
 * 그러지 않으면 빈 문자열이 되고, 그 자리는 이행 현황에서 "링크가 아직 안 걸렸다" 로 보인다.
 */
import type { Localized } from "@/lib/collect-form-config";
import { resolveCampaignStates } from "@/lib/expo/campaign";
import { resolveDestinations } from "@/lib/expo/destination";
import { sectionDef } from "@/lib/expo/registry";
import { resolveLocalizedText, resolvePluginContent } from "@/lib/expo/plugin-content";
import type { ExpoPageConfigV2, ExpoSection, ExpoEventConfig, ResolvedCampaignState, ResolvedDestination, SlotDef } from "@/lib/expo/types";
import type { PayloadSection } from "@/lib/expo/view-sections";

/** 내부 참조를 풀 때 필요한 최소 정보 — 레코드를 통째로 받지 않는다. */
export interface LinkTarget {
  id: string;
  /** 이 페이지에 대응하는 아임웹 주소. 없으면 링크를 못 건다. */
  imwebUrl: string | null;
  deletedAt: Date | string | null;
}

export interface ResolveContext {
  locale: string;
  defaultLocale?: string;
  /** **같은 사이트의** 페이지들만 넣는다 — 남의 사이트 주소가 새는 경로를 원천 차단한다. */
  pages: LinkTarget[];
  /** Server time; never let the browser decide a campaign schedule. */
  now: Date;
  forcedCampaigns?: Readonly<Record<string, boolean>>;
}

/** 페이로드에서 발견한, 운영자가 손봐야 할 자리. */
export interface PayloadIssue {
  sid: string;
  slot: string;
  code: "internal-link-unresolved";
}

export interface ResolvedPayload {
  event?: ExpoEventConfig;
  campaigns: ResolvedCampaignState[];
  destinations: ResolvedDestination[];
  sections: Array<PayloadSection & Record<string, unknown>>;
  issues: PayloadIssue[];
}

const isLocalizedMap = (v: unknown): v is Localized =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * `page:{id}` 를 실제 주소로. 못 풀면 **빈 문자열**이다 —
 * 깨진 링크를 내보내느니 버튼이 안 눌리는 편이 낫고, 그 사실은 issues 로 올라간다.
 */
function resolveHref(href: string, ctx: ResolveContext, byId: Map<string, LinkTarget>): { href: string; unresolved: boolean } {
  if (!href.startsWith("page:")) return { href, unresolved: false };
  const target = byId.get(href.slice("page:".length));
  if (!target || target.deletedAt || !target.imwebUrl) return { href: "", unresolved: true };
  return { href: target.imwebUrl, unresolved: false };
}

function resolveSlot(
  def: SlotDef,
  value: unknown,
  ctx: ResolveContext,
  byId: Map<string, LinkTarget>,
  sid: string,
  issues: PayloadIssue[],
): unknown {
  if (value === undefined) return undefined;
  switch (def.kind) {
    case "text":
    case "textarea":
      // 저장은 맵, 나가는 것은 **한 로케일의 문자열**이다.
      return isLocalizedMap(value) ? resolveLocalizedText(value, ctx.locale, ctx.defaultLocale) : "";

    case "code":
    case "sourceRef":
    case "media":
      return value;

    case "link": {
      const l = value as { label?: string; href?: string; labelI18n?: Localized };
      const { href, unresolved } = resolveHref(String(l.href ?? ""), ctx, byId);
      if (unresolved) issues.push({ sid, slot: def.key, code: "internal-link-unresolved" });
      return { label: l.labelI18n?.[ctx.locale] || String(l.label ?? ""), href };
    }

    case "list": {
      if (!Array.isArray(value) || !def.itemSlots) return [];
      return value.map((row) => {
        const src = (row ?? {}) as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const slot of def.itemSlots!) {
          const v = resolveSlot(slot, src[slot.key], ctx, byId, sid, issues);
          if (v !== undefined) out[slot.key] = v;
        }
        return out;
      });
    }
  }
}

/**
 * 렌더 가능한 섹션들을 **공개 페이로드**로 바꾼다.
 *
 * 내부 페이지 id 는 호출부가 한 번에 모아 넘긴다(`ctx.pages`) — 섹션마다 DB 를 두드리면
 * 페이지 하나에 수십 번 쿼리가 나간다.
 */
export function buildExpoPayload(config: ExpoPageConfigV2, ctx: ResolveContext): ResolvedPayload {
  const byId = new Map(ctx.pages.map((p) => [p.id, p]));
  const issues: PayloadIssue[] = [];

  const out: ResolvedPayload["sections"] = [];
  for (const section of config.sections) {
    const def = sectionDef(section.type);
    if (!def) continue;
    let content: Record<string, unknown> = {};
    if (def.normalize) {
      let publicContent: Record<string, unknown>;
      try {
        publicContent = def.normalize(section.content, { mode: "public", locale: ctx.locale });
      } catch {
        continue;
      }
      const resolved = resolvePluginContent(publicContent, ctx.locale, ctx.defaultLocale);
      if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
        content = resolved as Record<string, unknown>;
      }
    } else {
      for (const slot of def.slots) {
        const v = resolveSlot(slot, section.content[slot.key], ctx, byId, section.sid, issues);
        if (v !== undefined) content[slot.key] = v;
      }
    }
    out.push({
      sid: section.sid,
      type: section.type,
      variant: section.variant,
      design: section.design,
      content,
    });
  }

  const settings = config.settings;
  return {
    ...(settings?.event ? { event: settings.event } : {}),
    campaigns: resolveCampaignStates(settings?.campaigns ?? [], ctx.now, ctx.forcedCampaigns),
    destinations: resolveDestinations(settings?.destinations ?? []),
    sections: out,
    issues,
  };
}

/**
 * 이 섹션들이 참조하는 **내부 페이지 id** 를 모은다(중복 제거).
 * 호출부가 이걸로 한 번에 조회한다.
 */
export function collectInternalPageIds(sections: ExpoSection[]): string[] {
  const ids = new Set<string>();
  const walk = (slots: SlotDef[], content: Record<string, unknown>) => {
    for (const slot of slots) {
      const v = content[slot.key];
      if (v === undefined) continue;
      if (slot.kind === "link") {
        const href = String((v as { href?: string }).href ?? "");
        if (href.startsWith("page:")) ids.add(href.slice("page:".length));
      } else if (slot.kind === "list" && Array.isArray(v) && slot.itemSlots) {
        for (const row of v) walk(slot.itemSlots, (row ?? {}) as Record<string, unknown>);
      }
    }
  };
  for (const s of sections) walk(sectionDef(s.type)?.slots ?? [], s.content);
  return [...ids];
}

/** 사전등록 소스 참조를 모은다 — 로더가 소속을 검증한 뒤 페이로드에 id 만 싣는다. */
export function collectSourceRefs(sections: ExpoSection[]): string[] {
  const ids = new Set<string>();
  for (const s of sections) {
    for (const slot of sectionDef(s.type)?.slots ?? []) {
      if (slot.kind !== "sourceRef") continue;
      const v = s.content[slot.key];
      if (typeof v === "string" && v) ids.add(v);
    }
  }
  return [...ids];
}
