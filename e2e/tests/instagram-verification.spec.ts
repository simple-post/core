import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { account } from "./helpers.js";
import { catalog, materialize } from "../src/catalog.js";
import { verifyPage } from "../src/verification/browser.js";

const a = account({ observer: { profileUrl: "https://www.instagram.com/testuser/", open: [], fields: {} } });
const s = materialize(
  catalog.find((s) => s.id === "instagram.carousel")!,
  a,
  "ui",
  "offline",
  "https://media.example.com",
);
for (const kind of [
  "prompt-present",
  "prompt-dismissed",
  "cookie-overlay",
  "saved-positional-root",
  "reversed",
  "extra-slide",
] as const) {
  test(`Instagram carousel ${kind} keeps exact post scope, count and order`, async ({ page }) => {
    let photos = await Promise.all(
      ["image.jpg", "image-2.jpg"].map(async (name) =>
        (await readFile(`fixtures/generated/${name}`)).toString("base64"),
      ),
    );
    if (kind === "reversed") photos.reverse();
    if (kind === "extra-slide") photos.push(photos[0]);
    await page.setContent(`<main>${kind === "prompt-present" ? "<div><div>Sign up</div></div>" : ""}<div><div><a href="/testuser/">testuser</a><span>${s.expectedText.replace("#simplepost", '<a href="/explore/tags/simplepost/">#simplepost</a>')}</span>
      <div style="position:relative;width:200px;height:200px;overflow:hidden"><div id="slides" style="display:flex;width:max-content">${photos.map((p) => `<img alt="Photo by testuser" width="200" height="200" src="data:image/jpeg;base64,${p}">`).join("")}</div></div>
      <button aria-label="Next" onclick="window.slide=(window.slide||0)+1;document.querySelector('#slides').style.transform='translateX(-'+(window.slide*200)+'px)';if(window.slide===${photos.length - 1})this.remove()">Next</button></div>
      <div>More posts <img alt="Photo by unrelated" src="data:image/jpeg;base64,${photos[0]}"></div></div></main>`);
    if (kind === "cookie-overlay")
      await page.evaluate(() => {
        document.querySelector("main")!.setAttribute("aria-hidden", "true");
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.innerHTML = "<button>Allow all cookies</button>";
        dialog.querySelector("button")!.onclick = () => {
          document.querySelector("main")!.removeAttribute("aria-hidden");
          dialog.remove();
        };
        document.body.append(dialog);
      });
    if (kind === "reversed" || kind === "extra-slide") await expect(verifyPage(page, s, a)).rejects.toThrow();
    else
      await verifyPage(
        page,
        s,
        kind === "saved-positional-root"
          ? { ...a, observer: { ...a.observer, root: "main>div:nth-child(2)>div:first-child" } }
          : a,
      );
  });
}
