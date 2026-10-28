import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests against the dev server and a seeded API (`pnpm --filter @nundina/api db:seed`, then
 * `pnpm --filter @nundina/api dev`). The web server is started here unless one is already running.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // the dev server compiles routes on first hit
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 2,
  reporter: [["list"]],
  use: { baseURL: process.env.WEB_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
  ],
  webServer: {
    command: "pnpm dev",
    // the wallet runner (e2e/run-wallet.mjs) serves on WEB_URL itself; reuse it
    url: process.env.WEB_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
