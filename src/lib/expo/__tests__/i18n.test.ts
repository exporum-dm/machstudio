import { expect, it } from "vitest";
import { buildExpoPayload } from "@/lib/expo/payload";
import { normalizeExpoPage } from "@/lib/expo/config";
import { expoContentLocales, expoTranslationEntries } from "@/lib/expo/i18n";

it("edits translations in the original section and preserves unpublished language tabs", () => {
  const draft = normalizeExpoPage({
    locales: ["ja", "fr"], sections: [{
      sid: "11111111-1111-1111-1111-111111111111", type: "cardgrid", enabled: true,
      content: { items: [{ title: { ko: "First" } }, { title: { ko: "Second" } }] },
    }],
  });
  const [section] = draft.sections;
  const entries = expoTranslationEntries(section, "ko", "ja");
  expect(entries.map(({ base }) => base)).toEqual(["First", "Second"]);
  const translated = entries[1].write(entries[0].write(section, "First JA"), "Second JA");
  const saved = normalizeExpoPage({ ...draft, sections: [translated] });
  expect(saved.locales).toEqual(["ja", "fr"]);
  expect(saved.sections[0].sid).toBe(section.sid);
  expect(saved.sections[0].content.items).toEqual([
    { title: { ko: "First", ja: "First JA" } }, { title: { ko: "Second", ja: "Second JA" } },
  ]);
  expect(expoContentLocales(saved.sections, "ko")).toEqual(["ko", "ja"]);
});

it("translates the legacy hero button label without changing its destination", () => {
  const draft = normalizeExpoPage({ sections: [{
    sid: "11111111-1111-1111-1111-111111111111", type: "kv", enabled: true,
    content: { title: { ko: "Title" }, cta: { label: "Register", href: "https://example.com/event" } },
  }] });
  const [section] = draft.sections;
  const entry = expoTranslationEntries(section, "ko", "ja").find(({ id }) => id === "cta.labelI18n");
  expect(entry?.base).toBe("Register");
  const saved = normalizeExpoPage({ ...draft, sections: [entry!.write(section, "Register JA")] });
  const context = { defaultLocale: "ko", pages: [], now: new Date() };
  expect(buildExpoPayload(saved, { ...context, locale: "ja" }).sections[0].content.cta)
    .toEqual({ label: "Register JA", href: "https://example.com/event" });
  expect(buildExpoPayload(saved, { ...context, locale: "fr" }).sections[0].content.cta)
    .toEqual({ label: "Register", href: "https://example.com/event" });
});
