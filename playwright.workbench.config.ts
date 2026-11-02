import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/workbench-browser",
  outputDir: "test-results/workbench-browser",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: "http://127.0.0.1:3102", screenshot: "only-on-failure" },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3102",
    url: "http://127.0.0.1:3102/dev/workbench-harness",
    timeout: 180_000,
    env: { EXPO_SCHEMA_CAPABILITY: "disabled", EXPO_PUBLIC_EMBED_RELEASE: "off", NEXT_TELEMETRY_DISABLED: "1" },
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", channel: "msedge", viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { browserName: "chromium", channel: "msedge", viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
