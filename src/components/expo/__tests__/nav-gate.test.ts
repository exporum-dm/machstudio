// @vitest-environment node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { filterNavItems, navItems } from "@/components/layout/sidebar";

const ROOT = resolve(__dirname, "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * 홈페이지 메뉴의 **게이트**.
 *
 * ── 왜 사이드바를 통째로 렌더하지 않나 ───────────────────────────────
 * `sidebar.tsx` 는 650줄이고 supabase·워크스페이스 문맥·모달 다섯 개·framer-motion 을
 * 끌어온다. 그걸 다 목으로 세우면 테스트가 **사이드바에 모달이 하나 추가될 때마다**
 * 깨진다 — 정작 지키려는 규칙과 무관한 이유로.
 *
 * 그래서 규칙 자체를 순수 함수로 빼내 직접 확인하고, 배선(누가 그 값을 주는가)은
 * 소스에 대한 정적 검사로 못 박는다. 둘을 합치면 플랜이 요구한 세 가지가 다 덮인다:
 * 숨김·빈 항목 없음·클라이언트 조회 없음.
 */

describe("메뉴 필터", () => {
  it("준비 전에는 홈페이지 항목이 아예 없다", () => {
    const visible = filterNavItems(navItems, { expoHomepageEnabled: false });
    expect(visible.some((item) => item.href === "/homepage")).toBe(false);
  });

  it("준비되면 나타난다", () => {
    const visible = filterNavItems(navItems, { expoHomepageEnabled: true });
    expect(visible.some((item) => item.href === "/homepage")).toBe(true);
  });

  /**
   * 눌렀는데 아무 일도 안 일어나는 메뉴는 고장으로 읽힌다. 그래서 disabled 항목을
   * 남기는 게 아니라 **개수가 줄어야** 한다.
   */
  it("숨길 때 빈 항목을 남기지 않는다", () => {
    const off = filterNavItems(navItems, { expoHomepageEnabled: false });
    const on = filterNavItems(navItems, { expoHomepageEnabled: true });
    expect(on.length).toBe(off.length + 1);
    for (const item of off) expect(item.href).not.toBe("/homepage");
  });

  it("다른 메뉴는 게이트에 걸리지 않는다", () => {
    const off = filterNavItems(navItems, { expoHomepageEnabled: false });
    for (const href of ["/dashboard", "/collect", "/analytics", "/tools", "/worklog", "/webinar", "/competition"]) {
      expect(`${href}: ${off.some((item) => item.href === href)}`).toBe(`${href}: true`);
    }
  });

  it("게이트가 걸린 항목은 홈페이지 하나뿐이다", () => {
    expect(navItems.filter((item) => item.capability).map((item) => item.href)).toEqual(["/homepage"]);
  });
});

describe("누가 그 값을 주는가", () => {
  const layout = read("src/app/(app)/layout.tsx");

  /**
   * 이게 없으면 Next 가 레이아웃을 빌드 결과에 굳힌다 — 스키마를 적용하고 플래그를
   * 켠 뒤에도 메뉴가 안 나타나고, 반대로 껐는데 남아 있을 수도 있다.
   */
  it("레이아웃이 요청마다 판정한다", () => {
    expect(layout).toContain('export const dynamic = "force-dynamic"');
  });

  it("서버 능력을 기다려 prop 으로 내린다", () => {
    expect(layout).toContain("getExpoCapabilities");
    expect(layout).toMatch(/expoHomepageEnabled=\{caps\.admin\}/);
  });

  /** 아직 공개 전인 기능의 존재를 브라우저에 알릴 이유가 없다. */
  it("NEXT_PUBLIC 플래그를 만들지 않는다", () => {
    expect(layout).not.toContain("NEXT_PUBLIC_EXPO");
  });

  it("사이드바가 준비 상태를 스스로 조회하지 않는다", () => {
    const sidebar = read("src/components/layout/sidebar.tsx");
    expect(sidebar).not.toContain("/api/expo");
    expect(sidebar).not.toContain("probeExpoSchema");
    expect(sidebar).not.toContain("getExpoCapabilities");
  });
});

describe("화면도 자기 게이트를 갖는다", () => {
  const homepageLayout = read("src/app/(app)/homepage/layout.tsx");

  /**
   * 메뉴를 숨기는 것은 **인가가 아니다.** 주소를 직접 치면 그대로 들어오고, 스키마가
   * 없는 배포에서 그 아래 화면이 렌더되면 Expo 델리게이트를 부르는 순간 500 이 된다.
   */
  it("홈페이지 레이아웃이 서버에서 다시 확인한다", () => {
    expect(homepageLayout).toContain("getExpoCapabilities");
    expect(homepageLayout).toContain("notFound()");
    expect(homepageLayout).toContain('export const dynamic = "force-dynamic"');
  });

  /**
   * 준비 안 됐을 때 **404** 다. `notFound()` 가 그것이고, 503("그 기능이 존재한다")을
   * 쓰지 않는다 — 공개 전에는 그 사실조차 밖으로 나갈 이유가 없다.
   * (문구를 검사하지 않는다. 주석에 숫자가 나오는 것과 응답 코드는 다른 것이다.)
   */
});
