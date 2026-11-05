// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import RepeatControls from "../RepeatControls";
afterEach(cleanup);

it("previews an interval and sends the exact additional count", () => {
  const onCreate = vi.fn();
  render(<RepeatControls date="2026-11-05" disabled={false} busy={false} onCreate={onCreate} />);
  fireEvent.change(screen.getByLabelText("반복 주기"), { target: { value: "week" } });
  fireEvent.change(screen.getByLabelText("반복 간격"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("추가할 콘텐츠 수"), { target: { value: "2" } });
  expect(screen.getByText("2026-11-19")).toBeInTheDocument();
  expect(screen.getByText("2026-12-03")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "2개 일정 추가" }));
  expect(onCreate).toHaveBeenCalledWith({ unit: "week", interval: 2, end: "count", count: 2 });
});

it("shows a field-adjacent error and prevents dates from an undated template", () => {
  render(<RepeatControls date={null} disabled={false} busy={false} onCreate={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("반복 주기"), { target: { value: "day" } });
  expect(screen.getByRole("status")).toHaveTextContent("날짜를 먼저");
  expect(screen.getByRole("button", { name: /일정 추가/ })).toBeDisabled();
});

it("does not silently turn a fractional interval into a different integer", () => {
  render(<RepeatControls date="2026-11-05" disabled={false} busy={false} onCreate={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("반복 주기"), { target: { value: "day" } });
  fireEvent.change(screen.getByLabelText("반복 간격"), { target: { value: "1.5" } });
  expect(screen.getByRole("status")).toHaveTextContent("정수");
  expect(screen.getByRole("button", { name: /일정 추가/ })).toBeDisabled();
});
