import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import type { TestCase } from "@playwright/test/reporter";
import type { LiveConfig } from "./config.js";
import type { Interface, Platform, JournalEntry } from "./types.js";
import { atomicJson, readJson, withFileLock } from "./files.js";
import { redact } from "./redact.js";

export function platformProjects(selected: readonly Platform[]) {
  return selected.map((platform) => ({
    name: platform,
    workers: 1,
    grep: new RegExp(`@${platform}(?:\\s|$)`),
    metadata: { platform },
  }));
}

export function testInterface(test: Pick<TestCase, "annotations">): Interface | undefined {
  return test.annotations.find((annotation) => annotation.type === "interface")?.description as Interface | undefined;
}

export function pendingExternalWork(entry: JournalEntry): boolean {
  if (entry.phase === "verified" || entry.cleanup === "discarded") return false;
  if (entry.scenario.expectedError && entry.interface === "mcp") return false;
  if (entry.pendingMutation) return true;
  if (entry.receipt?.status === "scheduled") return true;
  if (entry.phase === "submitting" || (entry.phase === "inconclusive" && !entry.receipt))
    return entry.scenario.mode !== "draft";
  return (
    entry.phase === "inconclusive" &&
    entry.scenario.mode === "draft-edit" &&
    Boolean(entry.scenario.scheduledFor) &&
    entry.receipt?.status === "draft"
  );
}

export class PendingWorkError extends Error {
  override name = "PendingWorkError";
}

type LaneState = { failures: number; reason?: string };
export class RunControl {
  readonly dir: string;
  constructor(
    readonly config: LiveConfig,
    run: string,
  ) {
    this.dir = path.join(config.runDir, run);
  }
  async blocked(platform: Platform): Promise<string | undefined> {
    const global = await readJson<{ reason: string }>(path.join(this.dir, "stop.json"));
    if (global) return `Run stopped: ${global.reason}`;
    return (await readJson<LaneState>(path.join(this.dir, `lane-${platform}.json`)))?.reason;
  }
  async failure(platform: Platform, error: unknown) {
    const chain: Error[] = [];
    for (let current = error; current instanceof Error && !chain.includes(current); current = current.cause)
      chain.push(current);
    const reason = redact(chain[0]?.message ?? String(error));
    // A quarantine is a submission gate, not a new provider/test failure. Do
    // not let earlier blocked interfaces pause the lane before reconciliation.
    if (chain.some((error) => error.name === "PendingWorkError")) return;
    const global = chain.some((error) =>
      /BLOCKED: run post budget|Account identity mismatch|Scheduler .+failed \((?:401|403)\)|UI publish failed \((?:401|403)\)|MCP.+(?:Unauthorized|invalid token|Authentication)|journal transaction lock|different payload\/account\/build/.test(
        error.message,
      ),
    );
    if (global) {
      await atomicJson(path.join(this.dir, "stop.json"), { reason });
      return;
    }
    const file = path.join(this.dir, `lane-${platform}.json`);
    await withFileLock(`${file}.lock`, async () => {
      const state = (await readJson<LaneState>(file)) ?? { failures: 0 };
      state.failures++;
      if (
        chain.some((error) => error.name === "VerificationSetupError") ||
        /\b429\b|rate.limit|reconnect|session.+expired|24-hour budget/i.test(reason) ||
        state.failures >= this.config.platformFailureLimit
      )
        state.reason = `Platform lane paused after ${state.failures} failure(s): ${reason}`;
      await atomicJson(file, state);
    });
  }
  async success(platform: Platform) {
    // Count consecutive failures, not unrelated failures throughout a long suite.
    await atomicJson(path.join(this.dir, `lane-${platform}.json`), { failures: 0 });
  }
  async reset(platforms: readonly Platform[]) {
    // New invocation rechecks credentials in preflight before clearing lane pauses.
    for (const file of ["stop.json", ...platforms.map((platform) => `lane-${platform}.json`)])
      await unlink(path.join(this.dir, file)).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
  }
}

/** Cross-run account leases. Stale leases require reconciling external posts. */
export async function leaseAccounts(config: LiveConfig, platforms: readonly Platform[], run: string) {
  const dir = path.join(config.runDir, ".accounts");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  type Lease = { token: string; pid: number; run: string; platform: Platform; quarantined?: boolean };
  const held: Array<{ file: string; token: string; platform: Platform; quarantined?: boolean }> = [];
  const release = async (pending?: readonly Platform[]) => {
    for (const { file, token, platform, quarantined } of [...held].reverse()) {
      const owner = await readJson<Lease>(file);
      if (owner?.token !== token) continue;
      if (pending ? pending.includes(platform) : quarantined) await atomicJson(file, { ...owner, quarantined: true });
      else await unlink(file);
    }
  };
  try {
    for (const platform of [...new Set(platforms)].sort()) {
      const account = config.accounts[platform];
      if (!account) continue; // Preflight reports missing account configuration.
      const identity = `${platform}/${account.platformAccountId}`;
      const file = path.join(dir, `${createHash("sha256").update(identity).digest("hex")}.lock`);
      const token = randomUUID();
      try {
        let handle;
        try {
          handle = await open(file, "wx", 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const owner = await readJson<Lease>(file);
          // The invocation lock already excludes another process for this run.
          // Only its own retained quarantine may be reclaimed for reconciliation.
          if (!owner?.quarantined || owner.run !== run) throw error;
          await atomicJson(file, { pid: process.pid, run, platform, token, quarantined: true });
          held.push({ file, token, platform, quarantined: true });
          continue;
        }
        held.push({ file, token, platform });
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, run, platform, token }));
        } finally {
          await handle.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new Error(
            `Account ${platform} is leased by another run or retained for pending posts. Resume the owning run to reconcile it before starting a new run: ${file}`,
          );
        throw error;
      }
    }
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}

export function blockedAnnotation(info: TestInfo, reason: string) {
  info.annotations.push({ type: "blocked", description: reason });
}
