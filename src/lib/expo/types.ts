/**
 * 홈페이지 빌더의 **어휘**. React 를 쓰지 않고 DOM 도 만지지 않는다 —
 * 어드민·서버·임베드 번들이 같은 파일을 읽는다(collect-form-config 와 같은 계약).
 */
import type { Localized } from "@/lib/collect-form-config";
import type { ComponentType } from "react";
import type { LinkTarget } from "@/lib/expo/payload";
import type { PayloadSection } from "@/lib/expo/view-sections";

export type { Localized };

/** 슬롯이 담는 것의 종류. 이 7개로 닫는다 — 늘리면 편집 위젯·정규화·렌더가 같이 늘어난다. */
export type SlotKind = "text" | "textarea" | "media" | "link" | "list" | "sourceRef" | "code";

/**
 * 미디어 한 칸. W1 은 **이미지만** 받는다 — 영상·YouTube 는 W2 다.
 * 업로드와 링크 첨부를 구분해 저장하지 않는다: 우리 Storage 주소인지는 URL 로 판정한다.
 */
export interface MediaValue {
  kind: "image";
  url: string;
  /** 접근성 — 비면 렌더가 장식용으로 다룬다. */
  alt?: string;
}

/** 링크 한 칸. `href` 는 http(s) 절대주소이거나 `page:{pageId}` 내부 참조다. */
export interface LinkValue {
  label: string;
  labelI18n?: Localized;
  href: string;
}

export interface SlotDef {
  key: string;
  kind: SlotKind;
  /** 편집기 라벨 — 운영자가 보는 말. */
  label: string;
  required?: boolean;
  /** `list` 전용 — 행 하나의 슬롯들(재귀). */
  itemSlots?: SlotDef[];
  /** 편집기가 빈 행을 지우지 않고 남긴다(타이핑 중인 행이 사라지면 못 쓴다). */
  keepEmptyRows?: boolean;
}

export interface VariantDef {
  id: string;
  label: string;
}

export interface SectionDef {
  type: string;
  label: string;
  /** 첫 번째가 기본값이다 — 모르는 변형은 여기로 강등된다. */
  variants: VariantDef[];
  slots: SlotDef[];
  /** 페이지에 여러 개 놓을 수 있는가. */
  multi: boolean;
  /** 페이지 맨 위에 한 번만 — 키비주얼이 그렇다. */
  pinnedFirst?: boolean;
  /** 디자인 노브의 허용값. 값은 렌더가 data-* 속성으로 쓴다. */
  design?: Record<string, string[]>;
}

/**
 * 페이지에 놓인 섹션 하나.
 *
 * `sid` 는 **불변**이다 — 섹션 단위 스니펫 URL 이 이 값을 참조하므로, 정렬·변형 전환·발행에
 * 살아남아야 한다. 정규화는 유효한 sid 를 절대 새로 만들지 않는다.
 */
export interface ExpoSection {
  sid: string;
  type: string;
  variant: string;
  /** 페이지 렌더에 포함하는가(이중 게이트의 토글 절반). */
  enabled: boolean;
  /**
   * 이 섹션만 따로 임베드해도 되는가. `enabled` 와 **직교**다 —
   * "페이지는 아직인데 히어로만 아임웹에 먼저" 가 부분 이행의 정의다.
   */
  embedEnabled: boolean;
  design: Record<string, string>;
  content: Record<string, unknown>;
}

export interface ExpoTheme {
  accent: string;
  lightBg: string;
  darkBg: string;
}

/** 페이지의 편집 상태(draft)와 발행 스냅샷(published)이 같은 모양이다. */
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
  locales?: string[];
  preset?: string;
  settings?: {
    event?: ExpoEventConfig;
    campaigns?: CampaignConfig[];
    destinations?: DestinationConfig[];
  };
  sections: ExpoSection[];
}

/** V2 is the sole in-memory page shape; V1 is promoted during normalization. */
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

/** 플러그인 정규화는 저장·쓰기·공개 경계 중 어디서 호출됐는지 명시적으로 받는다. */
export interface NormalizeContext {
  locale?: string;
  mode: "stored" | "draft-write" | "public";
}

/** 플러그인 검증이 페이지의 다른 registry 참조를 조회하는 순수 컨텍스트. */
export interface ValidateContext {
  config: ExpoPageConfigV2;
  sectionIndex: number;
  campaigns: ReadonlyMap<string, CampaignConfig>;
  destinations: ReadonlyMap<string, DestinationConfig>;
}

/** 브라우저 플러그인 렌더러가 받는 값. React 런타임과 무관한 DOM 계약이다. */
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

/** Mach 서버 없이 파일 하나에서 도는 복구용 런타임의 닫힌 payload. */
export interface StandaloneExpoRuntimePayload {
  pageId: string;
  sectionId?: string | null;
  theme: ExpoTheme;
  sections: PayloadSection[];
  locale: string;
  /** Export 시각에 굳힌 id → 활성 boolean. 일정·label·override는 artifact에 싣지 않는다. */
  campaigns: Record<string, boolean>;
  destinations: ResolvedDestination[];
  mode: "standalone";
}

export type SectionRenderer = (
  section: PayloadSection,
  context: SectionRenderContext,
) => SectionRenderResult | null;

/** Task 12의 client-only registry가 editor를 덧씌운다. 공용 plugin 객체에는 넣지 않는다. */
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

/**
 * 슬롯 기반 W1 계약의 순수 확장. 모든 hook은 선택 사항이므로 기존 SectionDef가 그대로
 * 동작하며, React 참조는 import type이라 공용 registry/runtime bundle에 남지 않는다.
 */
export interface SectionPlugin extends SectionDef {
  normalize?(content: unknown, context: NormalizeContext): Record<string, unknown>;
  validate?(section: ExpoSection, context: ValidateContext): FieldIssue[];
  hasContent?(section: ExpoSection): boolean;
  render?: SectionRenderer;
  editor?: ComponentType<SectionEditorProps>;
}

export const EXPO_V2_RULES = {
  id: /^[a-z][a-z0-9-]{0,63}$/,
  anchorOrModal: /^[A-Za-z][A-Za-z0-9_-]{0,127}$/,
  analyticsEvent: /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
  timezoneSuffix: /(Z|[+-]\d{2}:\d{2})$/,
  maxRows: 100,
  maxVisibleCtas: 2,
} as const;

/** 운영자가 보는 페이지 상태. 판정은 `derivePageState` 한 곳에서만 한다. */
export type ExpoPageState = "draft" | "published" | "live";
