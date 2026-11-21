import { test, expect } from "@playwright/test";
import { verifyPage } from "../src/verification/browser.js";
import { materialize, catalog } from "../src/catalog.js";
import { account } from "./helpers.js";

const profileUrl = "https://www.pinterest.com/eclompton/";
const legacyPinterestAccount = account({
  username: "eclompton",
  observer: {
    profileUrl,
    root: '[data-test-id="pin-closeup"], [data-test-id="CloseupMainPin"]',
    author: '[data-test-id="creator-profile-link"]',
    text: '[data-test-id="pin-description"], [data-test-id="main-pin-description-text"]',
    images: '[data-test-id="pin-closeup-image"] img',
    video: "video",
    open: [],
    fields: {},
  },
});

function scenario(id: string) {
  return materialize(
    catalog.find((row) => row.id === id)!,
    legacyPinterestAccount,
    "mcp",
    "pinterest-observer",
    "https://media.example.com",
  );
}

test("Pinterest observer migrates shipped selectors to the current pin DOM", async ({ page }) => {
  const s = scenario("pinterest.smoke");
  await page.setContent(`<div data-test-id="closeup-container">
    <a data-test-id="creator-profile-link" href="${profileUrl}">Edmund Clompton</a>
    <div data-test-id="structured-description">${s.expectedText}</div>
    <div data-test-id="closeup-image-main"><img alt="fixture" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Crect width='160' height='160' fill='%232596be'/%3E%3C/svg%3E" style="width:160px;height:160px"></div>
  </div>`);
  await verifyPage(page, s, legacyPinterestAccount);
});

test("Pinterest observer verifies the destination URL and displayed alt text", async ({ page }) => {
  test.setTimeout(30_000);
  const pinterestAccount = account({
    username: "eclompton",
    observer: {
      profileUrl,
      root: '[data-test-id="pin-closeup"], [data-test-id="CloseupMainPin"]',
      author: '[data-test-id="creator-profile-link"]',
      text: '[data-test-id="pin-description"], [data-test-id="main-pin-description-text"]',
      images: '[data-test-id="pin-closeup-image"] img',
      video: "video",
      open: [],
      fields: {
        link: { selector: '[data-test-id="main-pin-section-visit-button"] button', scope: "post" },
        altText: { selector: '[data-test-id="pin-closeup-image"] img', attribute: "alt", scope: "post" },
      },
    },
  });
  const s = materialize(
    catalog.find((row) => row.id === "pinterest.metadata")!,
    pinterestAccount,
    "mcp",
    "pinterest-observer-metadata",
    "https://media.example.com",
  );
  const document = (destination: string, altText = `This contains: ${s.expectedFields.altText}`) =>
    `<div data-test-id="closeup-container"><h1>${s.expectedTitle}</h1>
      <div data-test-id="closeup-image-main"><img alt="${altText}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Crect width='160' height='160' fill='%232596be'/%3E%3C/svg%3E" style="width:160px;height:160px"></div>
      <a data-test-id="visit-button" href="${destination}">Visit site</a>
      <a data-test-id="creator-profile-link" href="${profileUrl}">Edmund Clompton</a>
      <div data-test-id="structured-description">${s.expectedText}</div></div>`;

  await page.setContent(document("https://example.com/?utm_source=Pinterest&utm_medium=organic"));
  await verifyPage(page, s, pinterestAccount);

  await page.setContent(document("https://unrelated.example/"));
  await expect(verifyPage(page, s, pinterestAccount)).rejects.toThrow(
    "Pinterest Pin must preserve the requested external destination",
  );

  await page.setContent(document("https://example.com/", "A different description"));
  await expect(verifyPage(page, s, pinterestAccount)).rejects.toThrow(
    "Pinterest Pin must preserve the requested alt text",
  );
});
