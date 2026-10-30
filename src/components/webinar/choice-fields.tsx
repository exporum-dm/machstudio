"use client";

/**
 * 등록 폼의 **선택형 필드 두 종류** — 드롭다운(select)과 복수 선택(multiple).
 *
 * 왜 페이지에서 꺼냈나: 만들기·등록은 로그인 뒤에 있어 자동화로 열 수 없고, 두 컴포넌트의
 * 핵심 동작(최대 개수 잠금·기타 직접입력 복원·저장 값 형태)은 **눌러 봐야** 확인된다.
 * 격리해 두면 /dev/choice-harness 가 그대로 태워 검증할 수 있다(row-harness 와 같은 방식).
 *
 * 저장 값 규약 — 이 두 컴포넌트가 밖으로 내보내는 것은 문자열 하나뿐이다:
 *   select   : 고른 선택지, 또는 기타로 쓴 문장
 *   multiple : 고른 항목들을 ", " 로 합친 문자열(joinMultiValue)
 * 어느 경우에도 '기타' 같은 마커는 값에 넣지 않는다 — 이유는 아래 OTHER_LABEL 주석 참고.
 */

import { useState } from "react";
import { joinMultiValue, maxSelectFor, splitMultiValue } from "@/lib/webinar-config";

/**
 * '기타(직접입력)' 라벨 — 화면 문구는 한 곳에서만 정한다(임베드 로더도 같은 문구를 쓴다).
 *
 * ⚠ 저장 값에는 이 문구도, 어떤 마커도 넣지 않는다. 저장되는 건 **사용자가 쓴 문장**뿐이다.
 * 마커를 저장 값에 태우면 "기타" 를 고르고 아무것도 안 쓴 등록이 값 "기타" 로 남아
 * 등록자 목록·CSV 에 아무 정보 없는 행이 생긴다. 그래서 "기타를 골랐는가" 는
 * 컴포넌트의 로컬 상태로만 들고, 밖으로는 실제 답만 내보낸다.
 */
const OTHER_LABEL = "기타(직접입력)";

/** 저장된 값이 어드민 선택지에 없으면 기타로 쓴 답이다 — 새로고침 후 상태 복원의 근거. */
function looksLikeOther(options: readonly string[], value: string): boolean {
  return value.trim() !== "" && !options.includes(value);
}

/** 드롭다운 + 기타 직접입력. */
export function SingleChoiceField({
  field, value, onChange, inputStyle, publicForm = false,
}: {
  field: { key: string; label: string; options?: string[]; allowOther?: boolean };
  value: string;
  onChange: (next: string) => void;
  inputStyle: React.CSSProperties;
  publicForm?: boolean;
}) {
  const options = field.options ?? [];
  // 기타를 고른 직후에는 값이 아직 비어 있어 "미선택" 과 구분되지 않는다 → 로컬 플래그가 필요하다.
  const [otherOn, setOtherOn] = useState(() => looksLikeOther(options, value));
  const showOther = field.allowOther === true && (otherOn || looksLikeOther(options, value));

  return (
    <>
      <select
        value={showOther ? OTHER_LABEL : value}
        onChange={(e) => {
          if (e.target.value === OTHER_LABEL) { setOtherOn(true); onChange(""); return; }
          setOtherOn(false);
          onChange(e.target.value);
        }}
        className={publicForm ? "mw-select" : "w-full px-3 py-2.5 text-sm bg-transparent focus:outline-none"}
        style={publicForm ? undefined : inputStyle}
      >
        <option value="">선택해주세요</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
        {field.allowOther && <option value={OTHER_LABEL}>{OTHER_LABEL}</option>}
      </select>
      {showOther && (
        <input
          type="text"
          aria-label={`${field.label} 직접 입력`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="직접 입력해주세요"
          className={publicForm ? "mw-input" : "mt-1.5 w-full px-3 py-2.5 text-sm bg-transparent focus:outline-none"}
          style={publicForm ? undefined : inputStyle}
        />
      )}
    </>
  );
}

/**
 * 복수 선택 + 최대 개수 + 기타 직접입력.
 *
 * 값은 고른 항목을 ", " 로 합친 한 문자열이다(joinMultiValue) — 배열이 아닌 이유는
 * webinar-config.ts 의 주석 참고. 상한에 닿으면 **안 고른 칸을 비활성**한다: 눌러도 안 되는
 * 이유를 옆 문구가 말해 주지 않으면 고장으로 읽힌다.
 */
export function MultiChoiceField({
  field, value, onChange, accent, inputStyle, publicForm = false,
}: {
  field: { key: string; label: string; options?: string[]; allowOther?: boolean; maxSelect?: number; type: string };
  value: string;
  onChange: (next: string) => void;
  accent: string;
  inputStyle: React.CSSProperties;
  publicForm?: boolean;
}) {
  const options = field.options ?? [];
  const max = maxSelectFor({ type: "multiple", maxSelect: field.maxSelect, options });
  const picked = splitMultiValue(value);
  // 선택지에 없는 값 = 기타로 쓴 답. 하나만 인정한다(기타 칸이 하나이므로).
  const otherAnswer = picked.find((p) => !options.includes(p)) ?? "";
  const [otherOn, setOtherOn] = useState(() => otherAnswer !== "");
  const showOther = field.allowOther === true && (otherOn || otherAnswer !== "");
  // 기타를 체크한 직후에는 직접입력 값이 아직 비어 picked에 들어가지 않는다. 체크 자체를 한 자리로
  // 세지 않으면 max=1에서도 일반 옵션을 하나 더 고를 수 있고 제출 때 서버 상한 검증에 걸린다.
  const selectedCount = picked.length + (showOther && otherAnswer === "" ? 1 : 0);
  const atMax = max !== null && selectedCount >= max;

  const setPicked = (next: string[]) => onChange(joinMultiValue(next));
  const toggle = (option: string) => {
    setPicked(picked.includes(option) ? picked.filter((p) => p !== option) : [...picked, option]);
  };

  /**
   * 터치 타깃 — 라벨 한 줄은 20px 였다(실측). 5개가 연달아 붙은 목록에서 20px 행은
   * 모바일에서 옆 항목을 누르게 된다. 행 높이 44px + 항목 간 8px 로 WCAG AA 를 맞춘다.
   * 체크박스 자체는 브라우저 기본 13px 이지만 **라벨 전체가 타깃**이라 실제 타깃은 44px 행이다.
   */
  return (
    <div className={publicForm ? "mw-multi" : "space-y-2"}>
      {options.map((option) => {
        const on = picked.includes(option);
        // 상한에 닿으면 안 고른 칸만 잠근다 — 고른 칸은 항상 해제할 수 있어야 빠져나올 수 있다.
        const locked = atMax && !on;
        return (
          <label
            key={option}
            className={publicForm
              ? "mw-check"
              : `flex min-h-11 items-start gap-2.5 py-3 text-sm leading-5 ${locked ? "opacity-40" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={locked}
              onChange={() => toggle(option)}
              className={publicForm ? undefined : "m-0 mt-px size-[18px] shrink-0"}
              style={publicForm ? undefined : { accentColor: accent }}
            />
            <span>{option}</span>
          </label>
        );
      })}

      {field.allowOther && (
        <label className={publicForm
          ? "mw-check"
          : `flex min-h-11 items-start gap-2.5 py-3 text-sm leading-5 ${atMax && !showOther ? "opacity-40" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            checked={showOther}
            disabled={atMax && !showOther}
            onChange={(e) => {
              setOtherOn(e.target.checked);
              // 끄면 기타로 쓴 답만 빼고 나머지 선택은 유지한다.
              if (!e.target.checked) setPicked(picked.filter((p) => options.includes(p)));
            }}
            className={publicForm ? undefined : "m-0 mt-px size-[18px] shrink-0"}
            style={publicForm ? undefined : { accentColor: accent }}
          />
          <span>{OTHER_LABEL}</span>
        </label>
      )}

      {showOther && (
        <input
          type="text"
          aria-label={`${field.label} 직접 입력`}
          value={otherAnswer}
          onChange={(e) => {
            const kept = picked.filter((p) => options.includes(p));
            // 쉼표가 있어도 괜찮다 — joinMultiValue 가 구분자와 섞이지 않게 큰따옴표로 감싼다.
            const next = e.target.value;
            setPicked(next.trim() ? [...kept, next] : kept);
          }}
          placeholder="직접 입력해주세요"
          className={publicForm ? "mw-input" : "w-full px-3 py-2.5 text-sm bg-transparent focus:outline-none"}
          style={publicForm ? undefined : inputStyle}
        />
      )}

      {max !== null && (
        <p className={publicForm ? "mw-hint" : "text-[11px] opacity-50"}>
          최대 {max}개까지 선택할 수 있어요{atMax ? " — 다른 항목을 고르려면 먼저 하나를 해제해주세요" : ""}
        </p>
      )}
    </div>
  );
}
