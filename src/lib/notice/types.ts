/**
 * 대회 공고 상세페이지 데이터 형태 — 어드민 미리보기 / 외부 사이트 임베드 공통.
 * React 나 Next 에 의존하지 않는다(브라우저 번들에 그대로 들어간다).
 *
 * 랜딩(LandingModel)과 같은 규약: 파생·조건 판단은 전부 여기서 끝내고, 뷰는 값을 읽기만
 * 한다. 미리보기와 실물이 같은 결론을 보게 하려는 목적이다.
 */
import type { NoticeStrings } from "./strings";
import type { CompetitionPhase } from "@/lib/competition-status";
import type {
  NoticeCriterionItem,
  NoticePageConfig,
  NoticeSectionKey,
  NoticeSelectionRound,
} from "./config";

/** 공고가 그리는 데 필요한 대회 정보. 임베드 페이로드로 그대로 실린다. */
export interface NoticeCompetition {
  id: string;
  name: string;
  description: string | null;
  theme: Record<string, string>;
  recruitOpenAt: string | null;
  recruitCloseAt: string | null;
  phase: CompetitionPhase;
  /** 서버가 resolveCompetitionStatus 로 판정한 값 — 히어로 CTA 가 이걸 보고 갈린다. */
  canApply: boolean;
  /** 접수 전·마감 화면에 쓸 문구. */
  statusMessages: { upcoming: string; closed: string };
  /**
   * 선발 방식·심사 기준의 `auto` 소스. 심사단 탭·투표 설정에서 온 값이라
   * 공고에 손으로 옮겨 적지 않아도 된다(배점을 바꾸면 공고도 따라 바뀐다).
   */
  rounds: NoticeRound[];
  /**
   * 주 버튼이 할 일. **없으면(undefined) 대회 공고** — 버튼이 신청 팝업(onApply)을 연다.
   * 상세페이지(src/lib/detail-page)는 신청 폼이 없어 링크로 보낸다: 객체면 그 주소로 가는
   * 링크, null 이면 링크를 아직 안 정한 것이라 버튼을 그리지 않는다.
   */
  cta?: { href: string; newTab: boolean } | null;
}

export interface NoticeRound {
  kind: "prelim" | "final";
  name: string;
  publicWeight: number;
  judgeWeight: number;
  criteria: NoticeCriterionItem[];
}

export interface NoticeTocItem {
  /** uid 접두 **전**의 base id. 접두는 sectionId() 가 한 번만 붙인다. */
  id: string;
  label: string;
}

export interface NoticeModel {
  competition: NoticeCompetition;
  np: NoticePageConfig;
  /** 시스템 생성 문구 사전 — np.language 에서 고른다. 뷰는 한글을 직접 쓰지 않는다. */
  t: NoticeStrings;
  /** 인스턴스 고유 접두 — 한 페이지에 공고가 둘 이상 붙어도 id 가 안 부딪히게. */
  uid: string;
  accent: string;
  onPrimary: string;

  /** 히어로 — 폴백은 모델에서 한 번만 계산한다. */
  brand: string;
  titleLines: string[];
  subtitle: string;
  /** 접수 중이면 설정한 CTA 문구, 아니면 상태 문구. */
  ctaLabel: string;
  /** 신청 팝업을 열 수 있는 상태인가. false 면 버튼이 잠긴다. */
  ctaEnabled: boolean;
  /** 버튼 아래 안내 — 접수 전·마감일 때만 채워진다. */
  ctaNote: string;

  /** 켠 섹션만 담긴다. 순서는 렌더 순서. */
  tocItems: NoticeTocItem[];
  /** "토글 ON + 데이터 있음" 이중 게이트 결과. 뷰는 이것만 믿는다. */
  show: Record<NoticeSectionKey, boolean>;

  /** auto/manual 을 이미 해소한 값. 뷰는 출처를 몰라도 된다. */
  selectionRounds: NoticeSelectionRound[];
  criteriaItems: NoticeCriterionItem[];
  criteriaTotal: number;

  /** 주 버튼을 그릴지 — 상세페이지에서 링크를 안 정했으면 false. */
  ctaVisible: boolean;
  /** 주 버튼이 링크면 그 주소. null 이면 버튼(onApply). */
  ctaLink: { href: string; newTab: boolean } | null;

  /** 카운트다운 목표 시각(ISO). 없으면 섹션이 꺼진다. */
  deadline: string | null;

  embedded: boolean;
  isPreview: boolean;
  sectionId: (base: string) => string;
}
