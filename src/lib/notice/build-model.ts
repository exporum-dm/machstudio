/**
 * 공고 렌더 모델 — 조건 판단과 폴백을 여기서 전부 끝낸다.
 *
 * 뷰에 분기가 흩어지면 "미리보기에서는 보였는데 실물에서는 안 보인다"가 반드시 생긴다.
 * 섹션 노출(이중 게이트), auto/manual 해소, CTA 상태 문구가 전부 이 파일의 일이다.
 */
import { onAccentColor } from "@/lib/competition-render";
import { DEFAULT_ROUND_NAME } from "@/lib/competition-status";
import { parseNoticeVideo, type NoticeCriterionItem, type NoticePageConfig, type NoticeSectionKey, type NoticeSelectionRound } from "./config";
import { noticeStrings, type NoticeStrings } from "./strings";
import type { NoticeCompetition, NoticeModel, NoticeRound, NoticeTocItem } from "./types";

export interface BuildNoticeModelOptions {
  uid: string;
  embedded: boolean;
  isPreview: boolean;
}

/**
 * 공고에 나갈 라운드 이름.
 *
 * 대회를 만들 때 우리가 "예선"/"본선" 을 넣어 둔다. 그 상태 그대로면 **우리 글**이므로
 * 공고 언어를 따라간다 — 안 그러면 영문 공고에 그 두 글자만 한글로 남는다(실제로 그랬고,
 * 운영자 눈에는 하드코딩으로 보인다). 운영자가 한 번이라도 이름을 바꿨다면 그건 운영자의
 * 글이니 손대지 않는다.
 */
export function roundDisplayName(round: { kind: string; name: string }, t: NoticeStrings): string {
  const untouched = round.name === DEFAULT_ROUND_NAME[round.kind === "final" ? "final" : "prelim"];
  if (!untouched) return round.name;
  return round.kind === "final" ? t.roundNameFinal : t.roundNamePrelim;
}

/**
 * 라운드에서 선발 방식 막대를 만든다 — 대중:심사 비율이 곧 막대다.
 * 라벨과 설명은 사전에서 온다(영어 대회 대응).
 */
function selectionFromRounds(rounds: NoticeRound[], t: NoticeStrings): NoticeSelectionRound[] {
  return rounds
    .filter((round) => round.publicWeight > 0 || round.judgeWeight > 0)
    .map((round) => ({
      title: roundDisplayName(round, t),
      note: round.kind === "prelim" ? t.roundNotePrelim : t.roundNoteFinal,
      bars: [
        { label: t.barPublic, percent: round.publicWeight },
        { label: t.barJudge, percent: round.judgeWeight },
      ].filter((bar) => bar.percent > 0),
    }));
}

/**
 * 심사 기준은 **본선 우선**이다. 관객이 공고에서 궁금한 건 "무대에서 뭘 보나"이고,
 * 예선 항목(서류·영상 심사)은 본선과 다른 경우가 많다. 본선이 비어 있으면 예선으로 떨어진다.
 */
function criteriaFromRounds(rounds: NoticeRound[]): NoticeCriterionItem[] {
  const final = rounds.find((r) => r.kind === "final" && r.criteria.length > 0);
  if (final) return final.criteria;
  const prelim = rounds.find((r) => r.criteria.length > 0);
  return prelim ? prelim.criteria : [];
}

export function buildNoticeModel(
  competition: NoticeCompetition,
  np: NoticePageConfig,
  opts: BuildNoticeModelOptions,
): NoticeModel {
  const { uid, embedded, isPreview } = opts;
  const sectionId = (base: string) => `${base}-${uid}`;

  const accent = competition.theme?.accentColor || "#6d28d9";
  const t = noticeStrings(np.language);

  // auto 면 machstudio 안의 값을, manual 이면 공고에 적은 값을 쓴다.
  const selectionRounds =
    np.selection.source === "manual" ? np.selection.rounds : selectionFromRounds(competition.rounds, t);
  const criteriaItems =
    np.criteria.source === "manual" ? np.criteria.items : criteriaFromRounds(competition.rounds);
  const criteriaTotal = criteriaItems.reduce((sum, item) => sum + item.points, 0);

  // 카운트다운은 접수 마감이 있어야 의미가 있다. 지난 시각이면 켜 둬도 안 그린다.
  const closeAt = competition.recruitCloseAt ? new Date(competition.recruitCloseAt) : null;
  const deadlineValid = !!closeAt && !Number.isNaN(closeAt.getTime()) && closeAt.getTime() > Date.now();
  const deadline = deadlineValid ? competition.recruitCloseAt : null;

  /** 토글 ON + 실제 데이터 있음. 빈 껍데기를 방문자에게 보여주지 않는다. */
  const hasContent: Record<NoticeSectionKey, boolean> = {
    concept: !!(np.concept.headline.trim() || np.concept.body.trim()),
    // 배너는 문구 없이 사진만 깔아도 의미가 있다(사진 자체가 내용).
    banner: !!(np.banner.title.trim() || np.sectionMedia.banner),
    split: !!np.split.image && !!(np.split.title.trim() || np.split.body.trim()),
    video: parseNoticeVideo(np.video.url) !== null,
    // 폼은 machstudio 주소를 알아야 스크립트를 부른다 — 상세페이지 로더만 넘겨준다(대회 공고엔 없음).
    // 미리보기는 실제 폼 대신 자리표시를 그리므로 주소 없이도 보인다.
    form: !!np.form.sourceId && (isPreview || !!competition.formOrigin),
    snapshot: np.snapshot.items.length > 0,
    timeline: np.timeline.items.length > 0,
    apply: np.apply.items.length > 0,
    eligibility: np.eligibility.items.length > 0,
    selection: selectionRounds.length > 0,
    criteria: criteriaItems.length > 0,
    prizes: np.prizes.items.length > 0,
    countdown: deadline !== null,
    faq: np.faq.items.length > 0,
    sponsors: np.sponsors.items.length > 0,
  };

  const show = {} as Record<NoticeSectionKey, boolean>;
  for (const key of np.order) {
    show[key] = np[key].enabled && hasContent[key];
  }

  // 목차도 운영자가 정한 순서를 따른다 — 화면 순서와 다르면 목차가 엉뚱한 데로 데려간다.
  const tocItems: NoticeTocItem[] = np.order.filter((key) => show[key]).map((key) => {
    const cfg = np[key] as { title?: string };
    return { id: `nt-${key}`, label: (cfg.title || "").trim() || t.sectionLabel[key] };
  });

  /*
   * 접수 중이 아니면 버튼을 잠그고 이유를 적는다. 눌리지 않는 버튼만 두면 계속 누른다.
   *
   * 우선순위: 공고에 적은 문구 → 언어 사전 기본값.
   * 대회 설정의 statusMessages 는 **폴백으로만** 쓴다 — 그건 신청 폼·임베드가 함께 쓰는
   * 값이라 공고 문구를 바꾸려고 건드리면 다른 화면까지 따라 바뀐다.
   */
  const ctaEnabled = competition.canApply;
  const upcoming = competition.phase === "upcoming";
  const ctaLabel = ctaEnabled
    ? np.hero.ctaLabel.trim() || t.ctaApply
    : upcoming
      ? np.hero.upcomingLabel.trim() || t.ctaUpcoming
      : np.hero.closedLabel.trim() || t.ctaClosed;
  const ctaNote = ctaEnabled
    ? ""
    : upcoming
      ? np.hero.upcomingNote.trim() || (np.language === "ko" ? competition.statusMessages.upcoming : "")
      : np.hero.closedNote.trim() || (np.language === "ko" ? competition.statusMessages.closed : "");

  return {
    competition,
    np,
    t,
    uid,
    accent,
    onPrimary: onAccentColor(accent),
    brand: np.hero.brand.trim() || competition.name,
    titleLines: np.hero.titleLines.filter((line) => line.trim()).length
      ? np.hero.titleLines
      : [competition.name],
    subtitle: np.hero.subtitle.trim() || (competition.description ?? "").split("\n")[0] || "",
    ctaLabel,
    ctaEnabled,
    ctaNote,
    formOrigin: competition.formOrigin ?? null,
    ctaVisible: competition.cta !== null,
    ctaLink: competition.cta ?? null,
    tocItems,
    show,
    selectionRounds,
    criteriaItems,
    criteriaTotal,
    deadline,
    embedded,
    isPreview,
    sectionId,
  };
}
