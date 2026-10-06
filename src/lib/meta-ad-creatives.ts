/**
 * Meta 광고 소재(썸네일·영상 여부) 조회.
 *
 * Insights API 는 소재 이미지 정보를 주지 않아 광고별로 배치 요청해 따로 가져온다(동기화 때).
 * 받은 thumbnail_url 은 fbcdn **서명 주소라 며칠 뒤 만료**된다(쿼리 `oe` = 만료 시각, 16진 유닉스초).
 * 동기화 뒤 시간이 지나면 403 이 나서 광고·소재 탭 미리보기가 깨진다 — 2026-10-06 실제 사례:
 * 저장된 썸네일 1,310개 중 896개 만료. 그래서 화면을 열 때 만료된 것만 골라 다시 받아 저장한다.
 */

export type CreativeInfo = { creativeId: string | null; creativeName: string | null; thumbnailUrl: string | null; creativeType: string | null };

/** fbcdn 서명 주소의 만료 시각(ms). 서명 주소가 아니면 null. */
export function metaCdnExpiresAt(url: string | null | undefined): number | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)(fbcdn\.net|cdninstagram\.com)$/.test(parsed.hostname)) return null;
    const oe = parsed.searchParams.get("oe");
    if (!oe || !/^[0-9a-f]{1,12}$/i.test(oe)) return null;
    return parseInt(oe, 16) * 1000;
  } catch {
    return null;
  }
}

/** 곧(기본 1시간 안) 만료되거나 이미 만료된 Meta 썸네일인가. 만료 정보가 없는 주소는 건드리지 않는다. */
export function isMetaThumbnailStale(url: string | null | undefined, now = Date.now(), marginMs = 60 * 60_000): boolean {
  const expiresAt = metaCdnExpiresAt(url);
  return expiresAt !== null && expiresAt - marginMs <= now;
}

export async function fetchAdCreatives(token: string, version: string, adIds: string[]) {
  const map = new Map<string, CreativeInfo>();
  for (let offset = 0; offset < adIds.length; offset += 50) {
    const chunk = adIds.slice(offset, offset + 50);
    const batchPayload = chunk.map(id => ({ method: "GET", relative_url: `${id}?fields=creative{id,name,thumbnail_url,video_id}` }));
    try {
      const response = await fetch(`https://graph.facebook.com/${version}/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: token, batch: JSON.stringify(batchPayload) }),
        cache: "no-store",
      });
      const results = await response.json().catch(() => null) as Array<{ code: number; body: string }> | null;
      if (!Array.isArray(results)) continue;
      results.forEach((result, i) => {
        const adId = chunk[i];
        if (!result || result.code !== 200) return;
        try {
          const parsed = JSON.parse(result.body) as { creative?: { id?: string; name?: string; thumbnail_url?: string; video_id?: string } };
          if (!parsed.creative) return;
          map.set(adId, {
            creativeId: parsed.creative.id ?? null,
            creativeName: parsed.creative.name ?? null,
            thumbnailUrl: parsed.creative.thumbnail_url ?? null,
            creativeType: parsed.creative.video_id ? "VIDEO" : "IMAGE",
          });
        } catch {
          // 개별 소재 파싱 실패는 건너뛰고 나머지는 계속 진행
        }
      });
    } catch {
      // 소재 조회 실패해도 호출한 쪽 작업은 계속 진행 — 썸네일 없이 남는다
    }
  }
  return map;
}
