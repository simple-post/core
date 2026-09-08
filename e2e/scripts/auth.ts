import { chromium } from "@playwright/test";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import path from "node:path";
import { chromeAuth, saveAuthState } from "../src/chrome-auth.js";

const { values, positionals } = parseArgs({
  options: { chrome: { type: "boolean" }, help: { type: "boolean" } },
  allowPositionals: true,
});
const usage = "Usage: yarn e2e:auth [--chrome] https://your-app-or-social-platform.example .local/auth/platform.json";
if (values.help) {
  console.log(usage);
  console.log("--chrome: sign in manually in installed Chrome, then confirm in the terminal to save the session.");
  process.exit(0);
}
const [url, destination] = positionals;
if (!url || !destination || positionals.length !== 2) throw new Error(usage);
const target = new URL(url);
if (target.protocol !== "https:" && !(target.protocol === "http:" && target.hostname === "localhost"))
  throw new Error("Use HTTPS, or HTTP localhost for local development.");
const file = path.resolve(destination);
if (values.chrome) {
  if (!process.stdin.isTTY) throw new Error("--chrome requires an interactive terminal to confirm manual login.");
  await chromeAuth(url, file, async (signal) => {
    console.log(
      "Sign in manually in the Chrome window using the dedicated test profile. Keep the window open. If login is blocked, press Ctrl+C; do not keep retrying.",
    );
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await terminal.question('Once your account is visibly logged in, type "save" and press Enter: ', {
        signal,
      });
      if (answer.trim().toLowerCase() !== "save") throw new Error("Session not saved; existing session retained.");
    } finally {
      terminal.close();
    }
  });
} else {
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    console.log(
      "Sign in normally, then resume in Playwright Inspector to save the session. The runner does not enter passwords or bypass authentication.",
    );
    await page.pause();
    await saveAuthState(context, file);
  } finally {
    await browser.close();
  }
}
console.log(
  `Browser session saved to ${file}. Login and platform verification still need to succeed in the test browser.`,
);
