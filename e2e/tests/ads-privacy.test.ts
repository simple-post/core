import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { configuredAppRoot } from "../src/app-root.js";

const schedulerRoot = path.join(configuredAppRoot(), "scheduler");
const schedulerRequire = createRequire(path.join(schedulerRoot, "package.json"));
const { build } = schedulerRequire("esbuild") as typeof import("esbuild");
let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: schedulerRoot,
    stdin: {
      resolveDir: schedulerRoot,
      loader: "tsx",
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AdsMeasurementWithdrawal} from './components/ads-measurement-withdrawal'; createRoot(document.getElementById('root')).render(<AdsMeasurementWithdrawal/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "offline-navigation",
        setup(builder) {
          builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "mock" }));
          builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents: "export const usePathname = () => location.pathname;",
            loader: "js",
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});
async function open(
  page: Page,
  options: { path?: string; enabled?: boolean; preference?: string; fail?: boolean } = {},
) {
  const posts: unknown[] = [];
  await page.route("https://app.simplepost.social/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/analytics/ads-measurement") {
      if (route.request().method() === "POST") {
        posts.push(route.request().postDataJSON());
        await route.fulfill({ status: options.fail ? 503 : 200, json: { saved: !options.fail } });
      } else
        await route.fulfill({ json: { enabled: options.enabled ?? true, preference: options.preference ?? null } });
    } else
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body><main><h1>SimplePost</h1></main><div id="root"></div><script>${bundle}</script></body></html>`,
      });
  });
  await page.goto("https://app.simplepost.social" + (options.path ?? "/?oppref=Opaque%2B%2Funchanged%3D%3D"));
  return posts;
}
test("offers no enrollment or click capture for a new visitor", async ({ page, context }) => {
  const posts = await open(page, { path: "/privacy?oppref=uncollected", enabled: false });
  await expect(page.getByRole("heading", { name: "SimplePost" })).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  expect(posts).toEqual([]);
  expect((await context.cookies()).some((cookie) => cookie.name.startsWith("sp_ads_"))).toBe(false);
});
test("existing participants can withdraw on the privacy page without an enrollment prompt", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "sp_ads_permission_v1", value: "allowed", domain: ".simplepost.social", path: "/", secure: true },
    { name: "sp_ads_click_v1", value: "previous-click", domain: ".simplepost.social", path: "/", secure: true },
  ]);
  const posts = await open(page, { path: "/privacy", enabled: false, preference: "allowed" });
  await page.getByRole("button", { name: "Stop sharing conversion events", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Ad measurement is off for your account.");
  expect(posts).toEqual([{ allowed: false }]);
  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === "sp_ads_click_v1")).toBe(false);
  expect(cookies.find((cookie) => cookie.name === "sp_ads_permission_v1")?.value).toBe("declined");
});
test("failed withdrawal stays visible and retryable", async ({ page }) => {
  await open(page, { path: "/privacy", preference: "allowed", fail: true });
  await page.getByRole("button", { name: "Stop sharing conversion events", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Could not save your preference. Please try again.");
  await expect(page.getByRole("button", { name: "Stop sharing conversion events", exact: true })).toBeEnabled();
});
test("withdrawn accounts never receive an enrollment option", async ({ page }) => {
  const posts = await open(page, { path: "/privacy", enabled: false, preference: "declined" });
  await expect(page.getByRole("status")).toHaveText("Ad measurement is off for your account.");
  await expect(page.getByRole("button")).toHaveCount(0);
  expect(posts).toEqual([]);
});
