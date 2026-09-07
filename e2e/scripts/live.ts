import { existsSync } from "node:fs";
import path from "node:path";
import { snapshotConfig } from "../src/config-snapshot.js";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runnerArgs, runnerHelp } from "../src/runner-args.js";

let snapshot: Awaited<ReturnType<typeof snapshotConfig>> | undefined;
try {
  const options = runnerArgs("live", process.argv.slice(2));
  if (options.help) console.log(runnerHelp("live"));
  else {
    const cwd = fileURLToPath(new URL("../", import.meta.url));
    const source = path.resolve(cwd, options.env.E2E_CONFIG ?? "config.local.json");
    if (existsSync(source) || !options.playwrightArgs.includes("--list")) {
      snapshot = await snapshotConfig(source);
      options.env.E2E_CONFIG = snapshot.file;
    }
    if (!options.playwrightArgs.includes("--list")) {
      console.log(`Run ID: ${options.env.E2E_RUN_ID}`);
      console.log(
        options.env.E2E_VERIFY_ONLY === "1"
          ? "Verification only: no new posts."
          : "Live posting enabled. Configured budgets and account checks apply.",
      );
      console.log(`To resume, use the same selection with --run-id ${options.env.E2E_RUN_ID}`);
    }
    const child = spawn(
      process.execPath,
      [
        createRequire(import.meta.url).resolve("@playwright/test/cli"),
        "test",
        "--config",
        "playwright.config.ts",
        ...options.playwrightArgs,
      ],
      {
        cwd,
        env: options.env,
        stdio: "inherit",
      },
    );
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    try {
      process.exitCode = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve(code ?? (signal === "SIGINT" ? 130 : 143)));
      });
    } finally {
      if (!options.playwrightArgs.includes("--list"))
        console.log("Open the HTML report from the repository root: yarn e2e:report");
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await snapshot?.dispose();
}
