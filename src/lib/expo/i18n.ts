import { localize } from "@/lib/collect-form-config";
import { FORM_LOCALES, normalizeLocaleTag } from "@/lib/form-locale";
import { isLocalized } from "./plugin-content";
import { sectionDef } from "./registry";
import type { ExpoSection, SlotDef } from "./types";
import type { TranslationEntry } from "@/lib/translation-entry";

type Path = Array<string | number>;

function visitLocalized(value: unknown, visit: (value: Record<string, string>, path: Path) => void, path: Path = []) {
  if (isLocalized(value) && Object.keys(value).some(normalizeLocaleTag)) visit(value, path);
  else if (Array.isArray(value)) value.forEach((item, index) => visitLocalized(item, visit, [...path, index]));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) visitLocalized(child, visit, [...path, key]);
  }
}

export function expoContentLocales(sections: ExpoSection[], fallback: string): string[] {
  const found = new Set<string>([fallback]);
  for (const section of sections) {
    visitLocalized(section.content, (map) => {
      for (const { code } of FORM_LOCALES) if (map[code]?.trim()) found.add(code);
    });
  }
  return [...found];
}

function replaceValue(value: unknown, [key, ...rest]: Path, next: unknown): unknown {
  if (key === undefined) return next;
  if (Array.isArray(value)) return value.map((item, index) => index === key ? replaceValue(item, rest, next) : item);
  const record = value as Record<string, unknown>;
  return { ...record, [key]: replaceValue(record[key], rest, next) };
}

function visitLinkLabels(
  slots: readonly SlotDef[],
  content: Record<string, unknown>,
  visit: (map: Record<string, string>, path: Path, original: string) => void,
  path: Path = [],
) {
  for (const slot of slots) {
    const value = content[slot.key];
    const next = [...path, slot.key];
    if (slot.kind === "link" && value && typeof value === "object" && !Array.isArray(value)) {
      const link = value as Record<string, unknown>;
      if (typeof link.label === "string") {
        visit(isLocalized(link.labelI18n) ? link.labelI18n : {}, [...next, "labelI18n"], link.label);
      }
    } else if (slot.kind === "list" && Array.isArray(value) && slot.itemSlots) {
      value.forEach((row, index) => visitLinkLabels(slot.itemSlots!, row, visit, [...next, index]));
    }
  }
}

export function expoTranslationEntries(section: ExpoSection, baseLocale: string, locale: string): TranslationEntry<ExpoSection>[] {
  const entries: TranslationEntry<ExpoSection>[] = [];
  const def = sectionDef(section.type);
  const add = (map: Record<string, string>, path: Path, original?: string) => {
    if (section.type === "campaign-hero" && path[0] === "accessibleHeadline") return;
    const base = original ?? (map[baseLocale] || localize(map, baseLocale));
    if (!base.trim()) return;
    let slots = def?.slots;
    const label = path.map((part) => {
      if (typeof part === "number") return String(part + 1);
      const slot = slots?.find(({ key }) => key === part);
      slots = slot?.itemSlots;
      return slot?.label ?? ({
        labelI18n: "문구", eyebrow: "윗줄", typingLines: "전환 문구", accessibleHeadline: "접근성 제목",
        heading: "제목", headline: "제목", title: "제목", description: "설명",
        items: "항목", groups: "그룹", speakers: "연사", categories: "분류",
        ctas: "버튼", label: "이름", name: "이름", company: "소속", role: "직책",
      } as Record<string, string>)[part] ?? part;
    }).join(" · ");
    entries.push({
      id: path.join("."),
      group: def?.label ?? section.type,
      context: label,
      base,
      value: map[locale] ?? "",
      multiline: base.includes("\n") || path.at(-1) === "body" || path.at(-1) === "description",
      write: (current, text) => {
        const next = { ...map };
        if (text.trim()) next[locale] = text;
        else delete next[locale];
        return { ...current, content: replaceValue(current.content, path, next) as ExpoSection["content"] };
      },
    });
  };
  visitLocalized(section.content, (map, path) => {
    if (path.at(-1) !== "labelI18n") add(map, path);
  });
  if (def && !def.normalize) visitLinkLabels(def.slots, section.content, add);
  return entries;
}
