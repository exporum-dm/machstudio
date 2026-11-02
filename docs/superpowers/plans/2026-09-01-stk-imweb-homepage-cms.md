# STK Imweb Homepage CMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `using-git-worktrees`, then `subagent-driven-development` (recommended) or `executing-plans`, and apply `test-driven-development`, `requesting-code-review`, and `verification-before-completion` task by task. Track every step with checkbox (`- [ ]`) syntax. Read this whole plan, repository `AGENTS.md`, and the approved design before editing code.

**Goal:** Extend Mach Studio's generic Expo homepage builder so an STK Project EDITOR can edit, preview, publish, roll back, and export the six managed sections of `https://smarttechkorea.com/214` without hand-editing HTML.

**Architecture:** Keep `ExpoPage.draft` and `published` as one normalized V2 snapshot containing event settings, two independent campaigns, shared destinations, and stable-id section data. Pure React-free section plugins feed both the Shadow DOM runtime and standalone exporter; client-only editor plugins provide the STK three-column editing experience. Add project-scoped authorization, transactional immutable revisions, server-resolved campaign state, staged remounting, and a DB-free browser harness before any progressive Imweb cutover.

**Tech Stack:** Next.js 16.2.6 App Router, React 19.2.4, TypeScript 5, Prisma 7.8/PostgreSQL, Supabase Storage, Sharp 0.34, esbuild, Vitest/jsdom, Playwright 1.51.1 Chromium/WebKit, Shadow DOM, XML DOM parsing for SVG validation

## Global Constraints

- Implement only in `<repo>/.worktrees/stk-homepage-cms-design` on `codex/stk-homepage-cms-design`; do not touch the stale root checkout or its untracked files.
- The approved design is `docs/superpowers/specs/2026-09-01-stk-imweb-homepage-cms-design.md`; changes to its product decisions require user approval before implementation.
- Initial content scope is the STK main page `/214` only. The engine remains generic; the STK-specific behavior lives in the `stk-home-v1` preset and six plugins.
- Mach owns Hero, six exhibitions, For Exhibitors/For Visitors, Speakers, Sponsors & Partners, and Final CTA. Header/navigation, TechCon highlight, newsroom Board, Stibee newsletter, footer, and Channel Talk remain native Imweb content.
- Do not log into Imweb, edit `/214`, publish an Imweb page, or hide/delete an existing widget during code implementation. Public cutover is a separately authorized operational stage.
- Do not start `next dev`, `next start`, Vercel dev, or any process capable of reading the shared database until the user confirms a no-live-broadcast window and the database target has been checked. Task 15's harness is the only exception: it must override `DATABASE_URL` with the intentionally unreachable value in that task and expose only DB-free development routes.
- Never run `prisma db push`, `prisma migrate dev`, `prisma migrate deploy`, or unchecked SQL. Database application requires separate approval; this plan only creates checked additive SQL.
- Do not guess campaign dates, destination URLs, Imweb modal IDs, analytics IDs, Hero video rights, or sponsor logos. Drafts may be incomplete. Missing operational destinations/media/required values make publish readiness and export fail with structured field errors. Unconfirmed Hero video rights remain a non-blocking editor warning per the approved design, but the operational cutover runbook independently blocks launch until confirmation is recorded.
- A Mach publish response is not public completion. Completion requires real `/214` DOM, Network, CTA, mobile, connection, and rollback verification.
- Keep `EXPO_PUBLIC_EMBED_RELEASE` unchanged during implementation. A schema deployment and a public-embed launch are separate gates.
- Preserve page and section snippets already installed by stable `pageId` and `sid`; sorting, publish, rollback, and preset edits must never regenerate a valid `sid`.
- Build absolute snippet URLs only through `getPublicAppOrigin()`; never persist a Vercel preview origin into Imweb code.
- Authorize every route from the URL-addressed page/site/project relation. Never use the sidebar's current project as an ownership source.
- The shared section registry and embed runtime must remain React-free. React components live only under `src/components/expo/section-editors/`.
- Render public text with `h()`/`textContent`; do not add `innerHTML`. URL, anchor, modal, SVG, video, and download inputs use explicit allowlists.
- Edit `src/lib/expo/expo-shell.css`, `src/embed/expo-entry.ts`, and source TypeScript only. Regenerate `src/lib/expo/shell-css.ts` and `src/generated/expo-runtime.ts`; never hand-edit generated files.
- Keep the existing 900ms autosave CAS behavior. A `409` conflict stops autosave and asks the user to reload; it never silently merges or overwrites.
- Keep existing W1 generic section types and templates working. V1 `{ sections }` snapshots are normalized in memory to V2; do not bulk backfill them.
- Existing lint errors are not a release gate until separately cleaned. Run lint for visibility and report its exact pre-existing/new error delta; do not claim lint passes unless it actually does.

---

## Freshness, documentation, and safety preflight

Before Task 1:

- [ ] Confirm `git rev-parse HEAD` contains the approved design commit `8488e6c` and `git merge-base --is-ancestor 671e7e9 HEAD` succeeds.
- [ ] Confirm `git status --short` is empty. Stop if unrelated changes are present.
- [ ] Run `npm ci` only if dependencies are absent; this is filesystem-only and must not start the app.
- [ ] Read the installed Next 16 route-handler, Server/Client boundary, caching, dynamic-route, public-folder, and response-header documentation before changing a route. If the npm package omits local docs, use the exact installed-version official documentation and record the URLs in the execution log.
- [ ] Run the DB-free baseline:

```bash
npx prisma generate
npx tsc --noEmit -p tsconfig.json
npx vitest run --exclude '.worktrees/**' src
```

Expected: Prisma generation, typecheck, and the current Vitest suite pass. Record any pre-existing failure verbatim and stop rather than building on an unknown baseline.

## Canonical contracts

The following names and rules are shared by every task. Do not rename them in a later task.

```ts
export type CampaignOverride = "auto" | "force-on" | "force-off";
export type AudienceId = "all" | "exhibitor" | "visitor";
export type CampaignPreviewMode = "current" | "exhibitor" | "visitor" | "both" | "ended";

export interface CampaignConfig {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  override: CampaignOverride;
  enabled: boolean;
}

export type DestinationAction =
  | { type: "url"; href: string; newTab?: boolean }
  | { type: "anchor"; target: string }
  | { type: "download"; href: string }
  | { type: "imweb-modal"; modalId: string; fallbackHref?: string };

export interface DestinationConfig {
  id: string;
  label: string;
  action: DestinationAction;
  analytics?: { eventName: string; contentId?: string };
  enabled: boolean;
}

export interface ExpoEventConfig {
  edition: number;
  startsAt: string;
  endsAt: string;
  facts?: { companies?: number; sessions?: number; booths?: number };
}

export interface ExpoPageConfigV2 {
  schemaVersion: 2;
  preset?: string;
  settings?: {
    event?: ExpoEventConfig;
    campaigns?: CampaignConfig[];
    destinations?: DestinationConfig[];
  };
  sections: ExpoSection[];
}

export type ExpoPageConfig = ExpoPageConfigV2;

export interface ResolvedCampaignState {
  id: string;
  label: string;
  active: boolean;
}

export interface ResolvedDestination {
  id: string;
  label: string;
  action: DestinationAction;
  analytics?: { eventName: string; contentId?: string };
}

export type IssueSeverity = "error" | "warning";

export interface FieldIssue {
  path: string;
  code: string;
  message: string;
  severity: IssueSeverity;
  sid?: string;
}
```

Validation constants:

```ts
export const EXPO_V2_RULES = {
  id: /^[a-z][a-z0-9-]{0,63}$/,
  anchorOrModal: /^[A-Za-z][A-Za-z0-9_-]{0,127}$/,
  analyticsEvent: /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
  timezoneSuffix: /(Z|[+-]\d{2}:\d{2})$/,
  maxRows: 100,
  maxVisibleCtas: 2,
} as const;
```

Campaign priority is exactly `enabled=false` → `force-on` → `force-off` → `startsAt <= now < endsAt`. URL/download/video/fallback URLs are public HTTPS, contain no username/password, and fail `isPrivateHostname` checks. Anchor/modal values omit `#` and match `anchorOrModal`.

## File map

**V2 data, campaigns, destinations, validation**

- Modify: `src/lib/expo/types.ts`, `src/lib/expo/config.ts`, `src/lib/expo/request.ts`, `src/lib/expo/payload.ts`, `src/lib/expo/model.ts`, `src/lib/expo/readiness.ts`, `src/lib/expo/site-service.ts`, `src/lib/expo/registry.ts`
- Create: `src/lib/expo/campaign.ts`, `src/lib/expo/destination.ts`, `src/lib/expo/cta.ts`, `src/lib/expo/snapshot-digest.ts`, `src/lib/expo/plugin-content.ts`
- Test: `src/lib/expo/__tests__/campaign.test.ts`, `src/lib/expo/__tests__/destination.test.ts`, `src/lib/expo/__tests__/cta.test.ts`, `src/lib/expo/__tests__/section-plugin.test.ts`, `src/lib/expo/__tests__/config.test.ts`, `src/lib/expo/__tests__/request.test.ts`, `src/lib/expo/__tests__/payload.test.ts`, `src/lib/expo/__tests__/model.test.ts`, `src/lib/expo/__tests__/readiness.test.ts`, `src/lib/expo/__tests__/site-service.test.ts`

**Authorization, revisions, schema**

- Modify: `src/lib/expo/auth.ts`, `src/lib/expo/permissions.ts`, `src/lib/expo/route-guard.ts`, `src/lib/expo/capability.ts`, `src/lib/expo/schema-probe.ts`, `prisma/schema.prisma`, `scripts/check-expo-schema.mjs`
- Create: `scripts/verify-expo-db-target.mjs`, `scripts/audit-expo-public-embeds.mjs`
- Create: `src/lib/expo/revision-service.ts`, `src/lib/expo/snapshot-digest.ts`, `supabase/migrations/20260901000000_expo_page_revisions.sql`
- Create routes: `src/app/api/expo/pages/[pageId]/revisions/route.ts`, `src/app/api/expo/pages/[pageId]/revisions/[revisionId]/rollback/route.ts`
- Modify: `src/app/api/expo/route.ts`, `src/app/api/expo/[siteId]/route.ts`, `src/app/api/expo/[siteId]/pages/route.ts`, `src/app/api/expo/[siteId]/media/route.ts`, `src/app/api/expo/[siteId]/regenerate-preview-token/route.ts`, `src/app/api/expo/pages/[pageId]/route.ts`, `src/app/api/expo/pages/[pageId]/publish/route.ts`, `src/app/api/expo/pages/[pageId]/live/route.ts`, `src/app/api/expo/templates/route.ts`, `src/app/api/expo/templates/[templateId]/route.ts`, `src/app/api/expo/templates/[templateId]/instantiate/route.ts`, `src/app/(app)/homepage/[siteId]/page.tsx`

**Six STK plugins and runtime**

- Create: `src/lib/expo/sections/types.ts`, `src/lib/expo/sections/campaign-hero.ts`, `src/lib/expo/sections/exhibition-grid.ts`, `src/lib/expo/sections/audience-links.ts`, `src/lib/expo/sections/speaker-carousel.ts`, `src/lib/expo/sections/sponsor-marquee.ts`, `src/lib/expo/sections/cta-band.ts`
- Create tests: `src/lib/expo/sections/__tests__/campaign-hero.test.ts`, `src/lib/expo/sections/__tests__/exhibition-grid.test.ts`, `src/lib/expo/sections/__tests__/audience-links.test.ts`, `src/lib/expo/sections/__tests__/speaker-carousel.test.ts`, `src/lib/expo/sections/__tests__/sponsor-marquee.test.ts`, `src/lib/expo/sections/__tests__/cta-band.test.ts`
- Create: `src/lib/expo/renderers/action.ts`, `src/lib/expo/renderers/image.ts`, `src/lib/expo/renderers/campaign-hero.ts`, `src/lib/expo/renderers/exhibition-grid.ts`, `src/lib/expo/renderers/audience-links.ts`, `src/lib/expo/renderers/speaker-carousel.ts`, `src/lib/expo/renderers/sponsor-marquee.ts`, `src/lib/expo/renderers/cta-band.ts`
- Modify: `src/lib/expo/view-sections.ts`, `src/lib/expo/view-page.ts`, `src/lib/expo/mount.ts`, `src/lib/expo/shadow.ts`, `src/lib/expo/expo-shell.css`, `src/embed/expo-entry.ts`
- Regenerate `src/lib/expo/shell-css.ts`, `src/generated/expo-runtime.ts`

**Media**

- Modify: `src/lib/expo/image-guard.ts`, `src/lib/expo/media.ts`, `src/app/api/expo/[siteId]/media/route.ts`, `src/components/expo/SlotField.tsx`
- Create: `src/lib/expo/image-process.ts`, `src/lib/expo/svg-guard.ts`, `src/lib/expo/video-guard.ts`, `src/lib/expo/media-upload-session.ts`, `src/lib/expo/quarantine-bucket.ts`, `scripts/ensure-expo-quarantine-bucket.mjs`, `src/app/api/expo/[siteId]/media/session/route.ts`, `src/app/api/expo/[siteId]/media/finalize/route.ts`, `src/components/expo/fields/ExpoMediaUploadField.tsx`, `src/components/expo/fields/ImageCropField.tsx`
- Modify: `package.json`, `package-lock.json` to add `@xmldom/xmldom`, Testing Library, jest-dom, and Playwright test dependencies; modify `vitest.config.ts`; create `vitest.setup.ts`

**Preset and editor**

- Create: `src/lib/expo/presets/stk-home-v1.json`, `src/lib/expo/presets/stk-home-v1.ts`, `src/lib/expo/presets/index.ts`, `scripts/import-stk-home-v1.mjs`
- Create: `src/lib/expo/editor-dto.ts`, `src/lib/expo/use-page-draft.ts`, `src/components/expo/PageDraftWorkspace.tsx`, `src/components/expo/ExpoSectionTree.tsx`, `src/components/expo/ExpoPageSettings.tsx`, `src/components/expo/ExpoRevisionPanel.tsx`
- Create shared fields: `src/components/expo/fields/InlineEditableTable.tsx`, `src/components/expo/fields/DestinationPicker.tsx`, `src/components/expo/fields/CampaignPicker.tsx`, `src/components/expo/fields/ExpoMediaUploadField.tsx`, `src/components/expo/fields/ImageCropField.tsx`
- Create section editors: `src/components/expo/section-editors/CampaignHeroEditor.tsx`, `src/components/expo/section-editors/ExhibitionGridEditor.tsx`, `src/components/expo/section-editors/AudienceLinksEditor.tsx`, `src/components/expo/section-editors/SpeakerCarouselEditor.tsx`, `src/components/expo/section-editors/SponsorMarqueeEditor.tsx`, `src/components/expo/section-editors/CtaBandEditor.tsx`, `src/components/expo/section-editors/registry.tsx`
- Modify: `src/components/expo/ExpoSiteEditor.tsx`, `src/components/expo/SectionEditor.tsx`, `src/components/expo/ExpoPublishPanel.tsx`, `src/components/expo/ExpoCreateChoices.tsx`, `src/lib/expo/template.ts`, `src/lib/expo/template-service.ts`, `src/app/api/expo/templates/route.ts`, `src/app/api/expo/templates/[templateId]/instantiate/route.ts`

**Dynamic loader, export, browser QA**

- Modify `src/app/h/[pageId]/loader.ts`, `src/app/h/[pageId]/route.ts`, `src/app/h/[pageId]/[sid]/route.ts`, `src/app/hp/[token]/route.ts`
- Create: `src/lib/expo/connection-status.ts`, `src/lib/expo/export.ts`, `src/app/api/expo/pages/[pageId]/export/route.ts`
- Modify: `src/app/dev/expo-hostile-harness/route.ts`, `src/app/dev/expo-sections-harness/page.tsx`
- Create: `src/app/dev/expo-stk-runtime-harness/route.ts`, `src/app/dev/expo-stk-editor-harness/page.tsx`, `src/app/dev/expo-standalone-harness/route.ts`, `playwright.config.ts`, `tests/expo-browser/stk-runtime.spec.ts`, `tests/expo-browser/stk-editor.spec.ts`, `tests/expo-browser/stk-export.spec.ts`
- Modify: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`

---

### Task 1: Introduce V2 config, campaign, destination, and server resolution

**Files:**

- Modify: `src/lib/expo/types.ts`
- Modify: `src/lib/expo/config.ts`
- Modify: `src/lib/expo/request.ts`
- Modify: `src/lib/expo/model.ts`
- Modify: `src/lib/expo/site-service.ts`
- Modify: `src/lib/expo/payload.ts`
- Modify: `src/app/h/[pageId]/loader.ts`
- Modify: `src/app/hp/[token]/route.ts`
- Modify: `src/app/dev/expo-hostile-harness/route.ts`
- Create: `src/lib/expo/campaign.ts`
- Create: `src/lib/expo/destination.ts`
- Test: `src/lib/expo/__tests__/config.test.ts`
- Test: `src/lib/expo/__tests__/campaign.test.ts`
- Test: `src/lib/expo/__tests__/destination.test.ts`
- Test: `src/lib/expo/__tests__/request.test.ts`
- Test: `src/lib/expo/__tests__/payload.test.ts`
- Test: `src/lib/expo/__tests__/row-key.test.ts`
- Test: `src/lib/expo/__tests__/model.test.ts`
- Test: `src/lib/expo/__tests__/site-service.test.ts`
- Test: `src/app/h/__tests__/loader.test.ts`
- Test: `src/app/hp/__tests__/preview.test.ts`

**Interfaces:**

- Produces: `ExpoPageConfigV2`, `normalizeExpoPage(raw): ExpoPageConfigV2`, `resolveCampaignStates(campaigns, now, forced?)`, `resolveDestinations(destinations)`, and `buildExpoPayload(config, ctx)`.
- Preserves: legacy W1 section normalization and `ExpoSection.sid` identity.

- [ ] **Step 1: Write the failing V1 compatibility and campaign tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizeExpoPage } from "@/lib/expo/config";
import { isCampaignActive, resolveCampaignStates } from "@/lib/expo/campaign";

const campaign = {
  id: "exhibitor-recruitment",
  label: "참가기업 모집",
  startsAt: "2027-01-01T00:00:00+09:00",
  endsAt: "2027-06-01T00:00:00+09:00",
  override: "auto" as const,
  enabled: true,
};

describe("Expo V2 campaign contract", () => {
  it("promotes legacy page config without changing sid", () => {
    const sid = "11111111-1111-1111-1111-111111111111";
    const page = normalizeExpoPage({ sections: [{ sid, type: "textblock", variant: "plain", enabled: true, embedEnabled: false, design: {}, content: {} }] });
    expect(page.schemaVersion).toBe(2);
    expect(page.sections[0]?.sid).toBe(sid);
  });

  it("uses a half-open schedule interval", () => {
    expect(isCampaignActive(campaign, new Date("2026-12-31T15:00:00.000Z"))).toBe(true);
    expect(isCampaignActive(campaign, new Date("2027-05-31T15:00:00.000Z"))).toBe(false);
  });

  it("lets preview forcing override auto without mutating config", () => {
    const states = resolveCampaignStates([campaign], new Date("2028-01-01T00:00:00.000Z"), { "exhibitor-recruitment": true });
    expect(states).toEqual([{ id: "exhibitor-recruitment", label: "참가기업 모집", active: true }]);
    expect(campaign.override).toBe("auto");
  });

  it("never force-enables a disabled campaign", () => {
    const disabled = { ...campaign, enabled: false };
    expect(resolveCampaignStates([disabled], new Date("2027-02-01T00:00:00.000Z"), { "exhibitor-recruitment": true })[0]?.active).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
npx vitest run src/lib/expo/__tests__/config.test.ts src/lib/expo/__tests__/campaign.test.ts src/lib/expo/__tests__/destination.test.ts src/lib/expo/__tests__/request.test.ts src/lib/expo/__tests__/payload.test.ts src/lib/expo/__tests__/model.test.ts src/lib/expo/__tests__/site-service.test.ts
```

Expected: failures name the missing V2 types/functions and legacy normalization still returns `{ sections }`.

- [ ] **Step 3: Implement total read normalization and strict write validation**

Use the canonical types above and implement these signatures:

```ts
export function normalizeCampaigns(raw: unknown): CampaignConfig[];
export function normalizeDestinations(raw: unknown): DestinationConfig[];
export function normalizeExpoPage(raw: unknown): ExpoPageConfigV2;

export function isCampaignActive(campaign: CampaignConfig, now: Date): boolean {
  if (!campaign.enabled) return false;
  if (campaign.override === "force-on") return true;
  if (campaign.override === "force-off") return false;
  const timestamp = now.getTime();
  return timestamp >= Date.parse(campaign.startsAt) && timestamp < Date.parse(campaign.endsAt);
}

export function resolveCampaignStates(
  campaigns: readonly CampaignConfig[],
  now: Date,
  forced: Readonly<Record<string, boolean>> = {},
): ResolvedCampaignState[] {
  return campaigns.map((campaign) => ({
    id: campaign.id,
    label: campaign.label,
    active: campaign.enabled
      && (Object.hasOwn(forced, campaign.id) ? forced[campaign.id] === true : isCampaignActive(campaign, now)),
  }));
}
```

Structural draft validation rejects unknown schema versions, invalid shapes, duplicate IDs, bad ISO timestamps, list/byte limits, unsafe destination actions, and `endsAt <= startsAt` with exact paths such as `settings.campaigns[1].endsAt`. It allows structurally valid but incomplete draft references; missing destinations/media are publish-readiness errors in Task 7, so a half-written preset remains autosaveable.

Use `isSafePublicUrl(value)`, require `https:`, reject `url.username`/`url.password`, and apply the canonical regexes. Public payload accepts the whole config:

```ts
export interface ResolveContext {
  locale: string;
  pages: LinkTarget[];
  now: Date;
  forcedCampaigns?: Readonly<Record<string, boolean>>;
}

export interface ResolvedPayload {
  event?: ExpoEventConfig;
  campaigns: ResolvedCampaignState[];
  destinations: ResolvedDestination[];
  sections: Array<Record<string, unknown>>;
  issues: PayloadIssue[];
}

export function buildExpoPayload(config: ExpoPageConfigV2, ctx: ResolveContext): ResolvedPayload;
```

The public payload includes only `{ id, label, active }` campaign values; it never includes `startsAt`, `endsAt`, or `override`.

- [ ] **Step 4: Update every current payload caller and pass the focused suite**

New pages, templates, writes, and publishes must create `{ schemaVersion: 2, sections: [] }`. Migrate every current `buildExpoPayload(` call in the live loader, preview route, hostile harness, payload tests, and row-key tests to pass a normalized full config plus `now`; preserve the existing same-project `sourceRef` filtering in both live and preview while doing so. Do not leave a temporary legacy overload. Update fixtures rather than weakening types, and use the `rg` result below as the exhaustive call-site gate.

```bash
rg -n "buildExpoPayload\\(" src
npx vitest run src/lib/expo/__tests__/config.test.ts src/lib/expo/__tests__/campaign.test.ts src/lib/expo/__tests__/destination.test.ts src/lib/expo/__tests__/request.test.ts src/lib/expo/__tests__/payload.test.ts src/lib/expo/__tests__/row-key.test.ts src/lib/expo/__tests__/model.test.ts src/lib/expo/__tests__/site-service.test.ts src/app/h/__tests__/loader.test.ts src/app/hp/__tests__/preview.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/expo src/app/h src/app/hp src/app/dev/expo-hostile-harness/route.ts
git commit -m "feat: add Expo page config v2 and campaigns"
```

### Task 2: Wire project-scoped read, edit, publish, and admin permissions

**Files:**

- Modify: `src/lib/expo/auth.ts`
- Modify: `src/lib/expo/permissions.ts`
- Modify: `src/lib/expo/route-guard.ts`
- Modify: `src/app/api/expo/route.ts`
- Modify: `src/app/api/expo/[siteId]/route.ts`
- Modify: `src/app/api/expo/[siteId]/pages/route.ts`
- Modify: `src/app/api/expo/[siteId]/media/route.ts`
- Modify: `src/app/api/expo/[siteId]/regenerate-preview-token/route.ts`
- Modify: `src/app/api/expo/pages/[pageId]/route.ts`
- Modify: `src/app/api/expo/pages/[pageId]/publish/route.ts`
- Modify: `src/app/api/expo/pages/[pageId]/live/route.ts`
- Modify: `src/app/api/expo/templates/route.ts`
- Modify: `src/app/api/expo/templates/[templateId]/route.ts`
- Modify: `src/app/api/expo/templates/[templateId]/instantiate/route.ts`
- Modify: `src/app/(app)/homepage/[siteId]/page.tsx`
- Test: `src/lib/expo/__tests__/auth.test.ts`
- Create: `src/lib/expo/__tests__/permissions.test.ts`
- Modify: `src/app/api/expo/__tests__/routes.test.ts`
- Modify: `src/app/api/expo/__tests__/template-routes.test.ts`

**Interfaces:**

- Produces: `ProjectRole`, `canAccessExpoProject`, `deriveExpoPermissions(workspaceRole, projectRole)`, and `ExpoRouteContext.projectRole(projectId)`.
- Consumes: URL-addressed `ExpoSite.projectId` and `ExpoPage.site.projectId`; never a client-provided project id.

- [ ] **Step 1: Write the full permission matrix as failing tests**

```ts
import { describe, expect, it } from "vitest";
import { canAccessExpoProject, deriveExpoPermissions } from "@/lib/expo/permissions";

describe("Expo project permissions", () => {
  it.each([
    ["OWNER", null, true, true, true, true],
    ["ADMIN", null, true, true, true, true],
    ["MEMBER", "ADMIN", true, true, true, false],
    ["MEMBER", "EDITOR", true, true, false, false],
    ["MEMBER", "VIEWER", false, false, false, false],
    ["MEMBER", null, false, false, false, false],
  ] as const)("maps %s/%s", (workspaceRole, projectRole, canEdit, canPublish, canManageSite, canManageTemplates) => {
    expect(deriveExpoPermissions(workspaceRole, projectRole)).toEqual({ canEdit, canPublish, canManageSite, canManageTemplates });
  });

  it("hides an unassigned project from a workspace member", () => {
    expect(canAccessExpoProject("MEMBER", null)).toBe(false);
    expect(canAccessExpoProject("MEMBER", "VIEWER")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused authorization suite and verify failure**

```bash
npx vitest run src/lib/expo/__tests__/permissions.test.ts src/lib/expo/__tests__/auth.test.ts src/app/api/expo/__tests__/routes.test.ts src/app/api/expo/__tests__/template-routes.test.ts
```

Expected: the old one-argument permission function and workspace-only route guard fail the matrix.

- [ ] **Step 3: Implement one route context and apply it everywhere**

```ts
export type ProjectRole = "VIEWER" | "EDITOR" | "ADMIN";

export interface ExpoRouteContext {
  caps: ExpoCapabilities;
  userId: string;
  memberWorkspaceIds: string[];
  workspaceRole(workspaceId: string): WorkspaceRole | null;
  projectRole(projectId: string): ProjectRole | null;
}

export function canAccessExpoProject(
  workspaceRole: WorkspaceRole | null,
  projectRole: ProjectRole | null,
): boolean {
  if (workspaceRole === "OWNER" || workspaceRole === "ADMIN") return true;
  return workspaceRole === "MEMBER" && projectRole !== null;
}
```

`guardExpoRoute` loads `WorkspaceMember` and `ProjectMember` in one `Promise.all`, builds both role maps, and returns no ProjectMember rows outside the caller's workspace memberships. Each route first resolves the URL-addressed resource, then checks access, then checks `canEdit`, `canPublish`, `canManageSite`, or `canManageTemplates`.

Enforce:

- VIEWER can GET page/site/revision data but all writes return 403.
- EDITOR can edit, upload, publish, export, and roll back only its project.
- Project ADMIN additionally deletes site/page and revokes preview tokens.
- Workspace OWNER/ADMIN retains all access.
- Workspace MEMBER without a ProjectMember receives 404 and is absent from list responses.
- Template rename/permanent delete remains Workspace OWNER/ADMIN only. An EDITOR may instantiate a visible template into its assigned project and save that assigned project's content as a new workspace template; both routes re-check source project access and destination project EDITOR access.

- [ ] **Step 4: Run authorization, route, and type tests**

```bash
npx vitest run src/lib/expo/__tests__/permissions.test.ts src/lib/expo/__tests__/auth.test.ts src/app/api/expo/__tests__/routes.test.ts src/app/api/expo/__tests__/template-routes.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: all role cases, cross-project 404 cases, and unassigned-list filtering pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/expo src/app/api/expo 'src/app/(app)/homepage/[siteId]/page.tsx'
git commit -m "feat: scope Expo publishing to project roles"
```

### Task 3: Add the revision table and fail-closed V2 schema capability

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `supabase/migrations/20260901000000_expo_page_revisions.sql`
- Modify: `src/lib/expo/capability.ts`
- Modify: `src/lib/expo/schema-probe.ts`
- Modify: `scripts/check-expo-schema.mjs`
- Create: `scripts/verify-expo-db-target.mjs`
- Modify: `src/lib/expo/__tests__/capability.test.ts`
- Create: `src/lib/expo/__tests__/schema-checker-cli.test.ts`
- Create: `src/lib/expo/__tests__/db-target-cli.test.ts`
- Modify: `src/app/api/expo/__tests__/routes.test.ts`
- Modify: `src/app/api/expo/__tests__/template-routes.test.ts`
- Modify: `src/app/h/__tests__/loader.test.ts`
- Modify: `src/app/hp/__tests__/preview.test.ts`

**Interfaces:**

- Produces: `ExpoPageRevision`, `ExpoPage.revisions`, `EXPO_SCHEMA_CAPABILITY_VERSION = "20260901-v2"`, and schema checker modes `absent | v1 | ready`.
- Does not apply the migration or change production environment flags.

- [ ] **Step 1: Write failing capability and checker contract tests**

```ts
import { expect, it } from "vitest";
import { deriveExpoCapabilities } from "@/lib/expo/capability";

it("rejects the old schema flag after revision support ships", () => {
  expect(deriveExpoCapabilities({ schemaFlag: "20260821-v1", publicFlag: "on", schemaProbeReady: true })).toEqual({
    admin: false,
    preview: false,
    publicEmbed: false,
  });
});
```

Add a DB-free `--describe` mode to the checker and a CLI test asserting its JSON contract says `v1` means exactly the existing three Expo tables are ready and `ExpoPageRevision` is absent, while `ready` requires all four. Add DB-free URL-only tests for `verify-expo-db-target.mjs`: protocol, exact approved hostname, port `5432`, decoded database name, and decoded user must all match the separately supplied `EXPO_APPROVED_DB_*` values before a connection is attempted.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/expo/__tests__/capability.test.ts src/lib/expo/__tests__/schema-checker-cli.test.ts src/lib/expo/__tests__/db-target-cli.test.ts src/app/api/expo/__tests__/routes.test.ts src/app/h/__tests__/loader.test.ts src/app/hp/__tests__/preview.test.ts
```

Expected: capability still accepts `20260821-v1`; the fourth table is unknown.

- [ ] **Step 3: Add the Prisma model and checked additive SQL**

```prisma
model ExpoPageRevision {
  id          String   @id @default(cuid())
  pageId      String
  sequence    Int
  snapshot    Json
  codeDigest  String
  publishedBy String
  createdAt   DateTime @default(now())
  page        ExpoPage @relation(fields: [pageId], references: [id], onDelete: Cascade)

  @@unique([pageId, sequence])
  @@index([pageId, createdAt(sort: Desc)])
}
```

Add `revisions ExpoPageRevision[]` to `ExpoPage`. Do not add a user foreign key for `publishedBy`; its audit identifier survives user deletion.

The SQL is one transaction that creates the table, unique/index/FK, enables RLS, creates zero policies, and revokes every table privilege from `PUBLIC`, `anon`, `authenticated`, and `service_role`. It contains no `DROP`, `TRUNCATE`, data `UPDATE`, or data `DELETE`.

Extend `scripts/check-expo-schema.mjs` so:

```text
--expect=absent  ExpoSite, ExpoPage, ExpoTemplate, ExpoPageRevision are all absent
--expect=v1      the first three pass all v1 checks and ExpoPageRevision is absent
--expect=ready   all four pass column, index, FK, RLS, zero-policy, zero-grant checks
```

The partial unique index baseline remains exactly `10`. `node scripts/check-expo-schema.mjs --describe` prints the modes/tables/indexes/FKs as JSON and exits before constructing Prisma, so the contract test cannot touch a database.

Implement `scripts/verify-expo-db-target.mjs` with two stages. The first parses `EXPO_SESSION_DATABASE_URL` without printing it and compares its decoded hostname, database, user, protocol, and port against `EXPO_APPROVED_DB_HOST`, `EXPO_APPROVED_DB_NAME`, and `EXPO_APPROVED_DB_USER`. The second opens one `pg` connection with that URL and executes only `SELECT current_database(), current_user, inet_server_addr(), inet_server_port()`, then fails unless the returned database, user, and port also match. It may print the non-secret approved host/database/user and returned server address, but never the URL or password. `--url-only` stops before importing/constructing the client so the CLI test is DB-free.

- [ ] **Step 4: Validate and generate without touching a database**

```bash
npx prisma validate
npx prisma generate
npx vitest run src/lib/expo/__tests__/capability.test.ts src/lib/expo/__tests__/schema-checker-cli.test.ts src/lib/expo/__tests__/db-target-cli.test.ts src/app/api/expo/__tests__/routes.test.ts src/app/h/__tests__/loader.test.ts src/app/hp/__tests__/preview.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: schema validates, generated client contains `expoPageRevision`, all capability fixtures use `20260901-v2`, tests pass.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma supabase/migrations/20260901000000_expo_page_revisions.sql scripts/check-expo-schema.mjs scripts/verify-expo-db-target.mjs src/lib/expo src/app
git commit -m "feat: add Expo publish revision schema"
```

### Task 4: Make publish and rollback transactional with a full-snapshot digest

**Files:**

- Create: `src/lib/expo/snapshot-digest.ts`
- Create: `src/lib/expo/revision-service.ts`
- Create: `src/lib/expo/__tests__/snapshot-digest.test.ts`
- Create: `src/lib/expo/__tests__/revision-service.test.ts`
- Modify: `src/lib/expo/readiness.ts`
- Modify: `src/lib/expo/__tests__/readiness.test.ts`
- Modify: `src/app/api/expo/pages/[pageId]/publish/route.ts`
- Modify: `src/app/api/expo/__tests__/routes.test.ts`

**Interfaces:**

- Produces: `snapshotDigest`, `publishPageRevision`, and `rollbackPageRevision`.
- Consumes: Task 1 normalization/readiness and Task 2 `canPublish`.

- [ ] **Step 1: Write failing canonical digest and transaction tests**

```ts
import { expect, it } from "vitest";
import { snapshotDigest } from "@/lib/expo/snapshot-digest";

it("hashes the full canonical snapshot, independent of object key order", () => {
  const a = { schemaVersion: 2, settings: { event: { edition: 2027, startsAt: "2027-06-02T00:00:00Z", endsAt: "2027-06-05T00:00:00Z" } }, sections: [] };
  const b = { sections: [], settings: { event: { endsAt: "2027-06-05T00:00:00Z", startsAt: "2027-06-02T00:00:00Z", edition: 2027 } }, schemaVersion: 2 };
  expect(snapshotDigest(a)).toBe(snapshotDigest(b));
  expect(snapshotDigest(a)).not.toBe(snapshotDigest({ ...a, settings: { event: { ...a.settings.event, edition: 2028 } } }));
});
```

The revision-service fake transaction tests must assert: row lock occurs first, two concurrent publishes get distinct sequences, the 21st publish retains sequences 2–21, any failing create/update/prune rolls back, rollback creates sequence 22 while leaving `draft` and `draftRevision` unchanged. With `publicEmbedEnabled:false`, publish and rollback both reject a candidate that newly sets any `embedEnabled` section, or adds a newly renderable section while the page already has `liveAt`; an unchanged already-public surface remains editable while the global loader stays fail-closed.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/expo/__tests__/snapshot-digest.test.ts src/lib/expo/__tests__/revision-service.test.ts src/app/api/expo/__tests__/routes.test.ts
```

Expected: missing service and digest failures; publish route still performs a single update.

- [ ] **Step 3: Implement deterministic SHA-256 and the locked service**

```ts
export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
}

export function snapshotDigest(raw: unknown): string {
  return createHash("sha256").update(stableJson(normalizeExpoPage(raw))).digest("hex");
}
```

Do not use `expoPreviewCodeDigest`: it intentionally hashes only custom-code exposure and cannot identify a content revision.

```ts
export interface RevisionServiceInput {
  pageId: string;
  publishedBy: string;
  publicEmbedEnabled: boolean;
  now: Date;
}

export interface RevisionServiceSuccess {
  ok: true;
  pageId: string;
  revisionId: string;
  sequence: number;
  codeDigest: string;
  snapshot: ExpoPageConfigV2;
}

export type RevisionServiceFailure = {
  ok: false;
  status: 422;
  code: "publish-readiness-failed" | "public-embed-release-disabled";
  issues: FieldIssue[];
};

export type RevisionServiceResult = RevisionServiceSuccess | RevisionServiceFailure;

export function publishPageRevision(
  tx: Prisma.TransactionClient,
  input: RevisionServiceInput,
): Promise<RevisionServiceResult>;

export function rollbackPageRevision(
  tx: Prisma.TransactionClient,
  input: RevisionServiceInput & { revisionId: string },
): Promise<RevisionServiceResult>;
```

Replace the existing `publishIssues(draftRaw): ReadinessIssue[]` implementation with `publishErrors(draftRaw): FieldIssue[]` while preserving its blocking decisions. Map `no-sections` and `no-renderable-section` to `path:"sections"`; map an empty enabled row to `path:"sections[<index>].content"` with the real numeric index; set `severity:"error"`, preserve `code`, `message`, and `sid`, and add exact-path regressions. Keep the outward `pageReadiness(...).publishIssues` DTO key for W1 UI compatibility, but populate it from `publishErrors`; `FieldIssue` is a structural superset of the old UI item. Inside each service: lock `ExpoPage` with a parameterized `FOR UPDATE` query; reload page; choose the candidate snapshot (`page.draft` for publish, the URL-page-owned revision snapshot for rollback); verify that candidate with Task 1 strict structure and this blocking `publishErrors()` contract; normalize; compute max sequence + 1; update `published/publishedAt`; insert revision; fetch rows after offset 20 ordered by sequence descending; delete only those ids. Task 7 later extends the same `publishErrors()` entry point with STK cross-reference rules, so the service does not change again.

Use `publicEmbedEnabled` as an actual release gate in both service paths. Compare candidate against the locked current published snapshot by `sid`; when the flag is false, return `{ ok:false, status:422, code:"public-embed-release-disabled", issues }` if any section changes from absent/false to `embedEnabled:true`, or if `liveAt` is already set and the candidate introduces a newly enabled renderable section. Blocking readiness returns the other failure code. Do this before the update/revision insert. The route branches on `result.ok`, maps the declared status/code/issues directly to JSON, and accesses sequence/digest only in the success branch; add route tests proving neither failure becomes a 500. The route passes the fail-closed capability derived from `EXPO_PUBLIC_EMBED_RELEASE`, never a client value. Never mutate `draft`, `draftRevision`, or `liveAt`. The route wraps the service in `prisma.$transaction` and re-checks URL ownership and `canPublish` before entering it.

- [ ] **Step 4: Run focused and type tests**

```bash
npx vitest run src/lib/expo/__tests__/snapshot-digest.test.ts src/lib/expo/__tests__/revision-service.test.ts src/lib/expo/__tests__/readiness.test.ts src/app/api/expo/__tests__/routes.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: digest and transaction invariants pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/expo src/app/api/expo/pages/'[pageId]'/publish/route.ts src/app/api/expo/__tests__/routes.test.ts
git commit -m "feat: record transactional Expo publish revisions"
```

### Task 5: Add revision history, rollback API, and editor audit panel

**Files:**

- Create: `src/app/api/expo/pages/[pageId]/revisions/route.ts`
- Create: `src/app/api/expo/pages/[pageId]/revisions/[revisionId]/rollback/route.ts`
- Create: `src/app/api/expo/__tests__/revision-routes.test.ts`
- Create: `src/components/expo/ExpoRevisionPanel.tsx`
- Create: `src/components/expo/__tests__/revision-panel.test.tsx`
- Modify: `src/components/expo/ExpoPublishPanel.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vitest.config.ts`
- Create: `vitest.setup.ts`

**Interfaces:**

- Produces: `RevisionListItem[]`, GET history, POST rollback, and an accessible UI that refreshes published preview after rollback.
- Consumes: Task 4 services and Task 2 permissions.

- [ ] **Step 1: Write failing route and UI tests**

Install the shared accessible component-test utilities before adding the first TSX test, commit the resulting lockfile, set `test.setupFiles` to `./vitest.setup.ts`, and put `import "@testing-library/jest-dom/vitest";` in that setup file. Keep the global Vitest environment `node`; every DOM/TSX test starts with `/** @vitest-environment jsdom */` so server tests remain Node tests.

```bash
npm install --save-dev @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

```ts
/** @vitest-environment jsdom */
import { vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export interface RevisionListItem {
  id: string;
  sequence: number;
  codeDigest: string;
  publishedBy: string;
  publisher: { id: string; name: string | null; email: string | null } | null;
  createdAt: string;
  summary: {
    preset?: string;
    sectionCount: number;
    campaignCount: number;
    destinationCount: number;
  };
}
```

Route tests cover: VIEWER GET 200, EDITOR rollback 200, VIEWER rollback 403, cross-page revision 404, latest-first limit 20, deleted publisher returns `publisher:null`, rollback leaves draft revision unchanged, release lock matches normal publish.

```tsx
it("requires confirmation and reports the new revision", async () => {
  const user = userEvent.setup();
  const globalFetch = vi.spyOn(globalThis, "fetch");
  render(<ExpoRevisionPanel pageId="page-1" canPublish={true} request={request} onRolledBack={onRolledBack} />);
  await user.click(await screen.findByRole("button", { name: "버전 7 복구" }));
  await user.click(screen.getByRole("button", { name: "발행본으로 복구" }));
  expect(await screen.findByText("버전 9로 복구했어요")).toBeInTheDocument();
  expect(onRolledBack).toHaveBeenCalledWith(9);
  expect(globalFetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/app/api/expo/__tests__/revision-routes.test.ts src/components/expo/__tests__/revision-panel.test.tsx
```

Expected: routes and panel do not exist.

- [ ] **Step 3: Implement API and panel**

GET returns at most 20 records and joins publisher display data by `publishedBy` without creating a database FK. POST verifies the revision belongs to the URL page before calling `rollbackPageRevision`. The panel displays version, local time, publisher, summary, short digest, and a destructive confirmation dialog. On success it invalidates history/published preview locally but never overwrites the draft.

```ts
export interface ExpoRevisionPanelProps {
  pageId: string;
  canPublish: boolean;
  request?: (path: string, init?: RequestInit) => Promise<Response>;
  onRolledBack(sequence: number): void;
}
```

The panel uses `request ?? window.fetch` for both history and rollback. Its test injects a fake request and asserts zero calls reach global `fetch`; Task 11 passes `transport.request` through this prop.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/app/api/expo/__tests__/revision-routes.test.ts src/components/expo/__tests__/revision-panel.test.tsx src/components/expo/__tests__/publish-panel.test.tsx
npx tsc --noEmit -p tsconfig.json
```

Expected: API authorization, audit metadata, confirmation, and preview refresh pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts vitest.setup.ts src/app/api/expo/pages src/app/api/expo/__tests__/revision-routes.test.ts src/components/expo
git commit -m "feat: add Expo revision history and rollback"
```

### Task 6: Extend the registry with pure section-plugin hooks and content walkers

**Files:**

- Modify: `src/lib/expo/types.ts`
- Modify: `src/lib/expo/registry.ts`
- Modify: `src/lib/expo/config.ts`
- Modify: `src/lib/expo/request.ts`
- Modify: `src/lib/expo/model.ts`
- Modify: `src/lib/expo/payload.ts`
- Modify: `src/lib/expo/media.ts`
- Create: `src/lib/expo/plugin-content.ts`
- Create: `src/lib/expo/__tests__/section-plugin.test.ts`
- Modify: `src/lib/expo/__tests__/config.test.ts`
- Modify: `src/lib/expo/__tests__/request.test.ts`
- Modify: `src/lib/expo/__tests__/model.test.ts`
- Modify: `src/lib/expo/__tests__/payload.test.ts`
- Modify: `src/lib/expo/__tests__/media.test.ts`

**Interfaces:**

- Produces: `SectionPlugin`, `SectionEditorProps`, `SectionRenderContext`, `SectionRenderResult`, `resolvePluginContent`, `collectPluginMediaUrls`, and `rewritePluginMediaUrls`.
- Preserves: the existing `SectionDef`/`SlotDef` path for all six W1 section types.

- [ ] **Step 1: Write failing fallback and nested-content tests**

```ts
import { describe, expect, it } from "vitest";
import { collectPluginMediaUrls, resolvePluginContent, rewritePluginMediaUrls } from "@/lib/expo/plugin-content";

describe("plugin content walkers", () => {
  const content = {
    heading: { ko: "연사", en: "Speakers" },
    rows: [{ name: { ko: "홍길동", en: "Gildong Hong" }, image: { kind: "image", url: "https://cdn.example.com/a.webp", alt: "홍길동" } }],
  };

  it("localizes nested text without dropping arrays or media", () => {
    expect(resolvePluginContent(content, "ko")).toEqual({
      heading: "연사",
      rows: [{ name: "홍길동", image: { kind: "image", url: "https://cdn.example.com/a.webp", alt: "홍길동" } }],
    });
  });

  it("collects and rewrites only image fields", () => {
    expect(collectPluginMediaUrls(content)).toEqual(["https://cdn.example.com/a.webp"]);
    expect(rewritePluginMediaUrls(content, new Map([["https://cdn.example.com/a.webp", "https://cdn.example.com/b.webp"]]))).toMatchObject({
      rows: [{ image: { url: "https://cdn.example.com/b.webp" } }],
    });
  });
});
```

Add a registry test whose hookless `textblock` output is byte-for-byte equal before and after the plugin dispatch. Add a bundle-boundary test that fails if any shared registry module imports React at runtime.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/expo/__tests__/section-plugin.test.ts src/lib/expo/__tests__/config.test.ts src/lib/expo/__tests__/request.test.ts src/lib/expo/__tests__/model.test.ts src/lib/expo/__tests__/payload.test.ts src/lib/expo/__tests__/media.test.ts
```

Expected: complex content is dropped by the current slot walker and plugin APIs are missing.

- [ ] **Step 3: Implement the pure plugin contract and dispatch**

```ts
import type { ComponentType } from "react";
import type { LinkTarget } from "@/lib/expo/payload";

export interface NormalizeContext {
  locale?: string;
  mode: "stored" | "draft-write" | "public";
}

export interface ValidateContext {
  config: ExpoPageConfigV2;
  sectionIndex: number;
  campaigns: ReadonlyMap<string, CampaignConfig>;
  destinations: ReadonlyMap<string, DestinationConfig>;
}

export interface SectionRenderContext {
  locale: string;
  campaigns: ReadonlyMap<string, ResolvedCampaignState>;
  destinations: ReadonlyMap<string, ResolvedDestination>;
  mode: "live" | "preview-draft" | "preview-published" | "standalone";
  reducedMotion: boolean;
  doc: Document;
}

export interface SectionRenderResult {
  node: HTMLElement;
  attach?(): void;
  dispose?(): void;
}

export type SectionRenderer = (
  section: PayloadSection,
  context: SectionRenderContext,
) => SectionRenderResult | null;

export interface SectionEditorProps {
  siteId: string;
  locale: string;
  sources: readonly { id: string; name: string; isActive: boolean }[];
  pages: readonly LinkTarget[];
  section: ExpoSection;
  config: ExpoPageConfigV2;
  issues: readonly FieldIssue[];
  canEdit: boolean;
  onChange(next: ExpoSection): void;
}

export interface SectionPlugin extends SectionDef {
  normalize?(content: unknown, context: NormalizeContext): Record<string, unknown>;
  validate?(section: ExpoSection, context: ValidateContext): FieldIssue[];
  hasContent?(section: ExpoSection): boolean;
  render?: SectionRenderer;
  editor?: ComponentType<SectionEditorProps>;
}
```

`import type` erases React from the shared bundle. Shared plugin objects never assign `editor`; Task 12's client-only registry overlays components.

Dispatch rules:

1. `normalizeSection` calls `plugin.normalize` when present and the existing slot walker otherwise.
2. Draft validation prefixes plugin-relative issue paths with `sections[index].content.` and supplies the immutable `sid`.
3. `hasContent` delegates to a plugin's explicit content predicate, otherwise uses W1 logic.
4. `buildExpoPayload` preserves all canonical plugin content, resolves localized maps recursively, and never serializes hook functions.
5. Template/media copy uses plugin media walkers for `kind:"image" | "video"` objects, including `url`, `originalUrl`, and nested poster images; it never rewrites code strings.
6. Unknown plugin types and malformed stored rows are skipped without throwing.

Use locale-key recognition `^[a-z]{2}(-[A-Z]{2})?$` and require every property value to be a string before treating an object as `Localized`; image objects, crop objects, and design maps must remain objects.

- [ ] **Step 4: Run tests and regenerate the runtime boundary check**

```bash
npx vitest run src/lib/expo/__tests__/section-plugin.test.ts src/lib/expo/__tests__/config.test.ts src/lib/expo/__tests__/request.test.ts src/lib/expo/__tests__/model.test.ts src/lib/expo/__tests__/payload.test.ts src/lib/expo/__tests__/media.test.ts
npm run build:expo-runtime
npx vitest run src/lib/__tests__/embed-build-pipeline.test.ts src/lib/__tests__/embed-runtime.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: hookless W1 output is unchanged, nested plugin content survives, media copying sees nested images, and the runtime bundle contains no React import.

- [ ] **Step 5: Commit**

```bash
git add src/lib/expo src/generated/expo-runtime.ts
git commit -m "feat: add Expo section plugin contracts"
```

### Task 7: Define six STK section schemas, cross-reference validation, and CTA selection

**Files:**

- Create: `src/lib/expo/sections/types.ts`
- Create: `src/lib/expo/sections/campaign-hero.ts`
- Create: `src/lib/expo/sections/exhibition-grid.ts`
- Create: `src/lib/expo/sections/audience-links.ts`
- Create: `src/lib/expo/sections/speaker-carousel.ts`
- Create: `src/lib/expo/sections/sponsor-marquee.ts`
- Create: `src/lib/expo/sections/cta-band.ts`
- Create: `src/lib/expo/cta.ts`
- Modify: `src/lib/expo/registry.ts`
- Modify: `src/lib/expo/readiness.ts`
- Create: `src/lib/expo/sections/__tests__/campaign-hero.test.ts`
- Create: `src/lib/expo/sections/__tests__/exhibition-grid.test.ts`
- Create: `src/lib/expo/sections/__tests__/audience-links.test.ts`
- Create: `src/lib/expo/sections/__tests__/speaker-carousel.test.ts`
- Create: `src/lib/expo/sections/__tests__/sponsor-marquee.test.ts`
- Create: `src/lib/expo/sections/__tests__/cta-band.test.ts`
- Create: `src/lib/expo/__tests__/cta.test.ts`
- Modify: `src/lib/expo/__tests__/readiness.test.ts`

**Interfaces:**

- Produces: six canonical content types, plugin registrations, `selectVisibleCtas`, and publish errors/warnings with stable field paths.
- Consumes: Task 1 campaign/destination maps and Task 6 plugin hooks.

- [ ] **Step 1: Write failing schema, reference, and CTA tests**

```ts
import { describe, expect, it } from "vitest";
import { selectVisibleCtas } from "@/lib/expo/cta";

const placements = [
  { id: "inquiry", label: { ko: "1:1 부스 참가 문의" }, destinationId: "booth-inquiry", variant: "primary", audience: "exhibitor", campaignIds: ["exhibitor-recruitment"], priority: 1, fallback: false, enabled: true },
  { id: "preregister", label: { ko: "사전등록" }, destinationId: "visitor-register", variant: "primary", audience: "visitor", campaignIds: ["visitor-registration"], priority: 2, fallback: false, enabled: true },
  { id: "overview", label: { ko: "전시회 소개" }, destinationId: "event-overview", variant: "secondary", audience: "all", campaignIds: [], priority: 3, fallback: true, enabled: true },
] as const;

describe("CTA selection", () => {
  it("shows both independent campaigns by priority", () => {
    const result = selectVisibleCtas(placements, { audience: "all", activeCampaignIds: new Set(["exhibitor-recruitment", "visitor-registration"]), validDestinationIds: new Set(["booth-inquiry", "visitor-register", "event-overview"]), limit: 2 });
    expect(result.map((row) => row.id)).toEqual(["inquiry", "preregister"]);
  });

  it("uses fallback only when no campaign is active", () => {
    const result = selectVisibleCtas(placements, { audience: "all", activeCampaignIds: new Set(), validDestinationIds: new Set(["booth-inquiry", "visitor-register", "event-overview"]), limit: 2 });
    expect(result.map((row) => row.id)).toEqual(["overview"]);
  });
});
```

Plugin tests assert: duplicate ids fail at exact row paths; an enabled speaker requires a valid enabled category; a referenced category cannot be deleted; a sponsor requires a valid group; active content images require alt or `decorative:true`; Hero derives accessible headline from the first typing line; exactly one exhibitor and one visitor group survive; empty public categories hide; exhibition count comes from enabled valid rows; CTA results never exceed two.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/expo/sections/__tests__ src/lib/expo/__tests__/cta.test.ts src/lib/expo/__tests__/readiness.test.ts
```

Expected: all six plugin types and CTA resolver are missing.

- [ ] **Step 3: Implement canonical shapes and normalization**

```ts
export interface ExpoImageValue extends MediaValue {
  originalUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  decorative: boolean;
}

export interface ExpoVideoValue {
  kind: "video";
  url: string;
  originalUrl: string;
  mimeType: "video/mp4";
  poster?: ExpoImageValue;
  rightsStatus: "confirmed" | "unconfirmed";
}

export interface ImageCrop {
  fit: "cover" | "contain";
  x: number;
  y: number;
  scale: number;
}

export type CtaVariant = "primary" | "secondary" | "outline" | "solid";

export interface CtaPlacement {
  id: string;
  label: Localized;
  description?: Localized;
  destinationId: string;
  variant: CtaVariant;
  audience: AudienceId;
  campaignIds: string[];
  priority: number;
  fallback: boolean;
  enabled: boolean;
}

export interface CampaignHeroContent {
  eyebrow?: Localized;
  typingLines: Localized[];
  accessibleHeadline: Localized;
  video?: ExpoVideoValue;
  overlay: number;
  typing: { enabled: boolean; speedMs: number; holdMs: number };
  ctas: CtaPlacement[];
}

export interface ExhibitionItem {
  id: string;
  title: Localized;
  description?: Localized;
  symbol?: ExpoImageValue;
  accentToken: string;
  destinationId: string;
  order: number;
  enabled: boolean;
}

export interface ExhibitionGridContent {
  heading: Localized;
  items: ExhibitionItem[];
}

export interface AudienceLink {
  id: string;
  icon?: ExpoImageValue;
  label: Localized;
  destinationId: string;
  campaignIds: string[];
  order: number;
  enabled: boolean;
}

export interface AudienceGroup {
  audience: "exhibitor" | "visitor";
  title: Localized;
  description?: Localized;
  variant: "light" | "dark";
  items: AudienceLink[];
}

export interface AudienceLinksContent {
  groups: AudienceGroup[];
}

export interface SpeakerCategory {
  id: string;
  label: Localized;
  badgeToken: "robotics" | "ai" | "autonomous-manufacturing";
  gradientToken: "robotics" | "ai" | "autonomous-manufacturing";
  order: number;
  enabled: boolean;
}

export interface Speaker {
  id: string;
  name: Localized;
  company: Localized;
  role: Localized;
  day: 1 | 2 | 3;
  categoryId: string;
  image?: ExpoImageValue;
  crop: ImageCrop;
  profileUrl?: string;
  order: number;
  enabled: boolean;
}

export interface SpeakerCarouselContent {
  heading: Localized;
  description?: Localized;
  categories: SpeakerCategory[];
  speakers: Speaker[];
}

export interface SponsorGroup {
  id: string;
  title: Localized;
  marquee: boolean;
  durationSeconds: number;
  order: number;
}

export interface Sponsor {
  id: string;
  name: string;
  logo?: ExpoImageValue;
  homepageUrl?: string;
  groupId: string;
  order: number;
  enabled: boolean;
}

export interface SponsorMarqueeContent {
  heading?: Localized;
  groups: SponsorGroup[];
  sponsors: Sponsor[];
}

export interface CtaBandContent {
  headline: Localized;
  audience: AudienceId;
  ctas: CtaPlacement[];
}
```

Normalize order to contiguous display order without changing ids. Clamp crop to `x/y 0..100`, `scale 0.5..2`, Hero overlay `0..0.9`, typing speed `20..300ms`, hold `500..10000ms`, sponsor duration `8..120s`. Plugin arrays use the global 100-row cap. Badge/gradient values are allowlisted token names rather than stored CSS, so arbitrary style injection is impossible.

`selectVisibleCtas` filters disabled placements and missing/disabled destinations. When the location audience is `all`, it accepts all placement audiences; otherwise it accepts placements whose audience is `all` or equals the location audience. With active campaigns it keeps rows whose `campaignIds` intersect the active set and ignores fallback rows. With no active campaign it keeps only `fallback:true`. It sorts `priority` ascending then original array order and slices to `limit` (always 2 in STK renderers).

- [ ] **Step 4: Split structural errors, blocking publish errors, and non-blocking warnings**

Draft writes reject malformed types/limits/IDs but allow incomplete content. `publishErrors(config)` returns only blocking errors for required text, invalid/missing/disabled references, unsafe action URLs, actionless CTAs, missing required images, invalid Hero video, and public speakers pointing to deleted categories. Task 4 rejects only when this array is non-empty.

`contentWarnings(config)` separately returns non-blocking config warnings such as decorative empty alt, no fallback CTA, empty optional sections, and unconfirmed Hero rights. Task 13 adds `pageWarnings({ config, publishedAt, updatedAt, lastSeenAt, lastSeenOrigin, now })` for page-metadata warnings such as stale/wrong connection and draft ahead of published; draft-ahead delegates to the existing timestamp-based `hasUnpublishedChanges({ publishedAt, updatedAt })` rather than comparing unrelated draft revision and publish sequence counters. Neither warning function is passed to the transactional rejection branch. Every diagnostic includes `severity`, exact `path`, and `sid` when applicable. Update Task 4's service to call only `publishErrors()` inside the locked transaction and add a regression proving warnings do not produce a 422.

```bash
npx vitest run src/lib/expo/sections/__tests__ src/lib/expo/__tests__/cta.test.ts src/lib/expo/__tests__/readiness.test.ts src/lib/expo/__tests__/revision-service.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: all reference, boundary, warning, and max-two CTA tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/expo
git commit -m "feat: add STK homepage section schemas"
```

### Task 8: Preserve originals and produce safe optimized image, SVG, and MP4 assets

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/expo/image-guard.ts`
- Modify: `src/lib/expo/media.ts`
- Create: `src/lib/expo/image-process.ts`
- Create: `src/lib/expo/svg-guard.ts`
- Create: `src/lib/expo/video-guard.ts`
- Create: `src/lib/expo/media-upload-session.ts`
- Create: `src/lib/expo/quarantine-bucket.ts`
- Create: `scripts/ensure-expo-quarantine-bucket.mjs`
- Modify: `src/app/api/expo/[siteId]/media/route.ts`
- Create: `src/app/api/expo/[siteId]/media/session/route.ts`
- Create: `src/app/api/expo/[siteId]/media/finalize/route.ts`
- Modify: `src/components/expo/SlotField.tsx`
- Create: `src/components/expo/fields/ExpoMediaUploadField.tsx`
- Create: `src/components/expo/fields/ImageCropField.tsx`
- Modify: `src/lib/expo/__tests__/image-guard.test.ts`
- Create: `src/lib/expo/__tests__/svg-guard.test.ts`
- Create: `src/lib/expo/__tests__/video-guard.test.ts`
- Modify: `src/lib/expo/__tests__/media.test.ts`
- Create: `src/app/api/expo/__tests__/media-route.test.ts`
- Create: `src/app/api/expo/__tests__/media-session-route.test.ts`
- Create: `src/app/api/expo/__tests__/media-finalize-route.test.ts`
- Create: `src/lib/expo/__tests__/quarantine-bucket.test.ts`
- Create: `src/components/expo/__tests__/media-upload-field.test.tsx`
- Create: `src/components/expo/__tests__/image-crop-field.test.tsx`

**Interfaces:**

- Produces: safe `ExpoMediaUploadResult`, 1,400px optimized derivatives, retained originals, SVG-to-PNG public rendering, MP4 validation, and crop controls.
- Consumes: Task 2 `canEdit` and Task 6 nested media walkers.

- [ ] **Step 1: Install the XML parser and write failing malicious SVG/derivative tests**

```bash
npm install @xmldom/xmldom@0.9.12
```

```ts
import { describe, expect, it } from "vitest";
import { inspectSvg } from "@/lib/expo/svg-guard";

describe("SVG upload safety", () => {
  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>html</div></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path onclick="alert(1)" d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://evil.example/x.css";</style></svg>',
    '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>',
  ])("rejects executable SVG", (source) => {
    expect(inspectSvg(new TextEncoder().encode(source))).toMatchObject({ ok: false });
  });

  it("accepts fragment-only references", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0h10v10z"/></svg>';
    expect(inspectSvg(new TextEncoder().encode(source))).toMatchObject({ ok: true });
  });
});
```

Add route tests asserting: the authenticated session route returns a one-use signed upload path in a private quarantine bucket; idempotent provisioning creates a missing bucket or repairs its settings to `public:false`, 50MiB file limit, and the exact image/SVG/MP4 MIME allowlist; target verification rejects a Supabase URL whose project ref differs from the separately approved ref or from the canonical direct-DB host ref; no unvalidated object is publicly addressable; finalize verifies URL-site/project/user prefix and stored size before download; raster/SVG finalization produces two immutable public uploads; cleanup removes quarantine plus the first public object if the second upload fails; MP4 byte/MIME mismatch is rejected; the image long edge is at most 1400px; response paths stay under the owning Expo site.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/expo/__tests__/image-guard.test.ts src/lib/expo/__tests__/svg-guard.test.ts src/lib/expo/__tests__/video-guard.test.ts src/lib/expo/__tests__/media.test.ts src/lib/expo/__tests__/quarantine-bucket.test.ts src/app/api/expo/__tests__/media-route.test.ts src/app/api/expo/__tests__/media-session-route.test.ts src/app/api/expo/__tests__/media-finalize-route.test.ts src/components/expo/__tests__/media-upload-field.test.tsx src/components/expo/__tests__/image-crop-field.test.tsx
```

Expected: SVG is currently rejected wholesale, originals are not retained, long edge is 1600px, and crop UI is absent.

- [ ] **Step 3: Implement Expo-only processing without changing webinar media**

```ts
export interface ExpoMediaUploadResult {
  kind: "image" | "video";
  url: string;
  originalUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
  bytes: number;
}

export const EXPO_IMAGE_PROCESS_RULES = {
  sourceBytes: 12 * 1024 * 1024,
  storedBytes: 1.5 * 1024 * 1024,
  maxEdge: 1400,
  maxPixels: 50_000_000,
} as const;

export const EXPO_VIDEO_RULES = {
  sourceBytes: 50 * 1024 * 1024,
  mimeType: "video/mp4",
} as const;
```

Do not alter global `src/lib/image-downscale.ts`; create Expo-only Sharp processing. Raster original keeps its detected extension; optimized derivative is PNG for transparent PNG, WebP for JPEG/WebP. SVG is parsed with `@xmldom/xmldom`, rejects DOCTYPE, processing instructions, `script`, `foreignObject`, `iframe`, `object`, `embed`, event attributes, external/data `href` and `xlink:href`, CSS `@import`/`@font-face`/`expression()`/`javascript:`, and any `url()` other than `url(#id)`; the original SVG is retained but the renderer receives a Sharp-generated PNG derivative. MP4 requires declared `video/mp4`, `ftyp` magic, 50MiB maximum, and stores one immutable object with `url === originalUrl`.

Do not proxy 12MiB images or 50MiB MP4 bodies through the Next/Vercel route. `POST /api/expo/{siteId}/media/session` accepts only `{ fileName, declaredType, bytes }`, checks `canEdit` and the declared limit, creates a random path under `${workspaceId}/expo-quarantine/${siteId}/${userId}/`, and returns a one-use Supabase signed upload token for a dedicated private `expo-quarantine` bucket. Before constructing the admin client, `ensureExpoQuarantineBucket()` requires the configured Supabase URL project ref to equal runtime `EXPO_APPROVED_SUPABASE_PROJECT_REF`; it then uses the service-role Storage API to get-or-create and idempotently update that bucket to `public:false`, `fileSizeLimit:50 * 1024 * 1024`, and an allowlist limited to JPEG, PNG, WebP, SVG, and MP4. Session creation calls it and fails closed if the target or verified settings differ.

Before constructing a service-role client, `scripts/ensure-expo-quarantine-bucket.mjs` parses the Supabase base URL, extracts the exact project ref from `<ref>.supabase.co`, and requires it to equal `EXPO_APPROVED_SUPABASE_PROJECT_REF`. When `EXPO_APPROVED_DB_HOST` has the canonical `db.<ref>.supabase.co` form, that ref must also match; otherwise the signed change record must explicitly contain both independently approved values. `--check-target` performs only this parse/compare with no network or mutation, `--apply` performs idempotent provisioning after the same check, and `--check` is read-only settings verification after the same check. Never print the service-role key. `POST .../media/finalize` accepts only that path/type, re-checks ownership, reads server-side object metadata and rejects/deletes an oversized object before loading its bytes, then performs magic/structure/pixel validation. Only validated originals and derivatives move to the existing public asset bucket. Finalize always deletes quarantine in `finally`; issuing a new session also best-effort deletes that user's quarantined objects older than 24 hours. The legacy multipart `/media` route remains for existing W1 uploads within its current transport limit, while all new STK media fields use session → signed upload → finalize.

Construct final object keys without leading separators:

```ts
const sitePrefix = `${workspaceId}/expo/${siteId}`;
const originalKey = `${sitePrefix}/original-${crypto.randomUUID()}.${ext}`;
const optimizedKey = `${sitePrefix}/optimized-${crypto.randomUUID()}.${ext}`;
```

Normalize and reject any key containing an empty segment, `.` or `..`; ownership tests compare these exact slash-delimited prefixes. On partial failure remove only paths created by that request. Extend template media copying to copy `url`, `originalUrl`, PNG/SVG/MP4 extensions, while retaining source/destination prefix safety.

All three routes reuse the common route guard's project role result and reject VIEWER. They never trust client MIME, size, or a client-provided storage path.

- [ ] **Step 4: Add crop/alt UI and pass tests**

```ts
export interface ExpoMediaUploadFieldProps {
  siteId: string;
  kind: "image" | "video";
  value?: ExpoImageValue | ExpoVideoValue;
  disabled?: boolean;
  onChange(next: ExpoImageValue | ExpoVideoValue | undefined): void;
}

export interface ImageCropFieldProps {
  image: ExpoImageValue;
  value: ImageCrop;
  aspectRatio?: number;
  disabled?: boolean;
  onChange(next: ImageCrop): void;
}
```

`ExpoMediaUploadField` owns session → signed upload → finalize progress/retry, preserves the latest `onChange` through long uploads, supports a validated external HTTPS URL, and returns the canonical image/video object. A newly selected video always starts with `rightsStatus:"unconfirmed"`; only the adjacent Hero control can change it. Existing `SlotField` delegates image media to this field; `CampaignHeroEditor` uses its video mode and keeps rights selection adjacent. `ImageCropField` has fit select, x/y sliders, scale slider, keyboard labels, Reset, and adjacent preview using the same object-position/transform formula as the runtime. Image mode exposes alt and an explicit decorative toggle; clearing alt without checking decorative leaves a publish error.

```bash
npx vitest run src/lib/expo/__tests__/image-guard.test.ts src/lib/expo/__tests__/svg-guard.test.ts src/lib/expo/__tests__/video-guard.test.ts src/lib/expo/__tests__/media.test.ts src/lib/expo/__tests__/quarantine-bucket.test.ts src/app/api/expo/__tests__/media-route.test.ts src/app/api/expo/__tests__/media-session-route.test.ts src/app/api/expo/__tests__/media-finalize-route.test.ts src/components/expo/__tests__/media-upload-field.test.tsx src/components/expo/__tests__/image-crop-field.test.tsx
npx tsc --noEmit -p tsconfig.json
```

Expected: malicious SVG fixtures fail before any public final object exists, quarantine/original/derivative ownership and cleanup pass, WebP remains supported, MP4 validates, crop is accessible.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/ensure-expo-quarantine-bucket.mjs src/lib/expo src/app/api/expo/'[siteId]'/media src/app/api/expo/__tests__/media-route.test.ts src/app/api/expo/__tests__/media-session-route.test.ts src/app/api/expo/__tests__/media-finalize-route.test.ts src/components/expo
git commit -m "feat: add safe Expo media derivatives and crop"
```

### Task 9: Render the six STK plugins in the shared Shadow DOM runtime

**Files:**

- Create: `src/lib/expo/renderers/action.ts`
- Create: `src/lib/expo/renderers/image.ts`
- Create: `src/lib/expo/renderers/campaign-hero.ts`
- Create: `src/lib/expo/renderers/exhibition-grid.ts`
- Create: `src/lib/expo/renderers/audience-links.ts`
- Create: `src/lib/expo/renderers/speaker-carousel.ts`
- Create: `src/lib/expo/renderers/sponsor-marquee.ts`
- Create: `src/lib/expo/renderers/cta-band.ts`
- Modify: `src/lib/expo/view-sections.ts`
- Modify: `src/lib/expo/view-page.ts`
- Modify: `src/lib/expo/mount.ts`
- Modify: `src/lib/expo/expo-shell.css`
- Modify: `src/embed/expo-entry.ts`
- Regenerate: `src/lib/expo/shell-css.ts`
- Regenerate: `src/generated/expo-runtime.ts`
- Create: `src/lib/expo/renderers/__tests__/action.test.ts`
- Create: `src/lib/expo/renderers/__tests__/stk-sections.test.ts`
- Modify: `src/lib/expo/__tests__/view-sections.test.ts`
- Modify: `src/lib/expo/__tests__/mount.test.ts`
- Modify: `src/lib/expo/__tests__/shell-css.test.ts`
- Modify: `src/lib/__tests__/embed-build-pipeline.test.ts`
- Modify: `src/lib/__tests__/embed-runtime.test.ts`

**Interfaces:**

- Produces: six accessible public renderers, shared destination actions, one lifecycle/disposer chain, and identical dynamic/preview/standalone rendering.
- Consumes: Task 6 `SectionRenderContext` and Task 7 canonical content.

- [ ] **Step 1: Write failing behavior-focused renderer tests**

```ts
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { renderDestinationAction } from "@/lib/expo/renderers/action";
import type { DestinationAction } from "@/lib/expo/types";

describe("destination actions", () => {
  it.each(["url", "anchor", "download"] as const)("renders %s as a real anchor", (type) => {
    const action: DestinationAction = type === "url"
      ? { type, href: "https://smarttechkorea.com/214" }
      : type === "anchor"
        ? { type, target: "newsletter" }
        : { type, href: "https://cdn.example.com/stk-2027.pdf" };
    const expectedHref = action.type === "anchor" ? "#newsletter" : action.href;
    const node = renderDestinationAction(document, { id: "action", label: "열기", action }, { className: "msx-btn", mode: "live" });
    expect(node?.tagName).toBe("A");
    expect(node?.getAttribute("href")).toBe(expectedHref);
  });

  it("renders a modal as a button with a working handler", () => {
    const openModalMenu = vi.fn();
    Object.assign(window, { SITE: { openModalMenu } });
    const node = renderDestinationAction(document, { id: "inquiry", label: "문의", action: { type: "imweb-modal", modalId: "mInquiry" } }, { className: "msx-btn", mode: "live" });
    node?.click();
    expect(openModalMenu).toHaveBeenCalledWith("mInquiry");
  });
});
```

Add renderer tests for: Hero accessible heading fallback and reduced-motion poster; exhibition grayscale-to-color symbol class; two fixed audience groups; speaker category filtering/order/keyboard controls/lazy images/crop plus the approved black-card/category-gradient palette; sponsor single stored list plus cloned animation track and reduced-motion static grid; CTA Band right-arrow text and no dead button; empty enabled data hides the section.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/expo/renderers/__tests__ src/lib/expo/__tests__/view-sections.test.ts src/lib/expo/__tests__/mount.test.ts src/lib/expo/__tests__/shell-css.test.ts
```

Expected: renderer modules and STK dispatch are missing.

- [ ] **Step 3: Implement pure DOM rendering and destination actions**

```ts
export interface DestinationRenderOptions {
  className: string;
  description?: string;
  arrow?: "right" | "none";
  mode: SectionRenderContext["mode"];
}

export function renderDestinationAction(
  doc: Document,
  destination: ResolvedDestination,
  options: DestinationRenderOptions,
): HTMLAnchorElement | HTMLButtonElement | null;
```

URL/download/anchor use `<a>`; download adds `download` and `rel="noopener"`; external new tabs add `target="_blank" rel="noopener noreferrer"`. Modal uses `<button type="button">` and calls the Imweb-documented `window.SITE.openModalMenu(modalId)` only when that function exists; it otherwise dispatches a cancelable `msx:imweb-modal` event, then uses `fallbackHref` when no handler claimed the event. The integration name is backed by the [official Imweb modal-link guide](https://imweb.me/qna?mode=faq&q=71424), but real `/214` verification remains mandatory because Imweb labels custom-code integrations as update-sensitive. Every renderer passes `context.mode`. Only `mode:"live"` dispatches the composed `msx:destination` event or pushes `{ event, content_id, destination_id }` when `window.dataLayer` is an array; `preview-draft`, `preview-published`, and `standalone` perform the destination action without analytics. Add a regression for zero event/dataLayer writes in all three non-live modes. It never evaluates stored code or writes a `javascript:` URL.

Renderer requirements:

- Hero: semantic `<h1>` from `accessibleHeadline`; muted looped inline MP4 only outside reduced-motion; poster fallback; typing timers and listeners return one disposer; no parallax in reduced-motion.
- Exhibition: valid enabled item count determines columns/count; symbols use `filter: grayscale(1)` normally and full source color on hover/focus; no hard-coded six in DOM/CSS/JS.
- Audience links: exactly Exhibitors and Visitors groups, destination-aware anchors/buttons, responsive stacked layout.
- Speaker: categories with public speakers only; allowlisted badge/gradient tokens become CSS custom properties; roving tab focus supports ArrowLeft/Right/Home/End; pointer drag and touch use Pointer Events; images use `loading="lazy"`; crop formula is shared with Task 8. Preserve the approved flat `#0B0C0E` card surface with no metallic/pattern effect, and use category color only in the top badge and lower information gradient: Robotics `#2F9B63 → #104D2D`, AI `#3468D9 → #12306C`, Autonomous Manufacturing `#65D5BD → #125B4C`. White information text must pass contrast on every gradient; the mint badge uses dark ink.
- Sponsor: renderer creates the second track only when marquee is enabled and motion is allowed; reduced-motion uses one wrapping grid.
- CTA Band: full-bleed dark section with no outer white border/gutter, sharp rectangular cards, a plain/secondary brochure style, orange/primary inquiry style, and one simple `→` on the right. These are variant tokens, not STK copy checks.

All text flows through `h()`/`textContent`. Unknown destinations produce no control. Every timer, observer, pointer listener, and media listener is registered in the section disposer.

- [ ] **Step 4: Build CSS/runtime and pass regressions**

```bash
npm run build:expo-shell-css
npm run build:expo-runtime
npx vitest run src/lib/expo/renderers/__tests__ src/lib/expo/__tests__/view-sections.test.ts src/lib/expo/__tests__/mount.test.ts src/lib/expo/__tests__/shell-css.test.ts src/lib/__tests__/embed-build-pipeline.test.ts src/lib/__tests__/embed-runtime.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: generated artifacts match sources; lifecycle and reduced-motion tests pass; no React code enters the runtime bundle.

- [ ] **Step 5: Commit**

```bash
git add src/lib/expo src/embed/expo-entry.ts src/generated/expo-runtime.ts
git commit -m "feat: render STK homepage sections"
```

### Task 10: Create the cloneable STK preset and deterministic source importer

**Files:**

- Create: `src/lib/expo/presets/stk-home-v1.json`
- Create: `src/lib/expo/presets/stk-home-v1.ts`
- Create: `src/lib/expo/presets/index.ts`
- Create: `scripts/import-stk-home-v1.mjs`
- Create: `src/lib/expo/__tests__/stk-preset.test.ts`
- Modify: `src/lib/expo/template.ts`
- Modify: `src/lib/expo/template-service.ts`
- Modify: `src/app/api/expo/templates/route.ts`
- Modify: `src/app/api/expo/templates/[templateId]/instantiate/route.ts`
- Modify: `src/components/expo/ExpoCreateChoices.tsx`
- Modify: `src/lib/expo/__tests__/template.test.ts`
- Modify: `src/lib/expo/__tests__/template-service.test.ts`
- Modify: `src/app/api/expo/__tests__/template-routes.test.ts`
- Modify: `src/components/expo/__tests__/template-save.test.tsx`

**Interfaces:**

- Produces: immutable built-in preset id `stk-home-v1`, clone-safe fresh `sid`s, a dry-run source auditor, and structured missing-input output.
- Consumes: approved current STK HTML/assets only; it never scrapes or mutates the live page.

- [ ] **Step 1: Write failing preset invariants and dry-run tests**

```ts
import { describe, expect, it } from "vitest";
import { instantiateBuiltInPreset } from "@/lib/expo/presets";

describe("stk-home-v1", () => {
  it("contains the approved managed content counts", () => {
    const page = instantiateBuiltInPreset("stk-home-v1", { randomUUID: () => crypto.randomUUID() });
    expect(page.schemaVersion).toBe(2);
    expect(page.sections.map((section) => section.type)).toEqual([
      "campaign-hero",
      "exhibition-grid",
      "audience-links",
      "speaker-carousel",
      "sponsor-marquee",
      "cta-band",
    ]);
    const exhibition = page.sections.find((section) => section.type === "exhibition-grid")!;
    const audience = page.sections.find((section) => section.type === "audience-links")!;
    const speakers = page.sections.find((section) => section.type === "speaker-carousel")!;
    const sponsors = page.sections.find((section) => section.type === "sponsor-marquee")!;
    const finalCta = page.sections.find((section) => section.type === "cta-band")!;
    expect((exhibition.content.items as unknown[]).length).toBe(6);
    expect((audience.content.groups as Array<{ items: unknown[] }>).reduce((sum, group) => sum + group.items.length, 0)).toBe(8);
    expect((speakers.content.categories as unknown[]).length).toBe(3);
    expect((speakers.content.speakers as unknown[]).length).toBe(28);
    expect((speakers.content.categories as Array<{ id: string; badgeToken: string; gradientToken: string }>).map(({ id, badgeToken, gradientToken }) => ({ id, badgeToken, gradientToken }))).toEqual([
      { id: "robotics", badgeToken: "robotics", gradientToken: "robotics" },
      { id: "ai", badgeToken: "ai", gradientToken: "ai" },
      { id: "autonomous-manufacturing", badgeToken: "autonomous-manufacturing", gradientToken: "autonomous-manufacturing" },
    ]);
    expect((sponsors.content.groups as unknown[]).length).toBe(4);
    expect((finalCta.content.ctas as unknown[]).length).toBe(2);
  });

  it("creates fresh sid values on every clone", () => {
    const first = instantiateBuiltInPreset("stk-home-v1");
    const second = instantiateBuiltInPreset("stk-home-v1");
    expect(first.sections.map((section) => section.sid)).not.toEqual(second.sections.map((section) => section.sid));
  });
});
```

The importer test runs without DB/network access and fails if it sees `href="#"`, an absolute local path, a relative media path, duplicate semantic ids, broken references, or unexpected content counts.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/expo/__tests__/stk-preset.test.ts src/lib/expo/__tests__/template.test.ts src/lib/expo/__tests__/template-service.test.ts src/app/api/expo/__tests__/template-routes.test.ts src/components/expo/__tests__/template-save.test.tsx
node scripts/import-stk-home-v1.mjs --dry-run
```

Expected: preset/importer are absent.

- [ ] **Step 3: Encode the approved source inventory deterministically**

Use these read-only sources:

```text
Hero       <attachment>/pasted-text.txt
Exhibition <attachment>/pasted-text.txt
Audience   <attachment>/pasted-text.txt
Speakers   <attachment>/pasted-text.txt
Sponsors   <attachment>/pasted-text.txt
Final CTA  <attachment>/pasted-text.txt
```

Exclude the newsletter source `e6b9523e-f66c-469f-b897-ff18c252a413`; it remains Imweb/Stibee-owned.

The committed JSON contains stable semantic item/category/speaker/group/CTA ids and known copy, but no fabricated URL, modal id, campaign date, video-rights confirmation, or logo. Missing required media/destinations remain omitted in the draft and are surfaced by publish readiness. Sponsor groups are preserved, while the prior sample marks are not represented as real sponsors.

The exhibition display order is fixed from the approved source: AI & Data Center Show → Robot Tech & Physical AI Show → AI Factory Show → Secu Tech Show → Retail & Logis Tech Show → Smart Tech Show. Preset tests assert this order so table sorting or source parsing cannot silently revert it.

Speaker invariants are exactly 28: Robotics 9, AI 11, Autonomous Manufacturing 8. Use the reviewed user image/source spellings and roles, category tokens above, and `design.bg="dark"`; Task 9 maps those tokens to the already approved black/green/blue/mint visual values from the source HTML. The JSON file has the shape `{ config, sourceNotes }`; `sourceNotes` records source-label discrepancies for operators, while `instantiateBuiltInPreset()` returns only `config`, so notes can never enter a public payload.

The importer has only these modes:

```text
node scripts/import-stk-home-v1.mjs --dry-run
node scripts/import-stk-home-v1.mjs --dry-run --asset-map=/absolute/path/assets.json --destination-map=/absolute/path/destinations.json --schedule-map=/absolute/path/schedules.json
node scripts/import-stk-home-v1.mjs --output=/absolute/path/stk-home-v1.materialized.json --asset-map=/absolute/path/assets.json --destination-map=/absolute/path/destinations.json --schedule-map=/absolute/path/schedules.json
```

Default is `--dry-run`. `--output` requires all three complete maps and writes only the explicit local JSON path; it never opens the network or database. Missing keys are printed as sorted JSON arrays and exit code 2; unsafe values exit code 1. Actual page creation happens later through the authenticated built-in preset UI and Task 2 authorization.

- [ ] **Step 4: Merge the built-in preset into template create/instantiate paths**

```ts
export interface BuiltInExpoPreset {
  id: "stk-home-v1";
  name: string;
  description: string;
  instantiate(input?: { randomUUID?: () => string }): ExpoPageConfigV2;
}

export function builtInExpoPresets(): readonly BuiltInExpoPreset[];
export function instantiateBuiltInPreset(id: string, input?: { randomUUID?: () => string }): ExpoPageConfigV2;
```

Built-in presets cannot be renamed/deleted. Instantiation regenerates section `sid`s only, preserves semantic row/destination/category ids inside the new page, strips editor-only row keys, starts `embedEnabled:false`, and copies no foreign Storage ownership.

```bash
npx vitest run src/lib/expo/__tests__/stk-preset.test.ts src/lib/expo/__tests__/template.test.ts src/lib/expo/__tests__/template-service.test.ts src/app/api/expo/__tests__/template-routes.test.ts src/components/expo/__tests__/template-save.test.tsx
node scripts/import-stk-home-v1.mjs --dry-run || [ "$?" -eq 2 ]
npx tsc --noEmit -p tsconfig.json
```

Expected: six sections/counts/reference invariants pass; dry-run lists only genuinely missing operational values and performs zero writes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/expo/presets scripts/import-stk-home-v1.mjs src/lib/expo/template.ts src/lib/expo/template-service.ts src/app/api/expo/templates src/components/expo/ExpoCreateChoices.tsx src/lib/expo/__tests__ src/app/api/expo/__tests__ src/components/expo/__tests__
git commit -m "feat: add the STK homepage preset"
```

### Task 11: Lift one autosaved draft into the three-column workspace

**Files:**

- Create: `src/lib/expo/editor-dto.ts`
- Create: `src/lib/expo/use-page-draft.ts`
- Create: `src/components/expo/PageDraftWorkspace.tsx`
- Create: `src/components/expo/ExpoSectionTree.tsx`
- Modify: `src/components/expo/ExpoSiteEditor.tsx`
- Modify: `src/components/expo/SectionEditor.tsx`
- Modify: `src/components/expo/ExpoPublishPanel.tsx`
- Modify: `src/components/expo/ExpoRevisionPanel.tsx`
- Create: `src/lib/expo/__tests__/use-page-draft.test.tsx`
- Create: `src/components/expo/__tests__/section-tree.test.tsx`
- Modify: `src/components/expo/__tests__/section-editor.test.tsx`
- Modify: `src/components/expo/__tests__/site-editor-preview.test.tsx`

**Interfaces:**

- Produces: one shared draft owner for left structure, center fields, and right preview.
- Consumes: existing `usePageAutosave` 900ms CAS behavior.

```ts
export interface ExpoPageEditorDto {
  id: string;
  siteId: string;
  slug: string;
  title: string;
  imwebUrl: string | null;
  draft: ExpoPageConfigV2;
  draftRevision: number;
  codeDigest: string;
  publishedCodeDigest: string;
  hasPublished: boolean;
  publishedAt: string | null;
  liveAt: string | null;
  updatedAt: string;
  readiness: ExpoReadinessView;
  snippets: ExpoSnippetsView;
  lastSeenAt?: string | null;
  lastSeenOrigin?: string | null;
}

export interface ExpoPageSaveRequest {
  title: string;
  imwebUrl: string;
  draft: ExpoPageConfigV2;
  draftRevision: number;
}

export type ExpoEditorRequest = (path: string, init?: RequestInit) => Promise<Response>;

export interface ExpoPageTransport {
  load(pageId: string): Promise<ExpoPageEditorDto>;
  save(pageId: string, request: ExpoPageSaveRequest): Promise<ExpoSaveOutcome>;
  request: ExpoEditorRequest;
}

export interface PageDraftWorkspaceProps {
  siteId: string;
  pageId: string;
  permissions: ExpoPermissions;
  transport?: ExpoPageTransport;
}
```

Move the existing `ExpoReadinessView`/`ExpoSnippetsView` DTO types from `ExpoPublishPanel.tsx` into `editor-dto.ts`, keeping that module React-free. Production uses a fetch-backed transport. `PageDraftWorkspace` passes `transport.request` into publish, live, `ExpoRevisionPanel` history/rollback, and later export controls; those components default to `window.fetch` only when no transport was injected. Tests assert the injected router receives all five operations while global fetch receives none. Task 15 harness injects the same in-memory request router, allowing the complete editor flow to run with no auth or database request.

- [ ] **Step 1: Write failing shared-state and conflict tests**

These TSX files use the Task 5 Testing Library setup and each starts with `/** @vitest-environment jsdom */`. Autosave tests use this exact fake-timer lifecycle so `user-event` and the 900ms debounce share one clock:

```ts
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
```

Make the injected transport's initial `load()` an already-resolved promise, flush that microtask with `await act(async () => {})` immediately after render, and then use synchronous role queries; do not use fake-timer `findBy` polling as load synchronization.

```tsx
it("keeps tree, editor, and preview on one draft", async () => {
  render(<PageDraftWorkspace siteId="site-1" pageId="page-1" permissions={{ canEdit: true, canPublish: true, canManageSite: false, canManageTemplates: false }} transport={transport} />);
  await act(async () => {});
  await user.click(screen.getByRole("button", { name: "Speakers 편집" }));
  await user.type(screen.getByLabelText("섹션 제목"), " 2027");
  expect(screen.getByTestId("expo-preview")).toHaveAttribute("data-selected-sid", expect.any(String));
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(save).toHaveBeenCalledTimes(1);
});

it("stops autosave after a 409 conflict", async () => {
  save.mockResolvedValueOnce({ kind: "conflict", revision: 12 });
  render(<PageDraftWorkspace siteId="site-1" pageId="page-1" permissions={editorPermissions} transport={transport} />);
  await act(async () => {});
  await user.type(screen.getByLabelText("페이지 제목"), " 충돌");
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(screen.getByText("다른 팀원이 먼저 저장했어요")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "최신 내용 다시 불러오기" })).toBeEnabled();
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/expo/__tests__/use-page-draft.test.tsx src/components/expo/__tests__/section-tree.test.tsx src/components/expo/__tests__/section-editor.test.tsx src/components/expo/__tests__/site-editor-preview.test.tsx
```

Expected: `PageForm` still owns the draft and the left tree cannot update it.

- [ ] **Step 3: Implement the shared hook and workspace**

```ts
export interface ExpoPageDraftState {
  config: ExpoPageConfigV2;
  updateConfig(updater: (current: ExpoPageConfigV2) => ExpoPageConfigV2): void;
  title: string;
  setTitle(value: string): void;
  imwebUrl: string;
  setImwebUrl(value: string): void;
  selectedSid: string | null;
  setSelectedSid(sid: string | null): void;
  loading: boolean;
  error: string | null;
  saveState: "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";
  reloadAfterConflict(): Promise<void>;
}

export function useExpoPageDraft(
  siteId: string,
  pageId: string,
  transport?: ExpoPageTransport,
): ExpoPageDraftState;
```

`PageDraftWorkspace` renders:

1. left `ExpoSectionTree`: selection, drag order, enabled/embed status, row issue count;
2. center selected section editor or page settings;
3. right existing preview pane.

Selection is persistent by `sid`. Preview click selects that `sid`; deleting the selected section chooses the next neighbor then previous neighbor; sorting never changes it. Only the hook calls the API/autosave. No child owns a shadow draft.

Tree drag reuses `src/components/ui/editable-list.tsx`, respects `canEdit`, announces movement to screen readers, and updates the one config. The 409 state freezes further autosaves until explicit reload; it does not merge or discard local state automatically.

- [ ] **Step 4: Run component and type tests**

```bash
npx vitest run src/lib/expo/__tests__/use-page-draft.test.tsx src/components/expo/__tests__/section-tree.test.tsx src/components/expo/__tests__/section-editor.test.tsx src/components/expo/__tests__/site-editor-preview.test.tsx
npx tsc --noEmit -p tsconfig.json
```

Expected: one 900ms save per burst, conflict stop/reload, stable selection, drag, read-only behavior, and preview selection pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/expo/editor-dto.ts src/lib/expo/use-page-draft.ts src/lib/expo/__tests__/use-page-draft.test.tsx src/components/expo
git commit -m "refactor: share one Expo page draft across the editor"
```

### Task 12: Add page settings, six client-only editors, and campaign preview controls

**Files:**

- Create: `src/components/expo/ExpoPageSettings.tsx`
- Create: `src/components/expo/fields/InlineEditableTable.tsx`
- Create: `src/components/expo/fields/DestinationPicker.tsx`
- Create: `src/components/expo/fields/CampaignPicker.tsx`
- Create: `src/components/expo/section-editors/CampaignHeroEditor.tsx`
- Create: `src/components/expo/section-editors/ExhibitionGridEditor.tsx`
- Create: `src/components/expo/section-editors/AudienceLinksEditor.tsx`
- Create: `src/components/expo/section-editors/SpeakerCarouselEditor.tsx`
- Create: `src/components/expo/section-editors/SponsorMarqueeEditor.tsx`
- Create: `src/components/expo/section-editors/CtaBandEditor.tsx`
- Create: `src/components/expo/section-editors/registry.tsx`
- Modify: `src/components/expo/SectionEditor.tsx`
- Modify: `src/components/expo/ExpoSiteEditor.tsx`
- Modify: `src/app/hp/[token]/route.ts`
- Create: `src/components/expo/__tests__/inline-editable-table.test.tsx`
- Create: `src/components/expo/__tests__/page-settings.test.tsx`
- Create: `src/components/expo/__tests__/stk-section-editors.test.tsx`
- Modify: `src/components/expo/__tests__/section-editor.test.tsx`
- Modify: `src/components/expo/__tests__/site-editor-preview.test.tsx`
- Modify: `src/app/hp/__tests__/preview.test.ts`

**Interfaces:**

- Produces: STK inline editing, campaign/destination settings, row-level issue navigation, and five unsaved preview states.
- Consumes: Task 7 plugins, Task 8 crop/media, Task 11 shared draft.

- [ ] **Step 1: Write failing inline-table, editor-registry, and preview-mode tests**

These TSX files use the Task 5 Testing Library setup and each starts with `/** @vitest-environment jsdom */`; initialize `const user = userEvent.setup()` inside each test.

```tsx
it("changes preview campaign state without changing the draft", async () => {
  render(<PageDraftWorkspace siteId="site-1" pageId="page-1" permissions={editorPermissions} transport={transport} />);
  const before = structuredClone(currentDraft);
  await user.selectOptions(await screen.findByLabelText("캠페인 미리보기"), "both");
  expect(screen.getByTitle("홈페이지 미리보기")).toHaveAttribute("src", expect.stringContaining("campaignState=both"));
  expect(currentDraft).toEqual(before);
  expect(save).not.toHaveBeenCalled();
});
```

Add tests for desktop grid/mobile card rows, drag, one-click public toggle, image thumbnail, inline errors, guarded category/group deletion, DestinationPicker disabled rows, CampaignPicker two independent selections, each of the six editor dispatches, and VIEWER controls disabled. Page-settings tests cover date/time/offset round trips, invalid interval field paths, independent campaign overrides, destination action switching, and analytics allowlists.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/components/expo/__tests__/inline-editable-table.test.tsx src/components/expo/__tests__/page-settings.test.tsx src/components/expo/__tests__/stk-section-editors.test.tsx src/components/expo/__tests__/section-editor.test.tsx src/components/expo/__tests__/site-editor-preview.test.tsx src/app/hp/__tests__/preview.test.ts
```

Expected: custom editors/settings and preview mode query do not exist.

- [ ] **Step 3: Implement page settings and shared table fields**

`ExpoPageSettings` edits event edition/dates/facts, campaign labels/dates/override/enabled, and destinations/actions/analytics. Each schedule uses separate date, time, and numeric UTC-offset controls; serialization concatenates `YYYY-MM-DD`, `HH:mm:ss`, and `Z|±HH:mm` directly. It never passes an offset-less value through `Date`, so browser locale cannot silently change the intended instant.

```ts
export interface InlineEditableTableProps<Row extends { id: string }> {
  ariaLabel: string;
  rows: readonly Row[];
  disabled?: boolean;
  issues: readonly FieldIssue[];
  renderRow(row: Row, index: number): ReactNode;
  onChange(rows: Row[]): void;
  canDelete?(row: Row): true | string;
}
```

`canDelete` returns a reason string for referenced categories/groups and opens confirmation only for allowed destructive deletion. At 390px rows become stacked cards; no horizontal page overflow is allowed.

- [ ] **Step 4: Implement six editors and preview-only forcing**

Client registry:

```ts
export function sectionEditorFor(type: string): ComponentType<SectionEditorProps> | null;
```

It imports all six editor components; no file under `src/lib/expo/` imports this registry. `SectionEditor` passes `siteId`, locale, source options, and same-site page targets through `SectionEditorProps`; it never lets a custom editor read sidebar project context. Custom editors reuse `SlotField`/`ExpoMediaUploadField` for localized scalars/media and shared table/pickers for complex rows. Speaker editor places `ImageCropField` beside the current card preview. Hero editor requires explicit video-rights selection. CTA editors show the resolved action summary, priority, fallback, audience, and campaign conditions.

Preview mode map is exact:

```ts
export function forcedCampaignsForPreview(mode: CampaignPreviewMode): Readonly<Record<string, boolean>> | undefined {
  if (mode === "current") return undefined;
  if (mode === "exhibitor") return { "exhibitor-recruitment": true, "visitor-registration": false };
  if (mode === "visitor") return { "exhibitor-recruitment": false, "visitor-registration": true };
  if (mode === "both") return { "exhibitor-recruitment": true, "visitor-registration": true };
  return { "exhibitor-recruitment": false, "visitor-registration": false };
}
```

Only `/hp/{token}` accepts the whitelisted `campaignState` query. Live loader/export never accept client forcing. The select changes iframe URL only and never draft state.

```bash
npx vitest run src/components/expo/__tests__/inline-editable-table.test.tsx src/components/expo/__tests__/page-settings.test.tsx src/components/expo/__tests__/stk-section-editors.test.tsx src/components/expo/__tests__/section-editor.test.tsx src/components/expo/__tests__/site-editor-preview.test.tsx src/app/hp/__tests__/preview.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: all six editors, responsive rows, references, crop, settings, and five preview states pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/expo src/app/hp/'[token]'/route.ts src/app/hp/__tests__/preview.test.ts
git commit -m "feat: add the STK three-column homepage editor"
```

### Task 13: Bound dynamic-cache staleness, stage remounts, and show connection state

**Files:**

- Modify: `src/app/h/[pageId]/loader.ts`
- Modify: `src/app/h/[pageId]/route.ts`
- Modify: `src/app/h/[pageId]/[sid]/route.ts`
- Modify: `src/app/hp/[token]/route.ts`
- Modify: `src/lib/expo/shadow.ts`
- Modify: `src/lib/expo/mount.ts`
- Modify: `src/embed/expo-entry.ts`
- Create: `src/lib/expo/connection-status.ts`
- Modify: `src/components/expo/ExpoPublishPanel.tsx`
- Modify: `src/app/api/expo/pages/[pageId]/route.ts`
- Modify: `src/app/h/__tests__/loader.test.ts`
- Modify: `src/app/hp/__tests__/preview.test.ts`
- Modify: `src/lib/expo/__tests__/shadow.test.ts`
- Modify: `src/lib/expo/__tests__/mount.test.ts`
- Create: `src/lib/expo/__tests__/connection-status.test.ts`
- Modify: `src/components/expo/__tests__/publish-panel.test.tsx`

**Interfaces:**

- Produces: server-time campaign payloads with at most 60s stale delivery, atomic staged shell replacement, and four-state connection diagnostics.
- Consumes: Task 1 payload resolution, Task 9 render lifecycle, and existing seen beacon storage.

- [ ] **Step 1: Write failing cache, remount, and connection tests**

```ts
import { describe, expect, it } from "vitest";
import { deriveExpoConnectionStatus } from "@/lib/expo/connection-status";

describe("Expo connection status", () => {
  const now = new Date("2026-09-01T03:00:00.000Z");

  it("distinguishes never seen, wrong host, recent, and stale", () => {
    expect(deriveExpoConnectionStatus({ imwebUrl: "https://smarttechkorea.com/214", lastSeenAt: null, lastSeenOrigin: null, now }).state).toBe("uninstalled");
    expect(deriveExpoConnectionStatus({ imwebUrl: "https://smarttechkorea.com/214", lastSeenAt: "2026-09-01T02:59:00.000Z", lastSeenOrigin: "https://other.example", now }).state).toBe("wrong-origin");
    expect(deriveExpoConnectionStatus({ imwebUrl: "https://smarttechkorea.com/214", lastSeenAt: "2026-09-01T02:51:00.000Z", lastSeenOrigin: "https://smarttechkorea.com", now }).state).toBe("connected");
    expect(deriveExpoConnectionStatus({ imwebUrl: "https://smarttechkorea.com/214", lastSeenAt: "2026-09-01T02:49:59.000Z", lastSeenOrigin: "https://smarttechkorea.com", now }).state).toBe("verify");
  });
});
```

Loader tests assert exact headers, that live routes ignore `campaignState`, schedule/override strings are absent from script bodies, and ETag changes when resolved active state changes. Live and preview regressions insert a `sourceRef` owned by another project and assert it is blanked before payload creation, while a same-project, non-deleted, `mode:"builder"` source survives. Mount tests create a successful first renderer and a throwing second renderer, then assert the first DOM/listener remains until a successful commit; a `register-form` stub also asserts its attach callback sees `root.isConnected === true`.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/app/h/__tests__/loader.test.ts src/app/hp/__tests__/preview.test.ts src/lib/expo/__tests__/shadow.test.ts src/lib/expo/__tests__/mount.test.ts src/lib/expo/__tests__/connection-status.test.ts src/components/expo/__tests__/publish-panel.test.tsx
```

Expected: live SWR is 86400s, old shell resets before a new render succeeds, and no connection helper exists.

- [ ] **Step 3: Resolve live payloads on the server and bound CDN staleness**

The live loader normalizes the published page once, applies the existing page-versus-`sid` enabled/embed gates, then derives `safeSelectedSections` exactly as follows: collect every selected `sourceRef`; query `CollectSource` with `id in refs`, the owning `row.site.projectId`, `deletedAt:null`, and `mode:"builder"`; blank any unverified ref before payload creation, failing closed to an empty allowed set on query error. The preview route performs the same check with `site.projectId`. Then call `buildExpoPayload({ ...publishedConfig, sections: safeSelectedSections }, { locale, pages, now: new Date() })`; this preserves page settings while never leaking an unselected section or cross-project form. Connection-only responses keep an empty section list and the existing seen beacon. Only preview uses Task 12 forcing. Build ETag from runtime version plus the canonical resolved payload, so a campaign boundary changes it even when `published` is unchanged.

Use these exact live cache headers and merge them with the existing `SCRIPT_HEADERS`/CORS/nosniff/noindex headers; do not replace the existing security or cross-origin headers:

```ts
export const EXPO_LIVE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
} as const;
```

The normal CDN worst-case stale response is 60 seconds. Remove the prior `stale-while-revalidate=86400`. `/hp/` stays `no-store`, `force-dynamic`, and `noindex`.

- [ ] **Step 4: Stage the new shell and add connection UI**

```ts
export interface ExpoShellStage {
  shell: ExpoShellHandle;
  commit(): ExpoShellHandle;
  abort(): void;
}

export function stageExpoShell(options: ExpoShellOptions): ExpoShellStage | null;
```

Build the host/shadow/render root and all pure DOM while detached, but do not run lifecycle callbacks there. `commit()` first inserts the candidate immediately before the still-visible old host in a connected staging state (`inert`, `aria-hidden`, non-interactive/offscreen staging styles), then runs every `attach()` and `ready()` while `root.isConnected === true`. If either throws, remove and dispose only the staged candidate and leave the visible old shell/registry/events untouched. After every lifecycle succeeds, reveal the candidate, atomically swap the registry handle, remove the old host, and destroy the previous handle exactly once. `abort()` destroys only an uncommitted candidate. Successful same-target remount still disposes old timers/listeners exactly once; add a `register-form` regression so the existing connected-attach contract cannot drift.

```ts
export type ExpoConnectionState = "connected" | "verify" | "wrong-origin" | "uninstalled";

export interface ExpoConnectionStatus {
  state: ExpoConnectionState;
  label: string;
  detail: string;
}
```

Host comparison uses parsed lowercase hostnames, not string prefixes. Apply this exact priority: null `lastSeenAt` → `uninstalled`; otherwise invalid/missing `imwebUrl` or `lastSeenOrigin` → `verify`; differing valid host → `wrong-origin`; matching host and age `<= 10 * 60_000` → `connected`; older → `verify`. Page GET includes `lastSeenAt` and `lastSeenOrigin`. `pageWarnings()` combines this metadata with the existing `publishedAt`/`updatedAt` draft-ahead check for UI-only warnings. Publish panel shows them but never passes them to `publishErrors()` or blocks publish.

```bash
npm run build:expo-runtime
npx vitest run src/app/h/__tests__/loader.test.ts src/app/hp/__tests__/preview.test.ts src/lib/expo/__tests__/shadow.test.ts src/lib/expo/__tests__/mount.test.ts src/lib/expo/__tests__/connection-status.test.ts src/components/expo/__tests__/publish-panel.test.tsx src/lib/__tests__/embed-build-pipeline.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: exact cache headers, live/preview separation, staged failure preservation, and four connection states pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/h src/app/hp src/lib/expo src/embed/expo-entry.ts src/generated/expo-runtime.ts src/components/expo
git commit -m "feat: harden Expo dynamic delivery and connection status"
```

### Task 14: Export published page or section as standalone HTML

**Files:**

- Create: `src/lib/expo/export.ts`
- Create: `src/lib/expo/__tests__/export.test.ts`
- Create: `src/embed/expo-standalone-entry.ts`
- Create: `scripts/build-expo-standalone-runtime.mjs`
- Create/regenerate: `src/generated/expo-standalone-runtime.ts`
- Create: `src/app/api/expo/pages/[pageId]/export/route.ts`
- Create: `src/app/api/expo/__tests__/export-route.test.ts`
- Modify: `src/components/expo/ExpoPublishPanel.tsx`
- Modify: `src/components/expo/__tests__/publish-panel.test.tsx`
- Modify: `src/lib/expo/types.ts`
- Modify: `src/lib/expo/mount.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/__tests__/embed-build-pipeline.test.ts`

**Interfaces:**

- Produces: page/section `.html` downloads with inline CSS/runtime and frozen campaigns; no Mach API/auth dependency.
- Consumes: last published snapshot and Task 13 server resolution.

- [ ] **Step 1: Write failing standalone invariants**

```ts
import { describe, expect, it } from "vitest";
import { prepareStandaloneExpoHtml } from "@/lib/expo/export";
import { snapshotDigest } from "@/lib/expo/snapshot-digest";

describe("standalone Expo export", () => {
  it("freezes campaign state and contains no Mach network side effect", () => {
    const result = prepareStandaloneExpoHtml({
      pageId: "page-1",
      revisionSequence: 7,
      revisionCodeDigest: snapshotDigest(publishedConfig),
      exportedAt: new Date("2026-09-01T03:00:00.000Z"),
      scope: { type: "page" },
      config: publishedConfig,
      theme,
      locale: "ko",
      pages: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join(", "));
    const html = result.html;
    expect(html).toContain("pageId=page-1 revision=7");
    expect(html).toContain("exhibitor-recruitment:on");
    expect(html).not.toMatch(/fetch\s*\(|\/api\/|\/hp\/|reportExpoSeen/);
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
  });
});
```

Add tests for individual section scope, disabled/empty/missing section rejection, `register-form`/`custom-code` rejection, all media public HTTPS, modal fallback requirement, HTML escaping, and EDITOR/VIEWER authorization.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/expo/__tests__/export.test.ts src/app/api/expo/__tests__/export-route.test.ts src/components/expo/__tests__/publish-panel.test.tsx
```

Expected: export service/route/UI are missing.

- [ ] **Step 3: Implement a pure frozen export builder**

```ts
export type ExpoExportScope = { type: "page" } | { type: "section"; sid: string };

export interface StandaloneExpoInput {
  pageId: string;
  revisionSequence: number | null;
  revisionCodeDigest: string | null;
  exportedAt: Date;
  scope: ExpoExportScope;
  config: ExpoPageConfigV2;
  theme: ExpoTheme;
  locale: string;
  pages: LinkTarget[];
}

export type ExpoExportResult =
  | { ok: true; filename: string; html: string }
  | { ok: false; status: 409 | 422; issues: FieldIssue[] };

export function prepareStandaloneExpoHtml(input: StandaloneExpoInput): ExpoExportResult;
```

Resolve campaigns once at `exportedAt`, serialize only active booleans, and pass runtime mode `standalone`. Build a dedicated `EXPO_STANDALONE_RUNTIME_JS` from `src/embed/expo-standalone-entry.ts`; it imports no seen beacon, preview bridge, font fetch, form bridge, or custom-code module. Standalone mode also suppresses `dataLayer` writes. CSS and this network-free runtime JS are inline; system font fallback is used, while image/video URLs remain validated public HTTPS.

Serialize the resolved payload with the existing `jsonForScript()` boundary so stored `</script>`, `<!--`, U+2028, and U+2029 text cannot break out of the inline script. Escape comment metadata separately; never concatenate raw page/content text into HTML, CSS, or JavaScript source.

Page export includes enabled renderable managed sections regardless of `liveAt`. Section export requires an existing enabled, renderable section but deliberately ignores `embedEnabled`, because this is an authenticated recovery artifact rather than a live snippet.

`prepareStandaloneExpoHtml` recomputes `snapshotDigest(config)` and compares it with `revisionCodeDigest`. Legacy published pages with a null sequence/digest, or a digest that does not match the current published full-snapshot digest, return `409` code `standalone-republish-required`; the operator republishes once so the backup has trustworthy revision metadata.

Reject `register-form` and `custom-code` with code `standalone-unsupported`. An `imweb-modal` destination must have a validated public HTTPS `fallbackHref`; export rewrites it to a normal URL action. Without it, return `standalone-modal-fallback-required`. Include this escaped top comment:

```html
<!-- Mach Expo standalone: pageId=page-1 revision=7 exportedAt=2026-09-01T03:00:00.000Z campaigns=exhibitor-recruitment:on,visitor-registration:off -->
```

- [ ] **Step 4: Implement POST route and download UI**

POST body is `{ scope: "page" }` or `{ scope: "section", sid }`. Route derives page/site/project from URL, requires `canPublish`, reads the current published snapshot, site theme/default locale, same-site link targets collected from that snapshot, and latest revision sequence/digest. It never accepts a client snapshot/time/campaign override, and returns `Content-Disposition: attachment` with UTF-8-safe ASCII filename.

Publish panel offers 전체 HTML and per-section HTML. It states: “백업 HTML의 캠페인 상태는 다운로드 시점으로 고정됩니다. 일정이 바뀌면 다시 다운로드하세요.” Structured export errors focus the affected field.

Add `build:expo-standalone-runtime` to `package.json` and include it in `build:embed-runtimes`, so CI's stale-generated-artifact test covers `src/generated/expo-standalone-runtime.ts` exactly like the live runtime.

```bash
npm run build:expo-standalone-runtime
npx vitest run src/lib/expo/__tests__/export.test.ts src/app/api/expo/__tests__/export-route.test.ts src/components/expo/__tests__/publish-panel.test.tsx
npx vitest run src/lib/__tests__/embed-build-pipeline.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: independent HTML, scope rules, frozen campaigns, no-network invariant, fallback and authorization tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/build-expo-standalone-runtime.mjs src/embed/expo-standalone-entry.ts src/generated/expo-standalone-runtime.ts src/lib/expo src/lib/__tests__/embed-build-pipeline.test.ts src/app/api/expo/pages/'[pageId]'/export src/app/api/expo/__tests__/export-route.test.ts src/components/expo
git commit -m "feat: export Expo pages as standalone HTML"
```

### Task 15: Add DB-free Chromium/WebKit end-to-end verification and CI

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Modify: `src/app/dev/expo-hostile-harness/route.ts`
- Modify: `src/app/dev/expo-sections-harness/page.tsx`
- Create: `src/app/dev/expo-stk-runtime-harness/route.ts`
- Create: `src/app/dev/expo-stk-editor-harness/page.tsx`
- Create: `src/app/dev/expo-standalone-harness/route.ts`
- Create: `tests/expo-browser/stk-runtime.spec.ts`
- Create: `tests/expo-browser/stk-editor.spec.ts`
- Create: `tests/expo-browser/stk-export.spec.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Produces: repeatable DB-free desktop/mobile browser evidence for runtime, editor, hostile CSS, remount, autosave conflict, revisions, and export.
- Consumes: the real pure renderer/editor components with in-memory fixtures; no Prisma/Supabase request.

- [ ] **Step 1: Add Playwright and write the first failing desktop/mobile tests**

```bash
npm install --save-dev @playwright/test@1.51.1
```

```ts
import { expect, test } from "@playwright/test";

test("both campaigns show two ordered Hero actions", async ({ page }) => {
  await page.goto("/dev/expo-stk-runtime-harness?campaignState=both");
  const hero = page.locator("mach-expo-section").locator(".msx-campaign-hero");
  await expect(hero.getByRole("link").or(hero.getByRole("button"))).toHaveCount(2);
});

test("speaker tabs remain usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/expo-stk-runtime-harness?campaignState=current");
  const host = page.locator("mach-expo-section");
  await host.getByRole("tab", { name: "AI" }).press("ArrowRight");
  await expect(host.getByRole("tab", { name: "AUTONOMOUS MANUFACTURING" })).toBeFocused();
});
```

- [ ] **Step 2: Run Playwright and verify the missing harness failure**

```bash
npx playwright install chromium webkit
npx playwright test tests/expo-browser/stk-runtime.spec.ts --project=chromium-desktop
```

Expected: new harness is 404 or selectors are absent.

- [ ] **Step 3: Build production-404, DB-free harnesses and config**

Every harness begins with a production 404 guard. Runtime harness imports the actual generated runtime and a test-only complete fixture produced by materializing `stk-home-v1` in memory with synthetic `https://cdn.example.com/...` assets/destinations/schedules; these values never enter the committed preset or production UI. Playwright intercepts and fulfills every synthetic asset request and aborts any unhandled network request. Editor harness injects an in-memory transport implementing GET/save/publish/history/rollback/export responses; standalone harness serves Task 14 output. No harness imports `prisma`, Supabase clients, auth, or route handlers.

`playwright.config.ts` starts Next with an intentionally unreachable database:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/expo-browser",
  webServer: {
    command: "DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:1/invalid EXPO_SCHEMA_CAPABILITY=disabled EXPO_PUBLIC_EMBED_RELEASE=off npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/dev/expo-stk-runtime-harness",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "chromium-desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
    { name: "chromium-mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "webkit-desktop", use: { browserName: "webkit", viewport: { width: 1280, height: 800 } } },
    { name: "webkit-mobile", use: { browserName: "webkit", viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
```

The command must fail a test if any harness tries to reach the database; it must never substitute a shared `.env.local` database.

- [ ] **Step 4: Cover the full approved browser story**

`stk-runtime.spec.ts` covers six sections, current/exhibitor/visitor/both/ended, empty-data hiding, long speaker roles/categories, drag/touch/keyboard/lazy image/crop, sponsor cloning/reduced-motion, destination actions, 1280/390 overflow, hostile CSS, snippet reinsertion, container replacement, failed remount preserving old DOM, and exact visual screenshots.

`stk-editor.spec.ts` covers tree selection → center edit → 900ms save → preview update, preview click selection, drag, read-only VIEWER, 409 stop/reload, publish/history/rollback, row issue focus, and five preview states without saving.

`stk-export.spec.ts` covers whole/section download, frozen campaign comment, modal fallback, public asset requests only, and zero requests to `/api/`, `/h/`, `/hp/`, or another Mach endpoint after initial HTML navigation.

Add scripts:

```json
{
  "test:expo-browser": "playwright test tests/expo-browser",
  "test:expo-browser:chromium": "playwright test tests/expo-browser --project=chromium-desktop --project=chromium-mobile"
}
```

CI gets a separate `expo-browser` job after unit/type verification, installs Chromium/WebKit with dependencies, and uploads failure screenshots/traces only. It does not receive database or Supabase secrets.

```bash
npm run test:expo-browser
```

Expected: all four projects pass with no DB connection and no unexpected external request.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json playwright.config.ts src/app/dev tests/expo-browser .github/workflows/ci.yml
git commit -m "test: verify the STK homepage CMS in browsers"
```

### Task 16: Freeze the deployment and progressive Imweb cutover runbook

**Files:**

- Create: `docs/runbooks/stk-imweb-homepage-cutover.md`
- Create: `scripts/audit-expo-public-embeds.mjs`
- Create: `src/lib/expo/__tests__/public-embed-audit-cli.test.ts`

**Interfaces:**

- Produces: an exact, reversible operational sequence; it does not authorize or perform database/Imweb/public changes.

- [ ] **Step 1: Write the runbook with exact current Imweb ownership mapping**

```text
Hero         section s2026082007f2d0d1f6a91  widget w2026082080fc7e5443c45
Exhibitions  section s202607134cf85414453c0  widget w2026071352d517040e21c
Journey      section s202607138661e711f5fe6  widget w202607132bf43d8b3fc3f
Speakers     section s20260714177f0d9245356  widget w20260824c224e54449312
Sponsors     section s2026071446541061f23b8  widget w20260714051ec07cd954b
Final CTA    section s20260714d998c7ca8a48d  widget w202608311c96f8199245b
```

Mark these IDs as observed current evidence that must be re-read from Imweb before each mutation. Never target a widget solely from this document if the live editor differs.

- [ ] **Step 2: Record the schema/deployment gate**

The runbook must contain this exact stop/go order:

```text
reviewed branch and green DB-free tests
→ explicit no-live-broadcast window approval
→ verify parsed URL host/database/user against separately approved values, then read current_database/current_user/server address over direct PostgreSQL :5432
→ read-only partial unique index check returns 10/10
→ DATABASE_URL="$EXPO_SESSION_DATABASE_URL" node scripts/check-expo-schema.mjs --expect=v1
→ apply only supabase/migrations/20260901000000_expo_page_revisions.sql
→ DATABASE_URL="$EXPO_SESSION_DATABASE_URL" node scripts/check-expo-schema.mjs --expect=ready
→ verify partial unique indexes remain 10/10
→ verify the configured Supabase project ref against the separately approved ref and canonical DB-host ref
→ idempotently provision private expo-quarantine bucket and verify private/50MiB/MIME settings
→ deploy code with EXPO_SCHEMA_CAPABILITY=20260901-v2 and the approved EXPO_APPROVED_SUPABASE_PROJECT_REF
→ keep EXPO_PUBLIC_EMBED_RELEASE off
→ verify authenticated admin, private expo-quarantine bucket, signed upload/finalize cleanup, preset, draft, preview, publish, revision, rollback, export
→ obtain separate public-embed and Imweb cutover approval
→ read-only audit every published page with enabled embed surfaces against the approved page-id allowlist
→ deploy the same verified release with EXPO_PUBLIC_EMBED_RELEASE=on
→ verify approved loaders return 200 and every non-approved page has zero renderable public sections
```

If any check fails, stop. Do not drop the revision table during rollback; revert capability/code and remain fail-closed.

Before any database or Storage mutation, the operator resolves all secret/session values outside logs. `EXPO_APPROVED_DB_HOST`, `EXPO_APPROVED_DB_NAME`, `EXPO_APPROVED_DB_USER`, and `EXPO_APPROVED_SUPABASE_PROJECT_REF` come from the signed change record, not by copying values out of the URLs being checked. `NEXT_PUBLIC_SUPABASE_URL` must already be the deployment's configured project URL. Use this exact command shape without printing either URL or a service-role key:

```bash
test -n "$EXPO_SESSION_DATABASE_URL"
test -n "$EXPO_APPROVED_DB_HOST" && test -n "$EXPO_APPROVED_DB_NAME" && test -n "$EXPO_APPROVED_DB_USER"
test -n "$EXPO_APPROVED_SUPABASE_PROJECT_REF" && test -n "$NEXT_PUBLIC_SUPABASE_URL"
node scripts/verify-expo-db-target.mjs
DATABASE_URL="$EXPO_SESSION_DATABASE_URL" node scripts/ensure-partial-unique-indexes.mjs
DATABASE_URL="$EXPO_SESSION_DATABASE_URL" node scripts/check-expo-schema.mjs --expect=v1
DATABASE_URL="$EXPO_SESSION_DATABASE_URL" npx prisma db execute --file supabase/migrations/20260901000000_expo_page_revisions.sql
DATABASE_URL="$EXPO_SESSION_DATABASE_URL" node scripts/check-expo-schema.mjs --expect=ready
DATABASE_URL="$EXPO_SESSION_DATABASE_URL" node scripts/ensure-partial-unique-indexes.mjs
node scripts/ensure-expo-quarantine-bucket.mjs --check-target
node scripts/ensure-expo-quarantine-bucket.mjs --apply
node scripts/ensure-expo-quarantine-bucket.mjs --check
```

Implement `scripts/audit-expo-public-embeds.mjs` as a read-only `pg` query joining `ExpoPage` to its owning `ExpoSite`, with `ExpoPage.deletedAt IS NULL`, `ExpoSite.deletedAt IS NULL`, and `ExpoPage.published IS NOT NULL`, matching the loader's ownership/deletion scope. It returns page id, site id, title, page-level `liveAt`, and every enabled `embedEnabled` sid. A page counts as a public surface when `liveAt IS NOT NULL` or at least one published section is both enabled and `embedEnabled`; the script compares that complete page-id set against the separately reviewed `EXPO_APPROVED_PUBLIC_PAGE_IDS`, fails on any exact-set mismatch, and never updates data. A literal `none` is the required sentinel for an approved empty set; empty/missing values are rejected. Its DB-free `--describe` mode prints the query/allowlist contract before constructing `pg`; the CLI test covers `none`, expected, unexpected, deleted page, deleted site, and null-published fixture sets. Run it only after `verify-expo-db-target.mjs` and immediately before enabling the global flag:

```bash
test -n "$EXPO_APPROVED_PUBLIC_PAGE_IDS" # use literal none when the approved set is empty
DATABASE_URL="$EXPO_SESSION_DATABASE_URL" node scripts/audit-expo-public-embeds.mjs --expect-page-ids="$EXPO_APPROVED_PUBLIC_PAGE_IDS"
```

`EXPO_PUBLIC_EMBED_RELEASE` is a global switch. Turning it on is a second deployment/configuration action after separate approval, not an implied consequence of the schema deploy. If the audit lists an unapproved page, keep the flag off, disable/re-publish that surface through the authenticated editor, rerun the audit, and obtain approval for the final exact set. After enabling, test one approved page/section loader and query every non-approved published page to prove its resolved section list is empty before touching Imweb `/214`.

- [ ] **Step 3: Record the six-section progressive cutover**

Order is Hero → Exhibitions → Journey → Speakers → Sponsors → Final CTA. For each section:

1. Install its `sid` snippet on a private Imweb test page.
2. Confirm the exact `/h/{pageId}/{sid}` request returns 200 and the expected `data-msx-sid` is present.
3. Verify PC/mobile, actions, keyboard, motion, crop, and native sections above/below.
4. Export and test the individual backup HTML.
5. On `/214`, keep the existing widget visible and install the new snippet in connection-only state.
6. Confirm `lastSeenOrigin` host is exactly `smarttechkorea.com` and connection status is recent.
7. Enable/publish only that Mach section and verify the real page updates within 60 seconds.
8. Verify CTA URL/anchor/modal/analytics in Network and the destination system.
9. Only after the new render passes, hide the old widget; do not delete it.
10. Capture desktop/mobile evidence and record revision sequence/digest.

Rollback order is the reverse of risk: show the existing Imweb widget first, disable the Mach section second, verify public recovery third. Keep all old widgets until all six sections and a recovery drill are approved.

- [ ] **Step 4: Record unknown-value and completion gates**

The runbook blocks launch until exact campaign dates/timezones, destination URLs, modal IDs and fallback URLs, analytics event/content ids, Hero video rights, all required images, and real sponsor logos are supplied and publish readiness has zero errors.

Final completion evidence must include real `/214` render, 1280/390 screenshots, Chromium and mobile Safari/WebKit, six loader responses, connection status, two simultaneous campaign CTA state, all destination actions, speaker filter, sponsor motion/reduced motion, standalone recovery, and native newsroom/newsletter/footer/Channel Talk regression.

- [ ] **Step 5: Review and commit the runbook without executing it**

```bash
node scripts/audit-expo-public-embeds.mjs --describe
npx vitest run src/lib/expo/__tests__/public-embed-audit-cli.test.ts
rg -n "Hero|Exhibitions|Journey|Speakers|Sponsors|Final CTA|verify-expo-db-target|expo-quarantine|EXPO_PUBLIC_EMBED_RELEASE=on|audit-expo-public-embeds|--expect=v1|--expect=ready|10/10|connection-only|60 seconds|show the existing" docs/runbooks/stk-imweb-homepage-cutover.md
git diff --check
git add docs/runbooks/stk-imweb-homepage-cutover.md scripts/audit-expo-public-embeds.mjs src/lib/expo/__tests__/public-embed-audit-cli.test.ts
git commit -m "docs: add the STK Imweb cutover runbook"
```

Expected: every progressive and rollback gate is present; no database, deployment, or Imweb change has been executed.

---

## Final integration verification

Run in this order after Tasks 1–16 and before asking for deployment approval:

```bash
npm run build:expo-shell-css
npm run build:expo-runtime
npm run build:expo-standalone-runtime
npx prisma validate
npx prisma generate
npx tsc --noEmit -p tsconfig.json
npx vitest run --exclude '.worktrees/**' src
npm run test:expo-browser
DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:1/invalid EXPO_SCHEMA_CAPABILITY=disabled EXPO_PUBLIC_EMBED_RELEASE=off npm run build
npm run lint
git diff --check
git status --short
```

Expected:

- Generated Expo CSS/runtime tests prove committed artifacts are current.
- Prisma schema validates without connecting to a database.
- Typecheck, all Vitest tests, browser tests, and production build pass.
- Lint output is compared with the baseline; no new error is accepted. Existing baseline errors are reported rather than hidden.
- `git diff --check` is clean and only task-scoped files are changed.
- No command in this verification list writes to a live database or Imweb.

## Spec coverage checklist

- [ ] §4 ownership boundary: Task 10 preset and Task 16 runbook manage six sections only.
- [ ] §5 architecture: Tasks 1, 6, 9, 13, 14 implement one atomic snapshot, dynamic embed, and backup export.
- [ ] §6 V2 data: Task 1 handles V1 compatibility and V2 strict writes.
- [ ] §7 campaigns/destinations/CTA: Tasks 1, 7, 12, 13 resolve independent schedules, override, shared destinations, preview, and max-two/fallback.
- [ ] §8 six plugins: Tasks 6–9 define, validate, and render every section.
- [ ] §9 editor: Tasks 8, 11, 12 implement shared draft, three columns, inline tables, upload/crop, desktop/mobile preview.
- [ ] §10 save/publish/history: Tasks 2–5 preserve 900ms CAS, project roles, 20 revisions, audit rollback.
- [ ] §11 dynamic/export: Tasks 13–15 enforce 60s stale bound, staged remount, connection status, standalone HTML.
- [ ] §12 validation/defense: Tasks 1, 7–9, 13, 14 split blocking errors/warnings and fail safely.
- [ ] §13 testing: Task 15 plus final integration cover unit/render/browser/real-site gates.
- [ ] §14 migration: Task 10 uses exact sources/counts and refuses guessed operational values.
- [ ] §15 launch order: Task 16 is progressive and reversible.
- [ ] §16 exclusions: no subpages, native Imweb rebuild, canvas editor, multilingual UI, Imweb automation, or static-host replacement is introduced.
- [ ] §17 success criteria: code completion is reported separately from schema deployment, public release, and actual `/214` verification.

## Execution handoff

Use one of these modes after this plan is reviewed:

1. **Subagent-Driven (recommended):** dispatch one fresh implementation agent per task, then run spec-compliance review and code-quality review before advancing. Tasks 1–16 stay sequential where interfaces depend on prior tasks.
2. **Inline Execution:** implement in this worktree in task batches with a review checkpoint after Tasks 1–5, 6–10, 11–15, and 16.

Neither mode includes database migration, public deployment, or Imweb `/214` mutation without a new explicit approval at the relevant gate.
