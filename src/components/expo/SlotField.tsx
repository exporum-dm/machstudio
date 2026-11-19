"use client";

import { useId } from "react";
import { Link2 } from "lucide-react";
import { Field, FieldArea, FieldSelect, FINISH, R, UrlField } from "@/components/ui/primitives";
import { safeHttpUrl } from "@/lib/webinar-config";
import { EXPO_LIMITS } from "@/lib/expo/registry";
import type { FieldIssue, SlotDef } from "@/lib/expo/types";
import { ExpoMediaUploadField } from "@/components/expo/fields/ExpoMediaUploadField";
import type { ExpoImageValue } from "@/lib/expo/sections/types";

/**
 * 슬롯 한 칸의 편집 컨트롤 — **카탈로그가 위젯을 고른다.**
 *
 * 타입마다 손으로 폼을 짜지 않는 이유: 슬롯 정의 하나가 편집·정규화·렌더를 동시에
 * 결정한다(`registry.ts` 머리말). 손수 짜기 시작하면 타입을 추가할 때 손댈 곳이 세 곳이 되고,
 * 셋이 갈라지는 순간 "편집기에서는 되는데 공개에서는 안 나오는" 값이 생긴다.
 *
 * ── 값은 그 자리에서 바로 고쳐진다 ────────────────────────────────────
 * 접기·모달 뒤에 숨기지 않는다. 값 하나 바꾸는 데 **0클릭**(바로 타이핑)이다(AGENTS.md §2).
 *
 * ── 로케일 ────────────────────────────────────────────────────────────
 * 편집하는 로케일은 **사이트의 defaultLocale** 이다. 방문자에게 나가는 글이므로 편집 UI 의
 * 언어가 아니라 그 사이트가 말하는 언어에 넣어야 한다(공개 로더도 그 값으로 읽는다 —
 * `app/h/[pageId]/loader.ts`).
 *
 * W1 은 한 번에 한 벌만 편집한다. 맵에 다른 로케일이 이미 있을 수 있으므로 **지우지 않는다** —
 * 우리가 안 보여 주는 값을 우리가 없애면 안 된다.
 *
 * 그리고 편집 중에는 **trim 하지 않는다.** 공용 `toLocalized` 는 값을 trim 하는데, 그걸
 * 타이핑 경로에 쓰면 띄어쓰기를 칠 때마다 지워져 문장을 못 쓴다. 저장 때 서버 정규화가
 * 어차피 다듬는다(`config.ts`).
 */

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === "object" && !Array.isArray(v) ? (v as Dict) : {});

function readLocalized(value: unknown, locale: string): string {
  if (typeof value === "string") return value;
  const dict = asDict(value);
  // **자기 속성만** 본다 — 맵은 객체 리터럴이라 "constructor" 같은 상속 키가 함수를 준다.
  const own = Object.prototype.hasOwnProperty.call(dict, locale) ? dict[locale] : undefined;
  return typeof own === "string" ? own : "";
}

/** 다른 로케일은 그대로 두고 편집 로케일만 갈아 끼운다. */
function writeLocalized(current: unknown, locale: string, text: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(asDict(current))) {
    if (typeof value === "string") next[key] = value;
  }
  next[locale] = text;
  return next;
}

/** 링크 대상 후보 — 이 사이트의 다른 페이지. `page:{id}` 로 저장되고 렌더에서 풀린다. */
export interface LinkTarget {
  id: string;
  title: string;
}

export interface SlotFieldProps {
  def: SlotDef;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  /** 이미지 업로드 대상. */
  siteId: string;
  /** 사전등록 소스 후보. */
  sources?: readonly { id: string; name: string; isActive: boolean }[];
  /** 내부 링크 후보. */
  pages?: readonly LinkTarget[];
  /** 어느 로케일에 쓰는가 — 사이트의 defaultLocale. */
  locale: string;
  /**
   * 목록 행 안의 칸 — 더 촘촘하게 그린다.
   *
   * **라벨은 그대로 둔다.** 처음엔 접었는데 하니스에서 보니 카드 한 행이 이미지·태그·제목·
   * 설명·링크로 **세로로 쌓여서**, 값을 채우고 나면 어느 칸이 태그이고 어느 칸이 제목인지
   * 구분할 수 없었다(placeholder 는 타이핑하는 순간 사라진다). 열이 아니라 스택이라
   * 테이블 머리글이 대신해 주지도 않는다. 라벨만 작게 만든다.
   */
  compact?: boolean;
  /** 이 슬롯을 가리키는 서버 구조화 오류. path는 구획 content 기준 상대 경로다. */
  issues?: readonly FieldIssue[];
}

export function SlotField({
  def, value, onChange, disabled, siteId, sources, pages, locale, compact, issues = [],
}: SlotFieldProps) {
  const uid = useId();
  const id = `${uid}-${def.key}`;

  const control = (() => {
    switch (def.kind) {
      case "text":
        return (
          <Field
            id={id}
            aria-label={def.label}
            value={readLocalized(value, locale)}
            onChange={(event) => onChange(writeLocalized(value, locale, event.target.value))}
            disabled={disabled}
            /* 서버가 자르는 길이와 같다 — 잘린 뒤에 알려 주면 이미 늦다. */
            maxLength={EXPO_LIMITS.textChars}
          />
        );

      case "textarea":
        return (
          <FieldArea
            id={id}
            aria-label={def.label}
            value={readLocalized(value, locale)}
            onChange={(event) => onChange(writeLocalized(value, locale, event.target.value))}
            disabled={disabled}
            rows={compact ? 2 : 4}
          />
        );

      case "code":
        return (
          <FieldArea
            id={id}
            aria-label={def.label}
            /* 로케일 맵이 아니다 — 코드에 번역은 없다(`config.ts` 의 case "code"). */
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            rows={6}
            spellCheck={false}
            className="font-mono text-[12px]"
          />
        );

      case "link":
        return (
          <LinkField
            id={id} label={def.label} value={value} onChange={onChange}
            disabled={disabled} pages={pages}
          />
        );

      case "media":
        return (
          <ExpoMediaUploadField
            siteId={siteId}
            kind="image"
            label={def.label}
            value={asDict(value).kind === "image" ? value as ExpoImageValue : undefined}
            onChange={onChange}
            disabled={disabled}
          />
        );

      case "sourceRef":
        return (
          <SourceRefField
            id={id} label={def.label} value={value} onChange={onChange}
            disabled={disabled} sources={sources}
          />
        );

      case "list":
        // 목록은 EditableList 골격이 필요해 호출부가 그린다 — 여기 오면 조립이 잘못된 것이다.
        return null;
    }
  })();

  if (!control) return null;

  return (
    <div className="min-w-0" data-field-path={issues[0]?.path}>
      <label
        htmlFor={id}
        className={`block font-medium text-muted-foreground ${compact ? "text-[11px]" : "text-xs"}`}
      >
        {def.label}
        {def.required ? <span className="ml-1 text-[var(--destructive)]">필수</span> : null}
      </label>
      <div className={compact ? "mt-0.5" : "mt-1"}>{control}</div>
      {issues.map((issue, index) => (
        <p
          key={`${issue.code}:${issue.path}:${index}`}
          role={issue.severity === "error" ? "alert" : "status"}
          className="mt-1 text-[11px] text-[var(--destructive)]"
        >
          {issue.message}
        </p>
      ))}
    </div>
  );
}

/**
 * 링크 — **대상을 먼저 고르고 주소를 적는다.**
 *
 * 내부 페이지를 고르면 `page:{id}` 로 저장된다. 그래야 그 페이지의 아임웹 주소가 나중에
 * 바뀌어도 링크가 따라간다 — 절대주소로 박아 두면 이사 갈 때마다 전 페이지를 다시 손봐야 한다.
 */
function LinkField({
  id, label, value, onChange, disabled, pages,
}: {
  id: string; label: string; value: unknown;
  onChange: (v: unknown) => void; disabled?: boolean; pages?: readonly LinkTarget[];
}) {
  const link = asDict(value);
  const text = typeof link.label === "string" ? link.label : "";
  const href = typeof link.href === "string" ? link.href : "";
  const internal = href.startsWith("page:") ? href.slice("page:".length) : null;

  const write = (next: { label?: string; href?: string }) =>
    onChange({ ...link, label: text, href, ...next });

  return (
    <div className="space-y-1.5">
      <Field
        id={id}
        aria-label={`${label} 문구`}
        value={text}
        placeholder="버튼에 쓸 말"
        onChange={(event) => write({ label: event.target.value })}
        disabled={disabled}
        maxLength={EXPO_LIMITS.textChars}
      />

      {pages && pages.length > 0 ? (
        <FieldSelect
          aria-label={`${label} 연결 대상`}
          value={internal ?? ""}
          onChange={(event) => {
            const pageId = event.target.value;
            // 내부 → 직접 주소로 되돌릴 때 앞서 적어 둔 주소를 되살리지 않는다.
            // 되살리면 "페이지를 골랐다가 마음을 바꿨더니 옛 주소가 부활" 하는 셈이다.
            write({ href: pageId ? `page:${pageId}` : "" });
          }}
          disabled={disabled}
        >
          <option value="">직접 주소</option>
          {pages.map((page) => (
            <option key={page.id} value={page.id}>{page.title}</option>
          ))}
        </FieldSelect>
      ) : null}

      {internal ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          이 사이트의 페이지로 연결돼요. 실제 주소는 그 페이지의 아임웹 주소로 풀립니다 —
          아직 비어 있으면 이 링크는 공개 화면에서 빠져요.
        </p>
      ) : (
        <UrlField
          label={`${label} 주소`}
          value={href}
          onChange={(next) => write({ href: next })}
          placeholder="https://…"
          disabled={disabled}
          leadingIcon={<Link2 className="h-3.5 w-3.5" aria-hidden />}
          isValidHttpUrl={(v) => Boolean(safeHttpUrl(v))}
        />
      )}
    </div>
  );
}

function SourceRefField({
  id, label, value, onChange, disabled, sources,
}: {
  id: string; label: string; value: unknown; onChange: (v: unknown) => void;
  disabled?: boolean; sources?: readonly { id: string; name: string; isActive: boolean }[];
}) {
  const current = typeof value === "string" ? value : "";

  /**
   * 빈 상태가 이 면에서 참인가 — 복사해 온 문구를 그대로 두지 않는다(AGENTS.md).
   * 여기서 고를 수 있는 건 **같은 전시의 빌더 폼**뿐이다.
   */
  if (!sources || sources.length === 0) {
    return (
      <p className={`${R.surface} ${FINISH.s2} bg-secondary px-3 py-2 text-[11px] leading-relaxed text-muted-foreground`}>
        이 전시에 만들어 둔 사전등록 폼이 없어요. 사전등록에서 먼저 만들면 여기서 고를 수 있어요.
      </p>
    );
  }

  return (
    <FieldSelect
      id={id}
      aria-label={label}
      value={current}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">고르지 않음</option>
      {sources.map((source) => (
        <option key={source.id} value={source.id}>
          {source.name}{source.isActive ? "" : " (비활성)"}
        </option>
      ))}
    </FieldSelect>
  );
}
