"use client";

import { notFound } from "next/navigation";
import { MentionWorkspace } from "@/components/pr-room/workspaces";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

/**
 * 홍보실 언급 조사 하니스(개발 전용) — 실제 MentionWorkspace + 모의 /api/pr-room.
 * 조사 기간·AI 도구 선택·결과 가져오기 화면을 로그인 없이 본다. 저장은 메모리에서만 일어난다.
 * ?monitorTab=ai 로 AI 웹 조사 탭을 바로 연다.
 */
const ROOM = {
  id: "room-harness",
  updatedAt: "2026-11-11T00:00:00.000Z",
  lastCollectedAt: "2026-11-10T01:00:00.000Z",
  project: { name: "2026 서울 인디뷰티쇼" },
  keywords: ["인디뷰티쇼", "Indie Beauty Seoul"],
  referenceUrls: [],
  ownChannelUrls: ["https://www.indiebeautyshow.com"],
  excludedMentionUrls: [],
  excludedMentionRules: [],
  mentions: [
    {
      id: "m1", title: "인디뷰티쇼, 해외 바이어 1천여 명 사전 등록", url: "https://news.example.com/a1", source: "뷰티경제",
      channel: "press", sentiment: "positive", status: "new", riskLevel: "watch", excerpt: "", responseNote: "",
      publishedAt: "2026-11-05T01:00:00.000Z", collectedAt: "2026-11-10T01:00:00.000Z", origin: "aside",
      metrics: { likes: 120, comments: 48 },
      comments: [
        { author: "beauty_kim", text: "부스 너무 예뻤어요! 내년에도 갈게요", likes: 12, publishedAt: "2026-11-06T02:00:00.000Z" },
        { author: "indie_brand", text: "감사합니다 :)", isReply: true, publishedAt: "2026-11-06T03:00:00.000Z" },
        { author: "lee_buyer", text: "해외 바이어 상담 존이 따로 있었나요?", likes: 3 },
      ],
    },
  ],
  pressReleases: [],
};

// 모듈을 불러올 때 한 번 — 자식 effect 의 첫 요청보다 먼저 서야 한다(렌더 중에 전역을 바꾸지 않게).
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  let room = { ...ROOM };
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/pr-room")) {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body ?? "{}"));
        room = { ...room, ...body, updatedAt: new Date().toISOString() };
      }
      return Promise.resolve(Response.json({ room, canWrite: true }));
    }
    if (url.endsWith("/api/pr-room/collect")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return Promise.resolve(Response.json({ added: 0, counts: { "Google 뉴스": 3 }, errors: [], echoedRange: body.range }));
    }
    return real(input, init);
  };
}

export default function PrRoomHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <ConfirmProvider>
        <MentionWorkspace projectId="harness" />
      </ConfirmProvider>
    </div>
  );
}
