/**
 * 홈페이지 설정의 **정규화** — 저장된 JSON → 화면·렌더가 믿을 수 있는 모양.
 *
 * ── 총 함수다 ─────────────────────────────────────────────────────────
 * 저장된 값은 무엇이든 올 수 있다(직접 고친 JSON, 옛 버전, 깨진 값). 그중 하나가 던지면
 * 그 페이지는 어드민에서도 공개에서도 **영영 안 열린다**. 그래서 절대 던지지 않고,
 * 모르는 것은 조용히 버린다.
 *
 * ── 신원은 지어내지 않는다 ────────────────────────────────────────────
 * 섹션 `sid` 는 섹션 단위 스니펫 URL 이 참조하는 값이다. 없는 sid 에 새 UUID 를 붙이면
 * 그 섹션이 매 로드마다 다른 것이 되어 파트너 사이트에 박힌 코드가 영영 안 맞는다.
 * 그래서 **유효하지 않으면 버리고**, 유효하면 **절대 바꾸지 않는다**.
 *
 * ── 여기서 자르는 것과 라우트가 거절하는 것은 다르다 ──────────────────
 * 이 함수의 자르기는 **이미 저장된** 값에 대한 방어다. 새로 들어오는 쓰기는 라우트가
 * 구조화된 오류로 **거절**해야 한다 — 운영자가 입력한 것을 말없이 잘라 저장하면 안 된다.
 */
import { FORM_LOCALES } from "@/lib/form-locale";
import { toLocalized, type Localized } from "@/lib/collect-form-config";
import { safeHttpUrl } from "@/lib/webinar-config";
import { normalizeHexColor } from "@/lib/color";
import { EXPO_LIMITS, resolveVariant, sectionDef } from "@/lib/expo/registry";
import { isSafePublicUrl } from "@/lib/expo/destination";
import type {
  CampaignConfig, DestinationAction, DestinationConfig, ExpoEventConfig,
  ExpoPageConfigV2, ExpoSection, ExpoTheme, SlotDef,
} from "@/lib/expo/types";
import { EXPO_V2_RULES } from "@/lib/expo/types";

/** 기본 테마 — 색이 없어 화면이 깨지는 것보다 낫다. */
export const EXPO_DEFAULT_THEME: ExpoTheme = { accent: "#1f3a5f", lightBg: "#ffffff", darkBg: "#111318" };

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && EXPO_V2_RULES.timezoneSuffix.test(value) && Number.isFinite(Date.parse(value));
const isV2Id = (value: unknown): value is string => typeof value === "string" && EXPO_V2_RULES.id.test(value);
const isAnchorOrModal = (value: unknown): value is string =>
  typeof value === "string" && EXPO_V2_RULES.anchorOrModal.test(value);

/** UUID 모양인가 — 형식만 본다(버전까지 따지면 옛 값이 통째로 날아간다). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * 구획의 신원. **검증과 정규화가 같은 판정을 써야 한다** — 두 벌이 되는 순간
 * "쓰기는 통과하는데 정규화가 버린다"(=구획이 조용히 사라진다)가 그 틈에서 되살아난다.
 */
export const isSid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** UTF-8 바이트 기준으로 자른다 — 문자 수로 자르면 한글에서 상한을 넘는다. */
function clampBytes(value: string, maxBytes: number): string {
  if (value.length <= maxBytes / 4) return value; // 최악(4바이트)이어도 안전한 구간
  const enc = new TextEncoder();
  if (enc.encode(value).length <= maxBytes) return value;
  let lo = 0, hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (enc.encode(value.slice(0, mid)).length <= maxBytes) lo = mid; else hi = mid - 1;
  }
  return value.slice(0, lo);
}

function normalizeLocalizedText(value: unknown, maxChars: number): Localized | undefined {
  const map = toLocalized(value);
  const out: Localized = {};
  for (const [locale, text] of Object.entries(map)) {
    const trimmed = str(text).slice(0, maxChars);
    if (trimmed.trim() !== "") out[locale] = trimmed;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeSlot(def: SlotDef, raw: unknown): unknown {
  switch (def.kind) {
    case "text":
      return normalizeLocalizedText(raw, EXPO_LIMITS.textChars);

    case "textarea": {
      // 줄바꿈은 보존한다 — 사용자 텍스트다(AGENTS.md 공통).
      const map = toLocalized(raw);
      const out: Localized = {};
      for (const [locale, text] of Object.entries(map)) {
        const clamped = clampBytes(str(text), EXPO_LIMITS.longTextBytes);
        if (clamped.trim() !== "") out[locale] = clamped;
      }
      return Object.keys(out).length ? out : undefined;
    }

    case "code": {
      // 로케일 맵이 아니다 — 코드에 번역은 없다.
      const code = clampBytes(str(raw), EXPO_LIMITS.longTextBytes);
      return code.trim() === "" ? undefined : code;
    }

    case "media": {
      const m = obj(raw);
      // W1 은 이미지만. 영상·YouTube 는 W2 다.
      if (m.kind !== "image") return undefined;
      const url = safeHttpUrl(m.url);
      if (!url) return undefined;
      const originalUrl = safeHttpUrl(m.originalUrl);
      const mimeType = ["image/jpeg", "image/png", "image/webp"].includes(str(m.mimeType)) ? str(m.mimeType) : "";
      const width = typeof m.width === "number" && Number.isFinite(m.width) && m.width > 0 ? m.width : undefined;
      const height = typeof m.height === "number" && Number.isFinite(m.height) && m.height > 0 ? m.height : undefined;
      const alt = str(m.alt).slice(0, EXPO_LIMITS.textChars);
      return {
        kind: "image", url,
        ...(originalUrl ? { originalUrl } : {}), ...(mimeType ? { mimeType } : {}),
        ...(width ? { width } : {}), ...(height ? { height } : {}),
        ...(alt ? { alt } : {}), ...(typeof m.decorative === "boolean" ? { decorative: m.decorative } : {}),
      };
    }

    case "link": {
      const l = obj(raw);
      const rawHref = str(l.href).trim();
      // 내부 참조는 렌더 시점에 푼다(payload.ts) — 여기서는 모양만 지킨다.
      const href = rawHref.startsWith("page:") ? rawHref.slice(0, 200) : safeHttpUrl(rawHref);
      const label = str(l.label).slice(0, EXPO_LIMITS.textChars);
      if (!label && !href) return undefined;
      const labelI18n = normalizeLocalizedText(l.labelI18n, EXPO_LIMITS.textChars);
      return { label, href, ...(labelI18n ? { labelI18n } : {}) };
    }

    case "sourceRef": {
      const id = str(raw).trim().slice(0, 64);
      return id || undefined;
    }

    case "list": {
      if (!Array.isArray(raw) || !def.itemSlots) return undefined;
      const rows: Array<Record<string, unknown>> = [];
      for (const row of raw.slice(0, EXPO_LIMITS.rowsPerList)) {
        const src = obj(row);
        const out: Record<string, unknown> = {};
        for (const slot of def.itemSlots) {
          const v = normalizeSlot(slot, src[slot.key]);
          if (v !== undefined) out[slot.key] = v;
        }
        // 필수 슬롯이 빈 행은 버린다 — 화면에 빈 카드가 생기면 고장으로 보인다.
        const missingRequired = def.itemSlots.some((s) => s.required && out[s.key] === undefined);
        if (missingRequired) continue;
        if (Object.keys(out).length === 0) continue;
        rows.push(out);
      }
      return rows.length ? rows : undefined;
    }
  }
}

function normalizeSection(raw: unknown): ExpoSection | null {
  const s = obj(raw);
  if (!isSid(s.sid)) return null;               // 신원을 지어내지 않는다
  const def = sectionDef(str(s.type));
  if (!def) return null;                        // 모르는 타입은 버린다

  let content: Record<string, unknown>;
  if (def.normalize) {
    try {
      const normalized = def.normalize(s.content, { mode: "stored" });
      if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return null;
      content = normalized;
    } catch {
      return null;
    }
  } else {
    const srcContent = obj(s.content);
    content = {};
    for (const slot of def.slots) {
      const v = normalizeSlot(slot, srcContent[slot.key]);
      if (v !== undefined) content[slot.key] = v;
    }
  }

  const design: Record<string, string> = {};
  const srcDesign = obj(s.design);
  for (const [key, allowed] of Object.entries(def.design ?? {})) {
    const v = str(srcDesign[key]);
    design[key] = allowed.includes(v) ? v : allowed[0];
  }

  return {
    sid: s.sid,
    type: def.type,
    variant: resolveVariant(def, s.variant),
    enabled: s.enabled !== false,
    // 밖으로 나가는 스위치는 **명시적으로 켠 것만** true 다.
    embedEnabled: s.embedEnabled === true,
    design,
    content,
  };
}

/**
 * 페이지 하나(draft 또는 published)를 정규화한다.
 *
 * 다중성·배치 규칙(kv 는 하나이고 맨 위, toolbox·register-form 은 하나)도 여기서 강제한다 —
 * 렌더가 그 규칙을 다시 확인하지 않아도 되게.
 */
export function normalizeCampaigns(raw: unknown): CampaignConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: CampaignConfig[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, EXPO_V2_RULES.maxRows)) {
    const source = obj(item);
    const id = str(source.id).trim();
    const label = str(source.label).trim().slice(0, EXPO_LIMITS.textChars);
    const startsAt = str(source.startsAt);
    const endsAt = str(source.endsAt);
    const override = source.override;
    if (!isV2Id(id) || !label || seen.has(id) || !isIsoTimestamp(startsAt) || !isIsoTimestamp(endsAt)
      || Date.parse(endsAt) <= Date.parse(startsAt)
      || (override !== "auto" && override !== "force-on" && override !== "force-off")
      || typeof source.enabled !== "boolean") continue;
    seen.add(id);
    out.push({ id, label, startsAt, endsAt, override, enabled: source.enabled });
  }
  return out;
}

function normalizeDestinationAction(raw: unknown): DestinationAction | null {
  const action = obj(raw);
  if (action.type === "url") {
    if (!isSafePublicUrl(action.href)) return null;
    return typeof action.newTab === "boolean" ? { type: "url", href: action.href, newTab: action.newTab } : { type: "url", href: action.href };
  }
  if (action.type === "download") {
    return isSafePublicUrl(action.href) ? { type: "download", href: action.href } : null;
  }
  if (action.type === "anchor") {
    return isAnchorOrModal(action.target) ? { type: "anchor", target: action.target } : null;
  }
  if (action.type === "imweb-modal") {
    if (!isAnchorOrModal(action.modalId)) return null;
    if (action.fallbackHref !== undefined && !isSafePublicUrl(action.fallbackHref)) return null;
    return typeof action.fallbackHref === "string"
      ? { type: "imweb-modal", modalId: action.modalId, fallbackHref: action.fallbackHref }
      : { type: "imweb-modal", modalId: action.modalId };
  }
  return null;
}

export function normalizeDestinations(raw: unknown): DestinationConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: DestinationConfig[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, EXPO_V2_RULES.maxRows)) {
    const source = obj(item);
    const id = str(source.id).trim();
    const label = str(source.label).trim().slice(0, EXPO_LIMITS.textChars);
    const action = normalizeDestinationAction(source.action);
    if (!isV2Id(id) || !label || seen.has(id) || !action || typeof source.enabled !== "boolean") continue;
    const analyticsSource = obj(source.analytics);
    const eventName = str(analyticsSource.eventName);
    const contentId = clampBytes(str(analyticsSource.contentId).trim(), 64);
    const analytics = EXPO_V2_RULES.analyticsEvent.test(eventName)
      ? { eventName, ...(contentId ? { contentId } : {}) }
      : undefined;
    seen.add(id);
    out.push({ id, label, action, ...(analytics ? { analytics } : {}), enabled: source.enabled });
  }
  return out;
}

function normalizeEvent(raw: unknown): ExpoEventConfig | undefined {
  const event = obj(raw);
  const edition = Number(event.edition);
  const startsAt = str(event.startsAt);
  const endsAt = str(event.endsAt);
  if (!Number.isInteger(edition) || edition < 1 || !isIsoTimestamp(startsAt) || !isIsoTimestamp(endsAt)
    || Date.parse(endsAt) <= Date.parse(startsAt)) return undefined;
  const factsSource = obj(event.facts);
  const facts = Object.fromEntries(
    (["companies", "sessions", "booths"] as const)
      .map((key) => [key, Number(factsSource[key])] as const)
      .filter(([, value]) => Number.isInteger(value) && value >= 0),
  );
  return { edition, startsAt, endsAt, ...(Object.keys(facts).length ? { facts } : {}) };
}

export function normalizeExpoPage(raw: unknown): ExpoPageConfigV2 {
  const src = obj(raw);
  const list = Array.isArray(src.sections) ? src.sections : [];

  const seen = new Set<string>();
  const usedSingletons = new Set<string>();
  const sections: ExpoSection[] = [];

  for (const item of list) {
    if (sections.length >= EXPO_LIMITS.sectionsPerPage) break;
    const section = normalizeSection(item);
    if (!section) continue;
    if (seen.has(section.sid)) continue;        // 중복 sid — 첫 것만
    const def = sectionDef(section.type)!;
    if (!def.multi) {
      if (usedSingletons.has(section.type)) continue;
      usedSingletons.add(section.type);
    }
    seen.add(section.sid);
    sections.push(section);
  }

  // 키비주얼은 맨 위에 온다 — 저장 순서가 어긋나 있어도 화면에서 바로잡는다.
  const pinned = sections.filter((s) => sectionDef(s.type)?.pinnedFirst);
  const rest = sections.filter((s) => !sectionDef(s.type)?.pinnedFirst);
  const settingsRaw = obj(src.settings);
  const event = normalizeEvent(settingsRaw.event);
  const campaigns = normalizeCampaigns(settingsRaw.campaigns);
  const destinations = normalizeDestinations(settingsRaw.destinations);
  const settings = {
    ...(event ? { event } : {}),
    ...(campaigns.length ? { campaigns } : {}),
    ...(destinations.length ? { destinations } : {}),
  };
  const preset = typeof src.preset === "string" && src.preset.trim()
    ? clampBytes(src.preset.trim(), 128)
    : undefined;
  const locales = FORM_LOCALES.map(({ code }) => code).filter((code) =>
    Array.isArray(src.locales) && src.locales.includes(code),
  );
  return {
    schemaVersion: 2,
    ...(locales.length ? { locales } : {}),
    ...(preset ? { preset } : {}),
    ...(Object.keys(settings).length ? { settings } : {}),
    sections: [...pinned, ...rest],
  };
}

export function normalizeExpoTheme(raw: unknown): ExpoTheme {
  const t = obj(raw);
  return {
    accent: normalizeHexColor(str(t.accent)) ?? EXPO_DEFAULT_THEME.accent,
    lightBg: normalizeHexColor(str(t.lightBg)) ?? EXPO_DEFAULT_THEME.lightBg,
    darkBg: normalizeHexColor(str(t.darkBg)) ?? EXPO_DEFAULT_THEME.darkBg,
  };
}

/**
 * 편집기가 섹션을 새로 추가할 때. **여기서만** sid 를 발급한다
 * (템플릿 인스턴스화도 이 함수를 쓴다).
 */
export function newSection(type: string): ExpoSection {
  const def = sectionDef(type);
  if (!def) throw new Error(`알 수 없는 섹션 타입: ${type}`);
  const design: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(def.design ?? {})) design[key] = allowed[0];
  return {
    sid: crypto.randomUUID(),
    type: def.type,
    variant: def.variants[0].id,
    enabled: true,
    // 붙일 코드는 따로 켠다 — 만들자마자 밖으로 나가면 안 된다.
    embedEnabled: false,
    design,
    content: {},
  };
}
