// 개발 로그 — 운영에 반영된 변경(main 에 병합된 PR)을 관리자 페이지에 보여준다.
//
// 활동 로그는 사람이 화면에서 한 일만 남기고, "어제 무엇이 배포됐나"는 GitHub 에만 있었다.
// main 에 병합되면 곧 운영에 배포되므로 병합된 PR 목록이 곧 배포 이력이다.
// 저장소가 공개라 토큰 없이 읽히고, GITHUB_TOKEN 이 있으면 호출 한도가 넉넉해진다.

export const DEV_LOG_REPO = process.env.GITHUB_REPO || "exporum-dm/machstudio";

export interface DevLogEntry {
  number: number;
  title: string;
  url: string;
  author: string | null;
  mergedAt: string;
  summary: string[];
}

/** 이 제목 아래부터는 요약에 넣지 않는다 — 검증·테스트 기록은 개발자용이다. */
const STOP_HEADING = /검증|테스트|test|verification|체크리스트|checklist/i;

/**
 * PR 본문에서 무엇이 바뀌었는지 몇 줄만 뽑는다.
 * 제목(#)과 자동 서명은 빼고, 목록 항목과 첫 문단을 마크다운 기호 없이 남긴다.
 */
export function summarizePrBody(body: string | null | undefined, max = 4): string[] {
  if (!body) return [];
  const out: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) {
      if (STOP_HEADING.test(line)) break;
      continue;
    }
    if (/^(🤖|---|```|<!--|Co-Authored-By)/i.test(line)) continue;
    const text = line
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*|__|`/g, "")
      .trim();
    if (!text) continue;
    out.push(text.length > 140 ? `${text.slice(0, 139)}…` : text);
    if (out.length >= max) break;
  }
  return out;
}

interface GitHubPull {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  body: string | null;
  user: { login: string } | null;
  base: { ref: string };
}

/** 최근 병합된 PR. 실패하면 error 에 사유를 담아 돌려준다(관리자 화면이 안내 문구를 띄운다). */
export async function fetchDevLog(limit = 40): Promise<{ entries: DevLogEntry[]; error: string | null }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "machstudio-admin",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${DEV_LOG_REPO}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100`,
      // 10분 캐시 — 관리자 페이지를 열 때마다 GitHub 를 부르면 무인증 한도(시간당 60회)에 걸린다.
      { headers, next: { revalidate: 600 } },
    );
    if (!res.ok) {
      return { entries: [], error: res.status === 403 || res.status === 429 ? "GitHub 호출 한도에 걸렸어요. 잠시 뒤 다시 열어 주세요." : `GitHub 응답 오류(${res.status})` };
    }
    const pulls = (await res.json()) as GitHubPull[];
    const entries = pulls
      .filter((p) => p.merged_at)
      .sort((a, b) => (a.merged_at! < b.merged_at! ? 1 : -1))
      .slice(0, limit)
      .map((p) => ({
        number: p.number,
        title: p.title,
        url: p.html_url,
        author: p.user?.login ?? null,
        mergedAt: p.merged_at!,
        summary: summarizePrBody(p.body),
      }));
    return { entries, error: null };
  } catch {
    return { entries: [], error: "GitHub 에 연결하지 못했어요." };
  }
}
