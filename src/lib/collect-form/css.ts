/**
 * 등록 폼 스타일 — 파트너 사이트(아임웹 등) 문서에 **그대로 주입된다**.
 *
 * 그래서 두 가지가 절대 규칙이다:
 *  1. 모든 선택자가 `.msf` 아래에 있다. 전역 태그 선택자(`input {}`)를 하나라도 쓰면
 *     호스트 페이지의 다른 폼까지 우리 스타일이 먹는다 — 남의 사이트를 망가뜨린다.
 *  2. 호스트에서 물려받는 것을 전부 되돌린다. 아임웹 테마가 `input { border-radius: 0 }`
 *     같은 걸 걸어 두면 우리 폼만 각지게 나온다. 상속되는 속성은 `.msf` 에서 다시 못 박는다.
 *
 * 색은 `.msf` 의 커스텀 프로퍼티로만 쓴다 — 전시별 테마(§11 이후)가 붙을 때 이 변수만
 * 덮으면 되게 한다. 리터럴 색을 규칙 안에 박으면 그때 전부 다시 찾아야 한다.
 *
 * ── !important 를 쓰는 곳과 이유 ──────────────────────────────────────
 * 클래스 선택자는 호스트의 태그 선택자(`input {}`)를 이미 이긴다. 문제는 **호스트가
 * `!important` 를 거는 경우**다 — 아임웹 테마의 `input,button { border-radius:0 !important }`
 * 같은 규칙은 특이도와 무관하게 우리를 누른다(임베드 하니스에서 실측: 모서리가 각져 나왔다).
 * 그래서 **폼이 폼으로 보이는 데 필요한 최소한의 속성에만** 맞불을 놓는다. 전부 !important 로
 * 도배하면 정작 우리가 나중에 테마를 얹을 때 우리 자신이 못 덮는다.
 */
export const COLLECT_FORM_CSS = `
.msf .msf-type-tabs{display:flex;gap:6px;padding:5px;border-radius:var(--msf-radius);background:var(--msf-soft);box-shadow:0 1px 5px color-mix(in srgb,var(--msf-fg) 8%,transparent)}
.msf .msf-type-tab{all:unset;box-sizing:border-box;flex:1;text-align:center;padding:14px 10px;border-radius:calc(var(--msf-radius) - 3px);font:inherit;font-weight:650;cursor:pointer;color:var(--msf-muted);transition:background .15s,color .15s,box-shadow .15s}
.msf .msf-type-tab[aria-selected="true"]{background:var(--msf-accent);color:var(--msf-accent-fg);box-shadow:0 2px 5px color-mix(in srgb,var(--msf-fg) 12%,transparent)}
.msf .msf-type-tab:hover{box-shadow:0 2px 8px color-mix(in srgb,var(--msf-fg) 16%,transparent)}
.msf .msf-type-tab:disabled{cursor:wait;opacity:.7}
.msf .msf-type-tab:focus-visible{outline:2px solid var(--msf-accent);outline-offset:3px}
@media(prefers-reduced-motion:reduce){.msf .msf-type-tab{transition:none}}

.msf{
  --msf-fg:#101418; --msf-muted:#5b6672; --msf-line:#dfe3e8;
  --msf-bg:#ffffff; --msf-soft:#f4f6f8;
  --msf-accent:#1f3a5f; --msf-accent-fg:#ffffff;
  --msf-warn:#b45309; --msf-ok:#047857;
  --msf-radius:12px;
  /* 호스트 상속 차단 — 상속되는 속성만 모아 다시 못 박는다 */
  all:initial;
  display:block; box-sizing:border-box;
  /* 홈페이지 Shadow 안에서는 --msx-font(Pretendard 별칭)를 물려받고,
     단독 /f 에서는 그 변수가 없어 **지금까지의 스택 그대로**다. */
  font-family:var(--msx-font,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Apple SD Gothic Neo","Malgun Gothic",sans-serif);
  font-size:15px; line-height:1.5; color:var(--msf-fg);
  text-align:left; letter-spacing:normal; word-break:break-word;
  /* 520px 은 호스트가 좁은 칸(사이드바 등)에 넣을 때 기준이었는데, 폼을 페이지 본문
     한가운데 통으로 박는 사이트(대개 데스크톱)에서는 그 폭이 그대로 화면보다 훨씬 좁아
     "혼자만 작은 모바일 위젯"으로 보인다. 실제 좁은 호스트에서는 부모 폭이 이미 520px
     보다 작으므로 이 값을 키워도 그런 배치에는 영향이 없다. */
  max-width:640px; margin:0 auto;
}
.msf *,.msf *::before,.msf *::after{box-sizing:border-box}
/* 리셋은 :where() 로 특이도를 0으로 낮춰서 건다.
   ".msf span"(0,1,1)은 ".msf-tel-cc"(0,1,0)보다 특이도가 높아 순서와 무관하게 컴포넌트 규칙을
   이긴다 — 실측으로 국가코드 칸의 padding 이 0 이 돼 "US" 가 눌려 나왔다.
   :where() 안의 선택자는 특이도에 0을 기여하므로 아래 컴포넌트 규칙이 정상적으로 이긴다. */
.msf :where(p,div,label,span,h2,h3,ul,li){margin:0;padding:0;font-weight:inherit;font-size:inherit;list-style:none}

.msf-stack{display:flex;flex-direction:column;gap:14px;line-height:1.5 !important}

/* ── 행사 개요 ─────────────────────────────── */
/* 라벨(기간·장소·운영시간) + 값 두 칸짜리 표 — 아임웹에 따로 만들던 개요 표를 이 안에서
   그대로 대신한다. 라벨 칸은 키컬러로 눈에 띄게, 값 칸은 본문색으로 차분하게 — 참가작
   카드의 no·accent 배지와 같은 위계다. */
.msf-info{border:1px solid var(--msf-line);border-radius:var(--msf-radius);overflow:hidden}
.msf-info-row{display:grid;grid-template-columns:100px 1fr;gap:4px 14px;padding:11px 14px;font-size:13px;border-top:1px solid var(--msf-line)}
.msf-info-row:first-child{border-top:0}
.msf-info-label{font-weight:700;color:var(--msf-accent)}
.msf-info-value{color:var(--msf-fg)}
.msf-info-value div+div{margin-top:2px}
@media (max-width:400px){.msf-info-row{grid-template-columns:1fr}}

/* ── 항목 ──────────────────────────────────── */
.msf-field{display:flex;flex-direction:column;gap:6px}
.msf-label{font-size:13px;font-weight:600;display:block !important;color:var(--msf-fg) !important;line-height:1.5 !important;text-transform:none !important}
.msf-req{color:var(--msf-warn);margin-left:2px}
.msf-input,.msf-select{
  width:100%;font:inherit;font-size:15px;color:var(--msf-fg);
  background:var(--msf-bg);
  outline:none;appearance:none;-webkit-appearance:none;
  transition:border-color .15s ease, box-shadow .15s ease;
  /* 호스트 !important 와 맞붙는 최소 집합 */
  border:1px solid var(--msf-line) !important;
  border-radius:var(--msf-radius) !important;
  padding:11px 12px !important;
  text-transform:none !important;
  letter-spacing:normal !important;
}
.msf-select{background-image:none;padding-right:12px}
.msf-input:focus,.msf-select:focus{border-color:var(--msf-accent);box-shadow:0 0 0 3px rgba(31,58,95,.14)}
/* 호스트 테마가 outline:none 을 전역으로 거는 일이 잦다 — 키보드 사용자가 위치를 잃는다. */
.msf :where(input,select,button,a):focus-visible{outline:2px solid var(--msf-accent) !important;outline-offset:2px !important}
.msf-input[aria-invalid="true"],.msf-select[aria-invalid="true"]{border-color:var(--msf-warn)}
.msf-input::placeholder{color:#9aa4af;opacity:1}

/* 전화 — 국가코드 칸 + 번호 칸 */
.msf-tel{display:flex;gap:8px;align-items:stretch}
/* 국가 선택 — 폭을 묶는다. 245개국 이름 중 제일 긴 것에 맞추면 번호칸이 사라진다.
   text-overflow 는 select 에 안 먹으므로 폭 자체를 제한하고, 열린 목록은 원래 넓게 그려진다. */
.msf-tel-cc{flex:0 0 auto;max-width:44%;padding:0 8px;font-size:14px;font-weight:600;
  background:var(--msf-soft);border:1px solid var(--msf-line);border-radius:var(--msf-radius);
  color:var(--msf-fg);white-space:nowrap;cursor:pointer;
  /* 44px 터치 타깃 — 현장에서 휴대폰으로 채우는 폼이다 */
  min-height:44px;appearance:auto}
.msf-tel-cc:focus-visible{outline:2px solid var(--msf-accent);outline-offset:1px}
.msf-tel .msf-input{flex:1 1 auto;min-width:0}

/* 선택지 — 칩 */
.msf-chips{display:flex;flex-wrap:wrap;gap:8px}
.msf-chip{
  display:inline-flex;align-items:center;font-size:14px;cursor:pointer;
  background:var(--msf-bg);
  transition:background .15s ease,border-color .15s ease,color .15s ease;
  /* 44px 터치 타깃 — 현장에서 휴대폰으로 채우는 폼이다 */
  min-height:44px;
  padding:9px 14px !important;
  border-radius:999px !important;
  border:1px solid var(--msf-line) !important;
  text-transform:none !important;
  letter-spacing:normal !important;
}
.msf-chip:hover{border-color:var(--msf-accent)}
.msf-chip[data-on="1"]{background:var(--msf-accent);border-color:var(--msf-accent);color:var(--msf-accent-fg)}
.msf-chip[data-disabled="1"]{opacity:.45;cursor:not-allowed}
/* 체크박스를 화면에서만 숨긴다 — display:none 이면 **탭 순서에서도 빠져** 키보드로 못 고른다.
   칩 자체에 포커스 표시를 옮겨 준다(:has 미지원 브라우저를 위해 .is-focus 도 함께 건다). */
.msf-chip input{position:absolute;width:1px;height:1px;opacity:0;margin:0}
.msf-chip:has(input:focus-visible),.msf-chip.is-focus{outline:2px solid var(--msf-accent);outline-offset:2px}

/* 한 번에 펼쳐 보고 고르는 단일 선택. 손가락 터치를 위해 모든 항목을 44px 이상으로 두고,
   선택 상태는 색과 안쪽 점을 같이 써서 색상만으로 구분하지 않는다. */
.msf-radio-group{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.msf-radio-option{
  display:flex !important;align-items:center;gap:10px;min-width:0;min-height:48px;
  padding:10px 12px !important;border:1px solid var(--msf-line) !important;border-radius:var(--msf-radius) !important;
  background:var(--msf-bg);color:var(--msf-fg);font-size:14px;line-height:1.35;cursor:pointer;
  transition:border-color .15s ease,background .15s ease,box-shadow .15s ease;
}
.msf-radio-option:hover{border-color:var(--msf-accent) !important}
.msf-radio-option[data-on="1"]{border-color:var(--msf-accent) !important;background:color-mix(in srgb,var(--msf-accent) 8%,var(--msf-bg));box-shadow:0 2px 8px rgba(0,0,0,.06)}
.msf-radio-option input{position:absolute;width:1px;height:1px;opacity:0;margin:0}
.msf-radio-mark{display:grid !important;place-items:center;flex:0 0 18px;width:18px;height:18px;border:2px solid var(--msf-line);border-radius:999px;background:var(--msf-bg)}
.msf-radio-option[data-on="1"] .msf-radio-mark{border:5px solid var(--msf-accent)}
.msf-radio-option:has(input:focus-visible),.msf-radio-option.is-focus{outline:2px solid var(--msf-accent);outline-offset:2px}
@media (max-width:440px){.msf-radio-group{grid-template-columns:1fr}}

/* 체크박스 한 줄 */
.msf-check{
  display:flex !important;align-items:center !important;gap:10px !important;
  min-height:24px;font-size:13px;line-height:1.45;cursor:pointer
}
.msf-check input{
  display:block !important;width:18px !important;height:18px !important;min-width:18px !important;
  margin:0 !important;padding:0 !important;flex:0 0 18px !important;
  accent-color:var(--msf-accent);cursor:pointer
}
.msf-check span{display:block !important;min-width:0;line-height:1.45 !important}

/* 동의 항목 한 줄 — 체크박스 라벨(가변 폭)과 "Details" 버튼(고정 폭)을 한 줄에 둔다.
   Details 가 라벨 아래 혼자 떨어져 있으면 그 항목과 상관없는 것처럼 보인다. */
.msf-consent-row{display:flex !important;align-items:center !important;gap:12px !important}
.msf-consent-row .msf-check{flex:1;min-width:0}
.msf-consent-row .msf-more{flex:0 0 auto;margin:0 !important}

/* ── 안내 블록 ─────────────────────────────── */
.msf-notice{background:var(--msf-soft);border-radius:var(--msf-radius);padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.msf-notice-title{font-size:13px;font-weight:700}
.msf-notice-body{font-size:12px;line-height:1.65;color:var(--msf-muted);white-space:pre-wrap}
.msf-more{align-self:flex-start;font:inherit;font-size:12px;font-weight:600;color:var(--msf-accent);
  background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}

/* ── 오류·안내 ─────────────────────────────── */
.msf-err{font-size:12px;color:var(--msf-warn)}
.msf-hint{font-size:11px;color:var(--msf-muted)}
.msf-banner{font-size:13px;border-radius:var(--msf-radius);padding:11px 13px}
.msf-banner[data-tone="warn"]{background:#fff7ed;color:var(--msf-warn)}
.msf-banner[data-tone="ok"]{background:#ecfdf5;color:var(--msf-ok)}

/* ── 제출 ──────────────────────────────────── */
.msf-submit{
  width:100%;font:inherit;font-size:15px;font-weight:700;cursor:pointer;
  min-height:52px;transition:opacity .15s ease,transform .06s ease;
  /* 제출 버튼은 이 폼에서 가장 중요한 컨트롤이다 — 호스트 테마에 색을 뺏기면 안 된다 */
  color:var(--msf-accent-fg) !important;
  background:var(--msf-accent) !important;
  border:0 !important;
  border-radius:var(--msf-radius) !important;
  padding:14px 16px !important;
  text-transform:none !important;
  letter-spacing:normal !important;
}
.msf-submit:hover{opacity:.92}
.msf-submit:active{transform:translateY(1px)}
.msf-submit[disabled]{opacity:.5;cursor:not-allowed;transform:none}

/* ── 상태 화면(접수 전·마감) / 완료 ──────────── */
.msf-state{text-align:center;background:var(--msf-soft);border-radius:var(--msf-radius);padding:28px 20px}
.msf-state-title{font-size:16px;font-weight:700}
.msf-state-body{font-size:13px;color:var(--msf-muted);margin-top:6px}

.msf-done{
  display:flex !important;flex-direction:column !important;align-items:center !important;
  width:100% !important;text-align:center;background:var(--msf-soft);border-radius:var(--msf-radius);padding:26px 20px
}
.msf-done-title{font-size:17px;font-weight:700}
/**
 * 등록번호는 **현장에서 눈으로 읽고 손으로 친다**(설계 §9.1·§12).
 * 넓은 자간과 **자릿수가 고르게 서는 숫자**라야 불러 주고 받아 적기 좋다.
 *
 * 홈페이지 안에서는 --msx-font(Pretendard)를 물려받고 tabular-nums 로 자릿수를 세운다.
 * 단독 /f 에서는 그 변수가 없어 **지금까지의 등폭 글꼴 그대로**다 — 9/1 오픈을 앞둔
 * 화면의 생김새를 바꾸지 않는다.
 */
.msf-regno{
  margin-top:12px;
  font-family:var(--msx-font,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  font-variant-numeric:tabular-nums;
  font-size:19px;font-weight:700;letter-spacing:.14em;
}
.msf-regno-label{font-size:11px;color:var(--msf-muted);margin-top:4px;letter-spacing:normal}

/* QR 을 등록 데스크에서 보여 달라는 안내 — QR 카드 바로 아래, accent 로 눈에 띄게. */
.msf-callout{
  width:100%;margin-top:14px;padding:12px 14px;border-radius:var(--msf-radius);text-align:left;
  border-left:3px solid var(--msf-accent);
  background:color-mix(in srgb, var(--msf-accent) 12%, var(--msf-bg));
}
.msf-callout-title{font-size:13px;font-weight:800;color:var(--msf-accent)}
.msf-callout-body{margin-top:2px;font-size:12px;color:var(--msf-muted);line-height:1.5}

/* ── QR ────────────────────────────────────── */
/**
 * **강제 라이트.** 페이지 나머지가 테마를 따라도 QR 카드만은 흰 배경·검은 모듈로 못 박는다.
 * AGENTS.md "색 하드코딩 금지" 의 의도적 예외다 — 이 흰색은 디자인 토큰이 아니라
 * **스캔 가능성 요건**이라(설계 §9.2) 테마를 따라가면 안 된다. 다크 UI 위에서 대비가
 * 사라진 QR 은 현장에서 줄을 만든다.
 *
 * 패딩 20px 은 collect-qr.ts 의 QR_WHITE_PAD_PX 다. 이미지 안의 여백(4모듈, 200px 표시에서
 * 약 27.6px) 위에 흰색을 한 겹 더 까는 것으로, 다크 배경이라 그 27.6px 이 흰색의 전부일 때나
 * 호스트가 카드를 줄여 놓았을 때도 3mm 밑으로 떨어지지 않게 한다.
 * 폭 240px = 이미지 200px + 좌우 패딩 20px(border-box).
 */
.msf-qr{
  display:block !important;width:240px !important;min-width:240px !important;
  margin:14px auto 0 !important;
  color-scheme:only light !important;
  background:#ffffff !important;padding:20px !important;border-radius:16px !important;
}
/**
 * **이미지가 200px 이어야 한다**(§9.2 화면 최소치). box-sizing:border-box 라 카드 폭은
 * 언제나 200 + 패딩×2 여야 한다 — 예전에 카드에 200px 을 줬더니 패딩이 그 안을 먹어
 * 실제 QR 이 180px 로 그려졌다(실측). 패딩을 고칠 땐 폭도 같이 고칠 것.
 */
/* 호스트의 img{max-width:100%} 는 경쟁 선언이 없으면 그대로 먹는다 — 좁은 칸(사이드바
   위젯)에서 폭만 줄고 높이는 200px 로 남아 QR 이 찌그러진다. filter 를 거는 테마도 있다
   (스캔 대비가 무너진다). 스캔 요건이라 !important 로 못 박는다. */
.msf-qr img{
  display:block;image-rendering:pixelated;
  color-scheme:only light !important;
  width:200px !important;height:200px !important;
  max-width:none !important;min-width:200px !important;
  filter:none !important;opacity:1 !important;
}

/* ── 등록 확인(Find My QR) ──────────────────── */
.msf-lookup{display:flex;flex-direction:column;gap:14px}
.msf-found{
  display:flex !important;flex-direction:column !important;align-items:center !important;
  width:100% !important;text-align:center;background:var(--msf-soft);border-radius:var(--msf-radius);padding:22px 20px
}
.msf-found-name{font-size:18px;font-weight:800}
.msf-found-type{font-size:12px;color:var(--msf-muted);margin-top:2px}

/* 참관객 유형 배지 — 유형마다 입장 동선이 다르다. 이름보다 먼저 눈에 들어와야 한다.
   키컬러를 그대로 칠하지 않고 옅게 깐다: QR 카드가 주인공이라 배지가 그걸 이기면 안 된다. */
.msf-badge{
  display:inline-flex !important;align-items:center;justify-content:center;min-width:112px;
  margin:0 0 10px !important;padding:8px 18px !important;border-radius:999px;
  font-size:14px;font-weight:900;line-height:1;letter-spacing:.1em;text-transform:uppercase;
  color:var(--msf-badge-fg,var(--msf-accent-fg)) !important;
  background:var(--msf-badge-bg,var(--msf-accent)) !important;
  -webkit-text-fill-color:var(--msf-badge-fg,var(--msf-accent-fg)) !important;
  box-shadow:0 4px 12px color-mix(in srgb, var(--msf-badge-bg,var(--msf-accent)) 24%, transparent);
}

/* 본인 확인 줄 — 가려진 연락처(collect-lookup 의 maskEmail/maskPhone).
   inline-grid인 이유: 열을 auto 1fr로 두면 라벨-값이 카드 폭 끝까지 벌어진다(dd가
   text-align:right로 오른쪽 끝에 붙어서). auto auto로 두 열 다 내용 크기에 맞추고
   inline-grid로 두면, 부모 .msf-found의 text-align:center가 이 블록 자체를 카드
   가운데로 보내면서 라벨·값은 서로 가깝게 붙는다. */
.msf-idcheck{
  display:grid !important;grid-template-columns:auto minmax(0,1fr);gap:6px 16px;
  width:min(100%,360px) !important;min-width:0 !important;
  margin:14px auto 0 !important;padding:12px 14px !important;border-radius:var(--msf-radius);
  background:var(--msf-bg);text-align:left;font-size:13px;
}
.msf-idcheck dt{display:block !important;color:var(--msf-muted)}
.msf-idcheck dd{display:block !important;min-width:0;margin:0 !important;text-align:right;font-weight:700;word-break:break-all}

/* QR 저장 — 캡처가 안 되는 기기(일부 사내폰·키오스크)가 있어 파일로도 준다. */
.msf-save{
  display:block;width:100%;margin-top:16px;padding:14px 18px;border:0;border-radius:var(--msf-radius);
  background:var(--msf-accent) !important;color:var(--msf-accent-fg) !important;
  -webkit-text-fill-color:var(--msf-accent-fg) !important;
  font:inherit;font-weight:800;cursor:pointer;
  text-align:center;text-decoration:none !important;
}
.msf-save:hover{filter:brightness(1.08)}
.msf-save-hint{margin-top:8px;font-size:11px;color:var(--msf-muted)}
.msf .msf-invite { margin-top:18px; padding:16px; border-radius:14px; background:color-mix(in srgb, var(--msf-accent) 7%, transparent); text-align:center; }
.msf .msf-invite-title { font-size:15px; font-weight:700; }
.msf .msf-invite-body { margin-top:4px; font-size:13px; line-height:1.55; opacity:.8; }
.msf .msf-invite-actions { margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
.msf .msf-invite-btn { min-height:44px; padding:0 18px; border-radius:999px; border:1px solid color-mix(in srgb, currentColor 22%, transparent); background:transparent; color:inherit; font:inherit; font-size:14px; font-weight:600; cursor:pointer; }
.msf .msf-invite-primary { border-color:transparent; background:var(--msf-accent); color:var(--msf-accent-fg); }
.msf .msf-invite-status { margin-top:6px; min-height:1em; font-size:12px; opacity:.75; }

/* 다시 찾기 — 일행 것을 이어서 찾는 경우가 많다(가족·팀 단위 등록). */
.msf-again{
  display:block;width:100%;margin-top:10px;padding:12px 18px;border-radius:var(--msf-radius);
  border:0;box-shadow:inset 0 0 0 1px var(--msf-accent);
  background:transparent;color:var(--msf-accent);font:inherit;font-weight:700;cursor:pointer;
}
.msf-again:hover{background:color-mix(in srgb, var(--msf-accent) 8%, transparent)}

/* ── 미리보기 배너 ─────────────────────────── */
/* 없으면 담당자가 미리보기에서 등록하고 "왜 명단에 없냐"고 묻는다(설계 §16.1). */
.msf-preview-flag{
  display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;
  background:#eef2f7;color:var(--msf-accent);border-radius:999px;padding:8px 14px;align-self:flex-start;
}

/* iOS 는 16px 미만 입력에 포커스하면 화면을 확대하고, 그 확대는 **파트너 페이지 전체**에
   걸린다(그리고 되돌아오지 않는다). 브레이크포인트로 나누면 최신 대화면 아이폰(430px)이
   조건 밖으로 빠지므로 입력은 항상 16px 로 둔다. */
.msf-input,.msf-select{font-size:16px}

@media (prefers-reduced-motion:reduce){
  .msf *{transition:none !important;animation:none !important}
}

/* QR 카드가 240px 이라, 완료·조회 카드의 좌우 패딩(20px)까지 얹으면 아주 좁은 호스트 칸에서
   넘칠 수 있다. 흰 여백은 스캔 요건이라 그쪽을 줄이지 않고 **카드 바깥 패딩이 자리를 내준다**.
   두 규칙(.msf-done/.msf-found)보다 뒤에 와야 특이도가 같아도 이긴다 — 그래서 여기다. */
@media (max-width:359px){
  .msf-done,.msf-found{padding-left:10px;padding-right:10px}
}

/* ── 동의 전문 팝업 ────────────────────────── */
/* document.body 에 새 루트로 붙는다(대회 폼 mc-overlay 와 같은 패턴, mount.ts openTermsPopup
   주석 참고) — .msf 리셋을 다시 받아야 해서 클래스에 msf 를 같이 건다. 뒤에 오는 규칙이라
   특이도가 같아도 .msf 의 display:block/max-width:640px 를 순서로 이긴다. */
.msf-overlay{
  position:fixed;inset:0;z-index:2147483000;max-width:none;margin:0;
  display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(0,0,0,.55);
}
.msf-terms{
  width:100%;max-width:480px;max-height:calc(100dvh - 32px);
  display:flex;flex-direction:column;overflow:hidden;
  background:var(--msf-bg);border-radius:var(--msf-radius);
  box-shadow:0 24px 64px rgba(0,0,0,.32);
}
.msf-terms-head{font-size:15px;font-weight:700;padding:16px 18px;border-bottom:1px solid var(--msf-line)}
.msf-terms-body{padding:18px;overflow-y:auto;font-size:13px;line-height:1.7;color:var(--msf-muted);white-space:pre-wrap}
.msf-terms-body :where(p,div,blockquote,pre,ul,ol,table){margin:0 0 12px;padding:0}
.msf-terms-body :where(h2,h3,h4){margin:16px 0 8px;color:var(--msf-fg);font-weight:700;line-height:1.4}
.msf-terms-body h2{font-size:16px}.msf-terms-body h3{font-size:15px}.msf-terms-body h4{font-size:14px}
.msf-terms-body :where(ul,ol){padding-left:20px}.msf-terms-body ul{list-style:disc}.msf-terms-body ol{list-style:decimal}
.msf-terms-body li{margin:3px 0;list-style:inherit}.msf-terms-body a{color:var(--msf-accent);text-decoration:underline;text-underline-offset:2px}
.msf-terms-body blockquote{padding-left:12px;border-left:3px solid var(--msf-line)}
.msf-terms-body table{width:100%;border-collapse:collapse;font-size:12px}.msf-terms-body :where(th,td){padding:8px;border:1px solid var(--msf-line);text-align:left;vertical-align:top}
.msf-terms-body th{color:var(--msf-fg);background:var(--msf-soft);font-weight:700}
.msf-terms-body pre{overflow-x:auto;padding:10px;background:var(--msf-soft);border-radius:8px;white-space:pre-wrap}
.msf-terms-actions{display:flex;gap:8px;padding:14px 18px;border-top:1px solid var(--msf-line)}
.msf-terms-actions button{
  flex:1;font:inherit;font-size:14px;font-weight:700;cursor:pointer;
  padding:11px !important;border-radius:calc(var(--msf-radius) - 2px) !important;border:0 !important;
}
.msf-terms-close{background:var(--msf-soft) !important;color:var(--msf-fg) !important}
.msf-terms-agree{background:var(--msf-accent) !important;color:var(--msf-accent-fg) !important}
`;

/** 문서든 ShadowRoot 든 **한 벌만** 넣는다. */
export const COLLECT_FORM_STYLE_ID = "msf-css";

/**
 * 스타일을 그 루트에 설치한다.
 *
 * 단독 `/f` 는 문서 head 에 넣는다(지금까지와 같다). 홈페이지 섹션은 **그 ShadowRoot 안**에
 * 넣는다 — 문서 head 에 넣으면 Shadow 안까지 닿지 않아 폼이 스타일 없이 그려지고,
 * 동시에 파트너 사이트의 전역 스타일을 우리가 늘리는 셈이 된다.
 */
export function ensureFormStyles(root?: Document | ShadowRoot): void {
  const target = root ?? (typeof document !== "undefined" ? document : null);
  if (!target) return;

  if (target.nodeType === 9) {
    const doc = target as Document;
    if (doc.getElementById(COLLECT_FORM_STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = COLLECT_FORM_STYLE_ID;
    style.textContent = COLLECT_FORM_CSS;
    doc.head.appendChild(style);
    return;
  }

  const shadow = target as ShadowRoot;
  if (shadow.querySelector("#" + COLLECT_FORM_STYLE_ID)) return;
  const style = shadow.ownerDocument.createElement("style");
  style.id = COLLECT_FORM_STYLE_ID;
  style.textContent = COLLECT_FORM_CSS;
  shadow.appendChild(style);
}
