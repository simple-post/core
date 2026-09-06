import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { reportPath } from "../src/report-path.js";
test("report defaults to the latest completed HTML report and preserves explicit run selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "e2e-reports-"));
  try {
    expect(() => reportPath(root)).toThrow("No live HTML reports");
    for (const [name, time] of [
      ["old", 100],
      ["new", 200],
    ] as const) {
      const report = path.join(root, name, "html");
      await mkdir(report, { recursive: true });
      const file = path.join(report, "index.html");
      await writeFile(file, "report");
      await utimes(file, time, time);
    }
    await mkdir(path.join(root, "in-progress", "html"), { recursive: true });
    expect(reportPath(root)).toBe(path.join(root, "new", "html"));
    expect(reportPath(root, "old")).toBe(path.join(root, "old", "html"));
    expect(() => reportPath(root, "missing")).toThrow("No HTML report found for run missing");
    expect(() => reportPath(root, "../old")).toThrow("Invalid run ID");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
