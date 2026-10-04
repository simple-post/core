import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import {
  platformProjects,
  leaseAccounts,
  RunControl,
  pendingExternalWork,
  PendingWorkError,
} from "../src/execution.js";
import { Journal } from "../src/journal.js";
import { catalog, materialize } from "../src/catalog.js";
import { account, config } from "./helpers.js";
import { atomicJson, readJson, withFileLock } from "../src/files.js";
import { mcpCreate, type McpClient } from "../src/adapters/mcp.js";
import { mediaFiles } from "../src/media.js";
import { platforms } from "../src/types.js";

test("every selected platform gets its own worker lane with no concurrency cap", () => {
  const projects = platformProjects(platforms);
  expect(projects.map((project) => project.name)).toEqual([...platforms]);
  expect(projects.every((project) => project.workers === 1)).toBe(true);
  for (const project of projects)
    for (const platform of platforms)
      expect(project.grep.test(`file ui ${platform}.smoke @${platform} @full`)).toBe(project.name === platform);
});

test("actual Playwright lanes overlap across all selected platforms, serialize interfaces and continue after a failure", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-lanes-"));
  const projects = platformProjects(["telegram", "bluesky", "instagram"]);
  const testModule = createRequire(import.meta.url).resolve("@playwright/test");
  const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
  try {
    await writeFile(
      path.join(dir, "playwright.config.cjs"),
      `module.exports = { testDir: '.', testMatch: 'lanes.spec.cjs', workers: 3, fullyParallel: false, retries: 0, maxFailures: 0, reporter: 'json', projects: ${JSON.stringify(projects.map(({ grep, ...project }) => project))} };`,
    );
    await writeFile(
      path.join(dir, "lanes.spec.cjs"),
      `
      const {test, expect} = require(${JSON.stringify(testModule)});
      const {appendFileSync, existsSync} = require('node:fs');
      const log = ${JSON.stringify(path.join(dir, "events.jsonl"))};
      for (const iface of ['ui', 'mcp', 'cli-app']) test(iface, async ({}, info) => {
        appendFileSync(log, JSON.stringify({platform:info.project.name, iface, event:'start', time:Date.now()})+'\\n');
        if (iface === 'ui') await expect.poll(() => ['telegram','bluesky','instagram'].every(p => existsSync(${JSON.stringify(dir)}+'/'+p)), {timeout:10000}).toBe(true);
        await new Promise(r => setTimeout(r, 80));
        appendFileSync(log, JSON.stringify({platform:info.project.name, iface, event:'end', time:Date.now()})+'\\n');
        if (info.project.name === 'telegram' && iface === 'ui') expect(false).toBe(true);
      });
      test.beforeEach(async ({}, info) => {require('node:fs').writeFileSync(${JSON.stringify(dir)}+'/'+info.project.name, 'started')});
    `,
    );
    let output = "";
    try {
      output = (
        await promisify(execFile)(
          process.execPath,
          [cli, "test", "--config", path.join(dir, "playwright.config.cjs")],
          { cwd: dir, timeout: 20_000 },
        )
      ).stdout;
    } catch (error) {
      const failure = error as Error & { code: number; stdout: string };
      expect(failure.code).toBe(1);
      output = failure.stdout;
    }
    const report = JSON.parse(output);
    expect(report.stats).toMatchObject({ expected: 8, unexpected: 1, skipped: 0 });
    const events = (await readFile(path.join(dir, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { platform: string; iface: string; event: string; time: number });
    const starts = events.filter((event) => event.iface === "ui" && event.event === "start");
    const firstEnd = Math.min(...events.filter((event) => event.event === "end").map((event) => event.time));
    expect(starts).toHaveLength(3);
    expect(starts.every((event) => event.time <= firstEnd)).toBe(true);
    for (const platform of ["telegram", "bluesky", "instagram"]) {
      const lane = events.filter((event) => event.platform === platform);
      expect(lane.map((event) => `${event.iface}:${event.event}`)).toEqual([
        "ui:start",
        "ui:end",
        "mcp:start",
        "mcp:end",
        "cli-app:start",
        "cli-app:end",
      ]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cross-process reservations cannot overspend the last shared run budget slot", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-budget-race-"));
  const cfg = config({ runDir: dir, maxPosts: 1, perPlatformBudget: {} });
  const fixture = path.join(dir, "config.json");
  await writeFile(fixture, JSON.stringify(cfg));
  const root = path.resolve("src/journal.ts");
  const source = path.resolve("src/catalog.ts");
  const tsx = createRequire(import.meta.url).resolve("tsx");
  const spawn = (platform: string) =>
    promisify(execFile)(
      process.execPath,
      [
        "--import",
        tsx,
        "--input-type=module",
        "-e",
        `
    import fs from 'node:fs';
    import {Journal} from ${JSON.stringify(root)};
    import {catalog,materialize} from ${JSON.stringify(source)};
    const cfg=JSON.parse(fs.readFileSync(${JSON.stringify(fixture)},'utf8'));
    const a={...cfg.accounts.x,id:${JSON.stringify(platform)}};
    const s=materialize(catalog.find(s=>s.id===${JSON.stringify(platform + ".smoke")}),a,'mcp','race',cfg.mediaBaseUrl);
    try {await new Journal(cfg,'race').reserve(s,'mcp',a); console.log('reserved')} catch(e) {console.log(e.message)}
  `,
      ],
      { timeout: 15_000 },
    );
  try {
    const results = await Promise.all([spawn("bluesky"), spawn("instagram"), spawn("x")]);
    expect(results.filter((result) => result.stdout.trim() === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.stdout.includes("budget 1 exhausted"))).toHaveLength(2);
    expect(await new Journal(cfg, "race").entries()).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("daily platform budgets remain atomic across concurrent different runs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-daily-race-"));
  const cfg = config({ runDir: dir, maxPosts: 10, perPlatformBudget: { x: 1 } });
  const a = account();
  try {
    const s = materialize(catalog.find((s) => s.id === "x.smoke")!, a, "mcp", "race", cfg.mediaBaseUrl);
    const results = await Promise.allSettled([
      new Journal(cfg, "first").reserve(s, "mcp", a),
      new Journal(cfg, "second").reserve(s, "mcp", a),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason.message).toContain("24-hour budget 1 exhausted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("account leases prevent overlapping runs but allow independent platforms", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-account-leases-"));
  const cfg = config({ runDir: dir, accounts: { x: account(), bluesky: account({ id: "b" }) } });
  const release = await leaseAccounts(cfg, ["x"], "first");
  try {
    const other = await leaseAccounts(cfg, ["bluesky"], "other");
    await expect(leaseAccounts(cfg, ["bluesky", "x"], "collision")).rejects.toThrow("leased by another run");
    await other();
    // Acquisition is all-or-nothing even when an earlier sorted lane succeeded.
    await expect(leaseAccounts(cfg, ["bluesky", "x"], "partial")).rejects.toThrow("leased by another run");
    const independent = await leaseAccounts(cfg, ["bluesky"], "after-rollback");
    await independent();
    await release();
    const next = await leaseAccounts(cfg, ["x", "bluesky"], "next");
    await next();
  } finally {
    await release();
    await rm(dir, { recursive: true, force: true });
  }
});

test("platform challenges and repeated failures pause one lane; global budgets stop every lane", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-lane-control-"));
  const control = new RunControl(config({ runDir: dir, platformFailureLimit: 2 }), "run");
  try {
    await control.failure("x", new Error("Missing media"));
    expect(await control.blocked("x")).toBeUndefined();
    for (let i = 0; i < 4; i++)
      await control.failure(
        "bluesky",
        new Error("Blocked by pending work", { cause: new PendingWorkError("receipt pending") }),
      );
    expect(await control.blocked("bluesky")).toBeUndefined();
    await control.success("x");
    await control.failure("x", new Error("Missing media"));
    expect(await control.blocked("x")).toBeUndefined();
    await control.failure("x", new Error("Missing media again"));
    expect(await control.blocked("x")).toContain("paused");
    expect(await control.blocked("bluesky")).toBeUndefined();
    const challenge = new Error("Login required");
    challenge.name = "VerificationSetupError";
    await control.failure("tiktok", new Error("Observer failed", { cause: challenge }));
    expect(await control.blocked("tiktok")).toContain("paused");
    await control.failure("bluesky", new Error("BLOCKED: run post budget 2 exhausted"));
    expect(await control.blocked("instagram")).toContain("Run stopped");
    await control.reset(["x", "tiktok", "bluesky"]);
    expect(await control.blocked("x")).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("atomic writes and transaction locks preserve complete concurrent ledger updates", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-ledger-"));
  const file = path.join(dir, "ledger.json");
  try {
    await atomicJson(file, { count: 0 });
    await Promise.all(
      Array.from({ length: 12 }, () =>
        withFileLock(file + ".lock", async () => {
          const ledger = (await readJson<{ count: number }>(file))!;
          await atomicJson(file, { count: ledger.count + 1 });
        }),
      ),
    );
    expect(await readJson(file)).toEqual({ count: 12 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MCP rechecks the run stop guard after uploads and before creating a post", async () => {
  const cfg = config(),
    a = account();
  const scenario = materialize(catalog.find((s) => s.id === "x.smoke")!, a, "mcp", "guard", cfg.mediaBaseUrl);
  const media = await mediaFiles(cfg, scenario.media);
  const calls: string[] = [];
  const client = {
    config: cfg,
    call: async (name: string) => {
      calls.push(name);
      if (name === "upload_media")
        return { url: media[0].url, type: media[0].type, filename: media[0].filename, size: media[0].size };
      throw new Error("create_post must never be invoked");
    },
  } as unknown as McpClient;
  await expect(
    mcpCreate(
      client,
      scenario,
      a,
      media,
      "guard",
      async () => {},
      undefined,
      async () => {
        throw new Error("Run stopped");
      },
    ),
  ).rejects.toThrow("Run stopped");
  expect(calls).toEqual(["upload_media"]);
});

test("pending submissions retain account quarantine until the owning run reconciles them", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-quarantine-"));
  const cfg = config({ runDir: dir });
  try {
    const release = await leaseAccounts(cfg, ["x"], "owner");
    await release(["x"]);
    await expect(leaseAccounts(cfg, ["x"], "different")).rejects.toThrow("retained for pending posts");
    const reconcile = await leaseAccounts(cfg, ["x"], "owner");
    await reconcile(); // Failed preflight must preserve the existing quarantine.
    await expect(leaseAccounts(cfg, ["x"], "different")).rejects.toThrow("retained for pending posts");
    const complete = await leaseAccounts(cfg, ["x"], "owner");
    await complete([]);
    await (
      await leaseAccounts(cfg, ["x"], "different")
    )();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only unresolved submissions or schedules quarantine an account; failed platform proof does not", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-pending-"));
  const cfg = config({ runDir: dir, maxPosts: 10 });
  try {
    const entry = await new Journal(cfg, "pending").reserve(
      materialize(catalog.find((s) => s.id === "x.smoke")!, account(), "mcp", "pending", cfg.mediaBaseUrl),
      "mcp",
      account(),
    );
    expect(pendingExternalWork(entry)).toBe(false);
    entry.phase = "submitting";
    expect(pendingExternalWork(entry)).toBe(true);
    entry.phase = "inconclusive";
    entry.receipt = { results: [], status: "scheduled" };
    expect(pendingExternalWork(entry)).toBe(true);
    entry.receipt = { results: [{ success: true, postId: "123" }], status: "published" };
    expect(pendingExternalWork(entry)).toBe(false);
    entry.phase = "verified";
    expect(pendingExternalWork(entry)).toBe(false);
    entry.phase = "accepted";
    entry.receipt = { results: [], status: "draft" };
    entry.pendingMutation = "schedule";
    expect(pendingExternalWork(entry)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
