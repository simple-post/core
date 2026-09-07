import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyTelegramWebAlbum } from "../src/verification/telegram.js";
import { materialize, catalog } from "../src/catalog.js";
import { account, config } from "./helpers.js";
import type { MediaKey } from "../src/types.js";

async function fixture(page: Page, keys: MediaKey[], fault?: string) {
  const cfg = config();
  const video = (await readFile(path.join(cfg.fixtureDir, "video.mp4"))).toString("base64");
  const blue = (await readFile(path.join(cfg.fixtureDir, "image.jpg"))).toString("base64");
  const yellow = (await readFile(path.join(cfg.fixtureDir, "image-2.jpg"))).toString("base64");
  const cards = keys
    .map(
      (key, i) => `<div class="album-item"><div class="album-item-media" data-index="${i}" data-kind="${key}">
    ${key === "video" || key === "silentVideo" ? '<button class="video-play">Play</button><span class="video-time">0:04</span>' : ""}
    <img class="media-photo" style="width:160px;height:160px" src="data:image/jpeg;base64,${key === "image2" ? yellow : blue}">
  </div></div>`,
    )
    .join("");
  await page.setContent(`<article><div class="attachment" style="display:flex">${cards}</div></article>
    <script>
      window.opened=[];
      document.querySelectorAll('.album-item-media').forEach(card=>card.onclick=()=>{
        if (!card.querySelector('.video-play')) return;
        const index=Number(card.dataset.index); window.opened.push(index);
        const viewer=document.createElement('div');viewer.className='media-viewer-whole active';
        viewer.style='position:fixed;inset:0;background:white';
        viewer.innerHTML='<div class="media-viewer-userpic" data-peer-id="876"></div><div class="media-viewer-mover active"></div>';
        const video=document.createElement('video');video.muted=true;video.autoplay=true;video.loop=true;video.style='width:200px;height:200px';
        if(!(${JSON.stringify(fault)}==='broken' && index===1)) video.src='data:video/mp4;base64,${video}';
        if(${JSON.stringify(fault)}==='paused' && index===1) video.autoplay=false;
        viewer.querySelector('.media-viewer-mover').append(video);document.body.append(viewer);
      });
      document.addEventListener('keydown',e=>{
        if(e.key!=='Escape') return;
        const viewer=document.querySelector('.media-viewer-whole');
        if (${JSON.stringify(fault)} !== 'closing') {viewer?.remove();return;}
        // The active class disappears before Telegram's dimming backdrop finishes closing.
        viewer.classList.remove('active'); viewer.innerHTML=''; viewer.style.background='rgba(0,0,0,0.5)';
        setTimeout(()=>viewer.remove(), 500);
      });
    </script>`);
}
for (const id of ["album-videos", "album-mixed", "album-photos"]) {
  test(`Telegram lazy viewer verifies every attachment in ${id}`, async ({ page }) => {
    const s = materialize(catalog.find((c) => c.id === `telegram.${id}`)!, account(), "ui", "r", config().mediaBaseUrl);
    await fixture(page, s.media);
    expect(await page.locator("video").count()).toBe(0);
    await verifyTelegramWebAlbum(page, page.locator("article"), s, "876", 2000);
    expect(await page.evaluate(() => (window as unknown as { opened: number[] }).opened)).toEqual(
      s.media.flatMap((key, i) => (key === "video" || key === "silentVideo" ? [i] : [])),
    );
    await expect(page.locator(".media-viewer-whole")).toHaveCount(0);
  });
}
for (const fault of ["broken", "paused"]) {
  test(`Telegram does not accept a video thumbnail when the second video is ${fault}`, async ({ page }) => {
    const s = materialize(
      catalog.find((c) => c.id === "telegram.album-videos")!,
      account(),
      "ui",
      "r",
      config().mediaBaseUrl,
    );
    await fixture(page, s.media, fault);
    await expect(verifyTelegramWebAlbum(page, page.locator("article"), s, "876", 1500)).rejects.toThrow(
      fault === "broken" ? "must load and be playable" : "must actually play",
    );
    await expect(page.locator(".media-viewer-whole")).toHaveCount(0);
  });
}
test("Telegram rejects reordered mixed attachments even though all thumbnails are images", async ({ page }) => {
  const s = materialize(
    catalog.find((c) => c.id === "telegram.album-mixed")!,
    account(),
    "ui",
    "r",
    config().mediaBaseUrl,
  );
  await fixture(page, ["video", "image", "image2"]);
  await expect(verifyTelegramWebAlbum(page, page.locator("article"), s, "876", 1500)).rejects.toThrow(
    "Album item 1 must be image",
  );
});

for (const wrongPhoto of [false, true])
  test(`Telegram waits for the closing backdrop before checking the next photo (wrong photo: ${wrongPhoto})`, async ({
    page,
  }) => {
    const s = materialize(
      catalog.find((c) => c.id === "telegram.album-mixed")!,
      account(),
      "ui",
      "r",
      config().mediaBaseUrl,
    );
    await fixture(page, wrongPhoto ? ["image", "video", "image"] : s.media, "closing");
    const verify = verifyTelegramWebAlbum(page, page.locator("article"), s, "876", 2000);
    if (wrongPhoto) await expect(verify).rejects.toThrow("Album item 3 has the wrong fixture/color");
    else await verify;
    await expect(page.locator(".media-viewer-whole")).toHaveCount(0);
  });

for (const fault of ["none", "truncated", "wrong-last-photo"]) {
  test(`Telegram loads a ten-item album split across history batches: ${fault}`, async ({ page }) => {
    const s = materialize(
      catalog.find((c) => c.id === "telegram.album-10")!,
      account(),
      "mcp",
      "r",
      config().mediaBaseUrl,
    );
    const keys = [...s.media];
    if (fault === "wrong-last-photo") keys[9] = "image";
    await fixture(page, keys);
    await page.evaluate((fault) => {
      const article = document.querySelector("article")!;
      const bubbles = document.createElement("div");
      bubbles.className = "bubbles";
      const scroll = document.createElement("div");
      scroll.className = "bubbles-scrollable";
      scroll.style = "height:250px;overflow:auto";
      article.before(bubbles);
      bubbles.append(scroll);
      scroll.append(article);
      const rest = [...article.querySelectorAll(".album-item")].slice(6);
      rest.forEach((n) => n.remove());
      scroll.addEventListener(
        "wheel",
        () => {
          if (fault !== "truncated") article.querySelector(".attachment")!.append(...rest);
        },
        { once: true },
      );
    }, fault);
    await expect(page.locator(".album-item")).toHaveCount(6);
    const verification = verifyTelegramWebAlbum(page, page.locator("article"), s, "876", 2000);
    if (fault === "truncated")
      await expect(verification).rejects.toThrow("Every Telegram album attachment must be present");
    else if (fault === "wrong-last-photo")
      await expect(verification).rejects.toThrow("Album item 10 has the wrong fixture/color");
    else {
      await verification;
      await expect(page.locator(".album-item")).toHaveCount(10);
    }
  });
}
