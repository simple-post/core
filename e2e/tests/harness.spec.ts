import { test, expect } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import { Journal } from "../src/journal.js";
import { catalog, materialize } from "../src/catalog.js";
import { platforms, interfaces } from "../src/types.js";
import type { JournalEntry } from "../src/types.js";
import { config, account, serve, json } from "./helpers.js";
import { assertRequirements, assertAccountIdentity } from "../src/preflight.js";
import { parsePostingResponse, receiptFrom } from "../src/http.js";
import { parseCliId } from "../src/adapters/cli.js";
import { allowedHost, postUrl, assertPostId } from "../src/verification/browser.js";
import { assertUiPayload } from "../src/adapters/ui.js";
import { redact } from "../src/redact.js";
import { optionCoverage } from "../src/coverage-inventory.js";
import { clearVerifiedError, runScenario, publishingFailure } from "../src/run.js";
test("publishing failures retain provider reason alongside classification and redact credentials", () => {
  const result = {
    success: false,
    error: "PUBLISH_OUTCOME_UNKNOWN",
    message: "YouTube uploadLimitExceeded; Authorization: Bearer secret-token",
  };
  const message = publishingFailure(result);
  expect(message).toContain("PUBLISH_OUTCOME_UNKNOWN");
  expect(message).toContain("uploadLimitExceeded");
  expect(message).not.toContain("secret-token");
  expect(result.error).toBe("PUBLISH_OUTCOME_UNKNOWN");
});
const scenario = catalog.find((x) => x.id === "tiktok.photos-2-music-false-custom")!;
test("every current SDK platform option has a scenario or an explicit coverage gap", () => {
  expect(optionCoverage().filter((o) => o.status === "unclassified")).toEqual([]);
});
test("catalog accounts for every platform and executable interface", () => {
  expect(new Set(catalog.map((c) => c.id)).size).toBe(catalog.length);
  for (const platform of platforms) {
    const smoke = catalog.find((c) => c.platform === platform && c.tags.includes("smoke"))!;
    expect(smoke).toBeTruthy();
    for (const iface of interfaces) expect(smoke.interfaces).toContain(iface);
    for (const mode of ["schedule", "draft-edit", "cancel"])
      expect(catalog.some((c) => c.platform === platform && c.mode === mode)).toBe(true);
  }
});
test("explicit false, zero, and empty survive independent scenario materialization", () => {
  const s = materialize(
    { ...scenario, options: { autoAddMusic: false, photoCoverIndex: 0, description: "" } },
    account(),
    "mcp",
    "run",
    "https://media.example.com",
  );
  expect(s.options).toMatchObject({ autoAddMusic: false, photoCoverIndex: 0, description: "" });
  expect(s.expectedText).toBe("");
});
test("only the documented MCP omitted-music behavior differs by interface", () => {
  const s = catalog.find((c) => c.id === "tiktok.music-omitted")!;
  expect(materialize(s, account(), "mcp", "r", "https://media.example.com").expectedFields.autoAddMusic).toBe(true);
  expect(materialize(s, account(), "ui", "r", "https://media.example.com").expectedFields.autoAddMusic).toBe(false);
});
test("UI boundary catches lost privacy, empty strings, false and unintended account targets", () => {
  const a = account(),
    s = materialize(
      { ...scenario, options: { privacyLevel: "SELF_ONLY", autoAddMusic: false, description: "" } },
      a,
      "ui",
      "r",
      "https://media.example.com",
    );
  const payload = {
    accountIds: [a.id],
    message: s.message,
    postingMode: "now",
    media: [{ type: "image" }, { type: "image" }],
    accountOptions: { [a.id]: s.options },
  };
  expect(() => assertUiPayload(payload, s, a, "now")).not.toThrow();
  expect(() => assertUiPayload({ ...payload, accountIds: [a.id, "customer-account"] }, s, a, "now")).toThrow();
  for (const key of ["privacyLevel", "description", "autoAddMusic"]) {
    const options = { ...s.options };
    delete options[key];
    expect(() => assertUiPayload({ ...payload, accountOptions: { [a.id]: options } }, s, a, "now")).toThrow();
  }
});
test("missing platform-side privacy verification blocks before publishing", () => {
  const a = account(),
    s = materialize(scenario, a, "mcp", "r", "https://media.example.com");
  expect(() => assertRequirements(s, a)).toThrow("BLOCKED before posting");
});
test("API account ownership and identity are both checked", () => {
  const cfg = config(),
    a = account();
  const actual = { ...a, userId: cfg.userId, platform: "x" };
  expect(() => assertAccountIdentity(cfg, "x", a, actual)).not.toThrow();
  for (const bad of [
    { userId: "another-user" },
    { platformAccountId: "wrong" },
    { previewOnly: true },
    { username: "other" },
  ])
    expect(() => assertAccountIdentity(cfg, "x", a, { ...actual, ...bad })).toThrow();
});
test("accounts with no API username retain strict user and platform identity checks", () => {
  const a = account({ username: "channel-handle", apiUsername: null });
  const actual = { ...a, userId: "user-1", platform: "youtube", username: null };
  expect(() => assertAccountIdentity(config(), "youtube", a, actual)).not.toThrow();
  expect(() =>
    assertAccountIdentity(config(), "youtube", a, { ...actual, platformAccountId: "other-channel" }),
  ).toThrow();
  expect(() => assertAccountIdentity(config(), "youtube", a, { ...actual, username: "unexpected" })).toThrow();
});
test("interrupted submission cannot be blindly retried, including negative cases", async () => {
  const runDir = await mkdtemp(os.tmpdir() + "/simplepost-e2e-");
  const j = new Journal(config({ runDir }), "run");
  const s = materialize(scenario, account(), "mcp", "run", "https://media.example.com");
  const entry = await j.reserve(s, "mcp", account());
  entry.phase = "submitting";
  await j.save(entry);
  await expect(j.reserve(s, "mcp", account())).rejects.toThrow("INCONCLUSIVE");
  entry.phase = "accepted";
  entry.receipt = { results: [{ success: true, postId: "123" }] };
  await j.save(entry);
  expect((await j.reserve(s, "mcp", account())).receipt?.results[0].postId).toBe("123");
  await expect(j.reserve({ ...s, message: "changed" }, "mcp", account())).rejects.toThrow("different payload");
});
test("verification-only resumes a receipt after a deployment revision changes", async () => {
  const runDir = await mkdtemp(os.tmpdir() + "/simplepost-verify-revision-");
  const oldMode = process.env.E2E_VERIFY_ONLY;
  const original = materialize(scenario, account(), "mcp", "run", "https://media.example.com");
  const changed = materialize(scenario, account(), "mcp", "run", "https://media.example.com");
  const oldJournal = new Journal(config({ runDir, deploymentRevision: "old-build" }), "run");
  const entry = await oldJournal.reserve(original, "mcp", account());
  entry.receipt = { results: [{ success: true, postId: "published" }] };
  entry.phase = "accepted";
  await oldJournal.save(entry);
  const journal = new Journal(config({ runDir, deploymentRevision: "new-build" }), "run");
  process.env.E2E_VERIFY_ONLY = "1";
  try {
    await expect(journal.reserve(changed, "mcp", account())).resolves.toMatchObject({ receipt: entry.receipt });
  } finally {
    if (oldMode === undefined) delete process.env.E2E_VERIFY_ONLY;
    else process.env.E2E_VERIFY_ONLY = oldMode;
  }
});
test("daily account budget spans run IDs and interfaces", async () => {
  const runDir = await mkdtemp(os.tmpdir() + "/simplepost-e2e-");
  const cfg = config({ runDir, perPlatformBudget: { tiktok: 1 } });
  const s = materialize(scenario, account(), "mcp", "first", "https://media.example.com");
  await new Journal(cfg, "first").reserve(s, "mcp", account());
  await expect(new Journal(cfg, "second").reserve(s, "ui", account())).rejects.toThrow("24-hour budget");
});
test("Telegram album messages count individually against the run budget", async () => {
  const runDir = await mkdtemp(os.tmpdir() + "/simplepost-album-budget-");
  const cfg = config({ runDir, maxPosts: 10 });
  const a = account();
  const j = new Journal(cfg, "album");
  const album = materialize(catalog.find((c) => c.id === "telegram.album-10")!, a, "mcp", "album", cfg.mediaBaseUrl);
  await j.reserve(album, "mcp", a);
  const next = materialize(catalog.find((c) => c.id === "telegram.smoke")!, a, "mcp", "album", cfg.mediaBaseUrl);
  await expect(j.reserve(next, "mcp", a)).rejects.toThrow("run post budget");
});
test("partial streaming result is never treated as final success", () => {
  expect(() => parsePostingResponse('{"type":"result","result":{"success":true}}\n', "application/x-ndjson")).toThrow(
    "INCONCLUSIVE",
  );
  expect(
    parsePostingResponse('{"type":"result"}\n{"type":"complete","data":{"post":{"id":"1"}}}\n', "application/x-ndjson"),
  ).toEqual({ post: { id: "1" } });
});
test("CLI parsing requires one platform ID", () => {
  expect(parseCliId("Succeeded (1)\n ✓ Test (id: 12345)")).toBe("12345");
  expect(() => parseCliId("success")).toThrow("INCONCLUSIVE");
  expect(() => parseCliId("(id: 1) (id: 2)")).toThrow("INCONCLUSIVE");
});
test("processing handles and arbitrary links cannot masquerade as platform posts", () => {
  const a = account({ observer: { profileUrl: "https://www.tiktok.com/@testuser", fields: {}, open: [] } }),
    s = materialize(scenario, a, "mcp", "r", "https://media.example.com");
  expect(postUrl(s, a, { success: true, postId: "v_pub_file~123" })).toBeUndefined();
  for (const url of [
    "https://tiktok.com.evil.example/post/123",
    "https://evil.example",
    "http://www.tiktok.com/@testuser",
    "https://user:pass@www.tiktok.com/@testuser",
  ])
    expect(allowedHost("tiktok", url, a)).toBe(false);
});
test("diagnostics redact known and embedded credentials", () => {
  process.env.E2E_API_TOKEN = "secret-value-123";
  expect(redact("Bearer secret-value-123 access_token=secret-value-456")).not.toContain("secret-value");
  delete process.env.E2E_API_TOKEN;
});
test("canonical URLs preserve platform IDs, including captionless Bluesky posts", () => {
  const a = account({ observer: { profileUrl: "https://bsky.app/profile/testuser", fields: {}, open: [] } });
  const s = materialize(
    catalog.find((c) => c.id === "bluesky.image-no-caption")!,
    a,
    "cli-local",
    "r",
    "https://media.example.com",
  );
  expect(postUrl(s, a, { success: true, postId: "at://did:plc:123/app.bsky.feed.post/456" })).toBe(
    "https://bsky.app/profile/did%3Aplc%3A123/post/456",
  );
  expect(() => assertPostId("x", "https://x.com/testuser/status/123/photo/1", "123")).not.toThrow();
  expect(() => assertPostId("youtube", "https://youtube.com/watch?v=wrong", "correct")).toThrow();
});
test("scheduled thread verification retains every stored segment receipt", () => {
  const children = [
    { success: true, postId: "root" },
    { success: true, postId: "child" },
  ];
  const receipt = receiptFrom(
    {
      post: {
        id: "scheduled",
        accountResults: { a: { accountId: "a", success: true, postId: "root" } },
        threadResults: { a: children },
      },
    },
    "a",
  );
  expect(receipt.results[0].threadResults).toEqual(children);
});
test("verified journal entries move stale errors into historical evidence", () => {
  const entry: JournalEntry = {
    key: "mcp/facebook.video",
    digest: "digest",
    platform: "facebook",
    interface: "mcp",
    scenario: {} as never,
    accountId: "account",
    phase: "verified",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    error: "old observer selector failed",
    cleanup: "review-external-post",
  };
  clearVerifiedError(entry);
  expect(entry.error).toBeUndefined();
  expect(entry.historicalErrors).toEqual(["old observer selector failed"]);
});
test("verification-only cannot reserve or submit a new scenario", async ({ page, browser }, info) => {
  const oldMode = process.env.E2E_VERIFY_ONLY,
    oldRun = process.env.E2E_RUN_ID;
  const cfg = config({ runDir: await mkdtemp(os.tmpdir() + "/simplepost-verify-only-") });
  process.env.E2E_VERIFY_ONLY = "1";
  process.env.E2E_RUN_ID = "read-only";
  try {
    await expect(runScenario(cfg, catalog.find((s) => s.id === "x.smoke")!, "ui", page, browser, info)).rejects.toThrow(
      "requires an existing receipt",
    );
    expect(await new Journal(cfg, "read-only").entries()).toEqual([]);
  } finally {
    if (oldMode === undefined) delete process.env.E2E_VERIFY_ONLY;
    else process.env.E2E_VERIFY_ONLY = oldMode;
    if (oldRun === undefined) delete process.env.E2E_RUN_ID;
    else process.env.E2E_RUN_ID = oldRun;
  }
});
test("verification-only rechecks previously verified published receipts instead of silently skipping them", async ({
  page,
  browser,
}, info) => {
  const oldMode = process.env.E2E_VERIFY_ONLY,
    oldRun = process.env.E2E_RUN_ID,
    oldToken = process.env.E2E_API_TOKEN;
  const calls: string[] = [];
  const server = await serve((req, res) => {
    calls.push(req.method!);
    json(res, { error: "saved-receipt-read-sentinel" }, 500);
  });
  const a = account({ observer: { profileUrl: "https://bsky.app/profile/testuser", open: [], fields: {} } });
  const cfg = config({
    baseUrl: server.url,
    runDir: await mkdtemp(os.tmpdir() + "/simplepost-reobserve-"),
    accounts: { bluesky: a },
    maxPosts: 10,
  });
  const scenario = catalog.find((s) => s.id === "bluesky.smoke")!;
  process.env.E2E_RUN_ID = "reobserve";
  process.env.E2E_API_TOKEN = "offline-token";
  try {
    const journal = new Journal(cfg, "reobserve");
    const entry = await journal.reserve(materialize(scenario, a, "ui", "reobserve", cfg.mediaBaseUrl), "ui", a);
    entry.phase = "verified";
    entry.receipt = {
      simplePostId: "saved-post",
      status: "published",
      results: [{ accountId: a.id, success: true, postId: "saved-platform-post" }],
    };
    await journal.save(entry);
    process.env.E2E_VERIFY_ONLY = "0";
    await runScenario(cfg, scenario, "ui", page, browser, info);
    expect(calls).toEqual([]);
    process.env.E2E_VERIFY_ONLY = "1";
    await expect(runScenario(cfg, scenario, "ui", page, browser, info)).rejects.toThrow("saved-receipt-read-sentinel");
    expect(calls).toEqual(["GET"]);
    expect((await journal.get(entry.key))?.receipt).toEqual(entry.receipt);
  } finally {
    if (oldMode === undefined) delete process.env.E2E_VERIFY_ONLY;
    else process.env.E2E_VERIFY_ONLY = oldMode;
    if (oldRun === undefined) delete process.env.E2E_RUN_ID;
    else process.env.E2E_RUN_ID = oldRun;
    if (oldToken === undefined) delete process.env.E2E_API_TOKEN;
    else process.env.E2E_API_TOKEN = oldToken;
    await server.close();
  }
});

for (const hasProviderResult of [true, false])
  test(`failed dispatch persists the observed receipt and uncertain cleanup (provider result: ${hasProviderResult})`, async ({
    page,
    browser,
  }, info) => {
    const savedEnv = {
      E2E_VERIFY_ONLY: process.env.E2E_VERIFY_ONLY,
      E2E_RUN_ID: process.env.E2E_RUN_ID,
      E2E_API_TOKEN: process.env.E2E_API_TOKEN,
    };
    const a = account({ observer: { profileUrl: "https://bsky.app/profile/testuser", open: [], fields: {} } });
    const scenario = catalog.find((s) => s.id === "bluesky.schedule")!;
    const calls: string[] = [];
    let savedPost: Record<string, unknown>;
    const server = await serve((req, res) => {
      calls.push(req.method!);
      json(res, { post: savedPost });
    });
    const cfg = config({
      baseUrl: server.url,
      runDir: await mkdtemp(os.tmpdir() + "/simplepost-failed-dispatch-"),
      accounts: { bluesky: a },
    });
    Object.assign(process.env, { E2E_VERIFY_ONLY: "1", E2E_RUN_ID: "failed-dispatch", E2E_API_TOKEN: "offline-token" });
    try {
      const journal = new Journal(cfg, "failed-dispatch");
      const s = materialize(scenario, a, "ui", "failed-dispatch", cfg.mediaBaseUrl);
      const entry = await journal.reserve(s, "ui", a);
      entry.scenario.scheduledFor = new Date(Date.now() - 1000).toISOString();
      entry.phase = "inconclusive";
      entry.receipt = { simplePostId: "saved-schedule", status: "scheduled", results: [] };
      entry.cleanup = "pending-schedule";
      await journal.save(entry);
      const results = hasProviderResult
        ? [{ accountId: a.id, success: false, error: "PUBLISH_OUTCOME_UNKNOWN", message: "uploadLimitExceeded" }]
        : [];
      savedPost = {
        id: "saved-schedule",
        userId: cfg.userId,
        accountIds: [a.id],
        message: s.message,
        status: "failed",
        accountOptions: { [a.id]: s.options },
        media: s.media.map(() => ({})),
        accountResults: Object.fromEntries(results.map((result) => [a.id, result])),
      };
      await expect(runScenario(cfg, scenario, "ui", page, browser, info)).rejects.toThrow("Scheduled dispatch failed");
      const observed = (await journal.get(entry.key))!;
      expect(observed.receipt).toMatchObject({ simplePostId: "saved-schedule", status: "failed", results });
      expect(observed.phase).toBe("inconclusive");
      expect(observed.cleanup).toBe("review-external-post");
      expect(observed.error).toContain("Scheduled dispatch failed");
      if (hasProviderResult) expect(observed.error).toContain("uploadLimitExceeded");
      expect(calls).toEqual(["GET", "GET"]);
      const cleanup = JSON.parse(await readFile(`${journal.dir}/cleanup.json`, "utf8"));
      expect(cleanup[0]).toMatchObject({ status: "review-external-post", post: { status: "failed" } });
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await server.close();
    }
  });
