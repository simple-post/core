// Offline regression: hydrate the actual privacy page after CDN email rewriting.
// No application server, credentials, database, or provider calls are needed.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const scheduler = fileURLToPath(new URL("../../scheduler/", import.meta.url));
// Reuse the scheduler's declared build dependency rather than adding another.
const schedulerRequire = createRequire(path.join(scheduler, "package.json"));
const { build } = schedulerRequire("esbuild");
const { createElement } = schedulerRequire("react");
const { renderToString } = schedulerRequire("react-dom/server");
const pageFile = path.join(scheduler, "app/privacy/page.tsx");
const source = await readFile(pageFile, "utf8");
const temporaryRoot = fileURLToPath(new URL("../temp/", import.meta.url));
await mkdir(temporaryRoot, { recursive: true });
const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, "privacy-hydration-"));

// Model the documented email_off exemption and the link replacement observed
// in the production response. This is a regression fixture, not a CDN emulator.
function obfuscateEmails(html) {
  return html
    .split(/(<!--email_off-->[\s\S]*?<!--\/email_off-->)/g)
    .map((part) =>
      part.startsWith("<!--email_off-->")
        ? part
        : part.replaceAll(
            "support@simplepost.social",
            '<a href="/cdn-cgi/l/email-protection" class="__cf_email__">[email protected]</a>',
          ),
    )
    .join("");
}

async function bundlePage(baseline) {
  const pageSource = baseline ? source.replaceAll("<SupportEmail />", "support@simplepost.social") : source;
  const options = {
    bundle: true,
    jsx: "automatic",
    tsconfig: path.join(scheduler, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "privacy-page-fixture",
        setup(builder) {
          builder.onLoad({ filter: /app\/privacy\/page\.tsx$/ }, () => ({
            contents: pageSource,
            loader: "tsx",
            resolveDir: path.dirname(pageFile),
          }));
        },
      },
    ],
  };
  const serverFile = path.join(temporaryDirectory, baseline ? "baseline.cjs" : "fixed.cjs");
  await build({ ...options, entryPoints: [pageFile], platform: "node", packages: "external", outfile: serverFile });
  const Page = createRequire(import.meta.url)(serverFile).default;
  const html = renderToString(createElement(Page));
  const client = await build({
    ...options,
    platform: "browser",
    write: false,
    stdin: {
      resolveDir: scheduler,
      sourcefile: "privacy-hydration-client.tsx",
      loader: "tsx",
      contents: `
        import { useEffect } from "react";
        import { hydrateRoot } from "react-dom/client";
        import Page from "./app/privacy/page";
        window.hydrationErrors = [];
        function Harness() {
          useEffect(() => { window.privacyReady = true; }, []);
          return <Page />;
        }
        hydrateRoot(document.getElementById("root"), <Harness />, {
          onRecoverableError: error => window.hydrationErrors.push(error.message),
        });
      `,
    },
  });
  return { html, javascript: client.outputFiles[0].text };
}

let browser;
let server;
try {
  const baseline = await bundlePage(true);
  const fixed = await bundlePage(false);
  assert.notEqual(obfuscateEmails(baseline.html), baseline.html, "The baseline must reproduce email rewriting");
  assert.equal(obfuscateEmails(fixed.html), fixed.html, "All privacy-page email text must survive CDN rewriting");
  assert.equal((fixed.html.match(/<!--email_off-->/g) ?? []).length, 2);

  let fixture;
  server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/client.js" ? "text/javascript" : "text/html");
    response.end(
      request.url === "/client.js"
        ? fixture.javascript
        : `<!doctype html><html><body><div id="root">${fixture.html}</div><script src="/client.js"></script></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();

  for (const decodeBeforeHydration of [false, true]) {
    for (const [name, bundled] of [
      ["baseline", baseline],
      ["fixed", fixed],
    ]) {
      fixture = { ...bundled, html: obfuscateEmails(bundled.html) };
      if (decodeBeforeHydration) {
        // Cloudflare's decoder replaces each obfuscated link with a text node;
        // even restored text can have a different node structure than React's.
        fixture.html += `<script>document.querySelectorAll(".__cf_email__").forEach(link => link.replaceWith(document.createTextNode("support@simplepost.social")));</script>`;
      }
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/privacy`);
      await page
        .waitForFunction(() => window.privacyReady === true, null, { timeout: 10_000 })
        .catch((error) => {
          throw new Error(`${name} hydration did not complete: ${errors.join("; ")}`, { cause: error });
        });
      const hydrationErrors = await page.evaluate(() => window.hydrationErrors);
      if (name === "baseline") {
        assert.ok(
          hydrationErrors.some((message) => message.includes("#418")),
          "Unprotected email must reproduce #418",
        );
      } else {
        assert.deepEqual(hydrationErrors, [], "Protected privacy page must hydrate without recovery");
        assert.deepEqual(errors, [], "Protected privacy page must have no unhandled browser errors");
        assert.equal(await page.locator('a[href="/"][data-slot="button"]').count(), 2);
        assert.equal(await page.locator("a button, button a, .__cf_email__").count(), 0);
        assert.equal(await page.getByText("support@simplepost.social", { exact: true }).count(), 2);
      }
      await page.close();
      console.log(`${name}: decoder ${decodeBeforeHydration ? "before hydration" : "pending"} passed`);
    }
  }
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true });
}
