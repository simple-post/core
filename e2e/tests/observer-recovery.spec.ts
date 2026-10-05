import { test, expect } from "@playwright/test";
import { assertObserverReady, verifyPage } from "../src/verification/browser.js";
import { VerificationHttpError, VerificationSetupError, verificationRetry } from "../src/verification/retry.js";
import {
  formerThreadsReplySelector,
  threadsPostPath,
  threadsDirectParentPaths,
  threadsPostRoot,
} from "../src/verification/threads.js";
import { account } from "./helpers.js";
import { catalog, materialize } from "../src/catalog.js";

test("Pinterest blocking login form stops verification with session recovery instructions", async ({ page }) => {
  await page.setContent(
    '<div role="dialog">Welcome to Pinterest<form><input type="password"><button>Log in</button></form></div><button>Accept all</button>',
  );
  await expect(assertObserverReady(page, "pinterest")).rejects.toThrow(VerificationSetupError);
  await expect(assertObserverReady(page, "pinterest")).rejects.toThrow("yarn e2e:auth --chrome");
});
test("Pinterest public login button and hidden form do not require a session", async ({ page }) => {
  await page.setContent('<button>Log in</button><form hidden><input type="password"></form>');
  await assertObserverReady(page, "pinterest");
});

const currentPath = "/@testuser/post/current";
const parentPath = "/@testuser/post/parent";
const a = account({
  observer: {
    profileUrl: "https://www.threads.com/@testuser",
    open: [],
    fields: {
      replyToId: {
        selector: formerThreadsReplySelector,
        attribute: "href",
        scope: "page",
        values: { "12345": parentPath },
      },
    },
  },
});
const s = materialize(
  catalog.find((row) => row.id === "threads.reply")!,
  a,
  "mcp",
  "offline",
  "https://media.example.com",
);
function card(path: string, text: string) {
  return `<div data-pressable-container="true"><a href="/@testuser">testuser</a><a href="${path}"><time>now</time></a><span>${text.replaceAll("#", "")}</span></div>`;
}
async function conversation(page: import("@playwright/test").Page, parent = parentPath, reply = currentPath) {
  await page.route("https://www.threads.com/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<a href="${currentPath}">Thread</a><main><div data-pagelet="threads_post_page_0">${card("/@testuser/post/grandparent", "grandparent")}</div><div data-pagelet="threads_post_page_1">${card(parent, "parent")}</div><div data-pagelet="threads_post_page_2">${card(reply, s.expectedText)}</div></main><aside>${card(parentPath, s.expectedText)}</aside>`,
    }),
  );
  await page.goto(`https://www.threads.com${currentPath}`);
}
test("Threads reply scopes its exact permalink and immediate parent, excluding header and recommendations", async ({
  page,
}) => {
  await conversation(page);
  await verifyPage(page, s, a);
});
test("Threads root matches captionless posts by timestamp permalink, including net links with queries", async ({
  page,
}) => {
  await conversation(page, parentPath, `https://www.threads.net${currentPath}?source=test`);
  const root = threadsPostRoot(page, page.locator('[data-pressable-container="true"]'));
  await expect(root).toHaveCount(1);
  expect(await threadsDirectParentPaths(page, root)).toEqual([parentPath]);
});
test("Threads wrong direct parent cannot pass via grandparent or a recommendation", async ({ page }) => {
  await conversation(page, "/@testuser/post/wrong");
  await expect(verifyPage(page, s, a)).rejects.toThrow("requested direct parent");
});
test("Threads a similar permalink prefix cannot identify the saved post", async ({ page }) => {
  await conversation(page, parentPath, currentPath + "-other");
  await expect(threadsPostRoot(page, page.locator('[data-pressable-container="true"]'))).toHaveCount(0);
});
test("Threads intentional custom reply probe is retained", async ({ page }) => {
  await conversation(page);
  await page.locator('main [data-pagelet="threads_post_page_2"]').evaluate((node) => {
    node.insertAdjacentHTML("beforeend", '<span class="custom-parent">12345</span>');
  });
  await verifyPage(page, s, {
    ...a,
    observer: { ...a.observer, fields: { replyToId: { selector: ".custom-parent", scope: "page" } } },
  });
});
test("Threads explicit unavailable page is retryable within the budget, never proof of success", async ({ page }) => {
  await page.setContent("<h1>Not all who wander are lost, but this page is</h1>");
  const error = await verifyPage(page, s, a).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(VerificationHttpError);
  expect((error as Error).message).toContain("saved post permalink is unavailable");
  expect(
    verificationRetry({ error, now: 0, deadline: 10000, lastNavigation: 0, pollsSinceNavigation: 0, rateLimits: 0 }),
  ).toEqual({ retry: true, delayMs: 2000, reload: true });
});
test("Threads permalink normalization excludes external hosts, media routes and credentials", () => {
  expect(threadsPostPath(`https://www.threads.net${parentPath}/?test=1`)).toBe(parentPath);
  for (const value of [
    `https://evil.example${parentPath}`,
    parentPath + "/media",
    `https://secret@threads.com${parentPath}`,
  ])
    expect(threadsPostPath(value)).toBeUndefined();
});
