import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { catalog, materialize } from "../src/catalog.js";
import { verifyPage } from "../src/verification/browser.js";
import { account, serve } from "./helpers.js";

const xAccount = account({
  username: "testuser",
  observer: { profileUrl: "https://x.com/testuser", open: [], fields: {} },
});
const imageSources = {
  image: `data:image/jpeg;base64,${(await readFile("fixtures/generated/image.jpg")).toString("base64")}`,
  image2: `data:image/jpeg;base64,${(await readFile("fixtures/generated/image-2.jpg")).toString("base64")}`,
};
const smoke = materialize(
  catalog.find((scenario) => scenario.id === "x.smoke")!,
  xAccount,
  "mcp",
  "x-browser",
  "https://media.example.com",
);
const captionless = materialize(
  catalog.find((scenario) => scenario.id === "x.image-no-caption")!,
  xAccount,
  "mcp",
  "x-browser",
  "https://media.example.com",
);
const textOnly = materialize(
  catalog.find((scenario) => scenario.id === "x.text")!,
  xAccount,
  "mcp",
  "x-browser",
  "https://media.example.com",
);

function legacyPost(
  pathname: string,
  options: { author?: string; caption?: string; image?: keyof typeof imageSources } = {},
) {
  const author = options.author ?? "testuser";
  const caption = options.caption ?? smoke.expectedText;
  return `<article data-testid="tweet">
    <a href="${pathname}">3:18 PM · Sep 6, 2026</a>
    <div data-testid="User-Name"><a href="https://x.com/${author}">${author}</a></div>
    ${caption ? `<div data-testid="tweetText">${caption}</div>` : ""}
    <div data-testid="tweetPhoto"><img alt="post photo" src="${imageSources[options.image ?? "image"]}"></div>
  </article>`;
}

function guestPost(
  pathname: string,
  options: { author?: string; caption?: string; image?: keyof typeof imageSources } = {},
) {
  const author = options.author ?? "testuser";
  const caption = options.caption ?? smoke.expectedText;
  return `<article>
    <a data-timezone href="${pathname}">3:18 PM · Sep 6, 2026</a>
    <a href="https://x.com/${author}"><img alt="@${author}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></a>
    ${caption ? `<div dir="auto">${caption}</div>` : ""}
    <a aria-label="Image" href="${pathname}/photo/1"><img alt="post photo" src="${imageSources[options.image ?? "image"]}"></a>
  </article>`;
}

function guestTextPost(pathname: string, caption: string, author = "testuser") {
  return `<article>
    <a data-timezone href="${pathname}">3:18 PM · Sep 6, 2026</a>
    <a href="https://x.com/${author}"><img alt="@${author}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></a>
    <div dir="auto">${caption}</div>
  </article>`;
}

async function verifyDocument(page: Page, pathname: string, html: string, scenario = smoke) {
  const server = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  try {
    await page.goto(`${server.url}${pathname}`);
    await verifyPage(page, scenario, xAccount);
  } finally {
    await server.close();
  }
}

test("legacy X DOM verifies the exact permalink post, author, caption, and image", async ({ page }) => {
  const pathname = "/testuser/status/legacy-123";
  await verifyDocument(
    page,
    pathname,
    `<main>
      ${legacyPost("/testuser/status/legacy-parent", { author: "otheruser", image: "image2" })}
      ${legacyPost(pathname)}
    </main>`,
  );
});

test("guest X DOM uses the scoped dir-auto caption selector and exact permalink", async ({ page }) => {
  const pathname = "/testuser/status/guest-456";
  await verifyDocument(
    page,
    pathname,
    `<main>
      ${guestPost("/testuser/status/guest-parent", { author: "otheruser", caption: "Parent content", image: "image2" })}
      ${guestPost(pathname)}
    </main>`,
  );
});

test("captionless guest X post selects the exact article among media-only cards", async ({ page }) => {
  const pathname = "/testuser/status/captionless-789";
  await verifyDocument(
    page,
    pathname,
    `<main>
      ${guestPost("/testuser/status/captionless-parent", { author: "otheruser", caption: "Unrelated", image: "image2" })}
      ${guestPost(pathname, { caption: "" })}
    </main>`,
    captionless,
  );
});

test("guest X reply permalink selects the direct reply instead of its parent", async ({ page }) => {
  const pathname = "/testuser/status/reply-246";
  await verifyDocument(
    page,
    pathname,
    `<main>
      ${guestPost("/testuser/status/reply-parent", { caption: "Ancestor reply with a different caption", image: "image2" })}
      <article>
        <a data-timezone href="${pathname}">3:20 PM · Sep 6, 2026</a>
        <a href="https://x.com/testuser"><img alt="@testuser" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></a>
        <div dir="auto">${textOnly.expectedText}</div>
      </article>
    </main>`,
    textOnly,
  );
});

test("guest X reply verifies the immediate parent ID across three conversation articles", async ({ page }) => {
  const pathname = "/testuser/status/3003";
  const scenario = { ...textOnly, expectedFields: { replyToId: "3002" } };
  await verifyDocument(
    page,
    pathname,
    `<main>
      ${guestTextPost("https://x.com/testuser/status/3001", "Earlier ancestor")}
      ${guestTextPost("https://x.com/testuser/status/3002", "Direct parent")}
      ${guestTextPost(pathname, textOnly.expectedText)}
    </main>`,
    scenario,
  );
});

test("guest X reply rejects an earlier ancestor when it is not the immediate parent", async ({ page }) => {
  test.setTimeout(45_000);
  const pathname = "/testuser/status/4003";
  const scenario = { ...textOnly, expectedFields: { replyToId: "4001" } };
  await expect(
    verifyDocument(
      page,
      pathname,
      `<main>
        ${guestTextPost("https://x.com/testuser/status/4001", "Earlier ancestor")}
        ${guestTextPost("https://x.com/testuser/status/4002", "Direct parent")}
        ${guestTextPost(pathname, textOnly.expectedText)}
      </main>`,
      scenario,
    ),
  ).rejects.toThrow("requested direct parent");
});

for (const fault of ["wrong author", "wrong content", "wrong media"] as const) {
  test(`guest X verification rejects ${fault}`, async ({ page }) => {
    test.setTimeout(45_000);
    const pathname = `/testuser/status/fault-${fault.replaceAll(" ", "-")}`;
    const options =
      fault === "wrong author"
        ? { author: "otheruser" }
        : fault === "wrong content"
          ? { caption: "A different caption" }
          : { image: "image2" as const };
    const expectedError =
      fault === "wrong author"
        ? /post must belong to the configured test account/
        : fault === "wrong content"
          ? /Platform caption must match/
          : /wrong fixture\/color/;
    await expect(verifyDocument(page, pathname, guestPost(pathname, options))).rejects.toThrow(expectedError);
  });
}
