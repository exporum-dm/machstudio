/**
 * 템플릿 — **완성된 디자인을 다음 전시가 골라 쓰는 틀**.
 *
 * ── 여기서 제일 중요한 일 ─────────────────────────────────────────────
 * **이전 전시의 흔적을 한 톨도 가져가지 않는 것.** 템플릿은 워크스페이스에 남아 다음
 * 프로젝트가 쓴다. 옛 사이트의 페이지 id·섹션 sid·사전등록 소스·아임웹 주소·미리보기 토큰이
 * 딸려 가면, 새 전시 홈페이지의 버튼이 **지난 전시 페이지로 사람을 보낸다.**
 * 조용히 잘못된 곳으로 보내는 링크는 깨진 링크보다 나쁘다.
 *
 * ── 두 가지 모드 ──────────────────────────────────────────────────────
 * `design` — 구조만(타입·변형·디자인 노브·테마). 문구·이미지는 안 가져간다. **기본값**이다.
 * `full`   — 문구까지. 다음 전시가 고쳐 쓸 초안으로 쓴다. 그래도 sourceRef 류는 비운다.
 *
 * ── 내부 링크의 왕복 ──────────────────────────────────────────────────
 * 저장할 때 `page:{옛 페이지 id}` → `template-page:{key}`,
 * 인스턴스화할 때 `template-page:{key}` → `page:{새 페이지 id}`.
 * key 는 템플릿 안에서만 뜻이 있는 이름이라, 스냅샷만 봐서는 어느 전시에서 왔는지 알 수 없다.
 */
import { normalizeExpoPage, normalizeExpoTheme, newSection } from "@/lib/expo/config";
import { EXPO_LIMITS, sectionDef } from "@/lib/expo/registry";
import { slugFromTitle } from "@/lib/expo/model";
import { instantiateBuiltInPreset } from "@/lib/expo/presets";
import type { ExpoPageConfig, ExpoSection, ExpoTheme, SlotDef } from "@/lib/expo/types";

export const EXPO_TEMPLATE_VERSION = 1;

export type TemplateContentMode = "design" | "full";

export interface TemplateSection {
  type: string;
  variant: string;
  design: Record<string, string>;
  /** `design` 모드에는 없다. */
  content?: Record<string, unknown>;
}

export interface TemplatePage {
  /** 템플릿 안에서만 뜻이 있는 이름 — 옛 페이지 id 를 대신한다. */
  key: string;
  slug: string;
  title: string;
  isHome: boolean;
  sortOrder: number;
  parentKey?: string;
  sections: TemplateSection[];
}

export interface TemplateSnapshot {
  version: number;
  contentMode: TemplateContentMode;
  theme: ExpoTheme;
  pages: TemplatePage[];
}

/** 저장할 때 넘기는 원본 — Prisma 레코드가 아니라 필요한 것만. */
export interface SourcePage {
  id: string;
  slug: string;
  title: string;
  isHome: boolean;
  sortOrder: number;
  parentId: string | null;
  imwebUrl: string | null;
  draft: unknown;
}

export interface BuildResult {
  snapshot: TemplateSnapshot;
  /** 사람이 손봐야 하는 것 — 화면이 체크리스트로 보여준다. */
  checklist: { internalLinksNeedReview: boolean };
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

const utf8Bytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v) ?? "").length;

/**
 * 링크를 훑어 바꾼다. `map` 이 새 href 를 주면 그걸 쓰고, `null` 을 주면 비운다.
 * 리스트 안쪽까지 재귀한다 — 카드 하나하나에 링크가 있다.
 */
function mapLinks(
  slots: SlotDef[],
  content: Record<string, unknown>,
  map: (href: string) => string | null,
  flags: { cleared: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    const slot = slots.find((s) => s.key === key);
    if (!slot) continue;                                  // 카탈로그에 없는 키는 버린다
    if (slot.kind === "link") {
      const l = obj(value);
      const next = map(str(l.href));
      if (next === null) flags.cleared = true;
      out[key] = { label: str(l.label), href: next ?? "", ...(l.labelI18n ? { labelI18n: l.labelI18n } : {}) };
    } else if (slot.kind === "list" && Array.isArray(value) && slot.itemSlots) {
      out[key] = value.map((row) => mapLinks(slot.itemSlots!, obj(row), map, flags));
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** 템플릿이 절대 실어 가면 안 되는 슬롯 — 이전 전시의 자원을 가리킨다. */
function stripOwnedSlots(slots: SlotDef[], content: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    const slot = slots.find((s) => s.key === key);
    if (!slot) continue;
    if (slot.kind === "sourceRef") continue;              // 사전등록 소스는 전시마다 다르다
    if (slot.kind === "list" && Array.isArray(value) && slot.itemSlots) {
      out[key] = value.map((row) => stripOwnedSlots(slot.itemSlots!, obj(row)));
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * 사이트를 템플릿으로 굳힌다.
 *
 * `siteImwebUrls` 에는 **원본 사이트의 아임웹 주소들**을 넣는다. 그 주소를 직접 가리키는
 * 링크는 비운다 — 다음 전시 홈페이지에서 그 버튼을 누르면 지난 전시로 가기 때문이다.
 * 비운 자리가 하나라도 있으면 체크리스트에 올린다.
 */
export function buildExpoTemplate(input: {
  theme: unknown;
  pages: SourcePage[];
  contentMode?: TemplateContentMode;
  siteImwebUrls?: string[];
}): BuildResult {
  const contentMode: TemplateContentMode = input.contentMode === "full" ? "full" : "design";
  const flags = { cleared: false };

  // 옛 페이지 id → 템플릿 내부 key. 스냅샷만 봐서는 출신을 알 수 없게 한다.
  const keyOf = new Map<string, string>();
  const usedKeys = new Set<string>();
  for (const p of input.pages) {
    const base = slugFromTitle(p.slug || p.title, usedKeys);
    usedKeys.add(base);
    keyOf.set(p.id, base);
  }

  const ownUrls = new Set(
    [...(input.siteImwebUrls ?? []), ...input.pages.map((p) => p.imwebUrl)]
      .filter((u): u is string => Boolean(u))
      .map((u) => u.replace(/\/+$/, "")),
  );

  const remap = (href: string): string | null => {
    if (href.startsWith("page:")) {
      const key = keyOf.get(href.slice("page:".length));
      // 템플릿에 없는 페이지를 가리키던 링크는 비운다.
      return key ? `template-page:${key}` : null;
    }
    if (!href) return "";
    // 원본 사이트의 아임웹 주소를 직접 가리키던 링크도 비운다.
    return ownUrls.has(href.replace(/\/+$/, "")) ? null : href;
  };

  // 홈은 정확히 하나다 — 원본에 여러 개면 첫 번째만 남긴다.
  let homeTaken = false;

  const pages: TemplatePage[] = input.pages.map((p) => {
    const { sections } = normalizeExpoPage(p.draft);
    const isHome = p.isHome && !homeTaken;
    if (isHome) homeTaken = true;

    const templateSections: TemplateSection[] = sections.map((s) => {
      const def = sectionDef(s.type)!;
      const base: TemplateSection = { type: s.type, variant: s.variant, design: { ...s.design } };
      if (contentMode === "design") return base;          // 구조만 — 문구·이미지는 안 간다
      const withoutOwned = stripOwnedSlots(def.slots, s.content);
      return { ...base, content: mapLinks(def.slots, withoutOwned, remap, flags) };
    });

    const parentKey = p.parentId ? keyOf.get(p.parentId) : undefined;
    return {
      key: keyOf.get(p.id)!,
      slug: p.slug,
      title: p.title,
      isHome,
      sortOrder: p.sortOrder,
      ...(parentKey ? { parentKey } : {}),
      sections: templateSections,
    };
  });

  const snapshot: TemplateSnapshot = {
    version: EXPO_TEMPLATE_VERSION,
    contentMode,
    theme: normalizeExpoTheme(input.theme),
    pages,
  };

  if (utf8Bytes(snapshot) > EXPO_LIMITS.templateSnapshotBytes) {
    throw new Error("템플릿이 너무 큽니다");
  }
  return { snapshot, checklist: { internalLinksNeedReview: flags.cleared } };
}

export interface InstantiatedPage {
  id: string;
  slug: string;
  title: string;
  isHome: boolean;
  sortOrder: number;
  parentId: string | null;
  draft: ExpoPageConfig;
}

export interface InstantiateResult {
  theme: ExpoTheme;
  /** W1 은 템플릿에 로케일을 담지 않는다 — 새 사이트는 항상 ko 로 시작한다. */
  defaultLocale: "ko";
  pages: InstantiatedPage[];
  checklist: { internalLinksNeedReview: boolean };
}

/**
 * 기본 제공 프리셋은 DB 스냅샷이 아니다. 승인된 한 페이지 config만 복제하고,
 * 사이트·페이지 신원은 일반 템플릿과 똑같이 새로 발급한다.
 */
export function instantiateBuiltInExpoTemplate(
  presetId: string,
  input: { randomUUID?: () => string } = {},
): InstantiateResult {
  const randomUUID = input.randomUUID ?? (() => crypto.randomUUID());
  const draft = instantiateBuiltInPreset(presetId, { randomUUID });
  return {
    theme: normalizeExpoTheme({ accent: "#ff4713", lightBg: "#f4f4f4", darkBg: "#0a0a0a" }),
    defaultLocale: "ko",
    pages: [{
      id: randomUUID(),
      slug: "home",
      title: "STK 2027",
      isHome: true,
      sortOrder: 0,
      parentId: null,
      draft,
    }],
    checklist: { internalLinksNeedReview: false },
  };
}

/**
 * 템플릿에서 새 사이트를 만든다.
 *
 * **모든 식별자를 새로 발급한다** — 페이지 id, 섹션 sid. 그리고 발행 상태를 전부 끈다:
 * 새 사이트는 미발행·비공개로 시작해야 한다. 템플릿을 고른 순간 남의 전시 문구가
 * 파트너 사이트에 나가는 일은 없어야 한다.
 */
export function instantiateExpoTemplate(raw: unknown): InstantiateResult {
  const snap = obj(raw);
  const version = Number(snap.version);
  if (!Number.isFinite(version) || version < 1) throw new Error("템플릿 형식을 읽을 수 없습니다");
  // 미래 버전은 거절한다 — 모르는 필드를 무시하고 만들면 조용히 반쪽짜리 사이트가 생긴다.
  if (version > EXPO_TEMPLATE_VERSION) throw new Error("더 새로운 버전의 템플릿입니다");
  if (utf8Bytes(snap) > EXPO_LIMITS.templateSnapshotBytes) throw new Error("템플릿이 너무 큽니다");

  const rawPages = Array.isArray(snap.pages) ? snap.pages : [];
  const flags = { cleared: false };

  // key → 새 페이지 id. 링크를 풀기 전에 먼저 다 발급한다.
  const idOf = new Map<string, string>();
  const usedSlugs = new Set<string>();
  const prepared = rawPages.slice(0, EXPO_LIMITS.activePagesPerSite).map((p) => {
    const src = obj(p);
    const key = str(src.key);
    const id = crypto.randomUUID();
    if (key) idOf.set(key, id);
    return { src, key, id };
  });

  const remap = (href: string): string | null => {
    if (href.startsWith("template-page:")) {
      const id = idOf.get(href.slice("template-page:".length));
      if (!id) { flags.cleared = true; return null; }
      return `page:${id}`;
    }
    return href;
  };

  let homeTaken = false;
  const pages: InstantiatedPage[] = prepared.map(({ src, id }, i) => {
    const isHome = src.isHome === true && !homeTaken;
    if (isHome) homeTaken = true;

    const rawSections = Array.isArray(src.sections) ? src.sections : [];
    const sections: ExpoSection[] = [];
    for (const rs of rawSections) {
      const s = obj(rs);
      const def = sectionDef(str(s.type));
      if (!def) continue;                                 // 모르는 타입은 버린다
      // sid 는 여기서 **새로 발급**한다 — 옛 스니펫 URL 이 새 사이트를 가리키면 안 된다.
      const fresh = newSection(def.type);
      const design = { ...fresh.design };
      for (const [k, v] of Object.entries(obj(s.design))) {
        if ((def.design ?? {})[k]?.includes(str(v))) design[k] = str(v);
      }
      sections.push({
        ...fresh,
        variant: def.variants.some((v) => v.id === s.variant) ? str(s.variant) : fresh.variant,
        design,
        // 붙일 코드는 반드시 꺼진 채로 시작한다.
        embedEnabled: false,
        content: s.content ? mapLinks(def.slots, obj(s.content), remap, flags) : {},
      });
    }

    const slug = slugFromTitle(str(src.slug) || str(src.title), usedSlugs);
    usedSlugs.add(slug);

    return {
      id,
      slug,
      title: str(src.title) || slug,
      isHome,
      sortOrder: Number.isFinite(Number(src.sortOrder)) ? Number(src.sortOrder) : i,
      // 부모가 템플릿에 없으면 최상위로 올린다 — 고아 페이지를 만들지 않는다.
      parentId: idOf.get(str(src.parentKey)) ?? null,
      // 마지막으로 정규화를 한 번 더 태운다 — 여기 통과한 것만 저장된다.
      draft: normalizeExpoPage({ sections }),
    };
  });

  // 홈이 하나도 없으면 첫 페이지를 홈으로 — 홈 없는 사이트는 트리가 성립하지 않는다.
  if (!homeTaken && pages.length > 0) pages[0].isHome = true;

  return {
    theme: normalizeExpoTheme(snap.theme),
    defaultLocale: "ko",
    pages,
    checklist: { internalLinksNeedReview: flags.cleared },
  };
}
