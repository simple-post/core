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
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import Picker from './app/(protected)/accounts/connect/[platform]/page';
        createRoot(document.getElementById('root')).render(<Picker/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "offline-picker",
        setup(builder) {
          const mocks: Record<string, string> = {
            "next/navigation": `const params = new URLSearchParams('pendingId=pending');
          const router = {push: (url) => window.history.pushState(null, '', url)};
          export const useRouter = () => router;
          export const useParams = () => ({platform: 'linkedin'});
          export const useSearchParams = () => params;`,
            "next/link":
              "import React from 'react'; export default function Link(props) { return React.createElement('a', props); }",
            "@/components/navbar": "export const Navbar = () => null;",
            "@/components/back-link": "export const BackLink = () => null;",
            "@/components/help-link": "export const HelpLink = () => null;",
            "@/lib/config":
              "export const isSocialPlatformEnabled = () => true; export const getPlatformById = () => ({id:'linkedin',name:'LinkedIn'});",
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

const accounts = [
  { id: "member", name: "Test Member", accountType: "profile", username: "member@example.test" },
  { id: "urn:li:organization:123", name: "Acme", accountType: "organization", username: "acme" },
  { id: "urn:li:organization:456", name: "Second Company", accountType: "organization" },
];

async function mount(page: Page, data: Record<string, unknown> = { accounts }) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://linkedin-picker.test/**", (route) =>
    route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' })
      : route.abort(),
  );
  await page.route("**/api/connect/pending/pending", (route) =>
    route.fulfill({ json: { id: "pending", platform: "linkedin", ...data } }),
  );
  await page.goto("https://linkedin-picker.test/accounts/connect/linkedin?pendingId=pending");
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("heading", { name: "Available accounts" })).toBeVisible();
  return errors;
}

test("chooses just a Page without also connecting its admin profile", async ({ page }) => {
  const errors = await mount(page);
  await expect(page.getByRole("button", { name: "Connect 0 account(s)" })).toBeDisabled();
  await expect(page.getByText("Personal profile", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Acme Company Page/ }).click();
  let selected: unknown;
  await page.route("**/api/connect/pending/pending", (route) => {
    selected = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, count: 1 } });
  });
  await page.getByRole("button", { name: "Connect 1 account(s)" }).click();
  await expect(page).toHaveURL(/\/accounts\?success=true&platform=linkedin&count=1$/);
  expect(selected).toEqual({ selectedAccountIds: ["urn:li:organization:123"] });
  expect(errors).toEqual([]);
});

test("allows reducing the selection and retrying after a quota error", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page.route("**/api/connect/pending/pending", (route) =>
    route.fulfill({ status: 403, json: { error: "Account limit reached" } }),
  );
  await page.getByRole("button", { name: "Connect 3 account(s)" }).click();
  await expect(page.getByText("Account limit reached")).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: /Second Company Company Page/ }).click();
  await expect(page.getByRole("button", { name: "Connect 1 account(s)" })).toBeEnabled();
});

test("keeps profile selection available alongside a Page-access warning", async ({ page }) => {
  await mount(page, {
    accounts: [accounts[0]],
    warning: "No company Pages available for publishing. Check your Page permissions.",
  });
  await expect(page.getByText(/No company Pages available/)).toBeVisible();
  await page.getByRole("button", { name: /Test Member Personal profile/ }).click();
  await expect(page.getByRole("button", { name: "Connect 1 account(s)" })).toBeEnabled();
});
