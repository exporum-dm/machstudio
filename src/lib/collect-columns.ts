/**
 * 수집 데이터 화면의 **열 목록**을 한 곳에서 만든다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────
 * 표 헤더·셀·CSV·상세 패널·모달이 전부 `source.fieldMappings` 에서 열을 얻는다. 그런데
 * 그 테이블은 **연동형 전용**이다 — 외부 폼에서 발견한 필드를 운영자가 '필드' 탭에서
 * 매핑해 채우는데, 빌더형에는 그 탭 자체가 없다(tabs.ts 의 CAPTURE_ONLY).
 *
 * 그래서 빌더형 소스는 fieldMappings 가 **영원히 0건**이고, 등록이 아무리 쌓여도 표에는
 * '시간' 과 UTM 열만 보인다. 9/1 오픈 후 5,000명이 등록하고 나서야 드러나는 종류의 사고다.
 *
 * 해결은 **읽는 자리에서 파생**시키는 것이다. formConfig 가 이미 열의 단일 출처이므로
 * 그걸 fieldMappings 모양으로 옮겨 주면, 소비처 스무 곳을 하나도 건드리지 않고 동작한다.
 * (역으로 저장하는 방식 — 빌더 저장 때 FieldMapping 행을 만드는 것 — 은 같은 정보를 두
 *  곳에 두는 일이라 반드시 갈라진다. 항목 하나를 지우면 두 곳을 맞춰야 한다.)
 */
import { normalizeCollectForm, localize } from "@/lib/collect-form-config";

/** 표·CSV 가 기대하는 열 한 개. FieldMapping 행과 같은 모양이다. */
export interface CollectColumn {
  id: string;
  index: number;
  key: string;
  label: string;
  type: string;
  /** 빌더 선택지 원문. 쉼표가 포함된 선택지를 응답 집계에서 안전하게 복원할 때 쓴다. */
  options?: string[];
  isRequired: boolean;
  /** 프로젝트 대시보드에 값 분포 카드로 보일지. 빌더형 파생 열은 항상 true(§ 아래 push). */
  showInDashboard: boolean;
  sortOrder: number;
}

/**
 * 동의 기록이 저장되는 예약 키(제출 라우트가 붙인다).
 * **열로 보여야 한다** — 개인정보·마케팅 동의는 법적 증빙이고, 목록에서 안 보이면
 * 리타겟 대상을 고를 때 동의자를 가려낼 수 없다.
 */
const CONSENT_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "__consent_privacy", label: "개인정보 동의" },
  { key: "__consent_marketing", label: "마케팅 동의" },
];

/**
 * 이 소스의 열 목록.
 *
 * 연동형은 저장된 fieldMappings 를 그대로 쓴다 — 기존 소스 3개가 레코드 52,000건을 그
 * 화면으로 운영 중이라 **한 글자도 바뀌면 안 된다.**
 */
export function collectColumnsFor(source: {
  mode: string;
  formConfig?: unknown;
  fieldMappings?: CollectColumn[] | null;
}): CollectColumn[] {
  if (source.mode !== "builder") return source.fieldMappings ?? [];

  const config = normalizeCollectForm(source.formConfig);

  /**
   * 분기 그룹 항목까지 포함해야 한다 — Buyer 로 등록한 사람의 회사명이 열에 없으면
   * 그 응답은 저장돼 있는데 **화면에서 영영 안 보인다.** visibleFields 는 값이 있어야
   * 그룹을 펴므로, 여기서는 정의된 모든 그룹을 직접 이어 붙인다.
   */
  const seen = new Set<string>();
  const out: CollectColumn[] = [];
  const push = (key: string, label: string, type: string, required: boolean, showInDashboard = true, options: string[] = []) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      // id 는 React key 와 정렬 버튼에만 쓰인다 — 저장 키가 곧 안정적인 식별자다.
      id: `bc:${key}`,
      index: out.length,
      key,
      label: label || key,
      type,
      options,
      isRequired: required,
      showInDashboard,
      sortOrder: out.length,
    });
  };

  for (const f of config.fields) {
    if (!f.enabled) continue;
    push(f.key, localize(f.label, config.defaultLocale), f.type, f.required, f.showInDashboard !== false, f.options.map((option) => localize(option, config.defaultLocale)).filter(Boolean));
    // 분기 기준 항목 **바로 뒤에** 그 그룹 문항을 넣는다 — 폼에서 보이던 순서 그대로다.
    if (config.branch.enabled && config.branch.fieldKey === f.key) {
      for (const g of config.branch.groups) {
        for (const gf of g.fields) {
          if (!gf.enabled) continue;
          push(gf.key, localize(gf.label, config.defaultLocale), gf.type, false, gf.showInDashboard !== false, gf.options.map((option) => localize(option, config.defaultLocale)).filter(Boolean));
        }
      }
    }
  }

  // 필수 동의로 승격된 안내 블록 — 체크 여부가 data 에 저장되므로 열로도 보여야 한다.
  for (const n of config.notices) {
    if (!n.enabled || n.mode === "notice") continue;
    const title = localize(n.title, config.defaultLocale);
    push(`notice_${n.id}`, title ? `${title} 동의` : "안내 동의", "checkbox", n.mode === "checkbox-required", false);
  }

  for (const c of CONSENT_COLUMNS) push(c.key, c.label, "checkbox", false, false);

  return out;
}

/** 빌더형인가 — 등록번호처럼 빌더형에만 있는 열을 붙일지 판정할 때 쓴다. */
export function isBuilderSource(source: { mode: string }): boolean {
  return source.mode === "builder";
}

/**
 * 셀·상세·CSV 에 찍을 글자. 빌더형 폼은 체크박스·동의를 **불리언**으로 저장하는데(true/false),
 * React 는 불리언을 화면에 아무것도 그리지 않아 "체크했는데 빈칸" 으로 보였다(2026-10-01 현장 피드백).
 * 값 자체는 그대로 두고 **보여 줄 때만** 글자로 바꾼다 — 대시보드·필터는 원래 값을 본다.
 */
export function formatCollectValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (Array.isArray(value)) return value.map(formatCollectValue).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
