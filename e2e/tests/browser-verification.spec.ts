import { test, expect } from "@playwright/test";
import { verifyPage } from "../src/verification/browser.js";
import { materialize, catalog } from "../src/catalog.js";
import { account } from "./helpers.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
const a = account({
  observer: {
    profileUrl: "https://x.com/testuser",
    root: "article",
    author: ".author",
    text: ".caption",
    title: ".title",
    images: ".photo",
    video: "video",
    open: [],
    fields: {
      privacyLevel: { selector: ".privacy", scope: "post" },
      autoAddMusic: { selector: ".music", attribute: "data-enabled", scope: "post" },
    },
  },
});
const s = materialize(
  catalog.find((c) => c.id === "tiktok.photos-2-music-false-custom")!,
  a,
  "mcp",
  "r",
  "https://media.example.com",
);
function document(
  options: { author?: string; caption?: string; privacy?: string; music?: string; reverse?: boolean } = {},
) {
  const colors = options.reverse ? ["#f6be00", "#2596be"] : ["#2596be", "#f6be00"];
  return `<article><a class="author">${options.author ?? "testuser"}</a><h1 class="title">${s.expectedTitle}</h1><p class="caption">${options.caption ?? s.expectedText}</p><span class="privacy">${options.privacy ?? "PUBLIC_TO_EVERYONE"}</span><span class="music" data-enabled="${options.music ?? "false"}"></span>${colors.map((color) => `<div class="photo" style="display:inline-block;width:160px;height:160px;background:${color}"></div>`).join("")}</article>`;
}
test("verifies real browser DOM, exact author, text, media order, privacy, and false music", async ({ page }) => {
  await page.setContent(document());
  await verifyPage(page, s, a);
});
test("wrong music or privacy cannot pass by merely showing a post", async ({ page }) => {
  test.setTimeout(45_000);
  await page.setContent(document({ music: "true" }));
  await expect(verifyPage(page, s, a)).rejects.toThrow();
  await page.setContent(document({ privacy: "SELF_ONLY" }));
  await expect(verifyPage(page, s, a)).rejects.toThrow();
});
test("wrong carousel order fails", async ({ page }) => {
  await page.setContent(document({ reverse: true }));
  await expect(verifyPage(page, s, a)).rejects.toThrow("wrong fixture/color");
});
test("a login page with the requested text is not a post", async ({ page }) => {
  await page.setContent(`<main>Sign in ${s.expectedText} testuser</main>`);
  await expect(verifyPage(page, s, a)).rejects.toThrow();
});
test("similar usernames cannot satisfy exact account verification", async ({ page }) => {
  await page.setContent(document({ author: "nottestuser" }));
  await expect(verifyPage(page, s, a)).rejects.toThrow();
});
test("a nonempty caption fails an explicitly empty-caption scenario", async ({ page }) => {
  await page.setContent(document());
  await expect(verifyPage(page, { ...s, expectedText: "" }, a)).rejects.toThrow();
});

const telegramAccount = account({
  observer: {
    profileUrl: "https://t.me/testuser",
    root: "article",
    author: ".author",
    text: ".caption",
    images: ".photo",
    video: "video",
    open: [],
    fields: {},
  },
});
async function albumDocument(media: string[], caption: string) {
  const video = (await readFile(path.resolve("fixtures/generated/video.mp4"))).toString("base64");
  return `<article><a class="author">testuser</a><p class="caption">${caption}</p>${media
    .map((key) =>
      key === "video" || key === "silentVideo"
        ? `<video style="width:160px;height:160px" muted autoplay loop src="data:video/mp4;base64,${video}"></video>`
        : `<div class="photo" style="display:inline-block;width:160px;height:160px;background:${key === "image" ? "#2596be" : "#f6be00"}"></div>`,
    )
    .join("")}</article>`;
}
for (const id of ["album-photos", "album-videos", "album-mixed", "album-mixed-no-caption", "album-10"])
  test(`Telegram ${id} verifies every attachment in the browser`, async ({ page }) => {
    const scenario = materialize(
      catalog.find((c) => c.id === `telegram.${id}`)!,
      telegramAccount,
      "mcp",
      "r",
      "https://media.example.com",
    );
    await page.setContent(await albumDocument(scenario.media, scenario.expectedText));
    await verifyPage(page, scenario, telegramAccount);
  });
for (const fault of ["truncated", "mixed-order", "duplicate-caption", "second-video-broken"])
  test(`Telegram album verification catches ${fault}`, async ({ page }) => {
    const scenario = materialize(
      catalog.find((c) => c.id === `telegram.album-${fault === "second-video-broken" ? "videos" : "mixed"}`)!,
      telegramAccount,
      "mcp",
      "r",
      "https://media.example.com",
    );
    const media =
      fault === "truncated"
        ? scenario.media.slice(0, 1)
        : fault === "mixed-order"
          ? ["image", "image2", "video"]
          : scenario.media;
    await page.setContent(
      await albumDocument(
        media,
        fault === "duplicate-caption" ? `${scenario.expectedText} ${scenario.expectedText}` : scenario.expectedText,
      ),
    );
    if (fault === "second-video-broken") {
      await page
        .locator("video")
        .nth(1)
        .evaluate((n) => {
          (n as HTMLVideoElement).removeAttribute("src");
          (n as HTMLVideoElement).load();
        });
      test.setTimeout(45_000);
    }
    await expect(verifyPage(page, scenario, telegramAccount)).rejects.toThrow();
  });
