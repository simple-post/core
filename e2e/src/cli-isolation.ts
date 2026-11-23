import { chmod, mkdir, open, readFile, realpath, rm, unlink, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import type { Account, LiveConfig } from "./config.js";
import { atomicJson, readJson, withFileLock } from "./files.js";
import { platforms } from "./types.js";

class IsolationError extends Error {}

/** Remove only completed private snapshots, never a pending credential refresh. */
export async function cleanupCliSnapshots(runDir: string) {
  const base = path.join(runDir, ".cli");
  for (const platform of platforms) {
    const lane = path.join(base, platform);
    let entries;
    try {
      entries = await readdir(lane, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const snapshot = path.join(lane, entry.name);
      if (await readJson(path.join(snapshot, "pending.json"))) continue;
      await rm(snapshot, { recursive: true, force: true });
    }
  }
}

type Payload = Record<string, unknown>;
type Backend = "file-plain" | "file-encrypted" | "keychain";
type Storage = { backend: Backend };
type Store = { read(ref: string): Promise<Payload | null>; write(ref: string, value: Payload): Promise<void> };
type Paths = { configDir: string; configFile: string; plainSecretsFile: string; encryptedSecretsFile: string };
type CliConfig = { storage: Storage } & Record<string, unknown>;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const paths = (dir: string): Paths => ({
  configDir: dir,
  configFile: path.join(dir, "config.json"),
  plainSecretsFile: path.join(dir, "secrets.json"),
  encryptedSecretsFile: path.join(dir, "secrets.enc.json"),
});
async function privateDir(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}
function target(raw: CliConfig, platform: string, account: Account): string {
  const records = (raw[platform] as { accounts?: { alias: string; userId: string; secretRef: string }[] })?.accounts;
  const matches = records?.filter((entry) => entry.alias === account.cliAlias) ?? [];
  const expectedId =
    account.localPlatformAccountId ??
    (platform === "youtube" ? account.resources.channelId : undefined) ??
    account.platformAccountId;
  if (matches.length !== 1 || matches[0].userId !== expectedId || !matches[0].secretRef)
    throw new IsolationError("CLI isolation account identity does not match the manifest");
  return matches[0].secretRef;
}

/**
 * Only config.json and the selected secretRef are staged. File-store transactions
 * use a shared short lock; publishing holds only a fail-fast credential lease.
 * External CLI writers must be quiescent: they do not participate in these locks.
 */
export async function withIsolatedLocalCli<T>(
  config: LiveConfig,
  platform: string,
  account: Account,
  runDir: string,
  action: (isolated: LiveConfig) => Promise<T>,
): Promise<T> {
  if (!config.cliConfigDir || !account.cliAlias || !/^[a-z]+$/.test(platform))
    throw new IsolationError("CLI isolation requires a configuration directory, platform and account alias");
  const sourceDir = await realpath(config.cliConfigDir);
  const mutationLock = path.join(sourceDir, ".e2e-secrets.lock");
  const root = path.resolve(path.dirname(config.cliEntry), "../dist/lib");
  const { createSecretStore } = (await import(pathToFileURL(path.join(root, "secrets.js")).href)) as {
    createSecretStore(paths: Paths, storage: Storage, prompt: unknown): Store;
  };
  const { DEFAULT_PASSWORD_ENV_VAR } = (await import(pathToFileURL(path.join(root, "constants.js")).href)) as {
    DEFAULT_PASSWORD_ENV_VAR: string;
  };
  // Never prompt or forward store diagnostics that could contain credential bytes.
  const prompt = {
    secret: async () => {
      throw new IsolationError("Encrypted CLI secrets require the password environment variable");
    },
  };
  let lease: string | undefined;
  const leaseToken = randomUUID();
  try {
    const staged = await withFileLock(mutationLock, async () => {
      const raw = JSON.parse(await readFile(paths(sourceDir).configFile, "utf8")) as CliConfig;
      const backend = raw.storage?.backend;
      if (!["file-plain", "file-encrypted", "keychain"].includes(backend))
        throw new IsolationError("CLI isolation requires an explicit supported secret backend");
      if (backend === "file-encrypted" && !process.env[DEFAULT_PASSWORD_ENV_VAR])
        throw new IsolationError("Encrypted CLI secrets require the password environment variable");
      const ref = target(raw, platform, account);
      // Keychain refs share one OS service, including across config directories.
      const leaseDir =
        backend === "keychain"
          ? path.join(os.tmpdir(), `simplepost-e2e-keychain-${process.getuid?.() ?? "user"}`)
          : sourceDir;
      if (backend === "keychain") await privateDir(leaseDir);
      const leaseFile = path.join(leaseDir, `.e2e-credential-${digest(ref)}.lock`);
      let handle;
      try {
        handle = await open(leaseFile, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new IsolationError(
            "CLI credential is already in use; inspect its owner before clearing a stale credential lock",
          );
        throw error;
      }
      lease = leaseFile;
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, token: leaseToken }));
      } finally {
        await handle.close();
      }
      const base = path.join(runDir, ".cli");
      await privateDir(base);
      const lane = path.join(base, platform);
      await privateDir(lane);
      const localDir = path.join(lane, digest(`${sourceDir}\0${ref}`));
      await privateDir(localDir);
      const pendingFile = path.join(localDir, "pending.json");
      if (await readJson(pendingFile))
        throw new IsolationError("CLI isolated refresh needs reconciliation before reusing its private directory");
      await atomicJson(paths(localDir).configFile, raw);
      // Discard old local snapshots only after claiming this credential.
      await rm(paths(localDir).plainSecretsFile, { force: true });
      await rm(paths(localDir).encryptedSecretsFile, { force: true });
      const source = createSecretStore(paths(sourceDir), raw.storage, prompt);
      const local = createSecretStore(paths(localDir), raw.storage, prompt);
      const before = await source.read(ref);
      if (!before) throw new IsolationError("CLI target credential is missing");
      if (backend !== "keychain") {
        await local.write(ref, before);
        await atomicJson(pendingFile, { pid: process.pid });
      }
      return { ref, before, source, local, localDir, backend, pendingFile };
    });
    try {
      return await action({ ...config, cliConfigDir: staged.localDir });
    } finally {
      // The caller must await child exit, even on timeout or nonzero status.
      if (staged.backend !== "keychain") {
        const after = await staged.local.read(staged.ref);
        if (!after)
          throw new IsolationError("CLI isolated credential disappeared; inspect private state before retrying");
        if (!isDeepStrictEqual(after, staged.before)) {
          await withFileLock(mutationLock, async () => {
            const current = JSON.parse(await readFile(paths(sourceDir).configFile, "utf8")) as CliConfig;
            if (current.storage?.backend !== staged.backend || target(current, platform, account) !== staged.ref)
              throw new IsolationError(
                "CLI account configuration changed during publishing; private credentials retained",
              );
            const latest = await staged.source.read(staged.ref);
            if (isDeepStrictEqual(latest, after)) return;
            if (!isDeepStrictEqual(latest, staged.before))
              throw new IsolationError(
                "CLI credentials changed concurrently; private refresh retained for manual reconciliation",
              );
            await staged.source.write(staged.ref, after);
          });
        }
        await unlink(staged.pendingFile);
      }
    }
  } catch (error) {
    // Do not include parser/store/command error text: it can contain secret values.
    throw new Error(
      `INCONCLUSIVE: ${error instanceof IsolationError ? error.message : "CLI isolation or execution failed; inspect private state before retrying"}`,
    );
  } finally {
    if (lease && (await readJson<{ token: string }>(lease))?.token === leaseToken) await unlink(lease);
  }
}
