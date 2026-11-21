import { test, expect } from "@playwright/test";
import { submitUiRequest, UiSubmissionBlockedError } from "../src/adapters/ui.js";
import { account, config } from "./helpers.js";
import { catalog, materialize } from "../src/catalog.js";

for (const method of ["POST", "PATCH"])
  test(`UI ${method} blocks a late stop before forwarding the customer request`, async ({ page }) => {
    const cfg = config({ publishTimeoutMs: 2000 });
    const a = account();
    const s = materialize(catalog.find((s) => s.id === "bluesky.smoke")!, a, "ui", "late-stop", cfg.mediaBaseUrl);
    s.media = [];
    let forwarded = 0,
      guardCalls = 0;
    const routePath = method === "PATCH" ? "/api/v1/posts/draft-id" : "/api/v1/posts";
    await page.route(`${cfg.baseUrl}/**`, async (route) => {
      if (route.request().method() !== "GET") {
        forwarded++;
        return route.fulfill({ status: 200, body: "{}" });
      }
      return route.fulfill({
        contentType: "text/html",
        body: `<form onsubmit="event.preventDefault();fetch('${routePath}',{method:'${method}',body:JSON.stringify({accountIds:['account-1'],postingMode:'${method === "PATCH" ? "schedule" : "now"}',message:'message',media:[]})}).catch(()=>{})"><button type="submit">Post</button></form>`,
      });
    });
    await page.goto(cfg.baseUrl);
    const stoppedAfterPreparation = true;
    await expect(
      submitUiRequest(
        page,
        cfg,
        s,
        a,
        method === "PATCH" ? "schedule" : "now",
        method === "PATCH" ? "draft-id" : undefined,
        undefined,
        async () => {
          guardCalls++;
          if (stoppedAfterPreparation) throw new Error("Run stopped after schedule preparation");
        },
      ),
    ).rejects.toThrow(UiSubmissionBlockedError);
    expect(guardCalls).toBe(1);
    expect(forwarded).toBe(0);
  });
