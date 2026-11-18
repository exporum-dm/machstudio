/**
 * 등록 폼·등록 확인 화면에서 **시스템이 만들어 넣는 문구**의 언어별 사전.
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────
 * 운영자가 쓴 글(라벨·안내·동의문)은 번역 표에서 언어별로 채운다. 그런데 화면에는 운영자가
 * 손댈 수 없는 문구가 40개 넘게 있다 — "Register", "Required", "Check the email format",
 * "You're registered", "Save as Image". 그 문구가 영어로 고정돼 있으면 라벨을 다 번역해도
 * **국문 페이지에 반쯤 영어인 폼**이 뜨고, 운영자는 고칠 자리를 찾을 수 없다.
 * 대회 공고가 같은 이유로 같은 사전을 이미 갖고 있다(`lib/notice/strings.ts` 머리말 —
 * "LA 대회를 영어로 다 써 놓았는데 두 섹션만 한글로 남았다").
 *
 * ── 왜 두 화면이 한 사전을 쓰나 ───────────────────────────────────────
 * 등록 폼과 등록 확인은 같은 페이지에 나란히 붙는 것이 기본 구성이다(§17). 사전이 두 벌이면
 * 같은 말이 다르게 나간다 — 한쪽은 "이미지로 저장", 다른 쪽은 "이미지 저장" 처럼.
 *
 * ── 왜 네 언어인가 ────────────────────────────────────────────────────
 * ko·en·ja·zh 는 실제로 쓰는 언어다. 나머지(es·vi)는 **영어로 떨어진다** — 번역 품질을
 * 책임질 수 없는 문구를 기계로 지어내면, 그 화면을 보는 사람에게는 영어보다 나쁘다.
 * 운영자가 적는 글은 그 언어로 나가므로, 떨어지는 것은 시스템 문구뿐이다.
 *
 * React·DOM 에 의존하지 않는다 — 임베드 번들에 그대로 들어간다.
 */

export interface CollectFormCopy {
  // ── 접수 창 ──
  beforeTitle: string;
  beforeBody: string;
  closedTitle: string;
  closedBody: string;
  // ── 폼 ──
  submit: string;
  submitting: string;
  empty: string;
  // ── 검증 ──
  required: string;
  invalidEmail: string;
  invalidPhone: string;
  invalidNumber: string;
  unknownKey: string;
  tooManySelected: string;
  notAnOption: string;
  consentRequired: string;
  duplicate: string;
  networkError: string;
  closedNow: string;
  notOpenYet: string;
  // ── 완료 ──
  doneTitle: string;
  checkinTitle: string;
  checkinBodyWithEmail: string;
  doneRegNoLabel: string;
  previewFlag: string;
  ticketLink: string;
  saveImage: string;
  saveHint: string;
  saveFailed: string;
  previewDone: string;
  // ── 공통 ──
  more: string;
  less: string;
  close: string;
  agree: string;
  period: string;
  venue: string;
  openingHours: string;
  // ── 등록 확인(Find My QR) ──
  lookupTitle: string;
  lookupDesc: string;
  lookupError: string;
  email: string;
  phone: string;
  lookupSubmit: string;
  searching: string;
  notFound: string;
  needSomething: string;
  searchAgain: string;
  tooManyAttempts: string;
  ticketRegNoLabel: string;
  noQr: string;
  needBoth: string;
  needEmail: string;
  needPhone: string;
}

const EN: CollectFormCopy = {
  beforeTitle: "Registration hasn't opened yet",
  beforeBody: "The form will appear here once registration opens.",
  closedTitle: "Registration is closed",
  closedBody: "On-site registration is available at the venue.",
  submit: "Register",
  submitting: "Submitting…",
  empty: "This form has no fields yet.",
  required: "Required",
  invalidEmail: "Check the email format",
  invalidPhone: "This number isn't valid for the selected country",
  invalidNumber: "Numbers only",
  unknownKey: "Not part of this form",
  tooManySelected: "Too many selected",
  notAnOption: "Not one of the options",
  consentRequired: "Please agree to continue",
  duplicate: "This email is already registered.",
  networkError: "Couldn't submit. Please try again.",
  closedNow: "Registration just closed.",
  notOpenYet: "Registration hasn't opened yet.",
  doneTitle: "You're registered",
  checkinTitle: "Show this QR code at the check-in desk",
  checkinBodyWithEmail: "You can also find the same QR code in your confirmation email.",
  doneRegNoLabel: "Registration number — show this at the venue",
  previewFlag: "Preview — nothing is saved",
  ticketLink: "Open my ticket page →",
  saveImage: "Save as Image",
  saveHint: "* If the button doesn't work, please take a screenshot.",
  saveFailed: "We couldn't save the ticket image. Please take a screenshot instead.",
  previewDone: "Sample number — nothing was saved.",
  more: "Details",
  less: "Hide",
  close: "Close",
  agree: "I agree",
  period: "Period",
  venue: "Venue",
  openingHours: "Opening Hours",
  lookupTitle: "Find my QR",
  lookupDesc: "Enter what you registered with.",
  lookupError: "Something went wrong. Please try again.",
  email: "Email",
  phone: "Phone",
  lookupSubmit: "Find my registration",
  searching: "Searching…",
  /** 못 찾았을 때는 **이 문구 하나로만** 끝낸다(§10.2) — 이유를 나누면 열거 힌트가 된다. */
  notFound: "We couldn't find a registration with that information.",
  needSomething: "Enter your email or phone number first.",
  searchAgain: "Search Again",
  tooManyAttempts: "Too many attempts. Please try again in a few minutes.",
  ticketRegNoLabel: "Show this at the venue",
  noQr: "Your registration was found. We'll email your ticket again.",
  needBoth: "Enter both your email and phone number.",
  needEmail: "Your email is missing.",
  needPhone: "Your phone number is missing.",
};

const KO: CollectFormCopy = {
  beforeTitle: "아직 접수 전이에요",
  beforeBody: "접수가 시작되면 이 자리에 신청 폼이 나타나요.",
  closedTitle: "접수가 마감됐어요",
  closedBody: "현장에서 접수하실 수 있어요.",
  submit: "등록하기",
  submitting: "등록 중…",
  empty: "아직 입력 항목이 없어요.",
  required: "필수 항목이에요",
  invalidEmail: "이메일 형식을 확인해 주세요",
  invalidPhone: "선택한 국가에서 쓸 수 없는 번호예요",
  invalidNumber: "숫자만 입력해 주세요",
  unknownKey: "이 폼에 없는 항목이에요",
  tooManySelected: "너무 많이 고르셨어요",
  notAnOption: "선택지에 없는 값이에요",
  consentRequired: "동의해 주셔야 진행할 수 있어요",
  duplicate: "이미 등록된 이메일이에요.",
  networkError: "등록하지 못했어요. 잠시 후 다시 시도해 주세요.",
  closedNow: "방금 접수가 마감됐어요.",
  notOpenYet: "아직 접수 전이에요.",
  doneTitle: "등록이 완료됐어요",
  checkinTitle: "입장할 때 이 QR 코드를 보여 주세요",
  checkinBodyWithEmail: "같은 QR 코드는 확인 메일에서도 다시 볼 수 있어요.",
  doneRegNoLabel: "등록번호 — 현장에서 보여 주세요",
  previewFlag: "미리보기 — 저장되지 않아요",
  ticketLink: "내 티켓 페이지 열기 →",
  saveImage: "이미지로 저장",
  saveHint: "* 버튼이 동작하지 않으면 화면을 캡처해 주세요.",
  saveFailed: "이미지를 저장하지 못했어요. 화면을 캡처해 주세요.",
  previewDone: "예시 번호예요 — 저장되지 않았어요.",
  more: "자세히",
  less: "접기",
  close: "닫기",
  agree: "동의합니다",
  period: "기간",
  venue: "장소",
  openingHours: "운영 시간",
  lookupTitle: "내 QR 찾기",
  lookupDesc: "등록할 때 입력한 정보를 넣어 주세요.",
  lookupError: "문제가 발생했어요. 다시 시도해 주세요.",
  email: "이메일",
  phone: "연락처",
  lookupSubmit: "내 등록 찾기",
  searching: "찾는 중…",
  notFound: "입력하신 정보로 등록 내역을 찾지 못했어요.",
  needSomething: "이메일이나 연락처를 먼저 입력해 주세요.",
  searchAgain: "다시 찾기",
  tooManyAttempts: "시도가 너무 많아요. 잠시 후 다시 시도해 주세요.",
  ticketRegNoLabel: "현장에서 이 번호를 보여 주세요",
  noQr: "등록 내역을 찾았어요. 티켓을 메일로 다시 보내 드려요.",
  needBoth: "이메일과 연락처를 모두 입력해 주세요.",
  needEmail: "이메일이 비어 있어요.",
  needPhone: "연락처가 비어 있어요.",
};

const JA: CollectFormCopy = {
  beforeTitle: "受付開始前です",
  beforeBody: "受付が始まると、ここに申込フォームが表示されます。",
  closedTitle: "受付を終了しました",
  closedBody: "会場での当日受付が可能です。",
  submit: "申し込む",
  submitting: "送信中…",
  empty: "入力項目がまだありません。",
  required: "必須項目です",
  invalidEmail: "メールアドレスの形式をご確認ください",
  invalidPhone: "選択した国では使えない番号です",
  invalidNumber: "数字のみ入力してください",
  unknownKey: "このフォームにない項目です",
  tooManySelected: "選択数が多すぎます",
  notAnOption: "選択肢にない値です",
  consentRequired: "同意が必要です",
  duplicate: "このメールアドレスはすでに登録されています。",
  networkError: "送信できませんでした。しばらくしてからもう一度お試しください。",
  closedNow: "ただいま受付を終了しました。",
  notOpenYet: "まだ受付開始前です。",
  doneTitle: "お申し込みが完了しました",
  checkinTitle: "入場時にこのQRコードをご提示ください",
  checkinBodyWithEmail: "同じQRコードは確認メールからも確認できます。",
  doneRegNoLabel: "受付番号 — 会場でご提示ください",
  previewFlag: "プレビュー — 保存されません",
  ticketLink: "チケットページを開く →",
  saveImage: "画像として保存",
  saveHint: "* ボタンが動作しない場合は画面を撮影してください。",
  saveFailed: "画像を保存できませんでした。画面を撮影してください。",
  previewDone: "サンプル番号です — 保存されていません。",
  more: "詳細",
  less: "閉じる",
  close: "閉じる",
  agree: "同意します",
  period: "期間",
  venue: "会場",
  openingHours: "開催時間",
  lookupTitle: "QRコードを探す",
  lookupDesc: "お申し込み時に入力した情報をご入力ください。",
  lookupError: "問題が発生しました。もう一度お試しください。",
  email: "メールアドレス",
  phone: "電話番号",
  lookupSubmit: "申し込みを探す",
  searching: "検索中…",
  notFound: "ご入力の情報では申し込みが見つかりませんでした。",
  needSomething: "メールアドレスか電話番号をご入力ください。",
  searchAgain: "もう一度探す",
  tooManyAttempts: "試行回数が多すぎます。しばらくしてからお試しください。",
  ticketRegNoLabel: "会場でこの番号をご提示ください",
  noQr: "申し込みが見つかりました。チケットをメールで再送します。",
  needBoth: "メールアドレスと電話番号の両方をご入力ください。",
  needEmail: "メールアドレスが未入力です。",
  needPhone: "電話番号が未入力です。",
};

const ZH: CollectFormCopy = {
  beforeTitle: "报名尚未开始",
  beforeBody: "报名开始后，此处将显示报名表单。",
  closedTitle: "报名已结束",
  closedBody: "可在现场办理报名。",
  submit: "立即报名",
  submitting: "提交中…",
  empty: "尚未设置填写项目。",
  required: "必填项",
  invalidEmail: "请检查邮箱格式",
  invalidPhone: "该号码不适用于所选国家/地区",
  invalidNumber: "仅可输入数字",
  unknownKey: "此表单中没有该项目",
  tooManySelected: "选择数量过多",
  notAnOption: "不在选项范围内",
  consentRequired: "请先同意后继续",
  duplicate: "该邮箱已报名。",
  networkError: "提交失败，请稍后重试。",
  closedNow: "报名刚刚结束。",
  notOpenYet: "报名尚未开始。",
  doneTitle: "报名完成",
  checkinTitle: "入场时请出示此二维码",
  checkinBodyWithEmail: "确认邮件中也可查看同一个二维码。",
  doneRegNoLabel: "报名编号 — 请在现场出示",
  previewFlag: "预览 — 不会保存",
  ticketLink: "打开我的票券页面 →",
  saveImage: "保存为图片",
  saveHint: "* 若按钮无效，请截屏保存。",
  saveFailed: "无法保存图片，请截屏保存。",
  previewDone: "示例编号 — 并未保存。",
  more: "详情",
  less: "收起",
  close: "关闭",
  agree: "我同意",
  period: "期间",
  venue: "地点",
  openingHours: "开放时间",
  lookupTitle: "查找我的二维码",
  lookupDesc: "请输入报名时填写的信息。",
  lookupError: "出错了，请重试。",
  email: "邮箱",
  phone: "电话",
  lookupSubmit: "查找我的报名",
  searching: "查找中…",
  notFound: "未找到与所填信息匹配的报名记录。",
  needSomething: "请先输入邮箱或电话。",
  searchAgain: "重新查找",
  tooManyAttempts: "尝试次数过多，请稍后再试。",
  ticketRegNoLabel: "请在现场出示此编号",
  noQr: "已找到报名记录，我们会再次将票券发送至您的邮箱。",
  needBoth: "请同时输入邮箱和电话。",
  needEmail: "邮箱未填写。",
  needPhone: "电话未填写。",
};

const BY_LOCALE: Record<string, CollectFormCopy> = { en: EN, ko: KO, ja: JA, zh: ZH };

/**
 * 이 언어의 시스템 문구. 사전이 없는 언어는 **영어로 떨어진다**(머리말 참고 — 기계 번역을
 * 지어내지 않는다). 운영자가 적은 글은 그 언어로 나가므로, 떨어지는 것은 이 문구들뿐이다.
 */
export function collectFormCopy(locale: string | undefined): CollectFormCopy {
  if (!locale) return EN;
  // "en-US" 처럼 지역이 붙어 와도 받는다 — 로케일 키는 뷰어가 정하는 값이다.
  const base = locale.toLowerCase().split("-")[0];
  return BY_LOCALE[base] ?? EN;
}

/** 시스템 문구 사전이 있는 언어들 — 테스트가 네 사전의 키를 맞춰 보는 데 쓴다. */
export const COLLECT_COPY_LOCALES = Object.keys(BY_LOCALE);
