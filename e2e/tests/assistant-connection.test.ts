import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { configuredAppRoot } from "../src/app-root.js";

const schedulerRoot = path.join(configuredAppRoot(), "scheduler");
const schedulerRequire = createRequire(path.join(schedulerRoot, "package.json"));
const { build } = schedulerRequire("esbuild") as typeof import("esbuild");
let bundle: string;

// Real Accounts page, handoff component and protected-layout continuation.
// Authentication chrome and HTTP are fixtures; no provider is contacted.
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: schedulerRoot,
    stdin: {
      resolveDir: schedulerRoot,
      loader: "tsx",
      contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import Accounts from './app/(protected)/accounts/page';
      import ProtectedLayout from './app/(protected)/layout';
      import {QueryClientProvider} from './lib/query-client';
      createRoot(document.getElementById('root')).render(<QueryClientProvider><ProtectedLayout><Accounts/></ProtectedLayout></QueryClientProvider>);
    `,
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "offline-session",
        setup(builder) {
          const mocks: Record<string, string> = {
            "next/navigation": `const params = new URLSearchParams(location.search); export const useSearchParams = () => params; export const usePathname = () => location.pathname; export const useRouter = () => ({replace: (url) => history.replaceState(null, '', url)});`,
            "next/link": "import React from 'react'; export default (props) => React.createElement('a', props);",
            "@/lib/auth/use-login-session":
              "export const useLoginSession = () => ({isPending:false, data: !new URLSearchParams(location.search).has('loggedOut') || sessionStorage.signedIn ? {user: {id: 'test-user'}} : null});",
            "@/lib/auth/auth-client": "export const authClient = {signOut: async () => ({})};",
            "@/components/login-form": `import React from 'react'; export const LoginForm = ({callbackURL}) => <button onClick={() => { sessionStorage.signedIn='true'; location.assign(callbackURL); }}>Sign into SimplePost</button>;`,
            "@/components/billing/subscription-gate": "export const SubscriptionGate = ({children}) => children;",
            "@/hooks/use-billing": "export const useWorkspaceReadOnly = () => false;",
            "@/components/create-post-webmcp": "export const WebMcpProvider = ({children}) => children;",
            "@/components/schedule-calendar-context":
              "export const ScheduleCalendarProvider = ({children}) => children;",
            "@/components/activation-analytics": "export const ActivationAnalytics = () => null;",
            "@/components/navbar": "export const Navbar = () => null;",
            "@/components/account-avatar": "export const AccountAvatar = () => null;",
            "@/components/help-link": "export const HelpLink = () => null;",
          };
          builder.onResolve({ filter: /^(next\/|@\/)/ }, (args) =>
            args.path in mocks ? { path: args.path, namespace: "mock" } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "tsx",
            resolveDir: schedulerRoot,
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});

async function install(page: Page, handoffStatus = 200) {
  await page.route("https://handoff.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/v1/accounts") return route.fulfill({ json: { accounts: [] } });
    if (url.pathname === "/api/connect/handoff") {
      const body = route.request().postDataJSON();
      return route.fulfill({
        status: handoffStatus,
        json:
          handoffStatus === 403
            ? {
                error: "Sign in with the SimplePost account connected to your AI assistant.",
                code: "HANDOFF_ACCOUNT_MISMATCH",
              }
            : {
                connectionType: body.platform === "forem" ? "manual" : "oauth",
                startUrl: `/api/connect/${body.platform}?handoffToken=${body.handoffToken}`,
              },
      });
    }
    if (url.pathname === "/api/connect/x")
      return route.fulfill({ contentType: "text/html", body: "<h1>X authorization</h1>" });
    if (url.pathname === "/provider-consent")
      return route.fulfill({ contentType: "text/html", body: "<h1>X authorization</h1>" });
    if (url.pathname === "/api/connect/forem") return route.fulfill({ json: { success: true } });
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
  });
}

test("signed-in users reach provider consent without another Connect click", async ({ page }) => {
  await install(page);
  const prepared = page.waitForRequest("**/api/connect/handoff");
  await page.goto("https://handoff.test/accounts?onboarding=connect&platform=x&handoffToken=fixture");
  expect((await prepared).postDataJSON()).toEqual({ platform: "x", handoffToken: "fixture" });
  await expect(page.getByRole("heading", { name: "X authorization" })).toBeVisible();
});

test("sign-in preserves the selected platform and continues automatically", async ({ page }) => {
  await install(page);
  await page.goto("https://handoff.test/accounts?onboarding=connect&platform=x&handoffToken=fixture&loggedOut=1");
  await page.getByRole("button", { name: "Sign into SimplePost" }).click();
  await expect(page.getByRole("heading", { name: "X authorization" })).toBeVisible();
});

test("manual providers open the existing setup form directly", async ({ page }) => {
  await install(page);
  await page.goto("https://handoff.test/accounts?onboarding=connect&platform=forem&handoffToken=fixture");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("API key");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Continue account setup" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("API key", { exact: true }).fill("offline-fixture-key");
  const saved = page.waitForRequest("**/api/connect/forem");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Connect/ })
    .click();
  expect((await saved).postDataJSON().handoffToken).toBe("fixture");
});

test("a different browser account receives a recovery action without provider navigation", async ({ page }) => {
  await install(page, 403);
  await page.goto("https://handoff.test/accounts?onboarding=connect&platform=x&handoffToken=fixture");
  await expect(page.getByText("Sign in with the SimplePost account connected to your AI assistant.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use a different SimplePost account" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/accounts");
});

test("AI-origin success stays on confirmation; ordinary connection keeps its previous return", async ({ page }) => {
  await install(page);
  await page.goto("https://handoff.test/accounts?success=true&platform=x&source=assistant_handoff");
  await expect(page.getByText("Account connected. Continue in your AI assistant.")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("say “connected”");
  await page.goto("https://handoff.test/accounts?success=true&platform=x");
  await expect(page.getByText("Account connected. Continue in your AI assistant.")).toHaveCount(0);
});
