import { defineConfig, devices } from "@playwright/test";

const webBaseUrl = process.env.DENTLINK_PREVIEW_WEB_URL ?? "https://dentlink-web-preview.pages.dev";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: webBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
