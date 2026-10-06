/**
 * 상세페이지 임베드 런타임 번들 빌드.
 *
 *   src/embed/detail-page-entry.ts  --esbuild(IIFE)-->  src/generated/detail-page-runtime.ts
 *
 * 랜딩 런타임(build-landing-runtime.mjs)과 같은 규약이다: 생성물을 커밋하고, /d/{id} 라우트가
 * 이 문자열을 그대로 서빙한다. 라우트만 열어도 동작해야 하므로 런타임에 번들러를 돌리지 않는다.
 * predev/prebuild 에서 재생성되며, 소스가 바뀌었는데 생성물이 낡으면 해시로 드러난다.
 */
import { detailPageSourceHash } from "./runtime-hash.mjs";
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/generated/detail-page-runtime.ts");


const result = await build({
  entryPoints: [join(root, "src/embed/detail-page-entry.ts")],
  bundle: true,
  format: "iife",
  globalName: "__msDetailPage",
  target: ["es2020", "safari16", "chrome105", "firefox110"],
  minify: true,
  legalComments: "none",
  write: false,
  alias: { "@": join(root, "src") },
  define: { "process.env.NODE_ENV": '"production"' },
});

const js = result.outputFiles[0].text;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  `// 자동 생성 — 직접 고치지 마세요. \`node scripts/build-detail-page-runtime.mjs\` 로 재생성됩니다.\n` +
    `// 소스: src/embed/detail-page-entry.ts + src/lib/notice/*.ts + src/lib/detail-page/config.ts\n\n` +
    `export const DETAIL_PAGE_RUNTIME_SRC_HASH = ${JSON.stringify(detailPageSourceHash(root))};\n\n` +
    `export const DETAIL_PAGE_RUNTIME_JS = ${JSON.stringify(js)};\n`,
);

console.log(
  `detail-page-runtime: ${(js.length / 1024).toFixed(1)}KB (minified) → src/generated/detail-page-runtime.ts`,
);
