import { platforms } from "./model";

type Platform = (typeof platforms)[number];

/**
 * 신청서 답변에서 SNS 계정을 찾아낸다.
 *
 * 폼마다 칸 이름이 제각각이다 — `instagram_id`, `틱톡 주소`, `sns`, `채널 링크`. 그래서 칸 이름과
 * 라벨을 함께 보고 플랫폼을 짚는다. 예전에는 `social`·`handle`·`instagram` 세 이름만 찾아서
 * "26크리에이터 모집"의 `instagram_id` 를 놓쳤고, 계정이 비면 추적 링크가 아예 발급되지 않았다.
 *
 * 한 사람이 인스타와 틱톡을 함께 하면 **계정마다 링크가 따로 발급된다** — 그래야 utm_medium 이
 * 채널별로 갈린다. 그래서 반환값은 하나가 아니라 플랫폼별 묶음이다.
 */
const PLATFORM_WORDS: Record<Platform, string[]> = {
  instagram: ["instagram", "insta", "인스타", "ig"],
  tiktok: ["tiktok", "tik tok", "틱톡", "tictok", "tiktoc"],
  youtube: ["youtube", "유튜브", "yt", "youtu.be"],
  facebook: ["facebook", "페이스북", "페북", "fb"],
  x: ["twitter", "트위터", "엑스"],
  blog: ["blog", "블로그", "브런치", "brunch", "tistory", "티스토리"],
  other: [],
};

/** 계정이 아니라 규모를 묻는 칸 — `instagram_followor`(팔로워 수)가 계정으로 잡히면 안 된다. */
const COUNT_WORDS = ["팔로워", "follower", "구독자", "subscriber", "조회", "view", "방문자", "좋아요", "like"];

const norm = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, " ").trim();

function platformFromText(text: string): Platform | null {
  const haystack = norm(text);
  for (const platform of platforms) {
    if (platform === "other") continue;
    if (PLATFORM_WORDS[platform].some((word) => haystack.includes(word))) return platform;
  }
  // "x" 는 한 글자라 부분일치로 찾으면 오탐이 난다(`box`, `max`) — 낱말로 떨어질 때만.
  if (/(^| )x( |$)/.test(haystack)) return "x";
  return null;
}

function platformFromHost(hostname: string): Platform | null {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  if (host.endsWith("youtu.be")) return "youtube";
  if (host.endsWith("twitter.com") || host === "x.com" || host.endsWith(".x.com")) return "x";
  for (const platform of platforms) {
    if (platform === "other" || platform === "blog") continue;
    if (host === platform + ".com" || host.endsWith("." + platform + ".com")) return platform;
  }
  if (/blog|tistory|brunch|velog|medium/.test(host)) return "blog";
  return null;
}

/** 주소를 붙여넣었으면 계정만 떼어내고, 손으로 적었으면 @ 와 공백을 턴다. */
export function parseAccount(raw: string): { platform: Platform | null; handle: string } {
  const value = raw.trim();
  if (!value) return { platform: null, handle: "" };
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value);
    if (!url.hostname.includes(".")) throw new Error("not a url");
    const platform = platformFromHost(url.hostname);
    const segments = url.pathname.split("/").filter(Boolean);
    // youtube.com/@handle, youtube.com/channel/UC…, instagram.com/handle
    const segment = segments.find((part) => !["channel", "c", "user", "p", "reel", "video"].includes(part.toLowerCase())) ?? "";
    const handle = decodeURIComponent(segment).replace(/^@/, "");
    // 호스트만 있는 주소(블로그 도메인 등)는 호스트를 계정으로 쓴다.
    return { platform, handle: handle || url.hostname.replace(/^www\./, "") };
  } catch {
    const handle = value.replace(/^@/, "").trim();
    // 계정에는 공백이 없다 — "운영 안 함", "없습니다" 같은 답을 계정으로 삼지 않는다.
    if (!handle || /\s/.test(handle)) return { platform: null, handle: "" };
    return { platform: null, handle };
  }
}

/**
 * 신청서 답변 전체에서 플랫폼별 계정을 뽑는다. 먼저 찾은 값이 이긴다(폼 위쪽 칸 우선).
 * `labels` 는 칸 키 → 사람이 읽는 라벨(`instagram_id` → "인스타그램 계정").
 */
export function detectSocialAccounts(
  answers: Record<string, unknown>,
  labels: Record<string, string> = {},
): Partial<Record<Platform, string>> {
  const found: Partial<Record<Platform, string>> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (key.startsWith("__")) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (!text) continue;

    const context = key + " " + (labels[key] ?? "");
    if (COUNT_WORDS.some((word) => norm(context).includes(word))) continue;
    // 숫자만 있는 답은 계정이 아니라 수치다(팔로워 11950).
    if (/^[\d,.\s]+$/.test(text)) continue;

    const { platform: fromValue, handle } = parseAccount(text);
    if (!handle) continue;
    const platform = fromValue ?? platformFromText(context);
    // 어느 플랫폼인지 못 짚겠으면 넘긴다 — 이름·지원동기까지 계정으로 잡지 않기 위해서다.
    if (!platform) continue;
    if (!found[platform]) found[platform] = handle.slice(0, 160);
  }
  return found;
}
