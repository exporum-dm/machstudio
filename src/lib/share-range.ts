/**
 * 공유 링크의 **집계 기간** — 저장 형태·해석·표시를 한곳에 모았다.
 *
 * 왜 한 모듈인가: 기간은 세 곳에서 쓰인다(운영자 모달이 고르고, 공개 데이터 라우트가
 * 조회 범위로 바꾸고, 공개 화면이 글자로 보여 준다). 계산이 갈라지면 "공유 화면 숫자가
 * 대시보드와 다르다" 는 신고가 들어오고, 그 원인을 찾기가 아주 어렵다.
 *
 * ── 두 가지 기간 ──────────────────────────────────────────────────
 * · **구르는 기간**(`30d`) — "최근 30일". 날이 지나면 창도 같이 움직인다. 진행 중인
 *   캠페인을 계속 보여 주는 링크에 맞다(지금까지의 고정 동작도 이것이다).
 * · **고정 기간**(`2026-10-01~2026-10-31`) — 끝난 캠페인의 보고용. 나중에 열어도 같은 숫자다.
 *
 * 기간은 **서버가 들고 있다**. 공개 화면이 보낸 값을 쓰면 링크를 받은 사람이 주소만 고쳐
 * 운영자가 열어 주지 않은 구간까지 들여다볼 수 있다.
 */
import { kstDateString } from "@/lib/datetime";

export type ShareRange =
  | { kind: "rolling"; days: number }
  /** KST 달력일 `YYYY-MM-DD`. 시각이 아니라 날짜로 둔다 — 보고서의 단위가 날이다. */
  | { kind: "fixed"; from: string; to: string };

/** 저장된 값이 없을 때. 이 기능이 생기기 전의 동작과 같아서 기존 링크는 그대로 돈다. */
export const DEFAULT_SHARE_RANGE: ShareRange = { kind: "rolling", days: 30 };

/** 구르는 기간의 상한 — 3년. 그 이상은 고정 기간으로 적는 게 맞다. */
export const MAX_ROLLING_DAYS = 1095;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 저장 문자열 → 기간. 못 읽는 값은 **기본값으로 떨어진다** — 공유 화면이 비는 쪽보다
 * 30일을 보여 주는 쪽이 낫다(기간 하나 때문에 보고서 전체가 안 열릴 이유가 없다).
 */
export function parseShareRange(raw: unknown): ShareRange {
  if (typeof raw !== "string" || !raw) return DEFAULT_SHARE_RANGE;

  const rolling = /^(\d+)d$/.exec(raw.trim());
  if (rolling) {
    const days = Number(rolling[1]);
    if (days >= 1 && days <= MAX_ROLLING_DAYS) return { kind: "rolling", days };
    return DEFAULT_SHARE_RANGE;
  }

  // 정확히 두 조각이어야 한다 — 앞 둘만 집으면 "a~b~c" 가 조용히 통과한다.
  const parts = raw.split("~").map((s) => s.trim());
  if (parts.length === 2) {
    const [from, to] = parts;
    if (DATE_RE.test(from) && DATE_RE.test(to) && from <= to) {
      return { kind: "fixed", from, to };
    }
  }
  return DEFAULT_SHARE_RANGE;
}

/** 기간 → 저장 문자열. `parseShareRange` 와 왕복해야 한다. */
export function formatShareRange(range: ShareRange): string {
  return range.kind === "rolling" ? `${range.days}d` : `${range.from}~${range.to}`;
}

/**
 * 기간 → 조회 창.
 *
 * 경계는 **대시보드의 날짜 선택기와 똑같이** 잡는다(`DateRangePicker` 의 프리셋:
 * 오늘 KST 00:00 을 기준으로 `-N일` ~ 오늘 끝). 운영자는 공유 화면을 자기 대시보드와
 * 나란히 보고 비교한다 — 여기서 하루라도 다르게 잡으면 숫자가 어긋나 보인다.
 */
export function shareRangeWindow(range: ShareRange, now: Date = new Date()): {
  from: Date;
  to: Date;
  /** 화면에 찍을 KST 달력일 — 운영자·방문자가 보는 "언제부터 언제까지". */
  fromDate: string;
  toDate: string;
} {
  if (range.kind === "fixed") {
    const from = new Date(`${range.from}T00:00:00+09:00`);
    const to = new Date(`${range.to}T23:59:59.999+09:00`);
    return { from, to, fromDate: range.from, toDate: range.to };
  }

  const today = new Date(`${kstDateString(now)}T00:00:00+09:00`);
  const to = new Date(today.getTime() + 86_400_000 - 1);
  const from = new Date(today.getTime() - range.days * 86_400_000);
  return { from, to, fromDate: kstDateString(from), toDate: kstDateString(to) };
}

/** 선택기·요약에 쓰는 짧은 이름. */
export function shareRangeLabel(range: ShareRange): string {
  return range.kind === "rolling" ? `최근 ${range.days}일` : `${range.from} ~ ${range.to}`;
}

/**
 * 날짜 선택기의 결과 → 저장할 기간.
 *
 * 선택기는 절대 날짜만 돌려주므로(`{ from, to, label }`), "최근 30일" 을 고른 건지
 * 그 날짜 구간을 고른 건지는 **라벨로만** 구별된다. 라벨이 프리셋 모양이면 구르는 기간으로,
 * 아니면 고정 기간으로 저장한다 — 라벨 문구가 바뀌면 고정 기간으로 떨어질 뿐이라
 * 틀린 구간을 보여 주는 쪽으로는 깨지지 않는다.
 */
export function shareRangeFromPicker(picked: { from: Date; to: Date; label: string }): ShareRange {
  const rolling = /^최근 (\d+)일$/.exec(picked.label.trim());
  if (rolling) {
    const days = Number(rolling[1]);
    if (days >= 1 && days <= MAX_ROLLING_DAYS) return { kind: "rolling", days };
  }
  return { kind: "fixed", from: kstDateString(picked.from), to: kstDateString(picked.to) };
}

/** 창의 길이(일) — 공개 payload 의 `rangeDays` 호환용. */
export function shareRangeDays(range: ShareRange, now: Date = new Date()): number {
  if (range.kind === "rolling") return range.days;
  const win = shareRangeWindow(range, now);
  return Math.max(1, Math.round((win.to.getTime() - win.from.getTime()) / 86_400_000));
}
