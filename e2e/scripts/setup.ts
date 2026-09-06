import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { configSchema, loadConfig } from "../src/config.js";
import { platforms, type Platform } from "../src/types.js";
import { SchedulerApi } from "../src/http.js";
import { deploymentFingerprint, discoverAccounts, type Choose } from "../src/discovery.js";
import { catalog, materialize } from "../src/catalog.js";
import { assertRequirements } from "../src/preflight.js";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    platform: { type: "string" },
    "account-id": { type: "string", multiple: true },
    "from-cli": { type: "boolean" },
    "cli-config-dir": { type: "string" },
    session: { type: "string" },
    config: { type: "string" },
    mcp: { type: "boolean" },
  },
});
if (positionals.length > 1) throw new Error("Usage: yarn e2e:setup [APP_URL] [--platform tiktok] [--from-cli] [--mcp]");
const file = path.resolve(values.config ?? process.env.E2E_CONFIG ?? "config.local.json");
const root = path.dirname(file);
const prior = existsSync(file) ? loadConfig(file) : undefined;
const cliDir = values["from-cli"]
  ? path.resolve(
      values["cli-config-dir"] ??
        process.env.SIMPLEPOST_CONFIG_DIR ??
        path.join(
          process.env.XDG_CONFIG_HOME ??
            (process.platform === "win32"
              ? (process.env.LOCALAPPDATA ?? path.join(homedir(), ".config"))
              : path.join(homedir(), ".config")),
          "simplepost",
        ),
    )
  : prior?.cliConfigDir;
const cli = values["from-cli"] ? JSON.parse(await readFile(path.join(cliDir!, "config.json"), "utf8")) : undefined;
const url = new URL(positionals[0] ?? prior?.baseUrl ?? cli?.scheduler?.url ?? "https://app.simplepost.social");
if (
  url.username ||
  url.password ||
  url.pathname !== "/" ||
  url.search ||
  url.hash ||
  (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
)
  throw new Error("Use an HTTPS app origin, or a loopback development origin");
if (prior && prior.baseUrl !== url.origin) throw new Error("Use a separate config file for a different deployment");
const requested = (values.platform ?? process.env.E2E_PLATFORMS)?.split(",").map((p) => p.trim());
if (requested?.some((p) => !platforms.includes(p as Platform)))
  throw new Error(`Platform must be one of ${platforms.join(", ")}`);
const state = path.resolve(
  values.session ?? prior?.schedulerStorageState ?? path.join(root, ".local/auth/scheduler.json"),
);
const sessionPath = values["from-cli"] && !values.session ? prior?.schedulerStorageState : state;
const cfg = configSchema.parse({
  ...prior,
  baseUrl: url.origin,
  userId: prior?.userId ?? "pending-login",
  deploymentRevision: prior?.deploymentRevision ?? "unreported-deployment",
  accounts: prior?.accounts ?? {},
  schedulerStorageState: sessionPath,
  apiAuth: values["from-cli"] ? "cli" : "browser",
  cliConfigDir: cliDir,
  cliEntry: prior?.cliEntry ?? path.resolve("../cli/bin/run.js"),
  cliCommand: prior?.cliCommand ?? path.resolve(root, "../../core/cli/bin/run.js"),
  fixtureDir: prior?.fixtureDir ?? path.resolve("fixtures/generated"),
  runDir: prior?.runDir ?? path.join(root, ".local/runs"),
  mediaManifestFile: prior?.mediaManifestFile ?? path.join(root, ".local/media.json"),
  defaultInterfaces: [...new Set([...(prior?.defaultInterfaces ?? []), values["from-cli"] ? "cli-app" : "ui"])],
});
const choose: Choose = async (question, options) => {
  if (!process.stdin.isTTY)
    throw new Error(`${question}: rerun setup interactively or pass --account-id for account selection`);
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(question);
    options.forEach((o, i) => console.log(`${i + 1}. ${o.label} (${o.id})`));
    const index = Number(await input.question("Number: ")) - 1;
    if (!Number.isInteger(index) || !options[index]) throw new Error("Invalid selection");
    return options[index].id;
  } finally {
    input.close();
  }
};
let fingerprint = cfg.deploymentRevision;
let browserUserId: string | undefined;
if (sessionPath && (!values["from-cli"] || values.session)) {
  await mkdir(path.dirname(state), { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ storageState: existsSync(state) ? state : undefined });
    const page = await context.newPage();
    await page.goto(url.origin + "/schedule");
    console.log(
      "Sign in with your test user in the browser. Setup will detect the session automatically; no API key or user ID is needed.",
    );
    const deadline = Date.now() + 600_000;
    while (true) {
      const response = await context.request.get(url.origin + "/api/v1/accounts", { maxRedirects: 0 });
      if (response.ok()) {
        const data = await response.json();
        browserUserId = data.accounts?.[0]?.userId;
        break;
      }
      if (![401, 403].includes(response.status())) throw new Error(`Account discovery failed (${response.status()})`);
      if (Date.now() > deadline) throw new Error("Sign-in timed out");
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    fingerprint = deploymentFingerprint(await page.content());
    await context.storageState({ path: state, indexedDB: true });
    await chmod(state, 0o600);
  } finally {
    await browser.close();
  }
} else {
  const response = await fetch(url.origin + "/login", { redirect: "error", signal: AbortSignal.timeout(30_000) }).catch(
    () => undefined,
  );
  if (response?.ok) fingerprint = deploymentFingerprint(await response.text());
}
const api = new SchedulerApi(cfg);
const discovered = await discoverAccounts(
  (route) => api.request(route),
  requested as Platform[] | undefined,
  values["account-id"] ?? [],
  prior,
  choose,
);
if (browserUserId && discovered.userId !== browserUserId)
  throw new Error(
    "API credentials belong to a different user than the browser login; clear the conflicting API token.",
  );
if (cli?.scheduler?.userId && cli.scheduler.userId !== discovered.userId)
  throw new Error("CLI connection user does not match the authenticated account owner");
cfg.userId = discovered.userId;
cfg.accounts = discovered.accounts;
if (!prior || prior.deploymentRevision === "unreported-deployment") cfg.deploymentRevision = fingerprint;
for (const platform of discovered.selected) {
  const account = cfg.accounts[platform]!;
  const socialState = path.join(root, `.local/auth/${platform}.json`);
  if (!account.observer.storageState && existsSync(socialState)) account.observer.storageState = socialState;
  const local = cli?.[platform]?.accounts?.filter((a: { userId: string }) => a.userId === account.platformAccountId);
  if (local?.length === 1) account.cliAlias = local[0].alias;
}
if (values.mcp) {
  cfg.mcpTokenFile = prior?.mcpTokenFile ?? path.join(root, ".local/auth/mcp-token.json");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve("scripts/mcp-auth.ts"),
        url.origin,
        cfg.mcpTokenFile!,
        ...(sessionPath ? [sessionPath] : []),
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("MCP authorization did not complete"))));
  });
  cfg.defaultInterfaces = [...new Set([...cfg.defaultInterfaces!, "mcp" as const])];
}
await mkdir(root, { recursive: true, mode: 0o700 });
await writeFile(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
await chmod(file, 0o600);
const verificationNeeds = catalog
  .filter((s) => discovered.selected.includes(s.platform) && s.tags.includes("smoke"))
  .flatMap((s) =>
    cfg
      .defaultInterfaces!.filter((iface) => s.interfaces.includes(iface))
      .flatMap((iface) => {
        try {
          assertRequirements(
            materialize(s, cfg.accounts[s.platform]!, iface, "setup", cfg.mediaBaseUrl, cfg.fixtureUrls),
            cfg.accounts[s.platform]!,
          );
          return [];
        } catch (error) {
          return [{ scenario: s.id, interface: iface, reason: (error as Error).message }];
        }
      }),
  );
const report = path.join(root, ".local/setup-report.json");
await mkdir(path.dirname(report), { recursive: true, mode: 0o700 });
await writeFile(
  report,
  JSON.stringify(
    {
      userId: cfg.userId,
      platforms: discovered.selected,
      interfaces: cfg.defaultInterfaces,
      deploymentRevision: cfg.deploymentRevision,
      notes: discovered.notes,
      verificationNeeds,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  `Saved ${file} for user ${cfg.userId}: ${discovered.selected.join(", ")}. No posts or media uploads were created.`,
);
console.log(
  "Fixture uploads happen automatically when a selected live case needs a URL. Social-platform owner sessions and field verification may still need calibration.",
);
for (const note of discovered.notes) console.log(`Setup note: ${note}`);
if (verificationNeeds.length)
  console.log(
    `Platform verification still needs calibration for ${verificationNeeds.length} smoke cases; details are in ${report}.`,
  );
console.log(`Inspect: E2E_CONFIG=${file} E2E_PLATFORMS=${discovered.selected.join(",")} yarn e2e:plan`);
