/**
 * 대회 설정(Competition.config) 의 단일 계약.
 *
 * 정규화 규칙은 webinar-config.ts 의 normalizeRegistrationForm 과 같다: **저장된 값이 낡거나
 * 일부가 비어 있어도 항상 완전한 객체를 돌려준다.** 화면·임베드·서버 검증이 같은 함수를 쓰므로
 * "어드민에선 보이는데 공개 폼에선 안 보인다" 류의 어긋남이 생기지 않는다.
 *
 * 필드 타입은 웨비나 등록 폼과 같은 것을 쓴다(WebinarRegistrationField) — 두 벌로 갈라지면
 * 폼 빌더 UI 도 두 벌이 된다. 대회에만 필요한 첨부 타입만 확장한다.
 */
import { isNoticeLanguage, normalizeNoticePageConfig, type NoticeLanguage, type NoticePageConfig } from "@/lib/notice/config";
import type { WebinarRegistrationField } from "./webinar-config";
import { isLegalCountry, type Country, type OrgProfile, type ThirdParty } from "@/lib/legal-templates/types";
import { resolveOrgTokens } from "@/lib/legal-templates/tokens";

/** 대회 신청 폼에만 있는 추가 타입 — 사진 업로드와 YouTube 링크, 반복 항목(팀원 등), 정수 입력. */
export type CompetitionExtraFieldType = "image" | "youtube" | "repeater" | "number";
export type CompetitionFieldType = WebinarRegistrationField["type"] | CompetitionExtraFieldType;

/** repeater 한 행을 이루는 항목 — 팀원의 "이름", "이메일" 같은 것. */
export interface CompetitionRepeaterSubField {
  key: string;
  label: string;
  type: "text" | "email";
  required: boolean;
}

export interface CompetitionFormField extends Omit<WebinarRegistrationField, "type"> {
  type: CompetitionFieldType;
  /** image 전용 — 받을 장 수. 1장당 요청 1번으로 올린다(Vercel 요청 본문 상한). */
  maxFiles?: number;
  /** repeater 전용 — 반복되는 한 행의 구성(예: 이름+이메일). */
  subFields?: CompetitionRepeaterSubField[];
  /** repeater 전용 — 최소 행 수(0 이면 전부 선택). 최초 화면에도 이만큼 빈 행을 미리 그린다. */
  minItems?: number;
  /** repeater 전용 — 최대 행 수. */
  maxItems?: number;
  /**
   * repeater 전용 — 이 키를 가진 다른 항목의 값(숫자)에서 countExclude 를 뺀 만큼 행 수를
   * 자동으로 맞춘다(예: "리더 포함 인원수"와 연동해 리더 1명을 뺀 팀원 수만큼 행을 채운다).
   * 비어 있으면 신청자가 수동으로만 +/- 한다.
   */
  countFromKey?: string;
  /** repeater 전용 — countFromKey 값에서 제외할 인원 수(리더 등). countFromKey 없으면 무시된다. */
  countExclude?: number;
  /** 눈에 띄게 강조 표시한다 — 참가자격 확인처럼 놓치면 안 되는 체크박스에 쓴다. */
  emphasized?: boolean;
  /**
   * image 전용 — 이 항목에 올린 사진을 팀 로고로 취급한다. 투표·결과 카드에서 대표 사진과
   * 별도로 작은 배지로 노출한다. 한 폼에 최대 하나만 — 여러 개면 어느 로고를 써야 할지
   * 모호해지므로 켤 때 다른 image 항목의 값은 자동으로 꺼진다(EntryFormTab 참고).
   */
  isLogo?: boolean;
}

/**
 * 대표 이름 옆에 붙이는 팀명 — 대표 이름이 이미 팀명이면 비운다("EVO NXT · EVO NXT" 처럼 두 번 나오지 않게).
 */
export function secondaryTeamName(title: string, teamName: string | null | undefined): string | null {
  const team = (teamName ?? "").trim();
  if (!team || team.toLowerCase() === title.trim().toLowerCase()) return null;
  return team;
}

/** 공고 페이지 블록. 대회 소개·참가 자격·신청 절차·일정·FAQ 를 구조로 표현한다. */
export type CompetitionNoticeBlock =
  | { id: string; kind: "richText"; enabled: boolean; title: string; body: string }
  | { id: string; kind: "list"; enabled: boolean; title: string; items: string[] }
  | { id: string; kind: "steps"; enabled: boolean; title: string; steps: Array<{ title: string; description: string }> }
  | { id: string; kind: "infoTable"; enabled: boolean; title: string; rows: Array<{ label: string; value: string }> }
  | { id: string; kind: "faq"; enabled: boolean; title: string; items: Array<{ question: string; answer: string }> }
  | { id: string; kind: "image"; enabled: boolean; title: string; url: string; caption: string };

export interface CompetitionConfig {
  notice: {
    heroTitle: string;
    heroSubtitle: string;
    heroImageUrl: string | null;
    applyLabel: string;
    blocks: CompetitionNoticeBlock[];
  };
  form: {
    title: string;
    description: string;
    fields: CompetitionFormField[];
    /**
     * 연락처(tel) 항목의 기본 국가(ISO 3166-1 alpha-2) — 사전등록(CollectSource)의
     * validation.defaultCountry 와 같은 개념. 국가번호 없이 입력한 번호를 이 나라 기준으로 읽는다.
     */
    defaultCountry: string;
    /**
     * 참가작의 **대표 이름**으로 쓸 신청 항목의 key — 목록·투표·심사·진출·결과·발표 화면이 모두 이 이름을 쓴다.
     * 기본은 "title"(작품명). 기본 항목의 라벨을 바꿔 다른 용도(예: "Instagram")로 쓰면 그 값이 대표 이름이
     * 되어 버린다 — LA K-POP 대회에서 인스타 ID 가 팀 이름 자리에 나왔다(2026-10-18). 그럴 땐 "teamName" 으로.
     */
    displayNameKey: string;
    submitLabel: string;
    /** 동의 — 웨비나 등록 폼과 같은 계약(문구·전문·기본 체크). */
    privacyText: string;
    privacyBody: string;
    privacyBodyMode: "text" | "link";
    privacyLinkUrl: string;
    privacyDefaultChecked: boolean;
    marketingText: string;
    marketingBody: string;
    marketingBodyMode: "text" | "link";
    marketingLinkUrl: string;
    marketingDefaultChecked: boolean;
    /**
     * 제3자 제공 동의 — privacy/marketing과 달리 **꺼져 있을 수 있다.** 모든 대회가 참가자
     * 정보를 제3자(협찬사 등)에게 제공하는 게 아니라서, 이 항목만 enabled 스위치를 따로 둔다.
     */
    thirdPartyEnabled: boolean;
    thirdPartyText: string;
    thirdPartyBody: string;
    thirdPartyBodyMode: "text" | "link";
    thirdPartyLinkUrl: string;
    thirdPartyDefaultChecked: boolean;
    successMessage: string;
  };
  /** 접수 기간 밖에서 폼 대신 보여줄 문구. */
  statusMessages: {
    upcoming: string;
    closed: string;
  };
  /**
   * 공고 상세페이지(섹션 빌더). 예전 블록 빌더(notice)와 **함께** 산다 —
   * 이미 블록으로 만든 대회의 내용을 지우지 않으려고 둘 다 남겨 둔다.
   *
   * 이 정규화 함수가 만드는 객체가 곧 저장되는 값이라(PATCH 가 결과를 그대로 쓴다),
   * 여기 빠진 키는 **저장 시점에 조용히 사라진다**. 실제로 그렇게 한 번 날렸다.
   */
  noticePage: NoticePageConfig;
  /**
   * 대회 **전체**의 문구 언어 — 공고·신청 폼이 함께 쓴다.
   *
   * 처음에는 공고에만 두었는데(noticePage.language), 그러면 공고는 영어인데 신청 폼 안내는
   * 한글로 남는다. 방문자에게는 같은 한 흐름이라 화면마다 언어가 달라질 이유가 없다.
   * 기존 대회가 리셋되지 않게 **noticePage.language 를 폴백으로 읽는다**.
   */
  language: NoticeLanguage;
  /**
   * 법률 문구 생성기(§legal-templates)가 쓰는 "빈칸". CollectSource 와 달리 대회에는 구조화된
   * 개최일·장소 필드가 없어(공고 블록은 자유 서술이다) eventName/eventDates/venue 를 여기서
   * 따로 받는다 — 사전등록 쪽 legal 과 크기가 다른 이유다.
   */
  legal: {
    country: Country;
    eventName: string;
    eventDates: string[];
    venue: string;
    onSitePhotography: boolean;
    thirdParties: ThirdParty[];
    dataRetentionNote: string;
    effectiveDate: string;
    /** 성인 전용 대회 여부 — 끄면(기본) 미성년자 참가를 전제로 한 법정대리인 동의 문단이 들어간다. */
    adultsOnly: boolean;
  };
  /**
   * 투표 화면 상단 소개 문구. 참가작 카드보다 먼저 보이는, 대회 전체가 공유하는 한 블록이다
   * (라운드마다 다시 쓰지 않는다 — 예선·본선 화면 둘 다 여기 값을 그대로 쓴다). 레퍼런스
   * 사이트(fr.france.k-expo.org/vote)에 있던 행사 소개·설명 자리를 하드코딩이 아니라
   * 운영자가 채우는 구조로 들인다.
   */
  voteIntro: {
    enabled: boolean;
    title: string;
    body: string;
    /** 빈 문자열이면 테마 기본 글자색을 그대로 쓴다. */
    textColor: string;
    titleFontSize: number;
    bodyFontSize: number;
  };
}

export const COMPETITION_MEDIA = {
  /** Vercel 요청 본문 상한 4.5MB 아래로 잡은 값 — 요청에는 파일 외 필드와 multipart 오버헤드가 함께 실린다. */
  MAX_IMAGE_BYTES: 4 * 1024 * 1024,
  IMAGE_MIME_TYPES: ["image/jpeg", "image/png", "image/webp"] as const,
} as const;

export const DEFAULT_COMPETITION_FIELDS: CompetitionFormField[] = [
  { id: "f-title", key: "title", label: "작품명", type: "text", placeholder: "", required: true, enabled: true, options: [], system: true },
  { id: "f-team", key: "teamName", label: "팀명", type: "text", placeholder: "", required: false, enabled: true, options: [], system: true },
  { id: "f-name", key: "name", label: "대표자 이름", type: "text", placeholder: "", required: true, enabled: true, options: [], system: true },
  { id: "f-email", key: "email", label: "이메일", type: "email", placeholder: "", required: true, enabled: true, options: [], system: true },
  { id: "f-phone", key: "phone", label: "연락처", type: "tel", placeholder: "01012345678", required: true, enabled: true, options: [], system: true },
  { id: "f-summary", key: "summary", label: "작품 소개", type: "text", placeholder: "", required: false, enabled: true, options: [], system: true },
  { id: "f-image", key: "images", label: "이미지", type: "image", placeholder: "", required: false, enabled: true, options: [], system: false, maxFiles: 3 },
  { id: "f-video", key: "videoUrl", label: "영상 링크 (YouTube)", type: "youtube", placeholder: "https://youtube.com/watch?v=...", required: false, enabled: true, options: [], system: false },
];

const DEFAULT_NOTICE_BLOCKS: CompetitionNoticeBlock[] = [
  { id: "b-about", kind: "richText", enabled: true, title: "대회 소개", body: "" },
  { id: "b-who", kind: "list", enabled: true, title: "참가 자격", items: [""] },
  { id: "b-how", kind: "steps", enabled: true, title: "신청 방법 및 절차", steps: [{ title: "", description: "" }] },
  { id: "b-info", kind: "infoTable", enabled: true, title: "행사 개요", rows: [{ label: "", value: "" }] },
  { id: "b-faq", kind: "faq", enabled: false, title: "자주 묻는 질문", items: [{ question: "", answer: "" }] },
];

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
/** 운영자가 입력한 글자 크기(px). 범위를 벗어나면 레이아웃이 깨지므로 저장 시점에 가둔다. */
function clampFontSize(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** repeater 한 행의 서브필드 하나 — 잘못된 행(키 없음)은 버린다. */
function normalizeSubField(raw: unknown, index: number): CompetitionRepeaterSubField | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const key = str(f.key).trim();
  if (!key) return null;
  const type = str(f.type, "text") === "email" ? "email" : "text";
  return { key, label: str(f.label) || key, type, required: bool(f.required, true) };
}

/** 새로 반복 타입으로 바꿨는데 서브필드가 하나도 없으면 아무것도 못 받는 빈 항목이 된다. */
const DEFAULT_REPEATER_SUB_FIELDS: CompetitionRepeaterSubField[] = [
  { key: "name", label: "이름", type: "text", required: true },
  { key: "email", label: "이메일", type: "email", required: true },
];

function normalizeField(raw: unknown, index: number): CompetitionFormField | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const key = str(f.key).trim();
  if (!key) return null;
  const type = str(f.type, "text") as CompetitionFieldType;
  const subFields = Array.isArray(f.subFields)
    ? f.subFields.map(normalizeSubField).filter((s): s is CompetitionRepeaterSubField => s !== null)
    : [];
  return {
    id: str(f.id) || `f-${index}-${key}`,
    key,
    label: str(f.label) || key,
    type,
    placeholder: str(f.placeholder),
    required: bool(f.required),
    enabled: bool(f.enabled, true),
    options: strArray(f.options),
    system: bool(f.system),
    ...(typeof f.maxSelect === "number" && f.maxSelect >= 1 ? { maxSelect: Math.floor(f.maxSelect) } : {}),
    ...(typeof f.allowOther === "boolean" ? { allowOther: f.allowOther } : {}),
    ...(typeof f.maxFiles === "number" && f.maxFiles >= 1 ? { maxFiles: Math.floor(f.maxFiles) } : {}),
    ...(type === "repeater"
      ? {
          subFields: subFields.length > 0 ? subFields : DEFAULT_REPEATER_SUB_FIELDS,
          minItems: typeof f.minItems === "number" && f.minItems >= 0 ? Math.floor(f.minItems) : 1,
          maxItems: typeof f.maxItems === "number" && f.maxItems >= 1 ? Math.floor(f.maxItems) : 10,
          ...(str(f.countFromKey).trim()
            ? {
                countFromKey: str(f.countFromKey).trim(),
                countExclude: typeof f.countExclude === "number" && f.countExclude >= 0 ? Math.floor(f.countExclude) : 0,
              }
            : {}),
        }
      : {}),
    ...(type === "checkbox" ? { emphasized: bool(f.emphasized) } : {}),
    ...(type === "image" ? { isLogo: bool(f.isLogo) } : {}),
  };
}

function normalizeBlock(raw: unknown, index: number): CompetitionNoticeBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const id = str(b.id) || `b-${index}`;
  const title = str(b.title);
  const enabled = bool(b.enabled, true);
  switch (str(b.kind)) {
    case "richText":
      return { id, kind: "richText", enabled, title, body: str(b.body) };
    case "list":
      return { id, kind: "list", enabled, title, items: strArray(b.items) };
    case "steps":
      return {
        id, kind: "steps", enabled, title,
        steps: Array.isArray(b.steps)
          ? b.steps.map((s) => ({ title: str((s as Record<string, unknown>)?.title), description: str((s as Record<string, unknown>)?.description) }))
          : [],
      };
    case "infoTable":
      return {
        id, kind: "infoTable", enabled, title,
        rows: Array.isArray(b.rows)
          ? b.rows.map((r) => ({ label: str((r as Record<string, unknown>)?.label), value: str((r as Record<string, unknown>)?.value) }))
          : [],
      };
    case "faq":
      return {
        id, kind: "faq", enabled, title,
        items: Array.isArray(b.items)
          ? b.items.map((i) => ({ question: str((i as Record<string, unknown>)?.question), answer: str((i as Record<string, unknown>)?.answer) }))
          : [],
      };
    case "image":
      return { id, kind: "image", enabled, title, url: str(b.url), caption: str(b.caption) };
    default:
      return null;
  }
}

export interface NormalizeCompetitionConfigOptions {
  /** 어드민 편집 화면은 꺼 둔 항목도 봐야 한다. 공개/제출 경로는 기본값(false)으로 enabled 만 받는다. */
  includeDisabled?: boolean;
}

export function normalizeCompetitionConfig(
  raw: unknown,
  options: NormalizeCompetitionConfigOptions = {},
): CompetitionConfig {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const noticeRaw = (source.notice && typeof source.notice === "object" ? source.notice : {}) as Record<string, unknown>;
  const formRaw = (source.form && typeof source.form === "object" ? source.form : {}) as Record<string, unknown>;
  const statusRaw = (source.statusMessages && typeof source.statusMessages === "object" ? source.statusMessages : {}) as Record<string, unknown>;

  const savedBlocks = Array.isArray(noticeRaw.blocks)
    ? noticeRaw.blocks.map(normalizeBlock).filter((b): b is CompetitionNoticeBlock => b !== null)
    : DEFAULT_NOTICE_BLOCKS;

  const savedFields = Array.isArray(formRaw.fields)
    ? formRaw.fields.map(normalizeField).filter((f): f is CompetitionFormField => f !== null)
    : DEFAULT_COMPETITION_FIELDS;

  const notice = normalizeNoticePageConfig(source, { keepEmptyRows: options.includeDisabled });

  const legalRaw = (source.legal && typeof source.legal === "object" ? source.legal : {}) as Record<string, unknown>;
  const thirdPartiesRaw = Array.isArray(legalRaw.thirdParties) ? legalRaw.thirdParties : [];
  const voteIntroRaw = (source.voteIntro && typeof source.voteIntro === "object" ? source.voteIntro : {}) as Record<string, unknown>;

  return {
    notice: {
      heroTitle: str(noticeRaw.heroTitle),
      heroSubtitle: str(noticeRaw.heroSubtitle),
      heroImageUrl: typeof noticeRaw.heroImageUrl === "string" && noticeRaw.heroImageUrl ? noticeRaw.heroImageUrl : null,
      // 기본값을 여기서 한글로 못 박지 않는다 — 지금은 admin UI 에 이 값을 편집하는
      // 칸이 없어서 항상 이 기본값이 그대로 쓰이는데, 그러면 영문 공고에도 CTA 버튼만
      // 한글로 뜬다. 언어별 기본값은 renderNoticeHtml 이 competitionFormStrings 로 채운다.
      applyLabel: str(noticeRaw.applyLabel),
      blocks: options.includeDisabled ? savedBlocks : savedBlocks.filter((b) => b.enabled),
    },
    form: {
      /* 기본값을 한글로 굳히지 않는다 — 굳히면 언어를 영어로 바꿔도 이 자리만 한글로 남고
         되돌릴 방법이 없다(공고 CTA 에서 같은 함정에 걸렸다). 비면 렌더러가 사전값을 쓴다. */
      title: str(formRaw.title),
      description: str(formRaw.description),
      fields: options.includeDisabled ? savedFields : savedFields.filter((f) => f.enabled),
      // 모양만 본다(2글자) — 실재하는 코드인지는 collect-phone.isSupportedCountry 가 맡는다.
      // 이 파일은 임베드 번들에 들어가므로 국가 메타데이터를 들이지 않는다(같은 이유 §6.3).
      defaultCountry: /^[A-Za-z]{2}$/.test(str(formRaw.defaultCountry)) ? str(formRaw.defaultCountry).toUpperCase() : "US",
      displayNameKey: /^[A-Za-z0-9_]{1,60}$/.test(str(formRaw.displayNameKey)) ? str(formRaw.displayNameKey) : "title",
      submitLabel: str(formRaw.submitLabel),
      privacyText: str(formRaw.privacyText, "[필수] 개인정보 수집 및 이용에 동의합니다"),
      privacyBody: str(formRaw.privacyBody),
      privacyBodyMode: formRaw.privacyBodyMode === "link" ? "link" : "text",
      privacyLinkUrl: str(formRaw.privacyLinkUrl),
      privacyDefaultChecked: bool(formRaw.privacyDefaultChecked),
      marketingText: str(formRaw.marketingText, "[선택] 마케팅 정보 수신에 동의합니다"),
      marketingBody: str(formRaw.marketingBody),
      marketingBodyMode: formRaw.marketingBodyMode === "link" ? "link" : "text",
      marketingLinkUrl: str(formRaw.marketingLinkUrl),
      marketingDefaultChecked: bool(formRaw.marketingDefaultChecked),
      thirdPartyEnabled: bool(formRaw.thirdPartyEnabled),
      thirdPartyText: str(formRaw.thirdPartyText, "[선택] 개인정보 제3자 제공에 동의합니다"),
      thirdPartyBody: str(formRaw.thirdPartyBody),
      thirdPartyBodyMode: formRaw.thirdPartyBodyMode === "link" ? "link" : "text",
      thirdPartyLinkUrl: str(formRaw.thirdPartyLinkUrl),
      thirdPartyDefaultChecked: bool(formRaw.thirdPartyDefaultChecked),
      successMessage: str(formRaw.successMessage, "신청이 접수되었어요."),
    },
    statusMessages: {
      upcoming: str(statusRaw.upcoming, "접수 시작 전이에요."),
      closed: str(statusRaw.closed, "접수가 마감되었어요."),
    },
    // 공고 상세페이지는 자기 정규화 함수가 소유한다 — 여기서 다시 풀어 쓰면 두 벌이 된다.
    noticePage: notice,
    // 위로 올린 값. 예전에 공고에만 정해 둔 대회는 그 값을 그대로 이어받는다.
    language: isNoticeLanguage(source.language) ? source.language : notice.language,
    legal: {
      country: isLegalCountry(legalRaw.country) ? legalRaw.country : "us",
      eventName: str(legalRaw.eventName),
      eventDates: strArray(legalRaw.eventDates).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      venue: str(legalRaw.venue),
      onSitePhotography: bool(legalRaw.onSitePhotography),
      thirdParties: thirdPartiesRaw
        .map((t) => {
          const tr = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
          return { name: str(tr.name), purpose: str(tr.purpose) };
        })
        .filter((t) => t.name !== ""),
      dataRetentionNote: str(legalRaw.dataRetentionNote),
      effectiveDate: str(legalRaw.effectiveDate),
      adultsOnly: bool(legalRaw.adultsOnly),
    },
    voteIntro: {
      enabled: bool(voteIntroRaw.enabled),
      title: str(voteIntroRaw.title),
      body: str(voteIntroRaw.body),
      textColor: /^#[0-9a-fA-F]{6}$/.test(str(voteIntroRaw.textColor)) ? str(voteIntroRaw.textColor) : "",
      titleFontSize: clampFontSize(voteIntroRaw.titleFontSize, 22, 14, 48),
      bodyFontSize: clampFontSize(voteIntroRaw.bodyFontSize, 15, 11, 28),
    },
  };
}

/**
 * 동의 전문에 남아 있는 조직 토큰({{ORG_ADDRESS}} 등, §legal-templates/tokens)을 지금 워크스페이스
 * 값으로 채운다. CollectSource 의 resolveCollectFormConfigOrgTokens 와 같은 이유로, 공개 화면에
 * config 를 내보내기 직전(임베드 로더)에 불러야 방문자가 항상 최신 회사 정보를 본다.
 */
export function resolveCompetitionConfigOrgTokens(config: CompetitionConfig, org: OrgProfile): CompetitionConfig {
  const locale = config.legal.country === "kr" ? "ko" : "en";
  return {
    ...config,
    form: {
      ...config.form,
      privacyBody: resolveOrgTokens(config.form.privacyBody, org, locale),
      marketingBody: resolveOrgTokens(config.form.marketingBody, org, locale),
      thirdPartyBody: resolveOrgTokens(config.form.thirdPartyBody, org, locale),
    },
  };
}

export const DEFAULT_COMPETITION_THEME = {
  accentColor: "#6d28d9",
  textColor: "#111111",
  surfaceColor: "#ffffff",
  borderRadius: "12px",
  logoUrl: "",
};

/**
 * YouTube URL 에서 videoId 만 뽑는다.
 *
 * 사람들이 붙여 넣는 형태가 제각각이라(watch / youtu.be / shorts / embed, 뒤에 &t= &list=)
 * 원본 URL 을 그대로 저장하면 재생·썸네일마다 다시 파싱해야 한다. **videoId 만 저장한다.**
 * 인식 못 하면 null — 호출부가 "링크를 확인해주세요"로 되돌린다.
 */
export function extractYoutubeId(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  // 11자 ID 를 그대로 붙여 넣은 경우도 받아준다.
  if (/^[\w-]{11}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  let id = "";
  if (host === "youtu.be") {
    id = url.pathname.slice(1);
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
    else if (url.pathname.startsWith("/shorts/")) id = url.pathname.slice("/shorts/".length);
    else if (url.pathname.startsWith("/embed/")) id = url.pathname.slice("/embed/".length);
    else if (url.pathname.startsWith("/live/")) id = url.pathname.slice("/live/".length);
  }
  id = id.split("/")[0].split("?")[0];
  return /^[\w-]{11}$/.test(id) ? id : null;
}

/** 목록에서 iframe 을 20개 붙이면 페이지가 죽는다 — 썸네일을 깔고 클릭했을 때만 재생한다. */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export type CompetitionMediaItem =
  /** role: "logo" — isLogo 항목에서 올린 사진. 종류는 여전히 image라 기존 갤러리에도 그대로 잡힌다. */
  | { kind: "image"; url: string; sortOrder: number; role?: "logo" }
  | { kind: "youtube"; videoId: string; sortOrder: number };

export function normalizeMedia(raw: unknown): CompetitionMediaItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CompetitionMediaItem[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const m = item as Record<string, unknown>;
    const sortOrder = typeof m.sortOrder === "number" ? m.sortOrder : index;
    if (m.kind === "image" && typeof m.url === "string" && m.url) {
      out.push({ kind: "image", url: m.url, sortOrder, ...(m.role === "logo" ? { role: "logo" } : {}) });
    } else if (m.kind === "youtube" && typeof m.videoId === "string" && m.videoId) {
      out.push({ kind: "youtube", videoId: m.videoId, sortOrder });
    }
  });
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 반복 항목(팀원 등) 제출값 검증·정리 — 서버가 클라이언트를 못 믿고 다시 하는 부분.
 *
 * 대회 신청 API(entries/route.ts)와 여기서 로직을 나눠 두는 이유: 이 함수는 순수 함수라
 * DB·Request 없이 테스트할 수 있다 — 몇 번째 행의 어떤 서브필드가 비었는지까지 검증하는
 * 로직을 라우트 안에 그대로 두면 그 부분만 따로 확인할 방법이 없다.
 *
 * 성공하면 { items }, 실패하면 어느 라벨이 문제인지(`t.fieldRequired(label)` 에 바로 꽂는 값)
 * 를 { errorLabel } 로 돌려준다 — 문구 자체는 호출자가 언어 사전으로 채운다.
 */
export function normalizeRepeaterSubmission(
  field: CompetitionFormField,
  raw: unknown,
): { items: Record<string, string>[] } | { errorLabel: string } {
  const subFields = field.subFields ?? [];
  const minItems = field.minItems ?? 0;
  const rawItems = Array.isArray(raw) ? raw : [];
  const items: Record<string, string>[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const rawItem = rawItems[i];
    if (!rawItem || typeof rawItem !== "object") continue;
    const source = rawItem as Record<string, unknown>;
    const item: Record<string, string> = {};
    let hasAny = false;
    for (const sf of subFields) {
      const v = typeof source[sf.key] === "string" ? (source[sf.key] as string).trim() : "";
      if (v) { item[sf.key] = v; hasAny = true; }
    }
    // 필수 행 수를 넘는 보너스 행이 완전히 비어 있으면 조용히 버린다 — 채우다 만 흔적이
    // 아니라 애초에 안 쓴 행이다.
    if (!hasAny && i >= Math.max(minItems, 1)) continue;
    for (const sf of subFields) {
      if (sf.required && !item[sf.key]) {
        return { errorLabel: `${field.label} ${i + 1} · ${sf.label}` };
      }
    }
    items.push(item);
  }

  if (field.required && items.length === 0) return { errorLabel: field.label };
  return { items };
}
