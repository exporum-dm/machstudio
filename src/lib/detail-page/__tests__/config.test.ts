import { describe, expect, it } from "vitest";
import {
  detailPageNoticeCompetition,
  initialDetailPageConfig,
  isSafeLinkUrl,
  normalizeDetailPageSettings,
} from "@/lib/detail-page/config";
import { normalizeNoticePageConfig } from "@/lib/notice/config";
import { buildNoticeModel } from "@/lib/notice/build-model";

const settings = (page: Record<string, unknown>) => normalizeDetailPageSettings({ page });
const competitionOf = (ctaUrl: string) =>
  detailPageNoticeCompetition({ id: "p1", name: "바이어 상담회", theme: { accentColor: "#ff6a3d" }, settings: settings({ ctaUrl }) });

describe("상세페이지 주 버튼 링크", () => {
  it("http(s)·같은 사이트 경로만 링크로 내보낸다", () => {
    expect(isSafeLinkUrl("https://k-expo.org/register")).toBe(true);
    expect(isSafeLinkUrl("/register")).toBe(true);
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("//evil.example.com")).toBe(false);
    expect(isSafeLinkUrl("")).toBe(false);
  });

  it("링크가 있으면 버튼이 그 주소로 가는 링크가 된다", () => {
    const np = normalizeNoticePageConfig(initialDetailPageConfig("바이어 상담회"));
    const m = buildNoticeModel(competitionOf("https://k-expo.org/register"), np, { uid: "t", embedded: true, isPreview: false });
    expect(m.ctaVisible).toBe(true);
    expect(m.ctaLink).toEqual({ href: "https://k-expo.org/register", newTab: false });
  });

  it("링크가 없거나 안전하지 않으면 버튼을 그리지 않는다", () => {
    const np = normalizeNoticePageConfig(initialDetailPageConfig("바이어 상담회"));
    for (const url of ["", "javascript:alert(1)"]) {
      const m = buildNoticeModel(competitionOf(url), np, { uid: "t", embedded: true, isPreview: false });
      expect(m.ctaVisible).toBe(false);
    }
  });

  it("대회 공고(cta 없음)는 예전처럼 신청 버튼이다", () => {
    const np = normalizeNoticePageConfig({});
    const { cta: _cta, ...competition } = competitionOf("");
    const m = buildNoticeModel(competition, np, { uid: "t", embedded: true, isPreview: false });
    expect(m.ctaVisible).toBe(true);
    expect(m.ctaLink).toBeNull();
  });
});

describe("상세페이지 설정 정규화", () => {
  it("마감 시각은 ISO 로 맞추고, 틀린 값은 버린다", () => {
    expect(settings({ deadline: "2026-12-31T23:59:00+09:00" }).deadline).toBe("2026-12-31T14:59:00.000Z");
    expect(settings({ deadline: "아무 말" }).deadline).toBeNull();
  });

  it("새 페이지는 공개 상태, 제목 첫 줄은 이름, 선발·심사는 직접 입력으로 시작한다", () => {
    const np = normalizeNoticePageConfig(initialDetailPageConfig("바이어 상담회"));
    expect(np.enabled).toBe(true);
    expect(np.hero.titleLines).toEqual(["바이어 상담회"]);
    expect(np.selection.source).toBe("manual");
    expect(np.criteria.source).toBe("manual");
  });
});
