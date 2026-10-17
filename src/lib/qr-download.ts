/**
 * 화면에 그린 QR(SVG)을 파일로 받는다 — SVG 그대로, 또는 PNG.
 *
 * PNG 는 인쇄물·카톡·PPT 에 바로 넣을 때 쓴다(SVG 를 못 여는 곳이 많다). 화면 크기(80~120px)로
 * 뽑으면 인쇄에서 뭉개지므로 **1024px + 흰 여백**으로 다시 그린다. QR 은 여백(quiet zone)이
 * 없으면 인식률이 떨어진다.
 */

const PNG_SIZE = 1024;
const MARGIN = 64;

function serialize(svg: SVGElement): string {
  const clone = svg.cloneNode(true) as SVGElement;
  // 이미지로 읽으려면 네임스페이스가 있어야 한다 — 없으면 <img> 가 그리지 못한다.
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(clone);
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** SVG 마크업 → 흰 여백을 둔 1024px 캔버스. */
export async function renderQrCanvas(markup: string): Promise<HTMLCanvasElement | null> {
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("QR 이미지를 그리지 못했어요"));
      img.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = PNG_SIZE + MARGIN * 2;
    canvas.height = PNG_SIZE + MARGIN * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 픽셀이 번지지 않게 — QR 칸 경계가 흐려지면 인식률이 떨어진다.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, MARGIN, MARGIN, PNG_SIZE, PNG_SIZE);
    return canvas;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export function serializeQrSvg(svg: SVGElement): string {
  return serialize(svg);
}

export async function downloadQr(svg: Element | null, baseName: string, format: "svg" | "png"): Promise<boolean> {
  if (!(svg instanceof SVGElement)) return false;
  const markup = serialize(svg);
  if (format === "svg") {
    save(new Blob([markup], { type: "image/svg+xml" }), `${baseName}.svg`);
    return true;
  }
  const canvas = await renderQrCanvas(markup);
  if (!canvas) return false;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return false;
  save(blob, `${baseName}.png`);
  return true;
}
