/**
 * 슬롯 모양을 미리 알 수 없는 section plugin의 JSON content를 걷는 순수 함수들.
 * 문자열 안쪽은 절대 검색하지 않으므로 custom code에 적힌 URL은 미디어로 오인하지 않는다.
 */
import { localize, type Localized } from "@/lib/collect-form-config";

const LOCALE_KEY = /^[a-z]{2}(-[A-Z]{2})?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function isLocalized(value: unknown): value is Localized {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0
    && entries.every(([key, item]) => LOCALE_KEY.test(key) && typeof item === "string");
}

export function resolveLocalizedText(value: Localized, locale: string, fallback?: string): string {
  const own = (code: string) => Object.hasOwn(value, code) ? value[code] : undefined;
  return own(locale) || (fallback && own(fallback)) || localize(value, locale);
}

/** 로케일 맵만 문자열로 고르고 배열·미디어·crop·design 등 나머지 JSON 모양은 보존한다. */
export function resolvePluginContent(value: unknown, locale: string, fallback?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => resolvePluginContent(item, locale, fallback));
  if (!isRecord(value)) return value;
  if (isLocalized(value)) return resolveLocalizedText(value, locale, fallback);

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const resolved = resolvePluginContent(item, locale, fallback);
    if (resolved !== undefined && typeof resolved !== "function" && typeof resolved !== "symbol") {
      out[key] = resolved;
    }
  }
  return out;
}

const isMedia = (value: Record<string, unknown>): boolean =>
  value.kind === "image" || value.kind === "video";

/** image/video 객체의 url·originalUrl과 그 안쪽 poster 이미지를 중복 없이 모은다. */
export function collectPluginMediaUrls(content: unknown): string[] {
  const seen = new Set<string>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isRecord(value)) return;

    if (isMedia(value)) {
      for (const key of ["url", "originalUrl"] as const) {
        if (typeof value[key] === "string" && value[key]) seen.add(value[key]);
      }
    }
    for (const item of Object.values(value)) walk(item);
  };

  walk(content);
  return [...seen];
}

/** 주소표에 있는 media URL 필드만 바꾸며, code를 포함한 일반 문자열은 그대로 둔다. */
export function rewritePluginMediaUrls<T>(content: T, map: ReadonlyMap<string, string>): T {
  if (map.size === 0) return content;

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!isRecord(value)) return value;

    const out: Record<string, unknown> = {};
    const media = isMedia(value);
    for (const [key, item] of Object.entries(value)) {
      if (media && (key === "url" || key === "originalUrl") && typeof item === "string") {
        out[key] = map.get(item) ?? item;
      } else {
        out[key] = walk(item);
      }
    }
    return out;
  };

  return walk(content) as T;
}
