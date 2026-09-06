import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { configuredAppRoot, harnessRoot } from "../src/app-root.js";

const args = process.argv.slice(2);
const forwarded: string[] = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--app-root" || arg.startsWith("--app-root=")) {
    const value = arg === "--app-root" ? args[++index] : arg.slice("--app-root=".length);
    if (!value || value.startsWith("--")) throw new Error("--app-root requires an application checkout path");
    process.env.E2E_APP_ROOT = path.resolve(value);
  } else forwarded.push(arg);
}
const root = configuredAppRoot();
console.log(`Contract SDK application root: ${root}`);
const child = spawn(
  process.execPath,
  [
    createRequire(import.meta.url).resolve("@playwright/test/cli"),
    "test",
    "--config",
    "playwright.self.config.ts",
    ...forwarded,
  ],
  {
    cwd: harnessRoot,
    env: { ...process.env, E2E_APP_ROOT: root },
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
