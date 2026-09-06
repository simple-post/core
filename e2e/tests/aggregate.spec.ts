import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { aggregateJournal } from "../src/aggregate.js";
import { Journal } from "../src/journal.js";
import { materialize, catalog } from "../src/catalog.js";
import { config, account } from "./helpers.js";

test("aggregate invalidates historical passes with changed content but normalizes run markers", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "aggregate-content-"));
  const a = account({ observer: { profileUrl: "https://www.youtube.com/channel/UCowner", open: [], fields: {} } });
  const cfg = config({ runDir, accounts: { youtube: a }, maxPosts: 10 });
  try {
    for (const field of ["unchanged", "message", "expectedText", "expectedTitle"] as const) {
      const s = materialize(catalog.find((s) => s.id === "youtube.smoke")!, a, "mcp", `run-${field}`, cfg.mediaBaseUrl);
      if (field !== "unchanged") s[field] = `Meaningfully different content ${s.token}`;
      const journal = new Journal(cfg, `run-${field}`);
      const entry = await journal.reserve(s, "mcp", a);
      entry.phase = "verified";
      await journal.save(entry);
    }
    const result = await aggregateJournal(cfg);
    expect(result.summary).toMatchObject({ currentlyVerified: 1, everVerified: 1, historicalDefinitions: 3 });
    for (const attempt of result.attempts) expect(attempt.currentDefinition).toBe(attempt.run === "run-unchanged");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("changing accounts retains old passes only as history, without lending success to the new account", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "aggregate-account-"));
  const oldAccount = account({ id: "old-account" });
  const currentAccount = account({ id: "current-account" });
  const cfg = config({ runDir, accounts: { bluesky: currentAccount }, maxPosts: 10 });
  const scenario = catalog.find((s) => s.id === "bluesky.smoke")!;
  try {
    const oldJournal = new Journal(cfg, "old-account-run");
    const old = await oldJournal.reserve(
      materialize(scenario, oldAccount, "mcp", "old-account-run", cfg.mediaBaseUrl),
      "mcp",
      oldAccount,
    );
    old.phase = "verified";
    await oldJournal.save(old);
    let result = await aggregateJournal(cfg);
    expect(result.summary).toMatchObject({ currentlyVerified: 0, everVerified: 0, historicalDefinitions: 1 });
    expect(result.attempts[0]).toMatchObject({ accountId: oldAccount.id, currentDefinition: false, phase: "verified" });
    expect(result.rows[0]).toMatchObject({ accountId: oldAccount.id, currentDefinition: false, everVerified: true });

    const currentJournal = new Journal(cfg, "current-account-run");
    const current = await currentJournal.reserve(
      materialize(scenario, currentAccount, "mcp", "current-account-run", cfg.mediaBaseUrl),
      "mcp",
      currentAccount,
    );
    current.phase = "inconclusive";
    await currentJournal.save(current);
    result = await aggregateJournal(cfg);
    expect(result.rows).toHaveLength(2);
    expect(result.summary).toMatchObject({
      currentlyVerified: 0,
      everVerified: 0,
      incomplete: 1,
      historicalDefinitions: 1,
    });
    expect(result.rows.find((row) => row.currentDefinition)).toMatchObject({
      accountId: currentAccount.id,
      everVerified: false,
      status: "inconclusive",
    });

    current.phase = "verified";
    await currentJournal.save(current);
    result = await aggregateJournal(cfg);
    expect(result.summary).toMatchObject({ currentlyVerified: 1, everVerified: 1, historicalDefinitions: 1 });
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
