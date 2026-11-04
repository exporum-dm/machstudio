import { collectColumnsFor } from "@/lib/collect-columns";
import { localize, normalizeCollectForm } from "@/lib/collect-form-config";

/** 연동형의 원본 매핑은 그대로 두고, 분석에만 선택지·문항 사용 여부를 적용한다. */
export function collectAnalysisColumnsFor(source: Parameters<typeof collectColumnsFor>[0]) {
  const columns = collectColumnsFor(source);
  if (source.mode === "builder") return columns;
  const config = normalizeCollectForm(source.formConfig);
  const fields = new Map(config.fields.map((field) => [field.key, field]));
  return columns.filter((column) => fields.get(column.key)?.enabled !== false).map((column) => {
    const field = fields.get(column.key);
    return field ? {
      ...column,
      type: field.type,
      options: field.options.map((option) => localize(option, config.defaultLocale)).filter(Boolean),
    } : column;
  });
}
