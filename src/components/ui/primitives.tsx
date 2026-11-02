"use client";

import { cn } from "@/lib/utils";

/**
 * 만들기 화면의 시각 프리미티브 — 표면·입력·컨트롤.
 *
 * 왜 만드는가: 측정된 드리프트가 값의 문제가 아니라 **선언 위치의 문제**였다.
 *   · `border border-border` 마감 153곳 (AGENTS: 외곽선 대신 그림자)
 *   · `inputCls` 선언 여러 곳, 실제 값 3종 상이 — 같은 입력칸이 탭마다 다르게 생겼다
 *   · 반경 6종 혼용 (rounded-md 17곳·rounded-sm 3곳은 사실상 사고)
 * 그래서 새 룩을 발명하지 않고 **한 곳에서만 정의되게** 만든다.
 *
 * 마감 규칙(실측 근거는 globals.css 토큰 옆에 기록):
 * 이 팔레트에는 3:1 을 넘는 면 경계가 없다. 라이트는 --card 와 --background 가 같은 색이고,
 * 다크는 검정 그림자가 보이지 않는다. 유일하게 남는 신호가 --border(다크 1.32:1)라서
 * **헤어라인을 그림자 선언 안에 넣는다**(아래 FINISH). border 유틸을 지우는 방향이 아니다.
 *
 * 한 파일에 모은 이유: 여섯 조각이 같은 스케일을 공유하고, 파일이 갈리면 그 스케일이
 * 다시 갈린다 — 이 컴포넌트들이 존재하는 이유 자체가 그 재발 방지다.
 *
 * 포커스는 여기서 다루지 않는다. globals.css 의 전역 규칙 한 곳이 소유하므로
 * 프리미티브·화면은 focus 관련 클래스를 쓰지 않는다(예전엔 관용구가 3종으로 갈라져 있었다).
 */


import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

/**
 * 마감을 **Tailwind 임의값**으로 쓴다(globals.css 의 손수 쓴 .finish-* 클래스가 아니라).
 * 이유: 하니스에서 실측했는데 globals.css 에 top-level 로 넣은 .finish-* 가 서브된 CSS 에
 * 하나도 나타나지 않았다 — 같은 파일의 .shadow-card·.mach-toaster 는 나타나고 내 새 클래스만
 * 0개였다(같은 파일의 다른 편집인 포커스 링 var(--ring) 은 반영됨 → 캐시 문제 아님).
 * 임의값은 소스 스캔으로 생성이 보장되므로 이 경로를 쓴다.
 */
export const FINISH = {
  /** 1단 면 — 헤어라인 + 카드 엘리베이션 */
  s1: "shadow-[inset_0_0_0_1px_var(--border),var(--shadow-card)]",
  /** 2단 면·입력 — 헤어라인만 */
  s2: "shadow-[inset_0_0_0_1px_var(--border)]",
  /**
   * 2단 면의 오류 상태. s2 **대신** 쓴다 — 덧붙이면 안 된다.
   * 둘 다 box-shadow 를 쓰는 같은 유틸(shadow-[…])이라, 한 요소에 둘을 얹으면
   * 승자가 className 순서가 아니라 **생성된 CSS 안의 순서**로 정해진다(제어 불가).
   * 그래서 조립부에서 하나를 고르게 만든다.
   */
  s2Danger: "shadow-[inset_0_0_0_1px_var(--destructive)]",
  /** 오버레이 — 다크 --popover 가 --card 와 같은 값이라 한 단 강한 --input 을 헤어라인으로 */
  overlay:
    "shadow-[inset_0_0_0_1px_var(--input),0_12px_32px_-12px_rgb(0_0_0/0.18)] " +
    "dark:shadow-[inset_0_0_0_1px_var(--input),0_16px_40px_-16px_rgb(0_0_0/0.75)]",
  /** 솔리드 컨트롤 — 헤어라인 없이 최소 리프트 */
  control: "shadow-[0_1px_1px_rgb(20_20_25/0.05)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.45)]",
  /** 선택된 것의 헤어라인 — 중립 --border 대신 키 컬러로 (아래 SELECTED 참고) */
  s2Key: "shadow-[inset_0_0_0_1px_var(--ring)]",
  /**
   * 대체 요소(img·video)용 헤어라인 — **밖으로** 그린다.
   * inset 은 여기서 안 통한다: 페인트 순서가 배경 → inset 그림자 → 내용이라 이미지 픽셀이
   * 헤어라인을 덮는다. 하니스에서 실측했다(120px 원형 img 에 inset 8px 빨강 = 아예 안 보임,
   * 같은 조건 outset = 선명). border 대신 이걸 쓰는 이유는 레이아웃 크기를 바꾸지 않는 것.
   */
  hairlineOut: "shadow-[0_0_0_1px_var(--border)]",
} as const;

/**
 * 반경 3단. rounded-full 은 4번째 단이 아니라 **별개 축**이다 — 값이 아니라 형태이고,
 * 반경이 높이로 결정되는 것(상태 점·아바타·스위치 트랙·pill)만 해당한다.
 */
export const R = {
  /** 누르거나 타이핑하는 모든 것. rounded-md·sm·bare 를 여기로 흡수. */
  control: "rounded-lg",
  /** 승격된 면과 반복 항목 행. EditableList 행 셸이 이미 이 값이다. */
  surface: "rounded-xl",
  /** 섹션 카드·팝오버·모달처럼 가장 바깥 면. rounded-3xl 을 흡수. */
  panel: "rounded-2xl",
} as const;

/**
 * 선택 상태 — **면 색조가 아니라 키 컬러**로 표시한다.
 *
 * 승격(bg-card)으로 표현하면 테마에 따라 방향이 뒤집힌다. 레일(bg-secondary) 위에서
 * bg-card 의 명도는 라이트 L* 96.52 → 100 으로 **올라가지만** 다크는 15.20 → 7.78 로
 * **내려간다**(하니스 실측). 즉 라이트에서 솟고 다크에서 파인다. 다크에서 레일보다 밝은
 * 면이 필요한데 색조 사다리에 그런 값이 없다 — secondary 가 이미 그 사다리의 위쪽이다.
 *
 * 그래서 선택은 승격이 아니라 **정체**로 말한다. 승격은 "이건 떠 있다" 고, 선택은
 * "이거다" 다 — 애초에 다른 말이다. Segmented 가 이미 이 방식이었고, 여기로 끌어올렸다.
 *
 * 경계를 지는 건 틴트가 아니라 **키 헤어라인(s2Key)** 이다. 하니스에서 캔버스 합성으로 실측:
 *                       라이트        다크
 *   레일                245,245,245  38,38,38
 *   선택면(틴트 합성)    217,222,228  35,40,46
 *   면 대비              1.24         1.02   ← 다크는 틴트만으로는 사실상 안 보인다
 *   키 헤어라인 vs 레일  5.47:1       4.87:1 ← 실제 경계는 이것 (WCAG 1.4.11 의 3:1 통과)
 *   중립 헤어라인 vs 레일 1.16         1.37   ← --border 로는 애초에 불가능했다
 *   선택 글자 대비       10.76:1      4.78:1 (둘 다 AA 통과)
 */
export const SELECTED_SURFACE = `bg-violet-500/12 ${FINISH.s2Key}`;
export const SELECTED_TEXT = "text-violet-600 dark:text-violet-300";
export const SELECTED = `${SELECTED_SURFACE} ${SELECTED_TEXT}`;

// ─────────────────────────────────────────────────────────────────────────────
// Surface — 면. level 로 색조를 고르고 마감은 자동.
// ─────────────────────────────────────────────────────────────────────────────

export function Surface({
  level = 1,
  radius = "panel",
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: {
  /**
   * 1 = 페이지 위에 놓이는 카드(bg-card).
   * 2 = 카드 **안**의 행·틴트 영역(bg-secondary).
   * 3단은 만들지 않는다 — 색조 사다리가 고갈되는 지점이 곧 위계 설계가 틀린 지점이다.
   */
  level?: 1 | 2;
  radius?: keyof typeof R;
  as?: "div" | "section" | "li";
  className?: string;
  children?: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const tone = level === 1 ? `bg-card ${FINISH.s1}` : `bg-secondary ${FINISH.s2}`;
  return (
    <Tag className={`${R[radius]} ${tone} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * 안내 문구 안의 "저기 가서 하세요" 를 **누를 수 있게** 만든다.
 *
 * IA 진단이 이걸 핵심 근거로 들었다: "그 구멍을 UI 가 안내 문장 18개로 메꾸는데,
 * 그중 클릭 가능한 링크는 0개입니다." 문서 0단계의 항목이고, 문서는 이 단계만으로
 * 체감 결함의 절반이 사라진다고 봤다.
 *
 * 문장 안에 인라인으로 놓이므로 버튼처럼 보이지 않게 한다 — 밑줄 + 키 컬러.
 * 링크가 아니라 button 인 이유: 목적지가 URL 이 아니라 **같은 페이지의 탭·섹션 상태**다
 * (내비 상태는 URL 이 단일 소스지만 이동은 라우터 호출로 한다).
 */
export function JumpLink({
  onClick,
  children,
  className = "",
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline items-center gap-0.5 rounded font-medium underline decoration-violet-500/40 underline-offset-2 transition-colors hover:decoration-violet-500 ${SELECTED_TEXT} ${className}`}
    >
      {children}
      <span aria-hidden> ↗</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Blk — 편집 블록. IA 문서 프로토타입의 `.blk` 패턴.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 값의 성격을 라벨로 말한다. IA 진단의 핵심이 "여러 화면에 걸치는 값은 집이 없어진다" 였고,
 * 문서는 그 답으로 블록마다 **이게 어떤 종류의 값인지** 를 붙였다.
 *   fact — 사실. 여러 산출물이 읽어가는 원본.
 *   read — 읽기. 다른 곳이 소유한 값의 거울(여기서는 못 고친다).
 *   risk — 위험. 라이브 중이면 시청자에게 즉시 반영되는 값.
 *   sync — 연동. 다른 화면(운영 콘솔)과 양방향으로 같은 키를 쓴다.
 */
export type BlkTag = "fact" | "read" | "risk" | "sync";
const BLK_TAG: Record<BlkTag, { label: string; cls: string }> = {
  fact: { label: "사실", cls: "bg-violet-500/12 text-violet-600 dark:text-violet-300" },
  read: { label: "읽기", cls: "bg-secondary text-muted-foreground" },
  risk: { label: "위험", cls: "bg-amber-500/12 text-amber-700 dark:text-amber-400" },
  sync: { label: "연동", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" },
};

/**
 * 편집 블록 한 칸.
 *
 * 왜 필요했나: 로그인해서 실제 화면을 보니 시청 화면의 섹션 5개가 제목 14px + 설명 12px +
 * 입력의 **같은 반복**이라 400여 줄이 하나의 벽으로 읽혔다. 앞서 나는 "고치는 영역에서
 * 동등한 항목은 같은 무게가 맞다" 고 판단했는데, 5개가 쌓이면 훑을 수가 없다 — 실물이 반증했다.
 *
 * `goes` 는 이 값이 **어느 공개 면에 나가는지** 를 적는다. IA 진단이 지적한 바로 그 구멍
 * ("테마 6컨트롤은 6개 공개 면 전부에 적용되는데 '라이브 페이지' 안에만 있었다")을
 * 화면에서 메꾸는 장치다. 주석이 아니라 UI 로 답한다.
 *
 * ⚠ 이 배열은 **손으로 적지 않는다** — `goesFor("waiting", "entry")` 로 노출 표에서 가져온다
 * (webinar-exposure.ts). 문자열로 적던 동안 13곳이 각자 라벨을 들고 있어서, 없는 면을
 * 약속해도·면 이름이 바뀌어도 아무도 몰랐다. 이 프리미티브는 도메인을 모르는 채로 두고
 * (타입은 string[]) 타입 안전은 호출부의 goesFor 가 맡는다 — SurfaceId 오타는 컴파일 에러다.
 */
export function Blk({
  title,
  hint,
  tag,
  goes,
  pinned = false,
  action,
  className = "",
  children,
}: {
  title: string;
  hint?: ReactNode;
  tag?: BlkTag;
  /** 이 값이 나가는 공개 면 — 반드시 `goesFor(...)` 의 반환값을 넘긴다(위 주석 참고). */
  goes?: readonly string[];
  /** 가장 위험하고 자주 만지는 블록 — 한 화면에 하나만. 마감을 한 단 올린다. */
  pinned?: boolean;
  /** 헤더 우측 컨트롤(토글·링크 등). goes 와 함께 쓰면 goes 가 아래로 내려간다. */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const t = tag ? BLK_TAG[tag] : null;
  return (
    <section
      className={`bg-card p-4 ${R.panel} ${
        pinned ? "shadow-[inset_0_0_0_1px_var(--ring),var(--shadow-card)]" : FINISH.s1
      } ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* 제목 크기는 14px 그룹 단을 유지한다 — 문서 프로토타입은 12.5px 이지만 이 앱의
            제목 스케일은 화면 16 / 영역 12 표지 / 그룹 14 로 이미 고정했고, 여기서 네 번째
            크기를 만들면 그 스케일이 다시 갈린다. 구분은 카드 면과 태그가 맡는다. */}
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {t && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${t.cls}`}>
            {t.label}
          </span>
        )}
        {action && <span className="ml-auto shrink-0">{action}</span>}
        {goes && goes.length > 0 && (
          <span className={`flex flex-wrap items-center gap-1 ${action ? "" : "ml-auto"}`}>
            <span className="text-[10px] text-muted-foreground/70">나가는 곳</span>
            {goes.map((g) => (
              <span key={g} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {g}
              </span>
            ))}
          </span>
        )}
      </div>
      {hint && <p className="mb-3 -mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Field — 입력 한 벌. 여기가 유일한 선언 위치.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 입력만은 헤어라인 + 채운 배경을 **둘 다** 쓴다.
 * 헤어라인: 입력의 경계선은 장식이 아니라 어포던스 자체(타이핑 가능한 사각형의 범위)이고,
 *           입력은 카드 위·행 위·틴트 위 어디에도 놓이므로 부모에 의존하지 않는 자기 경계가 필요하다.
 * 채운 배경: 다크에서 --background(0.145)는 카드(0.205)·행(0.269)보다 어두워 '움푹 파인 우물'로
 *           읽힌다 — 이 신호를 버리면 다크에서 입력·행·카드의 톤 사다리가 붕괴한다.
 */
/**
 * 입력 클래스 문자열 — 컴포넌트로 아직 못 바꾼 곳이 **값만이라도 하나를 쓰게** 하려고 export 한다.
 * 지금 탭마다 로컬 inputCls 를 선언하고 실제 값이 3종으로 갈려 있어서(px-2.5 py-1.5 rounded-lg /
 * px-3 py-2 rounded-xl / px-3 py-2 rounded-lg) 같은 입력칸이 탭마다 다르게 생겼다.
 * 각 파일의 로컬 선언을 이 import 로 바꾸면 JSX 를 건드리지 않고 값이 통일된다.
 * 최종 목표는 <Field> 컴포넌트지만, 그 이관은 파일별로 따로 한다.
 */
/** 마감을 뺀 몸통. 마감은 항상 **한 개만** 뒤에 붙는다(s2 또는 s2Danger). */
const FIELD_BODY =
  "w-full min-h-9 bg-background px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted-foreground/50 transition-shadow " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  R.control;

/**
 * FIELD_CLS 는 **폭을 소유한다**(FIELD_BODY 가 w-full 로 시작).
 *
 * 호출부에서 `${FIELD_CLS} w-28` 처럼 폭 클래스를 덧붙이면 **아무 효과가 없다** — 같은 레이어·
 * 같은 명시도라 컴파일된 CSS 의 소스 순서가 승자를 정하고, .w-full 이 .w-24/.w-28/.w-auto 보다
 * 뒤에 온다. className 문자열에서 뒤에 쓴 것은 무효다.
 *
 * 이 함정에 세 곳이 걸렸고 그중 둘은 사용자가 **입력할 수 없는 24px 조각**을 만들었다
 * (랜딩 프로그램 제목·FAQ 질문 — 그 두 필드가 공개 노출을 가르는 값이라 "추가해도 안 나온다"
 * 로 보고됐다). 좁은 칸이 필요하면 **래퍼가 폭을 갖고 입력은 w-full 을 유지**한다:
 *   <div className="w-28 shrink-0"><input className={FIELD_CLS} /></div>
 */
export const FIELD_CLS = `${FIELD_BODY} ${FINISH.s2}`;
/** 오류 상태 입력 — FIELD_CLS 와 **둘 중 하나**만 쓴다(위 s2Danger 주석 참고). */
export const FIELD_CLS_DANGER = `${FIELD_BODY} ${FINISH.s2Danger}`;

export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Field({ className = "", invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(invalid ? FIELD_CLS_DANGER : FIELD_CLS, className)}
        {...rest}
      />
    );
  },
);

export const FieldArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function FieldArea({ className = "", invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(invalid ? FIELD_CLS_DANGER : FIELD_CLS, "resize-y leading-relaxed", className)}
      {...rest}
    />
  );
});

export const FieldSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function FieldSelect({ className = "", children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(FIELD_CLS, className)} {...rest}>
        {children}
      </select>
    );
  },
);

/**
 * URL 한 칸 — **스킴을 입력 시점에 강제한다.**
 *
 * 왜 프리미티브인가: 어드민의 URL 칸이 열 곳이 넘는데 전부 맨 input 이었고, 뒤에서 그 값을
 * 검사하는 코드가 **스킴 없는 값을 조용히 버린다.** 실측한 두 갈래 피해:
 *
 *  · **값이 파괴된다** — 종료 화면 설문 URL(config.surveyUrl)은 PATCH 라우트의 sanitizeConfig
 *    가 http(s) 아닌 값을 null 로 만든다. 이미 저장돼 있던 정상 URL 도 운영자가 스킴 없이
 *    다시 적는 순간 **같은 세션에서** 사라지고, 자동저장은 성공이라고 표시한다.
 *    배포 탭 사이트 주소·사전등록 허용 Origin 도 각자 라우트에서 같은 일이 난다.
 *  · **뷰어 링크가 죽는다** — 랜딩 히어로 배경, 종료 화면 자료·다음 웨비나, 라이브 CTA 버튼,
 *    팝업 버튼, 세션 사진·로고. 값은 DB 에 남지만 공개 화면에서 링크·이미지가 안 나온다.
 *
 * 그래서 두 겹으로 막는다:
 *  1) blur 에 `https://` 를 붙여 **정상 입력을 그냥 통과시킨다** — AGENTS.md 의
 *     "입력은 소스에서 정규화 — 안내 문구가 아니라 입력 시점에 강제".
 *  2) 그래도 안 되는 값은 그 자리에서 인라인으로 알린다 — "검증은 제출 전에, 필드 바로 아래".
 *     저장 후 조용히 비워지면 왜 사라졌는지 알 수 없다.
 *
 * `isValidHttpUrl` 는 호출부가 넘긴다 — 이 파일은 프리미티브라 도메인 모듈(webinar-config)을
 * import 하지 않는다. 넘기지 않으면 new URL() 기반 기본 판정을 쓴다.
 */
function defaultIsValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 이미 스킴이 있는가 — `https:`·`mailto:`·`javascript:` 모두 여기서 true 다(붙이지 않는다). */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * 이 문자열의 **호스트 자리가 도메인처럼 생겼는가.** `https://` 를 붙일지 결정하는 유일한 관문이다.
 *
 * 왜 파싱 결과를 믿으면 안 되는가: `new URL()` 은 호스트가 없어도 통과시킨다. 그래서
 * "붙였을 때 파싱되면 붙인다" 는 규칙은 아래를 전부 **조용히 망가진 절대 URL로 바꿔 버린다** —
 *   `/webinarlive`    → https://webinarlive/      (호스트 "webinarlive")
 *   `/files/deck.pdf` → https://files/deck.pdf    (호스트 "files")
 *   `999`             → https://0.0.3.231/        (숫자가 IP 로 해석된다)
 *   `tally`           → https://tally/
 * 게다가 이렇게 만들어진 값은 protocol 이 https 라 safeHttpUrl 검사도 통과하므로 **경고도 안 뜬다.**
 * 실측 피해: 배포 탭 라이브 페이지 URL 에 `/webinarlive` 를 적으면 파트너 사이트의 입장 버튼이
 * 죽은 호스트로 나간다(예전에는 라우트가 null 로 만들고 로더가 올바른 기본 URL 로 폴백했다).
 *
 * 그래서 **원문의 호스트 자리**를 본다 — 점이 있어야 하고(또는 localhost), 파싱 결과는 안 믿는다.
 */
function rawLooksLikeHost(raw: string): boolean {
  // 경로·쿼리·프래그먼트를 떼고, userinfo(@) 뒤를 호스트로, 포트(:)를 뗀다.
  const beforePath = raw.split(/[/?#]/)[0];
  const host = (beforePath.split("@").pop() ?? "").split(":")[0];
  if (host === "localhost") return true;
  return host.includes(".") && !host.startsWith(".") && !host.endsWith(".");
}

export function UrlField({
  label,
  value,
  onChange,
  placeholder,
  id,
  leadingIcon,
  className,
  isValidHttpUrl = defaultIsValidHttpUrl,
  disabled,
  invalidMessage = "https:// 로 시작하는 주소를 넣어주세요. 지금 값은 저장되지 않아요.",
}: {
  /** aria-label. 보이는 라벨이 따로 있으면 id 를 함께 넘겨 htmlFor 로 묶는다. */
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  id?: string;
  /** 칸 안 왼쪽 아이콘(예: Link2). 넘기면 입력에 pl-8 이 붙는다. */
  leadingIcon?: ReactNode;
  className?: string;
  isValidHttpUrl?: (value: string) => boolean;
  disabled?: boolean;
  invalidMessage?: string;
}) {
  const invalid = value.trim() !== "" && !isValidHttpUrl(value);
  return (
    <div className={className}>
      {/* 아이콘의 기준은 **입력칸만** 감싼 이 상자다. 바깥 상자를 기준으로 잡으면 아래 경고
          문구가 뜨는 순간 상자가 높아져 아이콘이 같이 내려간다(top-1/2 기준이 바뀌므로). */}
      <div className="relative">
        {leadingIcon && (
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            {leadingIcon}
          </span>
        )}
        <input
          id={id}
          aria-label={label}
          aria-invalid={invalid || undefined}
          type="url"
          inputMode="url"
          disabled={disabled}
          className={`${invalid ? FIELD_CLS_DANGER : FIELD_CLS} ${leadingIcon ? "pl-8" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            /* 스킴만 없는 **도메인** 이면 붙여서 살린다. 이미 스킴이 있거나, 호스트 자리가
               도메인처럼 생기지 않았으면(내부 경로·숫자·한 단어) 건드리지 않는다 —
               건드리면 뜻이 바뀐 URL 을 만들면서 경고도 안 뜬다(rawLooksLikeHost 주석). */
            if (raw && !HAS_SCHEME.test(raw) && rawLooksLikeHost(raw) && isValidHttpUrl(`https://${raw}`)) {
              onChange(`https://${raw}`);
            }
          }}
          placeholder={placeholder}
        />
      </div>
      {invalid && <p className="mt-1 text-[11px] leading-relaxed text-red-500">{invalidMessage}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Btn / Chip / Segmented — 컨트롤
// ─────────────────────────────────────────────────────────────────────────────

type BtnTone = "key" | "quiet" | "danger" | "dangerQuiet" | "ghost";

/**
 * tone 이 색을 정하고 마감은 자동. violet 리터럴을 화면에서 직접 쓰지 않게 하는 게 목적이다
 * (지금 `text-violet-600 dark:text-violet-400` 같은 짝을 손으로 반복하는 곳이 많다).
 */
const BTN_TONE: Record<BtnTone, string> = {
  key: `bg-violet-500 text-white hover:bg-violet-600 ${FINISH.control}`,
  quiet: `bg-secondary text-foreground hover:bg-secondary/70 ${FINISH.control}`,
  /**
   * 다크에서 글자색이 **뒤집힌다.** --destructive 가 테마별로 명도가 반대라서다:
   *   라이트 oklch(0.577) = rgb(231,0,11)  → 흰 글자 4.77:1 ✅
   *   다크  oklch(0.704) = rgb(255,100,103) → 흰 글자 2.89:1 ❌ (AA 4.5 미달)
   *                                          → 잉크 글자 6.21:1 ✅
   * 하니스에서 눈으로 보고 계산해 잡았다 — 다크의 삭제 버튼이 연한 빨강에 흰 글자였다.
   */
  danger: `bg-destructive text-white dark:text-[oklch(0.205_0_0)] hover:opacity-90 ${FINISH.control}`,
  /**
   * 파괴적 동작을 **여는** 버튼(확인 단계를 띄우는 쪽). danger 와 다른 톤이 필요한 이유는
   * AGENTS 의 "위험한 저빈도 액션은 멀리·작게" 다 — 채운 빨강을 쓰면 아직 아무것도 지우지
   * 않는 버튼이 화면에서 가장 무거워진다. 색으로 위험을 말하고 무게는 낮춘다.
   * 마감 없음: 리프트를 주면 다시 주요 액션처럼 읽힌다.
   */
  dangerQuiet: "text-destructive hover:bg-destructive/10",
  // ghost 만 마감이 없다 — 면 위에 얹히는 텍스트 액션이라 리프트가 거짓 신호가 된다.
  ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
};

// min-h-9 — 이 코드베이스의 기존 컨트롤 높이. 44px 터치 타깃은 별건으로 남겨 둔다
// (전 컨트롤 높이를 올리면 밀도가 통째로 바뀌어 리디자인 범위를 넘는다).
const BTN_BASE = `inline-flex min-h-9 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${R.control}`;

/**
 * 클래스 문자열만 필요한 곳을 위한 출구. 이 코드베이스의 버튼 상당수가 `motion.button`
 * (whileHover/whileTap)이라 <Btn> 으로 갈아타면 그 프레스 모션을 잃는다. 톤만 빌려 쓰면
 * 색·마감은 한 곳에서 오고 모션은 그대로 남는다.
 */
export function btnCls(tone: BtnTone = "quiet", extra = "") {
  return `${BTN_BASE} ${BTN_TONE[tone]} ${extra}`;
}

export const Btn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone }>(
  function Btn({ tone = "quiet", className = "", type = "button", ...rest }, ref) {
    return <button ref={ref} type={type} className={btnCls(tone, className)} {...rest} />;
  },
);

/** 상태 pill — 반경이 높이로 결정되는 것이라 rounded-full 축이다. */
export function Chip({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: "neutral" | "key" | "warn" | "ok";
  className?: string;
  children: ReactNode;
}) {
  const t = {
    neutral: "bg-secondary text-muted-foreground",
    key: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
    warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${t} ${className}`}>
      {children}
    </span>
  );
}

/**
 * 세그먼트 — 선택 칸을 **--key 계열**로 표현한다. 중립 톤 + 그림자로 하면
 * 다크에서 선택 칸이 컨테이너보다 어두워져 '눌려 들어간 홈'(=비활성 관용구)으로 읽힌다.
 * 색과 링이 두 테마에서 같은 방향을 가리키게 한다.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (next: T) => void;
  /** label 은 ReactNode — 아이콘+글자 칸(랜딩의 '배경 미디어')도 이 컴포넌트로 흡수하려고 넓혔다. */
  options: { value: T; label: ReactNode; hint?: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div className={`inline-flex flex-wrap gap-1 bg-secondary p-1 ${R.control} ${className}`} role="tablist" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`min-h-8 px-3 py-1.5 text-xs font-medium transition-colors ${R.control} ${
              on
                ? SELECTED
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
