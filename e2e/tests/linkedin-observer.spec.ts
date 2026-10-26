import { test } from "@playwright/test";
import { materialize, catalog } from "../src/catalog.js";
import { verifyPage } from "../src/verification/browser.js";
import { account } from "./helpers.js";

const profileUrl = "https://www.linkedin.com/in/edmund-clompton-510094375/";
const linkedinAccount = account({
  username: "edmund.clompton@gmail.com",
  observer: {
    profileUrl,
    root: 'div[role="listitem"]',
    author: 'a[href*="/in/edmund-clompton-510094375/"]',
    text: "p",
    images: 'img[alt="Bild anzeigen"]',
    video: "video",
    open: [],
    fields: {},
  },
});

test("LinkedIn ignores author metadata when verifying an empty-caption image post", async ({ page }) => {
  const scenario = materialize(
    catalog.find((row) => row.id === "linkedin.image-no-caption")!,
    linkedinAccount,
    "ui",
    "linkedin-empty-caption",
    "https://media.example.com",
  );
  await page.setContent(`<div role="listitem">
    <a href="${profileUrl}">Edmund Clompton</a>
    <p>Senior Engineer at Clompton GmbH · 2 min</p>
    <div class="update-components-image"><img alt="Bild anzeigen" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Crect width='160' height='160' fill='%232596be'/%3E%3C/svg%3E" style="width:160px;height:160px"></div>
  </div>`);
  await verifyPage(page, scenario, linkedinAccount);
});
