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
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import BillingPlansPage from './app/(protected)/billing/plans/page';
        import BillingPage from './app/(protected)/billing/page';
        import {BILLING_PLANS} from './lib/billing/plans';
        window.billingPlans = BILLING_PLANS;
        window.reactErrors = [];
        class Boundary extends React.Component {
          state = {failed: false};
          static getDerivedStateFromError() { return {failed: true}; }
          componentDidCatch(error, info) {
            window.reactErrors.push(error.message + info.componentStack);
          }
          render() { return this.state.failed ? <p>React boundary failed</p> : this.props.children; }
        }
        createRoot(document.getElementById('root')).render(
          <Boundary>{location.pathname === '/billing' ? <BillingPage/> : <BillingPlansPage/>}</Boundary>
        );
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "offline-session-and-router",
        setup(builder) {
          const mocks: Record<string, string> = {
            "next/link": "export {default as default} from 'react-link-mock';",
            "next/navigation": `
            const params = new URLSearchParams();
            export const usePathname = () => location.pathname;
            export const useSearchParams = () => params;
          `,
            "@/lib/auth/auth-client": `export const useSession = () => ({data: {user: {name: 'Test User', email: 'test@example.test'}}}); export const authClient = {};`,
            "@/components/billing/subscription-gate": "export const useSelfHosted = () => false;",
            "@/hooks/use-accounts": "const accounts = []; export const useAccounts = () => ({data: accounts});",
          };
          builder.onResolve({ filter: /^(next\/|@\/)/ }, (args) =>
            args.path in mocks ? { path: args.path, namespace: "mock" } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
            resolveDir: schedulerRoot,
          }));
          builder.onResolve({ filter: /^react-link-mock$/ }, () => ({ path: "link", namespace: "link" }));
          builder.onLoad({ filter: /.*/, namespace: "link" }, () => ({
            contents:
              "import React from 'react'; export default function Link(props) { return React.createElement('a', props); }",
            loader: "js",
            resolveDir: schedulerRoot,
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});

async function mount(page: Page, pathname = "/billing/plans") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://billing.test/**", (route) => {
    if (route.request().resourceType() === "document") {
      return route.fulfill({
        contentType: "text/html",
        body: '<html lang="en"><body><div id="root"></div></body></html>',
      });
    }
    return route.abort();
  });
  await page.goto(`https://billing.test${pathname}`);
  return errors;
}

// Google Translate replaces React-owned text nodes with font elements. Keep
// the wording readable so assertions can check subsequent state transitions.
async function translate(page: Page) {
  await page.evaluate(() => {
    document.documentElement.lang = "pt";
    document.documentElement.classList.add("translated-ltr");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.textContent?.trim() && !node.parentElement?.closest("script, style, font, svg")) nodes.push(node);
    }
    for (const node of nodes) {
      const outer = document.createElement("font");
      const inner = document.createElement("font");
      inner.textContent = node.textContent;
      outer.append(inner);
      node.replaceWith(outer);
    }
  });
}

async function expectHealthy(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { reactErrors: string[] }).reactErrors)).toEqual([]);
  await expect(page.getByText("React boundary failed")).toHaveCount(0);
}

const trial = {
  active: true,
  accessType: "trial",
  displayCurrency: "usd",
  plan: null,
  trial: { status: "active", expiresAt: "2026-09-16T14:20:00Z", daysRemaining: 7, postsPerPlatform: 10 },
};

test("translated billing loading, refresh, and checkout failure remain usable", async ({ page }) => {
  // Hold each API response until translation has modified the currently
  // visible state. No request reaches a real account or Stripe.
  let releaseBilling!: () => void;
  const billingReady = () =>
    new Promise<void>((resolve) => {
      releaseBilling = resolve;
    });
  let pendingBilling = billingReady();
  const browserErrors = await mount(page);
  await page.route("**/api/billing/subscription", async (route) => {
    await pendingBilling;
    await route.fulfill({ json: trial });
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByText("Loading plans...")).toBeVisible();
  await translate(page);
  releaseBilling();
  await expect(page.getByRole("button", { name: "Choose Basic", exact: true })).toBeVisible();
  await expectHealthy(page);
  await translate(page);
  pendingBilling = billingReady();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Loading plans...")).toBeVisible();
  await translate(page);
  releaseBilling();
  await expect(page.getByRole("button", { name: "Choose Basic", exact: true })).toBeVisible();
  await expectHealthy(page);

  let releaseCheckout!: () => void;
  const checkoutReady = new Promise<void>((resolve) => {
    releaseCheckout = resolve;
  });
  await page.route("**/api/billing/checkout", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ planKey: "basic" });
    await checkoutReady;
    await route.fulfill({ status: 503, json: { error: "Test checkout unavailable" } });
  });
  await translate(page);
  await page.getByRole("button", { name: "Choose Basic", exact: true }).click();
  await expectHealthy(page);
  await expect(page.getByRole("button", { name: "Opening Stripe...", exact: true })).toBeDisabled();
  await translate(page);
  releaseCheckout();
  await expect(page.getByRole("button", { name: "Choose Basic", exact: true })).toBeEnabled();
  await expectHealthy(page);
  expect(browserErrors).toEqual([]);
});

test("translated checkout can navigate to the returned checkout URL", async ({ page }) => {
  const browserErrors = await mount(page);
  await page.route("**/api/billing/subscription", (route) => route.fulfill({ json: trial }));
  let releaseCheckout!: () => void;
  const checkoutReady = new Promise<void>((resolve) => {
    releaseCheckout = resolve;
  });
  await page.route("**/api/billing/checkout", async (route) => {
    await checkoutReady;
    await route.fulfill({ json: { url: "https://billing.test/checkout-success" } });
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("button", { name: "Choose Basic", exact: true })).toBeVisible();
  await translate(page);
  await page.getByRole("button", { name: "Choose Basic", exact: true }).click();
  await expect(page.getByRole("button", { name: "Opening Stripe...", exact: true })).toBeDisabled();
  await expectHealthy(page);
  releaseCheckout();
  await expect(page).toHaveURL("https://billing.test/checkout-success");
  expect(browserErrors).toEqual([]);
});

test("translated paid plan changes update the current plan without a boundary crash", async ({ page }) => {
  const browserErrors = await mount(page);
  let currentPlan = "basic";
  await page.route("**/api/billing/subscription", (route) =>
    route.fulfill({
      json: {
        active: true,
        accessType: "stripe",
        displayCurrency: "usd",
        trial: null,
        plan: { key: currentPlan },
      },
    }),
  );
  let releaseChange!: () => void;
  const changeReady = new Promise<void>((resolve) => {
    releaseChange = resolve;
  });
  let changeRequests = 0;
  await page.route("**/api/billing/change-plan", async (route) => {
    changeRequests++;
    expect(route.request().postDataJSON()).toEqual({ planKey: "advanced" });
    await changeReady;
    currentPlan = "advanced";
    await route.fulfill({ json: { active: true, displayCurrency: "usd", plan: { key: currentPlan } } });
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("button", { name: "Upgrade to Advanced", exact: true })).toBeVisible();
  await translate(page);
  await page.getByRole("button", { name: "Upgrade to Advanced", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await translate(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(changeRequests).toBe(0);
  await page.getByRole("button", { name: "Upgrade to Advanced", exact: true }).click();
  await translate(page);
  await page.getByRole("button", { name: "Upgrade plan", exact: true }).click();
  await expectHealthy(page);
  await expect(page.getByRole("button", { name: "Updating...", exact: true })).toBeDisabled();
  await translate(page);
  releaseChange();
  const advanced = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Advanced", exact: true }) });
  await expect(advanced.getByRole("button", { name: "Current plan", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Downgrade to Basic", exact: true })).toBeEnabled();
  await expectHealthy(page);
  expect(changeRequests).toBe(1);
  expect(browserErrors).toEqual([]);
});

for (const action of ["Manage subscription", "Invoices"]) {
  test(`translated ${action} shows its loading label and recovers from a portal error`, async ({ page }) => {
    const browserErrors = await mount(page, "/billing");
    await page.route("**/api/billing/subscription", async (route) => {
      const plan = await page.evaluate(() => (window as unknown as { billingPlans: unknown[] }).billingPlans[0]);
      await route.fulfill({
        json: {
          active: true,
          accessType: "stripe",
          displayCurrency: "usd",
          plan,
          trial: null,
          usage: { connectedAccounts: 1, postsThisPeriod: 2 },
          subscription: { status: "active" },
        },
      });
    });
    let releasePortal!: () => void;
    const portalReady = new Promise<void>((resolve) => {
      releasePortal = resolve;
    });
    await page.route("**/api/billing/portal", async (route) => {
      await portalReady;
      await route.fulfill({ status: 503, json: { error: "Test portal unavailable" } });
    });
    await page.addScriptTag({ content: bundle });
    await expect(page.getByRole("button", { name: action, exact: true })).toBeVisible();
    await translate(page);
    await page.getByRole("button", { name: action, exact: true }).click();
    await expectHealthy(page);
    await expect(page.getByRole("button", { name: "Opening...", exact: true })).toBeDisabled();
    await translate(page);
    releasePortal();
    await expect(page.getByRole("button", { name: action, exact: true })).toBeEnabled();
    await expectHealthy(page);
    expect(browserErrors).toEqual([]);
  });
}
