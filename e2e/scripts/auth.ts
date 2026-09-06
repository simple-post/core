import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const [url, file] = process.argv.slice(2);
if (!url || !file)
  throw new Error("Usage: yarn e2e:auth https://your-app-or-social-platform.example .local/auth/platform.json");
const target = new URL(url);
if (target.protocol !== "https:" && target.hostname !== "localhost")
  throw new Error("Use HTTPS, or localhost for local development.");
await mkdir(path.dirname(path.resolve(file)), { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(url);
console.log(
  "Sign in normally, then resume in Playwright Inspector to save the session. The runner does not enter passwords or bypass authentication.",
);
await page.pause();
await context.storageState({ path: file, indexedDB: true });
await browser.close();
