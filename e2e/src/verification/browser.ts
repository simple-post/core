import { expect, type Browser, type Page, type Locator } from "@playwright/test";
import { verifyYouTubeMetadata, type YouTubeVerification } from "./youtube.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyFixtureImage } from "./image.js";
import type { LiveConfig, Account } from "../config.js";
import type { Materialized, PostingResult, Platform } from "../types.js";
import {
  assertTelegramObserver,
  VerificationSetupError,
  telegramWebMessage,
  verifyTelegramWebAlbum,
  verifyTelegramWebReply,
  type VerificationWindow,
} from "./telegram.js";
import { redact } from "../redact.js";
import { SchedulerApi } from "../http.js";
export interface Surface {
  root: string;
  author: string;
  text: string;
  images: string;
  video: string;
  title?: string;
}
// Real platform DOM defaults, kept separate from customer-side SimplePost locators.
// Platforms change their DOM and locales: every selector is overridable in the account manifest.
// No fallback to document.body: navigation chrome or a login screen must never count as a post.
export const surfaces: Record<Platform, Surface> = {
  x: {
    root: 'article[data-testid="tweet"], article:has(a[data-timezone][href*="/status/"])',
    author: '[data-testid="User-Name"] a, a:has(img[alt^="@"])',
    text: '[data-testid="tweetText"], :scope:not([data-testid]) div[dir="auto"]',
    images: '[data-testid="tweetPhoto"] img, a[aria-label="Image"][href*="/photo/"] img',
    video: "video",
  },
  instagram: {
    // The login prompt adds/removes a main child. Match the content wrapper by
    // its media instead of that shifting sibling index; exclude recommendations.
    root: 'main > div > div:first-child:has(img[alt^="Photo by"], video)',
    author: "a[href]",
    text: 'span:has(a[href*="/explore/tags/"])',
    images: 'img[alt^="Photo by"]',
    video: "video",
  },
  facebook: {
    root: '[role="article"]',
    author: "h2 a, h3 a",
    text: '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-ad-rendering-role="story_message"]',
    images: 'a[href*="photo"] img',
    video: "video",
  },
  threads: {
    root: '[data-pressable-container="true"]',
    author: 'a[href^="/@"]',
    text: 'span[dir="auto"]:has(a[href*="serp_type=tags"])',
    images: "picture img",
    video: "video",
  },
  tiktok: {
    root: '[data-e2e="browse-video"], [data-e2e="video-detail"]',
    author: '[data-e2e="browse-username"], a[href^="/@"]',
    text: '[data-e2e="browse-video-desc"]',
    title: '[data-e2e="photo-title"]',
    images: '[data-e2e="photo-mode"] img',
    video: "video",
  },
  youtube: {
    root: "ytd-watch-flexy",
    author: "#owner a[href]",
    text: "#description-inline-expander #snippet-text",
    images: 'img[data-testid="post-image"]',
    video: "video.html5-main-video",
    title: "h1.ytd-watch-metadata",
  },
  pinterest: {
    root: '[data-test-id="pin-closeup"], [data-test-id="CloseupMainPin"]',
    author: '[data-test-id="creator-profile-link"]',
    text: '[data-test-id="pin-description"], [data-test-id="main-pin-description-text"]',
    images: '[data-test-id="pin-closeup-image"] img',
    video: "video",
    title: "h1",
  },
  linkedin: {
    root: '[data-urn*="activity"], article',
    author:
      '.update-components-actor a, [data-test-id="main-feed-activity-card__entity-lockup"] a[data-tracking-control-name="public_post_feed-actor-name"]',
    text: '.update-components-text, [data-test-id="main-feed-activity-card__commentary"]',
    images: '.update-components-image img, [data-test-id="feed-images-content"] img',
    video: "video",
  },
  bluesky: {
    root: '[data-testid^="postThreadItem"]',
    author: 'a[href*="/profile/"]',
    text: '[data-word-wrap="1"]',
    images: 'img[src*="/feed_thumbnail/"]',
    video: "video",
  },
  telegram: {
    root: ".tgme_widget_message",
    author: ".tgme_widget_message_owner_name",
    text: ".tgme_widget_message_text",
    images: ".tgme_widget_message_photo_wrap",
    video: "video",
  },
  forem: {
    root: "article",
    author: "a.crayons-link[href]",
    text: "#article-body",
    images: "#article-body img",
    video: "#article-body video",
    title: "h1",
  },
};
function observerSurface(platform: Platform, account: Account) {
  const cfg = { ...surfaces[platform], ...account.observer };
  // Migrate only the former shipped default, even when saved as a config override.
  // Keep intentional custom roots intact.
  if (platform === "instagram" && cfg.root.replace(/\s/g, "") === "main>div:nth-child(2)>div:first-child")
    cfg.root = surfaces.instagram.root;
  return cfg;
}
export function allowedHost(platform: Platform, url: string, account: Account): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  const host = parsed.hostname.replace(/^www\./, "");
  const domains: Record<Platform, string[]> = {
    x: ["x.com", "twitter.com"],
    instagram: ["instagram.com"],
    facebook: ["facebook.com"],
    threads: ["threads.net", "threads.com"],
    tiktok: ["tiktok.com"],
    youtube: ["youtube.com", "youtu.be"],
    pinterest: ["pinterest.com"],
    linkedin: ["linkedin.com"],
    bluesky: ["bsky.app"],
    telegram: ["t.me", "web.telegram.org"],
    forem: [new URL(account.observer.profileUrl).hostname.replace(/^www\./, "")],
  };
  return domains[platform].some((domain) => host === domain || host.endsWith(`.${domain}`));
}
export function isPostUrl(platform: Platform, url: string): boolean {
  const u = new URL(url),
    p = u.pathname;
  if (platform === "youtube")
    return (
      (p === "/watch" && Boolean(u.searchParams.get("v"))) ||
      /^\/shorts\/[^/]+/.test(p) ||
      (u.hostname === "youtu.be" && p.length > 1)
    );
  if (platform === "facebook" && ["/watch/", "/watch", "/story.php", "/permalink.php", "/photo.php"].includes(p))
    return Boolean(u.searchParams.get("v") || u.searchParams.get("story_fbid") || u.searchParams.get("fbid"));
  if (platform === "forem") return /^\/[^/]+\/[^/]+/.test(p) && !/^\/(dashboard|settings|new)(\/|$)/.test(p);
  if (platform === "telegram") return /^\/[^/]+\/\d+/.test(p) || (u.hostname === "web.telegram.org" && Boolean(u.hash));
  return /\/(status|post|posts|p|reel|photo|video|videos|pin|update)\//.test(p);
}
export function postUrl(s: Materialized, account: Account, result: PostingResult): string | undefined {
  if (s.platform === "telegram") assertTelegramObserver(account);
  if (s.platform === "telegram" && account.observer.telegramWeb) return undefined;
  if (result.postUrl && allowedHost(s.platform, result.postUrl, account) && isPostUrl(s.platform, result.postUrl)) {
    assertPostId(s.platform, result.postUrl, result.postId);
    return result.postUrl;
  }
  const id = result.postId;
  if (!id) return;
  if (account.observer.postUrlTemplate) {
    const value = account.observer.postUrlTemplate
      .replaceAll("{id}", encodeURIComponent(id))
      .replaceAll("{username}", encodeURIComponent(account.username.replace(/^@/, "")));
    if (!allowedHost(s.platform, value, account) || !isPostUrl(s.platform, value))
      throw new Error("Observer post URL is outside the expected platform");
    return value;
  }
  const username = encodeURIComponent(account.username.replace(/^@/, ""));
  if (s.platform === "x") return `https://x.com/${username}/status/${id}`;
  if (s.platform === "youtube") return `https://www.youtube.com/watch?v=${id}`;
  if (s.platform === "bluesky" && /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/]+$/.test(id))
    return `https://bsky.app/profile/${encodeURIComponent(id.split("/")[2])}/post/${encodeURIComponent(id.split("/").at(-1)!)}`;
  if (s.platform === "tiktok" && /^\d+$/.test(id))
    return `https://www.tiktok.com/@${username}/${s.media.some((x) => x.toLowerCase().includes("video")) ? "video" : "photo"}/${id}`;
  if (s.platform === "facebook")
    return `https://www.facebook.com/${encodeURIComponent(account.platformAccountId)}/posts/${encodeURIComponent(id)}`;
  if (s.platform === "pinterest") return `https://www.pinterest.com/pin/${encodeURIComponent(id)}/`;
  if (s.platform === "linkedin") return `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`;
  if (s.platform === "telegram" && !account.username.startsWith("-"))
    return `https://t.me/${username}/${id}?embed=1&mode=tme`;
  // Instagram numeric IDs, AT URIs, and publishing job handles are not permalinks.
  // Discover on the owner's profile using the unique content marker instead.
}
export function assertPostId(platform: Platform, url: string, id?: string) {
  if (!id) return;
  const u = new URL(url);
  const parts = decodeURIComponent(u.pathname).split("/").filter(Boolean);
  let actual: string | undefined;
  let expected = id;
  if (platform === "youtube")
    actual =
      u.hostname === "youtu.be" ? parts[0] : parts[0] === "shorts" ? parts[1] : (u.searchParams.get("v") ?? undefined);
  if (platform === "x") actual = parts[parts.indexOf("status") + 1];
  if (platform === "pinterest") actual = parts[parts.indexOf("pin") + 1];
  if (platform === "telegram" && u.hostname === "t.me") actual = parts.at(-1);
  if (platform === "tiktok" && /^\d+$/.test(id)) actual = parts.at(-1);
  if (platform === "bluesky" && id.startsWith("at://")) {
    actual = parts.at(-1);
    expected = id.split("/").at(-1)!;
  }
  if (actual !== undefined) expect(actual, "Platform permalink must match the returned post ID").toBe(expected);
}
async function discover(page: Page, s: Materialized, account: Account): Promise<string> {
  await page.goto(account.observer.profileUrl, { waitUntil: "domcontentloaded" });
  const surface = observerSurface(s.platform, account);
  const card = page.locator(surface.root).filter({ hasText: s.token });
  await expect(card, "Find the exact run marker in a post on the configured profile").toHaveCount(1);
  const links = await card.locator("a[href]").evaluateAll((nodes) => nodes.map((n) => (n as HTMLAnchorElement).href));
  const url = links.find(
    (h) => allowedHost(s.platform, h, account) && /\/(status|post|p|reel|photo|video|pin)\//.test(h),
  );
  if (!url)
    throw new Error(
      "NEEDS VERIFICATION: no canonical permalink found for the exact scenario. Supply a postUrlTemplate or inspect the publishing handle.",
    );
  return url;
}
function normalized(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
async function dismissCookieConsent(page: Page) {
  const labels = [/allow all cookies/i, /accept all cookies/i, /^accept all$/i, /^allow all$/i];
  for (const label of labels) {
    const control = page.getByRole("button", { name: label }).first();
    if (await control.isVisible().catch(() => false)) {
      await control.click();
      await control.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
      return;
    }
    const text = page.getByText(label).first();
    if (await text.isVisible().catch(() => false)) {
      await text.click();
      await text.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
      return;
    }
  }
}
async function dismissLoggedOutPrompt(page: Page) {
  const prompt = page
    .getByRole("dialog")
    .filter({ hasText: /never miss a post from/i })
    .first();
  if (!(await prompt.isVisible().catch(() => false))) return;
  const close = prompt.locator('[role="button"]').first();
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await prompt.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  }
}
async function assertText(locator: Locator, expected: string, label: string) {
  const readText = () =>
    locator.evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
          let text = "";
          while (walker.nextNode()) {
            const current = walker.currentNode;
            if (current.nodeType === Node.TEXT_NODE) text += current.textContent ?? "";
            else if ((current as Element).tagName === "BR") text += " ";
            else if ((current as Element).tagName === "IMG") text += (current as Element).getAttribute("alt") ?? "";
          }
          return text;
        })
        .join(" "),
    );
  if (expected === "") {
    if (await locator.count()) expect(normalized(await readText()), label).toBe("");
    return;
  }
  await expect
    .poll(async () => normalized(await readText()), { message: label, timeout: 15_000 })
    .toContain(normalized(expected));
}
async function verifyImageElement(img: Locator, key: string, label: string) {
  const src = await img.getAttribute("src");
  if (src && /^https:\/\//.test(src)) {
    const response = await fetch(src, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Platform image unavailable (${response.status})`);
    await verifyFixtureImage(Buffer.from(await response.arrayBuffer()), key, label);
    return;
  }
  await verifyFixtureImage(await img.screenshot(), key, label);
}
export async function verifyPage(page: Page, s: Materialized, account: Account): Promise<void> {
  const cfg = observerSurface(s.platform, account);
  const roots = page.locator(cfg.root);
  // Logged-out Facebook video permalinks currently render the player without
  // the post's article wrapper. The canonical URL is already checked against
  // the returned ID, so verify the exact page's player as the fallback surface.
  if (
    s.platform === "facebook" &&
    s.media.some((key) => key === "video" || key === "silentVideo") &&
    !(await roots.count())
  ) {
    await verifyContent(page, page.locator("body"), s, account);
    return;
  }
  // A direct permalink can still contain recommendation cards, while media-only
  // posts have no caption marker to identify their card. Thread permalinks also
  // render every segment with the root marker, so the first card is the root.
  const root =
    s.platform === "x"
      ? roots.filter({
          has: page.locator(
            `a[href=${JSON.stringify(new URL(page.url()).pathname)}], a[href=${JSON.stringify(page.url())}]`,
          ),
        })
      : s.thread || !s.expectedText
        ? roots.first()
        : roots.filter({ hasText: s.token });
  if (s.platform === "youtube" || s.platform === "instagram") {
    await expect
      .poll(
        async () => {
          await dismissCookieConsent(page);
          await dismissLoggedOutPrompt(page);
          return root.count();
        },
        { message: "Exactly one platform post must be identified", timeout: 15_000 },
      )
      .toBe(1);
  } else await expect(root, "Exactly one platform post must be identified").toHaveCount(1);
  await expect(root).toBeVisible();
  const author = root.locator(cfg.author);
  const identity = account.username.replace(/^@/, "").toLowerCase();
  await expect
    .poll(
      async () => {
        const names = (await author.allTextContents()).map((t) => t.trim().replace(/^@/, "").toLowerCase());
        const hrefs = await author.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href") ?? ""));
        if (s.platform === "linkedin") {
          const profile = new URL(account.observer.profileUrl);
          const canonical = (url: URL) => decodeURIComponent(url.pathname).replace(/\/$/, "").toLowerCase();
          const expected = canonical(profile);
          if (!/^\/in\/[^/]+$/.test(expected))
            throw new VerificationSetupError("LinkedIn requires the exact configured /in/ author profile URL.");
          return hrefs.some((href) => {
            try {
              const url = new URL(href, page.url());
              return allowedHost("linkedin", url.href, account) && canonical(url) === expected;
            } catch {
              return false;
            }
          });
        }
        return (
          names.includes(identity) ||
          hrefs.some((h) => {
            try {
              const url = new URL(h, page.url());
              if (!allowedHost(s.platform, url.href, account)) return false;
              return (
                url.pathname.replace(/\/$/, "") === new URL(account.observer.profileUrl).pathname.replace(/\/$/, "") ||
                decodeURIComponent(url.pathname)
                  .toLowerCase()
                  .split("/")
                  .some((part) => part.replace(/^@/, "") === identity)
              );
            } catch {
              return false;
            }
          })
        );
      },
      { message: "Platform post must belong to the configured test account", timeout: 15_000 },
    )
    .toBe(true);
  await verifyContent(page, root, s, account);
}
async function verifyContent(page: Page, root: Locator, s: Materialized, account: Account) {
  const cfg = observerSurface(s.platform, account);
  const platformText = s.platform === "threads" ? s.expectedText.replaceAll("#", "") : s.expectedText;
  const textLocator =
    s.platform === "threads"
      ? root.locator("span").filter({ hasText: s.token })
      : s.platform === "facebook" && s.media.some((key) => key === "video" || key === "silentVideo")
        ? root.locator('[dir="auto"]').filter({ hasText: s.token }).last()
        : root.locator(cfg.text);
  await assertText(textLocator, platformText, "Platform caption must match the requested content");
  if (s.platform === "telegram" && s.media.length > 1)
    expect(
      normalized((await root.locator(cfg.text).allTextContents()).join(" ")),
      "Album caption must appear exactly once",
    ).toBe(normalized(s.expectedText));
  if (s.expectedTitle && !cfg.title) throw new Error("NEEDS VERIFICATION: configure a platform title selector.");
  if (s.expectedTitle && cfg.title)
    await assertText(root.locator(cfg.title), s.expectedTitle, "Platform title must match");
  const videoCount = s.media.filter((x) => x === "video" || x === "silentVideo").length;
  const imageCount = s.media.length - videoCount;
  const instagramCarousel = s.platform === "instagram" && imageCount > 1 && !videoCount;
  const webAlbum = s.platform === "telegram" && s.media.length > 1 && account.observer.telegramWeb;
  if (webAlbum) await verifyTelegramWebAlbum(page, root, s, webAlbum.botPeerId);
  if (s.platform === "telegram" && account.observer.telegramWeb && s.options.replyTo)
    await verifyTelegramWebReply(root, account.resources);
  if (s.platform === "telegram" && s.media.length > 1 && !webAlbum) {
    // An album has one caption and a sequence of attachments. Check interleaving too:
    // independently counting images/videos would accept a reordered mixed album.
    const items = root.locator(account.observer.mediaItems ?? `${cfg.images}, ${cfg.video}`);
    await expect(items, "Every Telegram album attachment must be present").toHaveCount(s.media.length);
    for (const [index, key] of s.media.entries()) {
      const item = items.nth(index);
      if (key === "video" || key === "silentVideo")
        expect(await item.evaluate((n) => n instanceof HTMLVideoElement), `Album item ${index + 1} must be video`).toBe(
          true,
        );
      else await verifyFixtureImage(await item.screenshot(), key, `Album item ${index + 1}`);
    }
  }
  if (imageCount && !webAlbum) {
    const images = root.locator(cfg.images);
    // Count only content images, never avatars; carousel controls can provide an exact count
    // when a platform mounts one image at a time (configure fields.mediaCount).
    if (account.observer.fields.mediaCount) await expect(images.first()).toBeVisible();
    else await expect(images).toHaveCount(imageCount);
    await expect(images.first()).toBeVisible();
    // Solid-color original fixtures make order assertions independent of captions and CDN URLs.
    const keys = s.media.filter((key) => key !== "video" && key !== "silentVideo");
    for (let index = 0; index < keys.length; index++) {
      const img = account.observer.nextImage ? images.first() : images.nth(index);
      if (account.observer.fields.mediaCount && !account.observer.nextImage && (await images.count()) !== keys.length)
        throw new Error("NEEDS VERIFICATION: configure nextImage to inspect every carousel slide and its order.");
      await verifyImageElement(img, keys[index], `Carousel photo ${index + 1}`);
      if (instagramCarousel) {
        const next = root.getByRole("button", { name: "Next", exact: true });
        if (index < keys.length - 1) {
          // Instagram can hydrate its cookie dialog after the post has loaded.
          // The dialog hides the background carousel from role queries, even
          // though its images remain in the DOM. Dismiss it during this bounded
          // wait instead of repeatedly navigating before consent appears.
          await expect
            .poll(
              async () => {
                await dismissCookieConsent(page);
                await dismissLoggedOutPrompt(page);
                return next.isVisible();
              },
              { message: "Instagram carousel must expose the next requested slide", timeout: 15_000 },
            )
            .toBe(true);
          await next.click();
          await expect(images.nth(index + 1)).toBeInViewport({ ratio: 0.9 });
        } else await expect(next, "Instagram carousel must not contain extra slides").toHaveCount(0);
      }
      if (account.observer.nextImage && index < keys.length - 1) await page.locator(account.observer.nextImage).click();
    }
    const broken = await images.evaluateAll((nodes) =>
      nodes.some(
        (n) =>
          n instanceof HTMLImageElement &&
          !(n.getAttribute("src") ?? "").startsWith("https://") &&
          (!n.complete || n.naturalWidth === 0),
      ),
    );
    expect(broken, "All rendered post images must have loaded").toBe(false);
  }
  if (videoCount && !webAlbum) {
    const videos = root.locator(cfg.video);
    await expect(videos, "Every requested video must be present").toHaveCount(videoCount);
    for (let index = 0; index < videoCount; index++) {
      const video = videos.nth(index);
      await expect(video).toBeVisible();
      await expect
        .poll(() => video.evaluate((n) => n instanceof HTMLVideoElement && n.readyState >= 2 && n.videoWidth > 0), {
          message: "Video must be processed and playable",
          timeout: 30_000,
        })
        .toBe(true);
      expect(await video.evaluate((n) => (n as HTMLVideoElement).duration), "Fixture video duration").toBeCloseTo(4, 0);
    }
  }
  const required = {
    ...s.expectedFields,
    ...(account.observer.fields.mediaCount ? { mediaCount: s.media.length } : {}),
  };
  for (const [key, value] of Object.entries(required)) {
    if (s.platform === "telegram" && account.observer.telegramWeb && key === "replyTo") continue;
    if (s.platform === "x" && key === "replyToId") {
      // X's permalink conversation renders ancestors in order before the current
      // post. Match the immediate predecessor, never any earlier ancestor or a
      // recommendation appearing below the reply.
      const parent = root.locator("xpath=preceding::article[1]");
      await expect(parent, "X reply must display its immediate parent").toHaveCount(1);
      await expect(parent, "X reply parent must be visible").toBeVisible();
      await expect
        .poll(
          async () => {
            const hrefs = await parent
              .locator("a[href]")
              .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href") ?? ""));
            return [
              ...new Set(
                hrefs.flatMap((href) => {
                  const url = new URL(href, page.url());
                  const match = url.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/);
                  return allowedHost("x", url.href, account) && match ? [match[1]] : [];
                }),
              ),
            ];
          },
          { message: "X reply must be attached to the requested direct parent", timeout: 15_000 },
        )
        .toEqual([String(value)]);
      continue;
    }
    const probe = account.observer.fields[key];
    if (!probe)
      throw new Error(`NEEDS VERIFICATION: ${s.platform}.${key} has no platform-side observation configured.`);
    if (s.platform === "pinterest" && key === "link") {
      const destination = new URL(String(value));
      await expect(
        page.getByRole("button", { name: "Visit", exact: true }),
        "Pinterest Pin must expose its external destination control",
      ).toBeVisible();
      await assertText(
        page.locator("body"),
        destination.hostname,
        "Pinterest Pin must display the requested destination host",
      );
      continue;
    }
    const locator = (probe.scope === "page" ? page : root).locator(probe.selector);
    const expected =
      probe.values?.[JSON.stringify(value)] ??
      probe.values?.[String(value)] ??
      (Array.isArray(value) ? value.join(", ") : String(value));
    if (key === "thumbnailImage") {
      await expect(locator).toBeVisible();
      await verifyImageElement(locator, String(value), "Published thumbnail");
    } else if (probe.count) await expect(locator).toHaveCount(Number(expected));
    else if (probe.attribute) await expect(locator).toHaveAttribute(probe.attribute, expected);
    else await expect(locator).toHaveText(expected);
  }
}
export async function verifyOnPlatform(
  browser: Browser,
  config: LiveConfig,
  s: Materialized,
  account: Account,
  result: PostingResult,
  dir: string,
  window?: VerificationWindow,
): Promise<string[]> {
  if (s.platform === "telegram") assertTelegramObserver(account);
  const linkedinPublic = s.platform === "linkedin" && s.expectedFields.visibility === "PUBLIC";
  const context = await browser.newContext({
    storageState: linkedinPublic ? { cookies: [], origins: [] } : account.observer.storageState,
    locale: "en-US",
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const evidence: string[] = [];
  let lastError: unknown;
  const deadline = Date.now() + config.verifyTimeoutMs;
  try {
    do {
      try {
        const telegramWeb = s.platform === "telegram" ? account.observer.telegramWeb : undefined;
        const url = telegramWeb
          ? `https://web.telegram.org/k/#@${telegramWeb.botUsername}`
          : s.options.publishMode === "draft"
            ? account.observer.inboxUrl!
            : (postUrl(s, account, result) ?? (await discover(page, s, account)));
        if (!allowedHost(s.platform, url, account)) throw new Error("Unexpected platform verification URL");
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (response && response.status() >= 400) throw new Error(`Platform page returned ${response.status()}`);
        await dismissCookieConsent(page);
        await dismissLoggedOutPrompt(page);
        if (
          s.platform === "telegram" &&
          new URL(page.url()).hostname === "t.me" &&
          (await page
            .getByText(/Channel with username .+ not found|Post not found/i)
            .first()
            .isVisible())
        )
          throw new VerificationSetupError(
            "Telegram cannot show this channel/message. Check the verification destination; private chats require Telegram Web. The post receipt is saved—do not republish.",
          );
        if (!allowedHost(s.platform, page.url(), account))
          throw new Error("Platform redirected away from the expected host");
        if (s.options.publishMode !== "draft" && !isPostUrl(s.platform, page.url()))
          throw new Error("Platform redirected to a profile/login page instead of the actual post");
        if (s.options.publishMode !== "draft") assertPostId(s.platform, page.url(), result.postId);
        for (const selector of account.observer.open) await page.locator(selector).click();
        const browserScenario = { ...s, expectedFields: { ...s.expectedFields } };
        let browserAccount = account;
        let linkedinVisibilityProof:
          | {
              source: "unauthenticated-public-view";
              platformPostId: string;
              author: string;
              connectedAccountId: string;
            }
          | undefined;
        if (linkedinPublic) {
          expect(result.postId, "PUBLIC guest proof needs an exact LinkedIn receipt URN").toMatch(
            /^urn:li:(?:share|ugcPost|activity):\d+$/,
          );
          const data = await new SchedulerApi(config).request<{
            accounts: {
              id: string;
              userId: string;
              platform: string;
              platformAccountId: string;
              displayName: string;
            }[];
          }>("/api/v1/accounts");
          const connected = data.accounts.find((a) => a.id === account.id);
          expect(connected, "LinkedIn account must belong to the current test user").toMatchObject({
            id: account.id,
            userId: config.userId,
            platform: "linkedin",
            platformAccountId: account.platformAccountId,
          });
          expect(
            connected?.displayName,
            "LinkedIn guest author needs the connected account's exact display name",
          ).toBeTruthy();
          browserAccount = { ...account, username: connected!.displayName };
          const cfg = { ...surfaces.linkedin, ...account.observer };
          const root = page.locator(cfg.root).filter({ hasText: s.token });
          await expect
            .poll(
              async () =>
                (await root.locator(cfg.author).allTextContents())
                  .map(normalized)
                  .filter((name) => name === normalized(connected!.displayName)).length,
              { message: "Guest post author must exactly match the connected account", timeout: 15_000 },
            )
            .toBe(1);
          delete browserScenario.expectedFields.visibility;
          linkedinVisibilityProof = {
            source: "unauthenticated-public-view",
            platformPostId: result.postId!,
            author: connected!.displayName,
            connectedAccountId: account.id,
          };
        }
        let youtube: YouTubeVerification | undefined;
        if (s.platform === "youtube" && (account.observer.youtubeAccessTokenEnv || account.observer.youtubeReadback)) {
          youtube = await verifyYouTubeMetadata(s, account, result, config);
          for (const key of youtube.verifiedFields) delete browserScenario.expectedFields[key];
        }
        let privateNotice: string | undefined;
        let webMessageId: string | undefined;
        let telegramRoot: Locator | undefined;
        if (telegramWeb) {
          if (!window)
            throw new VerificationSetupError("Telegram Web verification requires the journal's submission timestamps.");
          const matched = await telegramWebMessage(page, browserScenario, account, window);
          webMessageId = matched.id;
          telegramRoot = matched.root;
          await verifyContent(page, telegramRoot, browserScenario, account);
        } else if (youtube?.privateMediaProof) {
          expect(
            Object.keys(browserScenario.expectedFields),
            "Every private video setting must have owner API proof",
          ).toEqual([]);
          const notice = page
            .locator(
              "#movie_player .ytp-error-content-wrap, ytd-watch-flexy #error-screen yt-player-interstitial-renderer",
            )
            .filter({ hasText: /private video|video is private/i })
            .first();
          await expect
            .poll(
              async () => {
                await dismissCookieConsent(page);
                return notice.isVisible();
              },
              { message: "Actual YouTube player must show the private-video view", timeout: 15_000 },
            )
            .toBe(true);
          await expect(notice).toContainText(/private video|video is private/i);
          privateNotice = normalized(await notice.innerText());
        } else await verifyPage(page, browserScenario, browserAccount);
        // Consent can navigate after the initial URL checks. Bind the final
        // observed content to the same platform permalink and receipt as well.
        if (!telegramWeb && s.options.publishMode !== "draft") {
          if (!allowedHost(s.platform, page.url(), account) || !isPostUrl(s.platform, page.url()))
            throw new Error("Platform observation is no longer on the actual post");
          assertPostId(s.platform, page.url(), result.postId);
          if (linkedinPublic)
            expect(
              decodeURIComponent(new URL(page.url()).pathname).replace(/\/$/, ""),
              "Guest view must remain on the exact receipt permalink",
            ).toBe(`/feed/update/${result.postId}`);
        }
        const file = path.join(dir, `${s.token}-platform.png`);
        if (telegramRoot) await telegramRoot.screenshot({ path: file });
        else await page.screenshot({ path: file, fullPage: true });
        evidence.push(file);
        await writeFile(
          path.join(dir, `${s.token}-observed.json`),
          JSON.stringify(
            {
              url: page.url(),
              observedAt: new Date().toISOString(),
              fields: s.expectedFields,
              text: s.expectedText,
              verificationMode: youtube?.privateMediaProof
                ? "private-view/ownerAPI"
                : linkedinVisibilityProof
                  ? "unauthenticated-public-view"
                  : "browser-visual",
              ...(linkedinVisibilityProof ? { linkedinVisibilityProof, observerAuthenticated: false } : {}),
              ...(youtube?.privateMediaProof
                ? {
                    publicVisualProof: false,
                    youtubeOwnerMediaProof: youtube.privateMediaProof,
                    browserPrivateNotice: privateNotice,
                  }
                : {}),
              ...(webMessageId
                ? {
                    telegramWebMessageId: webMessageId,
                    platformPostId: result.postId,
                    botPeerId: telegramWeb!.botPeerId,
                    recipientId: account.platformAccountId,
                  }
                : {}),
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
        return evidence;
      } catch (error) {
        if (error instanceof VerificationSetupError) throw error;
        lastError = error;
        console.log(
          `[${s.id}] Waiting for platform verification (${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s remaining): ${redact((error as Error).message).split("\n")[0]}`,
        );
      }
      if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5000));
    } while (Date.now() < deadline);
    throw new Error(
      `Platform verification failed; do not republish: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  } finally {
    await page
      .screenshot({ path: path.join(dir, `${s.token}-platform-last.png`), fullPage: true, timeout: 5000 })
      .catch(() => {});
    await context.close();
  }
}
