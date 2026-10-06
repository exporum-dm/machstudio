import { describe, expect, it } from "vitest";
import { isMetaThumbnailStale, metaCdnExpiresAt } from "@/lib/meta-ad-creatives";

/** fbcdn 서명 썸네일은 며칠 뒤 403 — 만료된 것만 골라 다시 받는다(광고·소재 탭 미리보기 깨짐, 2026-10-06). */
describe("Meta 썸네일 만료 판정", () => {
  const now = Date.UTC(2026, 9, 6, 0, 0, 0);
  const at = (ms: number) => `https://scontent-icn2-1.xx.fbcdn.net/v/t45.1600-4/123_n.jpg?stp=dst-jpg&oh=00_abc&oe=${Math.floor(ms / 1000).toString(16).toUpperCase()}`;

  it("oe(16진 유닉스초)를 만료 시각으로 읽는다", () => {
    expect(metaCdnExpiresAt(at(now))).toBe(Math.floor(now / 1000) * 1000);
  });

  it("지났거나 1시간 안에 만료되면 갱신 대상", () => {
    expect(isMetaThumbnailStale(at(now - 1000), now)).toBe(true);
    expect(isMetaThumbnailStale(at(now + 30 * 60_000), now)).toBe(true);
    expect(isMetaThumbnailStale(at(now + 2 * 24 * 60 * 60_000), now)).toBe(false);
  });

  it("만료 정보가 없는 주소는 건드리지 않는다", () => {
    expect(isMetaThumbnailStale(null, now)).toBe(false);
    expect(isMetaThumbnailStale("https://tpc.googlesyndication.com/simgad/123", now)).toBe(false);
    expect(isMetaThumbnailStale("https://evil.example.com/a.jpg?oe=00000001", now)).toBe(false);
    expect(isMetaThumbnailStale("not a url", now)).toBe(false);
  });
});
