import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getCliPaths } from "../src/lib/config.js";

export const CLI_ROOT = path.resolve(__dirname, "..");

export async function makeTempHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "simple-post-cli-"));
}

export function getExpectedConfigDir(home: string): string {
  // Keep in sync with `oclif.dirname` in package.json — oclif derives the
  // CLI config directory from it.
  return path.join(home, ".config", "simplepost");
}

export function getExpectedCliPaths(home: string) {
  return getCliPaths(getExpectedConfigDir(home));
}

export function createCliTestEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
  };
}

export function createPromptStub(
  overrides?: Partial<Record<"confirm" | "log" | "multiSelect" | "secret" | "select" | "text", jest.Mock>>,
) {
  return {
    interactive: true,
    confirm: overrides?.confirm ?? jest.fn(),
    log: overrides?.log ?? jest.fn(),
    multiSelect: overrides?.multiSelect ?? jest.fn(),
    secret: overrides?.secret ?? jest.fn(),
    select: overrides?.select ?? jest.fn(),
    text: overrides?.text ?? jest.fn(),
  };
}
