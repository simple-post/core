/* eslint-disable unicorn/no-process-exit -- This is the container CLI entrypoint. */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

mkdirSync("data", { recursive: true });
let child;
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

try {
  const migrated = await run([
    require.resolve("prisma/build/index.js"),
    "migrate",
    "deploy",
    "--schema",
    "prisma/schema.prisma",
  ]);
  if (migrated !== 0 || stopping) process.exit(migrated || 1);
  process.exit(await run([require.resolve("next/dist/bin/next"), "start"]));
} catch (error) {
  console.error("Scheduler startup failed", error);
  process.exit(1);
}
