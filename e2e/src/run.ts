import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LiveConfig, Account } from "./config.js";
import { runId } from "./config.js";
import { redact } from "./redact.js";
import { materialize } from "./catalog.js";
import { assertRequirements } from "./preflight.js";
import { Journal } from "./journal.js";
import { mediaFiles } from "./media.js";
import { SchedulerApi, receiptFrom, type PostRecord } from "./http.js";
import { McpClient, mcpCreate } from "./adapters/mcp.js";
import { cliCreate } from "./adapters/cli.js";
import { uiCreate, uiEditDraft, UiSubmissionBlockedError, verifyUiThumbnail } from "./adapters/ui.js";
import { verifyOnPlatform } from "./verification/browser.js";
import { verifyPublishingProgress } from "./verification/publishing.js";
import type { Interface, Scenario, Materialized, Receipt, JournalEntry, PostingResult } from "./types.js";
export function publishingFailure(result: PostingResult): string {
  const detail = [...new Set([result.error, result.message].filter((value): value is string => Boolean(value)))];
  return (
    detail.map((value) => redact(value).replace(/\s+/g, " ").slice(0, 800)).join(": ") ||
    "Platform did not report successful publishing"
  );
}
export function nextScheduleTime(config: LiveConfig, now = Date.now()): string {
  // One minute of lead time, rounded up to the UI picker's minute precision.
  return new Date(Math.ceil(now / 60_000) * 60_000 + config.scheduleDelayMinutes * 60_000).toISOString();
}
async function assertSaved(post: PostRecord, s: Materialized, account: Account, config: LiveConfig, iface: Interface) {
  if (post.userId) expect(post.userId).toBe(config.userId);
  if (post.accountIds) expect(post.accountIds).toEqual([account.id]);
  if (post.accounts) expect(post.accounts.map((a) => a.id)).toEqual([account.id]);
  for (const [key, value] of Object.entries(s.options)) {
    const actual = post.accountOptions?.[account.id]?.[key];
    if (iface === "ui" && s.platform === "youtube" && key === "thumbnailUrl") {
      expect(s.expectedFields.thumbnailImage, "UI thumbnail must identify its original fixture").toBe("image");
      await verifyUiThumbnail(config, actual);
    } else expect(actual, `Persisted ${key}`).toEqual(value);
  }
  expect(post.media?.length ?? 0).toBe(s.media.length);
}
export function clearVerifiedError(entry: JournalEntry) {
  if (!entry.error) return;
  entry.historicalErrors = [...(entry.historicalErrors ?? []), entry.error];
  delete entry.error;
}
export class DispatchFailedError extends Error {
  constructor(public readonly receipt: Receipt) {
    super(
      `Scheduled dispatch failed on the real posting path: ${redact(JSON.stringify(receipt.results))}. Inspect publishing progress; do not automatically republish.`,
    );
  }
}
export async function waitForDispatch(
  api: SchedulerApi,
  id: string,
  s: Materialized,
  account: Account,
  config: LiveConfig,
  iface: Interface = "mcp",
): Promise<Receipt> {
  const due = Date.parse(s.scheduledFor!);
  const deadline = due + config.dispatchAllowanceMs + config.publishTimeoutMs;
  do {
    const post = await api.post(id);
    await assertSaved(post, s, account, config, iface);
    expect(post.message).toBe(s.message);
    if (post.status === "failed") throw new DispatchFailedError(receiptFrom({ post }, account.id));
    if (Date.now() < due) expect(post.status, "Must not publish before the scheduled time").toBe("scheduled");
    if (post.status === "published") {
      const result = receiptFrom({ post }, account.id);
      // Observe again to detect immediate status/result changes; broad concurrent claim coverage is local.
      await new Promise((r) => setTimeout(r, 2000));
      const again = await api.post(id);
      expect(again.accountResults).toEqual(post.accountResults);
      return result;
    }
    await new Promise((r) => setTimeout(r, 5000));
  } while (Date.now() < deadline);
  throw new Error(
    "INCONCLUSIVE: scheduled post did not complete within the dispatch allowance. Resume verification, not publishing.",
  );
}
async function cancel(
  page: Page,
  api: SchedulerApi,
  mcp: McpClient | undefined,
  config: LiveConfig,
  iface: Interface,
  id: string,
) {
  if (iface === "mcp") await mcp!.call("discard_scheduled_post", { postId: id });
  else {
    await page.goto(`${config.baseUrl}/posts/${id}`);
    await page.getByRole("button", { name: "Delete post", exact: true }).click();
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/v1/posts/${id}` && r.request().method() === "DELETE",
    );
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    expect((await response).ok()).toBe(true);
  }
  await expect(async () => {
    try {
      await api.post(id);
      throw new Error("Canceled post is still present");
    } catch (e) {
      expect((e as Error).message).toContain("(404)");
    }
  }).toPass({ timeout: 10_000 });
}
export async function runScenario(
  config: LiveConfig,
  scenario: Scenario,
  iface: Interface,
  page: Page,
  browser: Browser,
  info: TestInfo,
) {
  const account = config.accounts[scenario.platform];
  if (!account) throw new Error(`Missing ${scenario.platform} account`);
  const initial = materialize(scenario, account, iface, runId(), config.mediaBaseUrl, config.fixtureUrls);
  assertRequirements(initial, account);
  const journal = new Journal(config, runId());
  const existing = await journal.get(`${iface}/${initial.id}`);
  if (
    existing &&
    !initial.expectedError &&
    !existing.scenario.expectedError &&
    !existing.receipt &&
    ["submitting", "inconclusive"].includes(existing.phase)
  ) {
    if (existing.accountId !== account.id)
      throw new Error("INCONCLUSIVE: recovery account differs from the saved journal; no receipt recovered.");
    const api = new SchedulerApi(config);
    const matches = (await api.publishedSince(existing.createdAt)).filter(
      (post) =>
        post.status === "published" &&
        post.message === initial.message &&
        post.accountIds?.length === 1 &&
        post.accountIds[0] === account.id &&
        post.media?.length === initial.media.length &&
        post.accountResults?.[account.id]?.success === true,
    );
    if (matches.length > 1)
      throw new Error(`INCONCLUSIVE: found multiple matching published posts for ${existing.key}; reconcile manually.`);
    if (matches.length === 1) {
      await assertSaved(matches[0], initial, account, config, iface);
      existing.receipt = receiptFrom({ post: matches[0] }, account.id);
      existing.phase = "accepted";
      existing.cleanup = "review-external-post";
      await journal.save(existing);
      console.log(`[${iface}/${initial.id}] Reconciled an accepted submission from the scheduler history.`);
    }
  }
  if (process.env.E2E_VERIFY_ONLY === "1" && !(await journal.get(`${iface}/${initial.id}`))?.receipt)
    throw new Error("BLOCKED: verification-only mode requires an existing receipt. No submission was sent.");
  const entry = await journal.reserve(initial, iface, account);
  const s = entry.scenario;
  const progress = (message: string) => console.log(`[${iface}/${s.id}] ${message}`);
  const api = new SchedulerApi(config);
  let mcp: McpClient | undefined;
  const prepareSchedule = async () => {
    s.scheduledFor = nextScheduleTime(config);
    await journal.save(entry);
  };
  const record = async (receipt: Receipt) => {
    entry.receipt = receipt;
    entry.phase = "accepted";
    entry.cleanup =
      receipt.status === "scheduled" || receipt.status === "draft"
        ? "pending-schedule"
        : receipt.status === "failed" || receipt.results.length
          ? "review-external-post"
          : "not-created";
    await journal.save(entry);
    progress(
      `Saved receipt: ${receipt.status ?? "accepted"}${receipt.simplePostId ? ` (${receipt.simplePostId})` : ""}.`,
    );
  };
  try {
    const reobservePublished =
      process.env.E2E_VERIFY_ONLY === "1" && entry.receipt?.results.some((result) => result.success && result.postId);
    if (entry.phase === "verified" && !reobservePublished) {
      clearVerifiedError(entry);
      await journal.save(entry);
      info.annotations.push({ type: "resumed", description: "Already verified in this run; no new submission" });
      return;
    }
    if (entry.phase === "verified" && reobservePublished)
      progress("Rechecking the existing published receipt with the current platform observer; no new submission.");
    if (iface === "mcp") {
      mcp = new McpClient(config);
      await mcp.connect();
    }
    if (process.env.E2E_VERIFY_ONLY === "1" && !entry.receipt)
      throw new Error("BLOCKED: verification-only mode requires an existing receipt. No submission was sent.");
    if (!entry.receipt) {
      progress("Preparing and submitting through the customer interface.");
      const media = await mediaFiles(config, s.media);
      const beforeSubmit = async () => {
        entry.phase = "submitting";
        await journal.save(entry);
      };
      if (iface !== "ui") await beforeSubmit();
      let receipt: Receipt;
      if (iface === "mcp")
        receipt = await mcpCreate(mcp!, s, account, media, `${runId()}/${entry.key}`, record, prepareSchedule);
      else if (iface === "ui") receipt = await uiCreate(page, config, s, account, media, beforeSubmit, prepareSchedule);
      else receipt = await cliCreate(config, s, account, media, iface, journal.dir);
      await record(receipt);
    }
    if (s.expectedError) {
      expect(entry.receipt!.status, "Invalid content must be rejected, never posted").toBe("validation-rejected");
      entry.phase = "verified";
      clearVerifiedError(entry);
      await journal.save(entry);
      return;
    }
    if (iface === "cli-app" && !entry.receipt!.simplePostId) {
      const id = entry.receipt!.results[0]?.postId;
      const found = (await api.recent()).filter((p) =>
        Object.values(p.accountResults ?? {}).some((r) => r.accountId === account.id && r.postId === id),
      );
      expect(found, "Locate the CLI-created scheduler post by exact account and returned platform ID").toHaveLength(1);
      await record(receiptFrom({ post: found[0] }, account.id));
    }
    let receipt = entry.receipt!;
    progress("Checking the saved post and publishing results.");
    if (receipt.simplePostId) {
      const post = await api.post(receipt.simplePostId);
      await assertSaved(post, s, account, config, iface);
      if (iface === "mcp") {
        const inspected = await mcp!.call<{ posts: PostRecord[] }>("inspect_posts", { postId: post.id });
        expect(inspected.posts).toHaveLength(1);
        expect(inspected.posts[0].accountOptions).toEqual(post.accountOptions);
      }
      if (s.mode === "cancel") {
        if (process.env.E2E_VERIFY_ONLY === "1")
          throw new Error("BLOCKED: verification-only mode does not cancel existing posts.");
        expect(post.status, "Cancellation must happen while the post is still scheduled").toBe("scheduled");
        expect(Date.parse(s.scheduledFor!), "Cancellation must precede the dispatch time").toBeGreaterThan(Date.now());
        expect(Object.keys(post.accountResults ?? {})).toHaveLength(0);
        await verifyPublishingProgress(api, receipt, account.id, 0);
        await cancel(page, api, mcp, config, iface, post.id);
        entry.cleanup = "discarded";
        entry.phase = "verified";
        clearVerifiedError(entry);
        await journal.save(entry);
        return;
      }
      if (s.mode === "draft") {
        expect(post.status).toBe("draft");
        expect(Object.keys(post.accountResults ?? {})).toHaveLength(0);
        await verifyPublishingProgress(api, receipt, account.id, 0);
        if (process.env.E2E_VERIFY_ONLY === "1") {
          info.annotations.push({
            type: "verified-draft",
            description: "Draft remains saved; verification-only mode does not delete it",
          });
          return;
        }
        await cancel(page, api, mcp, config, iface, post.id);
        entry.cleanup = "discarded";
        entry.phase = "verified";
        clearVerifiedError(entry);
        await journal.save(entry);
        return;
      }
      if (s.mode === "draft-edit" && post.status === "draft") {
        await verifyPublishingProgress(api, receipt, account.id, 0);
        if (process.env.E2E_VERIFY_ONLY === "1")
          throw new Error("BLOCKED: draft has not yet been scheduled; verification-only mode does not edit it.");
        expect(post.message).toBe(`${s.message} before edit`);
        // Choose a fresh time only when converting the saved draft to a schedule.
        if (iface === "mcp") {
          await prepareSchedule();
          await mcp!.call("update_scheduled_post", {
            postId: post.id,
            message: s.message,
            accountOptions: { [account.id]: s.options },
            postingMode: "schedule",
            scheduledFor: s.scheduledFor,
          });
          receipt = receiptFrom({ post: await api.post(post.id) }, account.id);
        } else receipt = await uiEditDraft(page, config, s, account, post.id, prepareSchedule);
        await record(receipt);
      }
      if (s.mode === "schedule" || s.mode === "draft-edit") {
        progress(`Waiting for scheduled dispatch at ${s.scheduledFor}.`);
        receipt = await waitForDispatch(api, post.id, s, account, config, iface);
        await record(receipt);
      }
    }
    expect(receipt.results).toHaveLength(1);
    const result = receipt.results[0];
    expect(result.accountId).toBe(account.id);
    expect(result.success, publishingFailure(result)).toBe(true);
    expect(result.postId, "A publishing handle must be returned").toBeTruthy();
    if (iface !== "cli-local") {
      progress("Checking durable publishing records.");
      const publishingRecords = await verifyPublishingProgress(api, receipt, account.id, 1 + (s.thread?.length ?? 0));
      const file = path.join(journal.dir, `${s.token}-publishing-progress.json`);
      await writeFile(file, JSON.stringify(publishingRecords, null, 2), { mode: 0o600 });
      await info.attach("publishing-progress", { path: file, contentType: "application/json" });
    }
    progress(`Publishing succeeded (platform ID ${result.postId}). Opening the platform to verify the content.`);
    const verificationWindow = { from: entry.createdAt, to: entry.updatedAt };
    const evidence = await verifyOnPlatform(browser, config, s, account, result, journal.dir, verificationWindow);
    for (let i = 0; i < (s.thread?.length ?? 0); i++) {
      const segments = result.threadResults ?? [];
      // Thread results include the root segment at index 0.
      const segment = segments[i + 1];
      expect(segment, `Thread segment ${i + 1} receipt`).toBeTruthy();
      expect(segment.success, publishingFailure(segment)).toBe(true);
      const child: Materialized = {
        ...s,
        // The child text contains the run token, but not the synthetic segment
        // suffix used for local evidence filenames. Match the actual text so
        // the child permalink can be located on platforms that render the
        // whole thread on every segment page.
        token: s.thread![i],
        message: s.thread![i],
        expectedText: s.thread![i],
        media: [],
        expectedFields: s.platform === "x" ? { replyToId: segments[i].postId! } : {},
        expectedTitle: undefined,
        thread: undefined,
      };
      evidence.push(
        ...(await verifyOnPlatform(browser, config, child, account, segment, journal.dir, verificationWindow)),
      );
    }
    entry.phase = "verified";
    entry.evidence = evidence;
    clearVerifiedError(entry);
    await journal.save(entry);
    for (const file of evidence) await info.attach(path.basename(file), { path: file, contentType: "image/png" });
  } catch (error) {
    if (error instanceof DispatchFailedError) await record(error.receipt);
    entry.error = redact((error as Error).message);
    entry.phase = entry.receipt
      ? "inconclusive"
      : entry.phase === "submitting" && !(error instanceof UiSubmissionBlockedError)
        ? "submitting"
        : "blocked";
    await journal.save(entry);
    throw new Error(entry.error);
  } finally {
    if (mcp) await mcp.close();
    await info.attach("run-journal", {
      body: await readFile(journal.file(entry.key)),
      contentType: "application/json",
    });
    if (iface === "ui")
      await page.screenshot({ path: info.outputPath("scheduler.png"), fullPage: true }).catch(() => {});
    // A cleanup ledger remains even after process interruption. External deletion is deliberately
    // not guessed: owners can review exact post URLs and remove only run-owned posts.
    await writeFile(
      path.join(journal.dir, "cleanup.json"),
      JSON.stringify(
        (await journal.entries())
          .filter((e) => e.cleanup !== "not-created" && e.cleanup !== "discarded")
          .map((e) => ({ scenario: e.key, accountId: e.accountId, status: e.cleanup, post: e.receipt })),
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
}
