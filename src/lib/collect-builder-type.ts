import { normalizeCollectForm, type CollectField } from "@/lib/collect-form-config";

export function collectBuilderLabel(mode: string, config: unknown) {
  return mode !== "builder" ? "연동형" : normalizeCollectForm(config).builderVariant === "domestic"
    ? "빌더형 2 · 국내형 · 시스포유 협업" : "빌더형 1 · 국외형 · 무료";
}
export function createDomesticFormConfig() {
  const field = (key: string, label: string, type: CollectField["type"] = "text"): CollectField => ({ id: key, key, label: {ko:label}, type, placeholder:{}, required:true, enabled:true, options:[] });
  return normalizeCollectForm({
    builderVariant:"domestic", registrationPrefix:"90", defaultLocale:"ko",
    fields: [field("name","이름"), field("email","이메일","email"), field("phone","휴대전화","tel"), {...field("visitor_type", "등록 유형", "select"), options:[{ko:"일반 사전등록"},{ko:"바이어"}]} ],
    branch: {enabled:true, fieldKey:"visitor_type", groups:[{value:"일반 사전등록",fields:[]},{value:"바이어",fields:[field("company","회사·기관명"),field("job_title","직책")]}]},
    validation: {defaultCountry:"KR", onDuplicate:"block"},
  });
}
