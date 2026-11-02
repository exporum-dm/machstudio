# Waiting Card, Calendar Banner, and Entry Form Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대기 화면의 캘린더와 추가 CTA를 의도한 위치와 형태로 재배치하고, 입장 화면의 사전등록 폼을 랜딩 공개 폼과 동일한 UI 계약으로 통합한다.

**Architecture:** 기존 `livePage.waiting.followUp`과 등록 폼 설정은 유지한다. 대기 화면은 `PreLiveWaiting`의 표시 구조만 재구성하고, 등록 폼은 정적 공용 CSS 계약을 로더와 React 입장 모달이 함께 소비하도록 한다. 등록 성공 후 사라지는 원래 버튼 대신 지속되는 시청 화면 루트를 포커스 복원 대상으로 사용한다.

**Tech Stack:** Next.js 16.2.6 App Router, React 19.2.4, TypeScript, Vitest + jsdom, Framer Motion

## Global Constraints

- 공개 화면 색은 `buildStkCss`의 accent/text/surface 파생 토큰만 사용한다.
- 공개 섹션은 설정 토글과 실제 데이터가 모두 있을 때만 노출한다.
- 캘린더 배너는 600px 이하에서만 보인다.
- 사용자 문구의 줄바꿈을 보존한다.
- 기존 설정 키와 데이터베이스 구조를 바꾸지 않는다.
- 모든 동작 변경은 실패하는 테스트를 먼저 확인한 뒤 구현한다.
- 모바일 375px과 데스크톱 1440px을 모두 검증한다.

---

### Task 1: 대기 화면 캘린더 배너와 추가 카드 재배치

**Files:**
- Modify: `src/app/webinar/[slug]/__tests__/pre-live-waiting.test.tsx`
- Modify: `src/app/webinar/[slug]/PreLiveWaiting.tsx`
- Modify: `src/app/(app)/webinar/[slug]/LivePageTab.tsx`
- Modify: `src/lib/webinar-exposure.ts`
- Modify: `src/lib/__tests__/webinar-exposure.test.ts`

**Interfaces:**
- Consumes: `LivePageConfig["waiting"]["followUp"]`, `safeHttpUrl`
- Produces: `.plw-calendar-banner`, `.plw-info-stack`, `.plw-follow-up-card`

- [ ] **Step 1: 캘린더 배너와 카드 위치를 고정하는 실패 테스트 작성**

```tsx
it("캘린더는 모바일 전용 하단 배너 마크업으로 표시한다", () => {
  const view = renderWaiting(
    { livePage: { waiting: { calendar: true } } },
    2,
    { hasCalendar: true, onCalendar: vi.fn() },
  );
  expect(view.querySelector(".plw-calendar-banner")).toBeTruthy();
  expect(view.querySelector(".plw-ctas .calendar")).toBeNull();
  expect(view.querySelector("style")?.textContent).toContain(
    "@media (min-width:601px)"
  );
});

it("추가 카드는 이 웨비나는 소개 카드 다음에 놓이고 아젠다 없이도 보인다", () => {
  const view = renderWaiting({
    livePage: {
      waiting: {
        agenda: false,
        followUp: {
          enabled: true,
          text: "자료는 종료 후 보내드려요.",
          ctaLabel: "행사 안내",
          ctaUrl: "https://example.com",
        },
      },
    },
  });
  const stack = view.querySelector(".plw-info-stack")!;
  expect(stack.children[0]).toHaveClass("plw-panel");
  expect(stack.children[1]).toHaveClass("plw-follow-up-card");
  expect(view.querySelector(".plw-ag")).toBeNull();
});
```

테스트 헬퍼는 선택적으로 공개 동작 props를 받도록 확장한다.

```tsx
function renderWaiting(
  config: Record<string, unknown>,
  waitingCount = 2,
  actions: { hasCalendar?: boolean; onCalendar?: () => void } = {},
) {
  // 기존 createRoot 설정을 유지하고 PreLiveWaiting에 actions를 전달한다.
}
```

- [ ] **Step 2: 집중 테스트를 실행해 기존 구현에서 실패하는지 확인**

Run:

```bash
npx vitest run 'src/app/webinar/[slug]/__tests__/pre-live-waiting.test.tsx'
```

Expected: `.plw-calendar-banner`, `.plw-info-stack`, `.plw-follow-up-card`가 없어 FAIL.

- [ ] **Step 3: 대기 화면 구조와 STK 토큰 기반 스타일 구현**

```tsx
const showUtilityCtas = showShare || showNotify;
const showInfoBand = showAgenda || showFollowUp;

{showUtilityCtas && (
  <div className="plw-ctas">
    {showShare && (
      <motion.button whileTap={{ scale: 0.97 }} transition={spring} onClick={onShare} className="plw-btn">
        <Share2 /> {shareCopied ? "링크 복사됨 ✓" : "초대 공유"}
      </motion.button>
    )}
    {showNotify && (
      <motion.button whileTap={{ scale: 0.97 }} transition={spring} onClick={onNotify} disabled={notify?.pending} className={`plw-btn ${notify?.subscribed ? "on" : ""}`}>
        <Bell /> {notify?.subscribed ? "알림 받는 중 ✓" : "시작 알림 받기"}
      </motion.button>
    )}
  </div>
)}

{showInfoBand && (
  <div className={`plw-band${showAgenda ? "" : " single"}`}>
    <div className="plw-info-stack">
      <div className="plw-panel">
        <h3>이 웨비나는</h3>
        <div className="big">{webinar.name}</div>
        {webinar.description && <div className="desc">{webinar.description}</div>}
      </div>
      {showFollowUp && (
        <div className="plw-follow-up-card">
          {followUpText && <p>{followUp.text}</p>}
          {showFollowUpCta && (
            <a href={followUpUrl} target="_blank" rel="noopener noreferrer">
              {followUp.ctaLabel}
            </a>
          )}
        </div>
      )}
    </div>
  </div>
)}

{showCalendar && (
  <div className="plw-calendar-banner">
    <span>웨비나 일정을 미리 저장해두세요.</span>
    <button type="button" onClick={onCalendar}>캘린더 추가</button>
  </div>
)}
```

현재 `.plw-ag` 블록 전체는 내용 변경 없이 `plw-info-stack` 다음 형제로 옮기고 `showAgenda` 조건부 JSX 블록으로 감싼다.

CSS requirements:

```css
.stk-live .plw-calendar-banner {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: max(12px, env(safe-area-inset-bottom));
  z-index: 40;
  background: color-mix(in srgb, var(--text) 88%, transparent);
  color: var(--card);
  box-shadow: 0 16px 48px color-mix(in srgb, var(--text) 28%, transparent);
  backdrop-filter: blur(20px);
}
@media (min-width:601px) {
  .stk-live .plw-calendar-banner { display:none; }
}
.stk-live .plw-info-stack { display:flex; flex-direction:column; gap:20px; }
.stk-live .plw-band.single { grid-template-columns:minmax(0, 1fr); max-width:680px; margin-inline:auto; }
```

`LivePageTab`의 편집 블록 이름을 `이 웨비나는 추가 카드`로 바꾸고, `webinar-exposure.ts`의 공개 위치 설명도 같은 용어로 맞춘다.

- [ ] **Step 4: 집중 테스트와 노출표 테스트 실행**

Run:

```bash
npx vitest run \
  'src/app/webinar/[slug]/__tests__/pre-live-waiting.test.tsx' \
  'src/lib/__tests__/webinar-exposure.test.ts'
```

Expected: PASS.

- [ ] **Step 5: 변경 커밋**

```bash
git add \
  'src/app/webinar/[slug]/__tests__/pre-live-waiting.test.tsx' \
  'src/app/webinar/[slug]/PreLiveWaiting.tsx' \
  'src/app/(app)/webinar/[slug]/LivePageTab.tsx' \
  src/lib/webinar-exposure.ts \
  src/lib/__tests__/webinar-exposure.test.ts
git commit -m "fix(대기): 캘린더 배너와 안내 카드를 의도한 위치로 이동"
```

### Task 2: 랜딩과 입장 화면의 공개 등록 폼 UI 통합

**Files:**
- Create: `src/lib/webinar-public-form-css.ts`
- Modify: `src/lib/webinar-loader-script.ts`
- Modify: `src/components/webinar/choice-fields.tsx`
- Modify: `src/app/webinar/[slug]/live/page.tsx`
- Create: `src/app/webinar/[slug]/__tests__/entry-registration-form-parity.test.tsx`
- Modify: `src/lib/__tests__/webinar-loader-cta.test.ts`
- Regenerate: `src/generated/landing-runtime.ts`

**Interfaces:**
- Produces: `PUBLIC_REGISTRATION_FORM_CSS: string`
- Consumes: `.mw-form-card`, `.mw-field`, `.mw-label`, `.mw-input`, `.mw-select`, `.mw-check`, `.mw-multi`, `.mw-hint`, `.mw-submit`, `.mw-msg-error`
- Extends: `SingleChoiceField` and `MultiChoiceField` with `publicForm?: boolean`

- [ ] **Step 1: 공용 CSS 계약과 입장 모달 패리티 실패 테스트 작성**

```tsx
it("입장 화면 등록 모달이 랜딩 공개 폼 클래스 계약을 사용한다", () => {
  const view = renderLivePageInEntryState();
  clickByText(view, "사전등록하기");
  expect(view.querySelector(".mw-modal-overlay")).toBeTruthy();
  expect(view.querySelector(".mw-form-card")).toBeTruthy();
  expect(view.querySelectorAll(".mw-field").length).toBeGreaterThan(0);
  expect(view.querySelector(".mw-check")).toBeTruthy();
  expect(view.querySelector(".mw-submit")).toBeTruthy();
});

it("등록 성공 뒤 완료 모달을 닫으면 연결된 시청 화면 루트로 포커스를 복원한다", async () => {
  const view = renderLivePageInEntryState({ registerResponse: successResponse });
  await submitRegistration(view);
  await closeCompletion(view);
  expect(document.activeElement).toBe(view.querySelector("[data-viewer-focus-root]"));
});
```

로더 테스트에는 다음 계약을 추가한다.

```ts
expect(document.querySelector(".mw-form-card")).toBeTruthy();
expect(document.querySelector(".mw-input")).toBeTruthy();
expect(document.querySelector(".mw-check")).toBeTruthy();
expect(document.getElementById("mw-styles")?.textContent)
  .toContain("--mw-accent");
```

- [ ] **Step 2: 집중 테스트를 실행해 공용 계약 부재로 실패하는지 확인**

Run:

```bash
npx vitest run \
  'src/app/webinar/[slug]/__tests__/entry-registration-form-parity.test.tsx' \
  'src/lib/__tests__/webinar-loader-cta.test.ts'
```

Expected: 입장 모달에 `.mw-*` 공개 폼 클래스와 지속 포커스 대상이 없어 FAIL.

- [ ] **Step 3: 공용 공개 폼 CSS와 선택형 필드 변형 구현**

`src/lib/webinar-public-form-css.ts`:

```ts
export const PUBLIC_REGISTRATION_FORM_CSS = `
.mw-form-card {
  width:100%;
  max-width:520px;
  padding:28px 24px;
  border:0;
  border-radius:calc(var(--mw-radius, 12px) * 1.34);
  background:var(--mw-surface);
  color:var(--mw-text);
  box-shadow:0 24px 64px rgba(0,0,0,.24);
}
.mw-label { display:block; margin-bottom:6px; font-size:13px; font-weight:600; color:var(--mw-text); }
.mw-input,.mw-select { width:100%; min-height:44px; padding:11px 13px; border:1px solid color-mix(in srgb,var(--mw-text) 24%,transparent); border-radius:9px; background:var(--mw-surface); color:var(--mw-text); }
.mw-input:focus,.mw-select:focus { border-color:var(--mw-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--mw-accent) 16%,transparent); outline:0; }
.mw-check { display:flex; align-items:flex-start; gap:9px; min-height:20px; font-size:13px; line-height:20px; color:color-mix(in srgb,var(--mw-text) 68%,transparent); }
.mw-submit { width:100%; min-height:46px; background:var(--mw-accent); color:#fff; }
`;
```

`choice-fields.tsx`는 `publicForm`이 true일 때 랜딩 클래스 계약을 렌더한다.

```tsx
const selectClass = publicForm ? "mw-select" : DEFAULT_SELECT_CLASS;
const multiClass = publicForm ? "mw-multi" : "space-y-2";
const checkClass = publicForm ? "mw-check" : DEFAULT_CHECK_CLASS;
```

- [ ] **Step 4: 로더와 입장 모달을 같은 CSS 계약으로 연결**

`webinar-loader-script.ts`의 CSS 배열에 공용 CSS를 한 항목으로 넣고 런타임 루트에 변수를 설정한다.

```ts
import { PUBLIC_REGISTRATION_FORM_CSS } from "./webinar-public-form-css";

// generated loader buildCss()
".mw-reset { --mw-accent:" + t.accent + "; --mw-radius:" + t.radius + "; --mw-text:" + t.text + "; --mw-surface:" + t.surface + "; }",
${JSON.stringify(PUBLIC_REGISTRATION_FORM_CSS)},
```

로더의 `theme()`은 저장된 `textColor`와 `surfaceColor`를 읽어 `text`, `surface`로 반환한다. 값이 없는 레거시 설정에만 기존 공개 폼의 기본 글자색·표면색을 폴백으로 사용한다.

`live/page.tsx`:

```tsx
<div
  ref={viewerFocusRootRef}
  data-viewer-focus-root
  tabIndex={-1}
  className="min-h-screen"
>
  <style dangerouslySetInnerHTML={{ __html: PUBLIC_REGISTRATION_FORM_CSS }} />
  <div className="mw-modal-overlay mw-reset" style={publicFormVars}>
    <motion.div className="mw-modal-card mw-form-card">
      <div className="mw-form-title">{webinar.name} 사전등록</div>
      {visibleFields.map(renderRegistrationField)}
      <button className="mw-btn mw-btn-primary mw-submit">{registrationForm.submitLabel}</button>
    </motion.div>
  </div>
</div>
```

기존 시청 화면 자식들은 위 루트 안에서 그대로 유지하고 등록 모달의 클래스 계약만 교체한다.

완료 모달의 복원 대상은 연결된 원래 버튼이 없으면 `viewerFocusRootRef.current`를 사용한다.

```tsx
restoreFocusTo={
  registrationOpener?.isConnected
    ? registrationOpener
    : viewerFocusRootRef.current
}
```

- [ ] **Step 5: 랜딩 런타임 재생성 후 집중 테스트 실행**

Run:

```bash
npm run build:landing-runtime
npx vitest run \
  'src/app/webinar/[slug]/__tests__/entry-registration-form-parity.test.tsx' \
  'src/lib/__tests__/webinar-loader-cta.test.ts' \
  'src/app/webinar/[slug]/__tests__/viewer-modal.test.tsx'
```

Expected: PASS.

- [ ] **Step 6: 변경 커밋**

```bash
git add \
  src/lib/webinar-public-form-css.ts \
  src/lib/webinar-loader-script.ts \
  src/components/webinar/choice-fields.tsx \
  'src/app/webinar/[slug]/live/page.tsx' \
  'src/app/webinar/[slug]/__tests__/entry-registration-form-parity.test.tsx' \
  src/lib/__tests__/webinar-loader-cta.test.ts \
  src/generated/landing-runtime.ts
git commit -m "fix(등록): 입장 화면 폼을 랜딩 공개 폼과 통합"
```

### Task 3: 통합 검증과 브라우저 마감

**Files:**
- Modify only if verification exposes a regression in Task 1 or Task 2 files.
- Evidence: `.superpowers/sdd/2026-07-29-registration-waiting-cta/final-ui-evidence/`

**Interfaces:**
- Verifies: public waiting screen, entry registration modal, landing loader form, completion focus handoff

- [ ] **Step 1: 관련 테스트 묶음 실행**

```bash
npx vitest run \
  'src/app/webinar/[slug]/__tests__' \
  'src/lib/__tests__/webinar-loader-cta.test.ts' \
  'src/lib/__tests__/webinar-exposure.test.ts' \
  'src/app/(app)/webinar/[slug]/__tests__'
```

Expected: PASS.

- [ ] **Step 2: 타입 검사와 전체 테스트 실행**

```bash
npx tsc --noEmit
npm test
```

Expected: 타입 오류 0개, 전체 테스트 PASS.

- [ ] **Step 3: 프로덕션 빌드 실행**

```bash
set -a
source '<repo>/.env.local'
set +a
npm run build
```

Expected: build 완료.

- [ ] **Step 4: 375px과 1440px 브라우저 확인**

확인 항목:

- 375px 대기 화면에서 캘린더 하단 배너가 보인다.
- 1440px 대기 화면에서 캘린더 배너와 캘린더 인라인 버튼이 모두 보이지 않는다.
- `이 웨비나는` 소개 카드 아래에 추가 카드가 쌓인다.
- 아젠다 OFF, 인원 밴드 OFF에서도 추가 카드가 독립적으로 보인다.
- 입장 화면의 `사전등록하기` 모달과 랜딩 등록 모달의 카드 폭, 필드, 선택형 입력, 체크박스, 제출 버튼이 일치한다.
- 등록 완료 모달을 닫은 뒤 포커스가 시청 화면 루트에 남는다.

- [ ] **Step 5: 검증 중 수정이 있었다면 해당 테스트와 함께 커밋**

```bash
git add \
  'src/app/webinar/[slug]/__tests__/pre-live-waiting.test.tsx' \
  'src/app/webinar/[slug]/PreLiveWaiting.tsx' \
  'src/app/(app)/webinar/[slug]/LivePageTab.tsx' \
  src/lib/webinar-exposure.ts \
  src/lib/__tests__/webinar-exposure.test.ts \
  src/lib/webinar-public-form-css.ts \
  src/lib/webinar-loader-script.ts \
  src/components/webinar/choice-fields.tsx \
  'src/app/webinar/[slug]/live/page.tsx' \
  'src/app/webinar/[slug]/__tests__/entry-registration-form-parity.test.tsx' \
  src/lib/__tests__/webinar-loader-cta.test.ts \
  src/generated/landing-runtime.ts
git diff --cached --quiet || git commit -m "fix(웨비나): 공개 대기·등록 화면 검증 보완"
```
