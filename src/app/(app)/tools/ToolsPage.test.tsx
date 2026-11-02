// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/tools",
  useSearchParams: () => new URLSearchParams("tab=taxonomy"),
}));
vi.mock("@/contexts/workspace", () => ({ useWorkspace: () => ({}) }));
vi.mock("@/app/(app)/utm-builder/page", () => ({ default: () => null }));
vi.mock("@/app/(app)/media/page", () => ({ default: () => null }));
vi.mock("./TaxonomyTab", () => ({ default: ({ onOpenUtm }: { onOpenUtm: () => void }) => <button onClick={onOpenUtm}>Open UTM settings</button> }));
import ToolsPage from "./page";
afterEach(cleanup);

it("opens UTM option management from measurement events using URL state", () => {
  render(<ToolsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Open UTM settings" }));
  expect(nav.push).toHaveBeenCalledWith("/tools?tab=utm&manage=1", { scroll: false });
});
