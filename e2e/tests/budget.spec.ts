import { test, expect } from "@playwright/test";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { budgetPlan, postCost } from "../src/budget.js";
import { selectedCases, catalog, materialize } from "../src/catalog.js";
import { selection } from "../src/config.js";
import preflight from "../src/preflight.js";
import { Journal } from "../src/journal.js";
import { account, config } from "./helpers.js";
import type { JournalEntry } from "../src/types.js";

const selected = {
  platforms: ["telegram" as const],
  interfaces: ["ui" as const, "mcp" as const],
  profile: "full",
  filter: undefined,
};
const cases = selectedCases(selected);

test("automatic budget covers the whole supported Telegram selection, albums, threads and invalid cases", () => {
  expect(config().maxPosts).toBe("auto");
  const expected = cases.reduce(
    (total, s) => total + postCost(s) * selected.interfaces.filter((i) => s.interfaces.includes(i)).length,
    0,
  );
  expect(budgetPlan(cases, selected.interfaces, [])).toEqual({ spent: 0, remaining: expected, total: expected });
  expect(expected).toBeGreaterThan(12);
  const album = catalog.find((s) => s.id === "telegram.album-10")!;
  expect(budgetPlan([album], ["ui", "ui", "mcp"], []).total).toBe(20);
  const unsupported = catalog.find((s) => s.id === "telegram.remote-image")!;
  expect(budgetPlan([unsupported], ["ui"], []).total).toBe(0);
});

test("resuming does not count completed scenarios twice and retains earlier selections", () => {
  const s = cases.find((s) => s.id === "telegram.album-10")!;
  const entry = { key: "ui/telegram.album-10", scenario: s } as JournalEntry;
  expect(budgetPlan([s], ["ui", "mcp"], [entry])).toEqual({ spent: 10, remaining: 10, total: 20 });
  const text = cases.find((s) => s.id === "telegram.text")!;
  expect(budgetPlan([text], ["ui"], [entry])).toEqual({ spent: 10, remaining: 1, total: 11 });
});

test("the real journal can reserve and resume every selected Telegram case with the automatic budget", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-auto-budget-"));
  const before = { ...process.env };
  const cfg = config({ runDir: dir, accounts: { telegram: account() }, defaultInterfaces: selected.interfaces });
  process.env.E2E_PLATFORMS = "telegram";
  process.env.E2E_INTERFACES = "ui,mcp";
  process.env.E2E_PROFILE = "full";
  delete process.env.E2E_SCENARIO;
  try {
    const journal = new Journal(cfg, "resume");
    const chosen = selectedCases(selection(cfg));
    for (const s of chosen)
      for (const iface of selected.interfaces) {
        if (!s.interfaces.includes(iface)) continue;
        const materialized = materialize(s, cfg.accounts.telegram!, iface, "resume", cfg.mediaBaseUrl);
        const entry = await journal.reserve(materialized, iface, cfg.accounts.telegram!);
        entry.phase = "verified";
        await journal.save(entry);
      }
    const entries = await journal.entries();
    expect(entries).toHaveLength(61);
    expect(budgetPlan(chosen, selected.interfaces, entries)).toEqual({ spent: 129, remaining: 0, total: 129 });
    for (const entry of entries) {
      const original = materialize(
        chosen.find((s) => s.id === entry.scenario.id)!,
        cfg.accounts.telegram!,
        entry.interface,
        "resume",
        cfg.mediaBaseUrl,
      );
      expect((await journal.reserve(original, entry.interface, cfg.accounts.telegram!)).phase).toBe("verified");
    }
    expect(await journal.entries()).toHaveLength(61);
  } finally {
    for (const key of ["E2E_PLATFORMS", "E2E_INTERFACES", "E2E_PROFILE", "E2E_SCENARIO"]) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("an explicit budget too small for the selection fails preflight before accessing accounts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-fixed-budget-"));
  const file = path.join(dir, "config.json");
  const env = { ...process.env };
  const keys = [
    "E2E_CONFIG",
    "E2E_RUN_ID",
    "E2E_LIVE",
    "E2E_VERIFY_ONLY",
    "E2E_PLATFORMS",
    "E2E_INTERFACES",
    "E2E_PROFILE",
    "E2E_SCENARIO",
  ];
  try {
    await writeFile(
      file,
      JSON.stringify(
        config({ baseUrl: "http://127.0.0.1:1", runDir: dir, maxPosts: 12, accounts: { telegram: account() } }),
      ),
    );
    Object.assign(process.env, {
      E2E_CONFIG: file,
      E2E_RUN_ID: "fixed",
      E2E_LIVE: "1",
      E2E_PLATFORMS: "telegram",
      E2E_INTERFACES: "ui,mcp",
      E2E_PROFILE: "full",
    });
    delete process.env.E2E_VERIFY_ONLY;
    delete process.env.E2E_SCENARIO;
    await expect(preflight()).rejects.toThrow("Selected suite needs a total budget of 129, but maxPosts is 12");
    expect(await new Journal(config({ runDir: dir }), "fixed").entries()).toEqual([]);
    await expect(access(path.join(dir, ".live.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
});
