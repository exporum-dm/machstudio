// 웨비나 상태 머신 — 단일 정의.
// 소비처: register/ping 라우트, (Phase 2) 공개 config 엔드포인트·로더, (Phase 3) 어드민 상태 바.
// 상태 문자열은 여기 값이 유일한 계약이다: upcoming / registration / live / ended
//
// 자동 판정 (일정 기반):
//   ended:        now >= liveEndAt
//   live:         liveStartAt <= now < liveEndAt
//   registration: now <= signupDeadline (그리고 시작 전)
//   upcoming:     signupDeadline < now < liveStartAt (등록 마감, 시작 대기)
// statusOverride("registration"|"live"|"ended")가 있으면 자동 판정을 덮어쓴다.

export type WebinarStatus = "upcoming" | "registration" | "live" | "ended";

export const WEBINAR_STATUS_OVERRIDES = ["registration", "live", "ended"] as const;
export type WebinarStatusOverride = (typeof WEBINAR_STATUS_OVERRIDES)[number];

// 상태별 표시 라벨·톤(배지 클래스) — 단일 정의. 허브 헤더·목록·운영 콘솔이 동일 라벨을 쓴다.
export const WEBINAR_STATUS_META: Record<WebinarStatus, { label: string; tone: string }> = {
  upcoming: { label: "시작 대기", tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  registration: { label: "등록 중", tone: "bg-green-500/10 text-green-600 dark:text-green-400" },
  live: { label: "LIVE", tone: "bg-red-500/10 text-red-500" },
  ended: { label: "종료", tone: "bg-secondary text-muted-foreground" },
};

// 입장 오픈: 시작 N분 전부터 CTA가 "입장하기"로 전환 (레거시 STK watch 모드 — 13:00 오픈/14:00 시작)
export const DEFAULT_ENTRY_OPEN_BEFORE_MINUTES = 60;

/**
 * "지금 보고 있는 사람" 판정 창 — lastPingAt 이 이 시간 안이면 시청 중으로 센다.
 * ping 라우트의 SEGMENT_GAP_MS 와 같은 값이어야 한다(같은 핑 주기를 두 쪽에서 해석하므로).
 * 대시보드가 이 숫자를 리터럴로 들고 있었는데, 같은 값을 쓰는 곳이 늘면 조용히 갈라진다.
 */
export const ACTIVE_VIEWER_WINDOW_MS = 90_000;

export interface WebinarStatusInput {
  liveStartAt: Date | string;
  liveEndAt: Date | string;
  signupDeadline: Date | string;
  statusOverride?: string | null;
  components?: unknown;
}

export interface WebinarStatusResult {
  status: WebinarStatus;
  isOverridden: boolean;
  /** 입장 오픈 시각 = liveStartAt − entryOpenBeforeMinutes */
  entryOpenAt: Date;
  /** 지금 라이브 입장이 가능한가 (종료 전 + 오픈 시각 경과) */
  entryOpen: boolean;
  /** 지금 등록을 받는가 — live 중에는 components.allowLiveRegistration 을 따른다 */
  canRegister: boolean;
}

export function isWebinarStatusOverride(value: unknown): value is WebinarStatusOverride {
  return typeof value === "string" && (WEBINAR_STATUS_OVERRIDES as readonly string[]).includes(value);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function componentsObject(components: unknown): Record<string, unknown> {
  if (components && typeof components === "object" && !Array.isArray(components)) {
    return components as Record<string, unknown>;
  }
  return {};
}

export function getEntryOpenBeforeMinutes(components: unknown): number {
  const raw = componentsObject(components).entryOpenBeforeMinutes;
  const minutes = Number(raw);
  if (Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60) return Math.floor(minutes);
  return DEFAULT_ENTRY_OPEN_BEFORE_MINUTES;
}

/**
 * **부착물이 지금 보여 주는 모습** — 상태(status)보다 한 겹 아래다.
 *
 * 배너·히어로는 `status` 만으로 갈리지 않는다: 'registration' 이어도 입장 오픈 시각이
 * 지났으면 입장 버튼을 보여 주고, 마감 뒤 시작 전에는 캘린더만 남는다. 운영자에게
 * "언제 뭐가 바뀌나" 를 알려 주려면 이 네 가지로 말해야 한다.
 */
export type WebinarFace = "registration" | "upcoming" | "entryOpen" | "ended";

export function webinarFace(webinar: WebinarStatusInput, now: Date = new Date()): WebinarFace {
  const r = resolveWebinarStatus(webinar, now);
  if (r.status === "ended") return "ended";
  if (r.entryOpen) return "entryOpen";
  if (r.canRegister) return "registration";
  return "upcoming";
}

export interface WebinarTransition {
  at: Date;
  to: WebinarFace;
}

/**
 * 다음 전환 시각과 그때의 모습.
 *
 * 후보 시각을 늘어놓고 고르는 게 아니라, **각 후보 시각의 모습을 실제로 계산해** 지금과
 * 다른 첫 번째를 고른다. 순서만 보고 고르면 틀린다 — 등록 마감이 입장 오픈보다 뒤인
 * 웨비나에서는 마감을 지나도 화면이 그대로인데 "곧 바뀝니다" 라고 알리게 된다.
 *
 * 수동 전환 중이면 **null** 이다. 그때는 일정이 화면을 움직이지 않으므로, 예정 시각을
 * 알려 주면 오히려 거짓말이 된다(운영자가 직접 되돌려야 일정으로 복귀한다).
 */
export function nextWebinarTransition(
  webinar: WebinarStatusInput,
  now: Date = new Date(),
): WebinarTransition | null {
  if (isWebinarStatusOverride(webinar.statusOverride)) return null;

  const liveStartAt = toDate(webinar.liveStartAt);
  const entryOpenAt = new Date(
    liveStartAt.getTime() - getEntryOpenBeforeMinutes(webinar.components) * 60_000,
  );
  const here = webinarFace(webinar, now);

  return (
    [toDate(webinar.signupDeadline), entryOpenAt, liveStartAt, toDate(webinar.liveEndAt)]
      .filter((at) => at.getTime() > now.getTime())
      .sort((a, b) => a.getTime() - b.getTime())
      // 경계는 `>=` 로 판정되지만 마감은 `<=` 라 그 순간엔 아직 안 바뀐다 — 1ms 뒤를 본다.
      .map((at) => ({ at, to: webinarFace(webinar, new Date(at.getTime() + 1)) }))
      .find((t) => t.to !== here) ?? null
  );
}

export function resolveWebinarStatus(webinar: WebinarStatusInput, now: Date = new Date()): WebinarStatusResult {
  const liveStartAt = toDate(webinar.liveStartAt);
  const liveEndAt = toDate(webinar.liveEndAt);
  const signupDeadline = toDate(webinar.signupDeadline);
  const t = now.getTime();

  let auto: WebinarStatus;
  if (t >= liveEndAt.getTime()) auto = "ended";
  else if (t >= liveStartAt.getTime()) auto = "live";
  else if (t <= signupDeadline.getTime()) auto = "registration";
  else auto = "upcoming";

  const isOverridden = isWebinarStatusOverride(webinar.statusOverride);
  const status = isOverridden ? (webinar.statusOverride as WebinarStatusOverride) : auto;

  const entryOpenAt = new Date(liveStartAt.getTime() - getEntryOpenBeforeMinutes(webinar.components) * 60_000);
  // 수동 override 가 있으면 시간 기반 입장오픈을 적용하지 않는다 — 운영자가 'registration'으로 되돌리면
  // (예: 종료 후 재개·테스트 후 복귀) 시각이 이미 지났어도 등록 화면을 유지해야 한다. override='live'는 첫 절로 열림.
  const entryOpen = status === "live" || (!isOverridden && status !== "ended" && t >= entryOpenAt.getTime());

  // live 중 등록: allowLiveRegistration 이 명시돼 있으면 그 값, 없으면 기존 동작 보존
  // (기존 register 라우트는 signupDeadline 만 비교 — 마감 전이면 라이브 중에도 허용이었다)
  const componentsRaw = componentsObject(webinar.components);
  const allowLive =
    typeof componentsRaw.allowLiveRegistration === "boolean"
      ? componentsRaw.allowLiveRegistration
      : t <= signupDeadline.getTime();
  const canRegister = status === "registration" || (status === "live" && allowLive);

  return { status, isOverridden, entryOpenAt, entryOpen, canRegister };
}
