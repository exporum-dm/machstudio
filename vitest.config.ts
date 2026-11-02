import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // `tests/**` 는 Playwright 몫이다(playwright.config.ts). vitest 가 집어 들면
    // "Playwright Test did not expect test() to be called here" 로 3개 파일이 실패해
    // `npm test` 가 통째로 빨간불이 된다 — 코드 결함이 아니라 수거 범위 문제다.
    exclude: ["node_modules/**", "dist/**", ".next/**", ".claude/**", "tests/**", ".worktrees/**", ".deploy-worktrees/**"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
