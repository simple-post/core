import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  outputDir: "./.local/self-test-results",
  workers: 2,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  use: { browserName: "chromium", headless: true },
  reporter: "list",
});
