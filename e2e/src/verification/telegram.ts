import type { Account } from "../config.js";
import { expect, type Page, type Locator } from "@playwright/test";
import { verifyFixtureImage } from "./image.js";
import type { Materialized } from "../types.js";

export class VerificationSetupError extends Error {}

export function assertTelegramObserver(account: Account) {
  // A positive Telegram chat ID identifies a private conversation. Its user's
  // t.me profile is not a public channel and cannot expose bot messages.
  if (!/^[1-9]\d*$/.test(account.platformAccountId)) return;
  const observer = account.observer;
  if (observer.storageState && observer.telegramWeb) return;
  const template = observer.postUrlTemplate;
  if (
    template &&
    new URL(template).hostname === "web.telegram.org" &&
    template.includes("{id}") &&
    observer.storageState &&
    observer.root &&
    observer.author &&
    observer.text
  )
    return;
  throw new VerificationSetupError(
    "BLOCKED: this Telegram destination is a private chat. A t.me username/message link cannot verify it. " +
      "Telegram Web verification needs a saved Telegram login and calibrated message URL/identity selectors, " +
      "or use a public test channel. No new post was submitted. Existing receipts can be resumed after verification is configured.",
  );
}

export interface VerificationWindow {
  from: string;
  to: string;
}

async function loadNewerTelegramHistory(page: Page) {
  // Saved sessions can reopen at an old unread position. Telegram loads history in
  // batches and may temporarily render only the first part of an album.
  const scroll = page.locator(".bubbles .bubbles-scrollable");
  if (!(await scroll.isVisible())) return;
  await scroll.hover({ timeout: 3000 });
  await page.mouse.wheel(0, 2000);
}

export async function telegramWebMessage(page: Page, s: Materialized, account: Account, window: VerificationWindow) {
  const target = account.observer.telegramWeb!;
  const from = Math.floor(Date.parse(window.from) / 1000) - 2;
  const to = Math.ceil(Date.parse(window.to) / 1000) + 2;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
    throw new VerificationSetupError("Private Telegram verification requires the saved submission time window.");
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          try {
            return String(JSON.parse(localStorage.getItem("user_auth") ?? "{}").id ?? "");
          } catch {
            return "";
          }
        }),
      { timeout: 15_000, message: "Telegram session must belong to the configured recipient" },
    )
    .toBe(account.platformAccountId);
  const header = page.locator(`.chat-info .peer-title[data-peer-id="${target.botPeerId}"]`);
  await expect(header).toBeVisible({ timeout: 30_000 });
  // The bot's per-chat API message ID differs from the recipient's Web message ID.
  // Identify an incoming message by bot identity, exact caption, and the durable submission window.
  const candidates = page.locator(
    `.bubbles .bubble.is-in[data-peer-id="${target.botPeerId}"][data-mid][data-timestamp]`,
  );
  const matches = async () =>
    candidates.evaluateAll(
      (nodes, expected) =>
        nodes
          .filter((node) => {
            const time = Number(node.getAttribute("data-timestamp"));
            const caption = [...node.querySelectorAll(".message > .translatable-message")]
              .map((n) => n.textContent ?? "")
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            return time >= expected.from && time <= expected.to && caption === expected.text;
          })
          .map((node) => node.getAttribute("data-mid")!),
      { from, to, text: s.expectedText.replace(/\s+/g, " ").trim() },
    );
  await expect
    .poll(
      async () => {
        const count = (await matches()).length;
        if (count === 0) await loadNewerTelegramHistory(page);
        return count;
      },
      {
        timeout: 30_000,
        intervals: [500, 1000],
        message: "Exactly one incoming bot message must match the caption and submission time",
      },
    )
    .toBe(1);
  const [id] = await matches();
  if (!/^\d+$/.test(id)) throw new Error("Telegram returned an invalid Web message identifier");
  // Use the observed numeric identifier after matching, so all media checks stay scoped to this message.
  const message = page.locator(`.bubbles .bubble.is-in[data-peer-id="${target.botPeerId}"][data-mid="${id}"]`);
  await expect(message).toHaveCount(1);
  await message.scrollIntoViewIfNeeded();
  return { id, root: message };
}

/** Telegram Web mounts album videos in its media viewer only after opening a thumbnail. */
export async function verifyTelegramWebAlbum(
  page: Page,
  root: Locator,
  s: Materialized,
  botPeerId: string,
  timeout = 30_000,
) {
  const items = root.locator(".attachment .album-item");
  await expect
    .poll(
      async () => {
        const count = await items.count();
        if (count < s.media.length) await loadNewerTelegramHistory(page);
        return count;
      },
      { timeout, intervals: [500, 1000], message: "Every Telegram album attachment must be present" },
    )
    .toBe(s.media.length);
  for (const [index, key] of s.media.entries()) {
    const item = items.nth(index);
    const isVideo = key === "video" || key === "silentVideo";
    const videoMarker = item.locator(".video-play, video");
    expect((await videoMarker.count()) > 0, `Album item ${index + 1} must be ${isVideo ? "video" : "image"}`).toBe(
      isVideo,
    );
    if (!isVideo) {
      const image = item.locator("img.media-photo:not(.thumbnail)");
      await expect(image).toHaveCount(1);
      await expect
        .poll(() => image.evaluate((n) => n instanceof HTMLImageElement && n.complete && n.naturalWidth > 0), {
          timeout,
        })
        .toBe(true);
      await verifyFixtureImage(await image.screenshot(), key, `Album item ${index + 1}`);
      continue;
    }
    console.log(`[${s.id}] Opening album video ${index + 1} for playback verification.`);
    // Clicking the thumbnail is the customer action; it overlays the decorative play icon.
    await item.locator(".album-item-media").click();
    const viewer = page.locator(".media-viewer-whole.active");
    try {
      await expect(viewer).toBeVisible();
      await expect(viewer.locator(".media-viewer-userpic")).toHaveAttribute("data-peer-id", botPeerId);
      const video = viewer.locator(".media-viewer-mover.active video");
      await expect(video).toHaveCount(1);
      await expect(video).toBeVisible();
      await expect
        .poll(() => video.evaluate((n) => n instanceof HTMLVideoElement && n.readyState >= 2 && n.videoWidth > 0), {
          timeout,
          message: `Album video ${index + 1} must load and be playable`,
        })
        .toBe(true);
      expect(
        await video.evaluate((n) => (n as HTMLVideoElement).duration),
        `Album video ${index + 1} duration`,
      ).toBeCloseTo(4, 0);
      const start = await video.evaluate((n) => (n as HTMLVideoElement).currentTime);
      await expect
        .poll(() => video.evaluate((n, start) => Math.abs((n as HTMLVideoElement).currentTime - start), start), {
          timeout,
          message: `Album video ${index + 1} must actually play`,
        })
        .toBeGreaterThan(0.05);
    } finally {
      await page.keyboard.press("Escape");
      // Telegram removes .active immediately, while the closing backdrop still dims
      // the album. Wait for the actual viewer and media animation to disappear.
      await expect(
        page.locator(".media-viewer-whole:visible, .media-viewer-mover:visible"),
        "Telegram media viewer must finish closing before checking the next attachment",
      ).toHaveCount(0);
    }
  }
}

/** Reply targets are rendered as a nested preview inside the delivered message. */
export async function verifyTelegramWebReply(
  root: Locator,
  resources: Record<string, string | number>,
  timeout = 30_000,
) {
  const targetId = resources.replyToId === undefined ? undefined : String(resources.replyToId);
  const targetWebId = resources.replyToWebId === undefined ? undefined : String(resources.replyToWebId);
  const targetText = resources.replyToText === undefined ? undefined : String(resources.replyToText);
  if (!targetId) throw new VerificationSetupError("Telegram reply verification requires resources.replyToId.");
  const candidates = root.locator('[class*="reply"], [data-reply-to], [data-reply-to-mid], [data-reply-to-message-id]');
  await expect
    .poll(
      async () =>
        candidates.evaluateAll(
          (nodes, target) =>
            nodes.some((node) => {
              const attrs = [...node.attributes].map((attribute) => attribute.value).join(" ");
              const text = node.textContent ?? "";
              return (
                attrs.includes(target.id) ||
                (target.webId !== undefined && attrs.includes(target.webId)) ||
                (target.text !== undefined && text.includes(target.text))
              );
            }),
          { id: targetId, webId: targetWebId, text: targetText },
        ),
      { timeout, message: "Telegram reply must reference the configured target message" },
    )
    .toBe(true);
}
