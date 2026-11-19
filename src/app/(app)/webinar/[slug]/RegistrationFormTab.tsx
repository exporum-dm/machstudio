"use client";

import { useId, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { motion } from "framer-motion";
// Trash2·GripVertical 은 골격(EditableList)이 핸들·삭제를 대신 그리면서 쓸 곳이 없어졌다.
import { Plus, Smartphone, SquareCheck, ChevronDown, Languages, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAutosave } from "@/components/ui/use-autosave";
import { useReportAutosave } from "@/components/ui/autosave-scope";
import { SignupDeadlineField } from "@/components/webinar/WebinarSchedulePicker";
import { kstDateTimeLocalInput, kstDateTimeLocalToIso } from "@/lib/datetime";
import { resolveConsentBody, consentSourceLabel } from "@/lib/consent-template";
import { Switch } from "@/components/ui/switch";
import { FIELD_CLS, FIELD_CLS_DANGER, FINISH, R } from "@/components/ui/primitives";
import { OptionRows } from "@/components/ui/option-rows";
import { CHOICE_TYPES, REG_TYPE_META, RegTypeMenu, useRegPopover } from "@/components/form-builder/field-types";
import { maxSelectFor } from "@/lib/webinar-config";
import { EditableList } from "@/components/ui/editable-list";
import {
  applyWebinarFormLocale,
  normalizeRegistrationForm,
  safeHttpUrl,
  webinarFormEditableLocales,
  webinarFormTranslatedLocales,
  type WebinarFormI18n,
  type WebinarLinkCtaConfig,
  type WebinarRegistrationField,
  type WebinarRegistrationFormConfig,
} from "@/lib/webinar-config";
import {
  dropWebinarFormLocale,
  retagWebinarFormLocale,
  webinarFormLocaleMismatch,
  webinarTranslationEntries,
} from "@/lib/webinar-form-i18n";
import { TranslationTable } from "@/components/form-builder/TranslationTable";
import { FORM_LOCALES, formLocaleLabel } from "@/lib/form-locale";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { btnCls } from "@/components/ui/primitives";
import { buildStkCss } from "@/app/webinar/[slug]/LiveContentStk";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

type FieldType = WebinarRegistrationField["type"];
export type RegistrationField = WebinarRegistrationField;

interface Webinar {
  id: string;
  slug?: string;
  config: Record<string, unknown>;
  theme?: Record<string, string>;
  /** 접수 창 계산의 기준 — 마감 프리셋(시작 시점/하루 전)이 이 값에 상대적이다. */
  liveStartAt: string;
  /** 마감 ≤ 종료 사전 검증용 — 없으면(호출부가 아직 안 넘기면) 그 검증만 건너뛴다. */
  liveEndAt?: string;
  signupDeadline: string;
  components?: Record<string, unknown> | null;
  /** 약관 전문 템플릿 — 이 웨비나가 비워 두면 상속한다(IA 8단계). */
  workspace?: { privacyBodyTemplate?: string | null; marketingBodyTemplate?: string | null } | null;
}

const inputCls = FIELD_CLS;
// 항목 형식 메타 — 설문 문항 타입 칩과 같은 결(아이콘+라벨)
// 필드 카드 — 설문 문항 카드(QuestionRow)와 동일한 결: 헤더에 타입 칩, 본문에 라벨·옵션.
function FieldCard({
  field,
  setFields,
  handle,
  removeButton,
}: {
  field: RegistrationField;
  setFields: Dispatch<SetStateAction<RegistrationField[]>>;
  /** 골격이 만든 드래그 핸들 — dnd-kit 배선(포인터+방향키)이 이미 붙어 있다. */
  handle: ReactNode | null;
  /** 골격이 만든 삭제 컨트롤. removable 이 false 면 null 을 준다(기본 필드). */
  removeButton: (opts?: { label?: string; onClick?: () => void }) => ReactNode | null;
}) {
  // 반환 객체를 통째로 들고 있으면 컴파일러가 ref 를 품은 객체로 보고 렌더 중 접근을 막는다(react-hooks/refs).
  const { open: typeOpen, setOpen: setTypeOpen, ref: typeRef } = useRegPopover();
  const patch = (next: Partial<RegistrationField>) =>
    setFields((fields) => fields.map((item) => (item.id === field.id ? { ...item, ...next } : item)));

  const isName = field.system && field.key === "name";
  const typeLocked = field.system && ["name", "phone", "email"].includes(field.key);
  const meta = REG_TYPE_META[field.type];
  const TypeIcon = meta.icon;

  const options = field.options ?? [];
  const optionCount = options.filter((o) => o.trim()).length;
  // 화면에 적는 실제 제한 — 저장된 maxSelect 가 옵션 수 이상이면 무제한이 맞다(정규화와 같은 판정).
  const liveMax = maxSelectFor({ type: field.type, maxSelect: field.maxSelect, options: options.filter((o) => o.trim()) });

  const changeType = (t: FieldType) => {
    setTypeOpen(false);
    if (t === field.type) return;
    const next: Partial<RegistrationField> = { type: t };
    // 선택형으로 바꿀 때 빈 옵션 두 줄을 깔아 준다 — 옵션 0개면 공개 폼에서 항목이 사라진다.
    if (CHOICE_TYPES.includes(t) && options.filter(Boolean).length === 0) next.options = ["", ""];
    // 드롭다운으로 되돌리면 복수 선택 전용 값은 버린다(남겨 두면 "최대 2개" 가 안 보이는 채로 저장된다).
    if (t !== "multiple") next.maxSelect = undefined;
    patch(next);
  };

  return (
    /**
     * framer Reorder → 골격(EditableList/dnd-kit). layout 프롭이 없어진 게 핵심이다 —
     * framer 가 layout 이나 y 를 애니메이션하는 순간 transform 문자열의 저자가 되고,
     * dnd-kit 이 넘긴 transform 은 버려진다(SessionsTab 에서 실측한 그 조합). 끌어도
     * 행이 따라오지 않고 놓으면 순서만 바뀌어서 눈에 잘 띄지 않는 종류의 고장이다.
     *
     * 함께 얻는 것: 방향키 재정렬(원래 0곳), 삭제 되돌리기(원래 즉시 소실 — 옵션까지
     * 설정해 둔 필드가 한 번의 오클릭으로 사라졌다).
     */
    <div className={`${R.surface} bg-secondary ${FINISH.s2} transition-colors focus-within:bg-secondary/70 ${field.enabled ? "" : "opacity-60"}`}>
      <div>
        <div className="flex items-center gap-1 px-2 pt-2">
          {handle}

          <div className="relative" ref={typeRef}>
            <button
              type="button"
              onClick={() => !typeLocked && setTypeOpen((v) => !v)}
              aria-haspopup={typeLocked ? undefined : "menu"}
              aria-expanded={typeLocked ? undefined : typeOpen}
              disabled={typeLocked}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-background px-2 py-1.5 text-xs font-semibold shadow-sm transition-shadow hover:shadow disabled:cursor-default disabled:opacity-90"
            >
              <span className="grid h-5 w-5 place-items-center rounded-lg bg-violet-500/10 text-violet-500"><TypeIcon className="h-3 w-3" /></span>
              {meta.label}
              {!typeLocked && <ChevronDown className="h-3 w-3 text-muted-foreground/60" />}
            </button>
            {typeOpen && !typeLocked && <RegTypeMenu current={field.type} onPick={changeType} />}
          </div>

          {field.system && <span className="ml-1.5 shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">기본</span>}
          <span className="flex-1" />
          <label className={`flex shrink-0 select-none items-center gap-1 text-[11px] ${field.required ? "font-semibold text-amber-600" : "text-muted-foreground"}`}>
            필수<Switch checked={field.required} onChange={(v) => patch({ required: v })} disabled={isName} label={`${field.label} 필수`} />
          </label>
          <label className="flex shrink-0 select-none items-center gap-1 text-[11px] text-muted-foreground">
            표시<Switch checked={field.enabled} onChange={(v) => patch({ enabled: v })} disabled={isName} label={`${field.label} 표시`} />
          </label>
          {/* 기본 필드는 removable=false 라 골격이 null 을 준다 — 빈 자리는 우리가 그려
              헤더 정렬을 유지한다(bare 모드에서 레이아웃은 호출자 책임). */}
          {removeButton({ label: `${field.label || "필드"} 삭제` }) ?? <span className="w-8 shrink-0" />}
        </div>

        <div className="px-3 pb-3 pl-[42px] pt-1">
          <input
            value={field.label}
            onChange={(e) => patch({ label: e.target.value })}
            aria-label="항목 이름"
            placeholder="항목 이름을 입력하세요"
            className="w-full bg-transparent pb-2 text-[14px] font-semibold tracking-tight outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
          />

          {(field.type === "text" || field.type === "email" || field.type === "tel") && (
            <div className="flex items-center gap-2 rounded-lg bg-background px-2.5 shadow-sm">
              <input
                value={field.placeholder ?? ""}
                onChange={(e) => patch({ placeholder: e.target.value })}
                placeholder={field.type === "tel" ? "입력 예시 (예: 01012345678)" : "입력 예시 — 응답 칸에 회색으로 (선택)"}
                aria-label="입력 예시"
                className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none placeholder:text-muted-foreground/40"
              />
            </div>
          )}

          {field.type === "checkbox" && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <SquareCheck className="h-3 w-3 shrink-0" />동의·확인용 체크박스예요.
            </p>
          )}

          {CHOICE_TYPES.includes(field.type) && (
            <div className="space-y-1.5">
              {/**
               * 공용 OptionRows 로 이관 — 설문 탭의 선택지 코드와 사실상 같은 코드였다.
               * 이관으로 얻는 것: 드래그·키보드 재정렬. 선택지 순서는 공개 폼 <select> 의
               * option 순서인데, 여기서 순서를 바꾸는 방법이 **문구를 다시 타이핑하는 것**뿐이었다.
               * 함께 없어진 것: 이 파일이 들고 있던 pendingFocus + data-opt-idx 쿼리 기반
               * 포커스 이동(골격의 autoFocusNewRow·removeNow({focus}) 가 대신한다).
               */}
              <OptionRows
                listId={`reg-field-${field.id}`}
                value={options}
                onChange={(next) => patch({ options: next })}
                ownerLabel="필드"
                ownerTitle={field.label}
              />
              {options.filter(Boolean).length === 0 && field.enabled && (
                <p className="text-[11px] text-amber-600">옵션이 없으면 등록 폼에 표시되지 않아요{field.required ? " — 필수 항목이라 등록도 막혀요" : ""}.</p>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5">
                {/* 최대 개수 — 복수 선택에만. 옵션 수 이상이면 제한이 아니라서 저장하지 않는다
                    (그 상태로 두면 "최대 3개" 라고 적힌 문구가 실제 제한 없이 공개 폼에 나간다). */}
                {field.type === "multiple" && optionCount >= 2 && (
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    최대 선택 개수
                    <input
                      type="number"
                      min={1}
                      max={optionCount - 1}
                      aria-label={`${field.label} 최대 선택 개수`}
                      value={field.maxSelect ?? ""}
                      placeholder="제한 없음"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        patch({ maxSelect: Number.isInteger(n) && n >= 1 && n < optionCount ? n : undefined });
                      }}
                      className={`${inputCls} w-24 min-h-8 px-2 py-1 text-[11px] tabular-nums`}
                    />
                    <span>{liveMax === null ? "제한 없음" : `${liveMax}개까지`}</span>
                  </label>
                )}

                {/* 기타(직접입력) — 드롭다운·복수 선택 공통. 고르면 자유 입력칸이 함께 뜬다. */}
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground select-none">
                  <Switch
                    checked={field.allowOther === true}
                    onChange={(v) => patch({ allowOther: v || undefined })}
                    label={`${field.label} 기타 직접입력 허용`}
                  />
                  기타(직접입력) 허용
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 등록 폼 미리보기 — 설문 미리보기와 같은 폰 프레임 + STK 테마(웨비나 색). 실제 등록 화면과 결을 맞춘다.
const REG_PREVIEW_CSS = `
.stk-live.regprev { background:var(--card-2); padding:20px 14px 28px; min-height:100%; }
.stk-live.regprev .rp-head { text-align:center; margin-bottom:16px; padding:0 4px; }
.stk-live.regprev .rp-kick { font-size:10px; font-weight:750; letter-spacing:.14em; text-transform:uppercase; color:var(--key); margin:0 0 6px; }
.stk-live.regprev .rp-title { font-size:18px; font-weight:820; letter-spacing:-.02em; color:var(--text); margin:0; word-break:keep-all; }
.stk-live.regprev .rp-desc { font-size:12px; line-height:1.6; color:var(--muted); margin:7px 0 0; word-break:keep-all; }
.stk-live.regprev .rp-card { background:var(--card); border-radius:16px; box-shadow:var(--card-shadow); padding:18px 15px; display:flex; flex-direction:column; gap:13px; }
.stk-live.regprev .rp-label { display:block; font-size:12px; font-weight:650; color:var(--text); margin:0 0 5px; word-break:keep-all; }
.stk-live.regprev .rp-label .rq { color:var(--key); margin-left:2px; }
.stk-live.regprev .rp-input { width:100%; padding:10px 12px; border-radius:10px; border:1.5px solid var(--line-md); background:var(--card-2); color:var(--text); font:inherit; font-size:13px; }
.stk-live.regprev .rp-input.ph { color:var(--sub); }
.stk-live.regprev .rp-consent { display:flex; align-items:flex-start; gap:9px; min-height:18px; font-size:11.5px; line-height:18px; color:var(--muted); }
.stk-live.regprev .rp-check { width:18px; height:18px; border-radius:5px; box-shadow:inset 0 0 0 1.5px var(--line-md); margin:0; flex:none; display:grid; place-items:center; color:transparent; font-size:11px; font-weight:900; }
.stk-live.regprev .rp-check.on { background:var(--key); box-shadow:none; color:var(--on-key); }
.stk-live.regprev .rp-link { text-decoration:underline; text-underline-offset:2px; }
.stk-live.regprev .rp-submit { width:100%; height:46px; border-radius:12px; background:var(--key); color:var(--on-key); font:inherit; font-size:14px; font-weight:800; border:0; margin-top:3px; box-shadow:var(--btn-shadow-key); }
.stk-live.regprev .rp-done { text-align:center; gap:12px; padding:24px 18px; }
.stk-live.regprev .rp-done-mark { display:grid; place-items:center; width:56px; height:56px; margin:0 auto 2px; border-radius:999px; background:color-mix(in srgb,#12B76A 14%,transparent); color:#12B76A; font-size:24px; }
.stk-live.regprev .rp-done-title { margin:0; color:var(--text); font-size:18px; font-weight:820; letter-spacing:-.02em; }
.stk-live.regprev .rp-done-desc { margin:0; color:var(--muted); font-size:12px; line-height:1.6; }
.stk-live.regprev .rp-close { width:100%; height:42px; border:0; border-radius:12px; background:transparent; color:var(--muted); font:inherit; font-size:13px; font-weight:750; }
.stk-live.regprev .rp-empty { text-align:center; font-size:12px; color:var(--muted); padding:8px 0; }
`;

export function RegistrationFormPreview({
  fields,
  privacyText,
  marketingText,
  privacyBody,
  marketingBody,
  privacyDefaultChecked,
  marketingDefaultChecked,
  thirdPartyEnabled,
  thirdPartyText,
  thirdPartyBody,
  thirdPartyDefaultChecked,
  submitLabel,
  successCta,
  theme,
  slug,
}: {
  fields: RegistrationField[];
  privacyText: string;
  marketingText: string;
  privacyBody: string;
  marketingBody: string;
  privacyDefaultChecked: boolean;
  marketingDefaultChecked: boolean;
  thirdPartyEnabled: boolean;
  thirdPartyText: string;
  thirdPartyBody: string;
  thirdPartyDefaultChecked: boolean;
  submitLabel: string;
  successCta: WebinarLinkCtaConfig;
  theme: { accent: string; text: string; surface: string; radius?: string };
  slug?: string;
}) {
  // 공개 폼과 같은 기준 — 빈 선택지 행(편집 중)은 없는 것으로 취급
  const visibleFields = fields.filter(
    (field) => field.enabled && !(CHOICE_TYPES.includes(field.type) && (field.options ?? []).filter((o) => o.trim()).length === 0),
  );
  const css = useMemo(() => buildStkCss(theme.accent, theme.text, theme.surface, theme.radius) + REG_PREVIEW_CSS, [theme.accent, theme.text, theme.surface, theme.radius]);
  const [previewMode, setPreviewMode] = useState<"form" | "done">("form");
  const previewCtaUrl = safeHttpUrl(successCta.url);
  const showPreviewCta =
    successCta.enabled && successCta.label.trim() !== "" && previewCtaUrl !== "";

  return (
    <div className="mx-auto w-full max-w-[440px] 2xl:sticky 2xl:top-4">
      <div className="mb-2 flex items-center gap-1.5 px-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
        <Smartphone className="h-3 w-3" />등록 화면 미리보기
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-secondary/70 p-0.5 normal-case tracking-normal">
          {([
            ["form", "폼"],
            ["done", "완료"],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={previewMode === mode}
              onClick={() => setPreviewMode(mode)}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${previewMode === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 text-emerald-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />실시간
        </span>
      </div>
      <div className="overflow-hidden rounded-[24px] shadow-xl">
        <div className="flex h-8 items-center justify-center bg-secondary/70 px-3">
          <span className="truncate font-mono text-[10px] text-muted-foreground/80">…/webinar/{slug ?? "…"} · 사전 등록</span>
        </div>
        <div className="relative max-h-[min(760px,calc(100vh-230px))] overflow-y-auto overscroll-contain">
          <style dangerouslySetInnerHTML={{ __html: css }} />
          <div className="stk-live regprev">
            {previewMode === "form" ? (
              <>
                <div className="rp-head">
                  <p className="rp-kick">WEBINAR</p>
                  <h4 className="rp-title">사전 등록</h4>
                  <p className="rp-desc">웨비나 참여 정보를 입력해주세요.</p>
                </div>
                <div className="rp-card">
                  {visibleFields.length === 0 && <p className="rp-empty">표시할 항목이 없어요.</p>}
                  {visibleFields.map((field) => {
                    if (field.type === "checkbox") {
                      return (
                        <label key={field.id} className="rp-consent">
                          <span className="rp-check" />
                          <span>{field.label}{field.required ? " *" : ""}</span>
                        </label>
                      );
                    }
                    return (
                      <div key={field.id}>
                        <label className="rp-label">{field.label}{field.required && <span className="rq">*</span>}</label>
                        {field.type === "multiple" ? (
                          /* 복수 선택은 미리보기에서도 체크 목록으로 — 드롭다운과 같은 모양이면
                             어드민이 어느 유형을 골랐는지 미리보기로 확인할 수 없다. */
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {(field.options ?? []).filter((o) => o.trim()).slice(0, 3).map((o, i) => (
                              <span key={i} className="rp-consent"><span className="rp-check">✓</span>{o}</span>
                            ))}
                            {(field.options ?? []).filter((o) => o.trim()).length > 3 && (
                              <span className="rp-label" style={{ opacity: 0.7 }}>외 {(field.options ?? []).filter((o) => o.trim()).length - 3}개 (공개 폼에는 모두 보여요)</span>
                            )}
                            {field.allowOther && <span className="rp-consent"><span className="rp-check">✓</span>기타(직접입력)</span>}
                            {(() => {
                              const m = maxSelectFor({ type: field.type, maxSelect: field.maxSelect, options: (field.options ?? []).filter((o) => o.trim()) });
                              return m !== null ? <span className="rp-label" style={{ opacity: 0.7 }}>최대 {m}개</span> : null;
                            })()}
                          </div>
                        ) : field.type === "select" ? (
                          <div className="rp-input ph">
                            {(field.options ?? []).find((o) => o.trim()) ?? "선택해주세요"}
                            {field.allowOther ? " · 기타 입력 가능" : ""}
                          </div>
                        ) : (
                          <div className="rp-input ph">{field.placeholder || (field.type === "email" ? "you@example.com" : field.type === "tel" ? "01012345678" : "입력해주세요")}</div>
                        )}
                      </div>
                    );
                  })}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label className="rp-consent">
                      <span className={`rp-check ${privacyDefaultChecked ? "on" : ""}`}>✓</span>
                      <span className={privacyBody ? "rp-link" : ""}>{privacyText}</span>
                    </label>
                    <label className="rp-consent">
                      <span className={`rp-check ${marketingDefaultChecked ? "on" : ""}`}>✓</span>
                      <span className={marketingBody ? "rp-link" : ""}>{marketingText}</span>
                    </label>
                    {thirdPartyEnabled && (
                      <label className="rp-consent">
                        <span className={`rp-check ${thirdPartyDefaultChecked ? "on" : ""}`}>✓</span>
                        <span className={thirdPartyBody ? "rp-link" : ""}>{thirdPartyText}</span>
                      </label>
                    )}
                  </div>
                  <button type="button" className="rp-submit">{submitLabel}</button>
                </div>
              </>
            ) : (
              <div className="rp-card rp-done">
                <span className="rp-done-mark" aria-hidden>✓</span>
                <p className="rp-done-title">사전등록이 완료됐어요</p>
                <p className="rp-done-desc">웨비나 당일 등록하신 연락처·이메일로 바로 입장할 수 있어요.</p>
                {showPreviewCta ? (
                  <>
                    <button type="button" className="rp-submit">{successCta.label}</button>
                    <button type="button" className="rp-close" onClick={() => setPreviewMode("form")}>닫기</button>
                  </>
                ) : (
                  <button type="button" className="rp-submit" onClick={() => setPreviewMode("form")}>확인</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="mt-2 px-1 text-center text-[11px] text-muted-foreground/70">배너 모달·라이브 페이지 등록 폼에 이대로 적용돼요.</p>
    </div>
  );
}

/**
 * 약관 전문 — 상속 요약 + 덮어쓰기.
 *
 * 예전엔 라벨 없는 큰 textarea 두 개가 **고빈도로 만지는 필드 빌더와 같은 스크롤**에 섞여
 * 있었고, 웨비나마다 같은 전문을 다시 붙여넣어야 했다. 이제 워크스페이스 템플릿이 기본이고
 * 이 웨비나만 다르게 할 때 펼쳐서 덮어쓴다(AGENTS: 저빈도 긴 세부는 가까운 확장으로).
 */
function ConsentBodyField({
  label, value, onChange, template,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  template?: string | null;
}) {
  const resolved = resolveConsentBody(value, template);
  const overriding = resolved.source === "webinar";
  const [open, setOpen] = useState(overriding);

  return (
    <div className="mt-2 space-y-1.5 rounded-xl bg-secondary/25 p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] text-muted-foreground">전문</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
          resolved.source === "webinar" ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
          : resolved.source === "workspace" ? "bg-secondary text-muted-foreground"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        }`}>
          {consentSourceLabel(resolved.source)}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto text-[11px] font-medium text-violet-500 transition-colors hover:text-violet-600"
        >
          {open ? "접기" : overriding ? "전문 보기·수정" : "이 웨비나만 다르게"}
        </button>
      </div>

      {!open && (
        <p className="line-clamp-2 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground/80">
          {resolved.body || "전문이 없어요 — 동의 문구를 눌러도 팝업이 뜨지 않아요."}
        </p>
      )}

      {open && (
        <>
          <textarea
            rows={5}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label} 약관 전문 (이 웨비나 전용)`}
            placeholder={template ? "비워 두면 워크스페이스 공통 전문을 씁니다." : "약관 전문 — 워크스페이스 설정 › 약관에 넣어 두면 모든 웨비나가 물려받아요."}
            className={`${FIELD_CLS} resize-y leading-relaxed`}
          />
          {overriding && template && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-[11px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            >
              워크스페이스 공통으로 되돌리기
            </button>
          )}
          {!template && (
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              같은 전문을 웨비나마다 붙여넣고 있다면 워크스페이스 설정 › 약관에 한 번만 넣어 두세요.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function RegistrationFormTab({ webinar, onSilentUpdate, confirmLiveOff }: {
  webinar: Webinar;
  onSilentUpdate: () => void;
  /**
   * 라이브 중 "끄는" 변경에 확인을 붙인다 — 켜는 쪽은 시청자에게 더 주는 변경이라 통과.
   * 껍데기가 시청자 수를 알고 있어서 문구에 실제 인원이 들어간다.
   */
  confirmLiveOff?: (what: string, effect: string) => Promise<boolean>;
}) {
  const uid = useId();
  const initial = normalizeRegistrationForm(webinar.config ?? {}, { includeDisabled: true });
  const [fields, setFields] = useState<RegistrationField[]>(initial.fields);
  const [privacyText, setPrivacyText] = useState(initial.privacyText);
  const [marketingText, setMarketingText] = useState(initial.marketingText);
  const [privacyBody, setPrivacyBody] = useState(initial.privacyBody);
  const [marketingBody, setMarketingBody] = useState(initial.marketingBody);
  const [privacyBodyMode, setPrivacyBodyMode] = useState(initial.privacyBodyMode);
  const [marketingBodyMode, setMarketingBodyMode] = useState(initial.marketingBodyMode);
  const [privacyLinkUrl, setPrivacyLinkUrl] = useState(initial.privacyLinkUrl);
  const [marketingLinkUrl, setMarketingLinkUrl] = useState(initial.marketingLinkUrl);
  const [privacyDefaultChecked, setPrivacyDefaultChecked] = useState(initial.privacyDefaultChecked);
  const [marketingDefaultChecked, setMarketingDefaultChecked] = useState(initial.marketingDefaultChecked);
  // 제3자 제공 동의 — privacy/marketing 과 달리 쓰는 웨비나만 켠다(대회 신청 폼과 같은 이유).
  const [thirdPartyEnabled, setThirdPartyEnabled] = useState(initial.thirdPartyEnabled);
  const [thirdPartyText, setThirdPartyText] = useState(initial.thirdPartyText);
  const [thirdPartyBody, setThirdPartyBody] = useState(initial.thirdPartyBody);
  const [thirdPartyBodyMode, setThirdPartyBodyMode] = useState(initial.thirdPartyBodyMode);
  const [thirdPartyLinkUrl, setThirdPartyLinkUrl] = useState(initial.thirdPartyLinkUrl);
  const [thirdPartyDefaultChecked, setThirdPartyDefaultChecked] = useState(initial.thirdPartyDefaultChecked);
  const [successCta, setSuccessCta] = useState(initial.successCta);
  /** 확인 버튼이 이동할 주소 — CTA(새 탭 부가 링크)와 다른 자리다. */
  const [successRedirectUrl, setSuccessRedirectUrl] = useState(initial.successRedirectUrl);
  const successRedirectInvalid = successRedirectUrl.trim() !== "" && !safeHttpUrl(successRedirectUrl);
  const successCtaUrl = safeHttpUrl(successCta.url);
  const successCtaUrlInvalid = successCta.url.trim() !== "" && !successCtaUrl;

  /**
   * 접수 창 — 언제까지, 그리고 라이브 중에도 받는가. IA 3단계에서 '기본 정보' 에서 옮겨 왔다.
   * 둘 다 접수 정책인데 마감은 일정 카드 안, 라이브 중 정책은 그 밖에 있어서 **모순 조합을
   * 경고할 자리가 없었다.** 한 블록으로 모으니 그 자리가 생긴다.
   */
  const liveStartLocal = kstDateTimeLocalInput(webinar.liveStartAt);
  // 서버 규칙(webinar-schedule.ts: assertScheduleOrder)이 "마감 ≤ 종료" 를 요구한다 — 어기면
  // 이 탭 전체가 쓰는 단일 PATCH 가 400 으로 통째로 거부된다. 제출 전에 여기서 미리 잡는다.
  const liveEndLocal = webinar.liveEndAt ? kstDateTimeLocalInput(webinar.liveEndAt) : null;
  const [deadline, setDeadline] = useState(() => kstDateTimeLocalInput(webinar.signupDeadline));
  const liveRegOf = (c: Record<string, unknown> | null | undefined) =>
    c?.allowLiveRegistration === false ? "closed" : c?.allowLiveRegistration === true ? "open" : "auto";
  const [liveReg, setLiveReg] = useState<"auto" | "open" | "closed">(() => liveRegOf(webinar.components));
  const [submitLabel, setSubmitLabel] = useState(initial.submitLabel);

  /**
   * ── 언어별 문구 ──────────────────────────────────────────────────────
   * 구조(항목·키·유형·순서)는 **기본 언어 탭에서만** 바꾼다. 다른 언어는 같은 구조에 문구만
   * 채운다 — 영어에서만 항목을 하나 더하면 두 언어의 저장 키가 달라지고, 그러면 등록이
   * 한 명단에 쌓이지 않는다(그게 이 기능이 존재하는 이유다).
   *
   * 기본 언어 변경은 여기 두지 않는다. 웨비나 등록 폼의 원문은 처음부터 한국어였고
   * (수집 빌더와 달리) 그 전제를 뒤집을 이유가 아직 없다 — 필요해지면 수집 쪽의
   * `retagFormLocale` 과 같은 이전을 붙인다.
   */
  const [i18n, setI18n] = useState<WebinarFormI18n>(initial.i18n);
  const [formLocales, setFormLocales] = useState<string[]>(initial.locales);
  const [editLocale, setEditLocale] = useState<string>(initial.defaultLocale);
  /**
   * 원문이 어느 언어로 쓰였나. 기본값 "ko" 는 이 폼의 문구가 처음부터 한국어였기 때문이고,
   * **영문 전용 웨비나에서는 틀리다** — 그때 영어가 원문 자리를 못 차지해 영어 번역을
   * 추가할 수 없으므로 정정할 수단이 있어야 한다(아래 언어 막대).
   */
  const [baseLocale, setBaseLocale] = useState<string>(initial.defaultLocale);

  const previewTheme = useMemo(() => ({
    accent: webinar.theme?.accentColor || "#6D28D9",
    text: webinar.theme?.textColor || "#141320",
    surface: webinar.theme?.surfaceColor || "#FFFFFF",
    radius: webinar.theme?.borderRadius,
  }), [webinar.theme]);

  const addCustomField = () => {
    const id = crypto.randomUUID();
    setFields((prev) => [
      ...prev,
      {
        id,
        key: `custom_${id.slice(0, 8)}`,
        label: "새 필드",
        type: "text",
        placeholder: "",
        required: false,
        enabled: true,
        options: [],
        system: false,
      },
    ]);
  };

  // 자동저장 — 필드(순서 포함)·동의 문구 변경 시 디바운스 후 PATCH(config.registrationForm).
  const save = async () => {
    try {
      const res = await fetch(`/api/webinars/${webinar.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive: true, // 페이지 이탈 중 flush 도 서버에 도달하도록
        // 이 탭이 소유한 registrationForm 키만 보낸다(서버가 config 를 키 단위로 병합).
        body: JSON.stringify({
          // 접수 창은 이 탭이 소유한다(기본 정보 탭은 더 이상 보내지 않는다).
          // auto 는 null 로 저장해 "마감일까지" 기존 동작을 유지한다.
          signupDeadline: kstDateTimeLocalToIso(deadline),
          components: { allowLiveRegistration: liveReg === "closed" ? false : liveReg === "open" ? true : null },
          config: {
            registrationForm: {
              // 편집 중 빈 선택지 행은 로컬에만 두고 저장에서는 정리 — 공개 폼에 빈 옵션이 새지 않게
              fields: fields.map((f) => ({ ...f, options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) })),
              privacyText: privacyText.trim() || initial.privacyText,
              marketingText: marketingText.trim() || initial.marketingText,
              privacyBody: privacyBody.trim(),
              marketingBody: marketingBody.trim(),
              privacyBodyMode,
              marketingBodyMode,
              privacyLinkUrl: privacyLinkUrl.trim(),
              marketingLinkUrl: marketingLinkUrl.trim(),
              privacyDefaultChecked,
              marketingDefaultChecked,
              thirdPartyEnabled,
              thirdPartyText: thirdPartyText.trim() || initial.thirdPartyText,
              thirdPartyBody: thirdPartyBody.trim(),
              thirdPartyBodyMode,
              thirdPartyLinkUrl: thirdPartyLinkUrl.trim(),
              thirdPartyDefaultChecked,
              submitLabel: submitLabel.trim() || initial.submitLabel,
              successCta: {
                enabled: successCta.enabled,
                label: successCta.label.trim(),
                url: successCta.url.trim(),
              },
              successRedirectUrl: successRedirectUrl.trim(),
              defaultLocale: baseLocale,
              locales: formLocales,
              i18n,
            },
          },
        }),
      });
      if (!res.ok) {
        // 서버 400(예: "등록 마감은 종료 시각보다 앞이어야 해요")은 조건이 안 바뀌면 재시도해도
        // 계속 실패한다 — "잠시 후 다시 시도돼요"는 거짓 안내라 서버 문구를 그대로 보여준다.
        const body = await res.json().catch(() => null);
        const message = typeof body?.error === "string" && body.error ? body.error : "자동 저장 실패 — 잠시 후 다시 시도돼요";
        toast.error(message, { id: "autosave-error" });
        return false;
      }
      onSilentUpdate();
      return true;
    } catch { return false; }
  };
  const { state: saveState, retry } = useAutosave(
    {
      fields, privacyText, marketingText, privacyBody, marketingBody, privacyBodyMode, marketingBodyMode, privacyLinkUrl, marketingLinkUrl, privacyDefaultChecked, marketingDefaultChecked,
      thirdPartyEnabled, thirdPartyText, thirdPartyBody, thirdPartyBodyMode, thirdPartyLinkUrl, thirdPartyDefaultChecked,
      submitLabel, successCta, successRedirectUrl, deadline, liveReg,
      i18n, formLocales, baseLocale,
    },
    save,
  );
  // 표시는 껍데기 한 곳에서 그린다(만들기 화면당 1개) — 저장 경로는 그대로 각자.
  useReportAutosave(saveState, retry);

  // 마감이 종료보다 뒤면 서버가 무조건 400 을 준다(assertScheduleOrder) — 재시도해도 조건이
  // 안 바뀌는 한 계속 실패한다. 이건 "안내"가 아니라 제출 전에 막아야 하는 에러다.
  const deadlineAfterLiveEnd = liveEndLocal !== null && deadline > liveEndLocal;

  /**
   * 접수 창의 두 값이 서로를 무의미하게 만드는 조합만 짚는다(에러가 아니라 안내).
   * 서버 규칙은 "마감 ≤ 종료" 뿐이라 이 조합들은 저장은 되지만 운영자 의도와 어긋난다.
   */
  const intakeConflict =
    liveReg === "open" && deadline === liveStartLocal
      ? "마감을 ‘라이브 시작 시점’ 으로 두고 ‘계속 받기’ 를 골랐어요 — 마감 시각이 사실상 의미가 없어져요."
      : liveReg === "closed" && deadline > liveStartLocal
        ? "마감이 라이브 시작보다 뒤인데 ‘시작 시 마감’ 이에요 — 설정한 마감 시각에는 도달하지 못해요."
        : null;

  const hasTel = fields.some((f) => f.enabled && f.type === "tel");

  /**
   * 번역 표가 읽는 **지금 화면의 폼**. 상태가 칸마다 쪼개져 있어 한 덩어리로 다시 모은다 —
   * 번역 칸은 "원문이 무엇인가" 를 알아야 짝을 지을 수 있고, 그 원문은 저장된 값이 아니라
   * **지금 편집 중인 값**이어야 한다(라벨을 고치면 번역 표의 원문도 즉시 따라와야 한다).
   */
  const formForI18n: WebinarRegistrationFormConfig = {
    ...initial,
    fields,
    privacyText,
    marketingText,
    privacyBody,
    marketingBody,
    privacyBodyMode,
    marketingBodyMode,
    privacyLinkUrl,
    marketingLinkUrl,
    privacyDefaultChecked,
    marketingDefaultChecked,
    submitLabel,
    successCta,
    successRedirectUrl,
    defaultLocale: baseLocale,
    locales: formLocales,
    i18n,
  };

  const editableLocales = webinarFormEditableLocales(formForI18n);
  // 다른 창에서 언어가 지워져 지금 보던 탭이 사라지면 기본 언어로 돌아간다.
  const activeLocale = editableLocales.includes(editLocale) ? editLocale : baseLocale;
  const translating = activeLocale !== baseLocale;

/** 번역 표가 돌려준 폼에서 **언어 관련 부분만** 상태로 되받는다(구조는 번역 모드에서 안 바뀐다). */
  const applyI18n = (next: WebinarRegistrationFormConfig) => {
    setI18n(next.i18n);
    setFormLocales(next.locales);
    setBaseLocale(next.defaultLocale);
  };

  /**
   * 미리보기는 **지금 고른 언어로** 그린다 — 번역을 적는 옆에서 실제 화면을 봐야
   * 줄바꿈·길이 문제를 그 자리에서 잡는다(AGENTS.md §2 "인접 실시간 미리보기").
   */
  const previewForm = translating ? applyWebinarFormLocale(formForI18n, activeLocale) : formForI18n;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] space-y-6 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_440px] 2xl:gap-8 2xl:space-y-0 2xl:items-start">
      <div className="space-y-6 min-w-0">
        <WebinarFormLocaleBar
          form={formForI18n}
          locales={editableLocales}
          active={activeLocale}
          baseLocale={baseLocale}
          onSelect={setEditLocale}
          onChange={(next, nextLocale) => {
            applyI18n(next);
            if (nextLocale) setEditLocale(nextLocale);
          }}
        />

        {translating ? (
          <TranslationTable
            config={formForI18n}
            entries={webinarTranslationEntries(formForI18n, activeLocale)}
            locale={activeLocale}
            baseLocale={baseLocale}
            onChange={applyI18n}
            emptyHint="탭에서 항목·동의 문구를 먼저 채우면 여기에 그대로 나타나요."
            draft={{ scope: "webinar", resourceId: webinar.id, subject: "웨비나 사전등록 폼" }}
          />
        ) : (
        <>
        {/* 접수 창 — 무엇을 받는지(아래)보다 상위 결정이라 위에 둔다. 두 줄이라 아래를 밀어내지 않는다. */}
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">접수 창</h3>
            <p className="mt-1 text-sm text-muted-foreground">언제까지 받고, 라이브가 시작된 뒤에도 받을지 정해요.</p>
          </div>
          <div className="space-y-3 rounded-2xl bg-secondary/20 p-4">
            <SignupDeadlineField liveStartAt={liveStartLocal} value={deadline} onChange={setDeadline} />
            {deadlineAfterLiveEnd && (
              <p className="text-[11px] text-destructive">등록 마감이 라이브 종료 시각보다 뒤예요 — 종료 전으로 옮겨야 저장돼요.</p>
            )}

            <div className="space-y-1.5 pt-1">
              <span className="text-xs font-medium">라이브 중 사전등록</span>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { v: "auto", label: "마감일까지" },
                  { v: "open", label: "계속 받기" },
                  { v: "closed", label: "시작 시 마감" },
                ] as const).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    aria-pressed={liveReg === opt.v}
                    onClick={() => {
                      // 지금 받고 있는 접수를 닫는 방향일 때만 확인 — 여는 방향은 통과.
                      if (opt.v !== "closed" || liveReg === "closed" || !confirmLiveOff) { setLiveReg(opt.v); return; }
                      void confirmLiveOff("사전등록 접수", "입장 확인 화면에서 사전등록 버튼이 사라져요.").then((ok) => {
                        if (ok) setLiveReg("closed");
                      });
                    }}
                    className={`rounded-lg px-3 py-2 text-xs font-medium shadow-sm transition-colors ${
                      liveReg === opt.v ? "bg-violet-500 text-white" : "bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="block text-[11px] leading-relaxed text-muted-foreground/70">
                {liveReg === "auto" ? "설정한 마감 시각이 지나면 접수를 닫아요."
                  : liveReg === "open" ? "마감이 지나도 라이브 중 들어온 사람이 등록할 수 있어요 — 입장 확인 화면에 사전등록 버튼이 보여요."
                  : "라이브가 시작되면 바로 접수를 닫아요. 입장 확인 화면에 사전등록 버튼이 보이지 않아요."}
              </span>
            </div>

            {/* 두 값이 서로를 무의미하게 만드는 조합 — 예전엔 두 컨트롤이 다른 화면에 있어 경고할 자리가 없었다. */}
            {intakeConflict && (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                {intakeConflict}
              </p>
            )}
          </div>
        </section>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">입력 항목</h3>
            <p className="text-sm text-muted-foreground mt-1">
              카드에서 바로 수정돼요. 왼쪽 그립(⠿)을 끌면 순서가 바뀝니다.
            </p>
          </div>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={addCustomField}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 text-white text-xs font-medium hover:bg-violet-600 transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />필드 추가
          </motion.button>
        </div>

        <EditableList<RegistrationField>
          listId="reg-fields"
          itemNoun="필드"
          items={fields}
          onChange={setFields}
          rowKey={(f) => f.id}
          reorderable
          rowChrome="bare"
          // 기본 필드(이름·연락처·이메일)는 지울 수 없다 — 골격이 삭제 컨트롤 자리에 null 을 준다.
          removable={(f) => !f.system}
          // 추가 버튼은 이 섹션 헤더에 이미 있다(유형을 먼저 고르는 흐름) — 골격은 그리지 않는다.
          renderAdd={() => null}
          renderRow={({ item, handle, removeButton }) => (
            <FieldCard field={item} setFields={setFields} handle={handle} removeButton={removeButton} />
          )}
        />
        {hasTel && (
          <p className="text-[11px] text-muted-foreground/70 -mt-3">전화번호 필드는 하이픈(-) 없이 숫자만 입력받아요.</p>
        )}

        <section className="space-y-3 pt-4 border-t border-border">
          <div>
            <h3 className="text-sm font-semibold">동의 문구 · 버튼</h3>
            <p className="text-xs text-muted-foreground mt-1">폼 하단의 동의 체크박스와 제출 버튼 문구예요.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-privacy`} className="text-xs text-muted-foreground mb-1 block">개인정보 동의 문구</label>
              <input id={`${uid}-privacy`} value={privacyText} onChange={(e) => setPrivacyText(e.target.value)} className={inputCls} />
              <div className="my-2 flex w-fit rounded-lg bg-secondary p-0.5 shadow-sm" role="tablist">{(["text", "link"] as const).map((mode) => <button key={mode} type="button" role="tab" aria-selected={privacyBodyMode === mode} onClick={() => setPrivacyBodyMode(mode)} className={`rounded-md px-2.5 py-1 text-[10px] font-semibold ${privacyBodyMode === mode ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{mode === "text" ? "텍스트" : "링크"}</button>)}</div>
              {privacyBodyMode === "link" ? <input type="url" value={privacyLinkUrl} onChange={(e) => setPrivacyLinkUrl(e.target.value)} placeholder="https://..." aria-label="개인정보처리방침 링크" className={inputCls} /> : <ConsentBodyField
                label="개인정보 수집·이용"
                value={privacyBody}
                onChange={setPrivacyBody}
                template={webinar.workspace?.privacyBodyTemplate}
              />}
              <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2 select-none">
                <Switch checked={privacyDefaultChecked} onChange={setPrivacyDefaultChecked} label="개인정보 동의 기본 체크" />
                폼 진입 시 기본으로 체크해두기
              </label>
            </div>
            <div>
              <label htmlFor={`${uid}-marketing`} className="text-xs text-muted-foreground mb-1 block">마케팅 동의 문구</label>
              <input id={`${uid}-marketing`} value={marketingText} onChange={(e) => setMarketingText(e.target.value)} className={inputCls} />
              <div className="my-2 flex w-fit rounded-lg bg-secondary p-0.5 shadow-sm" role="tablist">{(["text", "link"] as const).map((mode) => <button key={mode} type="button" role="tab" aria-selected={marketingBodyMode === mode} onClick={() => setMarketingBodyMode(mode)} className={`rounded-md px-2.5 py-1 text-[10px] font-semibold ${marketingBodyMode === mode ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{mode === "text" ? "텍스트" : "링크"}</button>)}</div>
              {marketingBodyMode === "link" ? <input type="url" value={marketingLinkUrl} onChange={(e) => setMarketingLinkUrl(e.target.value)} placeholder="https://..." aria-label="마케팅 동의 링크" className={inputCls} /> : <ConsentBodyField
                label="마케팅 정보 수신"
                value={marketingBody}
                onChange={setMarketingBody}
                template={webinar.workspace?.marketingBodyTemplate}
              />}
              <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2 select-none">
                <Switch checked={marketingDefaultChecked} onChange={setMarketingDefaultChecked} label="마케팅 동의 기본 체크" />
                폼 진입 시 기본으로 체크해두기
              </label>
              {marketingDefaultChecked && (
                <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1 leading-relaxed">
                  마케팅 정보 수신은 선택 동의 항목이에요. 국가·업종에 따라 사전 체크가 관련 법령(예: 정보통신망법)에 저촉될 수 있으니 적용 전 확인해주세요.
                </p>
              )}
            </div>
            <div>
              {thirdPartyEnabled ? (
                <>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label htmlFor={`${uid}-thirdparty`} className="text-xs text-muted-foreground block">개인정보 제3자 제공 동의 문구</label>
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground select-none">
                      사용
                      <Switch checked={thirdPartyEnabled} onChange={setThirdPartyEnabled} label="제3자 제공 동의 사용" />
                    </label>
                  </div>
                  <input id={`${uid}-thirdparty`} value={thirdPartyText} onChange={(e) => setThirdPartyText(e.target.value)} className={inputCls} />
                  <div className="my-2 flex w-fit rounded-lg bg-secondary p-0.5 shadow-sm" role="tablist">{(["text", "link"] as const).map((mode) => <button key={mode} type="button" role="tab" aria-selected={thirdPartyBodyMode === mode} onClick={() => setThirdPartyBodyMode(mode)} className={`rounded-md px-2.5 py-1 text-[10px] font-semibold ${thirdPartyBodyMode === mode ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{mode === "text" ? "텍스트" : "링크"}</button>)}</div>
                  {thirdPartyBodyMode === "link" ? <input type="url" value={thirdPartyLinkUrl} onChange={(e) => setThirdPartyLinkUrl(e.target.value)} placeholder="https://..." aria-label="제3자 제공 동의 링크" className={inputCls} /> : <ConsentBodyField
                    label="개인정보 제3자 제공"
                    value={thirdPartyBody}
                    onChange={setThirdPartyBody}
                  />}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2 select-none">
                    <Switch checked={thirdPartyDefaultChecked} onChange={setThirdPartyDefaultChecked} label="제3자 제공 동의 기본 체크" />
                    폼 진입 시 기본으로 체크해두기
                  </label>
                  {thirdPartyDefaultChecked && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1 leading-relaxed">
                      제3자 제공 동의는 선택 동의 항목이에요. 국가·업종에 따라 사전 체크가 관련 법령에 저촉될 수 있으니 적용 전 확인해주세요.
                    </p>
                  )}
                </>
              ) : (
                // privacy·marketing 은 항상 폼에 뜬다. 제3자 제공만 협찬사·제휴사가 있는 웨비나에만
                // 필요해 기본 꺼짐이다 — 켜기 전엔 자리만 차지하지 않게 한 줄로 접는다.
                <div className="flex items-center justify-between gap-2 rounded-lg bg-secondary/30 p-2 h-full">
                  <span className="text-xs font-medium text-muted-foreground">개인정보 제3자 제공 동의 — 사용 안 함</span>
                  <Switch checked={thirdPartyEnabled} onChange={setThirdPartyEnabled} label="제3자 제공 동의 사용" />
                </div>
              )}
            </div>
            <div>
              <label htmlFor={`${uid}-submit`} className="text-xs text-muted-foreground mb-1 block">제출 버튼 문구</label>
              <input id={`${uid}-submit`} value={submitLabel} onChange={(e) => setSubmitLabel(e.target.value)} className={inputCls} />
            </div>
          </div>
        </section>

        <section className="space-y-3 pt-4 border-t border-border">
          <div>
            <h3 className="text-sm font-semibold">등록 완료 화면</h3>
            <p className="mt-1 text-xs text-muted-foreground">등록 직후 보여줄 선택 행동이에요.</p>
          </div>
          <div className="space-y-3 rounded-2xl bg-secondary/20 p-4">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">CTA 표시</span>
              <Switch
                checked={successCta.enabled}
                onChange={(enabled) => setSuccessCta((v) => ({ ...v, enabled }))}
                label="등록 완료 CTA 표시"
              />
            </label>
            <input
              aria-label="완료 CTA 버튼 문구"
              value={successCta.label}
              onChange={(e) => setSuccessCta((v) => ({ ...v, label: e.target.value }))}
              className={inputCls}
              placeholder="예: 오픈채팅 입장하기"
            />
            <input
              aria-label="완료 CTA 연결 URL"
              type="url"
              value={successCta.url}
              onChange={(e) => setSuccessCta((v) => ({ ...v, url: e.target.value }))}
              className={successCtaUrlInvalid ? FIELD_CLS_DANGER : inputCls}
              placeholder="https://..."
            />
            {successCtaUrlInvalid && (
              <p className="text-[11px] text-destructive">http:// 또는 https:// 주소를 입력해 주세요.</p>
            )}
          </div>

          {/* 확인 버튼의 목적지 — 위 CTA 와 다른 물건이다. CTA 는 "덤으로 하나 더" 라 새 탭으로
              열지만, 이건 등록 다음 걸음을 넘기는 것이라 같은 탭에서 이동한다. */}
          <div className="mt-3 space-y-2 rounded-2xl bg-secondary/20 p-4">
            <p className="text-sm font-medium">확인 누르면 이동할 주소</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              비워 두면 확인을 눌렀을 때 모달만 닫혀요. 채우면 같은 탭에서 그 주소로 이동해요.
            </p>
            <input
              aria-label="등록 완료 후 이동할 URL"
              type="url"
              value={successRedirectUrl}
              onChange={(e) => setSuccessRedirectUrl(e.target.value)}
              className={successRedirectInvalid ? FIELD_CLS_DANGER : inputCls}
              placeholder="https://..."
            />
            {successRedirectInvalid && (
              <p className="text-[11px] text-destructive">http:// 또는 https:// 주소를 입력해 주세요.</p>
            )}
          </div>
        </section>
        </>
        )}
      </div>

      <RegistrationFormPreview
        fields={previewForm.fields}
        privacyText={previewForm.privacyText}
        marketingText={previewForm.marketingText}
        privacyBody={previewForm.privacyBody}
        marketingBody={previewForm.marketingBody}
        privacyDefaultChecked={previewForm.privacyDefaultChecked}
        marketingDefaultChecked={previewForm.marketingDefaultChecked}
        // 제3자 제공 동의는 아직 번역 표에 없다 — 편집 중 값을 그대로 쓴다(후속 작업).
        thirdPartyEnabled={thirdPartyEnabled}
        thirdPartyText={thirdPartyText}
        thirdPartyBody={thirdPartyBody}
        thirdPartyDefaultChecked={thirdPartyDefaultChecked}
        submitLabel={previewForm.submitLabel}
        successCta={previewForm.successCta}
        theme={previewTheme}
        slug={webinar.slug}
      />
    </div>
  );
}

/**
 * 언어 막대 — 편집할 언어를 고르고, 언어를 더하고 지운다.
 *
 * ── 왜 폼 하나에 언어 여러 개인가 ─────────────────────────────────────
 * 홈페이지를 언어별 페이지로 나눠 쓰면(국문 `/`, 영문 `/en/`) 폼도 둘로 만들고 싶어지는데,
 * 그러면 **등록 데이터가 두 명단으로 갈라진다** — 입장 확인·CSV·리마인더가 전부 두 벌이 되고,
 * 합치는 일은 사람이 손으로 하게 된다. 그래서 폼은 하나, 문구만 언어별이다.
 * 방문자가 보는 언어는 임베드 로더가 **호스트 페이지에서 읽어** 서버가 정한다(lib/form-locale).
 *
 * ── 삭제가 항상 보이는 자리에 있는 이유 ───────────────────────────────
 * 언어를 더할 수 있으면 지울 수도 있어야 하고, 그 버튼이 hover 에만 있으면 터치 기기에서는
 * 없는 것과 같다. 지금 고른 언어 바로 옆에 둔다(파괴적이므로 확인 단계는 거친다).
 */
function WebinarFormLocaleBar({
  form,
  locales,
  active,
  baseLocale,
  onSelect,
  onChange,
}: {
  form: WebinarRegistrationFormConfig;
  locales: string[];
  active: string;
  baseLocale: string;
  onSelect: (locale: string) => void;
  onChange: (next: WebinarRegistrationFormConfig, nextLocale?: string) => void;
}) {
  const confirm = useConfirm();
  const translated = useMemo(() => new Set(webinarFormTranslatedLocales(form)), [form]);
  const addable = FORM_LOCALES.filter((l) => !locales.includes(l.code));
  const mismatch = useMemo(() => webinarFormLocaleMismatch(form), [form]);

  const changeBase = async (next: string) => {
    if (next === baseLocale) return;
    const ok = await confirm({
      title: `원문 언어를 ${formLocaleLabel(next)}(으)로 바꿀까요?`,
      description: `적어 둔 글은 그대로 남고, "이 문구는 ${formLocaleLabel(next)}로 쓰였다" 는 표시만 바뀌어요. 그다음부터 ${formLocaleLabel(baseLocale)} 번역을 추가할 수 있어요.`,
      confirmLabel: "원문 언어 변경",
    });
    if (!ok) return;
    onChange(retagWebinarFormLocale(form, next), next);
    toast.success(`원문 언어를 ${formLocaleLabel(next)}(으)로 바꿨어요`);
  };

  const removeActive = async () => {
    const ok = await confirm({
      title: `${formLocaleLabel(active)} 번역을 지울까요?`,
      description:
        "이 언어로 적어 둔 문구가 전부 사라져요. 지우고 나면 그 언어 페이지에서도 기본 언어 폼이 나갑니다.",
      confirmLabel: "번역 삭제",
      tone: "danger",
    });
    if (!ok) return;
    onChange(dropWebinarFormLocale(form, active), baseLocale);
    toast.success(`${formLocaleLabel(active)} 번역을 지웠어요`);
  };

  return (
    <div className={`${R.surface} bg-card p-3 ${FINISH.s2}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Languages className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

        {locales.map((code) => {
          const isBase = code === baseLocale;
          const on = code === active;
          return (
            <button
              key={code}
              type="button"
              onClick={() => onSelect(code)}
              aria-pressed={on}
              className={`rounded-lg px-2.5 py-1 text-xs transition-shadow ${on ? `bg-violet-500/12 ${FINISH.s2Key}` : "hover:bg-secondary"}`}
            >
              {formLocaleLabel(code)}
              {isBase ? (
                <span className="ml-1 text-[10px] text-muted-foreground">기본</span>
              ) : (
                // 한 글자도 안 적은 언어는 그렇게 보여야 한다 — 안 그러면 "만들어 뒀다"와
                // "실제로 나간다"를 구분할 수 없다(방문자 화면은 글이 있을 때만 바뀐다).
                !translated.has(code) && <span className="ml-1 text-[10px] text-amber-600">비어 있음</span>
              )}
            </button>
          );
        })}

        {addable.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const code = e.target.value;
              if (!code) return;
              onChange({ ...form, locales: [...form.locales, code] }, code);
            }}
            aria-label="번역 언어 추가"
            className="rounded-lg bg-secondary/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <option value="">+ 언어 추가</option>
            {addable.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            원문 언어
            <select
              value={baseLocale}
              onChange={(e) => void changeBase(e.target.value)}
              className="rounded-lg bg-secondary/60 px-2 py-1 text-xs text-foreground"
            >
              {/* 번역이 이미 들어 있는 언어는 막는다 — 원문과 덮개가 같은 언어로 겹치면
                  어느 쪽이 보일지 알 수 없다. */}
              {FORM_LOCALES.map((l) => {
                const taken = l.code !== baseLocale && translated.has(l.code);
                return (
                  <option key={l.code} value={l.code} disabled={taken}>
                    {l.label}
                    {taken ? " (번역 있음)" : ""}
                  </option>
                );
              })}
            </select>
          </label>

          {active !== baseLocale && (
            <button type="button" onClick={() => void removeActive()} className={btnCls("dangerQuiet")}>
              <Trash2 className="h-3.5 w-3.5" />
              {formLocaleLabel(active)} 삭제
            </button>
          )}
        </div>
      </div>

      {mismatch && (
        <p className="mt-2 rounded-lg bg-amber-500/8 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          원문 언어가 <b>{formLocaleLabel(baseLocale)}</b>로 되어 있는데, 적혀 있는 글은{" "}
          <b>{formLocaleLabel(mismatch)}</b>로 보여요. 오른쪽 <b>원문 언어</b>를 {formLocaleLabel(mismatch)}로 바꾸면{" "}
          {formLocaleLabel(baseLocale)} 번역을 추가할 수 있어요.
        </p>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {active === baseLocale ? (
          <>
            항목·동의 문구 <b className="text-foreground">구조는 여기서만</b> 바꿔요. 다른 언어 탭에서는 같은 구조에
            문구만 채웁니다 — 그래야 어느 언어로 등록해도 한 명단에 쌓여요.
          </>
        ) : (
          <>
            영문 페이지(<code className="rounded bg-secondary px-1">/en/</code>)에 같은 임베드 코드를 붙이면 이 번역이
            자동으로 나가요. 라이브 페이지 링크에는{" "}
            <code className="rounded bg-secondary px-1">?lang={active}</code>를 붙이세요.
          </>
        )}
      </p>
    </div>
  );
}
