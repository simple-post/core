import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { configuredAppRoot } from "../src/app-root.js";

const schedulerRoot = path.join(configuredAppRoot(), "scheduler");
const schedulerRequire = createRequire(path.join(schedulerRoot, "package.json"));
const { build } = schedulerRequire("esbuild") as typeof import("esbuild");
const bundles = new Map<boolean, string>();

test.beforeAll(async () => {
  for (const enabled of [false, true]) {
    const result = await build({
      absWorkingDir: schedulerRoot,
      stdin: {
        resolveDir: schedulerRoot,
        loader: "tsx",
        contents: `
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {PlanSelection} from './components/billing/plan-selection';
          import {TrialExpiredDialog} from './components/billing/trial-expired-dialog';
          createRoot(document.getElementById('root')).render(
            location.pathname === '/expired' ? <TrialExpiredDialog/> : <PlanSelection/>
          );
        `,
      },
      bundle: true,
      write: false,
      format: "iife",
      define: {
        "process.env.NODE_ENV": '"production"',
        "process.env.NEXT_PUBLIC_OPENAI_ADS_MEASUREMENT_ENABLED": JSON.stringify(String(enabled)),
        "process.env": "{}",
      },
      plugins: [
        {
          name: "offline-chrome",
          setup(builder) {
            builder.onResolve({ filter: /^@\/components\/(navbar|help-link)$/ }, (args) => ({
              path: args.path,
              namespace: "mock",
            }));
            builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
              contents: "export const Navbar = () => null; export const HelpLink = () => null;",
              loader: "js",
            }));
          },
        },
      ],
    });
    bundles.set(enabled, result.outputFiles[0].text);
  }
});

for (const entry of [
  { pathname: "/plans", button: "Choose Basic" },
  { pathname: "/expired", button: "Subscribe to Basic" },
]) {
  for (const choice of ["disabled", "unchecked", "checked", "withdrawn"] as const) {
    test(`${entry.pathname}: checkout consent is explicit (${choice})`, async ({ page }) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      await page.route("https://consent.test/**", (route) =>
        route.request().resourceType() === "document"
          ? route.fulfill({
              contentType: "text/html",
              body: '<html lang="en"><body><div id="root"></div></body></html>',
            })
          : route.abort(),
      );
      let body: unknown;
      await page.route("**/api/billing/checkout", async (route) => {
        body = route.request().postDataJSON();
        await route.fulfill({ json: { url: "https://consent.test/complete" } });
      });
      await page.goto(`https://consent.test${entry.pathname}`);
      await page.addScriptTag({ content: bundles.get(choice !== "disabled")! });
      const checkbox = page.getByRole("checkbox");
      if (choice === "disabled") {
        await expect(checkbox).toHaveCount(0);
      } else {
        await expect(checkbox).not.toBeChecked();
        if (choice === "checked" || choice === "withdrawn") await checkbox.check();
        if (choice === "withdrawn") await checkbox.uncheck();
      }
      await page.getByRole("button", { name: entry.button, exact: true }).click();
      await expect(page).toHaveURL("https://consent.test/complete");
      expect(body).toEqual(
        choice === "checked" ? { planKey: "basic", adsMeasurementConsent: true } : { planKey: "basic" },
      );
      expect(browserErrors).toEqual([]);
    });
  }
}
