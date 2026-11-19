"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { Field, FIELD_CLS, FINISH, R, btnCls } from "@/components/ui/primitives";
import { FORM_LOCALES, formLocaleLabel } from "@/lib/form-locale";
import { expoContentLocales, expoTranslationEntries } from "@/lib/expo/i18n";
import { TranslationTable } from "@/components/form-builder/TranslationTable";
import { ExpoPublishPanel } from "@/components/expo/ExpoPublishPanel";
import { ExpoSectionTree, expoSectionTitle } from "@/components/expo/ExpoSectionTree";
import { SelectedSectionEditor } from "@/components/expo/SectionEditor";
import { ExpoPageSettings } from "@/components/expo/ExpoPageSettings";
import { useExpoPageDraft, type ExpoPageDraftState } from "@/lib/expo/use-page-draft";
import type { ExpoPageTransport } from "@/lib/expo/editor-dto";
import type { ExpoPermissions } from "@/lib/expo/permissions";
import { sectionDef } from "@/lib/expo/registry";
import type { ExpoSection, FieldIssue } from "@/lib/expo/types";
import type { ExpoRejection } from "@/lib/expo/use-page-autosave";

export interface PageDraftWorkspaceProps {
  siteId: string;
  pageId: string;
  permissions: ExpoPermissions;
  transport?: ExpoPageTransport;
  sources?: readonly { id: string; name: string; isActive: boolean }[];
  pages?: readonly { id: string; title: string }[];
  locale?: string;
  embedLocked?: boolean;
  /** 초안 상태가 필요한 페이지 탐색기는 렌더 함수로 받는다. */
  leftTop?: ReactNode | ((state: ExpoPageDraftState) => ReactNode);
  leftBottom?: ReactNode;
  renderPreview?: (state: ExpoPageDraftState, locale: string) => ReactNode;
  onSaved?: () => void;
}

function readLocalized(value: unknown, locale: string): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of [locale, "ko", "en", ...Object.keys(record)]) {
    const text = record[key];
    if (typeof text === "string") return text;
  }
  return "";
}

function isFieldIssue(value: unknown): value is FieldIssue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const issue = value as Partial<FieldIssue>;
  return typeof issue.path === "string"
    && typeof issue.code === "string"
    && typeof issue.message === "string"
    && (issue.severity === "error" || issue.severity === "warning")
    && (issue.sid === undefined || typeof issue.sid === "string");
}

function dedupeFieldIssues(issues: readonly FieldIssue[]): FieldIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [issue.path, issue.message, issue.sid ?? ""].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const NATIVE_FIELD_SELECTOR = "input:not([type='file']),textarea,select,button,a[href]";
const VALUE_FIELD_SELECTOR = "input:not([type='file']),textarea,select";

function enabledField(element: HTMLElement | null | undefined): boolean {
  if (!element) return false;
  if (!element.matches(NATIVE_FIELD_SELECTOR) && !element.hasAttribute("tabindex")) return false;
  return !("disabled" in element && Boolean((element as HTMLInputElement).disabled));
}

function firstEnabledField(container: ParentNode | null | undefined): HTMLElement | null {
  if (!container) return null;
  const valueField = container.querySelector<HTMLElement>(VALUE_FIELD_SELECTOR);
  if (valueField && enabledField(valueField)) return valueField;
  const action = container.querySelector<HTMLElement>("button,a[href],[tabindex]");
  return action && enabledField(action) ? action : null;
}

/**
 * `data-field-path`는 control 자체, control을 감싼 조상, 오류 문구 sibling 어디에도 놓일 수 있다.
 * 명시 대상(`data-field-focus-target` = element id)을 우선 지원하고, 같은 focus scope 안의
 * sibling control까지 찾는다. 반환 path는 실제 control에 옮겨 접근성/회귀 검사가 같은 계약을 본다.
 */
export function resolveExpoFieldFocusTarget(
  root: HTMLElement,
  candidates: ReadonlySet<string>,
): { element: HTMLElement; path: string } | null {
  const markers = [...root.querySelectorAll<HTMLElement>("[data-field-path]")]
    .filter((element) => candidates.has(element.dataset.fieldPath ?? ""));
  const exactControl = markers.find((element) => element.matches(NATIVE_FIELD_SELECTOR) && enabledField(element));
  if (exactControl) return { element: exactControl, path: exactControl.dataset.fieldPath! };

  for (const marker of markers) {
    const targetId = marker.dataset.fieldFocusTarget;
    if (!targetId) continue;
    const explicit = [...root.querySelectorAll<HTMLElement>("[id]")]
      .find((element) => element.id === targetId);
    if (explicit && enabledField(explicit)) return { element: explicit, path: marker.dataset.fieldPath! };
  }
  for (const marker of markers) {
    const descendant = firstEnabledField(marker);
    if (descendant) return { element: descendant, path: marker.dataset.fieldPath! };
  }
  for (const marker of markers) {
    const scope = marker.closest<HTMLElement>("[data-field-focus-scope]");
    const sibling = firstEnabledField(scope);
    if (sibling) return { element: sibling, path: marker.dataset.fieldPath! };
  }
  const fallback = markers.find(enabledField);
  return fallback ? { element: fallback, path: fallback.dataset.fieldPath! } : null;
}

export function mergeEditorIssues(
  readinessIssues: readonly unknown[],
  rejectedIssues: readonly ExpoRejection[] = [],
  exportIssues: readonly FieldIssue[] = [],
): FieldIssue[] {
  return dedupeFieldIssues([
    ...readinessIssues.flatMap((issue) => isFieldIssue(issue) ? [issue] : []),
    ...rejectedIssues.map((issue) => ({
      ...issue, code: "rejected", severity: "error" as const,
    })),
    ...exportIssues,
  ]);
}

type SectionTitleField =
  | { kind: "slot"; key: string; locale: string; value: string; direct: boolean }
  | { kind: "campaign-typing"; locale: string; value: string };

function localizedField(value: unknown, defaultLocale: string) {
  if (typeof value === "string") return { locale: defaultLocale, value, direct: true };
  const map = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const locale = [defaultLocale, "ko", "en", ...Object.keys(map)]
    .find((candidate) => typeof map[candidate] === "string") ?? defaultLocale;
  return { locale, value: readLocalized(map, locale), direct: false };
}

function titleField(section: ExpoSection, defaultLocale: string): SectionTitleField | null {
  if (section.type === "campaign-hero") {
    const lines = Array.isArray(section.content.typingLines) ? section.content.typingLines : [];
    const first = localizedField(lines[0], defaultLocale);
    return { kind: "campaign-typing", locale: first.locale, value: first.value };
  }
  const candidates = ["heading", "title", "headline", "accessibleHeadline"];
  const slot = sectionDef(section.type)?.slots.find((candidate) =>
    candidates.includes(candidate.key) && (candidate.kind === "text" || candidate.kind === "textarea"),
  );
  if (!slot) return null;
  const field = localizedField(section.content[slot.key], defaultLocale);
  return { kind: "slot", key: slot.key, ...field };
}

function LocalDraftPreview({
  sections, selectedSid, onSelect,
}: { sections: ExpoSection[]; selectedSid: string | null; onSelect(sid: string): void }) {
  return (
    <aside
      className={`${R.panel} ${FINISH.s1} space-y-2 bg-card p-3`}
      aria-label="미리보기"
      data-testid="expo-preview"
      data-selected-sid={selectedSid ?? ""}
    >
      <h2 className="text-sm font-semibold">미리보기</h2>
      <div className="space-y-1.5">
        {sections.filter((section) => section.enabled).map((section) => (
          <button
            key={section.sid}
            type="button"
            onClick={() => onSelect(section.sid)}
            aria-label={`${expoSectionTitle(section)} 미리보기에서 선택`}
            className={`block w-full ${R.surface} ${FINISH.s2} bg-secondary px-3 py-5 text-left text-sm ${selectedSid === section.sid ? "ring-2 ring-ring" : ""}`}
          >
            {expoSectionTitle(section)}
          </button>
        ))}
      </div>
    </aside>
  );
}

export function PageDraftWorkspace({
  siteId, pageId, permissions, transport, sources = [], pages = [], locale = "ko", embedLocked = false,
  leftTop, leftBottom, renderPreview, onSaved,
}: PageDraftWorkspaceProps) {
  const state = useExpoPageDraft(siteId, pageId, transport);
  const setSelectedSid = state.setSelectedSid;
  const previousSaveState = useRef(state.saveState);
  const editorRootRef = useRef<HTMLElement | null>(null);
  const [editLocale, setEditLocale] = useState<string | null>(null);
  const activeLocale = permissions.canEdit ? editLocale ?? locale : locale;
  const translating = activeLocale !== locale;
  const locales = [...new Set([...expoContentLocales(state.config.sections, locale), ...(state.config.locales ?? [])])];
  const [exportIssues, setExportIssues] = useState<FieldIssue[]>([]);
  const focusSequence = useRef(0);
  const [exportFocus, setExportFocus] = useState<{ issue: FieldIssue; sequence: number } | null>(null);
  useEffect(() => {
    if (state.saveState === "saved" && previousSaveState.current !== "saved") onSaved?.();
    previousSaveState.current = state.saveState;
  }, [onSaved, state.saveState]);
  const selected = state.config.sections.find((section) => section.sid === state.selectedSid) ?? null;
  const allIssues = useMemo(() => state.page ? [
    ...state.page.readiness.publishIssues,
    ...state.page.readiness.liveIssues,
    ...state.page.readiness.notes,
  ] : [], [state.page]);
  const fieldIssues = useMemo(
    () => mergeEditorIssues(allIssues, state.rejected ?? [], exportIssues),
    [allIssues, exportIssues, state.rejected],
  );
  const draftSectionSids = useMemo(
    () => new Set(state.config.sections.map((section) => section.sid)),
    [state.config.sections],
  );
  const focusExportIssue = useCallback((issue: FieldIssue) => {
    // 발행본에만 남은 sid라면 현재 초안 선택을 지우지 않는다.
    if (issue.sid && draftSectionSids.has(issue.sid)) setSelectedSid(issue.sid);
    focusSequence.current += 1;
    // 같은 issue 객체를 다시 눌러도 sequence가 바뀌어 focus 효과가 다시 돈다.
    setExportFocus({ issue, sequence: focusSequence.current });
  }, [draftSectionSids, setSelectedSid]);

  useEffect(() => {
    if (!exportFocus || !editorRootRef.current) return;
    const issue = exportFocus.issue;
    if (issue.sid && draftSectionSids.has(issue.sid) && state.selectedSid !== issue.sid) return;
    if (issue.sid && !draftSectionSids.has(issue.sid)) return;

    const relative = issue.path.replace(/^sections\[\d+\]\.content\.?/, "");
    const rowRelative = relative.includes("[") ? relative.slice(relative.indexOf("[")) : "";
    // 업로드 UI는 url/originalUrl을 한 주소 입력으로 함께 고친다.
    const urlAlias = relative.replace(/\.originalUrl$/, ".url");
    const rowUrlAlias = urlAlias.includes("[") ? urlAlias.slice(urlAlias.indexOf("[")) : "";
    const candidates = new Set([issue.path, relative, rowRelative, urlAlias, rowUrlAlias].filter(Boolean));
    const match = resolveExpoFieldFocusTarget(editorRootRef.current, candidates);
    const sectionCard = issue.sid
      ? [...editorRootRef.current.querySelectorAll<HTMLElement>("[data-expo-sid]")]
        .find((element) => element.dataset.expoSid === issue.sid)
      : undefined;
    const target = match?.element ?? sectionCard;
    if (!target) return;
    if (match && !target.dataset.fieldPath) target.dataset.fieldPath = match.path;
    if (!enabledField(target) && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [draftSectionSids, exportFocus, state.selectedSid]);

  if (state.loading && !state.page) {
    return <p className="py-12 text-sm text-muted-foreground">미리보기를 준비하는 중이에요.</p>;
  }
  if (!state.page) {
    return <p className="py-12 text-sm">{state.error ?? "페이지를 불러오지 못했어요."}</p>;
  }

  const replaceSection = (next: ExpoSection) => state.updateConfig((current) => ({
    ...current,
    sections: current.sections.map((section) => section.sid === next.sid ? next : section),
  }));
  const removeSelected = () => {
    const index = state.config.sections.findIndex((section) => section.sid === state.selectedSid);
    const sections = state.config.sections.filter((section) => section.sid !== state.selectedSid);
    state.setSelectedSid((sections[index] ?? sections[index - 1] ?? null)?.sid ?? null);
    state.updateConfig((current) => ({ ...current, sections }));
  };
  const heading = selected ? titleField(selected, locale) : null;
  const replaceHeading = (value: string) => {
    if (!selected || !heading) return;
    if (heading.kind === "campaign-typing") {
      const typingLines = Array.isArray(selected.content.typingLines) ? [...selected.content.typingLines] : [];
      const first = typingLines[0];
      const nextHeadline = first && typeof first === "object" && !Array.isArray(first)
        ? { ...first as Record<string, unknown>, [heading.locale]: value }
        : { [heading.locale]: value };
      typingLines[0] = nextHeadline;
      replaceSection({
        ...selected,
        content: { ...selected.content, typingLines, accessibleHeadline: nextHeadline },
      });
      return;
    }
    const current = selected.content[heading.key];
    replaceSection({
      ...selected,
      content: {
        ...selected.content,
        [heading.key]: heading.direct
          ? value
          : {
              ...(current && typeof current === "object" && !Array.isArray(current)
                ? current as Record<string, unknown>
                : {}),
              [heading.locale]: value,
            },
      },
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(200px,240px)_minmax(0,1fr)_minmax(280px,380px)]">
      <div className="space-y-3">
        {typeof leftTop === "function" ? leftTop(state) : leftTop}
        <ExpoSectionTree
          sections={state.config.sections}
          selectedSid={state.selectedSid}
          onSelect={state.setSelectedSid}
          onChange={(sections) => state.updateConfig((current) => ({ ...current, sections }))}
          canEdit={permissions.canEdit && !translating}
          issues={allIssues}
        />
        {leftBottom}
      </div>

      <main ref={editorRootRef} className={`${R.panel} ${FINISH.s1} space-y-5 bg-card p-5`}>
        {state.saveState === "conflict" ? (
          <div className={`${R.surface} ${FINISH.s2Danger} bg-secondary p-3 text-sm`}>
            <p className="font-medium">다른 팀원이 먼저 저장했어요</p>
            <p className="mt-1 text-muted-foreground">자동저장을 멈췄고 이 화면의 내용은 그대로 두었어요.</p>
            <button
              type="button"
              onClick={() => void state.reloadAfterConflict()}
              className="mt-2 text-xs font-medium underline underline-offset-4"
            >
              최신 내용 다시 불러오기
            </button>
          </div>
        ) : null}

        {state.rejected ? (
          <div className={`${R.surface} ${FINISH.s2Danger} bg-secondary p-3 text-sm`}>
            <p className="font-medium">저장하지 못했어요. 아래를 고치면 다시 저장돼요.</p>
            <ul className="mt-1.5 space-y-1 text-muted-foreground">
              {state.rejected.map((issue, index) => <li key={`${issue.path}:${index}`}>{issue.message}</li>)}
            </ul>
          </div>
        ) : null}

        {permissions.canEdit && (
          <section className="flex flex-wrap items-center gap-2" aria-label="편집 언어">
            {locales.map((code) => (
              <button key={code} type="button" aria-pressed={activeLocale === code}
                className={btnCls(activeLocale === code ? "key" : "quiet", "text-xs")}
                onClick={() => setEditLocale(code === locale ? null : code)}>
                {formLocaleLabel(code)}{code === locale ? " · 원문" : ""}
              </button>
            ))}
            {FORM_LOCALES.some(({ code }) => !locales.includes(code)) && (
              <select value="" aria-label="번역 언어 추가" className={FIELD_CLS}
                onChange={(event) => {
                  const code = event.target.value;
                  if (!code) return;
                  state.updateConfig((current) => ({ ...current, locales: [...(current.locales ?? []), code] }));
                  setEditLocale(code);
                }}>
                <option value="">언어 추가</option>
                {FORM_LOCALES.filter(({ code }) => !locales.includes(code)).map(({ code, label }) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            )}
          </section>
        )}
        {translating ? (
          selected ? (
            <TranslationTable
              key={`${selected.sid}:${activeLocale}`}
              config={selected}
              entries={expoTranslationEntries(selected, locale, activeLocale)}
              locale={activeLocale}
              baseLocale={locale}
              onChange={replaceSection}
              emptyHint="원문에서 구획 문구를 먼저 작성해 주세요."
              draft={{ scope: "expo", resourceId: pageId, subject: "홈페이지" }}
            />
          ) : <p className="text-sm text-muted-foreground">번역할 구획을 선택해 주세요.</p>
        ) : <>
        <section className="grid gap-3 sm:grid-cols-2" aria-label="페이지 설정">
          <label className="block">
            <span className="text-sm font-medium">페이지 제목</span>
            <Field
              value={state.title}
              onChange={(event) => state.setTitle(event.target.value)}
              disabled={!permissions.canEdit}
              maxLength={120}
              aria-label="페이지 제목"
              className={`mt-1.5 ${FIELD_CLS}`}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">아임웹 주소</span>
            <Field
              value={state.imwebUrl}
              onChange={(event) => state.setImwebUrl(event.target.value)}
              disabled={!permissions.canEdit}
              placeholder="https://…"
              aria-label="아임웹 주소"
              className={`mt-1.5 ${FIELD_CLS}`}
            />
          </label>
        </section>

        <ExpoPageSettings
          config={state.config}
          issues={fieldIssues}
          canEdit={permissions.canEdit}
          onChange={(config) => state.updateConfig(() => config)}
        />

        {selected ? (
          <section className="space-y-3" aria-label={`${expoSectionTitle(selected)} 편집기`}>
            {heading ? <label className="block">
              <span className="text-sm font-medium">섹션 제목</span>
              <Field
                value={heading.value}
                onChange={(event) => replaceHeading(event.target.value)}
                disabled={!permissions.canEdit}
                aria-label="섹션 제목"
                className={FIELD_CLS}
              />
            </label> : null}
            <SelectedSectionEditor
              section={selected}
              onChange={replaceSection}
              onRemove={removeSelected}
              canEdit={permissions.canEdit}
              embedLocked={embedLocked}
              siteId={siteId}
              sources={sources}
              pages={pages}
              locale={locale}
              config={state.config}
              issues={fieldIssues}
            />
          </section>
        ) : (
          <p className="py-8 text-sm text-muted-foreground">왼쪽에서 구획을 골라 주세요.</p>
        )}
        </>}
      </main>

      <div className="space-y-3">
        {renderPreview?.(state, activeLocale) ?? (
          <LocalDraftPreview
            sections={state.config.sections}
            selectedSid={state.selectedSid}
            onSelect={state.setSelectedSid}
          />
        )}
        <ConfirmProvider>
          <ExpoPublishPanel
            pageId={pageId}
            pageTitle={state.title}
            hasPublished={state.page.hasPublished}
            liveAt={state.page.liveAt}
            imwebUrl={state.page.imwebUrl}
            lastSeenAt={state.page.lastSeenAt}
            lastSeenOrigin={state.page.lastSeenOrigin}
            publishedAt={state.page.publishedAt}
            updatedAt={state.page.updatedAt}
            readiness={state.page.readiness}
            snippets={state.page.snippets}
            exportSections={state.page.exportSections}
            canPublish={permissions.canPublish}
            saveBlocked={state.saveBlocked}
            launchLocked={embedLocked}
            request={state.request}
            onExportIssuesChange={setExportIssues}
            onFocusExportIssue={focusExportIssue}
            onChanged={() => {
              setExportIssues([]);
              void state.refreshMetadata();
            }}
          />
        </ConfirmProvider>
      </div>
    </div>
  );
}
