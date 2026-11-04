"use client";

/**
 * 사전등록 빌더의 항목 카드 — **한 행 = 한 항목, 그 자리에서 바로 수정**(AGENTS.md §2).
 *
 * 웨비나의 FieldCard 와 겉이 비슷하지만 편집 대상이 다르다:
 *  · 라벨이 로케일 맵이다(지금은 영어 단일이라 기본 로케일 한 칸만 그린다).
 *  · **key 를 운영자가 정한다.** 웨비나는 system 필드의 key 가 잠겨 있다.
 *  · 분기 기준 표시가 붙는다.
 * 형식 어휘와 선택 메뉴만 공용(field-types)이고 카드는 각자 그린다 — 합치면 제네릭과 분기가
 * 카드 안에 쌓여 양쪽 다 읽기 어려워진다.
 */
import { type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { FIELD_CLS, FINISH, R, SELECTED_TEXT } from "@/components/ui/primitives";
import { OptionRows } from "@/components/ui/option-rows";
import {
  CHOICE_TYPES,
  REG_TYPE_META,
  RegTypeMenu,
  useRegPopover,
  type BuilderFieldType,
} from "@/components/form-builder/field-types";
import {
  DEFAULT_LOCALE,
  NOTICE_KEY_PREFIX,
  localize,
  toLocalized,
  type CollectField,
} from "@/lib/collect-form-config";

/** 라벨에서 저장 key 를 만든다 — 운영자가 직접 정하기 전의 초안. */
export function keyFromLabel(label: string, taken: ReadonlySet<string>): string {
  const base = label
    .trim().toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "field";
  // 예약 접두는 피한다 — 안내 체크박스 키와 겹치면 필수 동의가 우회된다.
  const safe = base.startsWith(NOTICE_KEY_PREFIX) ? `f_${base}` : base;
  if (!taken.has(safe)) return safe;
  for (let i = 2; ; i += 1) if (!taken.has(`${safe}_${i}`)) return `${safe}_${i}`;
}

export function CollectFieldCard({
  field,
  setFields,
  handle,
  removeButton,
  isBranchKey,
  onMakeBranch,
  takenKeys,
}: {
  field: CollectField;
  setFields: Dispatch<SetStateAction<CollectField[]>>;
  handle: ReactNode | null;
  removeButton: (opts?: { label?: string }) => ReactNode | null;
  /** 이 항목이 유형 분기의 기준인가. */
  isBranchKey: boolean;
  /** 분기 기준으로 지정/해제. select·radio 일 때만 준다. */
  onMakeBranch: ((on: boolean) => void) | null;
  /** 이미 쓰인 key 들 — 중복이면 저장해도 하나가 버려지므로 그 자리에서 알린다. */
  takenKeys: ReadonlySet<string>;
}) {
  // 반환 객체를 통째로 들고 있으면 컴파일러가 ref 를 품은 객체로 보고 렌더 중 접근을 막는다(react-hooks/refs).
  const { open: typeOpen, setOpen: setTypeOpen, ref: typeRef } = useRegPopover();
  const patch = (next: Partial<CollectField>) =>
    setFields((all) => all.map((f) => (f.id === field.id ? { ...f, ...next } : f)));

  const meta = REG_TYPE_META[field.type];
  const TypeIcon = meta.icon;
  const labelText = localize(field.label, DEFAULT_LOCALE);
  const optionTexts = field.options.map((o) => localize(o, DEFAULT_LOCALE));
  const isChoice = CHOICE_TYPES.includes(field.type);
  // 기타도 하나의 선택지로 센다 — 최대 개수가 이 수 이상이면 제한이 없는 것과 같다(정규화가 버린다)
  const choiceCount = optionTexts.filter((t) => t.trim()).length + (field.allowOther ? 1 : 0);
  // 저장 직전이 아니라 **입력 시점에** 알린다(AGENTS.md: 검증은 해당 필드 바로 아래 인라인).
  const keyError = !field.key
    ? "저장 키가 필요해요"
    : field.key.startsWith(NOTICE_KEY_PREFIX)
      ? `'${NOTICE_KEY_PREFIX}' 로 시작하는 키는 안내 동의용으로 예약돼 있어요`
      : takenKeys.has(field.key)
        ? "다른 항목이 이미 쓰는 키예요"
        : "";

  const changeType = (t: BuilderFieldType) => {
    setTypeOpen(false);
    if (t === field.type) return;
    const next: Partial<CollectField> = { type: t };
    if (t !== "multiple") next.maxSelect = undefined;
    // 선택형이 아니게 되면 선택지·기타 허용은 버린다(남겨 두면 다시 선택형으로 바꿀 때
    // 예전 목록이 유령처럼 살아 돌아온다).
    if (!CHOICE_TYPES.includes(t)) { next.options = []; next.allowOther = undefined; }
    // 하나만 고르는 select·radio만 분기 기준으로 쓴다.
    if (t !== "select" && t !== "radio" && isBranchKey) onMakeBranch?.(false);
    patch(next);
  };

  return (
    <div className={`${R.surface} bg-secondary ${FINISH.s2} transition-colors focus-within:bg-secondary/70 ${field.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-1 px-2 pt-2">
        {handle}
        <div className="relative" ref={typeRef}>
          <button
            type="button"
            onClick={() => setTypeOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={typeOpen}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-background px-2 py-1.5 text-xs font-semibold shadow-sm transition-shadow hover:shadow"
          >
            <span className="grid h-5 w-5 place-items-center rounded-lg bg-violet-500/10 text-violet-500"><TypeIcon className="h-3 w-3" /></span>
            {meta.label}
            <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
          </button>
          {typeOpen && <RegTypeMenu current={field.type} onPick={changeType} />}
        </div>

        {isBranchKey && (
          <span className={`ml-1.5 flex shrink-0 items-center gap-1 rounded-full bg-violet-500/12 px-1.5 py-0.5 text-[10px] font-semibold ${SELECTED_TEXT}`}>
            <GitBranch className="h-2.5 w-2.5" />분기 기준
          </span>
        )}
        <span className="flex-1" />
        <label className={`flex shrink-0 select-none items-center gap-1 text-[11px] ${field.required ? "font-semibold text-amber-600" : "text-muted-foreground"}`}>
          필수<Switch checked={field.required} onChange={(v) => patch({ required: v })} label={`${labelText || "항목"} 필수`} />
        </label>
        <label className="flex shrink-0 select-none items-center gap-1 text-[11px] text-muted-foreground">
          표시<Switch checked={field.enabled} onChange={(v) => patch({ enabled: v })} label={`${labelText || "항목"} 표시`} />
        </label>
        <label className={`flex shrink-0 select-none items-center gap-1 text-[11px] ${field.showInDashboard !== false ? "font-semibold text-violet-600 dark:text-violet-300" : "text-muted-foreground"}`}>
          통계<Switch checked={field.showInDashboard !== false} onChange={(v) => patch({ showInDashboard: v })} label={`${labelText || "항목"} 대시보드 통계`} />
        </label>
        {removeButton({ label: `${labelText || "항목"} 삭제` }) ?? <span className="w-8 shrink-0" />}
      </div>

      <div className="px-3 pb-3 pl-[42px] pt-1">
        <input
          value={labelText}
          onChange={(e) => patch({ label: toLocalized(e.target.value) })}
          aria-label="항목 이름"
          placeholder="항목 이름 (예: First name)"
          className="w-full bg-transparent pb-1 text-[14px] font-semibold tracking-tight outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
        />

        {/* 저장 키는 **항상 보인다.** 접어 두면 한 번 정해진 뒤 바꾸면 안 되는 값이라는 게
            전달되지 않고, 중복·예약어 문제도 저장 후에야 드러난다. */}
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">key</span>
          <input
            value={field.key}
            onChange={(e) => patch({ key: e.target.value.trim() })}
            aria-label="저장 키"
            className={`min-w-0 flex-1 bg-transparent py-1 font-mono text-[11px] outline-none ${keyError ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
          />
        </div>
        {keyError && <p className="pb-1 text-[11px] text-red-600 dark:text-red-400">{keyError}</p>}

        {(field.type === "text" || field.type === "email" || field.type === "tel" || field.type === "number") && (
          <input
            value={localize(field.placeholder, DEFAULT_LOCALE)}
            onChange={(e) => patch({ placeholder: toLocalized(e.target.value) })}
            placeholder={
              field.type === "tel"
                ? "입력 예시 (예: 2025550147)"
                : field.type === "number"
                  ? "입력 예시 (예: 3)"
                  : "입력 예시 — 응답 칸에 회색으로 (선택)"
            }
            aria-label="입력 예시"
            className={`${FIELD_CLS} mt-1 text-[13px]`}
          />
        )}

        {isChoice && (
          <div className="mt-2">
            <OptionRows
              value={optionTexts}
              onChange={(next) => patch({ options: next.map((t) => toLocalized(t)) })}
              markerShape={field.type === "multiple" ? "square" : "circle"}
              ownerLabel="항목"
              ownerTitle={labelText}
              listId={`copt:${field.id}`}
            />
            {/* 기타(직접 입력) · 최대 선택 개수 — 저장·검증은 이미 받았는데 고를 곳이 없었다(2026-11-03) */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex select-none items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch checked={field.allowOther === true} onChange={(v) => patch({ allowOther: v ? true : undefined })} label={`${labelText || "항목"} 기타 직접 입력`} />
                &ldquo;기타(직접 입력)&rdquo; 넣기
              </label>
              {field.type === "multiple" && (
                <label className="flex select-none items-center gap-1.5 text-[11px] text-muted-foreground">
                  최대
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={field.maxSelect ?? ""}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      patch({ maxSelect: Number.isInteger(n) && n >= 1 ? n : undefined });
                    }}
                    placeholder="제한 없음"
                    aria-label={`${labelText || "항목"} 최대 선택 개수`}
                    className={`${FIELD_CLS} h-7 w-24 text-[12px]`}
                  />
                  개까지 선택
                </label>
              )}
            </div>
            {field.type === "multiple" && field.maxSelect != null && field.maxSelect >= choiceCount && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                선택지가 {choiceCount}개라 {field.maxSelect}개 제한은 걸리지 않아요 — 선택지 수보다 작게 적어 주세요.
              </p>
            )}
            {(field.type === "select" || field.type === "radio") && onMakeBranch && (
              <label className="mt-2 flex select-none items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch checked={isBranchKey} onChange={onMakeBranch} label="이 항목으로 유형 분기" />
                이 항목으로 유형별 문항 분기 (폼당 하나)
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
