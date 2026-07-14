import { defineConfig, devices } from "@playwright/test";

const webBaseUrl = process.env.DENTLINK_PREVIEW_WEB_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: webBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  webServer: process.env.DENTLINK_PREVIEW_WEB_URL
    ? undefined
    : {
        command: "pnpm --filter @dentlink/web exec vite --host 127.0.0.1",
        url: webBaseUrl,
        reuseExistingServer: true
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
