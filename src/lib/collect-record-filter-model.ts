/**
 * 등록자 DB 열 필터의 **모양과 검증** — 화면(필터 팝오버)과 서버(SQL)가 같이 쓴다.
 * DB 를 모르는 파일이다 — 화면 번들에 Prisma 가 딸려 들어가지 않게 SQL 은 collect-record-filters.ts 에 둔다.
 */
export type ColumnFilterKey = `field:${string}` | "utmSource" | "utmMedium" | "registrationNo" | "checkin";

export interface ColumnFilter {
  c: ColumnFilterKey;
  /** 이 글자를 포함(대소문자 무시) */
  contains?: string;
  /** 이 값들 중 하나 — 여러 값을 담는 항목(체크박스 묶음)은 하나라도 겹치면 */
  values?: string[];
  /** 비어 있음만 / 비어 있지 않음만 */
  empty?: "empty" | "notEmpty";
}

const FIXED = new Set(["utmSource", "utmMedium", "registrationNo", "checkin"]);
const MAX_FILTERS = 30;
const MAX_VALUES = 200;
const MAX_TEXT = 200;

/** 현장 체크인 열의 값 — 화면에 보이는 그대로 받는다. */
export const CHECKIN_VALUES = { in: "입장", out: "미입장" } as const;
/** 값 목록에서 "비어 있는 값" 을 고를 때 쓰는 자리표시. */
export const EMPTY_VALUE = "__empty__";

function isKey(value: unknown): value is ColumnFilterKey {
  if (typeof value !== "string") return false;
  if (FIXED.has(value)) return true;
  return value.startsWith("field:") && value.length > 6 && value.length <= 106;
}

const text = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_TEXT) : "");

/** 쿼리스트링 cf(JSON) → 검증된 필터. 틀린 항목은 버린다 — 이상한 값 하나로 목록 전체가 깨지지 않게. */
export function parseColumnFilters(raw: string | null | undefined): ColumnFilter[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ColumnFilter[] = [];
  for (const item of parsed.slice(0, MAX_FILTERS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (!isKey(o.c)) continue;
    const filter: ColumnFilter = { c: o.c };
    const contains = text(o.contains).trim();
    if (contains) filter.contains = contains;
    if (Array.isArray(o.values)) {
      const values = [...new Set(o.values.map(text).filter((v) => v !== ""))].slice(0, MAX_VALUES);
      if (values.length) filter.values = values;
    }
    if (o.empty === "empty" || o.empty === "notEmpty") filter.empty = o.empty;
    if (filter.contains || filter.values || filter.empty) out.push(filter);
  }
  return out;
}

/** 필터가 하나라도 걸려 있는가(화면의 "필터 해제"·배지용). */
export function isColumnFilterActive(filter: ColumnFilter | undefined): boolean {
  return !!filter && !!(filter.contains || filter.values?.length || filter.empty);
}
