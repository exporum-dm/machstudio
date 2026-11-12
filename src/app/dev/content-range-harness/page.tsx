"use client";

/**
 * 콘텐츠 캘린더 기간 막대 하니스 — 개발 환경 전용(프로덕션 404).
 * 로그인·DB 없이 캘린더·목록 보기를 메모리 항목으로 그려 본다. 끌어 옮기기도 메모리에서 동작한다.
 */
import { useState } from "react";
import { notFound } from "next/navigation";
import CalendarView from "@/app/(app)/content-calendar/CalendarView";
import ListView from "@/app/(app)/content-calendar/ListView";
import { PROJECT_COLORS, type ContentItemDto } from "@/lib/content-calendar";

const now = "2026-11-12T00:00:00.000Z";
const mk = (p: Partial<ContentItemDto>): ContentItemDto => ({
  id: Math.random().toString(36).slice(2), projectId: "tokyo", title: "", date: null, endDate: null, time: "", status: "waiting",
  channels: [], formats: [], campaign: "", assignees: [], body: "", link: "", sourceUrl: "", createdAt: now, updatedAt: now, ...p,
});

const SEED: ContentItemDto[] = [
  mk({ title: "[도쿄] 사전등록 유도 캠페인", date: "2026-11-25", endDate: "2026-12-12", status: "doing", projectId: "tokyo" }),
  mk({ title: "[파리] 스폰서 계약 카드뉴스 연재", date: "2026-11-30", endDate: "2026-12-04", status: "planning", projectId: "paris" }),
  mk({ title: "[LA] 바이어 모집 릴스", date: "2026-12-03", endDate: "2026-12-05", status: "design", projectId: "la" }),
  mk({ title: "인스타 카드뉴스 1편", date: "2026-12-03", time: "10:00", status: "confirm", projectId: "tokyo" }),
  mk({ title: "뉴스레터 발송", date: "2026-12-10", status: "done", projectId: "paris" }),
  mk({ title: "연말 시즌 그리팅", date: "2026-12-20", endDate: "2027-01-05", projectId: "la" }),
  mk({ title: "아이디어: 참가사 인터뷰", projectId: null }),
];
const NAMES: Record<string, string> = { tokyo: "도쿄", paris: "파리", la: "LA" };
const COLORS: Record<string, string> = { tokyo: PROJECT_COLORS[0], paris: PROJECT_COLORS[1], la: PROJECT_COLORS[2] };

export default function ContentRangeHarness() {
  if (process.env.NODE_ENV === "production") notFound();
  const [items, setItems] = useState(SEED);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const props = {
    items,
    projectName: (id: string | null) => (id ? NAMES[id] ?? "프로젝트" : "프로젝트 없음"),
    projectColor: (id: string | null) => (id ? COLORS[id] ?? "bg-zinc-400" : "bg-zinc-400"),
    showProject: true,
    onOpen: (id: string) => console.log("open", id),
    onCreate: () => undefined,
    onPatch: (id: string, fields: Partial<ContentItemDto>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...fields } : i))),
  };
  return (
    <main className="mx-auto max-w-6xl space-y-3 p-4">
      <div className="flex gap-2 text-sm">
        <button type="button" onClick={() => setView("calendar")} className="rounded border px-3 py-1">캘린더</button>
        <button type="button" onClick={() => setView("list")} className="rounded border px-3 py-1">목록</button>
      </div>
      {view === "calendar" ? <CalendarView {...props} month="2026-12" today="2026-12-03" /> : <ListView {...props} />}
    </main>
  );
}
