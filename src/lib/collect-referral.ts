// 등록 폼 친구 초대(추천) — 누가 링크를 퍼뜨렸고, 그 링크로 몇 명이 등록했나.
//
// 웨비나 추천(webinar-share.ts)과 같은 원칙을 따른다.
//  - 링크에는 **의미 없는 무작위 코드**만 싣는다(`?ref=K7mQ2xPa3d`). 이름·연락처를 링크에 넣으면
//    링크를 받은 모든 사람에게 그대로 보인다.
//  - 사람이 알아보는 이름표("이*환 · 1198")는 순위판에서만, 서버가 만들어 내려보낸다.
//  - 세는 기준은 "링크를 누른 수"가 아니라 **실제로 등록을 마친 사람 수**다.
// 서버(제출·순위)와 클라이언트(완료 화면)가 같이 쓰는 순수 로직이라 서버 전용 의존성을 두지 않는다.

import { generateShareCode, normalizeShareCode, SHARE_QUERY_KEY } from "@/lib/webinar-share";
import { maskName } from "@/lib/mask";
import type { Localized } from "@/lib/collect-form-config";

export { generateShareCode as generateReferralCode, normalizeShareCode as normalizeReferralCode };
export const REFERRAL_QUERY_KEY = SHARE_QUERY_KEY;

/** 혜택 기준 — 폼마다 운영자가 고른다. */
export type ReferralRewardMode = "none" | "topN" | "topPercent" | "minCount";

export interface CollectReferralConfig {
  enabled: boolean;
  rewardMode: ReferralRewardMode;
  /** topN: 상위 몇 명 · topPercent: 상위 몇 % · minCount: 몇 명 이상 추천 */
  rewardValue: number;
  /** 순위판 위에 보이는 혜택 안내(예: "상위 10명에게 기념품을 드려요") */
  rewardNote: Localized;
}

export const EMPTY_REFERRAL: CollectReferralConfig = { enabled: false, rewardMode: "none", rewardValue: 0, rewardNote: {} };

const REWARD_MODES: readonly ReferralRewardMode[] = ["none", "topN", "topPercent", "minCount"];

export function normalizeReferral(raw: unknown, toLocalized: (v: unknown) => Localized): CollectReferralConfig {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mode = REWARD_MODES.includes(r.rewardMode as ReferralRewardMode) ? (r.rewardMode as ReferralRewardMode) : "none";
  const value = Number(r.rewardValue);
  const max = mode === "topPercent" ? 100 : 100_000;
  return {
    enabled: r.enabled === true,
    rewardMode: mode,
    rewardValue: mode === "none" || !Number.isFinite(value) ? 0 : Math.min(max, Math.max(1, Math.floor(value))),
    rewardNote: toLocalized(r.rewardNote),
  };
}

/** 순위판에 보이는 이름 — 한글은 가운데를 가리고(이*환), 영문은 이름 첫 글자 + 성(C. Lee). */
export function referralDisplayName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return "익명";
  if (/^[A-Za-zÀ-ÿ' .-]+$/.test(trimmed) && trimmed.includes(" ")) {
    const parts = trimmed.split(" ");
    return `${parts[0][0].toUpperCase()}. ${parts.slice(1).join(" ")}`;
  }
  return maskName(trimmed);
}

/** 연락처 뒤 4자리. 없거나 너무 짧으면 빈 문자열. */
export function phoneLast4(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-4) : "";
}

export function referralLabel(name: string, phone: string | null | undefined): string {
  const last4 = phoneLast4(phone);
  return last4 ? `${referralDisplayName(name)} · ${last4}` : referralDisplayName(name);
}

/** 이름 비교용 — 공백·대소문자·쉼표 무시. */
export const normalizePersonName = (name: string) => name.normalize("NFC").replace(/[\s,.·]+/g, "").toLowerCase();

/**
 * 같은 사람의 이름인가 — 띄어쓰기·대소문자·쉼표, **성과 이름의 순서**와 상관없이.
 * "Changhwan Lee" = "Lee Changhwan" = "lee, changhwan" = "changhwanlee", "이 창환" = "이창환".
 * 단어로 나눈 뒤 순서를 무시하고 맞춰 보고, 한쪽이 붙여 쓴 경우는 붙인 글자끼리 본다.
 */
export function samePersonName(a: string, b: string): boolean {
  const tokens = (v: string) => v.normalize("NFC").toLowerCase().split(/[\s,.·]+/).filter(Boolean);
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const forms = (t: string[]) => [t.join(""), [...t].reverse().join(""), [...t].sort().join("")];
  const other = new Set(forms(tb));
  return forms(ta).some((v) => other.has(v));
}

export interface RankedReferrer {
  recordId: string;
  rank: number;
  count: number;
  label: string;
  rewarded: boolean;
}

/**
 * 추천 인원으로 순위를 매긴다 — 같은 인원은 같은 순위(1, 2, 2, 4).
 * 같은 인원 안에서는 먼저 그 인원에 도달한 사람이 위에 온다(lastReferredAt 이 이른 쪽).
 */
export function rankReferrers(
  rows: Array<{ recordId: string; count: number; label: string; lastReferredAt: number }>,
  config: Pick<CollectReferralConfig, "rewardMode" | "rewardValue">,
): RankedReferrer[] {
  const sorted = rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count || a.lastReferredAt - b.lastReferredAt);
  const total = sorted.length;
  let rank = 0;
  let prevCount = -1;
  return sorted.map((row, index) => {
    if (row.count !== prevCount) rank = index + 1;
    prevCount = row.count;
    return { recordId: row.recordId, rank, count: row.count, label: row.label, rewarded: isRewarded(rank, row.count, total, config) };
  });
}

export function isRewarded(
  rank: number,
  count: number,
  total: number,
  config: Pick<CollectReferralConfig, "rewardMode" | "rewardValue">,
): boolean {
  if (count <= 0 || config.rewardValue <= 0) return false;
  switch (config.rewardMode) {
    case "topN": return rank <= config.rewardValue;
    case "topPercent": return rank <= Math.max(1, Math.ceil((total * config.rewardValue) / 100));
    case "minCount": return count >= config.rewardValue;
    default: return false;
  }
}

export function rewardRuleLabel(config: Pick<CollectReferralConfig, "rewardMode" | "rewardValue">): string {
  switch (config.rewardMode) {
    case "topN": return `상위 ${config.rewardValue}명`;
    case "topPercent": return `상위 ${config.rewardValue}%`;
    case "minCount": return `${config.rewardValue}명 이상 추천`;
    default: return "";
  }
}

/**
 * 친구에게 보낼 링크 — 지금 보고 있는 등록 페이지 주소에 추천 코드를 붙인다.
 * 보낸 사람의 utm_* 는 지운다. 남겨 두면 친구의 등록이 보낸 사람이 들어온 광고 캠페인 성과로 잡힌다.
 * 대신 utm_source=referral · utm_medium=invite 로 표시해 유입 분석에서도 "친구 초대" 하나로 묶인다.
 */
export function buildInviteUrl(pageUrl: string, code: string): string {
  try {
    const url = new URL(pageUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || key === REFERRAL_QUERY_KEY) url.searchParams.delete(key);
    }
    url.searchParams.set(REFERRAL_QUERY_KEY, code);
    url.searchParams.set("utm_source", "referral");
    url.searchParams.set("utm_medium", "invite");
    url.hash = "";
    return url.toString();
  } catch {
    return pageUrl;
  }
}

/** 공개 순위판 주소. */
export const referralBoardPath = (sourceId: string) => `/rank/${encodeURIComponent(sourceId)}`;
