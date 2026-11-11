import { describe, expect, it } from "vitest";
import { buildResearchPrompt, MAX_COMMENTS_PER_MENTION, mergeComments, parseClaudeResearch } from "../model";

describe("댓글 모으기", () => {
  it("Aside 조사문은 댓글을 끝까지 펼쳐 원문 그대로 모으라고 한다", () => {
    const prompt = buildResearchPrompt({ eventNames: ["인디뷰티 서울"], agent: "aside" });
    expect(prompt).toContain("댓글 더 보기");
    expect(prompt).toContain("원문 그대로");
    expect(prompt).toContain("isReply");
    expect(prompt).toContain("댓글을 달거나 좋아요를 누르면 안 됩니다");
  });

  it("가져오기는 댓글 날짜·답글 여부를 읽고, 상한까지만 받는다", () => {
    const many = Array.from({ length: MAX_COMMENTS_PER_MENTION + 20 }, (_, i) => ({ author: `u${i}`, text: `댓글 ${i}` }));
    const rows = parseClaudeResearch(JSON.stringify([{
      title: "후기", url: "https://www.instagram.com/p/a", source: "Instagram", channel: "sns",
      comments: [{ author: "kim", text: "좋아요", likes: 3, publishedAt: "2026-11-08", isReply: true }, ...many],
    }]));
    expect(rows[0].comments).toHaveLength(MAX_COMMENTS_PER_MENTION);
    expect(rows[0].comments?.[0]).toMatchObject({ author: "kim", likes: 3, isReply: true });
    expect(rows[0].comments?.[0].publishedAt).toMatch(/^2026-11-08/);
  });

  it("다시 조사하면 새 댓글만 더하고 이미 있던 댓글은 겹치지 않는다", () => {
    const before = [{ author: "@kim", text: "부스 좋았어요", likes: 2 }];
    const after = mergeComments(before, [
      { author: "kim", text: "부스  좋았어요", likes: 5 },
      { author: "lee", text: "내년에도 가요" },
    ]);
    expect(after).toEqual([
      { author: "@kim", text: "부스 좋았어요", likes: 5 },
      { author: "lee", text: "내년에도 가요" },
    ]);
    expect(mergeComments(before, undefined)).toBe(before);
  });
});
