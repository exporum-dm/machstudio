import { describe, expect, it } from "vitest";
import { collectColumnsFor, formatCollectValue, isBuilderSource } from "@/lib/collect-columns";

/**
 * 표·CSV 의 열 목록.
 *
 * 여기서 지키는 가장 중요한 것은 **연동형이 하나도 안 바뀌는 것**이다 — 기존 소스 3개가
 * 레코드 52,000건을 그 화면으로 운영 중이다. 그 다음이 "빌더형 응답이 화면에서 사라지지
 * 않는 것" 이고, 그게 이 모듈을 만든 이유다.
 */

const CAPTURE_MAPPINGS = [
  { id: "m1", index: 0, key: "name", label: "이름", type: "text", isRequired: true, showInDashboard: true, sortOrder: 0 },
  { id: "m2", index: 1, key: "email", label: "메일", type: "email", isRequired: true, showInDashboard: true, sortOrder: 1 },
];

const FORM_CONFIG = {
  fields: [
    { id: "f1", key: "first_name", label: { en: "First name" }, type: "text", required: true, enabled: true },
    { id: "f2", key: "email", label: { en: "Email" }, type: "email", required: true, enabled: true, showInDashboard: false },
    { id: "f3", key: "hidden_one", label: { en: "Hidden" }, type: "text", enabled: false },
    {
      id: "f4", key: "visitor_type", label: { en: "Visitor type" }, type: "select", enabled: true,
      options: [{ en: "General" }, { en: "Buyer" }],
    },
    { id: "f5", key: "note", label: { en: "Note" }, type: "text", enabled: true },
  ],
  branch: {
    enabled: true, fieldKey: "visitor_type",
    groups: [{ value: "Buyer", fields: [{ id: "b1", key: "company", label: { en: "Company" }, type: "text", required: true, enabled: true }] }],
  },
  notices: [
    { id: "portrait", enabled: true, placement: "above-consent", mode: "checkbox-required", title: { en: "Photo" }, body: { en: "…" } },
    { id: "plain", enabled: true, placement: "top", mode: "notice", body: { en: "just a notice" } },
  ],
  consent: { privacy: { enabled: true }, marketing: { enabled: true } },
  defaultLocale: "en",
};

const keys = (src: Parameters<typeof collectColumnsFor>[0]) => collectColumnsFor(src).map((c) => c.key);

describe("연동형", () => {
  /** 이 한 줄이 깨지면 운영 중인 소스 3개의 화면이 같이 깨진다. */
  it("저장된 fieldMappings 를 그대로 통과시킨다", () => {
    const cols = collectColumnsFor({ mode: "capture", fieldMappings: CAPTURE_MAPPINGS });
    expect(cols).toBe(CAPTURE_MAPPINGS);
  });

  it("formConfig 가 있어도 무시한다 — 연동형의 출처는 매핑 테이블이다", () => {
    const cols = collectColumnsFor({ mode: "capture", fieldMappings: CAPTURE_MAPPINGS, formConfig: FORM_CONFIG });
    expect(cols.map((c) => c.key)).toEqual(["name", "email"]);
  });

  it("모르는 방식은 연동형으로 떨어진다 — mode 는 제약 없는 String 이다", () => {
    expect(keys({ mode: "bulider", fieldMappings: CAPTURE_MAPPINGS })).toEqual(["name", "email"]);
    expect(keys({ mode: "capture", fieldMappings: null })).toEqual([]);
  });
});

describe("빌더형", () => {
  const src = { mode: "builder", formConfig: FORM_CONFIG, fieldMappings: [] };

  it("항목이 폼 순서대로 열이 된다", () => {
    expect(keys(src).slice(0, 3)).toEqual(["first_name", "email", "visitor_type"]);
  });

  /**
   * **이게 이 모듈을 만든 이유다.** 빌더형은 fieldMappings 가 영원히 0건이라, 파생하지
   * 않으면 등록이 아무리 쌓여도 표에 '시간' 과 UTM 열만 보인다.
   */
  it("fieldMappings 가 비어 있어도 열이 나온다", () => {
    expect(keys(src).length).toBeGreaterThan(3);
  });

  /** 분기 그룹 응답이 열에 없으면 저장돼 있는데 화면에서 영영 안 보인다. */
  it("분기 그룹 항목이 기준 항목 바로 뒤에 들어간다", () => {
    const k = keys(src);
    expect(k.indexOf("company")).toBe(k.indexOf("visitor_type") + 1);
  });

  it("표시 끈 항목은 열이 되지 않는다", () => {
    expect(keys(src)).not.toContain("hidden_one");
  });

  it("빌더 항목별 대시보드 통계 설정을 열 정보에 보존한다", () => {
    const columns = collectColumnsFor(src);
    expect(columns.find((column) => column.key === "first_name")?.showInDashboard).toBe(true);
    expect(columns.find((column) => column.key === "email")?.showInDashboard).toBe(false);
  });

  it("정확한 대시보드 집계를 위해 쉼표가 든 선택지를 보존한다", () => {
    const columns = collectColumnsFor({
      mode: "builder",
      formConfig: {
        defaultLocale: "en",
        fields: [{ id: "visit", key: "visit", label: { en: "Visit" }, type: "multiple", enabled: true, options: [{ en: "Oct 24, 2026" }] }],
      },
    });
    expect(columns[0].options).toEqual(["Oct 24, 2026"]);
  });

  /** 동의는 법적 증빙이다 — 목록에서 안 보이면 리타겟 대상에서 동의자를 가려낼 수 없다. */
  it("동의 기록이 열로 나온다", () => {
    const k = keys(src);
    expect(k).toContain("__consent_privacy");
    expect(k).toContain("__consent_marketing");
  });

  /** 필수 동의로 승격된 안내는 체크 여부가 저장되므로 열이어야 한다. 단순 안내는 아니다. */
  it("체크박스 안내만 열이 된다", () => {
    const k = keys(src);
    expect(k).toContain("notice_portrait");
    expect(k).not.toContain("notice_plain");
  });

  it("키가 겹쳐도 열이 중복되지 않는다", () => {
    const dup = {
      mode: "builder",
      formConfig: {
        ...FORM_CONFIG,
        branch: {
          enabled: true, fieldKey: "visitor_type",
          // 그룹 항목이 공통 항목과 같은 key 를 쓰는 경우 — 정규화가 허용하는 모양이다.
          groups: [{ value: "Buyer", fields: [{ id: "b2", key: "note", label: { en: "Note" }, type: "text", enabled: true }] }],
        },
      },
    };
    const k = keys(dup);
    expect(k.filter((x) => x === "note")).toHaveLength(1);
  });

  it("빈 formConfig 여도 동의 열은 남는다 — 폼이 비어도 표가 통째로 비지는 않는다", () => {
    expect(keys({ mode: "builder", formConfig: null })).toEqual(["__consent_privacy", "__consent_marketing"]);
  });

  it("라벨이 없으면 key 를 라벨로 쓴다 — 빈 헤더는 고장으로 보인다", () => {
    const noLabel = { mode: "builder", formConfig: { fields: [{ id: "a", key: "x", type: "text", enabled: true }] } };
    expect(collectColumnsFor(noLabel)[0].label).toBe("x");
  });
});

describe("isBuilderSource", () => {
  it("빌더형만 true", () => {
    expect(isBuilderSource({ mode: "builder" })).toBe(true);
    expect(isBuilderSource({ mode: "capture" })).toBe(false);
    expect(isBuilderSource({ mode: "" })).toBe(false);
  });
});

describe("formatCollectValue — 화면·CSV 에 찍을 글자", () => {
  /** 체크박스·동의는 불리언으로 저장된다. React 는 불리언을 그리지 않아 "체크했는데 빈칸" 이 됐다. */
  it("불리언은 TRUE / FALSE", () => {
    expect(formatCollectValue(true)).toBe("TRUE");
    expect(formatCollectValue(false)).toBe("FALSE");
  });

  it("빈 값은 빈 문자열, 배열은 쉼표로, 숫자는 그대로", () => {
    expect(formatCollectValue(null)).toBe("");
    expect(formatCollectValue(undefined)).toBe("");
    expect(formatCollectValue(["A", "B"])).toBe("A, B");
    expect(formatCollectValue(3)).toBe("3");
    expect(formatCollectValue("Male")).toBe("Male");
  });
});
