// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { Announcements } from "./People";

it("copies the current selection and regional awards as self-contained HTML before publication", () => {
  const participants = [
    { id: "1", name: "LA winner", award: "Winner", awardOrder: 0, profile: { region: "LA" }, contact: "internal@example.com" },
    { id: "2", name: "Paris winner", award: "Winner", awardOrder: 0, profile: { region: "Paris" } },
    { id: "3", name: "Selected <creator>", award: "", awardOrder: 0, profile: {} },
  ];
  const program = { id: "edition", participants, roster: null, awards: null };
  const copy = vi.fn();
  render(<ConfirmProvider><Announcements program={program} projectName="Expo" origin="" save={vi.fn()} copy={copy} /></ConfirmProvider>);
  const [roster, awards] = screen.getAllByRole("article").filter((article) => within(article).queryByRole("button", { name: /아임웹 코드블럭 복사/ }));

  fireEvent.click(within(roster).getByRole("button", { name: /아임웹 코드블럭 복사/ }));
  expect(copy.mock.lastCall?.[0]).toContain("Selected &lt;creator&gt;");
  expect(copy.mock.lastCall?.[0]).not.toContain("internal@example.com");
  expect(copy.mock.lastCall?.[0]).toContain("<style>");
  expect(copy.mock.lastCall?.[0]).toContain("data-creator-publication");

  fireEvent.change(within(awards).getByRole("combobox", { name: "코드블럭 지역" }), { target: { value: "Paris" } });
  fireEvent.click(within(awards).getByRole("button", { name: /아임웹 코드블럭 복사/ }));
  expect(copy.mock.lastCall?.[0]).toContain("Paris winner");
  expect(copy.mock.lastCall?.[0]).not.toContain("LA winner");
  expect(copy.mock.lastCall?.[0]).not.toContain("Selected");
});
