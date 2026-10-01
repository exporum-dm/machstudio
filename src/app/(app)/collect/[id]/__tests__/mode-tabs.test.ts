import { describe, expect, it } from "vitest";
import { tabsFor } from "../tabs";

/**
 * 방식별 탭 구성 — 설계 §3.1 "소스 상세 화면도 방식에 따라 갈린다".
 *
 * 여기서 지키는 가장 중요한 것은 **연동형이 하나도 안 바뀌는 것**이다. 이미 3개 소스가
 * 레코드 52,000건을 이 화면으로 운영 중이라, 탭이 하나라도 사라지면 그게 곧 사고다.
 */
describe("tabsFor", () => {
  const ids = (mode: string) => tabsFor(mode).map((t) => t.id);

  it("연동형은 기존 탭 구성 그대로 — 등록 폼 탭만 안 보인다", () => {
    expect(ids("capture")).toEqual(["info", "records", "fields", "script", "install", "settings", "data-mgmt", "activity"]);
  });

  it("빌더형은 스크립트·필드 매핑·설치 대신 등록 폼 · 현장 체크인", () => {
    expect(ids("builder")).toEqual(["info", "records", "form", "checkin", "settings", "data-mgmt", "activity"]);
  });

  /** mode 는 DB 에서 제약 없는 String 이다 — 모르는 값이 오면 기존 동작으로 떨어져야 한다. */
  it("모르는 방식은 연동형으로 — 화면이 비지 않는다", () => {
    expect(ids("")).toEqual(ids("capture"));
    expect(ids("bulider")).toEqual(ids("capture"));
  });

  it("두 방식 모두 수집 데이터·설정·활동은 항상 있다", () => {
    for (const mode of ["capture", "builder"]) {
      for (const must of ["records", "settings", "activity"]) expect(ids(mode)).toContain(must);
    }
  });
});
