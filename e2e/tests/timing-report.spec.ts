import { test, expect } from "@playwright/test";
import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TimingRecorder, timed } from "../src/timing.js";
import Reporter from "../src/reporter.js";
import { Journal } from "../src/journal.js";
import { catalog, materialize } from "../src/catalog.js";
import { atomicJson, readJson } from "../src/files.js";
import { account, config } from "./helpers.js";

test("concurrent stage recorders remain isolated and record failed operations", async () => {
  const first = new TimingRecorder(),
    second = new TimingRecorder();
  await Promise.all([
    first.run(async () => {
      await timed("upload", async () => new Promise((resolve) => setTimeout(resolve, 15)));
      await expect(
        timed("submission", async () => {
          throw new Error("rejected");
        }),
      ).rejects.toThrow("rejected");
    }),
    second.run(() => timed("platform_verification", async () => new Promise((resolve) => setTimeout(resolve, 25)))),
  ]);
  expect(Object.keys(first.stages)).toEqual(["upload", "submission"]);
  expect(first.stages.upload).toMatchObject({ calls: 1, durationMs: expect.any(Number) });
  expect(first.stages.upload.durationMs).toBeGreaterThan(0);
  expect(second.stages).toEqual({ platform_verification: { calls: 1, durationMs: expect.any(Number) } });
});

test("platform projects retain interface coverage, blocked reasons and stage timing reports", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-timing-report-"));
  const file = path.join(dir, "config.json");
  const keys = ["E2E_CONFIG", "E2E_RUN_ID"] as const;
  const old = { ...process.env };
  const cfg = config({ runDir: dir, accounts: { telegram: account() }, maxPosts: 10 });
  const run = "report";
  try {
    await atomicJson(file, cfg);
    process.env.E2E_CONFIG = file;
    process.env.E2E_RUN_ID = run;
    const journal = new Journal(cfg, run);
    const entry = await journal.reserve(
      materialize(catalog.find((s) => s.id === "telegram.smoke")!, account(), "ui", run, cfg.mediaBaseUrl),
      "ui",
      account(),
    );
    entry.phase = "verified";
    entry.timings = { submission: { durationMs: 20, calls: 1 }, platform_verification: { durationMs: 30, calls: 1 } };
    await journal.save(entry);
    await atomicJson(path.join(journal.dir, "coverage.json"), [
      { id: "telegram.smoke", interface: "ui", status: "ready" },
      { id: "telegram.smoke", interface: "mcp", status: "ready" },
    ]);
    await atomicJson(path.join(journal.dir, "setup-timing.json"), { durationMs: 12 });
    const reporter = new Reporter();
    for (const iface of ["ui", "mcp"]) {
      const testcase = {
        title: "telegram.smoke @telegram @smoke @full",
        annotations: [
          { type: "interface", description: iface },
          ...(iface === "mcp" ? [{ type: "blocked", description: "Platform lane paused" }] : []),
        ],
        parent: { project: () => ({ name: "telegram" }) },
      } as unknown as TestCase;
      reporter.onTestEnd(testcase, {
        status: iface === "ui" ? "passed" : "skipped",
        duration: iface === "ui" ? 50 : 0,
      } as TestResult);
    }
    expect(await reporter.onEnd({ status: "passed", duration: 62, startTime: new Date() } as FullResult)).toEqual({
      status: "failed",
    });
    const report = await readJson<{
      summary: { verified: number; remaining: number };
      rows: Array<{ interface: string; status: string; reason?: string }>;
    }>(path.join(journal.dir, "report.json"));
    expect(report?.summary).toMatchObject({ verified: 1, remaining: 1 });
    expect(report?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ interface: "ui", status: "verified" }),
        expect.objectContaining({ interface: "mcp", status: "blocked", reason: "Platform lane paused" }),
      ]),
    );
    const timings = await readJson<{
      wallDurationMs: number;
      setup: { durationMs: number };
      platforms: Array<{ platform: string; stages: unknown }>;
    }>(path.join(journal.dir, "timing-summary.json"));
    expect(timings?.wallDurationMs).toBe(62);
    expect(timings?.setup.durationMs).toBe(12);
    expect(timings?.platforms).toEqual([expect.objectContaining({ platform: "telegram", stages: entry.timings })]);
    const pending = await journal.reserve(
      materialize(catalog.find((s) => s.id === "telegram.smoke")!, account(), "mcp", run, cfg.mediaBaseUrl),
      "mcp",
      account(),
    );
    pending.phase = "submitting";
    pending.error = "Request was sent; outcome unknown";
    await journal.save(pending);
    await reporter.onEnd({ status: "passed", duration: 62, startTime: new Date() } as FullResult);
    const resumed = await readJson<{ rows: Array<Record<string, unknown>> }>(path.join(journal.dir, "report.json"));
    expect(resumed?.rows.find((row) => row.interface === "mcp")).toMatchObject({
      status: "submitting",
      reason: "Request was sent; outcome unknown",
      journalPhase: "submitting",
      invocationStatus: "skipped",
      blockedReason: "Platform lane paused",
    });
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
});
