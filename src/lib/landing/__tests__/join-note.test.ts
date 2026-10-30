// @vitest-environment jsdom
/**
 * How to Join 마감 줄 — note 를 쓰면 그 줄 전체가 그 문구로 바뀐다(자동 날짜 접두 없음).
 * 비우면 예전처럼 자동 계산된 날짜가 굵게 붙은 기본 문구가 나간다.
 */
import { describe, expect, it } from "vitest";
import { mountLanding } from "@/lib/landing/mount";
import type { LandingWebinar } from "@/lib/landing/types";

function webinar(note: string): LandingWebinar {
  return {
    id: "wb-join", name: "조인 테스트", slug: "join-test",
    description: "", liveStartAt: "2026-08-11T05:00:00.000Z",
    theme: {}, status: "registration", entryOpen: false, canRegister: true,
    sessions: [],
    config: {
      landingPage: {
        enabled: true,
        join: { enabled: true, steps: [{ title: "등록", description: "" }], note },
      },
    },
  };
}

function mountAndRead(w: LandingWebinar) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle = mountLanding({ mount: host, webinar: w, embedded: false, isPreview: false, origin: "https://example.test" });
  const text = host.querySelector(".deadline")?.innerHTML ?? "";
  handle.destroy();
  host.remove();
  return text;
}

describe("note 를 비우면 — 날짜가 자동으로 굵게 붙은 기본 문구", () => {
  it("<b>날짜</b> + 기본 문구", () => {
    const html = mountAndRead(webinar(""));
    expect(html).toContain("<b>");
    expect(html).toContain("라이브 시작 · 사전 등록 후 입장 안내를 보내드려요");
  });
});

describe("note 를 쓰면 — 그 줄 전체가 그 문구로, 자동 날짜 접두 없음", () => {
  it("<b> 태그(자동 날짜) 없이 note 문구만 나간다", () => {
    const html = mountAndRead(webinar("곧 안내 메일을 보내드려요!"));
    expect(html).not.toContain("<b>");
    expect(html).toContain("곧 안내 메일을 보내드려요!");
    expect(html).not.toContain("라이브 시작 · 사전 등록 후 입장 안내를 보내드려요");
  });

  it("날짜를 직접 포함해 쓰면 그 글자 그대로 나간다(운영자가 전부 정한다)", () => {
    const html = mountAndRead(webinar("11/24(화) 2시 시작 — 늦지 마세요!"));
    expect(html).toContain("11/24(화) 2시 시작 — 늦지 마세요!");
    expect(html).not.toContain("<b>");
  });
});
