import { expect, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";
import { mediaFiles } from "../media.js";
import type { LiveConfig } from "../config.js";
import type { Materialized } from "../types.js";
import { verifyFittedMedia } from "../verification/image-fit.js";

type Prepared = { media: Array<{ url: string; size?: number }> };

// Drive the real dialog. No mocked fitting response and no direct API submission.
async function review(page: Page, config: LiveConfig, s: Materialized): Promise<string[]> {
  const open = () => page.getByRole("button", { name: "Fit images…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Fit images for your platforms" });
  const originals = () =>
    dialog
      .getByRole("img", { name: /^Original / })
      .evaluateAll((images) => images.map((img) => (img as HTMLImageElement).src));
  await open();
  const sourceUrls = await originals();
  expect(sourceUrls).toHaveLength(s.media.length);
  const generate = async (mode: "crop" | "blur") => {
    await dialog
      .getByRole("radio", {
        name: mode === "crop" ? "Crop to fit · trim edges" : "Blurred background · keep full image",
      })
      .check();
    await expect(dialog.getByRole("button", { name: "Use these images" })).toBeDisabled();
    const responsePromise = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/validation" &&
        r.request().method() === "POST" &&
        r.request().postDataJSON()?.imageFit === mode,
    );
    await dialog.getByRole("button", { name: "Generate preview", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const request = response.request().postDataJSON();
    expect(request.accountIds).toEqual([config.accounts[s.platform]!.id]);
    expect(
      request.media.map((m: { url: string }) => m.url),
      "Every method starts from original images",
    ).toEqual(sourceUrls);
    const data = (await response.json()) as { fittedContent: Prepared; summary: { errors: unknown[] } };
    expect(data.summary.errors).toEqual([]);
    await verifyFittedMedia(config, { ...s, imageFit: mode }, data.fittedContent.media);
    const previews = dialog.getByRole("img", { name: /^Fitted / });
    await expect(previews).toHaveCount(s.media.length);
    expect(await previews.evaluateAll((images) => images.map((img) => (img as HTMLImageElement).src))).toEqual(
      data.fittedContent.media.map((m) => m.url),
    );
    await expect(dialog.getByRole("button", { name: "Use these images" })).toBeEnabled();
    return data.fittedContent;
  };
  await generate("blur");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await open();
  expect(await originals(), "Cancel must leave the draft's source media unchanged").toEqual(sourceUrls);
  await generate(s.imageFit === "crop" ? "blur" : "crop");
  const prepared = await generate(s.imageFit!);
  await dialog.getByRole("button", { name: "Use these images", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const files = await mediaFiles(config, s.media);
  for (const [index, url] of sourceUrls.entries()) {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    expect(response.ok).toBe(true);
    const digest = createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex");
    expect(digest, "Preview and Apply must not overwrite the uploaded original").toBe(files[index].sha256);
  }
  return prepared.media.map((m) => m.url);
}

export async function reviewImageFit(page: Page, config: LiveConfig, s: Materialized): Promise<string[]> {
  const unexpected: string[] = [];
  const pattern = (url: URL) =>
    url.origin === new URL(config.baseUrl).origin && /^\/api\/v1\/posts(?:\/|$)/.test(url.pathname);
  const guard = async (route: Route) => {
    if (["POST", "PATCH", "DELETE"].includes(route.request().method())) {
      unexpected.push(route.request().method());
      await route.abort();
    } else await route.continue();
  };
  await page.route(pattern, guard);
  try {
    const urls = await review(page, config, s);
    expect(unexpected, "Review, Cancel and Apply must never create, edit or publish a server post").toEqual([]);
    return urls;
  } finally {
    await page.unroute(pattern, guard);
  }
}
