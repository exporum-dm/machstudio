import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 계층 고정 — 워크스페이스 → 프로젝트(전시) → 메뉴.
 *
 * 사용자는 사이드바에서 워크스페이스와 프로젝트를 고른 뒤 메뉴를 연다. 그래서 메뉴 화면은
 * 프로젝트를 다시 고르게 하지 않고, 경로에도 프로젝트 id가 들어가지 않는다. `(app)` 안의
 * 동적 구간 `[id]` 는 **그 메뉴가 만든 자원**(등록 폼·웨비나·대회·광고 폴더)이어야 한다.
 *
 * 2026-11-24에 크리에이터 관리가 `/creators` 에 프로젝트 목록을 띄우고 `/creators/[projectId]`
 * 로 들어가게 만들어 이 계층을 어겼다. 다음 메뉴에서 되풀이되지 않게 여기서 막는다.
 *
 * 프로젝트를 넘나드는 화면(요약 대시보드)은 경로에 프로젝트를 끼우지 않으니 여기 걸리지 않는다.
 */
const APP_DIR = join(process.cwd(), "src", "app", "(app)");

function dynamicSegments(dir: string, trail: string[] = []): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const here = [...trail, entry.name];
      const deeper = dynamicSegments(join(dir, entry.name), here);
      return entry.name.startsWith("[") ? [here.join("/"), ...deeper] : deeper;
    });
}

describe("메뉴 경로 계층", () => {
  it("(app) 경로에 프로젝트를 고르는 동적 구간이 없다", () => {
    const offenders = dynamicSegments(APP_DIR).filter((route) =>
      /^\[\.{0,3}project/i.test(route.split("/").pop() ?? ""),
    );

    expect(
      offenders,
      "메뉴는 사이드바에서 고른 currentProject 를 쓴다 — 경로에 프로젝트 id를 끼우지 않는다. AGENTS.md「이 앱의 계층」",
    ).toEqual([]);
  });

  it("동적 구간이 하나도 없는 트리에서도 조용히 통과한다", () => {
    expect(dynamicSegments(join(APP_DIR, "creators"))).toEqual([]);
  });
});
