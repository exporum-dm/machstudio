import { beforeEach, expect, it, vi } from "vitest";
import { POST as identify } from "./identify/route";
import { POST as submit } from "./route";

const { findSurvey, findRegistration, upsert } = vi.hoisted(() => ({
  findSurvey: vi.fn(),
  findRegistration: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webinarSurvey: { findFirst: findSurvey },
    webinarRegistration: { findFirst: findRegistration },
    webinarSurveyResponse: { upsert },
  },
}));
vi.mock("@/lib/ratelimit", () => ({ getClientIp: () => "test-ip", rateLimitAsync: async () => ({ allowed: true }) }));

const context = { params: Promise.resolve({ slug: "webinar-a", surveyId: "survey-a" }) };
const request = (body: object) => new Request("https://example.test", { method: "POST", body: JSON.stringify(body) });
const answers = { feedback: "좋았어요" };
const survey = {
  id: "survey-a",
  webinarId: "webinar-id",
  isOpen: true,
  opensAt: null,
  closesAt: null,
  questions: [{ id: "feedback", type: "text", title: "후기", required: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  findSurvey.mockResolvedValue(survey);
  findRegistration.mockResolvedValue({ id: "registrant-a" });
});

it("verifies the registration email in the same webinar and upserts the registered attendee's response", async () => {
  const identity = await identify(request({ email: "  Attendee@Example.Test  " }), context);
  expect(identity.status).toBe(200);
  expect(identity.headers.get("Cache-Control")).toBe("no-store");
  expect(findSurvey).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "survey-a", webinar: { slug: "webinar-a" } } }));
  expect(findRegistration).toHaveBeenCalledWith({
    where: { webinarId: "webinar-id", email: { equals: "attendee@example.test", mode: "insensitive" } },
    select: { id: true },
  });
  const { found, ticket } = await identity.json();
  expect(found).toBe(true);
  const result = await submit(request({ answers, source: "link", ticket }), context);
  expect(result.status).toBe(201);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { surveyId_registrationId: { surveyId: "survey-a", registrationId: "registrant-a" } },
    create: { surveyId: "survey-a", webinarId: "webinar-id", registrationId: "registrant-a", answers, source: "link" },
  }));
});

it("does not confirm an email absent from this webinar", async () => {
  findRegistration.mockResolvedValueOnce(null);
  const response = await identify(request({ email: "registered-elsewhere@example.test" }), context);
  expect(await response.json()).toEqual({ found: false });
  expect(upsert).not.toHaveBeenCalled();
});

it("rejects link submissions without a valid survey-scoped ticket", async () => {
  const { ticket } = await (await identify(request({ email: "attendee@example.test" }), context)).json();
  const otherSurvey = { params: Promise.resolve({ slug: "webinar-a", surveyId: "survey-b" }) };
  findSurvey.mockResolvedValueOnce({ ...survey, id: "survey-b" });
  expect((await submit(request({ answers, ticket, source: "link" }), otherSurvey)).status).toBe(403);
  expect((await submit(request({ answers, registrationId: "registrant-a", source: "link" }), context)).status).toBe(403);
  expect((await submit(request({ answers, source: "ended" }), context)).status).toBe(403);
  expect(upsert).not.toHaveBeenCalled();
});

it("keeps accepting live responses from an already registered attendee", async () => {
  const response = await submit(request({ answers, registrationId: "registrant-a", source: "live" }), context);
  expect(response.status).toBe(201);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ registrationId: "registrant-a", source: "live" }) }));
});
