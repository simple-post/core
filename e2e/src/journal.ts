import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import type { JournalEntry, Materialized, Interface } from "./types.js";
import { selection, type LiveConfig, type Account } from "./config.js";
import { selectedCases } from "./catalog.js";
import { postCost as cost, budgetPlan } from "./budget.js";
export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export class Journal {
  readonly dir: string;
  constructor(
    readonly config: LiveConfig,
    readonly run: string,
  ) {
    this.dir = path.join(config.runDir, run);
  }
  file(key: string) {
    return path.join(this.dir, `${digest(key)}.json`);
  }
  async entries(dir = this.dir): Promise<JournalEntry[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const entries: JournalEntry[] = [];
    for (const n of names.filter((x) => /^[0-9a-f]{64}\.json$/.test(x)))
      entries.push(JSON.parse(await readFile(path.join(dir, n), "utf8")));
    return entries;
  }
  async get(key: string): Promise<JournalEntry | undefined> {
    try {
      return JSON.parse(await readFile(this.file(key), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
  }
  async save(entry: JournalEntry) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    entry.updatedAt = new Date().toISOString();
    const target = this.file(entry.key),
      tmp = target + ".tmp";
    await writeFile(tmp, JSON.stringify(entry, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, target);
  }
  async reserve(scenario: Materialized, iface: Interface, account: Account): Promise<JournalEntry> {
    const key = `${iface}/${scenario.id}`;
    const fingerprint = digest({
      scenario,
      accountId: account.id,
      platformAccountId: account.platformAccountId,
      baseUrl: this.config.baseUrl,
      revision: this.config.deploymentRevision,
    });
    const existing = await this.get(key);
    if (existing) {
      const { scheduledFor: _existingSchedule, ...existingPayload } = existing.scenario;
      const { scheduledFor: _currentSchedule, ...currentPayload } = scenario;
      const verificationResume =
        process.env.E2E_VERIFY_ONLY === "1" &&
        existing.accountId === account.id &&
        JSON.stringify(existingPayload) === JSON.stringify(currentPayload);
      if (existing.digest !== fingerprint && !verificationResume)
        throw new Error(
          `Run ${this.run} has a different payload/account/build for ${key}. Use a new run ID after reconciling existing posts.`,
        );
      if (existing.phase === "submitting" || (existing.phase === "inconclusive" && !existing.receipt))
        throw new Error(
          `INCONCLUSIVE: ${key} may already have posted. Inspect the journal and platform; do not automatically resubmit.`,
        );
      if (existing.phase === "failed")
        throw new Error(
          `Previously failed ${key}; inspect evidence and use a new run only after reconciling its external posts.`,
        );
      return existing;
    }
    const entries = await this.entries();
    const proposed = cost(scenario);
    const spent = entries.reduce((n, e) => n + cost(e.scenario), 0);
    const selected = selection(this.config);
    const maxPosts =
      this.config.maxPosts === "auto"
        ? budgetPlan(selectedCases(selected), selected.interfaces, entries).total
        : this.config.maxPosts;
    if (spent + proposed > maxPosts)
      throw new Error(
        `BLOCKED: run post budget ${maxPosts} exhausted. Resume this run with a deliberately increased budget or narrower selection.`,
      );
    const cap = this.config.perPlatformBudget[scenario.platform];
    if (cap && proposed) {
      let used = 0;
      await mkdir(this.config.runDir, { recursive: true, mode: 0o700 });
      for (const run of await readdir(this.config.runDir, { withFileTypes: true }))
        if (run.isDirectory()) {
          for (const e of await this.entries(path.join(this.config.runDir, run.name)))
            if (e.accountId === account.id && Date.parse(e.createdAt) > Date.now() - 86_400_000)
              used += cost(e.scenario);
        }
      if (used + proposed > cap)
        throw new Error(
          `BLOCKED: ${scenario.platform} account 24-hour budget ${cap} exhausted. Resume after the quota window; no retry was sent.`,
        );
    }
    const entry: JournalEntry = {
      key,
      digest: fingerprint,
      platform: scenario.platform,
      interface: iface,
      scenario,
      accountId: account.id,
      phase: "reserved",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cleanup: "not-created",
    };
    await this.save(entry);
    return entry;
  }
}
