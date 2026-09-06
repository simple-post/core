import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { snapshotConfig } from "../src/config-snapshot.js";
import { loadConfig } from "../src/config.js";
import { config } from "./helpers.js";

test("an invocation keeps its config across edits and processes; a restart picks up new settings", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-config-test-"));
  const source = path.join(dir, "config.json");
  let first: Awaited<ReturnType<typeof snapshotConfig>> | undefined;
  let second: Awaited<ReturnType<typeof snapshotConfig>> | undefined;
  try {
    await mkdir(path.join(dir, ".local/auth"), { recursive: true });
    await writeFile(path.join(dir, ".local/auth/x.json"), "{}");
    const original = config({
      scheduleDelayMinutes: 4,
      schedulerStorageState: ".local/auth/scheduler.json",
      fixtureDir: "fixtures",
      runDir: "runs",
      cliEntry: "../cli/bin/run.js",
      cliCommand: "../../core/cli/bin/run.js",
    });
    await writeFile(source, JSON.stringify(original));
    first = await snapshotConfig(source);
    expect((await stat(first.file)).mode & 0o777).toBe(0o600);
    const frozen = loadConfig(first.file);
    expect(frozen.schedulerStorageState).toBe(path.join(dir, ".local/auth/scheduler.json"));
    expect(frozen.accounts.x!.observer.storageState).toBe(path.join(dir, ".local/auth/x.json"));
    expect(frozen.fixtureDir).toBe(path.join(dir, "fixtures"));
    expect(frozen.runDir).toBe(path.join(dir, "runs"));
    expect(frozen.cliEntry).toBe(path.resolve(dir, "../cli/bin/run.js"));
    expect(frozen.cliCommand).toBe(path.resolve(dir, "../../core/cli/bin/run.js"));
    await writeFile(source, JSON.stringify({ ...original, scheduleDelayMinutes: 1 }));
    second = await snapshotConfig(source);
    expect(loadConfig(second.file).scheduleDelayMinutes).toBe(1);
    // Simulate both a later worker and the final reporter, with no shared module cache.
    await writeFile(source, "partially written invalid config");
    for (let reader = 0; reader < 2; reader++) {
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          "import {loadConfig} from './src/config.ts'; console.log(String(loadConfig().scheduleDelayMinutes))",
        ],
        {
          env: { ...process.env, E2E_CONFIG: first.file },
          timeout: 10_000,
        },
      );
      expect(result.stdout.trim()).toBe("4");
    }
    await first.dispose();
    await expect(readFile(first.file)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await first?.dispose();
    await second?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
