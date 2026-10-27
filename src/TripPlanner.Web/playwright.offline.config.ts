import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.browser.ts",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4174" },
  projects: [
    { name: "webkit", use: { browserName: "webkit" } },
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: {
    command:
      "corepack pnpm --config.verify-deps-before-run=false --config.update-notifier=false run build && node e2e/fixtureServer.mjs",
    url: "http://127.0.0.1:4174",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
