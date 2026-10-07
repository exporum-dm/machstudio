/**
 * 대회 공고 CSS = 껍데기(랜딩에서 추출) + 대회 고유 섹션.
 *
 * 껍데기는 절대 여기서 고치지 않는다 — shell-css.ts 는 자동 생성물이고, 고칠 일이 있으면
 * 랜딩 원본을 고친 뒤 재생성한다(shell-sync 테스트가 강제). 이 파일에는 대회에만 있는
 * 섹션(.nt-*)만 쓴다.
 *
 * 색은 껍데기가 심어 둔 변수만 쓴다:
 *   --primary / --on-primary : 키컬러
 *   --paper                  : 그 배경 위에서 읽히는 글자색
 *   --sec-bg                 : 섹션 배경(라이트/다크 모드에 따라 달라짐)
 * 하드코딩하면 라이트 모드에서 대비가 무너진다.
 */
import { NOTICE_SHELL_CSS } from "./shell-css";

const SECTION_CSS = `
/**
 * ── 운영자가 넣은 줄바꿈을 보존한다 ──
 *
 * 공고의 문구는 **사람이 쓴 글**이라 어디서 줄을 바꿀지가 곧 의도다(일정 안내, 준비물 목록,
 * 상금 조건처럼 한 항목 안에서 줄을 나눠 읽히게 쓰는 경우가 많다).
 * 기본값 white-space: normal 은 그 줄바꿈을 공백 하나로 뭉갠다 — 편집기에서 엔터를 쳐도
 * 화면에서는 앞뒤 문장이 그냥 이어 붙는다.
 *
 * pre-line 을 쓰는 이유(pre 가 아니라): 들여쓰기·연속 공백은 그대로 접고 **줄바꿈만** 살린다.
 * 붙여넣기로 들어온 앞뒤 공백이 레이아웃을 밀지 않는다.
 *
 * 값을 넣는 자리 전부에 건다 — 한 곳만 빠져도 "여기만 안 되네" 가 된다.
 * (AGENTS.md 공통: "사용자 텍스트(설명 등)는 줄바꿈을 보존해 표시".)
 */
.lnd .hero-subtitle,
.lnd .hero-note,
.lnd .hero-fact dd,
.lnd .section-desc,
.lnd .nt-concept-body p,
.lnd .nt-stat-value,
.lnd .nt-stat-value small,
.lnd .nt-tl-body p,
.lnd .nt-step-list li,
.lnd .nt-elig-item > span:last-child,
.lnd .nt-round-note,
.lnd .nt-crit-desc,
.lnd .nt-prize-desc,
.lnd .nt-faq-a { white-space: pre-line; }

/**
 * ── 보조 색 · 버튼 색 ──
 *
 * 껍데기는 전부 --primary 하나로 그린다. 공고는 여기서 두 자리만 떼어 낸다:
 *
 *   --primary-alt : **글자 강조** — 제목 둘째 줄, 섹션 라벨, 강조구
 *   --btn         : **눌리는 것** — 신청 버튼
 *
 * 둘 다 비우면 mount 가 키컬러로 확정해 넣으므로, 안 쓰면 지금과 똑같이 보인다.
 * 링·비율 막대·상금 강조처럼 "면"을 칠하는 자리는 키컬러로 남긴다 — 거기까지 갈라 놓으면
 * 색이 네 개가 되어 페이지가 산만해진다.
 */
.lnd .hero-line-accent,
.lnd .section-kicker,
.lnd .nt-concept-accent { color: var(--primary-alt); }
.lnd .hero-cta {
  background: var(--btn);
  color: var(--on-btn) !important;
  box-shadow: 0 16px 34px color-mix(in srgb, var(--btn) 34%, transparent);
}
.lnd .hero-cta:hover { box-shadow: 0 20px 42px color-mix(in srgb, var(--btn) 46%, transparent); }

/**
 * ── 섹션 배경 이미지 ──
 *
 * 켠 섹션에만 붙는다(.section.has-bg). 히어로와 같은 구조 — 감싸는 상자 + 안쪽 img.
 *
 * **화면 폭 전체로 깐다.** .section 은 min(100%-36px, 960px) 로 가운데 정렬된 글 상자라,
 * 배경을 그 안에 가두면 좌우에 색 띠가 남아 "카드에 사진을 붙인" 꼴이 된다.
 * 섹션이 자기 배경을 칠할 때 쓰는 것과 같은 수법으로 넓힌다(left/right: calc(50% - 50vw)).
 *
 * **스크림은 선택이 아니다.** 사진 위에 글자를 얹는 순간 밝은 부분에서 글이 사라진다.
 * 섹션 배경색(--sec-bg)으로 덮으므로 라이트/다크 어느 쪽이든 글자 대비가 유지된다.
 */
.lnd .nt-bg {
  position: absolute; z-index: -1; top: 0; bottom: 0;
  left: calc(50% - 50vw); right: calc(50% - 50vw);
  overflow: hidden;
}
.lnd .nt-bg img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lnd .nt-bg::after {
  content: ""; position: absolute; inset: 0;
  background: color-mix(in srgb, var(--sec-bg) var(--scrim-a, 72%), transparent);
}

/**
 * ── 사진 위의 카드 ──
 *
 * 카드들은 **평평한 색 위에 놓일 걸 전제로** --paper 5% 정도의 옅은 막으로 그려져 있다.
 * 뒤에 사진이 깔리면 그 막은 사실상 투명해서 카드가 사라지고 안이 안 읽힌다 —
 * 실제로 배경을 넣은 섹션에서 그렇게 보였다.
 *
 * 배경을 켠 섹션에서만 카드 바탕을 **섹션색**으로 바꾼다. --paper(글자색) 가 아니라
 * --sec-bg(배경색)여야 라이트/다크 어느 쪽이든 글자와 대비가 유지된다.
 * 진하기는 운영자가 정한다 — 사진마다 밝기가 달라 한 값으로는 못 맞춘다.
 */
.lnd .section.has-bg .nt-step,
.lnd .section.has-bg .nt-round,
.lnd .section.has-bg .nt-prize,
.lnd .section.has-bg .nt-elig,
.lnd .section.has-bg .nt-cd-box,
.lnd .section.has-bg .nt-stat {
  background: color-mix(in srgb, var(--sec-bg) var(--panel-a, 88%), transparent);
}
/* 1등 상금은 키컬러 그라데이션이 정체성이라 덮지 않고, 아래에 섹션색만 깔아 준다. */
.lnd .section.has-bg .nt-prize.is-top {
  background:
    linear-gradient(160deg, color-mix(in srgb, var(--primary) 16%, transparent), transparent 70%),
    color-mix(in srgb, var(--sec-bg) var(--panel-a, 88%), transparent);
}
/* 구분선 격자(.nt-stats)는 칸 사이 1px 이 배경색이라, 사진이 그 틈으로 새어 나온다. */
.lnd .section.has-bg .nt-stats { background: color-mix(in srgb, var(--sec-bg) var(--panel-a, 88%), transparent); }
/* 막대 트랙도 마찬가지 — 사진이 비치면 채워진 길이가 안 보인다. */
.lnd .section.has-bg .nt-bar-track { background: color-mix(in srgb, var(--sec-bg) var(--panel-a, 88%), transparent); }

/**
 * ── 배경 초점 ──
 *
 * 가로 사진을 세로 화면에 깔면 좌우가 크게 잘린다. 기본값 가운데(50% 50%)가 하필 인물이나
 * 로고를 비껴가는 일이 흔해서, 운영자가 어디를 보여 줄지 고르게 한다.
 *
 * **데스크톱과 모바일 값을 따로 둔다.** 잘리는 방향이 반대라(가로 화면은 위아래가,
 * 세로 화면은 좌우가 잘린다) 값 하나로는 양쪽을 동시에 맞출 수 없다.
 * 값은 인라인 CSS 변수로 온다(media-focus.ts) — 인라인 스타일로는 미디어 쿼리를 못 쓴다.
 */
.lnd .nt-bg img,
.lnd .hero-media img { object-position: var(--fx, 50%) var(--fy, 50%); }

/* ── 섹션 머리 ── */
/* 색은 위 "보조 색" 블록이 갖는다 — 여기서 다시 선언하면 뒤에 와서 그걸 덮는다. */
.lnd .section-kicker { display: block; font-size: 11.5px; font-weight: 800; letter-spacing: .16em;
  text-transform: uppercase; margin-bottom: 12px; }
.lnd .section-head { max-width: 640px; margin-bottom: 44px; }
/* 껍데기의 .section-title 은 **가운데 정렬**이다(랜딩은 제목이 페이지 폭 전체를 쓴다).
   공고는 제목을 왼쪽 640px 상자에 넣으므로 그 규칙이 그대로 걸리면 짧은 제목만
   상자 안에서 가운데로 밀려 "제목만 들여쓴" 모양이 된다(실측: ELIGIBILITY 가 눈금
   52px 대신 85px). 머리글 안에서는 왼쪽 정렬로 되돌리고, 아래 설명과의 간격도
   껍데기의 큰 여백(최대 70px) 대신 한 덩어리로 읽히게 좁힌다. */
.lnd .section-head .section-title { margin: 0; text-align: left; font-size: clamp(28px, 3.6vw, 42px); }
.lnd .section-head .section-desc { margin-top: 14px; font-size: 15.5px; line-height: 1.7;
  color: color-mix(in srgb, var(--paper) 74%, transparent); word-break: keep-all; }
.lnd .nt-foot { margin-top: 22px; }

/* ── 개념 ── */
.lnd .nt-concept-grid { display: grid; grid-template-columns: 1.05fr .95fr; gap: 56px; align-items: start;
  width: min(100% - 40px, var(--max)); margin-inline: auto; }
.lnd .nt-concept-headline { font-size: clamp(26px, 3.4vw, 40px); line-height: 1.16; margin: 0; word-break: keep-all; }
.lnd .nt-concept-body p { margin: 0 0 16px; font-size: 15.5px; line-height: 1.75;
  color: color-mix(in srgb, var(--paper) 74%, transparent); word-break: keep-all; }
.lnd .nt-concept-body p:last-child { margin-bottom: 0; }

/* ── 한눈에 보기 ── */
/* 1px gap + 바탕색으로 구분선을 만든다 — border 로 그리면 모서리에서 두 배로 겹친다. */
.lnd .nt-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px;
  background: color-mix(in srgb, var(--paper) 14%, transparent);
  border-radius: 18px; overflow: hidden; }
.lnd .nt-stat { background: var(--sec-bg); padding: 28px 24px; }
.lnd .nt-stat-label { font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: color-mix(in srgb, var(--paper) 58%, transparent); margin-bottom: 10px; }
.lnd .nt-stat-value { font-size: 24px; font-weight: 800; line-height: 1.25; word-break: keep-all; }
.lnd .nt-stat-value small { display: block; margin-top: 6px; font-size: 13px; font-weight: 600;
  color: color-mix(in srgb, var(--paper) 62%, transparent); }

/* ── 타임라인 ── */
.lnd .nt-timeline { list-style: none; margin: 0; padding: 0; }
.lnd .nt-tl-row { display: grid; grid-template-columns: 132px 28px 1fr; gap: 0 20px; align-items: start;
  padding: 20px 0; border-top: 1px solid color-mix(in srgb, var(--paper) 14%, transparent); }
.lnd .nt-tl-row:last-child { border-bottom: 1px solid color-mix(in srgb, var(--paper) 14%, transparent); }
.lnd .nt-tl-date { font-size: 12.5px; font-weight: 700; letter-spacing: .04em; padding-top: 3px;
  color: color-mix(in srgb, var(--paper) 62%, transparent); }
.lnd .nt-tl-node { position: relative; display: flex; justify-content: center; }
/* 세로선은 마지막 줄에서 끊는다 — 안 끊으면 아래 여백으로 삐져나온다. */
.lnd .nt-tl-node::before { content: ""; position: absolute; top: 10px; bottom: -20px; width: 1px;
  background: color-mix(in srgb, var(--paper) 14%, transparent); }
.lnd .nt-tl-row:last-child .nt-tl-node::before { display: none; }
.lnd .nt-tl-dot { width: 11px; height: 11px; margin-top: 3px; border-radius: 999px;
  background: var(--sec-bg); border: 2px solid color-mix(in srgb, var(--paper) 34%, transparent); }
.lnd .nt-tl-row.is-key .nt-tl-dot { border-color: var(--primary); background: var(--primary); }
.lnd .nt-tl-body b { display: block; font-size: 15.5px; margin-bottom: 4px; word-break: keep-all; }
.lnd .nt-tl-body p { margin: 0; font-size: 14px; line-height: 1.65; word-break: keep-all;
  color: color-mix(in srgb, var(--paper) 68%, transparent); }

/* ── 신청 방법 ── */
.lnd .nt-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.lnd .nt-step { display: flex; flex-direction: column; gap: 12px; padding: 24px 20px; border-radius: 16px;
  background: color-mix(in srgb, var(--paper) 5%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--paper) 12%, transparent); }
/* 속을 비운 숫자 — 카드 안에서 내용보다 앞서 읽히면 안 된다. */
.lnd .nt-step-no { font-size: 30px; font-weight: 900; line-height: 1; color: transparent;
  -webkit-text-stroke: 1.5px color-mix(in srgb, var(--paper) 42%, transparent); }
.lnd .nt-step-title { font-size: 15.5px; word-break: keep-all; }
.lnd .nt-step-list { margin: 0; padding-left: 17px; display: flex; flex-direction: column; gap: 5px;
  font-size: 13.5px; line-height: 1.6; color: color-mix(in srgb, var(--paper) 70%, transparent); }
.lnd .nt-step-list li { word-break: keep-all; }

/* ── 자격 요건 ── */
.lnd .nt-elig { list-style: none; margin: 0; padding: 36px; border-radius: 20px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px 36px;
  background: color-mix(in srgb, var(--paper) 5%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--paper) 12%, transparent); }
.lnd .nt-elig-item { display: flex; gap: 12px; align-items: flex-start; padding: 13px 0; font-size: 14.5px;
  line-height: 1.6; word-break: keep-all;
  border-bottom: 1px solid color-mix(in srgb, var(--paper) 12%, transparent); }
/* 마지막 두 줄(2열이라 한 행)은 밑줄을 지운다. */
.lnd .nt-elig-item:nth-last-child(1), .lnd .nt-elig-item:nth-last-child(2) { border-bottom: none; }
.lnd .nt-elig-check { flex: none; width: 20px; height: 20px; margin-top: 1px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center; color: var(--primary);
  background: color-mix(in srgb, var(--primary) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 55%, transparent); }
.lnd .nt-elig-check svg { width: 12px; height: 12px; }

/* ── 선발 방식 ── */
.lnd .nt-rounds { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.lnd .nt-round { padding: 28px; border-radius: 18px;
  background: color-mix(in srgb, var(--paper) 5%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--paper) 12%, transparent); }
.lnd .nt-round h3 { margin: 0 0 6px; font-size: 18px; word-break: keep-all; }
.lnd .nt-round-note { margin: 0 0 20px; font-size: 13px;
  color: color-mix(in srgb, var(--paper) 62%, transparent); }
.lnd .nt-bar-row { margin-bottom: 15px; }
.lnd .nt-bar-row:last-child { margin-bottom: 0; }
.lnd .nt-bar-label { display: flex; justify-content: space-between; gap: 12px;
  font-size: 13px; font-weight: 700; margin-bottom: 7px; }
.lnd .nt-bar-track { height: 10px; border-radius: 999px; overflow: hidden;
  background: color-mix(in srgb, var(--paper) 10%, transparent); }
.lnd .nt-bar-fill { height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--primary) 62%, transparent), var(--primary)); }

/* ── 심사 기준 ── */
.lnd .nt-crit { border-top: 1px solid color-mix(in srgb, var(--paper) 14%, transparent); }
.lnd .nt-crit-row { display: grid; grid-template-columns: 230px 1fr 62px; gap: 18px; align-items: center;
  padding: 17px 0; border-bottom: 1px solid color-mix(in srgb, var(--paper) 14%, transparent); }
.lnd .nt-crit-name { font-size: 14.5px; font-weight: 800; word-break: keep-all; }
.lnd .nt-crit-desc { font-size: 13.5px; line-height: 1.6; word-break: keep-all;
  color: color-mix(in srgb, var(--paper) 68%, transparent); }
.lnd .nt-crit-pts { text-align: right; font-size: 14px; font-weight: 800; color: var(--primary);
  font-variant-numeric: tabular-nums; }

/* ── 상금 ── */
.lnd .nt-prizes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.lnd .nt-prize { padding: 32px 24px; border-radius: 20px;
  background: color-mix(in srgb, var(--paper) 5%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--paper) 12%, transparent); }
.lnd .nt-prize.is-top { background: linear-gradient(160deg, color-mix(in srgb, var(--primary) 16%, transparent),
  color-mix(in srgb, var(--paper) 5%, transparent) 62%);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--primary) 55%, transparent); }
.lnd .nt-prize-rank { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: color-mix(in srgb, var(--paper) 58%, transparent); }
.lnd .nt-prize-title { margin: 13px 0 4px; font-size: 22px; font-weight: 800; word-break: keep-all; }
.lnd .nt-prize-desc { font-size: 13px; margin-bottom: 20px;
  color: color-mix(in srgb, var(--paper) 64%, transparent); }
.lnd .nt-prize-amount { font-size: 36px; font-weight: 900; letter-spacing: -.01em; }
.lnd .nt-prize.is-top .nt-prize-amount { color: var(--primary); }

/* ── 마감 카운트다운 ── */
.lnd .nt-final { text-align: center; }
.lnd .nt-final-inner { width: min(100% - 40px, 720px); margin-inline: auto; }
.lnd .nt-final .section-desc { margin-inline: auto; }
.lnd .nt-countdown { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin: 32px 0 28px; }
.lnd .nt-cd-box { min-width: 78px; padding: 15px 18px; border-radius: 14px;
  background: color-mix(in srgb, var(--paper) 6%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--paper) 12%, transparent); }
.lnd .nt-cd-num { font-size: 28px; font-weight: 900; color: var(--primary); font-variant-numeric: tabular-nums; }
.lnd .nt-cd-label { margin-top: 4px; font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  color: color-mix(in srgb, var(--paper) 58%, transparent); }
/* 최종 CTA 는 히어로 버튼과 같은 모양이되 자리만 다르다 — .hero-cta 의 고정 배치를 푼다. */
.lnd .nt-final-cta { position: static; transform: none; margin-inline: auto; }
.lnd .nt-final-cta:hover { transform: translateY(-2px); }

/* ── 사진 배너 ──
   사진이 주인공이다. 섹션 높이를 화면 비율로 잡고 글은 아래쪽에 — 가운데를 가리지 않게.
   배경 막(.nt-bg)은 다른 섹션과 같은 걸 쓰되, 글이 놓이는 아래쪽만 진하게 깐다.
   사진을 안 넣었으면 섹션색 위에 큰 문구만 남는다(그래도 읽힌다). */
.lnd .nt-banner {
  min-height: clamp(380px, 62vh, 640px);
  display: flex; flex-direction: column; justify-content: flex-end;
  padding-block: clamp(56px, 8vw, 96px);
}
.lnd .nt-banner.has-bg .nt-bg::after {
  background: linear-gradient(to top,
    color-mix(in srgb, var(--sec-bg) var(--scrim-a, 72%), transparent) 0%,
    color-mix(in srgb, var(--sec-bg) calc(var(--scrim-a, 72%) * .35), transparent) 55%,
    transparent 100%);
}
.lnd .nt-banner-copy { max-width: 760px; }
.lnd .nt-banner-title {
  margin: 0; font-size: clamp(34px, 6.4vw, 76px); font-weight: 900; line-height: .98;
  letter-spacing: -.045em; text-transform: uppercase;
}
.lnd .nt-banner-body { margin-top: 18px; max-width: 560px; font-size: 16px; line-height: 1.7; color: var(--body); }
.lnd .nt-banner-body p { margin: 0 0 10px; }

/* ── 사진 + 글 ──
   화면 폭 전체를 반반으로 쓴다(.section 은 960px 글 상자라 거기서 꺼낸다).
   패널은 버튼색 — 페이지에서 "눌러 볼 만한 것"과 같은 색이 강조 면이 된다. */
.lnd .nt-split { width: 100%; max-width: none; padding: 0; }
.lnd .nt-split-grid { display: grid; grid-template-columns: 1.35fr 1fr; min-height: clamp(320px, 42vw, 520px); }
.lnd .nt-split.is-reverse .nt-split-grid { grid-template-columns: 1fr 1.35fr; }
.lnd .nt-split.is-reverse .nt-split-media { order: 2; }
.lnd .nt-split-media { position: relative; overflow: hidden; min-height: 260px; }
.lnd .nt-split-media img {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block;
  object-position: var(--fx, 50%) var(--fy, 50%);
}
.lnd .nt-split-panel {
  display: flex; flex-direction: column; justify-content: center;
  padding: clamp(36px, 5vw, 72px);
  background: var(--btn); color: var(--on-btn);
}
.lnd .nt-split-kicker { font-size: 11.5px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; opacity: .85; margin-bottom: 12px; }
.lnd .nt-split-title {
  margin: 0; color: inherit; font-size: clamp(28px, 3.6vw, 46px); font-weight: 900; line-height: 1;
  letter-spacing: -.04em; text-transform: uppercase; font-style: italic;
}
.lnd .nt-split-body { margin-top: 16px; font-size: 15px; line-height: 1.7; opacity: .92; }
.lnd .nt-split-body p { margin: 0 0 10px; }

/* ── 영상 ──
   유튜브 iframe 은 비율 상자에 넣는다. 쇼츠(세로)는 폭을 줄여 화면을 다 먹지 않게.
   캡션이 있으면 넓은 화면에서 영상 옆, 좁은 화면에서 아래. */
.lnd .nt-video { display: grid; gap: clamp(24px, 4vw, 48px); align-items: center; justify-items: center; }
.lnd .nt-video.has-caption { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); justify-items: stretch; }
.lnd .nt-video.is-vertical.has-caption { grid-template-columns: minmax(0, 340px) minmax(0, 1fr); justify-content: center; }
.lnd .nt-video-frame {
  position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden;
  border-radius: 18px; background: #000; box-shadow: var(--card-shadow);
}
.lnd .nt-video.is-vertical .nt-video-frame { aspect-ratio: 9 / 16; max-width: 340px; }
.lnd .nt-video-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.lnd .nt-video-label {
  display: inline-block; padding: 5px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 800;
  letter-spacing: .12em; text-transform: uppercase; background: var(--btn); color: var(--on-btn);
}
.lnd .nt-video-title { margin: 14px 0 0; font-size: clamp(24px, 3vw, 34px); font-weight: 900; line-height: 1.05; letter-spacing: -.03em; }
.lnd .nt-video-body { margin: 12px 0 0; font-size: 14.5px; line-height: 1.7; color: var(--muted); }

/* ── 신청 폼 ──
   폼 자체의 모양은 등록 폼 런타임이 갖는다. 여기서는 자리만 잡고, 미리보기 자리표시만 칠한다. */
.lnd .nt-form-slot { max-width: 640px; margin-inline: auto; }
.lnd .nt-form-placeholder {
  max-width: 640px; margin-inline: auto; padding: 48px 24px; border-radius: 18px; text-align: center;
  font-size: 14px; font-weight: 700; color: var(--muted);
  border: 1.5px dashed color-mix(in srgb, var(--paper) 28%, transparent);
}

@media (max-width: 760px) {
  .lnd .nt-split-grid,
  .lnd .nt-split.is-reverse .nt-split-grid { grid-template-columns: 1fr; }
  .lnd .nt-split.is-reverse .nt-split-media { order: 0; }
  .lnd .nt-split-media { min-height: 0; aspect-ratio: 4 / 3; }
  .lnd .nt-split-media img { object-position: var(--mfx, 50%) var(--mfy, 50%); }
  .lnd .nt-video.has-caption,
  .lnd .nt-video.is-vertical.has-caption { grid-template-columns: 1fr; justify-items: center; }
  .lnd .nt-video-caption { width: 100%; }
}

/* ── 히어로 세로 정렬 ──
   껍데기의 .hero-inner 는 grid + place-items:center 다. 랜딩은 그 안에 카피 한 덩어리뿐이라
   가운데에 놓였지만, 공고는 **카피 + 팩트 줄** 둘이라 암묵 행이 두 개가 된다. grid 의
   align-content 기본값(normal→stretch)이 남는 높이를 두 행에 반씩 나눠 주므로 카피는
   위쪽 절반의 가운데 = 화면 중앙보다 한참 위에 걸린다.

   흐름을 명시한다: 카피가 남는 높이를 전부 먹고 그 안에서 가운데, 팩트 줄은 바닥.
   아래 여백은 절대 배치된 .hero-cta(bottom:48px, 높이 58px)가 앉을 자리로 비워 둔다 —
   안 비우면 팩트 줄과 버튼이 겹친다. */
.lnd .hero-inner {
  display: flex; flex-direction: column;
  padding-bottom: 124px;
}
/* align-items 를 반드시 적는다. 세로 흐름을 flex 로 바꾸면 기본값 stretch 가 걸려
   inline-flex 인 자식(.hero-brand 알약, .hero-actions)이 **한 줄 폭 전체로 늘어난다** —
   가운데 정렬된 알약이 좌우로 찢어진 테두리 상자가 됐다. */
.lnd .hero-copy { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; align-items: center; }

/* 넓은 화면에서는 팩트 줄을 **바닥 줄로 뺀다** — 원본 디자인처럼 왼쪽에 팩트, 오른쪽에 CTA.
   흐름에 두면 아래쪽만 두꺼워져(아래 여백 124 + 팩트 81 vs 위 여백 96) 카피가 실제
   가운데보다 54px 위에 걸린다(실측 1280×900). 껍데기가 .hero-meta 에 쓰는 것과 같은 수법이다.
   위아래 여백을 같게 맞춰야 남은 공간이 대칭이 되고, 그래야 카피가 정말 가운데에 온다.
   오른쪽 236px 은 CTA(최소 폭 210 + 여유)가 앉을 자리다. */
@media (min-width: 761px) {
  .lnd .hero-inner { padding-top: 124px; }
  .lnd .hero-facts { position: absolute; left: 0; right: 236px; bottom: 46px; }
}

/* ── 히어로 팩트 줄 ── */
.lnd .hero-facts { display: flex; flex-wrap: wrap; gap: 26px; margin: 0; padding-top: 26px;
  border-top: 1px solid color-mix(in srgb, var(--paper) 16%, transparent); }
.lnd .hero-fact dt { font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: color-mix(in srgb, var(--paper) 62%, transparent); margin-bottom: 6px; }
.lnd .hero-fact dd { margin: 0; font-size: 21px; font-weight: 800; word-break: keep-all; }
.lnd .hero-brand { display: inline-flex; align-items: center; margin-bottom: 22px; padding: 7px 14px;
  border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase;
  color: var(--primary); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 45%, transparent); }
.lnd .hero-line { display: block; }
.lnd .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
.lnd .hero-secondary { display: inline-flex; align-items: center; justify-content: center;
  padding: 13px 22px; border-radius: 999px; font-size: 14px; font-weight: 800; text-decoration: none;
  color: var(--paper); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--paper) 26%, transparent); }
.lnd .hero-secondary:hover { box-shadow: inset 0 0 0 1px var(--paper); }
.lnd .hero-note { margin: 14px 0 0; font-size: 13px; color: color-mix(in srgb, var(--paper) 66%, transparent); }

/* ── FAQ ── */
.lnd .nt-faq { border-top: 1px solid color-mix(in srgb, var(--paper) 14%, transparent); }
.lnd .nt-faq-item { border-bottom: 1px solid color-mix(in srgb, var(--paper) 14%, transparent); }
.lnd .nt-faq-q { padding: 17px 0; font-size: 15px; font-weight: 700; cursor: pointer; list-style: none;
  word-break: keep-all; }
.lnd .nt-faq-q::-webkit-details-marker { display: none; }
.lnd .nt-faq-a { padding: 0 0 17px; font-size: 14px; line-height: 1.75; white-space: pre-line;
  word-break: keep-all; color: color-mix(in srgb, var(--paper) 70%, transparent); }

/* ── 스폰서 ── */
.lnd .nt-sponsors { display: flex; flex-direction: column; gap: 26px; }
.lnd .nt-sponsor-tier { margin-bottom: 12px; font-size: 11.5px; font-weight: 800; letter-spacing: .1em;
  text-transform: uppercase; color: color-mix(in srgb, var(--paper) 58%, transparent); }
.lnd .nt-sponsor-wall { display: flex; flex-wrap: wrap; gap: 12px; }
/* 로고는 어느 모드에서도 흰 판 위에 — 투명 PNG 가 대부분이라 다크에서 사라진다. */
.lnd .nt-sponsor { display: flex; align-items: center; justify-content: center; min-width: 132px;
  height: 68px; padding: 12px 18px; border-radius: 12px; background: #fff; text-decoration: none; }
.lnd .nt-sponsor img { max-height: 100%; max-width: 160px; object-fit: contain; }
.lnd .nt-sponsor-name { font-size: 13.5px; font-weight: 700; color: #101828; word-break: keep-all; }

@media (max-width: 1000px) {
  .lnd .nt-steps { grid-template-columns: 1fr 1fr; }
  .lnd .nt-stats { grid-template-columns: 1fr 1fr; }
  .lnd .nt-prizes { grid-template-columns: 1fr; }
  .lnd .nt-rounds { grid-template-columns: 1fr; }
  .lnd .nt-concept-grid { grid-template-columns: 1fr; gap: 26px; }
}

@media (max-width: 760px) {
  .lnd .nt-steps { grid-template-columns: 1fr; }
  .lnd .nt-stats { grid-template-columns: 1fr; }
  .lnd .nt-elig { grid-template-columns: 1fr; padding: 24px; }
  /* 한 열이 되면 "마지막 두 줄" 규칙이 어긋난다 — 마지막 하나만 지운다. */
  .lnd .nt-elig-item:nth-last-child(2) { border-bottom: 1px solid color-mix(in srgb, var(--paper) 12%, transparent); }
  .lnd .nt-elig-item:last-child { border-bottom: none; }
  .lnd .nt-crit-row { grid-template-columns: 1fr; gap: 7px; }
  .lnd .nt-crit-pts { text-align: left; }
  /* 날짜를 위로 빼고 점·내용을 아래 줄에 — 132px 열을 유지하면 본문이 두 글자씩 접힌다. */
  .lnd .nt-tl-row { grid-template-columns: 24px 1fr; gap: 0 14px; }
  .lnd .nt-tl-date { grid-column: 1 / -1; margin-bottom: 8px; padding-top: 0; }
  .lnd .hero-facts { gap: 18px; }
  .lnd .hero-fact dd { font-size: 18px; }
  /* 껍데기는 좁은 폭에서 CTA 를 바닥 가운데(bottom:36px, 폭 최대 320px)로 내리고
     .hero-inner 의 아래 여백을 150px 로 잡는다. 이 파일이 껍데기보다 **뒤에** 붙으므로
     여기서 다시 선언하지 않으면 위의 124px 이 그 값을 덮어 팩트 줄이 버튼 위로 내려앉는다. */
  .lnd .hero-inner { padding-bottom: 150px; }
  /* 좁은 화면에서는 모바일 초점으로 바꾼다 — 위 "배경 초점" 주석 참고. */
  .lnd .nt-bg img,
  .lnd .hero-media img { object-position: var(--mfx, 50%) var(--mfy, 50%); }
}
`;

export const NOTICE_CSS = `${NOTICE_SHELL_CSS}\n${SECTION_CSS}`;
