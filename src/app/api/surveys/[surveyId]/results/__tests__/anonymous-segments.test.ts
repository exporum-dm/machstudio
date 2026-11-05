import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ source: vi.fn(), responses: vi.fn(), authorize: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { collectSource: { findUnique: mocks.source }, surveyResponse: { findMany: mocks.responses } } }));
vi.mock("@/lib/survey-access", () => ({ authorizeSurvey: mocks.authorize }));
import { GET } from "../route";

beforeEach(() => {
  mocks.authorize.mockResolvedValue({ survey: { sourceId: "source", name: "익명 조사", config: { defaultLocale: "ko", audienceFieldKey: "visitor_type", sections: [{ questions: [{ key: "overall", type: "scale", title: { ko: "만족도" }, scaleMax: 5 }] }] } } });
  mocks.source.mockResolvedValue({ name: "Paris", formConfig: { defaultLocale: "ko", fields: [{ key: "visitor_type", type: "select", label: { ko: "유형" }, options: [{ ko: "General" }] }, { key: "gender", type: "multiple", label: { ko: "성별" }, options: [{ ko: "여성" }, { ko: "남성" }] }] } });
});

it("defaults to an answered demographic instead of a missing registration audience", async () => {
  mocks.responses.mockResolvedValue([{ id: "a", recordId: null, record: null, audience: "", channel: "anonymous-import", answers: { gender: ["여성"], overall: 4 }, createdAt: new Date(), updatedAt: new Date() }]);
  const result = await GET(new Request(`https://example.com/api/results?audience=${encodeURIComponent("(없음)")}`), { params: Promise.resolve({ surveyId: "survey" }) });
  if (!result) throw new Error("Expected survey results");
  const data = await result.json();
  expect(data.by).toBe("gender");
  expect(data.segmentable).toEqual([{ key: "gender", label: "성별" }]);
  expect(data.segments).toEqual([{ value: "여성", count: 1, scores: [{ key: "overall", average: 4, nps: null }] }]);
  expect(data.anonymous).toBe(1);
});

it("keeps a linked registration audience as the default when that information exists", async () => {
  mocks.responses.mockResolvedValue([{ id: "b", recordId: "registered", record: { data: { visitor_type: "General", gender: "남성" } }, audience: "General", channel: "qr", answers: { overall: 5 }, createdAt: new Date(), updatedAt: new Date() }]);
  const result = await GET(new Request("https://example.com/api/results"), { params: Promise.resolve({ surveyId: "survey" }) });
  if (!result) throw new Error("Expected survey results");
  const data = await result.json();
  expect(data.by).toBe("visitor_type");
  expect(data.segments[0]).toMatchObject({ value: "General", count: 1 });
  expect(data.registered).toBe(1);
});
