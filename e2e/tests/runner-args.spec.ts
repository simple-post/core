import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runnerArgs } from "../src/runner-args.js";

test("Telegram --all enables live posting and generates a unique valid run ID", () => {
  const first = runnerArgs("live", ["--platform", "telegram", "--all"], {});
  const second = runnerArgs("live", ["--platform", "telegram", "--all"], {});
  expect(first.env).toMatchObject({ E2E_PLATFORMS: "telegram", E2E_PROFILE: "full", E2E_LIVE: "1" });
  expect(first.env.E2E_RUN_ID).toMatch(/^[a-zA-Z0-9_-]{1,70}$/);
  expect(first.env.E2E_RUN_ID).not.toBe(second.env.E2E_RUN_ID);
});
test("arguments override environment selections while preserving legacy run IDs and credentials", () => {
  const inherited = { E2E_PLATFORMS: "x", E2E_PROFILE: "smoke", E2E_RUN_ID: "resume-me", E2E_MCP_TOKEN: "test-secret" };
  const options = runnerArgs(
    "live",
    [
      "--platform=telegram",
      "--platform",
      "x,telegram",
      "--interface",
      "mcp,ui",
      "--all",
      "--scenario",
      "album",
      "--config",
      "test config.json",
      "--headed",
    ],
    inherited,
  );
  expect(options.env).toMatchObject({
    E2E_PLATFORMS: "telegram,x",
    E2E_INTERFACES: "mcp,ui",
    E2E_PROFILE: "full",
    E2E_SCENARIO: "album",
    E2E_CONFIG: "test config.json",
    E2E_RUN_ID: "resume-me",
    E2E_MCP_TOKEN: "test-secret",
  });
  expect(options.playwrightArgs).toEqual(["--headed"]);
  expect(inherited.E2E_PLATFORMS).toBe("x");
  expect(runnerArgs("live", ["--run-id", "explicit"], inherited).env.E2E_RUN_ID).toBe("explicit");
});
test("verify-only requires an existing run ID and never enables publishing", () => {
  expect(() => runnerArgs("live", ["--verify-only"], {})).toThrow("requires --run-id");
  expect(runnerArgs("live", ["--verify-only", "--run-id", "existing"], {}).env).toMatchObject({
    E2E_LIVE: "0",
    E2E_VERIFY_ONLY: "1",
    E2E_RUN_ID: "existing",
  });
  expect(runnerArgs("live", [], { E2E_VERIFY_ONLY: "1", E2E_RUN_ID: "legacy" }).env.E2E_LIVE).toBe("0");
});
test("scenario filters support exact IDs for receipt-only verification", () => {
  expect(runnerArgs("live", ["--scenario", "=facebook.video"], {}).env.E2E_SCENARIO).toBe("=facebook.video");
});
test("help, list, and plan never enable live posting", () => {
  expect(runnerArgs("live", ["--help"], {}).env.E2E_LIVE).toBeUndefined();
  expect(runnerArgs("live", ["--list"], { E2E_LIVE: "1" }).env.E2E_LIVE).toBe("0");
  const plan = runnerArgs("plan", ["--platform", "telegram", "--all"], {});
  expect(plan.env.E2E_LIVE).toBeUndefined();
  expect(plan.env.E2E_RUN_ID).toBeUndefined();
});
for (const args of [
  ["--platform", "wrong"],
  ["--interface", "wrong"],
  ["--profile", "wrong"],
  ["--all", "--profile", "smoke"],
  ["--run-id", "../unsafe"],
  ["--run-id", ""],
  ["--config", ""],
  ["--platform"],
  ["--retries", "3"],
  ["--workers", "4"],
  ["--unknown"],
  ["unexpected-positional"],
])
  test(`invalid command is rejected: ${args.join(" ")}`, () => {
    expect(() => runnerArgs("live", args, {})).toThrow();
  });

test("real live CLI lists only Telegram full cases and plan accepts the same selection", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "e2e-runner-args-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("E2E_")));
  const selection = [
    "--platform",
    "telegram",
    "--all",
    "--interface",
    "mcp",
    "--config",
    path.join(dir, "not-configured.json"),
  ];
  try {
    const live = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/live.ts", ...selection, "--list"],
      { env, timeout: 20_000 },
    );
    expect(live.stdout).toContain("telegram.album-10");
    expect(live.stdout).toContain("telegram.album-11-invalid");
    expect(live.stdout).not.toContain("tiktok.smoke");
    expect(live.stdout).not.toContain("Live posting enabled");
    const plan = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/plan.ts", ...selection], {
      env,
      timeout: 20_000,
    });
    expect(plan.stdout).toContain("telegram.album-10");
    expect(plan.stdout).toContain("Plan only. No accounts accessed");
    await expect(
      promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/live.ts", "--platform", "invalid"], {
        env,
        timeout: 10_000,
      }),
    ).rejects.toMatchObject({ code: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
