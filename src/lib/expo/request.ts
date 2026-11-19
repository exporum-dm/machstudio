/**
 * 쓰기 요청 **검증** — 정규화와 다른 일을 한다.
 *
 * ── 자르기와 거절의 차이 ──────────────────────────────────────────────
 * `config.ts` 의 정규화는 **이미 저장된** 값에 대한 방어라 조용히 자른다(던지면 그 페이지가
 * 영영 안 열리므로). 반면 새로 들어오는 쓰기는 **거절**해야 한다 — 운영자가 입력한 문장을
 * 말없이 잘라 저장하면, 저장은 성공했다고 뜨는데 화면에는 잘린 글이 남는다.
 * 그건 "저장이 안 됐다" 보다 알아채기 어렵다.
 *
 * 그래서 여기서는 **어느 칸이 왜 안 되는지**를 구조화해서 돌려준다.
 */
import { FORM_LOCALES } from "@/lib/form-locale";
import { EXPO_LIMITS, sectionDef } from "@/lib/expo/registry";
import { isSid, normalizeCampaigns, normalizeDestinations } from "@/lib/expo/config";
import { isSafePublicUrl } from "@/lib/expo/destination";
import { topicParticle } from "@/lib/korean";
import {
  EXPO_V2_RULES,
  type ExpoPageConfigV2,
  type ExpoSection,
  type IssueSeverity,
  type SlotDef,
} from "@/lib/expo/types";

export interface FieldError {
  /** `sections[2].content.title` 처럼 어느 칸인지 — 편집기가 그 카드로 데려간다. */
  path: string;
  code:
    | "too-long" | "too-many" | "unknown-type" | "invalid-shape" | "too-large"
    /** sid 가 없거나 UUID 가 아니다 — 정규화가 이 구획을 통째로 버린다. */
    | "invalid-sid"
    /** 같은 sid 가 두 번 — 정규화가 뒤엣것을 버린다. */
    | "duplicate-sid"
    /** 한 페이지에 하나만 되는 구획이 두 번 — 정규화가 뒤엣것을 버린다. */
    | "duplicate-singleton"
    /** 릴리스 승인 전이라 밖으로 내보내는 스위치를 켤 수 없다. 끄는 것은 언제나 된다. */
    | "launch-locked" | "invalid-schema" | "duplicate-id" | "invalid-date" | "invalid-action" | "invalid-url"
    | (string & {});
  message: string;
  /** plugin issue의 공개/발행 심각도. 기존 write 오류는 이 값을 생략한다. */
  severity?: IssueSeverity;
  /**
   * 어느 구획인지. 편집기가 `data-expo-sid` 로 카드를 찾아 데려간다 —
   * `path` 의 인덱스로 역산하면 그 사이 배열이 바뀌었을 때 엉뚱한 카드를 가리킨다.
   */
  sid?: string;
}

/**
 * 한 번에 낼 오류 개수 상한. 512KB 본문 하나가 수천 줄짜리 422 를 만들지 않게 한다.
 * 잘렸으면 **잘렸다는 사실을 함께 낸다** — 안 그러면 고쳐서 저장했는데 또 막힌다.
 */
const MAX_ERRORS = 50;

export type ValidateResult = { ok: true } | { ok: false; errors: FieldError[] };

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const bytes = (v: string) => new TextEncoder().encode(v).length;
const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && EXPO_V2_RULES.timezoneSuffix.test(value) && Number.isFinite(Date.parse(value));
const isV2Id = (value: unknown): value is string => typeof value === "string" && EXPO_V2_RULES.id.test(value);
const isAnchorOrModal = (value: unknown): value is string =>
  typeof value === "string" && EXPO_V2_RULES.anchorOrModal.test(value);

function validateInterval(value: Record<string, unknown>, path: string, errors: FieldError[]): void {
  const startsAt = value.startsAt;
  const endsAt = value.endsAt;
  if (!isIsoTimestamp(startsAt)) errors.push({ path: `${path}.startsAt`, code: "invalid-date", message: "시작 시각은 시간대가 있는 ISO 날짜여야 해요" });
  if (!isIsoTimestamp(endsAt)) errors.push({ path: `${path}.endsAt`, code: "invalid-date", message: "종료 시각은 시간대가 있는 ISO 날짜여야 해요" });
  if (isIsoTimestamp(startsAt) && isIsoTimestamp(endsAt) && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.push({ path: `${path}.endsAt`, code: "invalid-date", message: "종료 시각은 시작 시각 뒤여야 해요" });
  }
}

function validateDestinationAction(value: unknown, path: string, errors: FieldError[]): void {
  const action = obj(value);
  if (action.type === "url" || action.type === "download") {
    if (!isSafePublicUrl(action.href)) errors.push({ path: `${path}.href`, code: "invalid-url", message: "공개 HTTPS 주소만 사용할 수 있어요" });
    if (action.type === "url" && action.newTab !== undefined && typeof action.newTab !== "boolean") {
      errors.push({ path: `${path}.newTab`, code: "invalid-shape", message: "새 탭 설정의 모양이 올바르지 않아요" });
    }
    return;
  }
  if (action.type === "anchor") {
    if (!isAnchorOrModal(action.target)) errors.push({ path: `${path}.target`, code: "invalid-action", message: "앵커 이름이 올바르지 않아요" });
    return;
  }
  if (action.type === "imweb-modal") {
    if (!isAnchorOrModal(action.modalId)) errors.push({ path: `${path}.modalId`, code: "invalid-action", message: "모달 이름이 올바르지 않아요" });
    if (action.fallbackHref !== undefined && !isSafePublicUrl(action.fallbackHref)) {
      errors.push({ path: `${path}.fallbackHref`, code: "invalid-url", message: "대체 주소는 공개 HTTPS 주소여야 해요" });
    }
    return;
  }
  errors.push({ path: `${path}.type`, code: "invalid-action", message: "목적지 동작이 올바르지 않아요" });
}

function validateV2Settings(src: Record<string, unknown>, errors: FieldError[]): void {
  if (src.schemaVersion !== 2) {
    errors.push({ path: "schemaVersion", code: "invalid-schema", message: "지원하지 않는 페이지 설정 버전이에요" });
  }
  if (src.preset !== undefined && (typeof src.preset !== "string" || bytes(src.preset) > 128)) {
    errors.push({ path: "preset", code: typeof src.preset === "string" ? "too-long" : "invalid-shape", message: "프리셋 이름이 올바르지 않아요" });
  }
  if (src.locales !== undefined && (!Array.isArray(src.locales) || src.locales.length > FORM_LOCALES.length
    || src.locales.some((locale) => !FORM_LOCALES.some(({ code }) => code === locale)))) {
    errors.push({ path: "locales", code: "invalid-shape", message: "지원하는 번역 언어를 선택해 주세요." });
  }
  if (src.settings === undefined) return;
  if (!src.settings || typeof src.settings !== "object" || Array.isArray(src.settings)) {
    errors.push({ path: "settings", code: "invalid-shape", message: "설정 모양이 올바르지 않아요" });
    return;
  }
  const settings = obj(src.settings);
  if (settings.event !== undefined) {
    const event = obj(settings.event);
    if (!Number.isInteger(event.edition) || Number(event.edition) < 1) {
      errors.push({ path: "settings.event.edition", code: "invalid-shape", message: "행사 회차가 올바르지 않아요" });
    }
    if (event.facts !== undefined) {
      if (!event.facts || typeof event.facts !== "object" || Array.isArray(event.facts)) {
        errors.push({ path: "settings.event.facts", code: "invalid-shape", message: "행사 수치 모양이 올바르지 않아요" });
      } else {
        const facts = obj(event.facts);
        for (const key of ["companies", "sessions", "booths"] as const) {
          if (facts[key] !== undefined && (!Number.isInteger(facts[key]) || Number(facts[key]) < 0)) {
            errors.push({ path: `settings.event.facts.${key}`, code: "invalid-shape", message: "행사 수치는 0 이상의 정수여야 해요" });
          }
        }
      }
    }
    validateInterval(event, "settings.event", errors);
    if (settings.event && (typeof settings.event !== "object" || Array.isArray(settings.event))) {
      errors.push({ path: "settings.event", code: "invalid-shape", message: "행사 설정 모양이 올바르지 않아요" });
    }
  }
  for (const key of ["campaigns", "destinations"] as const) {
    const list = settings[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push({ path: `settings.${key}`, code: "invalid-shape", message: "목록 모양이 올바르지 않아요" });
      continue;
    }
    if (list.length > EXPO_V2_RULES.maxRows) errors.push({ path: `settings.${key}`, code: "too-many", message: `목록은 ${EXPO_V2_RULES.maxRows}개까지 넣을 수 있어요` });
    const ids = new Set<string>();
    list.slice(0, EXPO_V2_RULES.maxRows).forEach((raw, index) => {
      const value = obj(raw);
      const path = `settings.${key}[${index}]`;
      if (!isV2Id(value.id)) errors.push({ path: `${path}.id`, code: "invalid-shape", message: "식별자가 올바르지 않아요" });
      else if (ids.has(value.id)) errors.push({ path: `${path}.id`, code: "duplicate-id", message: "같은 식별자가 두 번 있어요" });
      else ids.add(value.id);
      if (typeof value.label !== "string" || !value.label.trim()) errors.push({ path: `${path}.label`, code: "invalid-shape", message: "표시 이름이 필요해요" });
      else if (value.label.length > EXPO_LIMITS.textChars) errors.push({ path: `${path}.label`, code: "too-long", message: `표시 이름은 ${EXPO_LIMITS.textChars}자까지 넣을 수 있어요` });
      if (typeof value.enabled !== "boolean") errors.push({ path: `${path}.enabled`, code: "invalid-shape", message: "활성 설정의 모양이 올바르지 않아요" });
      if (key === "campaigns") {
        validateInterval(value, path, errors);
        if (value.override !== "auto" && value.override !== "force-on" && value.override !== "force-off") {
          errors.push({ path: `${path}.override`, code: "invalid-shape", message: "캠페인 상태가 올바르지 않아요" });
        }
      } else {
        validateDestinationAction(value.action, `${path}.action`, errors);
        if (value.analytics !== undefined) {
          const analytics = obj(value.analytics);
          if (!EXPO_V2_RULES.analyticsEvent.test(String(analytics.eventName ?? ""))) {
            errors.push({ path: `${path}.analytics.eventName`, code: "invalid-shape", message: "분석 이벤트 이름이 올바르지 않아요" });
          }
          if (analytics.contentId !== undefined && (typeof analytics.contentId !== "string" || bytes(analytics.contentId) > 64)) {
            errors.push({ path: `${path}.analytics.contentId`, code: typeof analytics.contentId === "string" ? "too-long" : "invalid-shape", message: "분석 콘텐츠 식별자가 올바르지 않아요" });
          }
        }
      }
    });
  }
}

/** 로케일 맵이든 문자열이든 가장 긴 값을 본다 — 한 언어만 넘쳐도 거절이다. */
function longestText(value: unknown): { chars: number; bytes: number } {
  if (typeof value === "string") return { chars: value.length, bytes: bytes(value) };
  let chars = 0, b = 0;
  for (const v of Object.values(obj(value))) {
    const s = String(v ?? "");
    chars = Math.max(chars, s.length);
    b = Math.max(b, bytes(s));
  }
  return { chars, bytes: b };
}

function validateSlot(def: SlotDef, value: unknown, path: string, errors: FieldError[]): void {
  if (value === undefined || value === null) return;

  if (def.kind === "text") {
    const { chars } = longestText(value);
    if (chars > EXPO_LIMITS.textChars) {
      errors.push({
        path, code: "too-long",
        message: `${def.label} 은 ${EXPO_LIMITS.textChars}자까지 넣을 수 있어요 (지금 ${chars}자)`,
      });
    }
    return;
  }

  if (def.kind === "textarea" || def.kind === "code") {
    const { bytes: b } = longestText(value);
    if (b > EXPO_LIMITS.longTextBytes) {
      const kb = Math.round(EXPO_LIMITS.longTextBytes / 1024);
      errors.push({ path, code: "too-long", message: `${def.label} 은 ${kb}KB까지 넣을 수 있어요` });
    }
    return;
  }

  /**
   * media·link·sourceRef — 정규화가 **말없이 자르던** 세 종류다.
   *
   * **길이만 본다. 형식은 보지 않는다.** 주소 칸(`UrlField`)은 자유 입력이고 자동저장이
   * 900ms 마다 나가므로, `https:/` 까지 친 순간을 거절하면 주소를 다 칠 때까지 **그 페이지
   * 전체의 저장이 막힌다.** 잘못된 주소는 지금처럼 화면에 인라인으로 알리고 정규화가 버린다
   * (`primitives.tsx` 의 "지금 값은 저장되지 않아요" 가 이미 그 계약을 말한다).
   * `media.kind` 도 같은 이유로 안 본다 — 편집기가 항상 `"image"` 를 붙이므로, 다른 값이
   * 온다면 그건 운영자의 입력이 아니라 버그다.
   */
  if (def.kind === "media") {
    const alt = obj(value).alt;
    if (typeof alt === "string" && alt.length > EXPO_LIMITS.textChars) {
      errors.push({
        path: `${path}.alt`, code: "too-long",
        message: `${def.label} 설명은 ${EXPO_LIMITS.textChars}자까지 넣을 수 있어요 (지금 ${alt.length}자)`,
      });
    }
    return;
  }

  if (def.kind === "link") {
    const l = obj(value);
    if (typeof l.label === "string" && l.label.length > EXPO_LIMITS.textChars) {
      errors.push({
        path: `${path}.label`, code: "too-long",
        message: `${def.label} 이름은 ${EXPO_LIMITS.textChars}자까지 넣을 수 있어요 (지금 ${l.label.length}자)`,
      });
    }
    if (longestText(l.labelI18n).chars > EXPO_LIMITS.textChars) {
      errors.push({ path: `${path}.labelI18n`, code: "too-long", message: `${def.label} 번역은 ${EXPO_LIMITS.textChars}자까지 넣을 수 있어요` });
    }
    // 내부 링크(`page:{id}`)의 상한 — 정규화의 마지막 남은 조용한 자르기다(config.ts).
    if (typeof l.href === "string" && l.href.startsWith("page:") && l.href.length > 200) {
      errors.push({ path: `${path}.href`, code: "too-long", message: `${def.label} 주소가 너무 길어요` });
    }
    return;
  }

  if (def.kind === "sourceRef") {
    if (typeof value === "string" && value.trim().length > 64) {
      errors.push({ path, code: "too-long", message: `${def.label} 값이 올바르지 않아요` });
    }
    return;
  }

  if (def.kind === "list") {
    if (!Array.isArray(value)) {
      errors.push({ path, code: "invalid-shape", message: `${def.label} 의 모양이 올바르지 않아요` });
      return;
    }
    if (value.length > EXPO_LIMITS.rowsPerList) {
      errors.push({
        path, code: "too-many",
        message: `${def.label} 은 ${EXPO_LIMITS.rowsPerList}개까지 넣을 수 있어요 (지금 ${value.length}개)`,
      });
    }
    if (!def.itemSlots) return;
    value.slice(0, EXPO_LIMITS.rowsPerList).forEach((row, i) => {
      for (const slot of def.itemSlots!) {
        validateSlot(slot, obj(row)[slot.key], `${path}[${i}].${slot.key}`, errors);
      }
    });
  }
}

function pluginIssuePath(path: string, sectionIndex: number): string {
  const at = `sections[${sectionIndex}]`;
  const clean = path.trim().replace(/^\.+/, "");
  if (!clean) return `${at}.content`;
  if (/^sections\[\d+\](?=\.|$)/.test(clean)) {
    return clean.replace(/^sections\[\d+\]/, at);
  }
  if (clean === "content" || clean.startsWith("content.")) return `${at}.${clean}`;
  return `${at}.content.${clean}`;
}

function malformedPluginIssue(sectionIndex: number, sid: string | undefined): FieldError {
  return {
    path: `sections[${sectionIndex}].content`,
    code: "invalid-shape",
    message: "구획 검증 결과의 모양이 올바르지 않아요",
    severity: "error",
    sid,
  };
}

function normalizePluginIssue(raw: unknown, sectionIndex: number, sid: string | undefined): FieldError {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return malformedPluginIssue(sectionIndex, sid);
    }
    const issue = raw as Record<string, unknown>;
    if (
      typeof issue.path !== "string"
      || typeof issue.code !== "string" || !issue.code.trim()
      || typeof issue.message !== "string" || !issue.message.trim()
      || (issue.severity !== "error" && issue.severity !== "warning")
    ) {
      return malformedPluginIssue(sectionIndex, sid);
    }
    return {
      path: pluginIssuePath(issue.path, sectionIndex),
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
      sid,
    };
  } catch {
    return malformedPluginIssue(sectionIndex, sid);
  }
}

/**
 * 페이지 draft 쓰기를 검증한다. **정규화 전에** 돈다 — 정규화가 자르고 나면
 * 무엇이 넘쳤는지 알 수 없다.
 */
export function validatePageDraft(raw: unknown): ValidateResult {
  const errors: FieldError[] = [];
  const src = obj(raw);
  validateV2Settings(src, errors);
  const sections = Array.isArray(src.sections) ? src.sections : null;

  if (sections === null) {
    return { ok: false, errors: [{ path: "sections", code: "invalid-shape", message: "페이지 모양이 올바르지 않아요" }] };
  }

  if (sections.length > EXPO_LIMITS.sectionsPerPage) {
    errors.push({
      path: "sections", code: "too-many",
      message: `한 페이지에 구획은 ${EXPO_LIMITS.sectionsPerPage}개까지예요 (지금 ${sections.length}개)`,
    });
  }

  /**
   * 신원과 다중성 — **정규화가 조용히 버리던 것들**이다.
   *
   * `normalizeExpoPage` 는 sid 가 없거나 UUID 가 아니면 그 구획을 버리고, 중복 sid 와
   * `multi:false` 중복도 뒤엣것을 버린다. 검증이 이걸 안 보면 **200 이 나가고 구획이
   * 사라진 채로 저장된다** — 편집기는 자기 로컬 값을 기준선으로 삼으므로 "저장됨" 이라고
   * 표시하고, 운영자는 새로고침해야 안다. 계획서가 "strict write validation rejects
   * invalid/duplicate IDs" 라고 못박은 자리다.
   *
   * 읽기(정규화)는 계속 관대하다 — 이미 저장된 값에 대한 방어는 던지지 않는 쪽이 맞다.
   */
  const seenSids = new Set<string>();
  const usedSingletons = new Set<string>();
  const settings = obj(src.settings);
  const campaigns = new Map(normalizeCampaigns(settings.campaigns).map((item) => [item.id, item]));
  const destinations = new Map(normalizeDestinations(settings.destinations).map((item) => [item.id, item]));
  const config = src as unknown as ExpoPageConfigV2;

  sections.slice(0, EXPO_LIMITS.sectionsPerPage).forEach((raw, i) => {
    const s = obj(raw);
    const at = `sections[${i}]`;
    const sid = typeof s.sid === "string" ? s.sid : undefined;

    if (!isSid(s.sid)) {
      errors.push({
        path: `${at}.sid`, code: "invalid-sid", sid,
        message: "구획 하나가 신원 없이 왔어요. 새로고침한 뒤 다시 시도해 주세요.",
      });
    } else if (seenSids.has(s.sid)) {
      errors.push({
        path: `${at}.sid`, code: "duplicate-sid", sid,
        message: "같은 구획이 두 번 들어 있어요. 새로고침한 뒤 다시 시도해 주세요.",
      });
    } else {
      seenSids.add(s.sid);
    }

    const def = sectionDef(String(s.type ?? ""));
    if (!def) {
      errors.push({ path: `${at}.type`, code: "unknown-type", sid, message: "알 수 없는 구획이에요" });
      return;
    }

    if (!def.multi) {
      if (usedSingletons.has(def.type)) {
        errors.push({
          path: `${at}.type`, code: "duplicate-singleton", sid,
          message: `${topicParticle(def.label)} 한 페이지에 하나만 놓을 수 있어요`,
        });
      } else {
        usedSingletons.add(def.type);
      }
    }

    const content = obj(s.content);
    if (def.validate) {
      let pluginIssues: unknown;
      try {
        pluginIssues = def.validate(s as unknown as ExpoSection, {
          config,
          sectionIndex: i,
          campaigns,
          destinations,
        });
      } catch {
        pluginIssues = [{
          path: "", code: "invalid-shape", message: "구획 내용의 모양이 올바르지 않아요",
          severity: "error",
        }];
      }
      const issueRows = Array.isArray(pluginIssues) ? pluginIssues : [pluginIssues];
      for (const issue of issueRows) {
        errors.push(normalizePluginIssue(issue, i, sid));
      }
    } else {
      for (const slot of def.slots) {
        validateSlot(slot, content[slot.key], `${at}.content.${slot.key}`, errors);
      }
    }
    // 슬롯 오류에도 어느 카드인지 실어 준다 — path 인덱스 역산은 배열이 바뀌면 어긋난다.
    for (const e of errors) if (e.sid === undefined && e.path.startsWith(`${at}.`)) e.sid = sid;
  });

  // 전체 크기 — 생성 로더가 부풀지 않게 마지막으로 묶는다.
  let total = 0;
  try { total = bytes(JSON.stringify(src) ?? ""); } catch { total = Number.MAX_SAFE_INTEGER; }
  if (total > EXPO_LIMITS.pageDraftBytes) {
    const kb = Math.round(EXPO_LIMITS.pageDraftBytes / 1024);
    errors.push({ path: "sections", code: "too-large", message: `페이지 전체가 ${kb}KB를 넘었어요` });
  }

  if (!errors.length) return { ok: true };
  // 상한에 걸리면 **잘렸다는 사실을 함께** 낸다 — 없으면 고치고 저장했는데 또 막힌다.
  if (errors.length > MAX_ERRORS) {
    const rest = errors.length - MAX_ERRORS;
    return {
      ok: false,
      errors: [
        ...errors.slice(0, MAX_ERRORS),
        { path: "sections", code: "too-many", message: `이 밖에도 ${rest}건이 더 있어요.` },
      ],
    };
  }
  return { ok: false, errors };
}

/** 템플릿 스냅샷 쓰기 — 저장과 인스턴스화 양쪽에서 같은 상한을 건다. */
export function validateTemplateSnapshot(raw: unknown): ValidateResult {
  let total = 0;
  try { total = bytes(JSON.stringify(raw) ?? ""); } catch { total = Number.MAX_SAFE_INTEGER; }
  if (total > EXPO_LIMITS.templateSnapshotBytes) {
    const mb = Math.round(EXPO_LIMITS.templateSnapshotBytes / (1024 * 1024));
    return { ok: false, errors: [{ path: "snapshot", code: "too-large", message: `템플릿이 ${mb}MB를 넘었어요` }] };
  }
  return { ok: true };
}
