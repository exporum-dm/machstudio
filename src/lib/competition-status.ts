// 대회 단계 머신 — 단일 정의. 소비처: 신청 라우트, 임베드 config, 어드민 상태 바.
// 상태 문자열은 여기 값이 유일한 계약이다.
//
// 자동 판정 (모집 기간 기반):
//   recruiting: recruitOpenAt <= now <= recruitCloseAt   (접수 중)
//   upcoming:   now < recruitOpenAt                       (접수 시작 전)
//   prelim:     recruitCloseAt < now                      (접수 마감 후 기본 단계)
// phaseOverride 가 있으면 자동 판정을 덮어쓴다 — 현장에서 "지금 접수 닫아",
// "지금 투표 열어" 같은 조작이 반드시 필요하다(webinar-status 의 statusOverride 와 같은 이유).

export const COMPETITION_PHASES = [
  "upcoming",
  "recruiting",
  "prelim",
  "judging",
  "final",
  "announced",
  "closed",
] as const;

export type CompetitionPhase = (typeof COMPETITION_PHASES)[number];

/** 운영자가 수동으로 고를 수 있는 단계 — upcoming 은 자동 판정 전용(수동 선택 의미 없음). */
export const COMPETITION_PHASE_OVERRIDES = [
  "recruiting",
  "prelim",
  "judging",
  "final",
  "announced",
  "closed",
] as const;
export type CompetitionPhaseOverride = (typeof COMPETITION_PHASE_OVERRIDES)[number];

/** 상태별 라벨·배지 톤 — 목록·헤더·운영 화면이 같은 라벨을 쓴다. */
export const COMPETITION_PHASE_META: Record<CompetitionPhase, { label: string; tone: string }> = {
  upcoming: { label: "접수 대기", tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  recruiting: { label: "접수 중", tone: "bg-green-500/10 text-green-600 dark:text-green-400" },
  prelim: { label: "예선", tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  judging: { label: "심사 중", tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  final: { label: "본선", tone: "bg-red-500/10 text-red-500" },
  announced: { label: "발표 완료", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  closed: { label: "종료", tone: "bg-secondary text-muted-foreground" },
};

/**
 * 대회를 만들 때 넣어 두는 라운드 기본 이름.
 *
 * 이건 **우리가 넣은 시드**지 운영자가 쓴 글이 아니다. 그래서 공고를 영어로 두면 이 이름도
 * 따라 바뀌어야 한다 — 미국 행사 공고에 "예선/본선" 두 글자만 한글로 남는 일이 실제로 있었다.
 * 운영자가 한 번이라도 이름을 바꿨다면 그건 운영자의 글이니 그대로 둔다(비교 기준이 이 상수다).
 */
export const DEFAULT_ROUND_NAME: Record<"prelim" | "final", string> = { prelim: "예선", final: "본선" };

export function isCompetitionPhaseOverride(value: unknown): value is CompetitionPhaseOverride {
  return typeof value === "string" && (COMPETITION_PHASE_OVERRIDES as readonly string[]).includes(value);
}

/** 라운드의 투표 일정 — 단계 자동 판정과 "지금 라운드" 고르기에 쓴다. */
export interface RoundTiming {
  kind: string;
  voteEnabled: boolean;
  voteOpenAt: Date | string | null;
  voteCloseAt: Date | string | null;
}

export interface CompetitionStatusInput {
  recruitOpenAt?: Date | string | null;
  recruitCloseAt?: Date | string | null;
  phaseOverride?: string | null;
  /**
   * 라운드 일정(선택). 있으면 접수 마감 뒤의 단계를 라운드로 판정한다 — 없으면 접수가 끝난 뒤로는
   * 영원히 "예선" 이었다. 본선 투표가 열렸는데도 예선으로 보였다(2026-10-18 LA K-POP).
   */
  rounds?: RoundTiming[];
}

export interface CompetitionStatusResult {
  phase: CompetitionPhase;
  isOverridden: boolean;
  /** 지금 신청서를 받을 수 있는가 — 서버도 이 값으로 막는다(클라이언트만 막으면 API 로 들어온다). */
  canApply: boolean;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 접수 마감 뒤의 자동 단계 — 본선 투표가 시작됐으면 본선, 예선 투표가 끝났고 본선 전이면 심사 중,
 * 그 밖에는 예선. 발표·종료는 운영자가 정한다(수동 전환).
 */
function phaseFromRounds(rounds: RoundTiming[] | undefined, now: Date): CompetitionPhase {
  if (!rounds?.length) return "prelim";
  const t = now.getTime();
  const final = rounds.find((r) => r.kind === "final");
  const prelim = rounds.find((r) => r.kind === "prelim");
  const finalOpen = toDate(final?.voteOpenAt ?? null);
  if (final && finalOpen && t >= finalOpen.getTime()) return "final";
  const prelimClose = toDate(prelim?.voteCloseAt ?? null);
  if (prelimClose && t > prelimClose.getTime()) return "judging";
  return "prelim";
}

/**
 * 라운드를 안 정한 투표 화면(설치 코드에 ?round= 없음)이 보여 줄 라운드 —
 * 지금 열린 라운드 → 곧 열릴 라운드(켜져 있는 것 중 가장 이른) → 가장 최근에 닫힌 라운드 → 예선.
 * 설치 코드 하나로 예선부터 본선까지 쓸 수 있게(예전엔 늘 예선이라, 본선 때 코드를 바꿔 붙여야 했다).
 */
export function currentRoundKind(rounds: RoundTiming[], now: Date = new Date()): "prelim" | "final" {
  const t = now.getTime();
  const norm = (k: string): "prelim" | "final" => (k === "final" ? "final" : "prelim");
  const open = rounds.filter((r) => {
    if (!r.voteEnabled) return false;
    const o = toDate(r.voteOpenAt);
    const c = toDate(r.voteCloseAt);
    return (!o || t >= o.getTime()) && (!c || t <= c.getTime());
  });
  if (open.length) return norm(open.some((r) => r.kind === "final") ? "final" : open[0].kind);
  const upcoming = rounds
    .filter((r) => r.voteEnabled && toDate(r.voteOpenAt) && toDate(r.voteOpenAt)!.getTime() > t)
    .sort((a, b) => toDate(a.voteOpenAt)!.getTime() - toDate(b.voteOpenAt)!.getTime());
  if (upcoming.length) return norm(upcoming[0].kind);
  const closed = rounds
    .filter((r) => toDate(r.voteCloseAt) && toDate(r.voteCloseAt)!.getTime() < t)
    .sort((a, b) => toDate(b.voteCloseAt)!.getTime() - toDate(a.voteCloseAt)!.getTime());
  if (closed.length) return norm(closed[0].kind);
  return "prelim";
}

export function resolveCompetitionStatus(
  input: CompetitionStatusInput,
  now: Date = new Date(),
): CompetitionStatusResult {
  const openAt = toDate(input.recruitOpenAt);
  const closeAt = toDate(input.recruitCloseAt);
  const t = now.getTime();

  let auto: CompetitionPhase;
  if (openAt && t < openAt.getTime()) auto = "upcoming";
  else if (closeAt && t > closeAt.getTime()) auto = phaseFromRounds(input.rounds, now);
  else if (openAt || closeAt) auto = "recruiting";
  // 기간을 아무것도 안 정했으면 아직 준비 중으로 본다 — 빈 값이 곧 "모두에게 열림"이 되면 안 된다.
  else auto = "upcoming";

  const isOverridden = isCompetitionPhaseOverride(input.phaseOverride);
  const phase = isOverridden ? (input.phaseOverride as CompetitionPhase) : auto;

  return { phase, isOverridden, canApply: phase === "recruiting" };
}
