import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { withIsolatedLocalCli, cleanupCliSnapshots } from "../src/cli-isolation.js";
import { cliCreate, runCli } from "../src/adapters/cli.js";
import { config, account } from "./helpers.js";
import { materialize, catalog } from "../src/catalog.js";

test("completed private snapshots are removed while pending credential recovery is preserved", async () => {
  const run = await mkdtemp(path.join(os.tmpdir(), "cli-snapshot-cleanup-"));
  const complete = path.join(run, ".cli", "x", "a".repeat(64));
  const pending = path.join(run, ".cli", "x", "b".repeat(64));
  try {
    await mkdir(complete, { recursive: true });
    await mkdir(pending, { recursive: true });
    await writeFile(path.join(complete, "secrets.json"), "{}");
    await writeFile(path.join(pending, "pending.json"), "{}");
    await cleanupCliSnapshots(run);
    await expect(stat(complete)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(pending)).isDirectory()).toBe(true);
  } finally {
    await rm(run, { recursive: true, force: true });
  }
});

async function fixture(backend = "file-plain") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cli-isolation-"));
  const source = path.join(dir, "source");
  const run = path.join(dir, "run");
  await mkdir(source, { mode: 0o700 });
  await mkdir(run, { mode: 0o700 });
  const cfg = config({ cliConfigDir: source, cliCommand: path.join(dir, "fake.mjs") });
  const moduleUrl = pathToFileURL(path.resolve(path.dirname(cfg.cliEntry), "../dist/lib/secrets.js")).href;
  const { createSecretStore } = await import(moduleUrl);
  const storage = { backend };
  const store = (configDir: string) =>
    createSecretStore(
      {
        configDir,
        configFile: path.join(configDir, "config.json"),
        plainSecretsFile: path.join(configDir, "secrets.json"),
        encryptedSecretsFile: path.join(configDir, "secrets.enc.json"),
      },
      storage,
      {
        secret: () => {
          throw new Error("must not prompt");
        },
      },
    );
  await writeFile(
    path.join(source, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      storage,
      x: { accounts: [{ alias: "test", userId: "platform-user", secretRef: "ref-x" }] },
      youtube: { accounts: [{ alias: "test", userId: "platform-user", secretRef: "ref-youtube" }] },
    }),
    { mode: 0o600 },
  );
  await store(source).write("ref-x", { accessToken: "old-x", refreshToken: "refresh-x" });
  await store(source).write("ref-youtube", { accessToken: "old-youtube", refreshToken: "refresh-youtube" });
  await store(source).write("unrelated", { token: "untouched" });
  await writeFile(
    cfg.cliCommand!,
    `
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createSecretStore } from ${JSON.stringify(moduleUrl)};
const dir = process.env.SIMPLEPOST_CONFIG_DIR;
const args = process.argv.slice(2);
const platform = args[args.indexOf('--account') + 1].split(':')[0];
const mode = args[args.indexOf('--text') + 1];
const raw = JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8'));
const ref = raw[platform].accounts[0].secretRef;
const store = createSecretStore({ configDir: dir, configFile: path.join(dir, 'config.json'), plainSecretsFile: path.join(dir, 'secrets.json'), encryptedSecretsFile: path.join(dir, 'secrets.enc.json') }, raw.storage, { secret: () => { throw new Error('prompt forbidden'); } });
if (mode === 'barrier' || mode === 'fail') {
  await writeFile(path.join(${JSON.stringify(dir)}, platform + '.started'), '', { mode: 0o600 });
  const other = path.join(${JSON.stringify(dir)}, (platform === 'x' ? 'youtube' : 'x') + '.started');
  const deadline = Date.now() + 5000;
  while (true) {
    try { await access(other); break; } catch {}
    if (Date.now() > deadline) process.exit(9);
    await new Promise(r => setTimeout(r, 10));
  }
}
const refresh = async () => store.write(ref, { ...await store.read(ref), accessToken: 'new-' + platform });
if (mode === 'timeout') {
  process.on('SIGTERM', async () => { await new Promise(r => setTimeout(r, 100)); await refresh(); process.exit(2); });
  await writeFile(path.join(${JSON.stringify(dir)}, 'ready'), '', { mode: 0o600 });
  setInterval(() => {}, 1000);
} else {
  if (mode !== 'unchanged') await refresh();
  console.log('(id: fake-id)');
  process.exitCode = mode === 'fail' ? 2 : 0;
}
`,
    { mode: 0o600 },
  );
  return {
    dir,
    run,
    cfg,
    store,
    source,
    a: account({ cliAlias: "test" }),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

for (const backend of ["file-plain", "file-encrypted"]) {
  test(`${backend}: parallel platforms preserve both refreshes, including a failed subprocess`, async () => {
    const previous = process.env.SIMPLE_POST_CONFIG_PASSWORD;
    process.env.SIMPLE_POST_CONFIG_PASSWORD = "offline-test-password";
    const f = await fixture(backend);
    try {
      const outputs = await Promise.all(
        ["x", "youtube"].map((platform) =>
          withIsolatedLocalCli(f.cfg, platform, f.a, f.run, async (isolated) => {
            expect(isolated.cliConfigDir).not.toBe(f.source);
            expect((await stat(isolated.cliConfigDir!)).mode & 0o777).toBe(0o700);
            const local = f.store(isolated.cliConfigDir!);
            expect(await local.read("unrelated")).toBeNull();
            expect(await local.read(platform === "x" ? "ref-youtube" : "ref-x")).toBeNull();
            for (const name of await readdir(isolated.cliConfigDir!))
              expect((await stat(path.join(isolated.cliConfigDir!, name))).mode & 0o777).toBe(0o600);
            return runCli(isolated, [
              "post",
              "--account",
              `${platform}:test`,
              "--text",
              platform === "x" ? "barrier" : "fail",
            ]);
          }),
        ),
      );
      expect(outputs.map((output) => output.code)).toEqual([0, 2]);
      for (const platform of ["x", "youtube"])
        expect(await f.store(f.source).read(`ref-${platform}`)).toEqual({
          accessToken: `new-${platform}`,
          refreshToken: `refresh-${platform}`,
        });
      expect(await f.store(f.source).read("unrelated")).toEqual({ token: "untouched" });
      expect(JSON.stringify(outputs)).not.toMatch(/new-x|new-youtube|refresh-/);
    } finally {
      await f.cleanup();
      if (previous === undefined) delete process.env.SIMPLE_POST_CONFIG_PASSWORD;
      else process.env.SIMPLE_POST_CONFIG_PASSWORD = previous;
    }
  });
}

test("unchanged local state cannot overwrite a newer original credential; each call resyncs", async () => {
  const f = await fixture();
  try {
    await withIsolatedLocalCli(f.cfg, "x", f.a, f.run, async () => {
      await f.store(f.source).write("ref-x", { accessToken: "external-refresh" });
    });
    await withIsolatedLocalCli(f.cfg, "x", f.a, f.run, async (isolated) => {
      expect(await f.store(isolated.cliConfigDir!).read("ref-x")).toEqual({ accessToken: "external-refresh" });
    });
    expect(await f.store(f.source).read("ref-x")).toEqual({ accessToken: "external-refresh" });
  } finally {
    await f.cleanup();
  }
});

test("conflicting refresh is retained privately without clobbering original or logging secrets", async () => {
  const f = await fixture();
  try {
    let localDir = "";
    await expect(
      withIsolatedLocalCli(f.cfg, "x", f.a, f.run, async (isolated) => {
        localDir = isolated.cliConfigDir!;
        await f.store(localDir).write("ref-x", { accessToken: "local-private" });
        await f.store(f.source).write("ref-x", { accessToken: "external-private" });
      }),
    ).rejects.toThrow("private refresh retained for manual reconciliation");
    expect(await f.store(f.source).read("ref-x")).toEqual({ accessToken: "external-private" });
    expect(await f.store(localDir).read("ref-x")).toEqual({ accessToken: "local-private" });
    await expect(withIsolatedLocalCli(f.cfg, "x", f.a, f.run, async () => "must not execute")).rejects.toThrow(
      "needs reconciliation",
    );
    expect(await f.store(localDir).read("ref-x")).toEqual({ accessToken: "local-private" });
  } finally {
    await f.cleanup();
  }
});

test("same credential is rejected across concurrent runs and lease releases on failure", async () => {
  const f = await fixture();
  try {
    await expect(
      withIsolatedLocalCli(f.cfg, "x", f.a, f.run, async () => {
        await expect(
          withIsolatedLocalCli(f.cfg, "x", f.a, path.join(f.dir, "other-run"), async () => {
            throw new Error("must not execute");
          }),
        ).rejects.toThrow("already in use");
        throw new Error("private-token-must-not-leak");
      }),
    ).rejects.toThrow("CLI isolation or execution failed");
    await expect(withIsolatedLocalCli(f.cfg, "x", f.a, f.run, async () => "ok")).resolves.toBe("ok");
  } finally {
    await f.cleanup();
  }
});

test("adapter isolates cli-local and reconciles before reporting subprocess failure", async () => {
  const f = await fixture();
  try {
    // The other marker allows the failing fake CLI to pass its parallelism barrier.
    await writeFile(path.join(f.dir, "youtube.started"), "", { mode: 0o600 });
    const s = materialize(
      catalog.find((entry) => entry.id === "x.smoke")!,
      f.a,
      "cli-local",
      "isolation",
      f.cfg.mediaBaseUrl,
      {},
    );
    s.message = "fail";
    await expect(cliCreate(f.cfg, s, f.a, [], "cli-local", f.run)).rejects.toThrow("CLI exited 2");
    expect((await f.store(f.source).read("ref-x")).accessToken).toBe("new-x");
    const evidence = await readFile(path.join(f.run, `${s.token}-cli.txt`), "utf8");
    expect(evidence).not.toMatch(/new-x|refresh-x/);
  } finally {
    await f.cleanup();
  }
});

test("timeout waits for child exit and reconciles a final SIGTERM refresh", async () => {
  const f = await fixture();
  try {
    await expect(
      withIsolatedLocalCli({ ...f.cfg, publishTimeoutMs: 1000 }, "x", f.a, f.run, (isolated) =>
        runCli(isolated, ["post", "--account", "x:test", "--text", "timeout"]),
      ),
    ).rejects.toThrow("INCONCLUSIVE");
    expect((await f.store(f.source).read("ref-x")).accessToken).toBe("new-x");
  } finally {
    await f.cleanup();
  }
});

test("encrypted backend requires the CLI password environment variable without prompting", async () => {
  const previous = process.env.SIMPLE_POST_CONFIG_PASSWORD;
  process.env.SIMPLE_POST_CONFIG_PASSWORD = "offline-test-password";
  const f = await fixture("file-encrypted");
  delete process.env.SIMPLE_POST_CONFIG_PASSWORD;
  try {
    await expect(
      withIsolatedLocalCli(f.cfg, "x", f.a, f.run, async () => {
        throw new Error("must not execute");
      }),
    ).rejects.toThrow("password environment variable");
  } finally {
    await f.cleanup();
    if (previous === undefined) delete process.env.SIMPLE_POST_CONFIG_PASSWORD;
    else process.env.SIMPLE_POST_CONFIG_PASSWORD = previous;
  }
});

test("keychain does not copy or reconcile shared refs and locks the same ref across config directories", async () => {
  const f = await fixture();
  try {
    const lib = path.join(f.dir, "mock-cli", "dist", "lib");
    await mkdir(lib, { recursive: true, mode: 0o700 });
    await writeFile(path.join(f.dir, "mock-cli", "package.json"), '{"type":"module"}', { mode: 0o600 });
    await writeFile(
      path.join(lib, "constants.js"),
      'export const DEFAULT_PASSWORD_ENV_VAR = "SIMPLE_POST_CONFIG_PASSWORD";',
      { mode: 0o600 },
    );
    await writeFile(
      path.join(lib, "secrets.js"),
      `export function createSecretStore() {
      return { read: async () => ({accessToken: 'mock-keychain'}), write: async () => { throw new Error('Keychain must not be copied or merged'); } };
    }`,
      { mode: 0o600 },
    );
    const raw = JSON.parse(await readFile(path.join(f.source, "config.json"), "utf8"));
    raw.storage.backend = "keychain";
    // Unique refs avoid interference with other self-test runs using the OS temp directory.
    raw.x.accounts[0].secretRef = `${f.dir}-x`;
    raw.youtube.accounts[0].secretRef = `${f.dir}-youtube`;
    await writeFile(path.join(f.source, "config.json"), JSON.stringify(raw), { mode: 0o600 });
    const otherSource = path.join(f.dir, "other-source");
    await mkdir(otherSource, { mode: 0o700 });
    await writeFile(path.join(otherSource, "config.json"), JSON.stringify(raw), { mode: 0o600 });
    const cfg = { ...f.cfg, cliEntry: path.join(f.dir, "mock-cli", "bin", "run.js") };
    await withIsolatedLocalCli(cfg, "x", f.a, f.run, async (isolated) => {
      expect(await readdir(isolated.cliConfigDir!)).toEqual(["config.json"]);
      await expect(
        withIsolatedLocalCli({ ...cfg, cliConfigDir: otherSource }, "x", f.a, f.run, async () => "should not execute"),
      ).rejects.toThrow("already in use");
      await expect(withIsolatedLocalCli(cfg, "youtube", f.a, f.run, async () => "parallel")).resolves.toBe("parallel");
    });
  } finally {
    await f.cleanup();
  }
});

test("cli-app keeps the original config directory without staging credentials", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.cfg.cliCommand!,
      `
      if (process.env.SIMPLEPOST_CONFIG_DIR !== ${JSON.stringify(f.source)}) process.exit(3);
      console.log('(id: app-id)');
    `,
      { mode: 0o600 },
    );
    const s = materialize(
      catalog.find((entry) => entry.id === "x.smoke")!,
      f.a,
      "cli-app",
      "isolation-app",
      f.cfg.mediaBaseUrl,
      {},
    );
    const receipt = await cliCreate(f.cfg, s, f.a, [], "cli-app", f.run);
    expect(receipt.results[0].postId).toBe("app-id");
    expect(await readdir(f.run)).not.toContain(".cli");
    expect((await f.store(f.source).read("ref-x")).accessToken).toBe("old-x");
  } finally {
    await f.cleanup();
  }
});
