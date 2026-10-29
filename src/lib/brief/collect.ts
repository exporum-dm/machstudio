/**
 * 브리프 자동 수집 실행 — 소스를 읽어 **후보**(adopted=false)로 쌓는다.
 *
 * 매일 아침 크론(/api/cron/daily)과 화면의 "지금 수집" 이 같은 함수를 부른다.
 *
 * ── 중복 ─────────────────────────────────────────────────────────────
 * (briefId, urlKey) 유일 제약에 기대 createMany(skipDuplicates) 한다. 그래서
 *   · 어제 들어온 공고가 오늘 또 보여도 한 줄
 *   · 사람이 "숨기기" 한 후보도 행이 남아 있으니 다시 안 들어온다
 *
 * ── 들이지 않는 것 ───────────────────────────────────────────────────
 *   · 마감이 이미 지난 공고 — 공개 화면에서도 어차피 내려간다
 *   · 소스가 정한 기간보다 오래된 뉴스
 * 소스 하나가 실패해도 나머지는 계속한다. 실패 사유는 소스에 남겨 화면에서 보이게 한다.
 */
import { prisma } from "@/lib/prisma";
import { safeFetchText } from "./link-preview";
import { daysUntil, urlKey } from "./model";
import { parseDueDate } from "./input";
import {
  BIZINFO_FIELDS,
  bizinfoApiError,
  bizinfoApiUrl,
  bizinfoListUrl,
  googleNewsUrl,
  kitaListUrl,
  parseKitaList,
  parseBizinfoApi,
  isSourceKind,
  normalizeSourceCategory,
  normalizeSourceConfig,
  parseBizinfoList,
  parseFeed,
  passesWordFilter,
  type Candidate,
  type SourceKind,
} from "./sources";

/** 소스 한 번에 들이는 최대 개수 — 검색어 하나가 목록을 뒤덮지 않게 */
const MAX_PER_RUN = 30;

const isFeed = (ct: string) => /xml|rss|atom/i.test(ct);

/**
 * 소스에서 후보를 가져온다. note 는 실패는 아니지만 사람이 알아야 할 일(예: 공식 API 가 거절해 목록 읽기로 대체)
 * — 소스 줄에 그대로 보여 준다.
 */
async function fetchCandidates(kind: SourceKind, rawConfig: unknown, rawCategory: string): Promise<{ rows: Candidate[]; note: string }> {
  let note = "";
  const rows = await fetchRows(kind, rawConfig, rawCategory, (n) => {
    note = n;
  });
  return { rows, note };
}

async function fetchRows(kind: SourceKind, rawConfig: unknown, rawCategory: string, setNote: (n: string) => void): Promise<Candidate[]> {
  const cfg = normalizeSourceConfig(kind, rawConfig);
  const category = normalizeSourceCategory(rawCategory);

  if (kind === "bizinfo") {
    // 공식 API 키가 있으면 API 먼저. 실패하면(키 오류·점검) 목록 읽기로 내려간다 — 수집이 멈추지 않게.
    // 키가 든 주소는 오류 메시지·로그에 남기지 않는다.
    const key = process.env.BIZINFO_API_KEY?.trim();
    if (key) {
      const label = BIZINFO_FIELDS.find((f) => f.code === cfg.hashCode)?.label ?? "";
      const res = await safeFetchText(bizinfoApiUrl(key, 200, label), {
        accept: "application/json",
        maxBytes: 3_000_000,
        timeoutMs: 15_000,
        allow: (ct) => ct.includes("json") || ct.includes("text"),
      });
      try {
        const json = res ? JSON.parse(res.text) : null;
        if (json && !bizinfoApiError(json)) {
          const rows = parseBizinfoApi(json, label, category);
          if (rows.length > 0) return rows;
          setNote("공식 API 결과가 비어 목록 읽기로 대체했어요");
        } else if (json) {
          console.warn("[brief] 기업마당 API 오류, 목록 읽기로 대체:", bizinfoApiError(json));
          setNote(`공식 API 거절(${bizinfoApiError(json).slice(0, 60)}) — 목록 읽기로 대체했어요`);
        } else {
          setNote("공식 API 응답이 없어 목록 읽기로 대체했어요");
        }
      } catch {
        console.warn("[brief] 기업마당 API 응답을 읽지 못해 목록 읽기로 대체");
        setNote("공식 API 응답을 읽지 못해 목록 읽기로 대체했어요");
      }
    }
    const pages = await Promise.all(
      Array.from({ length: cfg.pages ?? 3 }, (_, i) => safeFetchText(bizinfoListUrl(cfg, i + 1), { maxBytes: 1_500_000, timeoutMs: 12_000 })),
    );
    if (pages.every((p) => !p)) throw new Error("기업마당 목록을 열지 못했어요");
    return pages.flatMap((p) => (p ? parseBizinfoList(p.text, category) : []));
  }

  if (kind === "kita") {
    const pages = await Promise.all(
      Array.from({ length: cfg.pages ?? 1 }, (_, i) => safeFetchText(kitaListUrl(cfg, i + 1), { maxBytes: 1_500_000, timeoutMs: 12_000 })),
    );
    if (pages.every((p) => !p)) throw new Error("무역협회 공지를 열지 못했어요");
    return pages.flatMap((p) => (p ? parseKitaList(p.text, category) : []));
  }

  const url = kind === "googlenews" ? googleNewsUrl(cfg) : cfg.url ?? "";
  if (kind === "googlenews" && !cfg.query) throw new Error("검색어가 비어 있어요");
  if (kind === "rss" && !/^https?:\/\//i.test(url)) throw new Error("피드 주소가 비어 있어요");
  const res = await safeFetchText(url, {
    accept: "application/rss+xml,application/atom+xml,application/xml,text/xml",
    maxBytes: 1_500_000,
    timeoutMs: 12_000,
    allow: (ct) => isFeed(ct) || ct.includes("html") === false,
  });
  if (!res) throw new Error("피드를 열지 못했어요");
  const items = parseFeed(res.text, category);
  if (items.length === 0 && !/<(rss|feed|rdf)/i.test(res.text.slice(0, 2000))) throw new Error("RSS 형식이 아니에요");
  return items;
}

function keep(c: Candidate, cfg: ReturnType<typeof normalizeSourceConfig>, now: Date): boolean {
  if (!passesWordFilter(c.title, cfg)) return false;
  if (c.dueDate && daysUntil(new Date(`${c.dueDate}T00:00:00+09:00`), now) < 0) return false;
  // 날짜 없는 공지는 한 달 안에 올라온 것만 — 무역협회처럼 오래된 글이 목록에 남는 곳이 있다
  if (!c.dueDate && c.category !== "news" && c.publishedAt && now.getTime() - c.publishedAt.getTime() > 30 * 86400_000) return false;
  if (c.category === "news" && c.publishedAt) {
    const limitDays = (cfg.days ?? 7) + 1;
    if (now.getTime() - c.publishedAt.getTime() > limitDays * 86400_000) return false;
  }
  return true;
}

export interface SourceRunResult {
  sourceId: string;
  added: number;
  seen: number;
  error: string;
}

export async function runSource(sourceId: string, now = new Date()): Promise<SourceRunResult> {
  const source = await prisma.briefSource.findUnique({ where: { id: sourceId } });
  if (!source || !isSourceKind(source.kind)) return { sourceId, added: 0, seen: 0, error: "알 수 없는 소스" };

  let added = 0;
  let seen = 0;
  let error = "";
  try {
    const cfg = normalizeSourceConfig(source.kind, source.config);
    const fetched = await fetchCandidates(source.kind, source.config, source.category);
    error = fetched.note;
    const candidates = fetched.rows
      .filter((c) => keep(c, cfg, now))
      .slice(0, MAX_PER_RUN);
    seen = candidates.length;

    // 같은 실행 안에서 같은 주소가 두 번 나오면 첫 번째만
    const byKey = new Map<string, Candidate>();
    for (const c of candidates) {
      const key = urlKey(c.url);
      if (!byKey.has(key)) byKey.set(key, c);
    }
    const res = await prisma.briefItem.createMany({
      data: [...byKey.entries()].map(([key, c]) => ({
        briefId: source.briefId,
        category: c.category,
        org: c.org.slice(0, 80),
        title: c.title.slice(0, 300),
        url: c.url,
        urlKey: key,
        dueDate: parseDueDate(c.dueDate),
        dateLabel: c.dateLabel.slice(0, 40),
        source: source.kind,
        sourceId: source.id,
        publishedAt: c.publishedAt,
        adopted: false,
      })),
      skipDuplicates: true,
    });
    added = res.count;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  await prisma.briefSource.update({
    where: { id: source.id },
    data: { lastRunAt: now, lastAdded: added, lastError: error.slice(0, 300) },
  });
  return { sourceId, added, seen, error };
}

/** 브리프의 켜진 소스를 모두 돈다. 서로 다른 사이트라 동시에 돌려도 된다. */
export async function collectBrief(briefId: string, now = new Date()) {
  const sources = await prisma.briefSource.findMany({
    where: { briefId, enabled: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  const results = await Promise.all(sources.map((s) => runSource(s.id, now)));
  return { briefId, added: results.reduce((n, r) => n + r.added, 0), results };
}

/** 크론용 — 켜진 소스가 있는 모든 브리프. */
export async function collectAllBriefs(now = new Date()) {
  const briefs = await prisma.brief.findMany({
    where: { deletedAt: null, sources: { some: { enabled: true } } },
    select: { id: true },
  });
  const out = [];
  for (const b of briefs) out.push(await collectBrief(b.id, now));
  return out;
}
