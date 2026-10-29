"use client";

/**
 * 브리프 어드민 탭 검증용 하니스 — **개발 환경 전용**.
 *
 * /brief 는 로그인 뒤에 있어 브라우저 자동화로 확인할 수 없다. 탭 컴포넌트를 그대로 렌더하고
 * /api/briefs/* 만 메모리 가짜로 바꿔 끼운다(카톡 텍스트는 실제 buildKakaoText 로 만든다).
 *
 * 프로덕션에서는 404.
 */
import { notFound } from "next/navigation";
import { useState } from "react";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { Segmented } from "@/components/ui/primitives";
import { PickTab } from "@/components/brief/PickTab";
import { DashboardTab } from "@/components/brief/DashboardTab";
import { PublicTab } from "@/components/brief/PublicTab";
import { SourcesTab } from "@/components/brief/SourcesTab";
import { buildKakaoText } from "@/lib/brief/model";
import type { BriefItem, BriefRow } from "@/components/brief/types";

if (process.env.NODE_ENV === "production") notFound();

const kst = (d: string) => new Date(`${d}T00:00:00+09:00`).toISOString();
const now = new Date().toISOString();
const base = { url: "https://example.com", source: "manual", sourceName: "", publishedAt: null, note: "", issueId: null, createdAt: now };

const SEED: BriefItem[] = [
  { ...base, id: "a", category: "support", org: "중소벤처기업부", title: "2026년 온라인수출 물류 지원사업 2차 참여기업 모집", dueDate: kst("2026-09-24"), dateLabel: "", adopted: true, shortUrl: "http://localhost:3000/r/aB3xQ9z" },
  { ...base, id: "b", category: "support", org: "울산경제일자리진흥원", title: "국제특송 해외물류비 지원사업", dueDate: null, dateLabel: "예산소진시까지", adopted: false, shortUrl: null },
  { ...base, id: "c", category: "event", org: "이벤터스", title: "AI와 함께하는 무역서류 기초 클래스", dueDate: kst("2026-10-08"), dateLabel: "", adopted: true, shortUrl: "http://localhost:3000/r/Kp9qW2e" },
  { ...base, id: "d", category: "news", org: "서울경제", title: "K게임 상반기 해외매출 6조…반년 만에 작년의 80% 채웠다", dueDate: null, dateLabel: "", adopted: true, shortUrl: "http://localhost:3000/r/N3wsR7t" },
  // 자동 수집 후보 — 읽는 줄로 보여야 한다
  ...Array.from({ length: 9 }, (_, n): BriefItem => ({
    ...base, id: `s${n}`, category: "support", org: ["한국무역협회", "인천테크노파크", "엑스코"][n % 3],
    title: `[자동] 2026년 해외 전시회 참가 지원사업 ${n + 1}차 모집 공고`, dueDate: kst(`2026-10-${String(n + 1).padStart(2, "0")}`),
    dateLabel: "", adopted: false, shortUrl: null, source: "bizinfo", sourceName: "기업마당 · 수출",
  })),
  { ...base, id: "e1", category: "event", org: "헤드라인제주", title: "제주FTA통상진흥센터, 찾아가는 수출·통상 실무 설명회 개최", dueDate: null, dateLabel: "", adopted: false, shortUrl: null, source: "googlenews", sourceName: "수출 설명회·웨비나", publishedAt: now },
  { ...base, id: "n1", category: "news", org: "뷰티경제", title: "8월 K-뷰티 수출 빅데이터 리포트", dueDate: null, dateLabel: "", adopted: false, shortUrl: null, source: "googlenews", sourceName: "K-뷰티 수출", publishedAt: now },
];

let memSources = [
  { id: "src1", kind: "bizinfo", name: "기업마당 · 수출", config: { hashCode: "07", pages: 3, include: [], exclude: [] }, category: "auto", enabled: true, lastRunAt: now, lastAdded: 12, lastError: "" },
  { id: "src2", kind: "googlenews", name: "K-뷰티 수출", config: { query: "K-뷰티 수출", days: 3, include: [], exclude: [] }, category: "news", enabled: true, lastRunAt: now, lastAdded: 0, lastError: "" },
  { id: "src3", kind: "rss", name: "", config: { url: "", include: [], exclude: [] }, category: "news", enabled: false, lastRunAt: now, lastAdded: 0, lastError: "피드 주소가 비어 있어요" },
];

const BRIEF: BriefRow = {
  id: "h", name: "The Action", slug: "zz-verify-brief", intro: "이번주 바로 확인해야 할 실용 정보를 보내드립니다!",
  isPublic: true, appendPublicLink: true, publicUrl: "http://localhost:3000/b/zz-verify-brief",
};

const STATS = {
  totals: { clicks: 57, direct: 41, web: 16 },
  items: [
    { id: "a", category: "support", org: "중소벤처기업부", title: SEED[0].title, adopted: true, clicks: 31, uniques: 24, direct: 25, web: 6 },
    { id: "d", category: "news", org: "서울경제", title: SEED[3].title, adopted: true, clicks: 18, uniques: 15, direct: 11, web: 7 },
    { id: "c", category: "event", org: "이벤터스", title: SEED[2].title, adopted: true, clicks: 8, uniques: 8, direct: 5, web: 3 },
  ],
  byCategory: [
    { key: "support", clicks: 31, items: 2, perItem: 15.5 },
    { key: "news", clicks: 18, items: 1, perItem: 18 },
    { key: "event", clicks: 8, items: 1, perItem: 8 },
  ],
  byOrg: [
    { key: "중소벤처기업부", clicks: 31, items: 1, perItem: 31 },
    { key: "서울경제", clicks: 18, items: 1, perItem: 18 },
    { key: "이벤터스", clicks: 8, items: 1, perItem: 8 },
  ],
  byIssue: [{ id: "i1", title: "9/15 The Action", publishedAt: now, clicks: 57 }],
  days: Array.from({ length: 14 }, (_, i) => ({ day: `2026-09-${String(i + 8).padStart(2, "0")}`, clicks: [2, 5, 9, 3, 1, 0, 4, 8, 6, 2, 3, 7, 5, 2][i] })),
};

let memItems = SEED;
let memBrief = BRIEF;

if (typeof window !== "undefined" && !(window as unknown as { __briefStub?: boolean }).__briefStub) {
  (window as unknown as { __briefStub?: boolean }).__briefStub = true;
  const real = window.fetch.bind(window);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, location.origin).pathname;
    if (!path.startsWith("/api/briefs/")) return real(input, init);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    await new Promise((r) => setTimeout(r, 150));
    if (path.endsWith("/kakao")) {
      const adopted = memItems.filter((i) => i.adopted && !i.issueId);
      return json({ text: buildKakaoText(adopted, { name: memBrief.name, intro: memBrief.intro, publicUrl: memBrief.appendPublicLink ? memBrief.publicUrl : null }), count: adopted.length });
    }
    if (path.endsWith("/stats")) return json(STATS);
    if (path.endsWith("/sources") && method === "GET") {
      return json({ canWrite: true, sources: memSources, presets: [{ key: "export", label: "해외진출·수출", description: "기업마당 수출 분야 공고 + 뉴스" }] });
    }
    const srcMatch = path.match(/\/sources\/([^/]+)$/);
    if (srcMatch && method === "PATCH") {
      memSources = memSources.map((s) => (s.id === srcMatch[1] ? { ...s, ...body, config: { ...s.config, ...(body.config ?? {}) } } : s));
      return json({ source: memSources.find((s) => s.id === srcMatch[1]) });
    }
    if (srcMatch && method === "DELETE") {
      memSources = memSources.filter((s) => s.id !== srcMatch[1]);
      return json({ ok: true });
    }
    if (path.endsWith("/collect")) return json({ added: 3, results: [{ error: "" }] });
    if (path.endsWith("/preview")) return json({ preview: { title: "2026 해외규격인증 획득지원사업 공고", siteName: "기업마당" } });
    const itemMatch = path.match(/\/items\/([^/]+)$/);
    if (itemMatch && method === "PATCH") {
      memItems = memItems.map((i) => (i.id === itemMatch[1] ? { ...i, ...body, shortUrl: i.shortUrl ?? (body.adopted ? `http://localhost:3000/r/new${i.id}` : null) } : i));
      return json({ item: memItems.find((i) => i.id === itemMatch[1]) });
    }
    if (itemMatch && method === "DELETE") {
      memItems = memItems.filter((i) => i.id !== itemMatch[1]);
      return json({ ok: true });
    }
    if (path.endsWith("/items") && method === "POST") {
      const item: BriefItem = { ...base, id: Math.random().toString(36).slice(2), category: body.category, org: body.org || "기업마당", title: body.title || "2026 해외규격인증 획득지원사업 공고", url: body.url, dueDate: body.dueDate ? kst(body.dueDate) : null, dateLabel: body.dateLabel ?? "", adopted: true, shortUrl: "http://localhost:3000/r/NeW1234" };
      memItems = [item, ...memItems];
      return json({ item }, 201);
    }
    if (path.endsWith("/issues")) {
      memItems = memItems.map((i) => (i.adopted && !i.issueId ? { ...i, issueId: "i2" } : i));
      return json({ issue: { id: "i2" } }, 201);
    }
    if (method === "PATCH") {
      memBrief = { ...memBrief, ...body };
      return json({ brief: memBrief });
    }
    return json({ canWrite: true, brief: memBrief, items: memItems, issues: [] });
  };
}

export default function BriefHarness() {
  const [tab, setTab] = useState<"pick" | "dashboard" | "public" | "sources">("pick");
  const [items, setItems] = useState<BriefItem[]>(SEED);
  const [brief, setBrief] = useState<BriefRow>(BRIEF);
  const reload = async () => setItems([...memItems]);
  return (
    <ConfirmProvider>
      <div className="space-y-5 p-4 sm:p-6">
        <Segmented
          label="탭"
          value={tab}
          onChange={setTab}
          options={[
            { value: "pick", label: "링크 고르기" },
            { value: "dashboard", label: "대시보드" },
            { value: "public", label: "공개 화면" },
            { value: "sources", label: "자동 수집" },
          ]}
        />
        {tab === "pick" && <PickTab brief={brief} items={items} issues={[]} canWrite setItems={setItems} reload={reload} onOpenSources={() => setTab("sources")} />}
        {tab === "sources" && <SourcesTab brief={brief} canWrite onCollected={reload} />}
        {tab === "dashboard" && <DashboardTab brief={brief} />}
        {tab === "public" && <PublicTab brief={brief} canWrite onChange={setBrief} items={items} />}
      </div>
    </ConfirmProvider>
  );
}
