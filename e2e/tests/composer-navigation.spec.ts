import { test, expect } from "@playwright/test";
import { openComposer, uiCreate } from "../src/adapters/ui.js";
import { account, config, serve } from "./helpers.js";
import { catalog, materialize } from "../src/catalog.js";

for (const kind of [
  "gateway-recovery",
  "gateway-exhausted",
  "loading-recovery",
  "loading-exhausted",
  "real-ui-regression",
  "partial-form",
  "other-server-error",
] as const) {
  test(`initial composer navigation: ${kind}`, async ({ page }) => {
    let gets = 0,
      mutations = 0;
    await page.route("http://127.0.0.1:3000/**", (route) => {
      if (route.request().method() !== "GET") {
        mutations++;
        return route.fulfill({ status: 500 });
      }
      gets++;
      const recovery = kind.endsWith("recovery") && gets === (kind === "gateway-recovery" ? 3 : 2);
      const status = recovery
        ? 200
        : kind.startsWith("gateway")
          ? gets === 1
            ? 502
            : 503
          : kind === "other-server-error"
            ? 500
            : 200;
      const body = recovery
        ? "<label>Message<textarea></textarea></label>"
        : kind.startsWith("loading")
          ? "Loading..."
          : kind === "partial-form"
            ? "<form>Loading...<textarea></textarea></form>"
            : "Composer is broken";
      return route.fulfill({ status, contentType: "text/html", body });
    });
    if (kind.endsWith("recovery")) await openComposer(page, config(), 100);
    else await expect(openComposer(page, config(), 100)).rejects.toThrow();
    expect(gets).toBe(kind.startsWith("gateway") ? 3 : kind.startsWith("loading") ? 2 : 1);
    expect(mutations).toBe(0);
  });
}
test("an uncertain UI post response is never retried or followed by composer reload", async ({ page }) => {
  let gets = 0,
    posts = 0,
    submissions = 0;
  const server = await serve((req, res) => {
    if (req.method === "POST") {
      posts++;
      res.writeHead(502);
      res.end("Unknown publish outcome");
      return;
    }
    if (req.url === "/schedule") gets++;
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<form onsubmit="event.preventDefault();fetch('/api/v1/posts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountIds:['account-1'],postingMode:'now',message:document.querySelector('textarea').value,media:[]})})">
      <label>Message<textarea></textarea></label><button type="button" disabled>Clear all</button><button type="button" data-testid="account-toggle-bluesky-account-1">Bluesky</button><button type="button" id="post-now">Now</button><button type="submit">Post</button></form>`);
  });
  const a = account(),
    cfg = config({ baseUrl: server.url, publishTimeoutMs: 2000 });
  const s = materialize(catalog.find((s) => s.id === "bluesky.smoke")!, a, "ui", "offline", cfg.mediaBaseUrl);
  s.media = [];
  try {
    await expect(
      uiCreate(page, cfg, s, a, [], async () => {
        submissions++;
      }),
    ).rejects.toThrow("502");
    expect({ gets, posts, submissions }).toEqual({ gets: 1, posts: 1, submissions: 1 });
  } finally {
    await server.close();
  }
});
