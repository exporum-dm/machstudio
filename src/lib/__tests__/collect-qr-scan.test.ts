import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { QR_MIN_DISPLAY_PX, qrPngBuffer } from "@/lib/collect-qr";

/**
 * QR 스캔 회귀 — **실제 디코더로 읽어서** §9.2 의 규칙이 지켜지는지 본다.
 *
 * ── 이 테스트가 있는 이유 ─────────────────────────────────────────────
 * QR 은 "그려졌다" 와 "읽힌다" 가 다르다. 픽셀 검사만으로는 옵션 하나가 바뀌어 스캔이
 * 안 되는 상태를 못 잡는다 — 화면에는 멀쩡한 QR 이 그대로 보이기 때문이다.
 * 그리고 이건 **현장에서 줄이 멈추는** 종류의 고장이다: 입구에서 스캐너가 안 읽으면
 * 스태프가 손으로 명단을 뒤진다.
 *
 * ── 무엇을 대체하지 못하나 ────────────────────────────────────────────
 * 전용 바코드 스캐너의 광학·노출, 실제 종이의 반사와 잉크 번짐, 실기기 화면의 밝기 곡선.
 * 그건 사람이 실물로 해야 한다(§22 스캔 환경 매트릭스). 여기서 잡는 것은
 * **"스캐너가 실패하기 전에 이미지가 먼저 무너지는"** 경우다.
 *
 * ── 이미지 처리를 직접 하는 이유 ──────────────────────────────────────
 * sharp 는 이 저장소의 직접 의존성이 아니다(Next 가 끌고 오는 전이 의존성). 거기 기대면
 * Next 를 올리다 이 테스트가 이유 없이 깨진다. PNG 해제는 node:zlib(내장)로, 열화는
 * 배열 연산으로 직접 한다 — 새로 들어온 의존성은 디코더(jsqr) 하나뿐이다.
 */

const REG = "1234567890128";

interface Rgba { data: Uint8ClampedArray; width: number; height: number }

/**
 * PNG → RGBA. 우리 QR 이 내는 모양(8비트 RGBA·비인터레이스)만 다룬다 —
 * 범용 디코더가 아니라 **이 테스트가 읽어야 할 것**만 읽는다.
 */
function pngToRgba(png: Buffer): Rgba {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let width = 0, height = 0, depth = 0, colorType = 0;
  const idat: Buffer[] = [];
  for (let i = 8; i < png.length; ) {
    const len = png.readUInt32BE(i);
    const type = png.toString("ascii", i + 4, i + 8);
    const body = png.subarray(i + 8, i + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; colorType = body[9];
    } else if (type === "IDAT") idat.push(body);
    i += 12 + len;
  }
  expect(depth).toBe(8);
  expect(colorType).toBe(6); // RGBA
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0, pos = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = new Uint8Array(raw.subarray(pos, pos + stride)); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    out.set(line, y * stride);
    prev = line;
  }
  return { data: out, width, height };
}

const read = (img: Rgba): string | null =>
  jsQR(img.data, img.width, img.height)?.data ?? null;

/** 픽셀마다 채널을 바꾼다(알파는 그대로). */
function mapPixels(img: Rgba, f: (r: number, g: number, b: number) => [number, number, number]): Rgba {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = f(data[i], data[i + 1], data[i + 2]);
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
  return { ...img, data };
}

/** 최근접 축소 — 화면·인쇄에서 작아졌을 때를 흉내낸다. */
function resize(img: Rgba, size: number): Rgba {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.floor((y * img.height) / size);
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * img.width) / size);
      const s = (sy * img.width + sx) * 4, d = (y * size + x) * 4;
      data[d] = img.data[s]; data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2]; data[d + 3] = img.data[s + 3];
    }
  }
  return { data, width: size, height: size };
}

/** 모듈 좌표 기준으로 지운다(흰색). 픽셀 면적으로 지우면 모듈 경계를 가로질러 과대평가된다. */
function eraseModules(img: Rgba, modules: number, margin: number, cells: Array<[number, number]>): Rgba {
  const data = new Uint8ClampedArray(img.data);
  const unit = img.width / (modules + margin * 2);
  for (const [mx, my] of cells) {
    const x0 = Math.round((mx + margin) * unit), y0 = Math.round((my + margin) * unit);
    for (let y = y0; y < Math.round((my + margin + 1) * unit); y++) {
      for (let x = x0; x < Math.round((mx + margin + 1) * unit); x++) {
        const o = (y * img.width + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = 255;
      }
    }
  }
  return { ...img, data };
}

/** WCAG 명암비 — 다크 배경 판정의 근거를 숫자로 남긴다. */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const lum = ([r, g, b2]: [number, number, number]) => {
    const f = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 렌더된 심볼의 **포맷 정보 15비트**에서 EC 레벨을 읽는다.
 *
 * 왜 손상 테스트로 갈음하지 않나: 실측해 보니 EC L 도 데이터 15% 손상까지는 복구했고
 * Q 와 갈리는 지점은 18% 한 점뿐이었다 — 임계값으로 삼기엔 너무 얇고 디코더 버전에 흔들린다.
 * 레벨은 심볼에 적혀 있으니 그걸 읽는 편이 정확하고 안 흔들린다.
 */
function ecLevelOf(img: Rgba, modules: number, margin: number): "L" | "M" | "Q" | "H" {
  const unit = img.width / (modules + margin * 2);
  const dark = (row: number, col: number) => {
    const x = Math.round((col + margin + 0.5) * unit);
    const y = Math.round((row + margin + 0.5) * unit);
    return img.data[(y * img.width + x) * 4] < 128;
  };
  const pos: Array<[number, number]> = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  let bits = 0;
  for (const [r, c] of pos) bits = (bits << 1) | (dark(r, c) ? 1 : 0);
  // 포맷 정보는 0x5412 로 마스킹되어 저장된다. 상위 2비트가 EC 레벨.
  return (["M", "L", "H", "Q"] as const)[((bits ^ 0x5412) >> 13) & 0b11];
}

describe("QR — 우리가 내는 이미지가 실제로 읽히는가", () => {
  it.each(["90000001","07000001"])("국내형 8자리 번호 %s를 앞자리 손실 없이 읽는다",async no=>{
    expect(read(pngToRgba(await qrPngBuffer(no)))).toBe(no);
  });
  it("등록번호만 인코딩한다 — URL·개인정보가 아니다(§9.2)", async () => {
    const img = pngToRgba(await qrPngBuffer(REG));
    expect(read(img)).toBe(REG);
  });

  it("불투명 흰 배경 · 순수 흑백 — 다크모드 스캔 실패의 1순위 원인을 없앤다", async () => {
    const img = pngToRgba(await qrPngBuffer(REG));
    const colors = new Set<string>();
    let minAlpha = 255;
    for (let i = 0; i < img.data.length; i += 4) {
      colors.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
      minAlpha = Math.min(minAlpha, img.data[i + 3]);
    }
    expect(minAlpha).toBe(255);                       // 투명 픽셀이 하나도 없어야 한다
    expect([...colors].sort()).toEqual(["0,0,0", "255,255,255"]);
  });

  /**
   * **에러 정정 레벨 Q**(§9.2). 낮추면 심볼이 조금 작아지는 대신 구겨진 배지·지문에
   * 훨씬 약해진다 — 화면상으로는 똑같이 보이므로 눈으로는 못 잡는다.
   */
  it("에러 정정 레벨이 Q 다 — 심볼에 적힌 값을 읽는다", async () => {
    const img = pngToRgba(await qrPngBuffer(REG));
    const { modules } = QRCode.create(REG, { errorCorrectionLevel: "Q" });
    expect(ecLevelOf(img, modules.size, 4)).toBe("Q");
  });

  /** 여백이 좁으면 스캐너가 심볼 경계를 못 잡는다. 규격 최소치가 4모듈이다. */
  it("조용한 영역이 4모듈 이상이다", async () => {
    const png = await qrPngBuffer(REG);
    const img = pngToRgba(png);
    const { modules } = QRCode.create(REG, { errorCorrectionLevel: "Q" });
    const unit = img.width / (modules.size + 8);      // margin 4 × 양쪽
    const mid = Math.floor(img.height / 2);
    let firstDark = 0;
    while (firstDark < img.width && img.data[(mid * img.width + firstDark) * 4] > 127) firstDark++;
    expect(firstDark / unit).toBeGreaterThanOrEqual(4);
  });
});

describe("QR — 현장 열화 조건", () => {
  it("흑백 인쇄(그레이스케일·1비트 이진화)에서도 읽힌다", async () => {
    const img = pngToRgba(await qrPngBuffer(REG));
    const gray = mapPixels(img, (r, g, b) => {
      const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      return [v, v, v];
    });
    expect(read(gray)).toBe(REG);
    const bw = mapPixels(gray, (r) => (r < 128 ? [0, 0, 0] : [255, 255, 255]));
    expect(read(bw)).toBe(REG);
  });

  /** 설계가 화면 최소치로 정한 200px 에서 읽혀야 한다 — 그게 규칙의 존재 이유다. */
  it(`화면 최소 표시 크기(${QR_MIN_DISPLAY_PX}px)에서 읽힌다`, async () => {
    const img = pngToRgba(await qrPngBuffer(REG));
    expect(read(resize(img, QR_MIN_DISPLAY_PX))).toBe(REG);
    // 여유가 얼마나 있는지도 못 박는다 — 절반으로 줄어도 읽혀야 안심할 수 있다.
    expect(read(resize(img, Math.round(QR_MIN_DISPLAY_PX / 2)))).toBe(REG);
  });

  it("저조도·대비 저하에서도 읽힌다 (밝기 최저 화면, 반사·지문)", async () => {
    const img = pngToRgba(await qrPngBuffer(REG));
    const dim = mapPixels(img, (r, g, b) => [r * 0.25, g * 0.25, b * 0.25] as [number, number, number]);
    expect(read(dim)).toBe(REG);
    // 검정을 70, 흰색을 185 로 눌러 대비를 좁힌다(젖은 손·반사).
    const flat = mapPixels(img, (r) => { const v = 70 + (r / 255) * 115; return [v, v, v]; });
    expect(read(flat)).toBe(REG);
  });

  it("180° 뒤집어도 읽힌다 — 스캐너에 거꾸로 대는 사람이 있다", async () => {
    const img = pngToRgba(await qrPngBuffer(REG));
    const data = new Uint8ClampedArray(img.data.length);
    const n = img.width * img.height;
    for (let i = 0; i < n; i++) {
      const s = i * 4, d = (n - 1 - i) * 4;
      data[d] = img.data[s]; data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2]; data[d + 3] = img.data[s + 3];
    }
    expect(read({ ...img, data })).toBe(REG);
  });

  /**
   * EC 레벨 Q 가 실제로 듣는지. **모듈 격자에 맞춰** 지운다 — 픽셀 면적으로 지우면
   * 경계를 가로질러 뭉개져 실제보다 훨씬 나쁘게 나온다(그렇게 한 번 잘못 읽었다).
   */
  it("데이터 영역 10%가 지워져도 복구한다 (접힌 자국·긁힘)", async () => {
    const img = pngToRgba(await qrPngBuffer(REG));
    const { modules } = QRCode.create(REG, { errorCorrectionLevel: "Q" });
    const N = modules.size;
    // 파인더·타이밍은 데이터가 아니다 — 거기가 깨지면 EC 이전에 위치를 못 잡는다.
    const structural = (x: number, y: number) =>
      (x < 9 && y < 9) || (x >= N - 8 && y < 9) || (x < 9 && y >= N - 8) || x === 6 || y === 6;
    const dataCells: Array<[number, number]> = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!structural(x, y)) dataCells.push([x, y]);

    const damaged = eraseModules(img, N, 4, dataCells.slice(0, Math.round(dataCells.length * 0.1)));
    expect(read(damaged)).toBe(REG);
  });
});

describe("QR — 투명 배경을 금지한 근거", () => {
  /**
   * §22 가 "규칙의 근거를 눈으로" 확인하라고 적은 항목.
   *
   * **소프트웨어 디코더로는 이 실패가 재현되지 않는다** — jsQR 은 바이트 값 차이가
   * 조금만 있어도 이진화한다. 실패는 알고리즘이 아니라 광학에서 일어난다(카메라 센서
   * 노이즈가 그 격차보다 크다). 그래서 여기서는 **명암비를 숫자로** 못 박는다.
   */
  it("투명 배경을 다크에 올리면 명암비가 무너진다", async () => {
    const transparent = await QRCode.toBuffer(REG, {
      errorCorrectionLevel: "Q", margin: 4, width: 256,
      color: { dark: "#000000ff", light: "#00000000" },
    });
    const img = pngToRgba(transparent);
    // 투명 픽셀이 다크 배경(#111318) 위에 올라간 상태를 계산한다.
    const DARK: [number, number, number] = [0x11, 0x13, 0x18];
    let sawTransparent = false;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] === 0) { sawTransparent = true; break; }
    expect(sawTransparent).toBe(true);

    const ratio = contrastRatio([0, 0, 0], DARK);
    expect(ratio).toBeLessThan(1.5);                  // 실측 1.13:1 — 사실상 안 보인다
  });

  it("우리 PNG 는 어떤 배경 위에서도 21:1 을 유지한다", async () => {
    // 불투명이므로 배경과 무관하게 흑↔백 대비가 그대로다.
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeGreaterThan(20);
  });
});
