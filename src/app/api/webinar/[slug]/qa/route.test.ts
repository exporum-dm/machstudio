import { afterEach, describe, expect, it, vi } from "vitest";
import { createQaHistoryToken, verifyQaHistoryToken } from "@/lib/webinar-qa-history-token";
import { GET, POST } from "./route";

const { findWebinar, findViewer, findQuestions, createQuestion } = vi.hoisted(() => ({
  findWebinar: vi.fn(),
  findViewer: vi.fn(),
  findQuestions: vi.fn(),
  createQuestion: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webinar: { findUnique: findWebinar },
    webinarRegistration: { findFirst: findViewer },
    webinarQA: { findMany: findQuestions, create: createQuestion },
  },
}));
vi.mock("@/lib/ratelimit", () => ({ rateLimitAsync: vi.fn(async () => ({ allowed: true })) }));

const context = { params: Promise.resolve({ slug: "webinar-a" }) };
const receipt = { id: "question-a", question: "My question", sessionNumber: null, createdAt: "2026-11-20T01:00:00Z" };
function auth() {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
  return { Authorization: `Bearer ${createQaHistoryToken("webinar-a", "viewer-a")}` };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("webinar question history", () => {
  it("keeps the token issued at early registration valid during the scheduled event", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T01:00:00Z"));
    const token = createQaHistoryToken("webinar-a", "viewer-a", new Date("2026-11-20T02:00:00Z"));
    const header = `Bearer ${token}`;
    vi.setSystemTime(new Date("2026-11-20T01:00:00Z"));
    expect(verifyQaHistoryToken(header, "webinar-a", "viewer-a")).toBe(true);
    expect(verifyQaHistoryToken(header, "webinar-b", "viewer-a")).toBe(false);
    vi.setSystemTime(new Date("2026-11-22T01:00:00Z"));
    expect(verifyQaHistoryToken(header, "webinar-a", "viewer-a")).toBe(false);
  });
  it("rejects a missing token and a token for a different viewer before looking up questions", async () => {
    for (const headers of [undefined, auth()]) {
      const response = await GET(new Request("https://example.test/qa?mine=1&registrationId=viewer-b", { headers }), context);
      expect(response.status).toBe(403);
    }
    expect(findQuestions).not.toHaveBeenCalled();
  });

  it("returns only the confirmed viewer's own receipt fields in closed mode", async () => {
    findWebinar.mockResolvedValue({ id: "webinar-id", components: { qaMode: "closed" } });
    findViewer.mockResolvedValue({ id: "viewer-a" });
    findQuestions.mockResolvedValue([receipt]);

    const response = await GET(new Request("https://example.test/qa?mine=1&registrationId=viewer-a", { headers: auth() }), context);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ questions: [receipt] });
    expect(findQuestions).toHaveBeenCalledWith(expect.objectContaining({
      where: { webinarId: "webinar-id", registrationId: "viewer-a" },
      select: { id: true, question: true, sessionNumber: true, createdAt: true },
    }));

    const board = await GET(new Request("https://example.test/qa?registrationId=viewer-b"), context);
    expect(await board.json()).toEqual({ questions: [], qaMode: "closed" });
    expect(findQuestions).toHaveBeenCalledTimes(1);
  });

  it("associates a submitted receipt with the owner only when entry is confirmed", async () => {
    findWebinar.mockResolvedValue({ id: "webinar-id", statusOverride: "live" });
    findViewer.mockResolvedValue({ name: "Viewer" });
    createQuestion.mockResolvedValue(receipt);
    for (const headers of [auth(), undefined]) {
      const response = await POST(new Request("https://example.test/qa", {
        method: "POST",
        headers,
        body: JSON.stringify({ question: receipt.question, registrationId: "viewer-a" }),
      }), context);
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ qa: receipt });
    }
    expect(createQuestion.mock.calls[0][0].data.registrationId).toBe("viewer-a");
    expect(createQuestion.mock.calls[1][0].data.registrationId).toBeUndefined();
  });
});
