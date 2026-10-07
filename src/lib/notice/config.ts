/**
 * 대회 공고 상세페이지 설정.
 *
 * 웨비나 랜딩(LandingPageConfig)과 같은 규약을 따른다 — 섹션마다 enabled 토글, 섹션마다
 * 라이트/다크, 배경 키컬러 두 개에서 나머지 색을 파생. 같은 껍데기를 쓰므로 계약도 같아야
 * "한쪽에서 되던 게 다른 쪽에서 안 되는" 일이 안 생긴다.
 *
 * 저장 위치는 Competition.config.noticePage 다. 예전 블록 빌더(config.notice)는 지우지 않는다
 * — 이미 만든 대회의 내용이 사라지면 안 된다.
 */

/**
 * **기본** 렌더 순서. 편집 UI 도 이 순서를 쓴다. 운영자가 순서를 바꾸면 np.order 가 이걸 덮는다.
 *
 * banner·split·video·form 은 상세페이지(2026-10)에서 들어왔다 — 아임웹으로 손수 만들던 행사 상세
 * (사진 위 큰 문구, 사진+색 패널, 연습 영상, 신청 폼)를 이 빌더로 옮기려고. 대회 공고에서도
 * banner·split·video 는 쓸 수 있다. form 은 상세페이지 전용(pageOnly) — 대회는 자체 신청 팝업이 있다.
 */
export const NOTICE_SECTIONS = [
  { key: "concept", label: "개념", note: "이 대회가 무엇인지 한 문장으로" },
  { key: "banner", label: "사진 배너", note: "화면 가득 사진 위에 큰 문구 — 아래 '배경 이미지'에 사진을 넣어요" },
  { key: "split", label: "사진 + 글", note: "한쪽은 사진, 한쪽은 키컬러 패널에 글" },
  { key: "video", label: "영상", note: "유튜브 영상(쇼츠 포함)을 페이지 안에서 재생" },
  { key: "snapshot", label: "한눈에 보기", note: "형식·일시·인원 같은 사실을 카드로" },
  { key: "timeline", label: "타임라인", note: "접수부터 결선까지 날짜" },
  { key: "apply", label: "신청 방법", note: "준비물을 번호 카드로" },
  { key: "eligibility", label: "자격 요건", note: "체크 목록" },
  { key: "selection", label: "선발 방식", note: "라운드별 반영 비율 막대" },
  { key: "criteria", label: "심사 기준", note: "항목과 배점" },
  { key: "prizes", label: "상금 · 시상", note: "1등은 자동으로 강조돼요" },
  { key: "countdown", label: "마감 카운트다운", note: "접수 마감까지 남은 시간" },
  { key: "form", label: "신청 폼", note: "사전등록 폼을 이 페이지 안에 바로 넣어요", pageOnly: true },
  { key: "faq", label: "자주 묻는 질문", note: "" },
  { key: "sponsors", label: "주최 · 후원", note: "로고는 어느 모드에서든 흰 판 위에 올라갑니다" },
] as const satisfies readonly { key: string; label: string; note: string; pageOnly?: true }[];

/** 대회 공고에서는 숨기는 섹션인가. */
export function isPageOnlySection(key: NoticeSectionKey): boolean {
  return NOTICE_SECTIONS.some((s) => s.key === key && "pageOnly" in s && s.pageOnly);
}

export type NoticeSectionKey = (typeof NOTICE_SECTIONS)[number]["key"];
export type NoticeSectionBg = "light" | "dark";
export type NoticeBgKey = NoticeSectionKey | "hero";
export type NoticeSectionBgMap = Record<NoticeBgKey, NoticeSectionBg>;

export interface NoticeHeroFact { label: string; value: string }
export interface NoticeStatItem { label: string; value: string; note: string }
/** emphasis: 그 줄의 점을 키컬러로 — 접수 마감·결선처럼 눈이 먼저 가야 하는 날. */
export interface NoticeTimelineItem { date: string; title: string; description: string; emphasis: boolean }
export interface NoticeStepItem { title: string; items: string[] }
export interface NoticeSelectionBar { label: string; percent: number }
export interface NoticeSelectionRound { title: string; note: string; bars: NoticeSelectionBar[] }
export interface NoticeCriterionItem { name: string; description: string; points: number }
export interface NoticePrizeItem { rank: string; title: string; description: string; amount: string }
export interface NoticeFaqItem { question: string; answer: string }
export interface NoticeSponsorItem { tier: string; name: string; logoUrl: string; url: string }
/** 사진 + 글 섹션의 사진. 초점은 배경과 같은 규칙(데스크톱·모바일 따로). */
export interface NoticeSplitImage { url: string; focus: NoticeMediaFocus; mobileFocus: NoticeMediaFocus }

/**
 * 배경 미디어 + **초점**.
 *
 * focus 는 object-position 이다(0~100%). 가로 사진을 모바일 세로 화면에 깔면 좌우가 크게
 * 잘리는데, 기본값 가운데(50/50)가 하필 인물이나 로고를 비껴가는 일이 흔하다 — 실제로
 * 데스크톱은 멀쩡한데 모바일만 엉뚱한 데가 보였다.
 *
 * **데스크톱과 모바일을 따로 둔다.** 잘리는 방향이 반대라(가로 화면은 위아래가, 세로
 * 화면은 좌우가 잘린다) 값 하나로는 양쪽을 동시에 맞출 수 없다.
 */
export interface NoticeMediaFocus { x: number; y: number }
export type NoticeHeroMedia =
  | { type: "image" | "video"; url: string; focus: NoticeMediaFocus; mobileFocus: NoticeMediaFocus }
  | null;

/**
 * 섹션 배경 — 없으면 색만 칠한다(기본). 어울리는 섹션에만 켠다.
 *
 * scrim/panel 은 **사진 위에서 글이 읽히게 하는 두 손잡이**다.
 * 카드들은 원래 평평한 색 위에 놓일 걸 전제로 --paper 5% 정도의 옅은 막으로 그려져 있다.
 * 그 뒤에 사진이 깔리면 카드가 거의 사라져서 안이 안 읽힌다 — 실제로 그렇게 보였다.
 * 사진마다 밝기가 달라 한 값으로 못 맞추므로 운영자가 섹션마다 정한다.
 */
export type NoticeSectionMedia = {
  url: string;
  focus: NoticeMediaFocus;
  mobileFocus: NoticeMediaFocus;
  /** 배경 위에 덮는 섹션색의 진하기(0~100). 높을수록 사진이 흐려지고 글이 잘 읽힌다. */
  scrim: number;
  /** 카드·박스 바탕의 진하기(0~100). 높을수록 카드가 또렷해진다. */
  panel: number;
} | null;
export type NoticeSectionMediaMap = Partial<Record<NoticeBgKey, NoticeSectionMedia>>;

export interface NoticeHero {
  media: NoticeHeroMedia;
  /** 히어로 상단 작은 라벨 — 비우면 대회 이름 */
  brand: string;
  /** 대형 타이틀(줄 단위) — 두 번째 줄부터 키컬러가 된다 */
  titleLines: string[];
  subtitle: string;
  /** 주 버튼 — 신청 팝업을 연다 */
  ctaLabel: string;
  /**
   * 접수 전·마감 후에 버튼과 그 아래에 뜨는 문구.
   *
   * 이 자리는 원래 손댈 수 없었다 — 시스템이 "접수 시작 전" / "접수 시작 전이에요." 를
   * 넣었고, 영문 공고에서도 그대로 한글이 떴다. 대회마다 하고 싶은 말이 다른 자리라
   * (사전 등록 안내, 다음 회차 링크) 사전 기본값을 두되 덮어쓸 수 있게 연다.
   * 비우면 언어 사전의 기본값을 쓴다.
   */
  upcomingLabel: string;
  upcomingNote: string;
  closedLabel: string;
  closedNote: string;
  /** 보조 버튼 — 켜 둔 첫 섹션으로 스크롤. 비우면 안 그린다 */
  secondaryLabel: string;
  /** 히어로 하단 가로 팩트 — 결선일·장소·정원·상금 같은 것 */
  facts: NoticeHeroFact[];
}

/**
 * 심사 기준·선발 방식은 **machstudio 안에 이미 데이터가 있다**(심사단 탭의 항목·배점,
 * 투표 설정의 대중:심사 비율). auto 면 그 값을 끌어다 그린다 — 손으로 옮겨 적게 하면
 * 배점을 바꿨을 때 공고만 옛날 숫자로 남는다.
 */
export type NoticeSource = "auto" | "manual";

/**
 * 공고에 **시스템이 만들어 넣는 문구**의 언어.
 *
 * 운영자가 직접 쓴 글은 건드리지 않는다 — 여기서 바뀌는 건 우리가 생성하는 것뿐이다:
 * 선발 방식 막대의 "관람객 투표 / 심사단 점수", 라운드 설명, 카운트다운의 일·시간·분·초,
 * 신청 버튼 기본값. LA 처럼 영어 대회를 열면 설정에서 끌어온 값만 한글로 남아
 * 페이지 하나에 두 언어가 섞인다 — 실제로 그렇게 나왔다.
 *
 * 라운드 이름·심사 항목 이름은 **DB 에 있는 운영자의 글**이라 자동 번역하지 않는다.
 * 그 자리는 해당 섹션을 manual 로 돌리고 "설정값 불러오기" 로 복사해 고쳐 쓴다.
 */
export type NoticeLanguage = "ko" | "en" | "fr" | "ja";

/**
 * 고를 수 있는 언어. **한 곳에서만 정의한다** — 사전과 선택 UI 가 각자 목록을 들면
 * 하나에만 추가했을 때 "고를 수는 있는데 안 바뀌는" 언어가 생긴다.
 *
 * 라벨은 **그 언어로** 적는다(English/Français/日本語). 프랑스어 담당자가 한국어 화면에서
 * 자기 언어를 찾을 때 "프랑스어" 보다 "Français" 가 빠르다.
 */
export const NOTICE_LANGUAGES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "ja", label: "日本語" },
] as const satisfies readonly { value: NoticeLanguage; label: string }[];

export function isNoticeLanguage(value: unknown): value is NoticeLanguage {
  return NOTICE_LANGUAGES.some((l) => l.value === value);
}

export interface NoticePageConfig {
  enabled: boolean;
  language: NoticeLanguage;
  hero: NoticeHero;
  /**
   * 색.
   *
   * **키컬러는 여기 없다** — Competition.theme.accentColor 다. 그건 공고뿐 아니라 신청 폼·
   * 투표·결과 화면이 함께 쓰는 브랜드색이라, 공고만 따로 들고 있으면 같은 대회가 화면마다
   * 다른 제품처럼 보인다. 여기 두 색은 공고 전용 **덮어쓰기**이고, 비우면 키컬러를 따른다.
   *
   * - accentAlt : 글자 강조 자리(제목 둘째 줄·섹션 라벨·강조구)
   * - button    : 신청 버튼 등 눌리는 것
   */
  colors: { lightBg: string; darkBg: string; accentAlt: string; button: string };
  sectionBg: NoticeSectionBgMap;
  /**
   * 섹션별 배경 이미지 — **선택**이다. 어울리는 섹션이 있고 아닌 섹션이 있어서
   * 전부에 까는 기본값을 두지 않는다. 켠 섹션은 글자 뒤에 스크림이 함께 깔린다(css.ts).
   */
  sectionMedia: NoticeSectionMediaMap;
  /** 섹션 렌더 순서 — 모든 키가 한 번씩 들어 있다(normalize 가 빠진 키를 기본 순서대로 채운다). */
  order: NoticeSectionKey[];
  concept: { enabled: boolean; kicker: string; headline: string; highlight: string; body: string };
  banner: { enabled: boolean; kicker: string; title: string; body: string };
  split: { enabled: boolean; kicker: string; title: string; body: string; image: NoticeSplitImage | null; imageSide: "left" | "right" };
  /** url 은 유튜브 주소. 캡션은 영상 옆(모바일은 아래)에 붙는 짧은 설명. */
  video: { enabled: boolean; kicker: string; title: string; description: string; url: string; captionLabel: string; captionTitle: string; captionBody: string };
  /** 사전등록(빌더형) 폼을 그 자리에 심는다. sourceId 는 CollectSource.id. */
  form: { enabled: boolean; kicker: string; title: string; description: string; sourceId: string };
  snapshot: { enabled: boolean; kicker: string; title: string; items: NoticeStatItem[] };
  timeline: { enabled: boolean; kicker: string; title: string; description: string; items: NoticeTimelineItem[] };
  apply: { enabled: boolean; kicker: string; title: string; description: string; items: NoticeStepItem[] };
  eligibility: { enabled: boolean; kicker: string; title: string; items: string[] };
  selection: { enabled: boolean; kicker: string; title: string; source: NoticeSource; rounds: NoticeSelectionRound[]; footnote: string };
  criteria: { enabled: boolean; kicker: string; title: string; description: string; source: NoticeSource; items: NoticeCriterionItem[] };
  prizes: { enabled: boolean; kicker: string; title: string; items: NoticePrizeItem[] };
  countdown: { enabled: boolean; kicker: string; title: string; description: string; ctaLabel: string };
  faq: { enabled: boolean; kicker: string; title: string; items: NoticeFaqItem[] };
  sponsors: { enabled: boolean; kicker: string; title: string; items: NoticeSponsorItem[] };
}

/** 랜딩과 같은 기본 색 — 두 페이지가 같은 제품으로 보여야 한다. */
export const DEFAULT_NOTICE_COLORS = { lightBg: "#f6f8ff", darkBg: "#06080d" };

/** 기본은 전부 다크. 대회 공고는 무대·경연 성격이라 어두운 쪽이 기본값으로 맞다. */
export const DEFAULT_NOTICE_SECTION_BG: NoticeSectionBgMap = {
  hero: "dark", concept: "dark", snapshot: "dark", timeline: "dark", apply: "dark",
  eligibility: "dark", selection: "dark", criteria: "dark", prizes: "dark",
  countdown: "dark", faq: "dark", sponsors: "dark",
  banner: "dark", split: "light", video: "dark", form: "light",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const hex = (v: unknown, def: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);
/** 0~100 정수. 막대 폭이라 범위를 벗어나면 화면이 깨진다. */
const pct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

export interface NormalizeNoticeOptions {
  /**
   * 어드민 편집용. 내용이 빈 행도 남긴다 —
   * 공개 렌더는 빈 행을 버리지만, 편집 중에 아직 안 쓴 행이 리마운트로 사라지면 안 된다.
   */
  keepEmptyRows?: boolean;
}

export function normalizeNoticePageConfig(config: unknown, opts?: NormalizeNoticeOptions): NoticePageConfig {
  const keep = opts?.keepEmptyRows === true;
  const c = obj(config);
  const np = obj(c.noticePage);

  const rawBg = obj(np.sectionBg);
  const bgOf = (key: NoticeBgKey): NoticeSectionBg =>
    rawBg[key] === "light" || rawBg[key] === "dark" ? (rawBg[key] as NoticeSectionBg) : DEFAULT_NOTICE_SECTION_BG[key];
  const sectionBg = { hero: bgOf("hero") } as NoticeSectionBgMap;
  for (const item of NOTICE_SECTIONS) sectionBg[item.key] = bgOf(item.key);

  /** 0~100 사이 정수. 밖으로 나가면 색 계산이 무효가 되어 규칙 전체가 통째로 날아간다. */
  const pctOf = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fallback;

  /** 0~100 사이로 자른다. object-position 백분율이라 밖으로 나가면 이미지가 화면에서 사라진다. */
  const focusOf = (v: unknown, fallback = 50): NoticeMediaFocus => {
    const o = obj(v);
    const n = (x: unknown) =>
      typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : fallback;
    return { x: n(o.x), y: n(o.y) };
  };

  const heroRaw = obj(np.hero);
  const mediaRaw = obj(heroRaw.media);
  const mediaUrl = str(mediaRaw.url).trim();
  const hero: NoticeHero = {
    media:
      mediaUrl && (mediaRaw.type === "image" || mediaRaw.type === "video")
        ? {
            type: mediaRaw.type,
            url: mediaUrl,
            focus: focusOf(mediaRaw.focus),
            mobileFocus: focusOf(mediaRaw.mobileFocus),
          }
        : null,
    brand: str(heroRaw.brand),
    titleLines: arr(heroRaw.titleLines).map(str).filter((line) => keep || line.trim()),
    subtitle: str(heroRaw.subtitle),
    /* 비워 두면 build-model 이 언어에 맞는 기본값을 넣는다. 여기서 한글로 굳히면
       영어 공고에서 버튼만 한글로 남고 되돌릴 방법이 없다. */
    ctaLabel: str(heroRaw.ctaLabel),
    upcomingLabel: str(heroRaw.upcomingLabel),
    upcomingNote: str(heroRaw.upcomingNote),
    closedLabel: str(heroRaw.closedLabel),
    closedNote: str(heroRaw.closedNote),
    secondaryLabel: str(heroRaw.secondaryLabel),
    facts: arr(heroRaw.facts)
      .map((f) => ({ label: str(obj(f).label), value: str(obj(f).value) }))
      .filter((f) => keep || f.value.trim()),
  };

  const raw = (key: NoticeSectionKey) => obj(np[key]);
  const on = (key: NoticeSectionKey) => bool(raw(key).enabled, false);

  const imageOf = (v: unknown): NoticeSplitImage | null => {
    const o = obj(v);
    const url = str(o.url).trim();
    return url ? { url, focus: focusOf(o.focus), mobileFocus: focusOf(o.mobileFocus) } : null;
  };

  /** 알려진 키만, 한 번씩. 빠진 키(새로 생긴 섹션 등)는 기본 순서의 자기 자리 근처가 아니라 끝에 붙는다. */
  const order: NoticeSectionKey[] = [];
  for (const key of arr(np.order)) {
    if (NOTICE_SECTIONS.some((x) => x.key === key) && !order.includes(key as NoticeSectionKey)) order.push(key as NoticeSectionKey);
  }
  for (const item of NOTICE_SECTIONS) if (!order.includes(item.key)) order.push(item.key);

  return {
    enabled: bool(np.enabled, false),
    language: isNoticeLanguage(np.language) ? np.language : "ko",
    hero,
    colors: {
      lightBg: hex(obj(np.colors).lightBg, DEFAULT_NOTICE_COLORS.lightBg),
      darkBg: hex(obj(np.colors).darkBg, DEFAULT_NOTICE_COLORS.darkBg),
      // 빈 문자열 = "키컬러를 따른다". 기본값을 넣어 두면 키컬러를 바꿔도 여기가 안 따라온다.
      accentAlt: hex(obj(np.colors).accentAlt, ""),
      button: hex(obj(np.colors).button, ""),
    },
    sectionBg,
    sectionMedia: (() => {
      const raw = obj(np.sectionMedia);
      const out: NoticeSectionMediaMap = {};
      for (const key of ["hero", ...NOTICE_SECTIONS.map((x) => x.key)] as NoticeBgKey[]) {
        const item = obj(raw[key]);
        const url = str(item.url).trim();
        // 주소가 없으면 아예 키를 만들지 않는다 — "켜 뒀는데 빈 배경" 같은 상태를 안 만든다.
        if (!url) continue;
        out[key] = {
          url,
          focus: focusOf(item.focus),
          mobileFocus: focusOf(item.mobileFocus),
          scrim: pctOf(item.scrim, 72),
          panel: pctOf(item.panel, 88),
        };
      }
      return out;
    })(),

    order,

    banner: {
      enabled: on("banner"),
      kicker: str(raw("banner").kicker),
      title: str(raw("banner").title),
      body: str(raw("banner").body),
    },

    split: {
      enabled: on("split"),
      kicker: str(raw("split").kicker),
      title: str(raw("split").title),
      body: str(raw("split").body),
      image: imageOf(raw("split").image),
      imageSide: raw("split").imageSide === "right" ? "right" : "left",
    },

    video: {
      enabled: on("video"),
      kicker: str(raw("video").kicker),
      title: str(raw("video").title),
      description: str(raw("video").description),
      url: str(raw("video").url).trim(),
      captionLabel: str(raw("video").captionLabel),
      captionTitle: str(raw("video").captionTitle),
      captionBody: str(raw("video").captionBody),
    },

    form: {
      enabled: on("form"),
      kicker: str(raw("form").kicker),
      title: str(raw("form").title),
      description: str(raw("form").description),
      // id 형식만 받는다 — 이 값은 외부 페이지의 속성·스크립트 주소에 들어간다.
      sourceId: /^[a-z0-9]{10,40}$/.test(str(raw("form").sourceId)) ? str(raw("form").sourceId) : "",
    },

    concept: {
      enabled: on("concept"),
      kicker: str(raw("concept").kicker),
      headline: str(raw("concept").headline),
      highlight: str(raw("concept").highlight),
      body: str(raw("concept").body),
    },

    snapshot: {
      enabled: on("snapshot"),
      kicker: str(raw("snapshot").kicker),
      title: str(raw("snapshot").title),
      items: arr(raw("snapshot").items)
        .map((i) => ({ label: str(obj(i).label), value: str(obj(i).value), note: str(obj(i).note) }))
        .filter((i) => keep || i.value.trim()),
    },

    timeline: {
      enabled: on("timeline"),
      kicker: str(raw("timeline").kicker),
      title: str(raw("timeline").title),
      description: str(raw("timeline").description),
      items: arr(raw("timeline").items)
        .map((i) => ({
          date: str(obj(i).date),
          title: str(obj(i).title),
          description: str(obj(i).description),
          emphasis: bool(obj(i).emphasis, false),
        }))
        .filter((i) => keep || i.title.trim()),
    },

    apply: {
      enabled: on("apply"),
      kicker: str(raw("apply").kicker),
      title: str(raw("apply").title),
      description: str(raw("apply").description),
      items: arr(raw("apply").items)
        .map((i) => ({
          title: str(obj(i).title),
          items: arr(obj(i).items).map(str).filter((v) => keep || v.trim()),
        }))
        .filter((i) => keep || i.title.trim()),
    },

    eligibility: {
      enabled: on("eligibility"),
      kicker: str(raw("eligibility").kicker),
      title: str(raw("eligibility").title),
      items: arr(raw("eligibility").items).map(str).filter((v) => keep || v.trim()),
    },

    selection: {
      enabled: on("selection"),
      kicker: str(raw("selection").kicker),
      title: str(raw("selection").title),
      footnote: str(raw("selection").footnote),
      source: raw("selection").source === "manual" ? "manual" : "auto",
      rounds: arr(raw("selection").rounds)
        .map((round) => ({
          title: str(obj(round).title),
          note: str(obj(round).note),
          bars: arr(obj(round).bars)
            .map((b) => ({ label: str(obj(b).label), percent: pct(obj(b).percent) }))
            .filter((b) => keep || b.label.trim()),
        }))
        .filter((round) => keep || round.title.trim()),
    },

    criteria: {
      enabled: on("criteria"),
      kicker: str(raw("criteria").kicker),
      title: str(raw("criteria").title),
      description: str(raw("criteria").description),
      source: raw("criteria").source === "manual" ? "manual" : "auto",
      items: arr(raw("criteria").items)
        .map((i) => ({ name: str(obj(i).name), description: str(obj(i).description), points: int(obj(i).points) }))
        .filter((i) => keep || i.name.trim()),
    },

    prizes: {
      enabled: on("prizes"),
      kicker: str(raw("prizes").kicker),
      title: str(raw("prizes").title),
      items: arr(raw("prizes").items)
        .map((i) => ({
          rank: str(obj(i).rank),
          title: str(obj(i).title),
          description: str(obj(i).description),
          amount: str(obj(i).amount),
        }))
        .filter((i) => keep || i.title.trim()),
    },

    countdown: {
      enabled: on("countdown"),
      kicker: str(raw("countdown").kicker),
      title: str(raw("countdown").title),
      description: str(raw("countdown").description),
      ctaLabel: str(raw("countdown").ctaLabel),
    },

    faq: {
      enabled: on("faq"),
      kicker: str(raw("faq").kicker),
      title: str(raw("faq").title),
      items: arr(raw("faq").items)
        .map((i) => ({ question: str(obj(i).question), answer: str(obj(i).answer) }))
        .filter((i) => keep || i.question.trim()),
    },

    sponsors: {
      enabled: on("sponsors"),
      kicker: str(raw("sponsors").kicker),
      title: str(raw("sponsors").title),
      items: arr(raw("sponsors").items)
        .map((i) => ({
          tier: str(obj(i).tier),
          name: str(obj(i).name),
          logoUrl: str(obj(i).logoUrl),
          url: str(obj(i).url),
        }))
        .filter((i) => keep || i.name.trim()),
    },
  };
}

/**
 * 유튜브 주소 → 임베드 정보. watch·youtu.be·shorts·embed 를 받는다. 쇼츠는 세로(9:16)로 그린다.
 * 유튜브만 받는 이유: 영상 파일을 우리 저장소에서 내보내면 방문자마다 수십 MB 가 나간다
 * (2026-10 Cached Egress 초과의 원인이 그런 영상이었다).
 */
export function parseNoticeVideo(url: string): { embedUrl: string; vertical: boolean } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  let id = "";
  let vertical = false;
  if (host === "youtu.be") id = parsed.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, kind, rest] = parsed.pathname.split("/");
    if (kind === "watch") id = parsed.searchParams.get("v") ?? "";
    else if (kind === "shorts") { id = rest ?? ""; vertical = true; }
    else if (kind === "embed" || kind === "live") id = rest ?? "";
  }
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
  return { embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1`, vertical };
}
