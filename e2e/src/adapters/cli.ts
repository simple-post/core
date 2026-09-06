import { spawn } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { optionFlags } from "./cli-flags.js";
import { redact } from "../redact.js";
import type { Account, LiveConfig } from "../config.js";
import type { Materialized, MediaFile, Receipt, Interface } from "../types.js";
export async function runCli(
  config: LiveConfig,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!config.cliConfigDir) throw new Error("Configure cliConfigDir with a dedicated CLI configuration");
  const command = config.cliCommand ?? config.cliEntry;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command, ...args], {
      cwd: path.dirname(command),
      env: { ...process.env, SIMPLEPOST_CONFIG_DIR: config.cliConfigDir, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
      finish(new Error("INCONCLUSIVE: CLI timed out. Publishing may continue remotely; do not rerun."));
    }, config.publishTimeoutMs);
    function finish(error?: Error, code = 1) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ code, stdout, stderr });
    }
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) {
        child.kill();
        finish(new Error("CLI output exceeded limit"));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 2_000_000) {
        child.kill();
        finish(new Error("CLI output exceeded limit"));
      }
    });
    child.on("error", (e) => finish(e));
    child.on("close", (code) => finish(undefined, code ?? 1));
  });
}
export async function checkCliIdentity(config: LiveConfig, iface: Interface, account: Account, platform: string) {
  if (!config.cliConfigDir) throw new Error("Missing cliConfigDir");
  const raw = JSON.parse(await readFile(path.join(config.cliConfigDir, "config.json"), "utf8"));
  if (
    iface === "cli-app" &&
    (raw.scheduler?.userId !== config.userId || raw.scheduler?.url?.replace(/\/$/, "") !== config.baseUrl)
  )
    throw new Error("Dedicated CLI scheduler user or URL does not match the manifest");
  if (iface === "cli-local") {
    const record = raw[platform]?.accounts?.find((x: { alias: string }) => x.alias === account.cliAlias);
    const expectedId =
      account.localPlatformAccountId ??
      (platform === "youtube" ? account.resources.channelId : undefined) ??
      account.platformAccountId;
    if (!record || record.userId !== expectedId)
      throw new Error(`CLI ${platform} alias identity does not match the manifest`);
  }
  const result = await runCli(config, ["account", platform]);
  if (
    result.code !== 0 ||
    !result.stdout.includes(iface === "cli-app" ? account.id : `${platform}:${account.cliAlias}`)
  )
    throw new Error(`CLI account discovery failed for ${platform}`);
}
export function parseCliId(stdout: string): string {
  const ids = [...stdout.replace(/\x1b\[[0-9;]*m/g, "").matchAll(/\(id: ([^)]+)\)/g)].map((x) => x[1]);
  if (ids.length !== 1)
    throw new Error(
      `INCONCLUSIVE: expected one CLI platform ID, received ${ids.length}. Inspect stdout before retrying.`,
    );
  return ids[0];
}
export async function cliCreate(
  config: LiveConfig,
  s: Materialized,
  account: Account,
  media: MediaFile[],
  iface: Interface,
  dir: string,
): Promise<Receipt> {
  const args = [
    "post",
    "--log-level",
    "none",
    iface === "cli-app" ? "--app-account-id" : "--account",
    iface === "cli-app" ? account.id : `${s.platform}:${account.cliAlias}`,
  ];
  const optionsFile = path.join(dir, `${s.token}-options.json`);
  const mapped = optionFlags(s.platform, s.options);
  await writeFile(optionsFile, JSON.stringify({ [s.platform]: s.options }), { mode: 0o600 });
  if (s.input === "json") {
    const file = path.join(dir, `${s.token}-post.json`);
    await writeFile(
      file,
      JSON.stringify({
        platforms: [s.platform],
        content: { text: s.message, media: media.map((m) => ({ type: m.type, path: m.path })) },
        options: { [s.platform]: s.options },
      }),
      { mode: 0o600 },
    );
    args.push("--post-json", file);
  } else {
    args.push("--text", s.message);
    if (Object.keys(mapped.remaining).length) args.push("--options-json", optionsFile);
    else args.push(...mapped.args);
    const needsOrderedMedia = media.some(
      (file, index) => file.type === "image" && media.slice(0, index).some((previous) => previous.type === "video"),
    );
    if (needsOrderedMedia) {
      // Separate --image/--video flags group by type in the CLI. The customer-facing
      // --media-json option expresses interleaved albums without reordering.
      const file = path.join(dir, `${s.token}-media.json`);
      await writeFile(
        file,
        JSON.stringify(
          media.map((m) => ({ type: m.type, ...(s.input === "remote" ? { url: m.url } : { path: m.path }) })),
        ),
        { mode: 0o600 },
      );
      args.push("--media-json", file);
    } else
      for (const file of media)
        args.push(file.type === "image" ? "--image" : "--video", s.input === "remote" ? file.url : file.path);
  }
  const result = await runCli(config, args);
  // Keep only sanitized process output. Tokens must not be passed in flags or JSON.
  await writeFile(path.join(dir, `${s.token}-cli.txt`), redact(`${result.stdout}\n${result.stderr}`), { mode: 0o600 });
  if (s.expectedError) {
    if (result.code === 0) {
      const id = parseCliId(result.stdout);
      return {
        results: [{ success: true, postId: id, accountId: account.id, platform: s.platform }],
        status: "unexpectedly-published",
      };
    }
    if (!new RegExp(s.expectedError, "i").test(result.stdout + result.stderr))
      throw new Error("CLI failed for an unexpected reason; see sanitized process evidence");
    return { results: [], status: "validation-rejected" };
  }
  if (result.code !== 0)
    throw new Error(
      `CLI exited ${result.code}; see process evidence. Reconcile platform state before another attempt.`,
    );
  return {
    results: [{ success: true, postId: parseCliId(result.stdout), accountId: account.id, platform: s.platform }],
  };
}
