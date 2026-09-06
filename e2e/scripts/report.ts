import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { reportPath } from "../src/report-path.js";

const { values } = parseArgs({
  strict: true,
  options: { "run-id": { type: "string" }, config: { type: "string" } },
});
const run = values["run-id"] ?? process.env.E2E_RUN_ID;
const file = path.resolve(values.config ?? process.env.E2E_CONFIG ?? "config.local.json");
const config = existsSync(file) ? loadConfig(file) : undefined;
const root = config?.runDir ?? path.resolve(".local/runs");
const report = reportPath(root, run);
console.log(`Opening HTML report: ${report}`);
const child = spawn(
  process.execPath,
  [createRequire(import.meta.url).resolve("@playwright/test/cli"), "show-report", report],
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
