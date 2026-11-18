import { expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  webinar: { findUnique: vi.fn() },
  webinarAnnouncement: { findMany: vi.fn().mockResolvedValue([]) },
  webinarPoll: { findFirst: vi.fn().mockResolvedValue(null) },
  webinarPopup: { findFirst: vi.fn().mockResolvedValue(null) },
  webinarTallyPush: { findFirst: vi.fn().mockResolvedValue(null) },
  webinarSurvey: { findFirst: vi.fn().mockResolvedValue(null) },
  webinarRegistration: { count: vi.fn().mockResolvedValue(500) },
}));

vi.mock("@/lib/prisma", () => ({ prisma }));

import { getWebinarLiveSnapshot } from "@/lib/webinar-live-snapshot";

it("shares one database snapshot across 500 concurrent readers", async () => {
  prisma.webinar.findUnique.mockResolvedValue({
    id: "webinar-1",
    statusOverride: "live",
    liveStartAt: null,
    liveEndAt: null,
    signupDeadline: null,
    components: {},
    config: {},
    project: { deletedAt: null },
  });

  const results = await Promise.all(
    Array.from({ length: 500 }, () => getWebinarLiveSnapshot("concurrent-readers")),
  );

  expect(results.every((snapshot) => snapshot === results[0])).toBe(true);
  expect(results[0].viewerCount).toBe(500);
  expect(prisma.webinar.findUnique).toHaveBeenCalledTimes(1);
  expect(prisma.webinarAnnouncement.findMany).toHaveBeenCalledTimes(1);
  expect(prisma.webinarRegistration.count).toHaveBeenCalledTimes(2);
});
