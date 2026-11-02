// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompetitionLifecycle from "./CompetitionLifecycle";

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => confirm }));

describe("competition completion controls", () => {
  beforeEach(() => { confirm.mockReset(); });
  afterEach(cleanup);

  it("requires confirmation before ending and preserves the selected status on cancel", async () => {
    confirm.mockResolvedValue(false);
    const patch = vi.fn().mockResolvedValue(true);
    render(<CompetitionLifecycle competition={{ phaseOverride: "final" }} patch={patch} />);
    fireEvent.click(screen.getByRole("button", { name: "대회 종료" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toHaveValue("final");
  });

  it("ends the competition after confirmation and keeps the existing records accessible", async () => {
    confirm.mockResolvedValue(true);
    const patch = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<CompetitionLifecycle competition={{ phaseOverride: "final" }} patch={patch} />);
    fireEvent.click(screen.getByRole("button", { name: "대회 종료" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ phaseOverride: "closed" }, expect.any(String)));
    rerender(<CompetitionLifecycle competition={{ phaseOverride: "closed" }} patch={patch} />);
    expect(screen.getByRole("combobox")).toHaveValue("closed");
    expect(screen.queryByRole("button", { name: "대회 종료" })).not.toBeInTheDocument();
    expect(screen.getByText(/대회 목록과 결과는 유지/)).toBeInTheDocument();
  });

  it("requires confirmation before reopening a closed competition", async () => {
    confirm.mockResolvedValue(false);
    const patch = vi.fn();
    render(<CompetitionLifecycle competition={{ phaseOverride: "closed" }} patch={patch} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "auto" } });
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "대회를 다시 진행할까요?" })));
    expect(patch).not.toHaveBeenCalled();
  });
});
