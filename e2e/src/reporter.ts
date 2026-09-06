import type { Reporter, FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, runId } from "./config.js";
import { Journal } from "./journal.js";
import { redact } from "./redact.js";
import { optionCoverage } from "./coverage-inventory.js";
import { aggregateJournal } from "./aggregate.js";
export default class CoverageReporter implements Reporter {
  results: { title: string; interface: string; status: string; error?: string }[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({
      title: test.title,
      interface: test.parent.project()?.name ?? "",
      status: result.status,
      error: result.error?.message ? redact(result.error.message) : undefined,
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
        return {
          ...row,
          status: entry?.phase ?? (test?.status === "failed" ? "blocked" : row.status),
          reason: entry?.error ?? test?.error ?? row.reason,
          receipt: entry?.receipt,
          cleanup: entry?.cleanup,
        };
      });
      const summary = {
        status: result.status,
        total: rows.length,
        verified: rows.filter((r) => r.status === "verified").length,
        unsupported: rows.filter((r) => r.status === "unsupported").length,
        remaining: rows.filter((r) => !["verified", "unsupported"].includes(r.status)).length,
      };
      await writeFile(
        path.join(journal.dir, "report.json"),
        JSON.stringify({ summary, rows, optionCoverage: optionCoverage() }, null, 2),
        {
          mode: 0o600,
        },
      );
      await aggregateJournal(config);
      console.log(
        `Live coverage: ${summary.verified}/${summary.total - summary.unsupported} verified; ${summary.remaining} incomplete; ${summary.unsupported} explicitly unsupported.`,
      );
    } catch (error) {
      console.error("Live report could not be finalized:", redact((error as Error).message));
    }
  }
}
