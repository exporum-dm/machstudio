/**
 * 임베드 번들의 **소스 트리 해시** — 빌드 스크립트와 stale 검사 테스트가 같이 쓴다.
 *
 * 별도 모듈인 이유: 빌드 스크립트는 최상위 await 로 esbuild 를 돌린다. 테스트가 그걸
 * import 하면 테스트를 돌릴 때마다 번들이 다시 구워진다(그리고 그 순간 stale 검사가
 * 무의미해진다 — 검사 대상을 검사가 새로 만들어 버린다).
 *
 * 파일 목록은 **명시적으로 적는다.** import 그래프를 따라가지 않는 이유는 그러려면 번들러를
 * 돌려야 하고, 그건 위와 같은 문제로 되돌아오기 때문이다. 대신 번들에 들어가는 파일을
 * 새로 추가할 때 여기 적는 것을 잊으면 검사가 조용히 통과한다 — 그래서 목록에
 * "왜 이 파일이 여기 있는지" 를 남긴다.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function hashFiles(files) {
  const hash = createHash("sha256");
  // 줄바꿈을 통일해서 넣는다. Windows 체크아웃은 CRLF 라 바이트로 해시하면 리눅스(CI)와
  // 값이 갈린다 — 개발자 기계에서는 stale 검사가 늘 빨갛고, predev 가 번들을 다시 구우면
  // 해시 한 줄만 바뀐 diff 가 매번 생긴다(실측: landing-runtime 이 dev 때마다 수정됨).
  for (const f of files) hash.update(readFileSync(f, "utf8").split("\r\n").join("\n"));
  return "sha256:" + hash.digest("hex").slice(0, 32);
}

/**
 * 타입만 있는 파일은 번들 입력이 아니다 — esbuild 가 통째로 지운다.
 * 목록에 남겨 두면 metafile 대조가 영영 안 맞고, 그 검사를 느슨하게 만들게 된다.
 * (타입 변경은 런타임 출력을 바꾸지 못하므로 빠져도 stale 검사에 구멍이 생기지 않는다.)
 */
const TYPE_ONLY = new Set(["src/lib/landing/types.ts"]);

function dirTs(root, rel) {
  return readdirSync(join(root, rel))
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !TYPE_ONLY.has(`${rel}/${f}`))
    .sort()
    .map((f) => join(root, rel, f));
}

/**
 * 랜딩 런타임의 입력 파일 — 목록과 해시를 나눠 둔다.
 *
 * 목록을 따로 내보내는 이유: 이 목록이 **실제 번들 입력보다 짧으면** stale 검사는 초록인데
 * 커밋된 번들은 낡을 수 있다. 그게 이 검사가 막으려던 바로 그 상황이라, 목록 자체를
 * esbuild metafile 과 대조하는 테스트가 따로 있다(embed-runtime-manifest.test.ts).
 */
export function landingSourceFiles(root) {
  return ([
    join(root, "src/embed/landing-entry.ts"),
    ...dirTs(root, "src/lib/landing"),
    // 랜딩 밖에 있지만 번들에 들어간다 (esbuild metafile 로 실측한 목록)
    join(root, "src/lib/dom/h.ts"),
    join(root, "src/lib/webinar-config.ts"),
    join(root, "src/lib/datetime.ts"),
    // 랜딩 CSS 가 로고 규격을 여기서 가져온다
    join(root, "src/lib/webinar-logo.ts"),
    join(root, "src/lib/webinar-image.ts"),
    join(root, "src/lib/attribution-client.ts"),
    join(root, "src/lib/attribution-normalize.ts"),
    join(root, "src/lib/webinar-share.ts"),
    // 세션·연사 링크 — 랜딩 모델이 쓴다. **목록에 없었다**(metafile 대조로 발견, 2026-08-24).
    join(root, "src/lib/webinar-sessions.ts"),
    join(root, "src/lib/webinar-speaker-links.ts"),
    // 스크롤 잠금 — 랜딩과 홈페이지가 body 하나를 공유하므로 구현이 한 벌이어야 한다.
    join(root, "src/lib/dom/scroll-lock.ts"),
    // 색 계산 공용 계약 — 중복 세 벌을 여기로 모았다(W1 Task 20).
    join(root, "src/lib/color.ts"),
  ]).sort();
}

export function landingSourceHash(root) {
  return hashFiles(landingSourceFiles(root));
}

/** 등록 폼 런타임(src/embed/form-entry.ts + src/lib/collect-form/*) */
export function formSourceFiles(root) {
  return ([
    join(root, "src/embed/form-entry.ts"),
    ...dirTs(root, "src/lib/collect-form"),
    // 폼 밖에 있지만 번들에 들어간다 — 검증 규칙·DOM 빌더·UTM 봉투
    // (esbuild metafile 로 실측했다. 목록이 실제 입력보다 짧으면 검사는 초록인데
    //  커밋된 번들은 낡을 수 있다 — 그게 이 검사가 막으려던 바로 그 상황이다.)
    join(root, "src/lib/collect-form-config.ts"),
    join(root, "src/lib/collect-email.ts"),
    join(root, "src/lib/collect-country.ts"),
    join(root, "src/lib/collect-badge.ts"),
    join(root, "src/lib/collect-redirect.ts"),
    join(root, "src/lib/dom/h.ts"),
    join(root, "src/lib/dom/safe-rich-text.ts"),
    join(root, "src/lib/webinar-config.ts"),
    join(root, "src/lib/attribution-client.ts"),
    join(root, "src/lib/attribution-normalize.ts"),
    join(root, "src/lib/webinar-share.ts"),
    // 동의 전문·대회 문구를 거쳐 들어온다. **목록에 없었다**(metafile 대조로 발견, 2026-08-24).
    join(root, "src/lib/competition-render.ts"),
    join(root, "src/lib/competition-strings.ts"),
    join(root, "src/lib/legal-templates/tokens.ts"),
    join(root, "src/lib/legal-templates/types.ts"),
    // 색 계산 공용 계약 — 중복 세 벌을 여기로 모았다(W1 Task 20).
    join(root, "src/lib/color.ts"),
    // 전문 팝업이 닫힐 때 포커스를 돌려준다. **`dom/focus` 만** 들어온다 —
    // `@/lib/expo/*` 를 값으로 가져오면 expo 4개 + scroll-lock 이 딸려 와 약 +12KB 다.
    join(root, "src/lib/dom/focus.ts"),
  ]).sort();
}

export function formSourceHash(root) {
  return hashFiles(formSourceFiles(root));
}

/**
 * 홈페이지 런타임(src/embed/expo-entry.ts + src/lib/expo/*).
 *
 * `src/lib/expo` 에는 서버 전용 파일(라우트 서비스·Prisma 를 만지는 것들)도 있는데,
 * 그것들은 번들에 안 들어간다. 그래서 디렉터리를 통째로 넣지 않고 **metafile 이 실제로
 * 보고한 목록**을 적는다 — embed-runtime-manifest 테스트가 이 목록을 감시한다.
 */
export function expoSourceFiles(root) {
  return ([
    join(root, "src/embed/expo-entry.ts"),
    // 런타임 경로
    join(root, "src/lib/expo/mount.ts"),
    join(root, "src/lib/expo/shadow.ts"),
    join(root, "src/lib/expo/sheet.ts"),
    join(root, "src/lib/expo/host-reset.ts"),
    join(root, "src/lib/expo/overlay.ts"),
    join(root, "src/lib/expo/view-page.ts"),
    join(root, "src/lib/expo/view-sections.ts"),
    join(root, "src/lib/expo/renderers/action.ts"),
    join(root, "src/lib/expo/renderers/image.ts"),
    join(root, "src/lib/expo/renderers/lifecycle.ts"),
    join(root, "src/lib/expo/renderers/campaign-hero.ts"),
    join(root, "src/lib/expo/renderers/exhibition-grid.ts"),
    join(root, "src/lib/expo/renderers/audience-links.ts"),
    join(root, "src/lib/expo/renderers/speaker-carousel.ts"),
    join(root, "src/lib/expo/renderers/sponsor-marquee.ts"),
    join(root, "src/lib/expo/renderers/cta-band.ts"),
    join(root, "src/lib/expo/cta.ts"),
    join(root, "src/lib/expo/custom-code.ts"),
    join(root, "src/lib/expo/destination.ts"),
    join(root, "src/lib/expo/form-bridge.ts"),
    join(root, "src/lib/expo/seen.ts"),
    join(root, "src/lib/expo/preview-bridge.ts"),
    join(root, "src/lib/expo/config.ts"),
    // collect-form-config 가 동의 전문 토큰을 거쳐 이 둘을 끌어온다(metafile 실측).
    join(root, "src/lib/collect-form-config.ts"),
    join(root, "src/lib/legal-templates/tokens.ts"),
    join(root, "src/lib/legal-templates/types.ts"),
    join(root, "src/lib/expo/font.ts"),
    join(root, "src/lib/expo/css.ts"),
    join(root, "src/lib/expo/registry.ts"),
    join(root, "src/lib/expo/sections/types.ts"),
    join(root, "src/lib/expo/sections/campaign-hero.ts"),
    join(root, "src/lib/expo/sections/exhibition-grid.ts"),
    join(root, "src/lib/expo/sections/audience-links.ts"),
    join(root, "src/lib/expo/sections/speaker-carousel.ts"),
    join(root, "src/lib/expo/sections/sponsor-marquee.ts"),
    join(root, "src/lib/expo/sections/cta-band.ts"),
    join(root, "src/lib/expo/shell-css.ts"),
    // 마운트 자리 표시 상수를 스니펫 만드는 쪽과 공유한다 — 각자 적어 두면 한쪽만
    // 고쳐지는 날 코드는 붙었는데 런타임이 그 자리를 못 찾는다(snippet.ts 참고).
    join(root, "src/lib/expo/snippet.ts"),
    join(root, "src/lib/expo/types.ts"),
    // 공용
    join(root, "src/lib/collect-form/target-registry.ts"),
    join(root, "src/lib/color.ts"),
    join(root, "src/lib/dom/h.ts"),
    join(root, "src/lib/dom/focus.ts"),
    join(root, "src/lib/dom/scroll-lock.ts"),
    join(root, "src/lib/webinar-config.ts"),
    join(root, "src/lib/url-safety.ts"),
  ]).sort();
}

export function expoSourceHash(root) {
  return hashFiles(expoSourceFiles(root));
}

/**
 * 복구용 standalone 홈페이지 런타임.
 * live mount의 seen/preview/font/form/custom-code 모듈은 의도적으로 목록에 없다.
 * embed-runtime-manifest 테스트가 실제 esbuild 입력과 이 목록을 대조한다.
 */
export function standaloneExpoSourceFiles(root) {
  return ([
    join(root, "src/embed/expo-standalone-entry.ts"),
    join(root, "src/lib/collect-form-config.ts"),
    join(root, "src/lib/color.ts"),
    join(root, "src/lib/dom/h.ts"),
    join(root, "src/lib/expo/css.ts"),
    join(root, "src/lib/expo/cta.ts"),
    join(root, "src/lib/expo/destination.ts"),
    join(root, "src/lib/expo/registry.ts"),
    join(root, "src/lib/expo/renderers/action.ts"),
    join(root, "src/lib/expo/renderers/audience-links.ts"),
    join(root, "src/lib/expo/renderers/campaign-hero.ts"),
    join(root, "src/lib/expo/renderers/cta-band.ts"),
    join(root, "src/lib/expo/renderers/exhibition-grid.ts"),
    join(root, "src/lib/expo/renderers/image.ts"),
    join(root, "src/lib/expo/renderers/lifecycle.ts"),
    join(root, "src/lib/expo/renderers/speaker-carousel.ts"),
    join(root, "src/lib/expo/renderers/sponsor-marquee.ts"),
    join(root, "src/lib/expo/sections/audience-links.ts"),
    join(root, "src/lib/expo/sections/campaign-hero.ts"),
    join(root, "src/lib/expo/sections/cta-band.ts"),
    join(root, "src/lib/expo/sections/exhibition-grid.ts"),
    join(root, "src/lib/expo/sections/speaker-carousel.ts"),
    join(root, "src/lib/expo/sections/sponsor-marquee.ts"),
    join(root, "src/lib/expo/sections/types.ts"),
    join(root, "src/lib/expo/types.ts"),
    join(root, "src/lib/expo/view-sections.ts"),
    join(root, "src/lib/legal-templates/tokens.ts"),
    join(root, "src/lib/legal-templates/types.ts"),
    join(root, "src/lib/url-safety.ts"),
    join(root, "src/lib/webinar-config.ts"),
  ]).sort();
}

export function standaloneExpoSourceHash(root) {
  return hashFiles(standaloneExpoSourceFiles(root));
}

// ── 대회 3종 ────────────────────────────────────────────────────────────
//
// 이 셋은 오래도록 **검사가 없었다.** 각자 빌드 스크립트 안에 손으로 적은 목록이 있었는데,
// esbuild metafile 과 대조해 보니 셋 다 실제 입력과 달랐다(2026-08-25 실측):
//   competition 11개 적힘 / 실제 20개 · vote 5개 / 6개 · result 3개 / 6개
// 게다가 번들에 들어가지도 않는 파일(competition-config.ts 등)을 해시하고 있었다.
//
// 그래서 검사를 붙이는 것만으로는 부족했다 — 목록이 짧으면 **stale 검사는 초록인데 커밋된
// 번들은 낡는다.** 예를 들어 `competition-strings.ts`(방문자에게 보이는 문구)를 고쳐도
// 기록된 해시가 안 바뀐다. 목록을 실제 입력에 맞추고, manifest 테스트가 계속 대조한다.

/** 대회 신청 런타임. */
export function competitionSourceFiles(root) {
  return ([
    join(root, "src/embed/competition-entry.ts"),
    join(root, "src/lib/competition-render.ts"),
    join(root, "src/lib/competition-status.ts"),
    join(root, "src/lib/competition-strings.ts"),
    // 신청 폼의 국가 선택 — 문구가 여기 있다.
    join(root, "src/lib/collect-country.ts"),
    join(root, "src/lib/dom/h.ts"),
    join(root, "src/lib/dom/scroll-lock.ts"),
    // 공고 오버레이가 랜딩의 효과·오버레이를 그대로 쓴다.
    join(root, "src/lib/landing/effects.ts"),
    join(root, "src/lib/landing/overlay.ts"),
    join(root, "src/lib/notice/build-model.ts"),
    join(root, "src/lib/notice/config.ts"),
    join(root, "src/lib/notice/css.ts"),
    join(root, "src/lib/notice/media-focus.ts"),
    join(root, "src/lib/notice/mount.ts"),
    join(root, "src/lib/notice/shell-css.ts"),
    join(root, "src/lib/notice/strings.ts"),
    join(root, "src/lib/notice/view-hero.ts"),
    join(root, "src/lib/notice/view-sections.ts"),
    join(root, "src/lib/webinar-config.ts"),
    join(root, "src/lib/webinar-image.ts"),
    // 색 계산 공용 계약 — 중복 세 벌을 여기로 모았다(W1 Task 20).
    join(root, "src/lib/color.ts"),
  ]).sort();
}

export function competitionSourceHash(root) {
  return hashFiles(competitionSourceFiles(root));
}

/**
 * 상세페이지 런타임 — 대회 공고와 같은 렌더러(notice)를 쓴다.
 * competition-render·strings 는 공고 CSS 가 색 계산(onAccentColor)을 거기서 가져와 딸려 들어온다.
 */
export function detailPageSourceFiles(root) {
  return ([
    join(root, "src/embed/detail-page-entry.ts"),
    join(root, "src/lib/detail-page/config.ts"),
    join(root, "src/lib/collect-country.ts"),
    join(root, "src/lib/color.ts"),
    join(root, "src/lib/competition-render.ts"),
    join(root, "src/lib/competition-status.ts"),
    join(root, "src/lib/competition-strings.ts"),
    join(root, "src/lib/dom/h.ts"),
    join(root, "src/lib/dom/scroll-lock.ts"),
    join(root, "src/lib/landing/effects.ts"),
    join(root, "src/lib/landing/overlay.ts"),
    join(root, "src/lib/notice/build-model.ts"),
    join(root, "src/lib/notice/config.ts"),
    join(root, "src/lib/notice/css.ts"),
    join(root, "src/lib/notice/media-focus.ts"),
    join(root, "src/lib/notice/mount.ts"),
    join(root, "src/lib/notice/shell-css.ts"),
    join(root, "src/lib/notice/strings.ts"),
    join(root, "src/lib/notice/view-hero.ts"),
    join(root, "src/lib/notice/view-sections.ts"),
    join(root, "src/lib/webinar-config.ts"),
    join(root, "src/lib/webinar-image.ts"),
  ]).sort();
}

export function detailPageSourceHash(root) {
  return hashFiles(detailPageSourceFiles(root));
}

/** 대회 투표 런타임. */
export function competitionVoteSourceFiles(root) {
  return ([
    join(root, "src/embed/competition-vote-entry.ts"),
    join(root, "src/lib/collect-country.ts"),
    join(root, "src/lib/competition-render.ts"),
    join(root, "src/lib/competition-strings.ts"),
    join(root, "src/lib/competition-vote-css.ts"),
    join(root, "src/lib/competition-vote-strings.ts"),
    // 색 계산 공용 계약 — 중복 세 벌을 여기로 모았다(W1 Task 20).
    join(root, "src/lib/color.ts"),
  ]).sort();
}

export function competitionVoteSourceHash(root) {
  return hashFiles(competitionVoteSourceFiles(root));
}

/** 대회 결과 런타임. */
export function competitionResultSourceFiles(root) {
  return ([
    join(root, "src/embed/competition-result-entry.ts"),
    join(root, "src/lib/collect-country.ts"),
    join(root, "src/lib/competition-render.ts"),
    join(root, "src/lib/competition-result-css.ts"),
    join(root, "src/lib/competition-result-strings.ts"),
    join(root, "src/lib/competition-strings.ts"),
    // 색 계산 공용 계약 — 중복 세 벌을 여기로 모았다(W1 Task 20).
    join(root, "src/lib/color.ts"),
  ]).sort();
}

export function competitionResultSourceHash(root) {
  return hashFiles(competitionResultSourceFiles(root));
}
