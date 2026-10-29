// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JournalTab from "../JournalTab";
import { kstToday } from "@/lib/worklog";
import type { WorkEntryDto, WorkGroupDto } from "../types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const today = kstToday();
const group = (id: string, name: string, sortOrder: number): WorkGroupDto => ({
  id, name, projectId: null, startDate: null, endDate: null, archived: false, sortOrder, aliases: [],
});
const groups = [group("la", "LA", 1), group("stk", "STK", 2)];
const entry = (id: string, groupId: string | null, sortOrder: number, content: string): WorkEntryDto => ({
  id, groupId, authorId: "u1", authorName: "나", createdById: "u1", date: today, common: false, sortOrder,
  category: "", content, status: "doing", result: "", note: "", createdAt: `2026-10-20T00:00:0${sortOrder}Z`, updatedAt: "2026-10-20T00:00:00Z",
});

type Call = { method: string; url: string; body: Record<string, unknown> | null };

function mockApi(entries: WorkEntryDto[], opts: { deleteStatus?: number } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    if (method === "GET") {
      return new Response(JSON.stringify({ entries, members: [{ id: "u1", name: "나" }], me: "u1", isAdmin: false }), { status: 200 });
    }
    if (method === "PATCH") {
      const current = entries.find((e) => e.id === body.id)!;
      return new Response(JSON.stringify({ entry: { ...current, ...body } }), { status: 200 });
    }
    if (method === "DELETE") return new Response(JSON.stringify({ ok: opts.deleteStatus === undefined }), { status: opts.deleteStatus ?? 200 });
    return new Response("{}", { status: 200 });
  }));
  return calls;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

async function renderTab() {
  act(() => { root.render(<JournalTab workspaceId="ws" groups={groups} onGoGroups={() => {}} />); });
  await flush();
}

const todayCell = () => container.querySelector(`[data-cell="${today}|u1"]`) as HTMLElement;
const texts = () => [...todayCell().querySelectorAll("textarea")].map((t) => t.value);
const headers = () => [...todayCell().querySelectorAll("div")].map((d) => d.textContent ?? "").filter((t) => /^\[[^\]]+\]$/.test(t));

async function openMenu(content: string) {
  const row = [...todayCell().querySelectorAll("textarea")].find((t) => t.value === content)!.closest(".group\\/line")!;
  const btn = row.querySelector('button[aria-label="줄 설정"]') as HTMLButtonElement;
  act(() => { btn.click(); });
}
const menuButton = (label: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label) as HTMLButtonElement;

describe("일지 칸 — 같은 행사는 한데 모으고 순서를 바꾼다", () => {
  const interleaved = [entry("a", "la", 1, "LA 배너"), entry("x", "stk", 2, "STK 광고"), entry("b", "la", 3, "LA 릴스")];

  it("중간에 다른 행사 줄이 끼어 있어도 같은 행사는 머리표 하나 아래 모인다", async () => {
    mockApi(interleaved);
    await renderTab();
    expect(texts()).toEqual(["LA 배너", "LA 릴스", "STK 광고"]);
    expect(headers()).toEqual(["[LA]", "[STK]"]);
  });

  it("⋯ 의 위로는 같은 행사 안에서 자리를 바꾸고 칸 순서를 1,2,3 으로 다시 저장한다", async () => {
    const calls = mockApi(interleaved);
    await renderTab();
    await openMenu("LA 릴스");
    act(() => { menuButton("위로").click(); });
    await flush();
    expect(texts()).toEqual(["LA 릴스", "LA 배너", "STK 광고"]);
    const patches = calls.filter((c) => c.method === "PATCH").map((c) => c.body);
    expect(patches).toEqual(expect.arrayContaining([{ id: "b", sortOrder: 1 }, { id: "a", sortOrder: 2 }, { id: "x", sortOrder: 3 }]));
  });

  it("행사 묶음 맨 아래에서 아래로 가면 묶음째 다음 행사 아래로 내려간다", async () => {
    mockApi(interleaved);
    await renderTab();
    await openMenu("LA 릴스");
    act(() => { menuButton("아래로").click(); });
    await flush();
    expect(texts()).toEqual(["STK 광고", "LA 배너", "LA 릴스"]);
    expect(headers()).toEqual(["[STK]", "[LA]"]);
  });
});

describe("일지 줄 지우기", () => {
  it("저장된 줄을 지우면 서버에 그 id 로 DELETE 를 보낸다", async () => {
    const calls = mockApi([entry("a", "la", 1, "LA 배너"), entry("b", "la", 2, "LA 릴스")]);
    await renderTab();
    await openMenu("LA 릴스");
    act(() => { menuButton("지우기").click(); });
    await flush();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/worklog/entries?id=b"]);
    expect(texts()).toEqual(["LA 배너"]);
  });

  it("이미 지워진 줄(404)은 화면에 되살리지 않는다", async () => {
    mockApi([entry("a", "la", 1, "LA 배너"), entry("b", "la", 2, "LA 릴스")], { deleteStatus: 404 });
    await renderTab();
    await openMenu("LA 릴스");
    act(() => { menuButton("지우기").click(); });
    await flush();
    expect(texts()).toEqual(["LA 배너"]);
  });
});
