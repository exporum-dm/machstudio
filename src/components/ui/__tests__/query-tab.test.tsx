// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageTabs } from "../page-layout";
import { useQueryTab } from "../use-query-tab";
import { FieldSelect } from "../primitives";

const nav = vi.hoisted(() => ({ query: "tab=edit&from=2026-11-01&room=brief", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tools",
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ push: nav.push }),
}));
vi.mock("@/contexts/workspace", () => ({ useWorkspace: () => ({ expoHomepageEnabled: false }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("shared tab navigation", () => {
  it("restores browser URL changes and preserves other filters when selecting a tab", () => {
    const { result, rerender } = renderHook(() => useQueryTab(["edit", "install"] as const, "edit"));
    expect(result.current[0]).toBe("edit");
    act(() => result.current[1]("install"));
    expect(nav.push).toHaveBeenCalledWith("/tools?tab=install&from=2026-11-01&room=brief", { scroll: false });
    nav.query = "tab=install";
    rerender();
    expect(result.current[0]).toBe("install");
    nav.query = "tab=unknown";
    rerender();
    expect(result.current[0]).toBe("edit");
  });

  it("exposes the selected tab and uses native buttons for keyboard access", () => {
    const select = vi.fn();
    render(<PageTabs label="Views" value="edit" onChange={select} options={[{ id: "edit", label: "Edit" }, { id: "install", label: "Install", badge: 3 }]} />);
    expect(screen.getByRole("button", { name: "Edit" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Install 3" }));
    expect(select).toHaveBeenCalledWith("install");
  });

  it("allows a shared select to override the default full width", () => {
    render(<FieldSelect aria-label="Status" className="w-auto"><option>All</option></FieldSelect>);
    const classes = screen.getByRole("combobox", { name: "Status" }).className.split(" ");
    expect(classes).toContain("w-auto");
    expect(classes).not.toContain("w-full");
  });
});
