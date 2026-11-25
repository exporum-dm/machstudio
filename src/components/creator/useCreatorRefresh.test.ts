// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCreatorRefresh } from "./useCreatorRefresh";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("updates a visible dashboard without concurrent requests and catches up on return", async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let resolve: () => void = () => {};
  const refresh = vi.fn<() => Promise<void>>().mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockResolvedValue(undefined);
  const { unmount } = renderHook(() => useCreatorRefresh(refresh, true, 8000));
  await act(() => vi.advanceTimersByTimeAsync(16000));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  visibility.mockReturnValue("hidden");
  await act(() => vi.advanceTimersByTimeAsync(8000));
  expect(refresh).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(refresh).toHaveBeenCalledTimes(2);
  unmount();
  await act(() => vi.advanceTimersByTimeAsync(8000));
  expect(refresh).toHaveBeenCalledTimes(2);
});
