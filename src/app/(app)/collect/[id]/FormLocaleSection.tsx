"use client";

/**
 * "기본 정보" 탭의 폼 언어 — 방문자에게 보이는 기본 문구(버튼·안내·오류·동의 기본 문구)의 언어(2026-11-03).
 *
 * formConfig.defaultLocale 은 이 영역이 **혼자 소유한다** — 등록 시간과 같은 규칙. 저장은 `formLocale` 한 키만
 * 보내고, 폼 빌더 자동저장(formConfig 통째)은 이 값을 건드리지 않는다(PATCH /api/collect-sources/[id]).
 * 운영자가 적은 항목 이름·선택지는 번역하지 않는다 — 적은 그대로 나간다.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FIELD_CLS } from "@/components/ui/primitives";
import { FORM_LOCALES, isFormLocale, normalizeCollectForm, type FormLocale } from "@/lib/collect-form-config";

export default function FormLocaleSection({ sourceId, formConfig, onSaved }: {
  sourceId: string;
  formConfig: unknown;
  onSaved?: (formConfig: unknown) => void;
}) {
  const saved = normalizeCollectForm(formConfig).defaultLocale;
  const [value, setValue] = useState<FormLocale>(isFormLocale(saved) ? saved : "en");
  const [saving, setSaving] = useState(false);

  const change = async (next: FormLocale) => {
    const prev = value;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formLocale: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setValue(prev); toast.error(data?.error ?? "언어를 바꾸지 못했어요"); return; }
      if (data?.source) onSaved?.(data.source.formConfig);
    } catch {
      setValue(prev);
      toast.error("연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">폼 언어</h3>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="저장 중" />}
      </div>
      <p className="text-xs text-muted-foreground">
        등록하기 버튼·마감 안내·오류 메시지·동의 기본 문구 같은 <b className="font-medium text-foreground">기본 문구</b>의 언어예요.
        직접 적은 항목 이름·선택지·안내는 적은 그대로 나가요.
      </p>
      <div className="w-full max-w-xs">
        <select value={value} onChange={(e) => { if (isFormLocale(e.target.value)) void change(e.target.value); }} aria-label="폼 언어" className={`${FIELD_CLS} h-9`}>
          {FORM_LOCALES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </div>
    </section>
  );
}
