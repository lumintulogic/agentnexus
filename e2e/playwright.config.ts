import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.AGENTNEXUS_BASE_URL ?? "http://127.0.0.1:4321";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    cwd: "..",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 90_000
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome"
      }
    }
  ],
  outputDir: "./test-results"
});
