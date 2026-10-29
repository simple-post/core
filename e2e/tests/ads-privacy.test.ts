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
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AdsPrivacyControl} from './components/ads-privacy-control'; createRoot(document.getElementById('root')).render(<AdsPrivacyControl/>);`,
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
test("permission captures the opaque click and shares it with the marketing domain", async ({ page, context }) => {
  const posts = await open(page);
  await expect(page.getByRole("button", { name: "Allow measurement", exact: true })).toBeVisible();
  expect((await context.cookies()).some((c) => c.name === "sp_ads_click_v1")).toBe(false);
  await page.getByRole("button", { name: "Allow measurement", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ad privacy preferences", exact: true })).toBeVisible();
  expect(posts).toContainEqual({ allowed: true });
  const cookies = await context.cookies("https://simplepost.social/");
  const click = cookies.find((c) => c.name === "sp_ads_click_v1");
  expect(JSON.parse(decodeURIComponent(click!.value)).reference).toBe("Opaque+/unchanged==");
  expect(click).toMatchObject({ domain: ".simplepost.social", secure: true, sameSite: "Lax" });
  await page.getByRole("button", { name: "Ad privacy preferences", exact: true }).click();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ad privacy preferences", exact: true })).toBeVisible();
  expect(posts).toContainEqual({ allowed: false });
  expect((await context.cookies()).some((c) => c.name === "sp_ads_click_v1")).toBe(false);
});
test("failed preference requests stay visible and retryable", async ({ page }) => {
  await open(page, { fail: true });
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Could not save your preference. Please try again.");
  await expect(page.getByRole("button", { name: "Decline", exact: true })).toBeEnabled();
});
for (const route of ["/subscribe", "/billing", "/billing/plans", "/admin/analytics"]) {
  test(`leaves ${route} unchanged`, async ({ page }) => {
    await open(page, { path: route });
    await expect(page.getByRole("heading", { name: "SimplePost" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Advertising privacy" })).toHaveCount(0);
  });
}
test("stored account withdrawal wins over stale browser permission", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "sp_ads_permission_v1",
      value: "allowed",
      domain: ".simplepost.social",
      path: "/",
      secure: true,
      sameSite: "Lax",
    },
  ]);
  const posts = await open(page, { preference: "declined" });
  await expect(page.getByRole("button", { name: "Ad privacy preferences", exact: true })).toBeVisible();
  expect((await context.cookies()).find((c) => c.name === "sp_ads_permission_v1")?.value).toBe("declined");
  expect(posts).toContainEqual({ sync: true });
});
test("incomplete configuration does not offer a nonfunctional control", async ({ page }) => {
  await open(page, { enabled: false });
  await expect(page.getByRole("heading", { name: "SimplePost" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Advertising privacy" })).toHaveCount(0);
});
