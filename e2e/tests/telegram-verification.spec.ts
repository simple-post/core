import { test, expect } from "@playwright/test";
import { account, config } from "./helpers.js";
import { assertTelegramObserver, telegramWebMessage } from "../src/verification/telegram.js";
import { assertRequirements } from "../src/preflight.js";
import { postUrl, verifyOnPlatform } from "../src/verification/browser.js";
import { catalog, materialize } from "../src/catalog.js";
import { discoverAccounts, type Reader } from "../src/discovery.js";
import type { Browser } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const privateChat = account({
  platformAccountId: "1234567",
  username: "@testuser",
  observer: {
    profileUrl: "https://t.me/testuser",
    open: [],
    fields: {},
  },
});
const smoke = materialize(
  catalog.find((c) => c.id === "telegram.smoke")!,
  privateChat,
  "ui",
  "r",
  "https://media.example.com",
);

test("private chat cannot be treated as a public channel, even with a returned t.me link", () => {
  expect(() => assertRequirements(smoke, privateChat)).toThrow("private chat");
  expect(() =>
    postUrl(smoke, privateChat, { success: true, postId: "21", postUrl: "https://t.me/testuser/21" }),
  ).toThrow("private chat");
});
test("private chat verification fails immediately before opening a browser", async () => {
  await expect(
    verifyOnPlatform({} as Browser, config(), smoke, privateChat, { success: true, postId: "21" }, "/unused"),
  ).rejects.toThrow("private chat");
});
test("public channel retains its permalink and cancellation needs no platform observer", () => {
  const channel = { ...privateChat, platformAccountId: "-1001234567" };
  expect(() => assertTelegramObserver(channel)).not.toThrow();
  expect(postUrl(smoke, channel, { success: true, postId: "21" })).toBe("https://t.me/testuser/21?embed=1&mode=tme");
  expect(() => assertRequirements({ ...smoke, mode: "cancel" }, privateChat)).not.toThrow();
});
test("setup identifies private Telegram verification needs instead of guessing a public channel", async () => {
  const read: Reader = async <T>() =>
    ({
      accounts: [
        { id: "tg", platform: "telegram", platformAccountId: "1234567", userId: "test-user", username: "@testuser" },
      ],
    }) as T;
  const result = await discoverAccounts(read, ["telegram"], [], undefined, async () => {
    throw new Error("No selection expected");
  });
  expect(result.accounts.telegram!.observer.profileUrl).toBe("https://web.telegram.org/");
  expect(result.notes.join(" ")).toContain("private chat");
});

test("Telegram channel-not-found page fails immediately instead of polling for three minutes", async ({ browser }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "telegram-missing-channel-"));
  const channel = { ...privateChat, platformAccountId: "-1001234567" };
  let visits = 0;
  const controlledBrowser = {
    newContext: async () => {
      const context = await browser.newContext();
      await context.route("https://t.me/**", async (route) => {
        visits++;
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: "<p>Channel with username @testuser not found</p>",
        });
      });
      return context;
    },
  } as Browser;
  try {
    await expect(
      verifyOnPlatform(
        controlledBrowser,
        config({ verifyTimeoutMs: 180_000 }),
        smoke,
        channel,
        { success: true, postId: "21" },
        dir,
      ),
    ).rejects.toThrow("Telegram cannot show this channel/message");
    expect(visits).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const webAccount = {
  ...privateChat,
  observer: {
    ...privateChat.observer,
    storageState: ".local/auth/telegram.json",
    telegramWeb: { botPeerId: "987654", botUsername: "TestBot" },
  },
};
const window = { from: "2026-09-05T22:18:13.000Z", to: "2026-09-05T22:18:18.000Z" };
async function webFixture(page: import("@playwright/test").Page, text: string) {
  await page.route("https://web.telegram.org/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<script>localStorage.setItem('user_auth', JSON.stringify({id:1234567}))</script>
    <div class="chat-info"><span class="peer-title" data-peer-id="987654">TestBot</span></div>
    <div class="bubbles">
      <div class="bubble is-in" data-mid="100" data-peer-id="987654" data-timestamp="1788640000"><div class="message"><span class="translatable-message">${text}</span></div></div>
      <div class="bubble is-out" data-mid="200" data-peer-id="987654" data-timestamp="1788646697"><div class="message"><span class="translatable-message">${text}</span></div></div>
      <div class="bubble is-in" data-mid="300" data-peer-id="111111" data-timestamp="1788646697"><div class="message"><span class="translatable-message">${text}</span></div></div>
      <div class="bubble is-in" data-mid="22135" data-peer-id="987654" data-timestamp="1788646697" style="min-height:40px"><div class="message"><span class="translatable-message">${text}</span></div></div>
    </div>`,
    }),
  );
  await page.goto("https://web.telegram.org/k/#@TestBot");
}
test("private Telegram maps a bot receipt to an incoming Web message using identity, caption, and time", async ({
  page,
}) => {
  await webFixture(page, smoke.expectedText);
  expect(() => assertTelegramObserver(webAccount)).not.toThrow();
  expect(postUrl(smoke, webAccount, { success: true, postId: "21" })).toBeUndefined();
  const found = await telegramWebMessage(page, smoke, webAccount, window);
  expect(found.id).toBe("22135");
  await expect(found.root).toHaveAttribute("data-peer-id", "987654");
});
test("captionless private messages still require matching bot, direction, and submission time", async ({ page }) => {
  await webFixture(page, "");
  const found = await telegramWebMessage(page, { ...smoke, expectedText: "" }, webAccount, window);
  expect(found.id).toBe("22135");
});
test("private Telegram rejects an unusable timestamp window instead of matching arbitrary history", async ({
  page,
}) => {
  await expect(telegramWebMessage(page, smoke, webAccount, { from: "invalid", to: "invalid" })).rejects.toThrow(
    "submission time window",
  );
});

test("private Telegram scrolls past old unread history to locate the receipt's message", async ({ page }) => {
  await webFixture(page, smoke.expectedText);
  await page.evaluate(() => {
    const bubbles = document.querySelector(".bubbles")!;
    const scroll = document.createElement("div");
    scroll.className = "bubbles-scrollable";
    scroll.style = "height:250px;overflow:auto";
    const target = bubbles.querySelector('[data-mid="22135"]')!;
    target.remove();
    scroll.append(...bubbles.childNodes);
    bubbles.append(scroll);
    scroll.addEventListener("wheel", () => scroll.append(target), { once: true });
  });
  const found = await telegramWebMessage(page, smoke, webAccount, window);
  expect(found.id).toBe("22135");
});
