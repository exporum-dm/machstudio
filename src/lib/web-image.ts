/**
 * 웹용 이미지 줄이기 — 미디어 자료실에 올리는 사진을 PC·모바일 화면에 충분한 크기로 줄인다(2026-10-28).
 *
 * 왜: 자료실 링크를 아임웹 페이지에 그대로 붙여 쓰는데, 원본 사진(15.6MB PNG 등)이 들어가 커피바 페이지
 * 하나가 열릴 때마다 36.5MB 를 내려받았다. Supabase 무료 플랜 cached egress(월 5GB)를 행사 주간에 넘겨
 * 로그인·파일 제공이 막혔다. 화면용이면 긴 변 2000px · JPEG 품질 82 로 충분하다(대부분 0.2~0.6MB).
 *
 * 규칙
 *  - JPEG·PNG·WebP 만. GIF(움직임)·SVG(벡터)·HEIC 등은 그대로 둔다.
 *  - 이미 작으면(긴 변 ≤ 2000px 이고 ≤ 500KB) 건드리지 않는다.
 *  - 투명한 부분이 있는 PNG 는 PNG 로(크기만 줄임), 나머지는 JPEG 로 — 메일(아웃룩)은 WebP 를 못 보여 준다.
 *  - 결과가 원본보다 크면 원본을 쓴다.
 */

export const WEB_IMAGE_MAX_EDGE = 2000;
export const WEB_IMAGE_QUALITY = 0.82;
/** 이 크기 이하이고 긴 변도 작으면 다시 인코딩하지 않는다. */
export const WEB_IMAGE_SKIP_BYTES = 500 * 1024;

const COMPRESSIBLE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export interface WebImagePlan {
  width: number;
  height: number;
  /** 크기를 줄이는지(false 면 같은 크기로 다시 인코딩만). 출력 형식은 그린 뒤 투명도로 정한다. */
  resize: boolean;
}

/** 줄일 필요가 있으면 목표 크기, 없으면 null. DOM 을 모른다 — 테스트용. */
export function planWebImage(input: { type: string; size: number; width: number; height: number }): WebImagePlan | null {
  if (!COMPRESSIBLE.has(input.type.toLowerCase())) return null;
  if (!input.width || !input.height) return null;
  const long = Math.max(input.width, input.height);
  if (long <= WEB_IMAGE_MAX_EDGE && input.size <= WEB_IMAGE_SKIP_BYTES) return null;
  const scale = long > WEB_IMAGE_MAX_EDGE ? WEB_IMAGE_MAX_EDGE / long : 1;
  return { width: Math.round(input.width * scale), height: Math.round(input.height * scale), resize: scale < 1 };
}

/** 확장자를 바꾼 파일 이름(사진.png → 사진.jpg). */
export function renameForType(name: string, type: string): string {
  const ext = type === "image/png" ? "png" : "jpg";
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "image"}.${ext}`;
}

/**
 * 브라우저에서 줄인다. 실패하거나 이득이 없으면 원본을 그대로 돌려준다(업로드를 막지 않는다).
 * compressed 가 true 면 새 File 이다.
 */
export async function compressForWeb(file: File): Promise<{ file: File; compressed: boolean; before: number; after: number }> {
  const keep = { file, compressed: false, before: file.size, after: file.size };
  if (typeof window === "undefined" || !COMPRESSIBLE.has(file.type.toLowerCase())) return keep;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const plan = planWebImage({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height });
    if (!plan) return keep;
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return keep;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);

    // 투명한 픽셀이 있는 PNG 만 PNG 로 남긴다 — 나머지는 JPEG 가 훨씬 작다.
    let outType = "image/jpeg";
    if (file.type === "image/png" || file.type === "image/webp") {
      const sample = ctx.getImageData(0, 0, plan.width, plan.height).data;
      for (let i = 3; i < sample.length; i += 4 * 16) {
        if (sample[i] < 250) { outType = "image/png"; break; }
      }
    }
    if (outType === "image/jpeg") {
      // JPEG 는 투명 칸을 검게 칠한다 — 흰 바탕을 먼저 깐다.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, plan.width, plan.height);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, WEB_IMAGE_QUALITY));
    if (!blob || blob.size >= file.size) return keep;
    const out = new File([blob], renameForType(file.name, outType), { type: outType, lastModified: Date.now() });
    return { file: out, compressed: true, before: file.size, after: out.size };
  } catch {
    return keep;
  } finally {
    bitmap?.close();
  }
}
