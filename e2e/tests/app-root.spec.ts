import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { configuredAppRoot, resolveAppRoot } from "../src/app-root.js";

let directory: string;
let local: string;
let canonical: string;
test.beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "e2e-app-root-"));
  for (const name of ["local", "canonical"]) {
    const root = path.join(directory, name);
    mkdirSync(path.join(root, "sdk"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ private: true }));
    writeFileSync(path.join(root, "sdk/package.json"), JSON.stringify({ name: "@simple-post/sdk" }));
  }
  local = path.join(directory, "local");
  canonical = path.join(directory, "canonical");
});
test.afterEach(() => rmSync(directory, { recursive: true, force: true }));
test("no live config defaults to the local application without account setup", () => {
  expect(configuredAppRoot(path.join(directory, "absent.json"), null, local)).toBe(local);
});
test("canonical CLI selects its checkout and ignores unrelated live configuration", () => {
  const file = path.join(directory, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      cliCommand: "canonical/cli/bin/run.js",
      cliEntry: "local/cli/bin/run.js",
      mediaManifestFile: "missing.json",
    }),
  );
  expect(configuredAppRoot(file, null, local)).toBe(canonical);
});
test("explicit appRoot overrides CLI inference and command-line override wins", () => {
  expect(
    resolveAppRoot({ appRoot: local, cliCommand: path.join(canonical, "cli/bin/run.js") }, undefined, canonical),
  ).toBe(local);
  expect(resolveAppRoot({ appRoot: local }, canonical, local)).toBe(canonical);
});
test("config appRoot is relative to its configuration file", () => {
  const file = path.join(directory, "config.json");
  writeFileSync(file, JSON.stringify({ appRoot: "canonical" }));
  expect(configuredAppRoot(file, null, local)).toBe(canonical);
});
test("generic CLI commands cannot accidentally select another workspace", () => {
  expect(resolveAppRoot({ cliCommand: path.join(canonical, "other/run.js") }, undefined, local)).toBe(local);
});
test("invalid explicit or inferred roots fail instead of silently using the local SDK", () => {
  expect(() => resolveAppRoot({ appRoot: directory }, undefined, local)).toThrow("does not contain");
  expect(() =>
    resolveAppRoot({ cliCommand: path.join(directory, "missing/cli/bin/run.js") }, undefined, local),
  ).toThrow("does not contain");
  expect(() => resolveAppRoot({ appRoot: "" }, undefined, local)).toThrow("nonempty");
});
