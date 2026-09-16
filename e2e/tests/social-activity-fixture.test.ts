import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { configuredAppRoot } from "../src/app-root.js";

const schedulerRoot = path.join(configuredAppRoot(), "scheduler");
const schedulerRequire = createRequire(path.join(schedulerRoot, "package.json"));
const { build } = schedulerRequire("esbuild") as typeof import("esbuild");
const postcss = schedulerRequire("postcss") as (plugins: import("postcss").Plugin[]) => {
  process(input: string, options: { from: string }): Promise<{ css: string }>;
};
const tailwind = schedulerRequire("@tailwindcss/postcss") as (options?: { base?: string }) => import("postcss").Plugin;
let bundle: string;
let css: string;

const account = { id: "account-x", platform: "x", displayName: "SimplePost", username: "simplepost" };
const items = [
  {
    id: "comment-1",
    kind: "comment",
    platform: "x",
    accountId: account.id,
    accountName: account.displayName,
    accountUsername: account.username,
    postId: "post-1",
    nativeUrl: "https://x.com/simplepost/status/1",
    nativePostId: "tweet-1",
    body: "Could you share the source?",
    createdAt: "2026-09-14T11:00:00.000Z",
    author: { name: "Mira", username: "mira" },
    canReply: true,
  },
  {
    id: "mention-1",
    kind: "mention",
    platform: "threads",
    accountId: "account-threads",
    accountName: "SimplePost on Threads",
    accountUsername: "simplepost",
    nativeUrl: "https://www.threads.net/@reader/post/abc",
    nativePostId: "thread-1",
    body: "@simplepost this was useful",
    createdAt: "2026-09-14T10:00:00.000Z",
    author: { name: "Ari" },
    canReply: true,
  },
];

test.beforeAll(async () => {
  const [source, globals] = await Promise.all([
    build({
      absWorkingDir: schedulerRoot,
      stdin: {
        resolveDir: schedulerRoot,
        loader: "tsx",
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { SocialInbox, PostSocialPanel } from './components/social-activity';
          const component = location.pathname === '/post' ? <PostSocialPanel postId="post-1" /> : <SocialInbox />;
          createRoot(document.getElementById('root')).render(component);
        `,
      },
      bundle: true,
      write: false,
      format: "iife",
      define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
      plugins: [
        {
          name: "fixture-next-link",
          setup(builder) {
            builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents:
                "import React from 'react'; export default function Link(props) { return React.createElement('a', props); }",
              loader: "js",
              resolveDir: schedulerRoot,
            }));
          },
        },
      ],
    }),
    readFile(path.join(schedulerRoot, "app/globals.css"), "utf8"),
  ]);
  bundle = source.outputFiles[0].text;
  css = (
    await postcss([tailwind({ base: schedulerRoot })]).process(globals, {
      from: path.join(schedulerRoot, "app/globals.css"),
    })
  ).css;
});

async function mount(page: Page, pathname = "/social") {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("https://social.test/**", (route) => {
    if (route.request().resourceType() === "document") {
      return route.fulfill({
        contentType: "text/html",
        // The app shell renders dark-only (`<html class="dark">`), so the fixture must match it.
        body: `<html class="dark"><head><style>${css}</style></head><body><div id="root"></div></body></html>`,
      });
    }
    return route.abort();
  });
  await page.goto(`https://social.test${pathname}`);
  return browserErrors;
}

test("social inbox renders real styled cards, filters, pagination, and reply outcomes offline", async ({
  page,
}, testInfo) => {
  const browserErrors = await mount(page);
  let commentSent = false;
  let replyRequests = 0;
  await page.route("**/api/v1/accounts", (route) =>
    route.fulfill({
      json: {
        accounts: [
          account,
          { ...account, id: "account-threads", platform: "threads", displayName: "SimplePost on Threads" },
        ],
      },
    }),
  );
  await page.route("**/api/v1/social/inbox/refresh", (route) =>
    route.fulfill({
      json: {
        hasMore: true,
        accounts: [
          {
            accountId: account.id,
            platform: "x",
            processed: 1,
            mentionsProcessed: true,
            hasMore: true,
            coverage: "Recent X mentions only.",
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/social/inbox?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const rendered = commentSent ? [{ ...items[0], reply: { status: "sent", body: "Here it is" } }, items[1]] : items;
    return route.fulfill({
      json: cursor
        ? { items: [{ ...items[1], id: "mention-2", body: "Another account mention" }] }
        : { items: rendered, nextCursor: "next-page" },
    });
  });
  await page.route("**/api/v1/social/items/*/reply", async (route) => {
    replyRequests += 1;
    const payload = route.request().postDataJSON() as { body: string; idempotencyKey: string };
    expect(payload.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{12,160}$/);
    if (replyRequests === 1) {
      commentSent = true;
      return route.fulfill({ json: { replyId: "reply-1", status: "sent" } });
    }
    return route.fulfill({ status: 503, json: { error: "Test provider temporarily unavailable" } });
  });
  await page.addScriptTag({ content: bundle });

  await expect(page.getByRole("heading", { name: "Comments and mentions" })).toBeVisible();
  await expect(page.getByText("Could you share the source?")).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).first().click();
  const sync = page.getByRole("region", { name: "Last sync" });
  await expect(sync).toContainText("1 post checked");
  await expect(sync).toContainText("Recent X mentions only.");
  await expect(sync.getByRole("button", { name: "Load older activity" })).toBeVisible();

  await page.waitForTimeout(700);
  await page.screenshot({ path: testInfo.outputPath("social-inbox-desktop.png"), fullPage: true });

  await page.getByRole("combobox", { name: "Filter by account" }).click();
  await page.getByRole("option", { name: `${account.displayName} · X` }).click();
  await expect(page.getByText("Could you share the source?")).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Another account mention")).toBeVisible();

  const firstComposer = page.locator("article").filter({ hasText: "Could you share the source?" });
  await firstComposer.getByRole("button", { name: "Reply" }).click();
  await firstComposer.getByRole("textbox").fill("Here it is");
  await firstComposer.getByRole("button", { name: "Send reply" }).click();
  await expect(firstComposer.getByText("Reply sent")).toBeVisible();

  const secondComposer = page.locator("article").filter({ hasText: "@simplepost this was useful" });
  await secondComposer.getByRole("button", { name: "Reply" }).click();
  await secondComposer.getByRole("textbox").fill("Thank you");
  await secondComposer.getByRole("button", { name: "Send reply" }).click();
  await expect(secondComposer.getByRole("textbox")).toHaveValue("Thank you");
  await expect(secondComposer.getByRole("alert")).toContainText("Test provider temporarily unavailable");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("social-inbox-mobile.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("post activity uses cached metric cards and reports continuation/error coverage", async ({ page }, testInfo) => {
  const browserErrors = await mount(page, "/post");
  const postActivity = {
    metrics: [
      {
        id: "metric-1",
        platform: "x",
        accountId: account.id,
        accountName: account.displayName,
        nativePostId: "tweet-1",
        nativeUrl: "https://x.com/simplepost/status/1",
        values: { impressions: 42, likes: 3 },
        coverage: "Lifetime",
        fetchedAt: "2026-09-14T12:00:00.000Z",
        lastAttemptAt: "2026-09-14T12:00:00.000Z",
        error: "Insights permission was not granted",
      },
    ],
    comments: [items[0]],
    capabilities: { [account.id]: ["metrics", "comments", "replies"] },
    hasMoreComments: true,
    errors: [{ accountId: account.id, message: "X comments are limited to the recent search window." }],
    coverage: [{ accountId: account.id, platform: "x", message: "Recent conversation coverage" }],
  };
  await page.route("**/api/v1/posts/post-1/social", (route) => route.fulfill({ json: postActivity }));
  await page.route("**/api/v1/posts/post-1/social/refresh", (route) => route.fulfill({ json: postActivity }));
  await page.route("**/api/v1/social/items/*/reply", (route) =>
    route.fulfill({ status: 503, json: { error: "Test only" } }),
  );
  await page.addScriptTag({ content: bundle });
  await expect(page.getByText("impressions")).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.getByText("Latest refresh: Insights permission was not granted")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load older comments" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("post-social-metrics.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});
