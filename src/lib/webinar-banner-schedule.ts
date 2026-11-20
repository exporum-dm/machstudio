export const BANNER_TRANSITIONS = [
  { phase: "registration", label: "시작 전 → 사전등록 중" },
  { phase: "live", label: "사전등록 중 → 라이브·입장 중" },
  { phase: "ended", label: "라이브·입장 중 → 종료 후" },
] as const;

type BannerTransitionPhase = (typeof BANNER_TRANSITIONS)[number]["phase"];
export type BannerSchedule = Record<BannerTransitionPhase, string>;

export function parseBannerSchedule(value: unknown): BannerSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { registration, live, ended } = value as Partial<BannerSchedule>;
  if (typeof registration !== "string" || typeof live !== "string" || typeof ended !== "string") return null;
  const times = [registration, live, ended].map((iso) => {
    const time = Date.parse(iso);
    return Number.isFinite(time) && new Date(time).toISOString() === iso ? time : NaN;
  });
  return times[0] < times[1] && times[1] < times[2] ? { registration, live, ended } : null;
}

export function bannerPhaseAt(schedule: BannerSchedule, now: number): BannerTransitionPhase | "upcoming" {
  if (now >= Date.parse(schedule.ended)) return "ended";
  if (now >= Date.parse(schedule.live)) return "live";
  return now >= Date.parse(schedule.registration) ? "registration" : "upcoming";
}

export function nextBannerTransition(schedule: BannerSchedule, now: number) {
  return BANNER_TRANSITIONS
    .map(({ phase }) => ({ phase, at: new Date(schedule[phase]) }))
    .find(({ at }) => at.getTime() > now) ?? null;
}
