/**
 * 브리프 — 순수 로직(카테고리·카톡 텍스트·URL 정규화·날짜).
 *
 * DB·네트워크를 안 만지는 것만 여기 둔다. 카톡 텍스트는 **운영자가 매주 복사해 붙이는 결과물**이라
 * 형식이 한 글자만 어긋나도 티가 난다 — 테스트가 이 파일을 직접 찌른다.
 *
 * 형식은 오픈채팅에 실제로 나간 The Action 게시물을 그대로 재현한 것이다(2026 년 6~9월 발행분).
 */

export const BRIEF_CATEGORIES = [
  { key: "support", emoji: "💵", label: "지원사업", hint: "마감일" },
  { key: "event", emoji: "📚", label: "웨비나 & 리포트", hint: "행사일" },
  { key: "news", emoji: "🌍", label: "산업 뉴스 & 이슈", hint: "" },
] as const;

export type BriefCategory = (typeof BRIEF_CATEGORIES)[number]["key"];

export function isBriefCategory(value: unknown): value is BriefCategory {
  return BRIEF_CATEGORIES.some((c) => c.key === value);
}


export function categoryMeta(key: BriefCategory) {
  return BRIEF_CATEGORIES.find((c) => c.key === key)!;
}

export interface BriefItemLike {
  category: string;
  org: string;
  title: string;
  url: string;
  dueDate: Date | string | null;
  dateLabel: string;
  /** 단축 주소. 없으면 원문 url 을 쓴다 */
  shortUrl?: string | null;
}

const KST_MS = 9 * 60 * 60 * 1000;

/** KST 달력 기준 M/D. 서버가 UTC 로 돌아도 운영자가 본 날짜와 같아야 한다. */
export function formatMonthDay(date: Date | string): string {
  const d = new Date(new Date(date).getTime() + KST_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * 카톡에 붙는 날짜 괄호.
 *   지원사업 → `(-9/16)` 마감 / 행사 → ` (9/8)` 일자 / 뉴스 → 없음
 * 운영자가 적은 자유 표기(예산소진시까지)가 있으면 그게 이긴다.
 *
 * 공백까지 원본 게시물을 따른다: 지원사업은 제목에 **붙이고**, 행사는 **한 칸 띄운다**.
 */
export function dateSuffix(item: Pick<BriefItemLike, "category" | "dueDate" | "dateLabel">): string {
  const label = item.dateLabel.trim();
  if (item.category === "support") {
    if (label) return ` (${label})`;
    return item.dueDate ? `(-${formatMonthDay(item.dueDate)})` : "";
  }
  if (item.category === "event") {
    if (label) return ` (${label})`;
    return item.dueDate ? ` (${formatMonthDay(item.dueDate)})` : "";
  }
  return "";
}

export interface KakaoTextOptions {
  name: string;
  intro: string;
  /** 끝에 붙일 공개 페이지 주소. 비우면 안 붙는다 */
  publicUrl?: string | null;
}

/**
 * The Action 카톡 텍스트.
 *
 * 카테고리 순서는 고정이다(지원사업 → 웨비나 → 뉴스) — 받는 쪽이 매번 같은 자리에서 찾는다.
 * 비어 있는 카테고리는 머리줄까지 통째로 뺀다. "💵 지원사업" 아래 아무것도 없으면 빠뜨린 것처럼 보인다.
 */
export function buildKakaoText(items: BriefItemLike[], opts: KakaoTextOptions): string {
  const lines: string[] = [`📢 [${opts.name}]`];
  if (opts.intro.trim()) lines.push(opts.intro.trim());

  for (const cat of BRIEF_CATEGORIES) {
    const group = items.filter((i) => i.category === cat.key);
    if (group.length === 0) continue;
    // 카테고리 머리줄 앞, 공고와 공고 사이에 빈 줄 — 카톡에서 붙어 있으면 어디서 끊기는지 안 보인다.
    lines.push("");
    lines.push(`${cat.emoji} ${cat.label}`);
    group.forEach((item, n) => {
      if (n > 0) lines.push("");
      if (cat.key !== "news" && item.org.trim()) lines.push(`[${item.org.trim()}]`);
      lines.push(`${item.title.trim()}${dateSuffix(item)}`);
      lines.push(item.shortUrl || item.url);
    });
  }

  if (opts.publicUrl) {
    lines.push("");
    lines.push(`👉 한눈에 보기: ${opts.publicUrl}`);
  }
  return lines.join("\n");
}

/**
 * 중복 판정용 URL 키.
 *
 * 같은 공고가 기업마당·지자체·뉴스에서 조금씩 다른 주소로 들어온다. 추적 파라미터(utm_*, fbclid…)와
 * 끝의 `/`, `www.`, 대소문자(호스트만)를 걷어 내고 비교한다. **경로·다른 쿼리는 그대로 둔다** —
 * 공고 번호가 쿼리에 들어 있는 사이트가 많아서(?pblancId=…) 그것까지 지우면 다른 공고가 합쳐진다.
 */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|igshid$|ref$|ref_src$|mc_|_ga$|spm$)/i;

export function urlKey(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const kept = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);
  let out = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}

/** http(s) 만 받는다 — javascript:, data: 같은 것이 공개 페이지 링크로 나가면 안 된다. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 오늘(KST) 기준 남은 날. 오늘 마감이면 0, 지났으면 음수. */
export function daysUntil(due: Date | string, now = new Date()): number {
  const dayOf = (d: Date) => Math.floor((d.getTime() + KST_MS) / 86_400_000);
  return dayOf(new Date(due)) - dayOf(now);
}

/**
 * 공개 페이지에 계속 보일 것인가.
 *
 * 지원사업·행사는 날짜가 지나면 내린다 — 마감된 공고가 남아 있으면 신뢰가 깎인다.
 * 뉴스는 날짜가 없으니 **추가된 지 30일**이 지나면 내린다. 안 내리면 한 해 뒤 페이지가 뉴스 더미가 된다.
 */
export const NEWS_TTL_DAYS = 30;

export function isStillVisible(
  item: { category: string; dueDate: Date | string | null; createdAt: Date | string },
  now = new Date(),
): boolean {
  if (item.category === "news") return -daysUntil(item.createdAt, now) <= NEWS_TTL_DAYS;
  if (!item.dueDate) return true;
  return daysUntil(item.dueDate, now) >= 0;
}

/** 자동 수집 후보가 고르기 목록에 남는 기간 — 뉴스는 짧게, 날짜 없는 공고는 한 달. */
export const CANDIDATE_NEWS_DAYS = 14;
export const CANDIDATE_UNDATED_DAYS = 30;

/**
 * 채택 안 한 자동 수집 후보를 고르기 목록에 계속 보여 줄지.
 * 매일 수십 건씩 들어오므로 지난 것은 스스로 사라져야 목록이 쓸 만하다(행은 중복 판정용으로 남는다).
 */
export function isFreshCandidate(
  item: { category: string; dueDate: Date | string | null; createdAt: Date | string; publishedAt?: Date | string | null },
  now = new Date(),
): boolean {
  const age = -daysUntil(item.publishedAt ?? item.createdAt, now);
  if (item.category === "news") return age <= CANDIDATE_NEWS_DAYS;
  if (item.dueDate) return daysUntil(item.dueDate, now) >= 0;
  return -daysUntil(item.createdAt, now) <= CANDIDATE_UNDATED_DAYS;
}

/** 공개 주소용 슬러그 — 영문 소문자·숫자·하이픈. 비면 무작위로. */
export function toSlug(input: string): string {
  const s = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s;
}
