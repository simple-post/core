import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { configuredAppRoot } from "../src/app-root.js";

const schedulerRoot = path.join(configuredAppRoot(), "scheduler");
const schedulerRequire = createRequire(path.join(schedulerRoot, "package.json"));
const { build } = schedulerRequire("esbuild") as typeof import("esbuild");
let bundle: string;

// Real query cache, billing gate, post-count hook, dialog and checkout client.
// Only navigation/session chrome is replaced; all HTTP is intercepted offline.
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: schedulerRoot,
    stdin: {
      resolveDir: schedulerRoot,
      loader: "tsx",
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {QueryClientProvider} from './lib/query-client';
        import {SubscriptionGate} from './components/billing/subscription-gate';
        import {usePostCounts} from './hooks/use-posts';
        function Dashboard() {
          const {data, error} = usePostCounts();
          return <main><h1>Workspace</h1><p>{error?.message ?? (data ? 'Counts loaded' : 'Loading counts')}</p></main>;
        }
        createRoot(document.getElementById('root')).render(
          <QueryClientProvider><SubscriptionGate>
            {location.pathname === '/' ? <Dashboard/> : <h1>Billing and settings</h1>}
          </SubscriptionGate></QueryClientProvider>
        );
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "offline-chrome",
        setup(builder) {
          const mocks: Record<string, string> = {
            "next/navigation": "export const usePathname = () => location.pathname;",
            "@/components/navbar": "export const Navbar = () => null;",
            "@/components/help-link": "export const HelpLink = () => null;",
          };
          builder.onResolve({ filter: /^(next\/|@\/)/ }, (args) =>
            args.path in mocks ? { path: args.path, namespace: "mock" } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
            resolveDir: schedulerRoot,
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});

const active = {
  active: true,
  accessType: "trial",
  displayCurrency: "eur",
  plan: null,
  trial: { status: "active", expiresAt: "2026-09-12T00:00:00Z", daysRemaining: 1, postsPerPlatform: 10 },
};
const expired = { ...active, active: false, accessType: null, trial: { ...active.trial, status: "expired" } };
const counts = { counts: { drafts: 2, scheduled: 0, past: 1, failed: 0 }, latestFailedAt: null };
const denial = {
  error: "Your free trial has ended. Choose a plan to keep using SimplePost.",
  code: "PAYMENT_REQUIRED",
};

async function mount(page: Page, pathname = "/") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.route("https://trial.test/**", (route) => {
    if (route.request().resourceType() === "document") {
      return route.fulfill({
        contentType: "text/html",
        body: '<html lang="en"><body><div id="root"></div></body></html>',
      });
    }
    return route.abort();
  });
  await page.goto(`https://trial.test${pathname}`);
  return errors;
}

async function expectExpired(page: Page) {
  await expect(page.getByRole("dialog", { name: "Your free trial has ended" })).toBeVisible();
  await expect(page.getByText("Subscribe to keep creating and scheduling posts.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subscribe to Basic", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Workspace", exact: true })).toHaveCount(0);
}

test("an open dashboard's first billing denial replaces stale access with a subscribe CTA without retries", async ({
  page,
}) => {
  const errors = await mount(page);
  let billingRequests = 0;
  let postRequests = 0;
  let clientErrors = 0;
  await page.route("**/api/billing/subscription", (route) =>
    route.fulfill({ json: ++billingRequests === 1 ? active : expired }),
  );
  await page.route("**/api/v1/posts?type=counts", (route) => {
    postRequests++;
    return route.fulfill({ status: 402, json: denial });
  });
  await page.route("**/api/internal/client-errors", (route) => {
    clientErrors++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.addScriptTag({ content: bundle });
  await expectExpired(page);
  await page.clock.runFor(125_000);
  expect(postRequests).toBe(1);
  expect(billingRequests).toBeGreaterThanOrEqual(2);
  expect(clientErrors).toBe(0);
  await page.keyboard.press("Escape");
  await expectExpired(page);
  expect(errors).toEqual([]);
});

test("billing polling notices expiry even without a rejected workspace request", async ({ page }) => {
  await mount(page, "/settings");
  let billingRequests = 0;
  await page.route("**/api/billing/subscription", (route) =>
    route.fulfill({ json: ++billingRequests === 1 ? active : expired }),
  );
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("heading", { name: "Billing and settings" })).toBeVisible();
  await page.clock.runFor(61_000);
  await expectExpired(page);
});

test("an expired user can recover from a checkout error and subscribe to the selected plan", async ({ page }) => {
  const errors = await mount(page);
  let postRequests = 0;
  await page.route("**/api/billing/subscription", (route) => route.fulfill({ json: expired }));
  await page.route("**/api/v1/posts?type=counts", (route) => {
    postRequests++;
    return route.fulfill({ json: counts });
  });
  let checkoutRequests = 0;
  await page.route("**/api/billing/checkout", (route) => {
    expect(route.request().postDataJSON()).toEqual({ planKey: "basic" });
    checkoutRequests++;
    return checkoutRequests === 1
      ? route.fulfill({ status: 503, json: { error: "Checkout is temporarily unavailable. Please try again." } })
      : route.fulfill({ json: { url: "https://trial.test/checkout" } });
  });
  await page.addScriptTag({ content: bundle });
  await expectExpired(page);
  await page.getByRole("button", { name: "Subscribe to Basic", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Checkout is temporarily unavailable. Please try again.");
  await page.getByRole("button", { name: "Subscribe to Basic", exact: true }).click();
  await expect(page).toHaveURL("https://trial.test/checkout");
  expect(postRequests).toBe(0);
  expect(checkoutRequests).toBe(2);
  expect(errors).toEqual([]);
});

test("confirmed paid access after returning from checkout restores the workspace", async ({ page }) => {
  await mount(page);
  let billingRequests = 0;
  await page.route("**/api/billing/subscription", (route) =>
    route.fulfill({
      json: ++billingRequests === 1 ? expired : { ...active, accessType: "stripe", trial: expired.trial },
    }),
  );
  await page.route("**/api/v1/posts?type=counts", (route) => route.fulfill({ json: counts }));
  await page.addScriptTag({ content: bundle });
  await expectExpired(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("Counts loaded")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a quota rejection preserves active billing access and the API explanation", async ({ page }) => {
  await mount(page);
  let postRequests = 0;
  await page.route("**/api/billing/subscription", (route) => route.fulfill({ json: active }));
  await page.route("**/api/v1/posts?type=counts", (route) => {
    postRequests++;
    return route.fulfill({ status: 402, json: { error: "Your plan allowance has been used." } });
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByText("Your plan allowance has been used.")).toBeVisible();
  await page.clock.runFor(90_000);
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(postRequests).toBe(1);
});

test("unexpected server failures still retry and are reported", async ({ page }) => {
  await mount(page);
  let postRequests = 0;
  const levels: string[] = [];
  await page.route("**/api/billing/subscription", (route) => route.fulfill({ json: active }));
  await page.route("**/api/v1/posts?type=counts", (route) => {
    postRequests++;
    return route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
  });
  await page.route("**/api/internal/client-errors", (route) => {
    levels.push(route.request().postDataJSON().level);
    return route.fulfill({ json: { ok: true } });
  });
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => postRequests).toBe(1);
  for (const elapsed of [1_100, 2_100, 4_100]) {
    const before = postRequests;
    await page.clock.runFor(elapsed);
    await expect.poll(() => postRequests).toBe(before + 1);
  }
  await expect(page.getByText("Temporarily unavailable")).toBeVisible();
  await expect.poll(() => levels).toEqual(["error"]);
  expect(postRequests).toBe(4);
});

for (const pathname of ["/billing", "/billing/plans"]) {
  test(`expired users can still reach ${pathname}`, async ({ page }) => {
    await mount(page, pathname);
    await page.route("**/api/billing/subscription", (route) => route.fulfill({ json: expired }));
    await page.addScriptTag({ content: bundle });
    await expect(page.getByRole("heading", { name: "Billing and settings" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`subscription dialog fits ${viewport.width}px and keeps the CTA reachable`, async ({ page }, testInfo) => {
    const { readFileSync } = await import("node:fs");
    const postcss = schedulerRequire("postcss") as typeof import("postcss").default;
    const tailwind = schedulerRequire("@tailwindcss/postcss");
    const stylesheet = path.join(schedulerRoot, "app/globals.css");
    const css = await postcss([tailwind({ base: schedulerRoot })]).process(readFileSync(stylesheet, "utf8"), {
      from: stylesheet,
    });
    await page.setViewportSize(viewport);
    const errors = await mount(page);
    await page.route("**/api/billing/subscription", (route) => route.fulfill({ json: expired }));
    await page.addStyleTag({ content: css.css + "body { font-family: Arial, sans-serif; }" });
    await page.addScriptTag({ content: bundle });
    await expectExpired(page);
    await page.clock.runFor(300);
    const dialog = page.getByRole("dialog");
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: testInfo.outputPath("subscribe.png"), animations: "disabled" });
    for (const plan of ["Basic", "Advanced", "Pro"]) {
      const button = page.getByRole("button", { name: `Subscribe to ${plan}`, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }
    expect(errors).toEqual([]);
  });
}
