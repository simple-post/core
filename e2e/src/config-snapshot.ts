import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "./config.js";

/** Resolve paths before copying: workers and reporters must share one invocation's settings. */
export async function snapshotConfig(source: string) {
  const config = loadConfig(source);
  const dir = await mkdtemp(path.join(tmpdir(), "simplepost-e2e-config-"));
  const file = path.join(dir, "config.json");
  const dispose = () => rm(dir, { recursive: true, force: true });
  try {
    await writeFile(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    return { file, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
