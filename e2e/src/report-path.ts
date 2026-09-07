import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export function reportPath(root: string, run?: string): string {
  if (run !== undefined) {
    if (!/^[a-zA-Z0-9_-]{1,70}$/.test(run)) throw new Error("Invalid run ID; use an existing live run name.");
    const report = path.join(root, run, "html");
    if (!existsSync(path.join(report, "index.html"))) throw new Error(`No HTML report found for run ${run}: ${report}`);
    return report;
  }
  const reports = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, "html"))
        .filter((report) => existsSync(path.join(report, "index.html")))
        .map((report) => ({ report, updated: statSync(path.join(report, "index.html")).mtimeMs }))
        .sort((a, b) => b.updated - a.updated || a.report.localeCompare(b.report))
    : [];
  if (!reports.length) throw new Error(`No live HTML reports found in ${root}. Run a live suite first.`);
  return reports[0].report;
}
