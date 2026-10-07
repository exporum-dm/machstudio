/**
 * 상세페이지 — 대회 공고 페이지와 **같은 렌더러(src/lib/notice)** 로 그리는 독립 페이지.
 *
 * 저장 모양: DetailPage.config = { noticePage: NoticePageConfig, page: DetailPageSettings }
 *   - noticePage : 공고와 똑같다(섹션·색·히어로). 편집기도 공고 탭을 그대로 쓴다.
 *   - page       : 공고에는 없는 상세페이지 전용 값 — 주 버튼 링크, 카운트다운 마감 시각.
 *
 * 대회 공고의 주 버튼은 신청 팝업을 연다. 상세페이지에는 신청 폼이 없으므로 **링크로 보낸다**
 * (사전등록 폼·아임웹 다른 페이지 등). 링크가 비어 있으면 버튼을 그리지 않는다 — 눌러도
 * 아무 일 없는 버튼을 방문자에게 보이지 않는다.
 *
 * 브라우저 번들(/d/{id})에도 들어가므로 Node·React 에 의존하지 않는다.
 */
import type { NoticeCompetition } from "@/lib/notice/types";

export interface DetailPageSettings {
  /** 주 버튼 링크. http(s)·같은 사이트 경로(/…)·이 페이지 섹션(#form). 비우면 버튼을 안 그린다. */
  ctaUrl: string;
  ctaNewTab: boolean;
  /** 카운트다운 섹션의 마감 시각(ISO). 비우면 카운트다운이 안 나온다. */
  deadline: string | null;
}

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** 링크로 내보내도 되는 주소인가 — javascript: 같은 스킴을 외부 사이트에 심지 않는다. */
export function isSafeLinkUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  // 같은 페이지의 섹션(#form 등) — 신청 폼으로 내려보내는 버튼.
  if (/^#[a-z]+$/.test(value)) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function normalizeDetailPageSettings(config: unknown): DetailPageSettings {
  const page = obj(obj(config).page);
  const ctaUrl = typeof page.ctaUrl === "string" ? page.ctaUrl.trim() : "";
  const deadlineRaw = typeof page.deadline === "string" ? page.deadline : "";
  const deadline = deadlineRaw && !Number.isNaN(new Date(deadlineRaw).getTime()) ? new Date(deadlineRaw).toISOString() : null;
  return { ctaUrl, ctaNewTab: page.ctaNewTab === true, deadline };
}

/**
 * 공고 렌더러가 읽는 "대회" 모양으로 옮긴다.
 *
 * 렌더러는 대회 정보를 받게 짜여 있지만, 상세페이지에 필요한 건 이름·키컬러·마감 시각뿐이다.
 * 접수 상태는 늘 "열림"으로 두고(버튼 잠금 없음), 선발 방식·심사 기준의 auto 소스(라운드)는
 * 비워 둔다 — 상세페이지 편집기는 그 두 섹션을 직접 입력(manual)으로만 연다.
 */
export function detailPageNoticeCompetition(input: {
  id: string;
  name: string;
  theme: Record<string, string>;
  settings: DetailPageSettings;
  /** 신청 폼 섹션이 부를 machstudio 주소 — 임베드 로더가 넘긴다. 미리보기는 비워도 된다. */
  formOrigin?: string | null;
}): NoticeCompetition {
  const { settings } = input;
  return {
    id: input.id,
    name: input.name,
    description: null,
    theme: input.theme,
    recruitOpenAt: null,
    recruitCloseAt: settings.deadline,
    phase: "recruiting",
    canApply: true,
    statusMessages: { upcoming: "", closed: "" },
    rounds: [],
    cta: isSafeLinkUrl(settings.ctaUrl) ? { href: settings.ctaUrl, newTab: settings.ctaNewTab } : null,
    formOrigin: input.formOrigin ?? null,
  };
}

/** 새 상세페이지의 시작 내용 — 공개 상태, 히어로 제목만 채운 빈 페이지. */
export function initialDetailPageConfig(name: string) {
  return {
    noticePage: {
      enabled: true,
      language: "ko",
      hero: { titleLines: [name] },
      // 상세페이지에는 라운드 데이터가 없다 — 두 섹션은 처음부터 직접 입력으로 둔다.
      selection: { source: "manual" },
      criteria: { source: "manual" },
    },
    page: { ctaUrl: "", ctaNewTab: false, deadline: null },
  };
}
