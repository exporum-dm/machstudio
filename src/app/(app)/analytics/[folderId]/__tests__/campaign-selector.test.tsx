// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AccountCampaignSelector } from "../AccountCampaignSelector";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const account = { platform: "META", accountId: "act_1", accountName: "행사 계정", campaignIds: ["10"] };

it("searches account-wide campaigns and saves IDs rather than duplicate names", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ campaigns: [{ id: "10", name: "동일 이름" }, { id: "20", name: "동일 이름" }] }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ mediaAccounts: [{ ...account, campaignIds: ["10", "20"] }] }) });
  vi.stubGlobal("fetch", fetcher); const onChange = vi.fn();
  render(<AccountCampaignSelector folderId="folder" account={account} onChange={onChange} />);
  await screen.findAllByText("동일 이름");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "20" } });
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ platform: "META", accountId: "act_1", campaignIds: ["10", "20"] });
});

it("rolls back a failed save and displays the error next to the controls", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ campaigns: [{ id: "10", name: "캠페인" }] }) }).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "저장 실패" }) }));
  render(<AccountCampaignSelector folderId="folder" account={account} onChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole("checkbox"));
  expect(await screen.findByRole("alert")).toHaveTextContent("저장 실패");
  expect(screen.getByRole("checkbox")).toBeChecked();
});
