// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { Announcements } from "./People";
import type { CreatorView } from "@/lib/creator/types";

it("copies the current selection and regional awards as self-contained HTML before publication", () => {
  const participants = [
    { id: "1", name: "LA winner", award: "Winner", awardOrder: 0, profile: { region: "LA" }, contact: "internal@example.com" },
    { id: "2", name: "Paris winner", award: "Winner", awardOrder: 0, profile: { region: "Paris" } },
    { id: "3", name: "Selected <creator>", award: "", awardOrder: 0, profile: {} },
  ];
  const program = { id: "edition", participants: participants.map((person) =>
    person.id === "3" ? { ...person, applicationId: "application", profile: { bio: "Old manual introduction" } } : person),
    roster: null, awards: null };
  const applications: CreatorView["applications"] = [{
    id: "application", createdAt: "2026-11-25", utmId: null, emailNormalized: "private@example.com", phoneE164: null,
    data: { intro: "My public introduction", email: "private@example.com", __internal: "hidden" },
  }];
  const copy = vi.fn();
  render(<ConfirmProvider><Announcements program={program} projectName="Expo" labels={{ intro: "소개", email: "이메일" }} applications={applications}
    origin="" save={vi.fn()} copy={copy} /></ConfirmProvider>);
  const [roster, awards] = screen.getAllByRole("article").filter((article) => within(article).queryByRole("button", { name: /아임웹 코드블럭 복사/ }));

  fireEvent.click(within(roster).getByRole("button", { name: /아임웹 코드블럭 복사/ }));
  expect(copy.mock.lastCall?.[0]).toContain("Selected &lt;creator&gt;");
  expect(copy.mock.lastCall?.[0]).not.toContain("internal@example.com");
  expect(copy.mock.lastCall?.[0]).toContain("<style>");
  expect(copy.mock.lastCall?.[0]).toContain("data-creator-publication");
  expect(copy.mock.lastCall?.[0]).not.toContain("Old manual introduction");
  expect(copy.mock.lastCall?.[0]).not.toContain("My public introduction");

  fireEvent.click(within(roster).getByRole("checkbox", { name: "소개" }));
  fireEvent.click(within(roster).getByRole("button", { name: /아임웹 코드블럭 복사/ }));
  expect(copy.mock.lastCall?.[0]).toContain("My public introduction");
  expect(copy.mock.lastCall?.[0]).not.toContain("private@example.com");
  expect(within(awards).getByRole("checkbox", { name: "소개" })).not.toBeChecked();

  fireEvent.change(within(awards).getByRole("combobox", { name: "코드블럭 지역" }), { target: { value: "Paris" } });
  fireEvent.click(within(awards).getByRole("button", { name: /아임웹 코드블럭 복사/ }));
  expect(copy.mock.lastCall?.[0]).toContain("Paris winner");
  expect(copy.mock.lastCall?.[0]).not.toContain("LA winner");
  expect(copy.mock.lastCall?.[0]).not.toContain("Selected");
});
