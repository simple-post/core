import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { reportPath } from "../src/report-path.js";
import { writeAggregateReport } from "../src/aggregate-report.js";

const { values } = parseArgs({
  strict: true,
  options: {
    "run-id": { type: "string" },
    config: { type: "string" },
    all: { type: "boolean" },
    port: { type: "string" },
  },
});
const run = values["run-id"] ?? process.env.E2E_RUN_ID;
const file = path.resolve(values.config ?? process.env.E2E_CONFIG ?? "config.local.json");
const config = existsSync(file) ? loadConfig(file) : undefined;
const root = config?.runDir ?? path.resolve(".local/runs");
if (values.all && values["run-id"]) throw new Error("Choose --all or --run-id, not both.");
if (values.all && !config) throw new Error("The all-platform report needs your saved test configuration.");
const report = values.all ? await writeAggregateReport(config!) : reportPath(root, run);
const port = Number(values.port ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer from 0 to 65535.");
console.log(`Opening HTML report: ${report}`);
const child = spawn(
  process.execPath,
  [
    createRequire(import.meta.url).resolve("@playwright/test/cli"),
    "show-report",
    report,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    stdio: "inherit",
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
