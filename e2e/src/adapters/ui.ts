import { expect, type Page, type Route, type Response } from "@playwright/test";
import type { Account, LiveConfig } from "../config.js";
import type { Materialized, MediaFile, Options, Receipt } from "../types.js";
import { parsePostingResponse, receiptFrom } from "../http.js";
import { mediaFiles } from "../media.js";
import { createHash } from "node:crypto";
export class UiSubmissionBlockedError extends Error {}

export async function waitForMedia(page: Page, media: MediaFile[], timeout: number) {
  const counts = new Map<string, number>();
  for (const file of media) counts.set(file.filename, (counts.get(file.filename) ?? 0) + 1);
  for (const [filename, count] of counts) {
    // Only completed cards have preview media and a remove button. Upload cards
    // display a filename and numeric progress, including for videos with no poster.
    const cards = page
      .locator("form div.relative.group")
      .filter({ has: page.getByText(filename, { exact: true }) })
      .filter({ has: page.locator("button") });
    await expect(cards.locator("img, video"), `Wait for ${count} completed upload(s): ${filename}`).toHaveCount(count, {
      timeout,
    });
  }
}
const labels: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
  CONNECTIONS: "Connections Only",
  PUBLIC: "Public",
  private: "Private",
  unlisted: "Unlisted",
  public: "Public",
  draft: "Upload to TikTok inbox",
  "22": "People & Blogs",
};
function fieldId(platform: string, key: string) {
  if (key === "title" || key === "description") return `${platform}-${key}`;
  if (platform === "pinterest") return `pinterest-${key}`;
  if (platform === "forem") return `forem-${key}`;
  if (platform === "linkedin" && key === "visibility") return "linkedin-visibility";
  if (key === "photoCoverIndex") return "tiktok-cover";
  if (key === "privacyLevel") return "visibility";
  if (key === "selfDeclaredMadeForKids") return "madeForKids";
  if (key === "thumbnailUrl") return "thumbnail";
  return key;
}
export async function verifyUiThumbnail(config: LiveConfig, url: unknown): Promise<void> {
  if (typeof url !== "string" || !url) throw new Error("Thumbnail upload returned no preview URL");
  const [file] = await mediaFiles(config, ["image"]);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("Uploaded thumbnail cannot be read back");
  expect(
    createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex"),
    "Uploaded thumbnail must match the exact original fixture",
  ).toBe(file.sha256);
}
export async function setOptions(page: Page, account: Account, s: Materialized, config?: LiveConfig): Promise<Options> {
  const submittedOptions = { ...s.options };
  // Disclosure controls reveal dependent fields, so apply them in input insertion order.
  for (const [key, value] of Object.entries(s.options)) {
    if (s.options.publishMode === "draft" && ["privacyLevel", "autoAddMusic"].includes(key)) continue;
    const field = page.locator(`[id=${JSON.stringify(`${account.id}-${fieldId(s.platform, key)}`)}]`);
    if (key === "thumbnailUrl" && s.platform === "youtube") {
      if (!config) throw new Error("Thumbnail upload requires fixture configuration");
      const [file] = await mediaFiles(config, ["image"]);
      await field.setInputFiles(file.path);
      const preview = page.getByAltText("YouTube custom thumbnail", { exact: true });
      await expect(preview).toBeVisible({ timeout: config.publishTimeoutMs });
      const uploadedUrl = await preview.getAttribute("src");
      if (!uploadedUrl) throw new Error("Thumbnail upload returned no preview URL");
      await verifyUiThumbnail(config, uploadedUrl);
      // The UI produces a new upload URL. Verify the bytes before using that URL in the boundary assertion.
      submittedOptions.thumbnailUrl = uploadedUrl;
      continue;
    }
    if (key === "description" && s.platform === "tiktok" && value === "") {
      await page.getByRole("button", { name: "No description", exact: true }).click();
      await expect(field, "TikTok No description must leave the description empty").toHaveValue("");
      continue;
    }
    await expect(field, `UI must expose ${s.platform}.${key}`).toBeVisible();
    const role = await field.getAttribute("role");
    if (role === "switch" || role === "checkbox") {
      // Persist an explicit value even when a control initially displays its implicit default.
      if (((await field.getAttribute("aria-checked")) === "true") === value) await field.click();
      if (((await field.getAttribute("aria-checked")) === "true") !== value) await field.click();
      await expect(field).toHaveAttribute("aria-checked", String(value));
    } else if (role === "combobox") {
      const initiallySelected = (await field.innerText()).trim();
      await field.click();
      let label = labels[String(value)] ?? String(value);
      if (key === "publishMode") label = value === "draft" ? "Upload to TikTok inbox" : "Publish Immediately";
      if (key === "photoCoverIndex") label = `Photo ${Number(value) + 1}`;
      if (key === "boardId") {
        const name = account.resources.boardName;
        if (!name) throw new Error("Configure Pinterest resources.boardName for the customer-facing board picker");
        label = String(name);
      }
      // Selecting the already displayed default may not invoke onValueChange.
      // Explicit LinkedIn visibility must still reach the submitted options.
      if (s.platform === "linkedin" && key === "visibility" && initiallySelected === label) {
        const alternate = labels[value === "PUBLIC" ? "CONNECTIONS" : "PUBLIC"];
        await page.getByRole("option", { name: alternate, exact: true }).click();
        await expect(field).toContainText(alternate);
        await field.click();
      }
      const option =
        key === "boardId"
          ? page.getByRole("option").filter({ hasText: label }).first()
          : page.getByRole("option", { name: label, exact: true });
      await option.click();
      await expect(field).toContainText(label);
    } else {
      await field.fill(Array.isArray(value) ? value.join(", ") : String(value ?? ""));
    }
  }
  return submittedOptions;
}
export async function pickSchedule(page: Page, iso: string) {
  const date = new Date(iso);
  // This is the actual custom date/time picker. Context uses UTC and en-US.
  await page.locator("button[aria-invalid]").click();
  const day = page
    .locator(`[data-day=${JSON.stringify(date.toLocaleDateString("en-US", { timeZone: "UTC" }))}]`)
    .first();
  if (!(await day.count())) await page.getByRole("button", { name: /next month/i }).click();
  await day.click();
  await page.locator('input[type="time"][aria-label="Time"]').fill(iso.slice(11, 16));
  await page.keyboard.press("Escape");
}
export function assertUiPayload(raw: Record<string, unknown>, s: Materialized, account: Account, mode: string) {
  expect(raw.accountIds, "Only the exact allowlisted account may be submitted").toEqual([account.id]);
  expect(raw.postingMode).toBe(mode);
  expect(raw.message).toBe(s.mode === "draft-edit" && mode === "draft" ? `${s.message} before edit` : s.message);
  expect((raw.media as unknown[] | undefined)?.length ?? 0, "UI attachment count before submission").toBe(
    s.media.length,
  );
  expect(
    (raw.media as { type: string }[] | undefined)?.map((m) => m.type) ?? [],
    "UI attachment types and mixed-media order",
  ).toEqual(s.media.map((key) => (key === "video" || key === "silentVideo" ? "video" : "image")));
  const actual = (raw.accountOptions as Record<string, Options> | undefined)?.[account.id] ?? {};
  for (const [key, value] of Object.entries(s.options)) {
    if (s.options.publishMode === "draft" && ["privacyLevel", "autoAddMusic"].includes(key)) continue;
    expect(actual[key], `UI lost or changed ${key} before submission`).toEqual(value);
  }
  if (s.thread) expect((raw.thread as { message: string }[])?.map((t) => t.message)).toEqual(s.thread);
  if (mode === "schedule") expect(raw.scheduledFor).toBe(s.scheduledFor);
}
async function submit(
  page: Page,
  config: LiveConfig,
  s: Materialized,
  account: Account,
  mode: string,
  postId?: string,
): Promise<Receipt> {
  const routePath = postId ? `/api/v1/posts/${postId}` : "/api/v1/posts";
  const method = postId ? "PATCH" : "POST";
  let rejectGuard: (error: Error) => void = () => {};
  const guard = new Promise<never>((_, reject) => {
    rejectGuard = reject;
  });
  let forwarded = false;
  const handler = async (route: Route) => {
    if (route.request().method() !== method) return route.continue();
    try {
      assertUiPayload(route.request().postDataJSON(), s, account, mode);
    } catch (error) {
      await route.abort();
      rejectGuard(
        forwarded
          ? (error as Error)
          : new UiSubmissionBlockedError(
              `No post submitted: UI request guard blocked the payload. ${(error as Error).message}`,
            ),
      );
      return;
    }
    forwarded = true;
    await route.continue();
  };
  await page.route(config.baseUrl + routePath, handler);
  let onResponse: (response: Response) => void;
  let responseTimer: ReturnType<typeof setTimeout>;
  const responsePromise = new Promise<Response>((resolve, reject) => {
    onResponse = (response) => {
      if (new URL(response.url()).pathname === routePath && response.request().method() === method) resolve(response);
    };
    page.on("response", onResponse);
    responseTimer = setTimeout(
      () => reject(new Error("INCONCLUSIVE: timed out waiting for UI publish response")),
      config.publishTimeoutMs,
    );
  });
  const outcome = Promise.race([responsePromise, guard]);
  // Prevent a dangling rejection if a disabled button fails first.
  void outcome.catch(() => {});
  try {
    await page.locator('button[type="submit"]').click({ timeout: 60_000 });
    const response = await outcome;
    const body = await response.text();
    if (!response.ok()) throw new Error(`UI publish failed (${response.status()}): ${body.slice(0, 1000)}`);
    return receiptFrom(parsePostingResponse(body, response.headers()["content-type"] ?? ""), account.id);
  } finally {
    clearTimeout(responseTimer!);
    page.off("response", onResponse!);
    await page.unroute(config.baseUrl + routePath, handler);
  }
}
export async function openComposer(page: Page, config: LiveConfig, readyTimeoutMs = 15_000): Promise<void> {
  let loadingReloaded = false;
  // At most three initial GETs. This helper returns before the first form edit;
  // neither draft edits nor unknown submissions ever pass through its retries.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await page.goto(config.baseUrl + "/schedule");
    if (response && [502, 503].includes(response.status()) && attempt < 2) {
      console.log(`Composer GET returned ${response.status()}; retrying before any form action.`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    if (response && response.status() >= 500) {
      const body = (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .trim();
      throw new UiSubmissionBlockedError(
        `No post submitted: scheduler composer unavailable (${response.status()}${body ? `: ${body.slice(0, 240)}` : ""})`,
      );
    }
    try {
      await page.getByLabel("Message", { exact: true }).waitFor({ state: "visible", timeout: readyTimeoutMs });
      return;
    } catch (error) {
      const body = (await page.locator("body").innerText()).trim();
      const emptyLoadingShell =
        /^Loading(?:\.{3}|…)$/.test(body) && !(await page.locator("form, input, textarea, button").count());
      if (
        response?.status() === 200 &&
        new URL(page.url()).pathname === "/schedule" &&
        emptyLoadingShell &&
        !loadingReloaded &&
        attempt < 2
      ) {
        loadingReloaded = true;
        console.log("Composer remained an empty Loading shell; reloading once before any form action.");
        continue;
      }
      throw error;
    }
  }
}
export async function uiCreate(
  page: Page,
  config: LiveConfig,
  s: Materialized,
  account: Account,
  media: MediaFile[],
  beforeSubmit?: () => Promise<void>,
  prepareSchedule?: () => Promise<void>,
): Promise<Receipt> {
  await openComposer(page, config);
  let submittedOptions = s.options;
  const clear = page.getByRole("button", { name: "Clear all", exact: true });
  if (await clear.isEnabled()) await clear.click();
  await page.getByTestId(`account-toggle-${s.platform}-${account.id}`).click();
  await page
    .getByLabel("Message", { exact: true })
    .fill(s.mode === "draft-edit" ? `${s.message} before edit` : s.message);
  if (media.length) {
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(media.map((m) => m.path));
    await waitForMedia(page, media, config.publishTimeoutMs);
  }
  for (const segment of s.thread ?? []) {
    await page.getByRole("button", { name: "Add to thread", exact: true }).click();
    await page.getByPlaceholder("Continue your thread…").last().fill(segment);
  }
  if (Object.keys(s.options).length) {
    await page.locator(`a[href=${JSON.stringify(`/schedule/advanced/${account.id}`)}]`).click();
    submittedOptions = await setOptions(page, account, s, config);
    await page.getByRole("link", { name: "Back to create post", exact: true }).click();
  }
  const mode =
    s.mode === "draft" || s.mode === "draft-edit"
      ? "draft"
      : s.mode === "schedule" || s.mode === "cancel"
        ? "schedule"
        : "now";
  await page.locator(`#post-${mode === "schedule" ? "schedule" : mode}`).click();
  if (mode === "schedule") {
    await prepareSchedule?.();
    await pickSchedule(page, s.scheduledFor!);
  }
  const consent = page.locator("#tiktok-consent-create");
  if (await consent.isVisible()) await consent.check();
  await beforeSubmit?.();
  return submit(page, config, { ...s, options: submittedOptions }, account, mode);
}
export async function uiEditDraft(
  page: Page,
  config: LiveConfig,
  s: Materialized,
  account: Account,
  id: string,
  prepareSchedule?: () => Promise<void>,
): Promise<Receipt> {
  await page.goto(`${config.baseUrl}/posts/${id}/edit`);
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(`${s.message} before edit`);
  await page.reload();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(`${s.message} before edit`);
  await page.getByLabel("Message", { exact: true }).fill(s.message);
  const submittedOptions = await setOptions(page, account, s, config);
  await page.locator("#post-schedule").click();
  await prepareSchedule?.();
  await pickSchedule(page, s.scheduledFor!);
  const consent = page.locator("#tiktok-consent-edit");
  if (await consent.isVisible()) await consent.check();
  return submit(page, config, { ...s, options: submittedOptions }, account, "schedule", id);
}
