import { describe, expect, it } from "vitest";
import { NOTICE_SECTIONS, normalizeNoticePageConfig, parseNoticeVideo } from "@/lib/notice/config";
import { buildNoticeModel } from "@/lib/notice/build-model";
import { detailPageNoticeCompetition, isSafeLinkUrl, normalizeDetailPageSettings } from "@/lib/detail-page/config";

const IMG = "https://example.com/a.jpg";
const competition = (formOrigin: string | null = null) =>
  detailPageNoticeCompetition({ id: "p", name: "Class", theme: {}, settings: normalizeDetailPageSettings({}), formOrigin });
const model = (noticePage: Record<string, unknown>, opts: { isPreview?: boolean; formOrigin?: string | null } = {}) =>
  buildNoticeModel(competition(opts.formOrigin ?? null), normalizeNoticePageConfig({ noticePage }), {
    uid: "t",
    embedded: true,
    isPreview: opts.isPreview ?? false,
  });

/** 아임웹으로 손수 만들던 행사 상세를 빌더로 옮기려고 들어온 섹션들(2026-10-07). */
describe("상세페이지 섹션 — 사진 배너·사진+글·영상·신청 폼", () => {
  it("사진 배너는 사진만 넣어도, 큰 문구만 써도 나온다", () => {
    expect(model({ banner: { enabled: true }, sectionMedia: { banner: { url: IMG } } }).show.banner).toBe(true);
    expect(model({ banner: { enabled: true, title: "SEE WHAT IT FEELS LIKE." } }).show.banner).toBe(true);
    expect(model({ banner: { enabled: true } }).show.banner).toBe(false);
  });

  it("사진 + 글은 사진과 글이 둘 다 있어야 나온다", () => {
    expect(model({ split: { enabled: true, title: "FEEL IT", image: { url: IMG } } }).show.split).toBe(true);
    expect(model({ split: { enabled: true, title: "FEEL IT" } }).show.split).toBe(false);
    expect(model({ split: { enabled: true, image: { url: IMG } } }).show.split).toBe(false);
  });

  it("영상은 유튜브만 받고, 쇼츠는 세로로 그린다", () => {
    expect(parseNoticeVideo("https://youtu.be/aqz-KE-bpKQ")).toEqual({
      embedUrl: "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?rel=0&playsinline=1",
      vertical: false,
    });
    expect(parseNoticeVideo("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=3")?.vertical).toBe(false);
    expect(parseNoticeVideo("https://youtube.com/shorts/aqz-KE-bpKQ")?.vertical).toBe(true);
    expect(parseNoticeVideo("https://example.com/video.mp4")).toBeNull();
    expect(parseNoticeVideo("javascript:alert(1)")).toBeNull();
  });

  it("신청 폼은 실제 페이지에선 machstudio 주소가 있어야, 미리보기에선 폼만 골라도 나온다", () => {
    const form = { form: { enabled: true, sourceId: "cmharnessform0000000000" } };
    expect(model(form).show.form).toBe(false); // 대회 공고처럼 주소가 없는 경우
    expect(model(form, { formOrigin: "https://machstudio.vercel.app" }).show.form).toBe(true);
    expect(model(form, { isPreview: true }).show.form).toBe(true);
    // 외부 페이지 속성·스크립트 주소에 들어가는 값이라 형식이 틀리면 버린다
    expect(normalizeNoticePageConfig({ noticePage: { form: { sourceId: '"><script>' } } }).form.sourceId).toBe("");
  });

  it("주 버튼은 #form 으로 같은 페이지의 섹션을 가리킬 수 있다", () => {
    expect(isSafeLinkUrl("#form")).toBe(true);
    expect(isSafeLinkUrl("#javascript:alert(1)")).toBe(false);
  });
});

describe("섹션 순서", () => {
  it("저장된 순서를 따르고, 빠진 섹션은 끝에 한 번씩 붙는다", () => {
    const np = normalizeNoticePageConfig({ noticePage: { order: ["faq", "banner", "faq", "nope"] } });
    expect(np.order.slice(0, 2)).toEqual(["faq", "banner"]);
    expect(new Set(np.order).size).toBe(NOTICE_SECTIONS.length);
    expect(np.order).toHaveLength(NOTICE_SECTIONS.length);
  });

  it("목차도 그 순서를 따른다", () => {
    const m = model({
      order: ["faq", "concept"],
      concept: { enabled: true, headline: "Hi" },
      faq: { enabled: true, items: [{ question: "Q", answer: "A" }] },
    });
    expect(m.tocItems.map((item) => item.id)).toEqual(["nt-faq", "nt-concept"]);
  });

  it("순서를 안 정한 기존 공고는 예전 순서 그대로다", () => {
    expect(normalizeNoticePageConfig({}).order).toEqual(NOTICE_SECTIONS.map((s) => s.key));
  });
});
