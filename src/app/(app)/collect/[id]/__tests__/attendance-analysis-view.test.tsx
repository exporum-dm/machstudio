// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AnalysisTab from "../AnalysisTab";
import { buildRegistrationAnalysis } from "@/lib/registration-analysis";

vi.mock("recharts", async () => {
  const React = await import("react");
  return Object.fromEntries(["Bar", "BarChart", "CartesianGrid", "Legend", "Line", "LineChart", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map((name) => [name, ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children)]));
});
vi.mock("@/components/ui/use-chart-colors", () => ({ useChartColors: () => ({ series: ["blue", "green", "pink"], chat: "gray", grid: "gray", axis: "gray" }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows date-only attendance separately from timestamp and dwell coverage", async () => {
  const date = "2026-09-17";
  const analysis = buildRegistrationAnalysis({
    timezone: "Asia/Seoul", eventDates: [date], fields: [], companionKey: null, visitDateKey: null, regionKey: null,
    records: [
      { id: "timed", registrationNo: null, createdAt: new Date("2026-09-01"), utmSource: null, data: { __attendance_import: { version: 1, kind: "visitor-history", channel: "online", visitDates: [date], sessions: [{ date, enteredAt: "2026-09-17T01:00:00Z", exitedAt: "2026-09-17T03:00:00Z" }] } } },
      { id: "dated", registrationNo: null, createdAt: new Date("2026-09-01"), utmSource: null, data: { __attendance_import: { version: 1, kind: "visitor-history", channel: "online", visitDates: [date], sessions: [] } } },
    ], checkIns: [{ recordId: "timed", eventDate: date, scannedAt: new Date("2026-09-17T01:00:00Z") }],
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sourceName: "통합 분석", generatedAt: new Date().toISOString(), fields: {}, analysis, audiences: [], audienceRows: [] }) }));
  render(<AnalysisTab sourceId="demo" />);
  const heading = await screen.findByText("입장시각·체류시간");
  const section = within(heading.closest("section")!);
  expect(section.getByText(/입장시각이 있는 1명/)).toHaveTextContent("방문일만 확인된 1명");
  expect(section.getByText(/입장·퇴장이 모두 있는 1개 구간/)).toBeInTheDocument();
  expect(section.getAllByText("120.0분").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/사전·현장 구분은 원본 등록 경로 기준/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /결과보고용 엑셀/ })).toBeEnabled();
});
