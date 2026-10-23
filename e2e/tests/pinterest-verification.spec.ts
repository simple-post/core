import { test } from "@playwright/test";
import { verifyPage } from "../src/verification/browser.js";
import { materialize, catalog } from "../src/catalog.js";
import { account } from "./helpers.js";

test("Pinterest current closeup confines caption, author and media checks to the actual pin", async ({ page }) => {
  const owner = account({
    username: "eclompton",
    observer: { profileUrl: "https://www.pinterest.com/eclompton/", open: [], fields: {} },
  });
  const scenario = materialize(
    catalog.find((s) => s.id === "pinterest.uploads-image")!,
    owner,
    "ui",
    "offline",
    "https://media.example.com",
  );
  await page.setContent(
    `<div data-test-id="closeup-body"><a data-test-id="creator-profile-link" href="https://www.pinterest.com/eclompton/">Edmund Clompton</a><div data-test-id="structured-description">${scenario.expectedText}</div><div data-test-id="closeup-image-main"><div style="width:160px;height:160px;background:#2596be" id="photo"></div></div></div><aside><a data-test-id="creator-profile-link" href="/impostor/">Other author</a><div data-test-id="structured-description">Unrelated recommendation</div></aside>`,
  );
  // Use an image element with the fixture color, as the actual closeup renders.
  await page.locator("#photo").evaluate((node) => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#2596be";
    ctx.fillRect(0, 0, 160, 160);
    const img = new Image();
    img.src = canvas.toDataURL();
    node.replaceWith(img);
  });
  await verifyPage(page, scenario, owner);
});
