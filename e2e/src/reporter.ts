import type { Reporter, FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, runId } from "./config.js";
import { Journal } from "./journal.js";
import { redact } from "./redact.js";
import { optionCoverage } from "./coverage-inventory.js";
import { aggregateJournal } from "./aggregate.js";
import { testInterface, pendingExternalWork } from "./execution.js";
import { atomicJson, readJson } from "./files.js";
import type { StageTimings } from "./timing.js";
import { summarizeCoverage } from "./coverage-summary.js";
export default class CoverageReporter implements Reporter {
  results: {
    title: string;
    interface: string;
    platform: string;
    durationMs: number;
    status: string;
    error?: string;
    blocked?: string;
  }[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({
      title: test.title,
      interface: testInterface(test) ?? test.parent.project()?.name ?? "",
      platform: test.parent.project()?.name ?? "",
      durationMs: result.duration,
      status: result.status,
      error: result.error?.message ? redact(result.error.message) : undefined,
      blocked: test.annotations.find((annotation) => annotation.type === "blocked")?.description,
    });
  }
  async onEnd(result: FullResult) {
    if (process.argv.includes("--list")) return;
    try {
      const config = loadConfig(),
        run = runId(),
        journal = new Journal(config, run);
      const coverageFile = path.join(journal.dir, "coverage.json");
      let matrix: {
        id: string;
        interface: string;
        status: string;
        reason?: string;
      }[];
      try {
        matrix = JSON.parse(await readFile(coverageFile, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          console.log("Live coverage unavailable: preflight did not produce an execution matrix.");
          return;
        }
        throw error;
      }
      const entries = await journal.entries();
      const rows = matrix.map((row) => {
        const entry = entries.find((e) => e.key === `${row.interface}/${row.id}`);
        const test = this.results.find((t) => t.interface === row.interface && t.title.startsWith(row.id + " "));
        const pending = entry && pendingExternalWork(entry);
        return {
          ...row,
          status: pending
            ? entry.phase
            : test?.blocked
              ? "blocked"
              : (entry?.phase ?? (test?.status === "failed" ? "blocked" : row.status)),
          reason: pending
            ? (entry.error ?? "External work may still be pending; reconcile before posting")
            : (test?.blocked ?? entry?.error ?? test?.error ?? row.reason),
          journalPhase: entry?.phase,
          journalError: entry?.error,
          invocationStatus: test?.status ?? "not-run",
          blockedReason: test?.blocked,
          receipt: entry?.receipt,
          cleanup: entry?.cleanup,
          timings: entry?.timings,
        };
      });
      const summary = {
        status: result.status,
        ...summarizeCoverage(rows),
      };
      if (summary.remaining && summary.status === "passed") summary.status = "failed";
      await writeFile(
        path.join(journal.dir, "report.json"),
        JSON.stringify({ summary, rows, optionCoverage: optionCoverage() }, null, 2),
        {
          mode: 0o600,
        },
      );
      const platformTimings = [...new Set(this.results.map((test) => test.platform))].map((platform) => {
        const tests = this.results.filter((test) => test.platform === platform);
        const stages: StageTimings = {};
        // Only this invocation's actually executed cases contribute. A narrowed
        // resume can contain journals and timings from previous selections.
        for (const test of tests.filter((test) => test.status !== "skipped")) {
          const entry = entries.find(
            (entry) =>
              entry.platform === platform &&
              entry.interface === test.interface &&
              test.title.startsWith(entry.scenario.id + " "),
          );
          for (const [name, value] of Object.entries(entry?.timings ?? {})) {
            const total = (stages[name] ??= { durationMs: 0, calls: 0 });
            total.durationMs += value.durationMs;
            total.calls += value.calls;
          }
        }
        return { platform, testDurationMs: tests.reduce((total, test) => total + test.durationMs, 0), stages };
      });
      await atomicJson(path.join(journal.dir, "timing-summary.json"), {
        wallDurationMs: result.duration,
        setup: await readJson(path.join(journal.dir, "setup-timing.json")),
        platforms: platformTimings,
        slowestCases: [...this.results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 20),
        note: "Stage durations are inclusive: upload is part of submission. Parallel platform totals do not add up to wall time.",
      });
      await aggregateJournal(config);
      console.log(
        `Live coverage: ${summary.verified}/${summary.total - summary.unsupported} verified; ${summary.remaining} incomplete; ${summary.unsupported} explicitly unsupported.`,
      );
      for (const platform of summary.platforms) {
        if (platform.failedThisInvocation || platform.lanePaused)
          console.log(
            `${platform.platform}: ${platform.failedThisInvocation} failed in this invocation; ${platform.lanePaused} later cases skipped because the lane paused.`,
          );
      }
      return { status: summary.status };
    } catch (error) {
      console.error("Live report could not be finalized:", redact((error as Error).message));
      return { status: "failed" as const };
    }
  }
}
