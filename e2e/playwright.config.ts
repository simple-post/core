import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, selection } from "./src/config.js";
const file = process.env.E2E_CONFIG ?? "config.local.json";
// --list is useful before accounts are configured. Execution still requires global preflight.
const cfg = existsSync(file) ? loadConfig(file) : undefined;
const run = process.env.E2E_RUN_ID;
const artifactDir = run ? path.join(cfg?.runDir ?? path.resolve(".local/runs"), run) : undefined;
export default defineConfig({
  testDir: "./live",
  globalSetup: "./src/preflight.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  maxFailures: 1,
  forbidOnly: true,
  timeout: cfg
    ? (cfg.publishTimeoutMs + cfg.verifyTimeoutMs) * 5 + cfg.dispatchAllowanceMs + cfg.scheduleDelayMinutes * 60_000
    : 2_400_000,
  expect: { timeout: 15_000 },
  use: {
    browserName: "chromium",
    locale: "en-US",
    timezoneId: "UTC",
    storageState: cfg?.schedulerStorageState,
    viewport: { width: 1440, height: 1100 },
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: "off",
    screenshot: "only-on-failure",
  },
  // Each live invocation gets its own Playwright artifacts. Playwright creates a
  // fresh browser context per test; no persistent browser profile is used here.
  outputDir: artifactDir ? path.join(artifactDir, "test-results") : "./test-results",
  projects: selection().interfaces.map((name) => ({ name })),
  reporter: [
    ["list"],
    ["./src/reporter.ts"],
    ["html", { open: "never", outputFolder: artifactDir ? path.join(artifactDir, "html") : "./playwright-report" }],
    ["json", { outputFile: artifactDir ? path.join(artifactDir, "results.json") : ".local/results.json" }],
  ],
});
