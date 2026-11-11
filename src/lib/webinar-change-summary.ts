// 웨비나 저장 전·후를 비교해 "무엇이 바뀌었나"를 사람이 읽는 문장으로 만든다.
//
// 편집 화면은 자동 저장할 때마다 섹션 전체(등록 폼·테마·랜딩 …)를 보내서, 서버가 받은 키만 보면
// 실제로 아무것도 안 바뀌어도 "웨비나 수정"이 쌓이고 무엇을 고쳤는지는 남지 않았다.
// 그래서 값을 정규화한 뒤 비교하고, 바뀐 것만 짧은 문장으로 남긴다. 바뀐 게 없으면 빈 배열이다.

import { formatKst } from "@/lib/datetime";
import {
  normalizeLandingPageConfig,
  normalizeLivePageConfig,
  normalizeRegistrationForm,
  type WebinarRegistrationField,
} from "@/lib/webinar-config";

export interface WebinarSnapshot {
  name?: string | null;
  description?: string | null;
  liveStartAt?: Date | string | null;
  liveEndAt?: Date | string | null;
  signupDeadline?: Date | string | null;
  statusOverride?: string | null;
  theme?: unknown;
  config?: unknown;
  components?: unknown;
}

/** 한 번 저장에 남기는 문장 수 상한 — 로그 한 줄이 화면을 덮지 않게. */
export const MAX_CHANGE_LINES = 12;
const MAX_LINE = 90;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clip = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const quote = (s: string) => `‘${clip(s.trim() || "(빈 값)")}’`;

const when = (v: Date | string | null | undefined) =>
  v ? formatKst(v, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "없음";

const STATUS: Record<string, string> = { registration: "사전등록", live: "라이브", ended: "종료" };
const RADIUS: Record<string, string> = { "0px": "각진", "8px": "약간", "16px": "기본", "24px": "둥근" };
const THEME_LABEL: Record<string, string> = {
  accentColor: "키 컬러",
  bgColor: "배경 컬러",
  surfaceColor: "서피스 컬러",
  textColor: "텍스트 컬러",
  font: "폰트",
  borderRadius: "테두리 둥글기",
};
const LANDING_LABEL: Record<string, string> = {
  enabled: "사용 여부",
  heroMedia: "히어로 이미지·영상",
  brand: "브랜드명",
  titleLines: "제목",
  subtitle: "부제목",
  venue: "장소 문구",
  ctaLabel: "버튼 문구",
  heroOverlayOpacity: "히어로 어둡기",
  heroTitleTracking: "제목 자간",
  colors: "배경색",
  sectionBg: "구간 배경",
  intro: "소개",
  sessions: "세션",
  timetable: "시간표",
  audience: "추천 대상",
  programs: "프로그램",
  highlights: "하이라이트",
  join: "참여 방법",
  faq: "FAQ",
  sponsors: "후원사",
};
const LIVE_LABEL: Record<string, string> = {
  waiting: "대기 화면",
  entry: "입장 확인 화면",
  ended: "종료 화면",
  resources: "자료",
  nextWebinar: "다음 웨비나 안내",
};
const FORM_TEXT_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: "개인정보 동의 문구", keys: ["privacyText", "privacyBody", "privacyBodyMode", "privacyLinkUrl", "privacyDefaultChecked"] },
  { label: "마케팅 동의 문구", keys: ["marketingText", "marketingBody", "marketingBodyMode", "marketingLinkUrl", "marketingDefaultChecked"] },
  { label: "제3자 제공 동의 문구", keys: ["thirdPartyText", "thirdPartyBody", "thirdPartyBodyMode", "thirdPartyLinkUrl", "thirdPartyDefaultChecked"] },
  { label: "완료 화면 버튼", keys: ["successCta"] },
  { label: "완료 후 이동 주소", keys: ["successRedirectUrl"] },
];

function changedKeys(a: Json, b: Json): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same(a[k], b[k]));
}

function summarizeFields(before: WebinarRegistrationField[], after: WebinarRegistrationField[]): string[] {
  const out: string[] = [];
  const prev = new Map(before.map((f) => [f.key, f]));
  const next = new Map(after.map((f) => [f.key, f]));
  for (const f of after) if (!prev.has(f.key)) out.push(`${quote(f.label)} 항목 추가`);
  for (const f of before) if (!next.has(f.key)) out.push(`${quote(f.label)} 항목 삭제`);
  for (const f of after) {
    const p = prev.get(f.key);
    if (!p) continue;
    if (p.label !== f.label) out.push(`항목 이름 ${quote(p.label)} → ${quote(f.label)}`);
    const name = quote(f.label);
    if (p.enabled !== f.enabled) out.push(`${name} ${f.enabled ? "표시" : "숨김"}`);
    if (p.required !== f.required) out.push(`${name} ${f.required ? "필수로" : "선택으로"} 변경`);
    if (p.type !== f.type) out.push(`${name} 유형 변경`);
    const po = new Set(p.options ?? []);
    const no = new Set(f.options ?? []);
    const added = [...no].filter((o) => !po.has(o)).length;
    const removed = [...po].filter((o) => !no.has(o)).length;
    if (added || removed) {
      out.push(`${name} 선택지 ${[added && `${added}개 추가`, removed && `${removed}개 삭제`].filter(Boolean).join(", ")}`);
    } else if (!same(p.options, f.options)) {
      out.push(`${name} 선택지 순서 변경`);
    }
    if (p.placeholder !== f.placeholder) out.push(`${name} 입력 예시 수정`);
    if (p.maxSelect !== f.maxSelect || p.allowOther !== f.allowOther) out.push(`${name} 선택 규칙 변경`);
  }
  const order = (list: WebinarRegistrationField[]) => list.filter((f) => prev.has(f.key) && next.has(f.key)).map((f) => f.key);
  if (!same(order(before), order(after))) out.push("항목 순서 변경");
  return out;
}

function summarizeRegistrationForm(beforeConfig: unknown, afterConfig: unknown): string[] {
  const a = normalizeRegistrationForm(beforeConfig, { includeDisabled: true });
  const b = normalizeRegistrationForm(afterConfig, { includeDisabled: true });
  const out = summarizeFields(a.fields, b.fields);
  const ar = a as unknown as Json;
  const br = b as unknown as Json;
  if (ar.thirdPartyEnabled !== br.thirdPartyEnabled) out.push(`제3자 제공 동의 ${br.thirdPartyEnabled ? "사용" : "사용 안 함"}`);
  if (ar.submitLabel !== br.submitLabel) out.push(`버튼 문구 ${quote(String(ar.submitLabel ?? ""))} → ${quote(String(br.submitLabel ?? ""))}`);
  for (const group of FORM_TEXT_GROUPS) {
    if (group.keys.some((k) => !same(ar[k], br[k]))) out.push(`${group.label} 수정`);
  }
  return out.map((line) => `등록 폼 · ${line}`);
}

function summarizeSection(prefix: string, labels: Record<string, string>, a: Json, b: Json): string[] {
  const keys = changedKeys(a, b);
  if (!keys.length) return [];
  const named = keys.map((k) => labels[k]).filter(Boolean);
  const unnamed = keys.length - named.length;
  const parts = [...named, ...(unnamed ? [`기타 ${unnamed}곳`] : [])];
  return [`${prefix} · ${parts.join(", ")} 수정`];
}

function summarizeConfig(beforeRaw: unknown, afterRaw: unknown): string[] {
  const a = obj(beforeRaw);
  const b = obj(afterRaw);
  const out: string[] = [];
  for (const key of changedKeys(a, b)) {
    if (key === "registrationForm") out.push(...summarizeRegistrationForm(a, b));
    else if (key === "landingPage") {
      out.push(...summarizeSection("랜딩 페이지", LANDING_LABEL,
        normalizeLandingPageConfig(a) as unknown as Json, normalizeLandingPageConfig(b) as unknown as Json));
    } else if (key === "livePage") {
      out.push(...summarizeSection("시청 화면", LIVE_LABEL,
        normalizeLivePageConfig(a) as unknown as Json, normalizeLivePageConfig(b) as unknown as Json));
    } else if (key === "youtubeId") out.push("유튜브 영상 변경");
    else if (key === "surveyUrl") out.push("설문 링크 변경");
    else out.push(`설정(${key}) 변경`);
  }
  return out;
}

function summarizeComponents(beforeRaw: unknown, afterRaw: unknown): string[] {
  const a = obj(beforeRaw);
  const b = obj(afterRaw);
  return changedKeys(a, b).map((key) => {
    const v = b[key];
    if (key === "chatEnabled") return `채팅 ${v === false ? "끄기" : "켜기"}`;
    if (key === "qaMode") return `질문 받기 ${v === "closed" ? "마감" : "열기"}`;
    if (key === "allowLiveRegistration") {
      return `라이브 중 등록 · ${v === true ? "계속 받기" : v === false ? "시작 시 마감" : "마감일까지"}`;
    }
    if (key === "banner") return "배너 변경";
    return `화면 구성(${key}) 변경`;
  });
}

export function summarizeWebinarChanges(before: WebinarSnapshot, after: WebinarSnapshot): string[] {
  const out: string[] = [];
  if ((before.name ?? "") !== (after.name ?? "")) out.push(`이름: ${quote(before.name ?? "")} → ${quote(after.name ?? "")}`);
  if ((before.description ?? "") !== (after.description ?? "")) out.push("설명 수정");
  const dates: Array<[keyof WebinarSnapshot, string]> = [
    ["liveStartAt", "시작 시각"],
    ["liveEndAt", "종료 시각"],
    ["signupDeadline", "등록 마감"],
  ];
  for (const [key, label] of dates) {
    const a = before[key] as Date | string | null | undefined;
    const b = after[key] as Date | string | null | undefined;
    if (when(a) !== when(b)) out.push(`${label}: ${when(a)} → ${when(b)}`);
  }
  if ((before.statusOverride ?? null) !== (after.statusOverride ?? null)) {
    const label = (v: string | null | undefined) => (v ? STATUS[v] ?? v : "자동");
    out.push(`방송 상태: ${label(before.statusOverride)} → ${label(after.statusOverride)}`);
  }
  const ta = obj(before.theme);
  const tb = obj(after.theme);
  for (const key of changedKeys(ta, tb)) {
    const label = THEME_LABEL[key] ?? `테마(${key})`;
    const show = (v: unknown) => (v == null || v === "" ? "기본값" : key === "borderRadius" ? RADIUS[String(v)] ?? String(v) : String(v));
    out.push(`${label}: ${show(ta[key])} → ${show(tb[key])}`);
  }
  out.push(...summarizeConfig(before.config, after.config));
  out.push(...summarizeComponents(before.components, after.components));
  return out.slice(0, MAX_CHANGE_LINES).map((line) => clip(line, MAX_LINE));
}

/**
 * 같은 사람이 짧은 시간에 연달아 저장한 변경을 한 줄로 합친다.
 * "키 컬러: A → B" 다음에 "키 컬러: B → C" 가 오면 "키 컬러: A → C" 로 — 중간값은 의미가 없다.
 */
export function mergeChangeLines(previous: string[], next: string[]): string[] {
  // "라벨: 이전 → 이후" 꼴만 합친다. 등록 폼·랜딩처럼 "구역 · 내용" 꼴은 같은 문장일 때만 하나로 둔다.
  const pair = /^([^:·]+): (.+) → (.+)$/;
  const out = [...previous];
  for (const line of next) {
    const m = pair.exec(line);
    if (!m) {
      if (!out.includes(line)) out.push(line);
      continue;
    }
    const idx = out.findIndex((l) => pair.exec(l)?.[1] === m[1]);
    if (idx === -1) {
      out.push(line);
      continue;
    }
    const from = pair.exec(out[idx])![2];
    out.splice(idx, 1);
    if (from !== m[3]) out.push(`${m[1]}: ${from} → ${m[3]}`);
  }
  return out.slice(-MAX_CHANGE_LINES);
}
