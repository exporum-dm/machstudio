// 미디어 자료실의 큰 사진을 웹용으로 다시 줄인다 — 같은 경로에 덮어써서 이미 붙여 둔 링크(아임웹 등)는 그대로 둔다(2026-10-28).
//
// 왜: 아임웹 LA 페이지가 자료실 원본(15.6MB PNG 등)을 그대로 불러 Supabase cached egress(무료 5GB)를 넘겼다.
// 새 업로드는 브라우저에서 줄인다(src/lib/web-image.ts). 이 스크립트는 이미 올라간 것들 몫.
//
// 규칙(web-image.ts 와 같음): 긴 변 2000px. 불투명 → JPEG q82(경로·확장자는 그대로, Content-Type 만 image/jpeg),
// 투명 PNG → 팔레트 PNG. 결과가 원본보다 작을 때만 덮어쓴다. GIF·SVG·동영상은 건드리지 않는다.
//
// 사용:
//   node scripts/recompress-media.mjs                 # 미리보기(바꾸지 않음) — 대상과 예상 크기만 출력
//   node scripts/recompress-media.mjs --apply         # 실제로 덮어쓰고 MediaAsset.size 갱신
//   --min-kb=500  기준 크기(기본 500KB)
// 원본은 scripts/.recompress-backup/ 에 먼저 저장한다(되돌릴 때 사용, 커밋 금지).
import { config } from "dotenv";
import pg from "pg";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

config({ path: ".env.local" });
config();

const APPLY = process.argv.includes("--apply");
const minKbArg = process.argv.find((a) => a.startsWith("--min-kb="));
const MIN_BYTES = (minKbArg ? Number(minKbArg.split("=")[1]) : 500) * 1024;
const MAX_EDGE = 2000;
const BUCKET = "media-library";
const BACKUP_DIR = path.join("scripts", ".recompress-backup");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey || !process.env.DATABASE_URL) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · DATABASE_URL 이 필요합니다(.env.local).");
}
const authHeaders = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
const objectUrl = (p) => `${supabaseUrl}/storage/v1/object/${BUCKET}/${p.split("/").map(encodeURIComponent).join("/")}`;

async function shrink(input) {
  const img = sharp(input, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const resized = img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
  let hasAlpha = false;
  if (meta.hasAlpha) {
    const stats = await sharp(input).stats();
    hasAlpha = !stats.isOpaque;
  }
  if (hasAlpha) {
    const buf = await resized.png({ palette: true, quality: 85, compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    return { ...buf, type: "image/png" };
  }
  const buf = await resized.flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { ...buf, type: "image/jpeg" };
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  `SELECT id, path, "mimeType", size, "originalName" FROM "MediaAsset"
   WHERE kind = 'image' AND "mimeType" IN ('image/jpeg','image/jpg','image/png','image/webp') AND size > $1
   ORDER BY size DESC`,
  [MIN_BYTES],
);
console.log(`${APPLY ? "적용" : "미리보기"} — 대상 ${rows.length}개 (>${Math.round(MIN_BYTES / 1024)}KB)`);

let before = 0;
let after = 0;
let failed = 0;
for (const row of rows) {
  try {
    const res = await fetch(objectUrl(row.path), { headers: authHeaders });
    if (!res.ok) throw new Error(`다운로드 ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());
    const out = await shrink(input);
    if (out.data.length >= input.length * 0.9) {
      console.log(`  건너뜀  ${row.originalName} (${(input.length / 1e6).toFixed(1)}MB, 줄여도 이득 없음)`);
      continue;
    }
    before += input.length;
    after += out.data.length;
    console.log(`  ${APPLY ? "덮어씀" : "예정  "}  ${row.originalName}  ${(input.length / 1e6).toFixed(1)}MB → ${(out.data.length / 1e6).toFixed(2)}MB  ${out.info.width}×${out.info.height} ${out.type}`);
    if (!APPLY) continue;

    const backup = path.join(BACKUP_DIR, row.path);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, input);

    const up = await fetch(objectUrl(row.path), {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": out.type, "x-upsert": "true", "cache-control": "max-age=31536000" },
      body: out.data,
    });
    if (!up.ok) throw new Error(`업로드 ${up.status} ${await up.text()}`);
    await client.query(`UPDATE "MediaAsset" SET size = $1, "mimeType" = $2, width = $3, height = $4 WHERE id = $5`, [
      out.data.length, out.type, out.info.width, out.info.height, row.id,
    ]);
  } catch (err) {
    failed++;
    console.log(`  실패    ${row.originalName}: ${err.message}`);
  }
}
await client.end();
console.log(`합계 ${(before / 1e6).toFixed(1)}MB → ${(after / 1e6).toFixed(1)}MB${failed ? ` · 실패 ${failed}개` : ""}`);
