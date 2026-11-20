import { expect, it, vi } from "vitest";
import { GET } from "@/app/api/webinar/[slug]/live-state/route";
import { getWebinarLiveSnapshot } from "../webinar-live-snapshot";

const { findWebinar, countRegistrations } = vi.hoisted(() => ({
  findWebinar: vi.fn(),
  countRegistrations: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    webinar: { findUnique: findWebinar },
    webinarAnnouncement: { findMany: vi.fn(async () => []) },
    webinarPoll: { findFirst: vi.fn() },
    webinarPopup: { findFirst: vi.fn() },
    webinarTallyPush: { findFirst: vi.fn() },
    webinarSurvey: { findFirst: vi.fn() },
    webinarRegistration: { count: countRegistrations },
  },
}));

it("keeps counting viewers and only hides the number in the public response when the toggle is off", async () => {
  const row = { id: "webinar", statusOverride: "live", project: { deletedAt: null } };
  findWebinar
    .mockResolvedValueOnce({ ...row, config: { livePage: { entry: { viewerCount: false } } } })
    .mockResolvedValueOnce({ ...row, config: {} });
  countRegistrations.mockImplementation(async ({ where }) => where.isActive ? 42 : 90);

  const readPublicState = async (slug: string) => {
    const response = await GET(new Request(`https://example.test/api/webinar/${slug}/live-state`), {
      params: Promise.resolve({ slug }),
    });
    expect(response.ok).toBe(true);
    return response.json();
  };

  expect((await getWebinarLiveSnapshot("viewer-count-off")).viewerCount).toBe(42);
  expect(countRegistrations).toHaveBeenCalledWith({
    where: { webinarId: "webinar", isActive: true, presencePingAt: { gte: expect.any(Date) } },
  });
  expect((await readPublicState("viewer-count-off")).viewerCount).toBeNull();
  expect((await readPublicState("viewer-count-default")).viewerCount).toBe(42);
});
