/**
 * 랜딩 상세페이지 스타일 — 단독 페이지 / 어드민 미리보기 / 외부 사이트 임베드가 모두 이 한 벌을 쓴다.
 *
 * 색 구조 — **섹션마다 자기 배경을 칠한다.**
 * 예전에는 루트 하나가 배경을 칠하고 `.dark-zone` 래퍼가 그 위를 덮었다. 그래서 존 밖의
 * 섹션은 자기 배경이 없었고, 키컬러 전환(`.on-accent`)이 켜지면 엉뚱한 섹션까지 키컬러가
 * 비쳤다(그래서 audience 를 dark-zone 안으로 옮겼다는 주석이 mount 에 남아 있었다).
 * 섹션마다 `data-bg="light|dark"` 를 받게 하면 그 문제가 사라지고 모드 선택이 가능해진다.
 *
 * 운영자가 정하는 값은 **배경 두 개뿐**(--bg-light / --bg-dark). 글자·선·카드는 그 배경과
 * --paper 사이에서 color-mix 로 파생한다 — 색을 6개 고르게 하면 대비가 깨진 조합이 반드시 나온다.
 *
 * 세션·타임테이블(.accent-zone)은 배경을 칠하지 않는다. 화면 중앙에 걸치면 루트 배경이
 * 키컬러로 바뀌는 구간이라, 자기 배경을 칠하면 그 전환이 가려진다.
 */

import { sessionLogoCss } from "@/lib/webinar-logo";

export const LANDING_CSS = `
.lnd {
  /* 인라인 style 이 실제 값을 덮는다(mount.ts). 여기 값은 스크립트가 안 도는 경우의 폴백. */
  --bg-light: #f6f8ff;
  --bg-dark: #06080d;
  /* data-bg 가 없는 .lnd 요소를 위한 기본 — 모달·목차 레이어는 body 직계이고
     className 이 "lnd lnd-layer" 라 모드 속성을 받지 않는다. 이게 없으면 그 레이어에서
     var(--paper) 가 미정의가 되고, color 는 상속으로 떨어져 **임베드 호스트의 글자색**
     (실측 k-expo.org: #363636)이 모달 안으로 흘러든다. */
  --sec-bg: var(--bg-dark);
  --paper: #f6f8ff;
  --card: color-mix(in srgb, var(--bg-dark) 55%, #2d3a54);
  --card-2: color-mix(in srgb, var(--bg-dark) 20%, #373b44);
  --card-shadow: 0 18px 48px rgba(2, 8, 24, .25);
  --faq-card: var(--card-2);
  --faq-shadow: var(--card-shadow);
  /* 파생값도 여기 한 벌 둔다. 섹션에서는 [data-bg] 블록이 **다시 선언**해 그 섹션의
     --paper/--sec-bg 로 재계산한다 — 여기 값만 두면 계산 결과가 상속돼 모드가 안 먹는다. */
  --body: color-mix(in srgb, var(--paper) 78%, var(--sec-bg));
  --muted: color-mix(in srgb, var(--paper) 66%, var(--sec-bg));
  --line: color-mix(in srgb, var(--paper) 20%, transparent);
  --sec-bg-alt: color-mix(in srgb, var(--sec-bg) 94%, var(--paper));
  --primary-bright: color-mix(in srgb, var(--primary) 76%, #ffffff);
  --primary-soft: color-mix(in srgb, var(--primary) 70%, #05060a);
  --primary-ink: color-mix(in srgb, var(--primary) 52%, #050403);
  --max: 960px;
  --shadow: 0 26px 80px rgba(0, 6, 24, .38);
  --sans: "Pretendard Variable", Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  min-height: 100%;
  background: var(--sec-bg);
  color: var(--paper);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
  transition: background-color .8s ease;
}
/* 키컬러 전환 — 세션·타임테이블이 화면 중앙 밴드에 걸리는 동안만. 루트 배경을 덮으므로
   그 두 섹션은 배경을 칠하지 않아야 한다. 섹션 배경 모드가 생겨도 이 규칙은 그대로다. */
.lnd.on-accent { background: var(--primary); }

/* ── 배경 모드 ──────────────────────────────────────────────────────────
   두 모드가 각각 정하는 것은 배경·본문색·카드면 세 가지뿐이다.
   루트에도 걸린다(.lnd[data-bg]) — 세션·타임테이블 구간의 바탕이 루트 배경이기 때문. */
.lnd[data-bg="dark"], .lnd [data-bg="dark"] {
  --sec-bg: var(--bg-dark);
  /* mount 가 배경 휘도에서 정해 인라인으로 심는다. 폴백은 예전 상수. */
  --paper: var(--paper-dark, #f6f8ff);
  /* 카드면은 배경에서 뽑는다 — 키컬러성 어두운 배경(예: 진한 보라)에 회청색 카드가
     얹히면 섹션 하나가 남의 것처럼 보인다. 계수는 기존 값 rgb(24,31,45) 에 맞췄다. */
  --card: color-mix(in srgb, var(--bg-dark) 55%, #2d3a54);
  --card-2: color-mix(in srgb, var(--bg-dark) 20%, #373b44);
  --card-shadow: 0 18px 48px rgba(2, 8, 24, .25);
  --faq-card: var(--card-2);
  --faq-shadow: var(--card-shadow);
}
.lnd[data-bg="light"], .lnd [data-bg="light"] {
  --sec-bg: var(--bg-light);
  --paper: var(--paper-light, #101828);
  --card: #ffffff;
  /* 배경보다 **어둡게** 뽑는다. 흰색 쪽으로 섞으면 라이트 배경보다 밝아져 판이 사라진다
     (lightBg #f6f8ff 에서 1.03:1, #ffffff 면 완전 동일색). */
  --card-2: color-mix(in srgb, var(--bg-light) 92%, var(--paper));
  --card-shadow: 0 12px 30px rgba(23, 32, 56, .10);
  /* FAQ 는 반복되는 얕은 판이라 회색 면 + 큰 그림자보다 흰 면 + 접촉 그림자가 선명하다. */
  --faq-card: var(--card);
  --faq-shadow: 0 1px 2px rgba(23, 32, 56, .05), 0 6px 16px rgba(23, 32, 56, .06);
  /* 강조 글자·아웃라인용 키컬러. 이름은 bright 지만 라이트 모드에서는 **어둡게** 가야
     보인다 — 흰색 쪽으로 섞은 값은 밝은 배경에서 노랑 키컬러일 때 1.31:1 까지 떨어졌다.
     48% 는 최악(밝은 노랑 #facc15)에서 .join-k(12px/900) 대비 4.74 로 AA 를 통과하는
     가장 옅은 값이다 — 실측: 58% 3.53(탈락) / 48% 4.74 / 40% 6.08(탁해짐). */
  --primary-bright: color-mix(in srgb, var(--primary) 48%, #05060a);
}
/* 위 값은 폴백이다. sRGB 에서 검정 쪽으로 섞으면 명도만이 아니라 **채도와 색상(hue)까지**
   끌려 내려가 브랜드색이 갈색이 된다 — 실측 #ff8500: 채도 100→92 · 명도 50→25 로 rgb(125,67,5).
   라이트 섹션이 대부분인 랜딩에서는 키컬러가 화면 거의 전체에서 다른 색으로 보인다는 뜻이다
   (목차 활성 표시·STEP 라벨·벤핏 번호·포커스 아웃라인이 전부 이 토큰을 쓴다).
   OKLCH 로 **명도만** 0.5 로 낮추면 채도·색상이 남는다(#ff8500 → rgb(172,56,0), 채도 100 유지 /
   #6d28d9 는 원래 L 이 0.5 라 원본 그대로). 0.5 인 이유: 대표 키컬러 7종을 lightBg 위에서 재
   보니 전부 4.5:1 을 넘는 가장 밝은 값이다(최악 시안 5.13 — 0.55 로 올리면 시안이 4.22 로 탈락).
   @supports 로 감싸는 이유: 커스텀 프로퍼티는 잘못된 값이 **파싱 단계에서 안 걸러진다**.
   그냥 두 번 선언하면 미지원 브라우저에서 폴백이 아니라 "계산 시점 무효" 가 되어 색이 상속으로
   떨어진다 — 지원 여부를 미리 물어야 위 줄이 진짜 폴백으로 남는다. */
@supports (color: oklch(from red l c h)) {
  .lnd[data-bg="light"], .lnd [data-bg="light"] { --primary-bright: oklch(from var(--primary) 0.5 c h); }
}
/* 두 모드 공통 파생 — 글자와 선은 --paper 와 --sec-bg **사이**에서 뽑는다.
   그래서 배경 키컬러만 바꿔도 대비가 유지된다. 선택자 특정도가 위 두 블록과 같으므로
   이 블록이 먼저 와야 한다(같은 프로퍼티를 다투지는 않지만 순서를 명시해 둔다). */
.lnd[data-bg], .lnd [data-bg] {
  /* color 를 여기서 **다시 선언**해야 한다. 루트의 color 는 루트의 --paper 로 이미 계산돼
     자손에게 그 결과값이 상속되므로, 섹션이 --paper 만 바꿔도 글자색은 안 바뀐다
     (라이트 섹션에 흰 글자가 남아 안 보였다). */
  color: var(--paper);
  --body: color-mix(in srgb, var(--paper) 78%, var(--sec-bg));
  --muted: color-mix(in srgb, var(--paper) 66%, var(--sec-bg));
  --line: color-mix(in srgb, var(--paper) 20%, transparent);
  /* 같은 모드가 연달아 오면 이 값으로 한 칸씩 교대한다(지브라) */
  --sec-bg-alt: color-mix(in srgb, var(--sec-bg) 94%, var(--paper));
}
/* 섹션이 자기 배경을 칠한다. 제외 두 곳:
   · accent-zone(세션·타임테이블) — 루트가 칠해야 키컬러 전환이 보인다
   · 히어로 — 자기 규칙에서 var(--sec-bg) 위에 원형 장식을 얹는다(여기서 덮으면 장식이 사라진다)

   background 를 섹션에 직접 주면 **가운데 칼럼만 칠해진다** — .section 은
   width: min(100% - 36px, --max) 로 좁은 박스라 좌우에 루트 색이 그대로 남는다(실측).
   그래서 화면 폭을 덮는 가짜 요소를 뒤에 깐다(옛 .dark-zone 지브라가 쓰던 기법 그대로).
   루트에 overflow-x: hidden 이 있어 50vw 트릭이 가로 스크롤을 만들지 않는다. */
/* isolation: isolate + z-index:-1 로 가상요소를 내용 **뒤**에 둔다.
   예전에는 자식 전부에 > * { position: relative } 를 걸어 올렸는데, 그 규칙이
   .lnd .scroll-cue(position:absolute)를 특정도로 이겨(0,3,0 vs 0,2,0) About 하단
   셰브론이 흐름에 들어가 오른쪽 끝으로 밀렸다 — 기본값에서도 터지는 회귀였다(실측:
   중앙 x=670 이어야 하는데 x=1305). 자식의 position 은 건드리지 않는다. */
.lnd .section[data-bg]:not(.accent-zone), .lnd .intro[data-bg] {
  position: relative; isolation: isolate;
}
.lnd .section[data-bg]:not(.accent-zone)::before,
.lnd .intro[data-bg]::before {
  content: ""; position: absolute; z-index: -1; top: 0; bottom: 0;
  left: calc(50% - 50vw); right: calc(50% - 50vw);
  background: var(--sec-bg);
}
/* 지브라는 위 규칙보다 **특정도가 같거나 높고 뒤에** 와야 한다 —
   .lnd [data-band] 만으로는 위 규칙(:not 이 특정도를 올린다)에 져서 조용히 안 칠해진다.
   (이 블록 안에서는 백틱을 쓰지 않는다 — 이 파일 전체가 템플릿 리터럴이라 문자열이 끊긴다.) */
.lnd .section[data-band="alt"]:not(.accent-zone)::before,
.lnd .intro[data-band="alt"]::before { background: var(--sec-bg-alt); }
.lnd *, .lnd *::before, .lnd *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── 호스트 전역 CSS 방어 ──
   외부 사이트(아임웹 등) 문서에 직접 마운트되면 호스트의 **상속 프로퍼티**가 그대로 흘러든다.
   실측(www.k-expo.org): body 에 -webkit-text-fill-color:#363636 이 걸려 있어 우리 흰 글자가
   진회색으로 렌더됐다(color 를 덮어쓰는 프로퍼티라 color 지정만으로는 못 막는다).
   상속으로 새는 것들만 루트에서 다시 못박고, 호스트가 !important 로 강제하는 4종에만
   !important 로 맞선다(같은 호스트에서 도는 /w 로더가 이미 같은 방어를 쓰고 있다). */
.lnd.lnd, .lnd.lnd * { -webkit-text-fill-color: currentColor !important; }
.lnd.lnd {
  letter-spacing: normal; word-spacing: normal; text-transform: none;
  text-align: left; text-indent: 0; text-shadow: none; white-space: normal;
  font-style: normal; font-weight: 400; visibility: visible;
  /* all:initial 을 쓰지 않는 이유: text-size-adjust 가 auto 로 풀려 iOS 텍스트 자동확대가
     랜딩 안에서만 되살아난다. 필요한 것만 명시한다. */
  -webkit-text-size-adjust: 100%; text-size-adjust: 100%;
}
/* 호스트가 a { color: ... !important } 를 걸어 두므로 링크 색을 !important 로 되찾는다.
   단 이 규칙은 "기본값"일 뿐이다 — 우리가 색을 명시하는 링크(.toc-link/.hero-cta)는
   아래에서 다시 !important 로 못박아야 한다. 안 그러면 이 줄이 우리 색까지 덮어버려
   목차 활성 표시와 CTA 대비색이 조용히 사라진다(실제로 그랬다). */
.lnd a { color: inherit !important; text-decoration: none !important; }
.lnd button {
  font: inherit; color: inherit; background: transparent; border: 0; border-radius: 0;
  padding: 0; margin: 0; text-align: inherit; cursor: pointer;
  -webkit-appearance: none; appearance: none;
}
.lnd ul, .lnd ol { list-style: none; }
.lnd img, .lnd svg, .lnd video { display: block; max-width: 100%; border: 0; }
.lnd ::selection { background: var(--primary); color: var(--on-primary); }
.lnd :focus-visible { outline: 3px solid var(--primary-bright); outline-offset: 4px; }

.lnd .preview-badge {
  position: fixed; left: 12px; top: 12px; z-index: 200;
  padding: 6px 12px; border-radius: 999px;
  /* 흰 알약은 라이트 배경 위에서 1.06:1 로 사라진다 → 카드 토큰 + 그림자로 띄운다. */
  background: var(--card); color: var(--paper); box-shadow: var(--card-shadow);
  font-size: 12px; font-weight: 800;
}

/* ── 왼쪽 세로 목차 — 넓은 화면 전용(임베드 포함) ──
   마운트가 body 직계 레이어(.lnd-toc-layer)로 포털한다. 여기 fixed/left/top 은 그 레이어 안에서도
   그대로 유효하다(레이어가 viewport 를 덮으므로 기준이 같다).
   [data-lnd-off] 는 랜딩이 화면을 벗어났을 때 effects 가 거는 표시 — display 를 건드리지 않고
   숨겨서 미디어쿼리(display:flex)와 싸우지 않는다. */
.lnd .toc {
  position: fixed; left: 24px; top: 50%; transform: translateY(-50%); z-index: 90;
  display: none; flex-direction: column; gap: 2px;
  transition: opacity .3s ease, visibility .3s ease;
}
@media (min-width: 1280px) { .lnd .toc { display: flex; } }
.lnd .toc[data-lnd-off] { opacity: 0; visibility: hidden; pointer-events: none; }
.lnd .toc-link {
  display: flex; align-items: center; gap: 11px; min-height: 30px;
  /* !important: 위 .lnd a 방어 규칙(color:inherit !important)을 이겨야 한다. */
  color: var(--muted) !important; font-size: 11px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase;
  transition: color .4s ease;
}
.lnd .toc-mark {
  flex: 0 0 auto; width: 16px; height: 2px; background: currentColor; opacity: .5;
  transition: width .25s ease, opacity .25s ease, background .4s ease;
}
.lnd .toc-link:hover { color: var(--paper) !important; }
.lnd .toc-link[aria-current="true"] { color: var(--primary-bright) !important; }
.lnd .toc-link[aria-current="true"] .toc-mark { width: 30px; opacity: 1; background: var(--primary-bright); }
/* 섹션 경계가 고정 목차를 가로지를 때 링크마다 뒤의 면이 다르다. effects 가 각 링크에
   실제 세로 위치의 data-bg 를 심으므로, 어두운 면에 놓인 항목만 밝게 처리한다.
   이미지 히어로에서는 11px 목차가 --muted 로는 빠듯해 짧은 그림자도 함께 받친다. */
/* :not([aria-current]) 로 활성 항목을 아예 제외한다 — 특정도 경쟁을 만들지 않는 게 요점이다.
   예전에는 이 규칙이 활성 항목까지 덮고(0,4,0 > 0,3,0) 아래 키컬러 규칙을 이겨서, 어두운
   섹션에 걸린 활성 항목이 키컬러를 조용히 잃었다. 제외하면 그 항목은 키컬러 규칙으로 떨어진다. */
.lnd.lnd-toc-layer:not(.on-accent) .toc-link[data-bg="dark"]:not([aria-current="true"]) {
  color: color-mix(in srgb, var(--paper) 82%, transparent) !important;
  text-shadow: 0 1px 3px rgba(0, 0, 0, .38);
}
.lnd.lnd-toc-layer:not(.on-accent) .toc-link[data-bg="dark"]:hover {
  color: var(--paper) !important;
}
/* 활성 항목은 **어두운 면에서도 키컬러**다 — 지금 어디를 보고 있는지 말하는 유일한 신호라
   흰색으로 덮으면 hover 와 구분되지 않는다. 위 [data-bg="dark"] 규칙이 특정도 (0,4,0) 으로
   기본 활성 규칙 (0,3,0) 을 이기고 있었어서, 키컬러가 조용히 사라졌다(실측). 여기서 되찾는다.
   어두운 면에서는 --primary-bright 가 흰색 쪽으로 섞인 값이라 그대로 쓸 수 있다. */
.lnd.lnd-toc-layer:not(.on-accent) .toc-link[data-bg="dark"][aria-current="true"] {
  color: var(--primary-bright) !important;
  text-shadow: none;
}
.lnd.lnd-toc-layer:not(.on-accent) .toc-link[data-bg="dark"][aria-current="true"] .toc-mark {
  background: var(--primary-bright);
}
.lnd.on-accent .toc-link { color: color-mix(in srgb, var(--on-primary) 58%, transparent) !important; }
.lnd.on-accent .toc-link:hover,
.lnd.on-accent .toc-link[aria-current="true"] { color: var(--on-primary) !important; }
.lnd.on-accent .toc-link[aria-current="true"] .toc-mark { background: var(--on-primary); }

/* ── 히어로 ──
   호스트 DOM 에 직접 마운트하면 100svh 가 브라우저 네이티브로 동작한다(모바일 주소창 접힘에도
   재계산 없음). 레거시 iframe 임베드에서만 문서 전체 높이가 되어 무한 성장하므로,
   그 경로에 한해 호스트가 postMessage 로 넘겨준 --lnd-vh 로 대체한다. */
.lnd .hero {
  position: relative;
  /* --lnd-topinset = 첫 화면에서 랜딩 위를 차지하는 호스트 크롬(헤더) 높이.
     빼지 않으면 히어로 바닥에 붙은 일시·CTA 가 딱 그만큼 화면 밖으로 밀린다. */
  min-height: calc(100svh - var(--lnd-topinset, 0px));
  display: grid; place-items: center;
  overflow: hidden;
  /* 바탕은 섹션 모드가 정하고, 그 위의 은은한 원형 장식만 유지한다.
     (모드 규칙으로 background 를 통째로 덮으면 이 장식이 조용히 사라진다 — 실제로 그랬다.) */
  background:
    radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--paper) 6%, transparent) 0 20%, transparent 21%),
    var(--sec-bg);
}
.lnd[data-legacy-iframe] .hero { min-height: var(--lnd-vh, 720px); }
/* 히어로 이미지·영상이 있으면 기본 장식(키컬러 링·그라데이션)을 **아예 그리지 않는다**.
   덮어씌우는 방식이면 CSS 는 즉시 그려지고 이미지는 나중에 도착하므로,
   첫 로드에 기본 화면이 보였다가 이미지로 바뀌는 게 그대로 눈에 띈다. */
/* 미디어 히어로는 이미지와 스크림이 어둡다 — 섹션 모드가 라이트여도 글자는 밝아야 읽힌다.
   (모드를 무시하는 유일한 곳이고, 편집 UI 에 그 사실을 적어 둔다.)
   --paper 만 덮으면 부족했다. 파생 토큰은 --sec-bg 와도 섞이고, --primary-bright 는 라이트
   모드에서 키컬러를 **어둡게** 섞은 값이라 어두운 스크림 위에서 사라진다 — eyebrow 가
   그 토큰을 쓴다(실측 #ff8500 라이트: rgb(125,67,5), 스크림 위 대비 1.6:1). 다크 공식으로 되돌린다.
   바탕은 설정 darkBg 가 아니라 스크림 색(rgba(4,6,11,…))에 맞춘다 — 글자 뒤에 실제로 있는 면이다. */
.lnd .hero.hero-has-media {
  --sec-bg: #04060b;
  --paper: #f6f8ff;
  --primary-bright: color-mix(in srgb, var(--primary) 76%, #ffffff);
  background: var(--sec-bg);
}
.lnd .hero.hero-has-media::before,
.lnd .hero.hero-has-media::after { content: none; }
.lnd .hero::before,
.lnd .hero::after {
  content: ""; position: absolute; inset: 50% auto auto 50%;
  transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none;
}
.lnd .hero::before {
  width: min(112vw, 1220px); aspect-ratio: 1;
  background: radial-gradient(circle,
    transparent 0 34%,
    color-mix(in srgb, var(--primary) 22%, transparent) 35%,
    var(--primary-bright) 44%,
    var(--primary-soft) 51%,
    color-mix(in srgb, var(--primary-soft) 62%, transparent) 59%,
    transparent 69%);
  filter: saturate(1.15); opacity: .92;
}
.lnd .hero::after {
  width: min(55vw, 590px); aspect-ratio: 1;
  background: radial-gradient(circle at 50% 45%, #05070b 0 56%, #02040a 72%);
  box-shadow: 0 0 100px rgba(0, 0, 0, .8);
}
/* 라이트 히어로 — 위 두 장식은 어두운 바탕 전제다. 검은 원판(::after)과 링의 어두운
   구간(--primary-soft)이 밝은 바탕에 그대로 얹히면 제목 대비가 1.14:1 로 사라진다.
   원판은 끄고, 링은 키컬러만 옅게 번지는 형태로 바꾼다. */
.lnd .hero[data-bg="light"]::after { content: none; }
.lnd .hero[data-bg="light"]::before {
  background: radial-gradient(circle,
    transparent 0 38%,
    color-mix(in srgb, var(--primary) 14%, transparent) 44%,
    color-mix(in srgb, var(--primary) 26%, transparent) 52%,
    transparent 66%);
  filter: none; opacity: .9;
}
.lnd .hero-media { position: absolute; inset: 0; z-index: 1; overflow: hidden; }
.lnd .hero-media img, .lnd .hero-media video { width: 100%; height: 100%; object-fit: cover; }
.lnd .hero-media.has-media::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(4, 6, 11, .5), rgba(4, 6, 11, .82));
}
.lnd .hero-inner {
  position: relative; z-index: 2; align-self: stretch; justify-self: center;
  width: min(100% - 40px, 980px);
  display: grid; place-items: center;
  padding: 96px 0 clamp(40px, 6vh, 76px);
}
.lnd .hero-copy { text-align: center; }
.lnd .eyebrow {
  margin: 0 0 6px;
  font-size: clamp(15px, 1.8vw, 22px); font-weight: 900; letter-spacing: -.03em;
  color: var(--primary-bright);
}
/* 임베드에선 호스트에 h1 이 이미 있어 히어로 제목만 h2 로 낮춘다 — 시각은 동일하게 */
.lnd .hero h1,
.lnd .hero h2 {
  font-size: clamp(44px, 7vw, 92px); font-weight: 900; letter-spacing: -.055em;
  line-height: .98; text-transform: uppercase; text-wrap: balance; word-break: keep-all;
}
.lnd .hero h1 span, .lnd .hero h2 span { display: block; }
.lnd .hero-subtitle {
  margin: 24px 0 0;
  font-size: clamp(17px, 2.3vw, 30px); font-weight: 800; letter-spacing: -.035em; word-break: keep-all;
}
.lnd .hero-meta {
  position: absolute; left: 0; bottom: 54px;
  color: var(--paper); font-size: clamp(16px, 2vw, 21px); font-weight: 700; line-height: 1.5;
  letter-spacing: -.01em; white-space: pre-line; font-variant-numeric: tabular-nums;
}
.lnd .hero-cta {
  position: absolute; right: 0; bottom: 48px;
  min-width: 210px; min-height: 58px;
  display: inline-flex; align-items: center; justify-content: space-between; gap: 20px;
  padding: 0 24px; border-radius: 999px;
  background: var(--primary);
  /* !important: .lnd a 방어 규칙에 덮이면 키컬러가 밝을 때(노랑 등) 흰 글자가 남아 대비가 깨진다.
     accentColor 가 흰 글자를 쓰는 색이면 시각 변화가 없고, 어두운 글자를 써야 하는 색에서만 달라진다. */
  color: var(--on-primary) !important;
  box-shadow: 0 16px 34px color-mix(in srgb, var(--primary) 34%, transparent);
  font-weight: 850;
  transition: transform .2s ease, box-shadow .2s ease;
}
.lnd .hero-cta:hover {
  transform: translateY(-2px);
  box-shadow: 0 20px 42px color-mix(in srgb, var(--primary) 46%, transparent);
}
.lnd .hero-cta svg { width: 23px; height: 23px; flex: 0 0 auto; }

/* ── ABOUT ── */
.lnd .intro {
  position: relative; min-height: 560px;
  display: grid; place-items: center;
  padding: 100px 24px; text-align: center;
}
.lnd .intro-copy { max-width: 760px; }
.lnd .intro h2 {
  font-size: clamp(28px, 4vw, 48px); font-weight: 900; line-height: 1.28; letter-spacing: -.04em;
  white-space: pre-line; text-wrap: balance; word-break: keep-all;
}
.lnd .intro p {
  margin: 44px auto 0; color: var(--body);
  font-size: clamp(15px, 1.8vw, 21px); line-height: 1.85; letter-spacing: -.02em;
  white-space: pre-line; word-break: keep-all;
}
/* PC·모바일 줄바꿈 위치가 달라야 할 때 운영자가 따로 쓴 문구 — 폭에 따라 한쪽만 보인다.
   기준점은 .intro 가 레이아웃을 바꾸는 760px(아래 반응형 블록)과 같다. */
.lnd .intro .intro-mobile { display: none; }
.lnd .scroll-cue {
  position: absolute; left: 50%; bottom: 44px;
  width: 22px; height: 22px;
  border-right: 2px solid color-mix(in srgb, var(--paper) 60%, transparent);
  border-bottom: 2px solid color-mix(in srgb, var(--paper) 60%, transparent);
  transform: translateX(-50%) rotate(45deg);
}

/* ── 섹션 공통 ── */
.lnd .section {
  width: min(100% - 36px, var(--max));
  margin: 0 auto;
  padding: clamp(92px, 12vw, 150px) 0;
}
.lnd .section-title {
  margin: 0 0 clamp(42px, 6vw, 70px);
  text-align: center;
  font-size: clamp(30px, 4vw, 44px); font-weight: 900; line-height: 1; letter-spacing: -.04em; text-transform: uppercase;
}
.lnd .accent-zone .section-title { transition: color .8s ease; }
.lnd.on-accent .accent-zone .section-title { color: var(--on-primary); }

/* ── 세션 카드 ── */
/* 데스크톱 2개/줄(50%-half gap). flex + 가운데 정렬이라 개수 무관하게 균형 유지 */
.lnd .session-cards { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; }
.lnd .session-card {
  position: relative;
  width: calc(50% - 8px); max-width: 372px; aspect-ratio: 210 / 297; /* A4 세로 */
  overflow: hidden; border-radius: 9px;
  background: linear-gradient(160deg, #1b2130, #12161f 60%, #0c0f16);
  box-shadow: var(--shadow);
  transform: translateZ(0);
  /* article/button 겸용 — 버튼일 때 기본 스타일 리셋 */
  display: block; text-align: left; font: inherit; border: 0; padding: 0; appearance: none;
  /* 카드 면은 **섹션 모드와 무관하게 어둡다**(위 고정 그라디언트 + ::after 하단 스크림).
     그래서 글자도 항상 밝아야 한다. 예전엔 color: inherit 였는데, 세션 구간을 화이트로
     두면 상속된 검은 글자가 어두운 카드에 얹혀 대비 1.02 로 사라졌다(실측).
     이 카드 안에서만 다크 토큰을 못박는다 — 사진 위 텍스트라 판단 기준이 카드 면이다. */
  --paper: #f6f8ff;
  --body: #c3cad6;
  --muted: #abb5c7;
  /* 키컬러가 아주 어두워도 최소 절반은 밝은 카드 글자색을 섞어 사진 위 대비를 지킨다. */
  --session-accent: color-mix(in srgb, var(--primary) 48%, var(--paper));
  color: var(--paper);
}
.lnd .session-card.is-clickable { cursor: pointer; transition: transform .22s ease, box-shadow .22s ease; }
.lnd .session-card.is-clickable:hover { transform: translateY(-4px); box-shadow: 0 26px 54px rgba(0, 0, 0, .5); }
.lnd .session-card.is-clickable:focus-visible { outline: 2px solid var(--session-accent); outline-offset: 3px; }
.lnd .session-photo { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; object-fit: cover; }
.lnd .session-card::after {
  content: ""; position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(180deg, transparent 26%, rgba(3, 7, 14, .12) 44%, rgba(3, 7, 14, .96) 100%);
}
.lnd .session-card-body {
  position: absolute; z-index: 2; inset: auto 16px 16px;
  display: flex; flex-direction: column; align-items: flex-start;
}
.lnd .session-time {
  display: inline-flex; align-items: center; min-height: 29px; padding: 0 9px; border-radius: 3px;
  background: var(--primary); color: var(--on-primary);
  font-size: 12px; font-weight: 850; font-variant-numeric: tabular-nums;
}
.lnd .session-card h3 {
  margin: 12px 0 20px;
  /* 위와 같은 이유로 명시. 사진 위 17px 이라 800 은 무거워 750 으로 둔다. */
  font-size: 17px; font-weight: 750; line-height: 1.35; letter-spacing: -.03em; word-break: keep-all;
}
/* 이름·회사(왼쪽) 과 '자세히 보기'(오른쪽 하단) 를 한 줄에 — baseline 이 아니라 flex-end 로
   맞춘다. 회사명이 있으면 왼쪽이 두 줄이 되는데, 그때 링크가 첫 줄에 붙어 뜨지 않게. */
.lnd .session-foot { width: 100%; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.lnd .speaker { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; color: #dfe5f0; font-size: 15.5px; }
.lnd .speaker b { color: #fff; font-weight: 800; }
.lnd .speaker-co { color: #b9c2d1; font-size: 13.5px; font-weight: 600; letter-spacing: -.01em; }
.lnd .session-more {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px;
  font-size: 14px; font-weight: 800; letter-spacing: -.01em; color: var(--session-accent);
}
.lnd .session-more svg { width: 16px; height: 16px; }

/* ── body 직계 고정 레이어 ── 모달처럼 뷰포트에 붙어야 하는 것만 여기 산다.
   외부 사이트(아임웹)에 마운트되면 조상에 position:relative/transform 이 있어
   랜딩 내부의 position:fixed 가 갇힌다 → 레이어를 body 직계로 포털한다.
   평소엔 pointer-events:none 이라 호스트 클릭을 가로채지 않는다. */
.lnd.lnd-layer {
  position: fixed; inset: 0; z-index: 999960;
  background: none; min-height: 0; width: auto; margin: 0; overflow: visible;
  pointer-events: none;
}
.lnd.lnd-layer > * { pointer-events: auto; }

/* ── 목차 전용 레이어 (body 직계) ──
   모달 레이어(999960)보다 **아래**로 못박아, 팝업이 열리면 목차가 백드롭 뒤로 들어간다.
   on-accent 를 이 레이어에도 미러링하므로(목차 색 전환) 배경 규칙을 더 높은 특이도로 무효화한다
   — 안 하면 .lnd.on-accent{background:var(--primary)} 가 화면 전체를 키컬러로 덮는다. */
.lnd.lnd-toc-layer {
  position: fixed; inset: 0; z-index: 999940;
  background: none; min-height: 0; width: auto; margin: 0; overflow: visible;
  pointer-events: none;
}
.lnd.lnd-toc-layer.on-accent,
/* 모드 미러링(attachTocSpy)이 이 레이어에 data-bg 를 걸므로, 모드 배경 규칙이
   화면 전체를 덮지 않도록 여기서도 못박는다. */
.lnd.lnd-toc-layer[data-bg] { background: none; }
.lnd.lnd-toc-layer > * { pointer-events: auto; }

/* ── 세션 상세 팝업 (글래스모피즘) — 뷰포트 중앙 고정 ── */
.lnd .lnd-modal-root {
  position: fixed; inset: 0; z-index: 1;
  display: grid; place-items: center; padding: 16px;
}
.lnd .lnd-modal-backdrop {
  position: absolute; inset: 0; background: rgba(4, 6, 11, .62);
  -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px);
  animation: lnd-modal-fade .2s ease;
}
.lnd .lnd-modal {
  position: relative;
  width: min(920px, calc(100% - 32px)); max-height: min(90svh, 900px);
  display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
  /**
   * grid-template-rows: minmax(0, 1fr) 이 **없으면 긴 약력에서 스크롤이 죽는다.**
   * (이 주석은 템플릿 리터럴 안이라 백틱을 쓸 수 없다 — 쓰면 CSS 문자열이 거기서 끊긴다.)
   * 기본 auto 트랙은 내용 높이로 커지는데, 모달은 max-height 로 잘리고 overflow:hidden 이라
   * 넘친 부분에 닿을 방법이 없어진다. 안쪽 .lnd-modal-main 의 overflow-y:auto 도 무효다 —
   * 트랙(=자기 높이)이 내용만큼 크니 스크롤할 여지가 0 이다.
   * 실측(375×700, 약력 8단락): 모달 630px 인데 그리드 행 1156px, main clientHeight 1156,
   * scrollTop 이 0 에서 안 움직임. minmax(0,1fr) 로 행이 줄어들 수 있게 하면 main 이 스크롤한다.
   * 데스크톱도 같은 구조라 함께 고쳐진다(뷰포트가 커서 늦게 드러날 뿐이었다).
   */
  /* 1행: 사진|본문(줄어들 수 있어야 한다 — 위 주석 참고), 2행: SNS(내용 높이).
     암시 행(grid-auto-rows)에 맡기지 않고 적어 둔다 — 무엇이 줄어들 수 있는 행인지가
     이 모달의 스크롤 동작을 정하는 값이라 눈에 보여야 한다. */
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden; border-radius: 18px;
  background: rgba(19, 23, 32, .72);
  -webkit-backdrop-filter: blur(26px) saturate(1.3); backdrop-filter: blur(26px) saturate(1.3);
  border: 1px solid rgba(255, 255, 255, .12);
  box-shadow: 0 40px 90px rgba(0, 0, 0, .6);
  animation: lnd-modal-pop .22s cubic-bezier(.2, .8, .3, 1);
}
.lnd .lnd-modal:not(.has-photo) { grid-template-columns: minmax(0, 1fr); width: min(600px, calc(100% - 32px)); }
/* 닫기 버튼은 **스크롤과 무관하게 항상 같은 자리**다 — 스크롤하는 건 .lnd-modal-main 이고
   이 버튼은 모달(스크롤하지 않는 상자)에 absolute 로 붙어 있다. 반투명 판만으로는 아래로
   지나가는 본문 글자와 겹쳐 읽기 어려워, 불투명도를 올리고 블러를 깔았다. */
/* 홈페이지 바로가기 — 약력 아래. 채운 버튼이 아니라 텍스트 링크다:
   모달의 주 행동은 "읽기" 이고 이건 이어서 볼 수 있는 곳을 가리키는 보조 링크다. */
.lnd .lnd-modal-home {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 16px;
  color: #fff; font-size: 13.5px; font-weight: 700; text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, .35); padding-bottom: 2px;
  transition: border-color .18s ease, gap .18s ease;
}
.lnd .lnd-modal-home:hover { border-color: #fff; gap: 9px; }
.lnd .lnd-modal-home svg { width: 15px; height: 15px; }
/* SNS — 모달 **맨 밑**. 아이콘만 두고 이름은 aria-label/title 로만 둔다(줄이 길어지면
   밑이 무거워져서, 읽고 나가는 흐름의 끝이 아니라 새 과제처럼 보인다). */
.lnd .lnd-modal-sns {
  grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px;
  padding: 14px 30px 18px;
  border-top: 1px solid rgba(255, 255, 255, .1);
}
.lnd .lnd-modal-sns-link {
  width: 38px; height: 38px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, .08); color: rgba(255, 255, 255, .78);
  transition: background .18s ease, color .18s ease, transform .18s ease;
}
.lnd .lnd-modal-sns-link:hover { background: rgba(255, 255, 255, .16); color: #fff; transform: translateY(-1px); }
.lnd .lnd-modal-sns-link svg { width: 19px; height: 19px; }

.lnd .lnd-modal-close {
  position: absolute; top: 12px; right: 12px; z-index: 3;
  width: 38px; height: 38px; display: grid; place-items: center; border-radius: 999px; color: #fff;
  background: rgba(28, 34, 48, .82); border: 1px solid rgba(255, 255, 255, .18);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  transition: background .18s ease;
}
.lnd .lnd-modal-close:hover { background: rgba(255, 255, 255, .2); }
.lnd .lnd-modal-close svg { width: 18px; height: 18px; }
.lnd .lnd-modal-photo { position: relative; min-height: 100%; background: #0c0f16; }
.lnd .lnd-modal-photo img { width: 100%; height: 100%; object-fit: cover; }
.lnd .lnd-modal-photo::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 48%, rgba(6, 9, 15, .85)); }
.lnd .lnd-modal-photo-cap { position: absolute; z-index: 1; left: 20px; bottom: 18px; display: flex; flex-direction: column; gap: 3px; color: #fff; }
.lnd .lnd-modal-photo-cap b { font-size: 16px; font-weight: 800; letter-spacing: -.02em; }
.lnd .lnd-modal-photo-cap span { font-size: 12px; color: #cfd6e2; }
.lnd .lnd-modal-main { min-height: 0; padding: 30px; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.lnd .lnd-modal-time {
  display: inline-flex; align-items: center; min-height: 26px; padding: 0 9px; border-radius: 4px;
  background: var(--primary); color: var(--on-primary); font-size: 12px; font-weight: 850; font-variant-numeric: tabular-nums;
}
/* 제목이 닫기 버튼 아래로 파고들지 않게 — 버튼(38px + 여백)만큼 오른쪽을 비운다. */
.lnd .lnd-modal-main h3 { padding-right: 46px; margin: 14px 0 0; font-size: clamp(21px, 2.4vw, 27px); font-weight: 900; letter-spacing: -.035em; line-height: 1.25; word-break: keep-all; }
.lnd .lnd-modal-desc { margin: 14px 0 0; color: #c4ccd9; font-size: 15px; line-height: 1.7; white-space: pre-line; word-break: keep-all; }
.lnd .lnd-modal-speaker { margin-top: 22px; padding: 18px; border-radius: 14px; background: rgba(255, 255, 255, .05); border: 1px solid rgba(255, 255, 255, .08); }
/* 아바타·이름(왼쪽) + 로고(오른쪽 끝). 좁은 화면에서 셋이 한 줄에 안 들어가면 줄바꿈하고,
   그때도 margin-left:auto 가 남아 로고는 자기 줄의 오른쪽에 붙는다. */
.lnd .lnd-modal-speaker-head { display: flex; align-items: center; flex-wrap: wrap; gap: 13px; }
/* 팝업 로고 — 어두운 글래스 배경이라 흰 판을 깐다(투명 PNG 가 대부분). 여기선 로고가 한 번에
   하나만 보이므로(타임테이블처럼 여러 줄이 나란히 맞아야 하는 자리가 아니다) 폭은 고정 슬롯이
   아니라 로고 자체 비율대로 — fixedWidth:false 라 흰 판이 로고 크기에 꼭 맞게 줄어든다. */
${sessionLogoCss(".lnd .lnd-modal-logo", { plate: true, fixedWidth: false })}
/* margin-left:auto 로 줄의 오른쪽 끝까지 민다 — 판이 로고 크기로 줄어든 덕에 그 끝이
   아래 약력 구분선(.lnd-modal-bio 의 border-top)과 같은 오른쪽 여백에서 맞아떨어진다. */
.lnd .lnd-modal-logo { margin-left: auto; }
.lnd .lnd-modal-avatar { width: 52px; height: 52px; border-radius: 999px; overflow: hidden; flex-shrink: 0; display: grid; place-items: center; background: var(--primary-soft, #2a3040); color: #fff; font-weight: 800; font-size: 20px; }
.lnd .lnd-modal-avatar img { width: 100%; height: 100%; object-fit: cover; }
.lnd .lnd-modal-speaker-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.lnd .lnd-modal-speaker-id b { font-size: 16px; font-weight: 800; letter-spacing: -.02em; }
.lnd .lnd-modal-speaker-id span { font-size: 13px; color: #aeb8c9; }
.lnd .lnd-modal-bio { margin-top: 16px; padding-top: 15px; border-top: 1px solid rgba(255, 255, 255, .09); }
.lnd .lnd-modal-bio h4 { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid var(--primary-bright); font-size: 13px; font-weight: 800; letter-spacing: -.01em; }
.lnd .lnd-modal-bio p { margin: 0; color: #c4ccd9; font-size: 14px; line-height: 1.7; white-space: pre-line; word-break: keep-all; }
@keyframes lnd-modal-fade { from { opacity: 0; } }
@keyframes lnd-modal-pop { from { opacity: 0; transform: translateY(10px); } }
@media (max-width: 640px) {
  .lnd .lnd-modal, .lnd .lnd-modal.has-photo { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); width: calc(100% - 24px); }
  .lnd .lnd-modal-photo { display: none; }
  .lnd .lnd-modal-main { padding: 24px 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .lnd .lnd-modal, .lnd .lnd-modal-backdrop { animation: none; }
}

/* ── 타임테이블 ── */
.lnd .schedule { display: grid; gap: 10px; list-style: none; }
/* li 는 카드 껍데기만 — 2열(시각 | 내용)은 안쪽 .schedule-summary 가 잡는다.
   왜 여기서 그리드를 뺐나: 펼치기를 넣으면서 li 의 자식이 details 하나가 되어, li 의 열
   정의가 details 하나에 먹혔다(시간칸이 190px 대신 내용 폭으로 줄고 시각·제목이 다른 줄로
   갈라졌다). summary 에 subgrid 를 주는 방법도 있지만 부모(details)가 그리드가 아니라
   폴백한다 — 열 정의를 실제로 그리는 요소에 두는 쪽이 구조가 정직하다.
   overflow:hidden 은 펼침 영역이 카드 모서리를 넘지 않게. */
.lnd .schedule-row {
  border-radius: 6px; background: #f8f9fc; color: #111724; overflow: hidden;
  box-shadow: 0 10px 28px rgba(3, 9, 26, .12);
}
.lnd .schedule-row.is-break { background: rgba(58, 63, 98, .94); color: #f3f5fa; }
.lnd .schedule-time {
  padding: 0 23px; border-right: 1px solid rgba(21, 32, 51, .3);
  color: var(--primary-ink);
  font-size: 21px; font-weight: 900; font-variant-numeric: tabular-nums; white-space: nowrap;
}
.lnd .is-break .schedule-time { border-color: rgba(255, 255, 255, .25); color: #fff; }
/* 접힌 줄은 클릭 대상 전체가 summary 다 — 시각은 그대로 두고 마커만 없앤다.
   is-static 은 펼칠 것이 없는 행(상세·로고 둘 다 없음) — 커서를 손가락으로 바꾸지 않는다. */
.lnd .schedule-acc { display: block; }
/* 시각 | 내용 | 셰브론. 셰브론 열은 펼칠 수 없는 행에서는 자리를 차지하지 않는다(auto + 자식 없음). */
.lnd .schedule-summary {
  min-height: 62px;
  display: grid; grid-template-columns: 190px minmax(0, 1fr) auto; align-items: center;
  list-style: none; cursor: pointer;
}
/* 배치를 **명시**한다(자동 배치 금지). 자동 배치는 앞줄로 되돌아가지 못해서, 모바일에서
   내용이 두 열을 다 쓰는 순간(grid-column: 1 / -1) 셰브론이 다음 줄로 밀려 내용 아래
   자기 줄을 차지했다 — 실측(375px): summary 가 3행이 되고 셰브론이 폭 347px 로 혼자 한 줄.
   열을 적어 두면 소스 순서·자동 흐름과 무관하게 자리가 고정된다. */
.lnd .schedule-time { grid-area: 1 / 1; }
.lnd .schedule-content { grid-area: 1 / 2; }
.lnd .schedule-chev { grid-area: 1 / 3; }
.lnd .schedule-summary.is-static { cursor: default; }
.lnd .schedule-summary::-webkit-details-marker { display: none; }
/**
 * 펼침 셰브론 — 오른쪽 끝. 열리면 180도. 색은 행 색을 따라간다(반전 행에서도 보이게).
 *
 * **회전은 svg 에만 건다.** 예전엔 이 span(패딩을 가진 칸)을 회전시켰는데,
 * rotate(180deg) 가 padding-right 를 왼쪽으로 뒤집어 안쪽 글리프가 오른쪽으로 18px 밀렸다
 * → 접혔을 때와 펼쳤을 때 화살표 x 좌표가 어긋났다.
 * span 의 박스는 회전해도 그대로라서, span 을 재면 "제자리" 로 보인다(그래서 놓쳤다).
 * 여백은 span 이 갖고 움직이는 것은 svg 뿐 — 이제 뒤집힐 패딩이 없다.
 */
.lnd .schedule-chev {
  display: flex; align-items: center; justify-content: center;
  padding-right: 18px; color: currentColor; opacity: .55;
  transition: opacity .18s ease;
}
.lnd .schedule-chev svg {
  transition: transform .22s cubic-bezier(.22,.61,.36,1);
}
.lnd .schedule-chev svg { width: 18px; height: 18px; }
.lnd .schedule-summary:hover .schedule-chev { opacity: .9; }
.lnd details[open] > .schedule-summary .schedule-chev svg { transform: rotate(180deg); }
/* 상세 — 높이 애니메이션 대상(effects.attachAccordion). CSS 로는 열림 상태만 잡고,
   여닫는 모션은 JS 가 인라인 height 로 그린다(details 는 닫히면 내용이 즉시 감춰진다). */
.lnd .schedule-detail { overflow: hidden; }
.lnd .schedule-detail-in {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 18px;
  padding: 2px 20px 16px 20px;
  border-top: 1px solid rgba(21, 32, 51, .12);
  margin: 0 20px;
}
.lnd .is-break .schedule-detail-in { border-color: rgba(255, 255, 255, .18); }
.lnd .schedule-desc {
  margin: 12px 0 0; min-width: 0; flex: 1 1 auto;
  color: #4b5364; font-size: 13.5px; line-height: 1.7; white-space: pre-line; word-break: keep-all;
}
.lnd .is-break .schedule-desc { color: #d6dae6; }
.lnd .schedule-content { padding: 10px 20px; }
.lnd .schedule-name { display: block; font-size: 16.5px; font-weight: 850; letter-spacing: -.02em; word-break: keep-all; }
.lnd .schedule-name .tag {
  display: inline-block; margin-left: 10px; padding: 2px 9px; border-radius: 999px;
  border: 1px solid var(--primary-ink); color: var(--primary-ink);
  font-size: 11px; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; vertical-align: 2px;
}
/* 연사 줄 — "이름 | 소속·직책" 한 줄. 접힌 상태에서 훑는 데 필요한 건 시각·무엇·누구뿐이라
   로고는 여기서 빼고 펼침 영역으로 옮겼다(줄마다 로고 폭이 달라 눈이 걸렸다).
   이름을 소속보다 진하게 둬서 구분자가 없어도 어디까지가 이름인지 읽힌다. */
.lnd .schedule-speaker {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 6px;
  margin-top: 3px; color: #4b5364; font-size: 13.5px;
}
.lnd .schedule-speaker b { font-weight: 750; color: #2b3242; }
.lnd .is-break .schedule-speaker b { color: #eef1f7; }
.lnd .schedule-speaker .sep { opacity: .38; font-weight: 400; }
.lnd .schedule-speaker .co { font-weight: 500; }
/* 세션 로고 — 규격은 webinar-logo.ts 한 곳에서 온다(랜딩·대기·시청이 같은 크기여야 한다).
   밝은 타임테이블 행에서는 흰 판을 끈다 — 흰 배경에 흰 판은 네모 테두리로만 보인다. */
${sessionLogoCss(".lnd .schedule-logo")}
/* 펼침 영역 오른쪽 — 상세 본문과 나란히. flex:none 이라야 긴 본문에 눌려 찌그러지지 않는다. */
.lnd .schedule-logo { flex: none; margin-top: 12px; }
/* 반전된 휴식 행에서도 로고가 보이게 흰 판을 깐다(투명 PNG 가 대부분). */
.lnd .is-break .schedule-logo { background: #fff; border-radius: 4px; padding: 2px 4px; }

/* 섹션은 자기 배경을 칠하므로 래퍼가 필요 없다(옛 .dark-zone 제거).
   지브라는 nth-of-type 이 아니라 mount 가 계산한 data-band 로 건다 — 라이트/다크가 섞이면
   순서 기반 교대는 무작위로 보인다. 같은 모드가 연달아 올 때만 한 칸씩 톤을 낮춘다. */
.lnd .section { position: relative; }

/* ── 이런 분들께 추천합니다 ── (dark-zone 안 · Join 바로 위)
   카드 그리드가 아니라 **체크 목록**이다. 이 섹션의 일은 읽히는 것이 아니라 훑으면서
   나에 해당하는 줄을 찾는 것이라, 줄 단위로 눈이 내려가는 형태가 맞다.
   판 색·그림자는 이웃(program-card·join-step)과 같은 값을 쓴다 —
     (혜택은 카드 평면을 쓰지 않는다 — accent-zone 목록형이다) —
   같은 존 안에서 카드 마감이 갈리면 섹션 하나가 얹혀 있는 것처럼 보인다. */
/* ── 이런 분들께 추천합니다 ────────────────────────────────────────────
   이 섹션의 일은 "읽는 것" 이 아니라 **훑으면서 나에 해당하는 줄을 찾는 것** 이다.
   예전에는 흰 판 6개가 각자 그림자를 지고 있어서 눈이 6개의 개별 주장을 하나씩 처리해야
   했다 — 목록으로 읽히지 않았다. 판을 없애고 체크 열을 세로로 세운다: 눈이 그 열을 따라
   내려가고 각 줄은 "나인가?" 만 판정한다.

   2열은 유지한다 — 한 열로 가면 960px 에서 한 줄이 너무 길어져 읽기 폭이 무너진다.
   행 구분은 선이 아니라 여백으로 한다(선을 6개 그으면 판을 없앤 이득이 사라진다). */
.lnd .audience-list {
  display: grid; grid-template-columns: repeat(2, 1fr);
  column-gap: 40px; row-gap: 20px;
  list-style: none; padding: 0; margin: 0;
}
.lnd .audience-item { display: flex; align-items: flex-start; gap: 12px; }
/* 마크는 주인이 아니다 — 문장이 주인이다. 지금보다 작고 조용하게 두되 열은 또렷하게 선다. */
.lnd .audience-mark {
  flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center;
  margin-top: 2px;
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  color: var(--primary-bright);
  font-size: 12px; font-weight: 900; line-height: 1;
}
.lnd .audience-body { min-width: 0; }
/* 판이 사라졌으니 글자가 그 무게를 받는다 — 굵기를 낮추고 크기를 살짝 올려 문장으로 읽히게. */
.lnd .audience-body b { display: block; font-size: 17.5px; font-weight: 650; line-height: 1.6; letter-spacing: -.01em; color: var(--paper); word-break: keep-all; }
.lnd .audience-body p { margin: 4px 0 0; font-size: 15.5px; line-height: 1.65; color: var(--muted); white-space: pre-line; word-break: keep-all; }
.lnd .program-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.lnd .program-card, .lnd .join-step {
  border-radius: 8px; background: var(--card);
  box-shadow: var(--card-shadow);
}
.lnd .program-card { min-height: 142px; padding: 24px; }
.lnd .program-heading { display: flex; align-items: center; gap: 12px; }
.lnd .program-icon {
  min-width: 38px; height: 38px; display: grid; place-items: center; border-radius: 5px;
  background: var(--primary); color: var(--on-primary);
  font-size: 10px; font-weight: 900; letter-spacing: -.02em;
}
/* font-weight 를 **명시**한다. 이 앱 안에서는 Tailwind preflight 가 h1~h6 을
   font-weight: inherit 로 두므로 .lnd 의 400 을 물려받아 얇게 나오고, 임베드된 외부
   사이트(아임웹)에는 preflight 가 없어 UA 기본 bold(700)로 나온다 — 같은 페이지가
   환경에 따라 다른 굵기로 렌더됐다(실측: 우리 앱 400 / 섹션 제목 900).
   참여 방법 단계 제목(사전 등록·입장 확인·라이브 시청)이 눈에 걸려야 하는 자리라
   세 카드 계열을 같은 800 으로 맞춘다 — 한쪽만 굵게 하면 형제 카드가 어긋난다. */
.lnd .program-card h3, .lnd .join-step h3 {
  font-size: 21px; font-weight: 800; letter-spacing: -.03em; word-break: keep-all;
}
.lnd .program-card p, .lnd .join-step p {
  margin: 14px 0 0; color: var(--body);
  font-size: 13px; line-height: 1.7; white-space: pre-line; word-break: keep-all;
}
/* How to Join 만 10% 크게 — Programs 는 요청 범위가 아니라 공용 규칙을 그대로 두고 덮는다.
   (두 섹션이 한 선택자를 공유하고 있어서, 값을 바꾸면 Programs 까지 따라간다) */
.lnd .join-step p { font-size: 14.5px; }
.lnd .join-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }

/* ── 혜택 ──────────────────────────────────────────────────────────────
   **일반 섹션이다** — 자기 배경을 칠하고 지브라 교대에 참여한다. 예전에는 accent-zone 이라
   화면 중앙에 걸릴 때 배경이 통째로 키컬러로 뒤집혔는데, 키컬러 구간이 셋(세션·타임테이블·혜택)
   이나 되어 전환이 잦고 위아래 섹션과의 색 경계가 읽히지 않았다.

   Programs 와 형태를 나눈 이유는 그대로다: 둘 다 3열 카드였을 때 스크롤에서 구분되지 않았다
   (Audience 를 체크 목록으로 만든 것과 같은 판단). 카드 평면을 없애고 번호 + 한 줄로 눕힌다 —
   훑을 때 필요한 건 "몇 가지이고 무엇인가" 뿐이고, 판이 늘어나면 그게 묻힌다. */
.lnd .benefit-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
.lnd .benefit-row {
  display: grid; grid-template-columns: auto 1fr; gap: 22px; align-items: baseline;
  padding: 22px 0;
  border-top: 1px solid var(--line);
  transition: border-color .8s ease;
}
/* 첫 줄 위에는 선을 안 둔다 — 제목과 목록 사이에 이미 여백이 있어 선이 겹쳐 보인다. */
.lnd .benefit-row:first-child { border-top: 0; padding-top: 4px; }
.lnd .benefit-number {
  /* 카드 안의 작은 번호가 아니라 **줄의 기준점**이라 크게 쓴다. tabular-nums 로 자릿수를 고정해
     두 자리가 되어도 본문 시작선이 흔들리지 않는다. */
  font-size: 37px; font-weight: 900; line-height: 1; letter-spacing: -.04em;
  font-variant-numeric: tabular-nums;
  color: var(--primary-bright);
  transition: color .8s ease;
  min-width: 52px;
}
.lnd .benefit-body { min-width: 0; }
.lnd .benefit-body h3 {
  font-size: 22px; font-weight: 800; letter-spacing: -.03em; line-height: 1.35;
  color: var(--paper); word-break: keep-all;
  transition: color .8s ease;
}
.lnd .benefit-body p {
  margin: 8px 0 0; font-size: 15.5px; line-height: 1.7; color: var(--muted);
  white-space: pre-line; word-break: keep-all;
  transition: color .8s ease;
}

.lnd .join-step { padding: 26px; }
.lnd .join-k {
  display: block; font-size: 13px; font-weight: 900; letter-spacing: .18em; text-transform: uppercase;
  color: var(--primary-bright);
}
.lnd .join-step h3 { margin-top: 12px; }
.lnd .deadline {
  margin-top: clamp(40px, 7vh, 64px);
  text-align: center; color: var(--muted);
  font-size: clamp(14.5px, 1.9vw, 16.5px); font-variant-numeric: tabular-nums;
}
.lnd .deadline b { color: var(--paper); font-weight: 800; }

/* ── FAQ ── */
.lnd .faq-tabs { margin: -8px 0 26px; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }
.lnd .faq-tab {
  min-height: 44px; padding: 0 18px;
  border: 1px solid var(--line); border-radius: 7px; background: transparent;
  cursor: pointer; font-weight: 750;
  transition: background .2s ease, border-color .2s ease, color .2s ease;
}
.lnd .faq-tab[aria-pressed="true"] { border-color: var(--primary); background: var(--primary); color: var(--on-primary); }
.lnd .faq-list { display: grid; gap: 12px; }
/* 반복되는 얕은 판은 전용 표면과 짧은 그림자를 쓴다. 공용 카드의 큰 그림자를 쓰면
   라이트 배경에서 카드 사이가 넓은 회색 덩어리처럼 이어져 보인다. */
.lnd .faq-item { border-radius: 8px; background: var(--faq-card); overflow: hidden; box-shadow: var(--faq-shadow); }
.lnd .faq-item summary {
  min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 20px;
  padding: 0 18px; cursor: pointer; list-style: none;
  font-size: 15.5px; font-weight: 750; word-break: keep-all;
}
.lnd .faq-item summary::-webkit-details-marker { display: none; }
.lnd .faq-item summary::after { content: "+"; color: var(--muted); font-size: 23px; font-weight: 400; }
.lnd .faq-item[open] summary::after { content: "\\2212"; }
/* 답 본문은 래퍼로 감싼다 — 아코디언 모션이 높이를 재는 대상(data-acc-body).
   패딩을 p 가 아니라 여기 두면 height 0 에서 패딩이 남아 닫혀도 틈이 보이는 일이 없다. */
.lnd .faq-body { overflow: hidden; }
.lnd .faq-item p { margin: 0; padding: 0 18px 20px; color: var(--body); font-size: 14.5px; white-space: pre-line; }

/* ── 스폰서 (최하단 로고 벽) ──
   판은 **어느 모드에서든 흰색**이다. 스폰서 로고는 대부분 투명 배경 + 진한 잉크라
   var(--card) 를 쓰면 다크 모드에서 통째로 사라진다(세션 로고가 plate 를 쓰는 것과 같은 이유).
   라이트 모드에서는 흰 판이 배경과 같은 색이라 그림자만 남고, 그게 실제 행사 페이지의
   로고 벽 인상과도 맞는다.

   슬롯을 **고정 크기**로 잡는 이유도 세션 로고와 같다: 폭을 auto 로 두면 원본 비율대로
   칸이 제각각이 되어 로고들이 서로 다른 자리에서 시작·끝난다(들쭉날쭉). */
.lnd .sponsor-group + .sponsor-group { margin-top: clamp(30px, 4vw, 46px); }
.lnd .sponsor-tier {
  margin: 0 0 16px; text-align: center;
  font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
  color: var(--muted);
  transition: color .8s ease;
}
.lnd .sponsor-grid {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 12px;
  list-style: none; padding: 0; margin: 0;
}
.lnd .sponsor-item { display: block; }
.lnd .sponsor-tile {
  /* content-box 를 **명시**한다 — 랜딩은 남의 사이트에 직접 마운트되므로 호스트 리셋이
     border-box 여도 슬롯이 148×44 로 같아야 한다(webinar-logo.ts 와 같은 근거). */
  box-sizing: content-box;
  display: grid; place-items: center;
  width: 148px; height: 44px; padding: 14px 18px;
  border-radius: 8px; background: #fff;
  box-shadow: var(--card-shadow);
  text-decoration: none;
  transition: transform .2s ease, box-shadow .2s ease;
}
.lnd a.sponsor-tile:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(2, 8, 24, .22); }
.lnd .sponsor-logo { display: block; width: 148px; height: 44px; object-fit: contain; object-position: center; }
/* 글자 칩은 슬롯 높이를 **최소값**으로 쓴다 — 로고는 고정, 글자는 줄이 늘면 판이 자란다.
   고정하면 긴 이름이 판 밖으로 새고, 하드코딩된 잉크색이 다크 배경 위에서 그대로 사라진다
   (실측: "사단법인한국전시산업진흥회사무국" 이 184px 판에서 오른쪽 39px · 긴 영문명은 아래 26px). */
.lnd .sponsor-tile.is-text { height: auto; min-height: 44px; }
/* 로고가 없는 항목 — 글자 칩. 흰 판 위라 색은 배경 모드와 무관하게 고정한다. */
.lnd .sponsor-name {
  font-size: 15px; font-weight: 750; line-height: 1.35; letter-spacing: -.01em;
  color: #1b2130; text-align: center;
  /* keep-all 이 먼저다(한국어는 어절 단위로 끊는다). anywhere 는 **넘칠 때만** 개입한다 —
     띄어쓰기 없는 긴 기관명은 keep-all 만으로는 끊을 자리가 없어 통째로 삐져나간다. */
  word-break: keep-all; overflow-wrap: anywhere;
  /* 자동 트랙이 슬롯보다 커지지 않게 — 이게 없으면 그리드 칸이 글자 폭까지 늘어난다. */
  width: 100%;
}

/* ── 스크롤 리빌(transform 전용 — JS 미실행에서도 콘텐츠 가시) ── */
.lnd .rv { transform: translateY(12px); transition: transform .5s cubic-bezier(.22, .7, .2, 1); }
.lnd .rv.in { transform: translateY(0); }

@media (max-width: 760px) {
  .lnd .hero-inner { width: min(100% - 32px, 980px); padding-bottom: 150px; }
  .lnd .hero h1, .lnd .hero h2 { font-size: clamp(38px, 13vw, 66px); }
  .lnd .hero-subtitle { font-size: 17px; }
  .lnd .hero-meta { left: 50%; bottom: 116px; transform: translateX(-50%); width: 100%; text-align: center; font-size: 15px; }
  .lnd .hero-cta { left: 50%; right: auto; bottom: 36px; width: min(100%, 320px); transform: translateX(-50%); }
  .lnd .hero-cta:hover { transform: translate(-50%, -2px); }
  .lnd .intro { min-height: 480px; padding-inline: 20px; }
  .lnd .intro .intro-pc { display: none; }
  .lnd .intro .intro-mobile { display: inline; }
  .lnd .scroll-cue { bottom: 28px; }
  .lnd .section { width: min(100% - 28px, var(--max)); }
  .lnd .session-cards { gap: 14px; }
  .lnd .session-card { width: min(calc(50% - 7px), 252px); }
  .lnd .session-card-body { inset: auto 12px 12px; }
  .lnd .session-card h3 { margin: 9px 0 14px; font-size: 14px; }
  .lnd .session-time { min-height: 25px; font-size: 10px; }
  .lnd .schedule-summary { min-height: 72px; grid-template-columns: 112px minmax(0, 1fr) auto; }
  .lnd .schedule-time { padding: 0 12px; font-size: 15px; }
  .lnd .schedule-content { padding: 10px 12px; }
  .lnd .schedule-name { font-size: 14px; }
  /**
   * 펼침 상세 — 모바일에서는 **로고를 빼고 본문이 폭을 다 쓴다.**
   *
   * 데스크톱은 "본문 | 로고" 2열(flex)인데 로고가 고정 120px 이다. 모바일 오버라이드가 없어서
   * 375px 에서 본문에 남는 폭이 실측 157px 였다(375 − 40 여백 − 40 패딩 − 120 로고 − 18 gap).
   * 거기에 word-break:keep-all 이 걸려 있어 5~6자마다 줄이 끊겼다("한국에서의 성공이 /
   * 미국에서도 이어지기 위해 / …"). 좁은 화면에서 조직 마크는 읽는 데 기여하지 않으므로
   * 본문에 폭을 준다.
   *
   * 여백도 같이 맞춘다: 상세는 margin 20 + padding 20 = 40px 들여쓰기였는데 바로 위 제목은
   * 14px 다(.schedule-content). 로고를 빼도 제목과 어긋나 보이던 원인이 이것이다.
   */
  .lnd .schedule-detail-in { display: block; margin: 0 14px; padding: 2px 0 14px; }
  .lnd .schedule-desc { margin-top: 10px; }
  .lnd .schedule-logo { display: none; }
  .lnd .program-grid, .lnd .join-grid, .lnd .audience-list { grid-template-columns: 1fr; }
  /* 한 열로 접히면 좌우 간격은 의미가 없고 위아래만 남는다 — 줄 사이를 조금 벌린다. */
  .lnd .audience-list { row-gap: 16px; }
  /* 모바일에서는 번호 열을 좁히고 간격을 줄인다 — 52px 를 유지하면 본문이 두 글자씩 접힌다. */
  .lnd .benefit-row { gap: 14px; padding: 18px 0; }
  .lnd .benefit-number { font-size: 29px; min-width: 38px; }
  .lnd .benefit-body h3 { font-size: 19px; }
  .lnd .faq-tabs { overflow-x: auto; justify-content: flex-start; padding-bottom: 4px; }
  .lnd .faq-tab { flex: 0 0 auto; }
  /* 로고 슬롯을 줄인다 — 148px 를 유지하면 375px 폭에서 한 줄에 한 개밖에 안 들어가
     로고 벽이 세로로 끝없이 늘어진다(2개/줄이 되게 잡은 값). */
  .lnd .sponsor-grid { gap: 10px; }
  .lnd .sponsor-tile { width: 118px; height: 36px; padding: 11px 14px; }
  /* 데스크톱과 같은 규칙 — 글자 칩만 높이가 자란다(위 주석). 이 줄이 없으면 좁은 폭에서
     줄이 더 자주 늘어나므로 오히려 여기서 더 필요하다. */
  .lnd .sponsor-tile.is-text { height: auto; min-height: 36px; }
  .lnd .sponsor-logo { width: 118px; height: 36px; }
  .lnd .sponsor-name { font-size: 13.5px; }
}

@media (max-width: 410px) {
  .lnd .session-card { width: 100%; max-width: 310px; }
  .lnd .session-card h3 { font-size: 16px; }
  /* 모바일 — 1행: 시각 | 셰브론, 2행: 내용(두 열 span). 세 자리를 다 적어야 셰브론이
     내용 아래로 밀리지 않는다(위 주석의 자동 배치 함정). */
  .lnd .schedule-summary { grid-template-columns: minmax(0, 1fr) auto; gap: 0; }
  .lnd .schedule-time { grid-area: 1 / 1; }
  .lnd .schedule-chev { grid-area: 1 / 2; align-self: center; padding-right: 14px; }
  .lnd .schedule-content { grid-area: 2 / 1 / 3 / -1; }
  .lnd .schedule-time { padding: 10px 14px 6px; border-right: 0; border-bottom: 1px solid rgba(21, 32, 51, .15); }
  .lnd .is-break .schedule-time { border-color: rgba(255, 255, 255, .14); }
  .lnd .schedule-content { padding: 7px 14px 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .lnd, .lnd *, .lnd *::before, .lnd *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
  .lnd .rv { transform: none; }
}
`;
