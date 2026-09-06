import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { platforms, interfaces } from "./types.js";
const probe = z
  .object({
    selector: z.string().min(1),
    attribute: z.string().optional(),
    values: z.record(z.string(), z.string()).optional(),
    count: z.boolean().optional(),
    scope: z.enum(["post", "page"]).default("post"),
  })
  .strict();
const observer = z
  .object({
    storageState: z.string().optional(),
    profileUrl: z.url(),
    inboxUrl: z.url().optional(),
    youtubeAccessTokenEnv: z.string().optional(),
    youtubeReadback: z.boolean().optional(),
    postUrlTemplate: z.string().optional(),
    root: z.string().optional(),
    author: z.string().optional(),
    text: z.string().optional(),
    images: z.string().optional(),
    video: z.string().optional(),
    mediaItems: z.string().optional(),
    telegramWeb: z
      .object({ botPeerId: z.string().regex(/^[1-9]\d*$/), botUsername: z.string().regex(/^[A-Za-z0-9_]+$/) })
      .strict()
      .optional(),
    title: z.string().optional(),
    nextImage: z.string().optional(),
    open: z.array(z.string()).default([]),
    fields: z.record(z.string(), probe).default({}),
  })
  .strict();
export const configSchema = z
  .object({
    baseUrl: z.url(),
    userId: z.string().min(1),
    apiTokenEnv: z.string().default("E2E_API_TOKEN"),
    apiAuth: z.enum(["browser", "cli"]).optional(),
    mcpTokenEnv: z.string().default("E2E_MCP_TOKEN"),
    mcpTokenFile: z.string().optional(),
    schedulerStorageState: z.string().optional(),
    cliConfigDir: z.string().optional(),
    cliEntry: z.string().default("../cli/bin/run.js"),
    // CLI process used by live cli-app/cli-local cases. Keep cliEntry for the
    // secret-store reader, which can remain on the harness checkout.
    cliCommand: z.string().optional(),
    appRoot: z.string().optional(),
    deploymentRevision: z.string().min(1),
    defaultInterfaces: z.array(z.enum(interfaces)).min(1).optional(),
    mediaBaseUrl: z.url().default("https://fixtures.invalid/"),
    mediaManifestFile: z.string().optional(),
    fixtureUrls: z.record(z.string(), z.url()).default({}),
    fixtureDir: z.string().default("fixtures/generated"),
    runDir: z.string().default(".local/runs"),
    maxPosts: z.union([z.literal("auto"), z.number().int().positive()]).default("auto"),
    perPlatformBudget: z.record(z.string(), z.number().int().positive()).default({ tiktok: 8 }),
    publishTimeoutMs: z.number().int().positive().default(600_000),
    verifyTimeoutMs: z.number().int().positive().default(180_000),
    scheduleDelayMinutes: z.number().int().min(1).max(30).default(1),
    dispatchAllowanceMs: z.number().int().positive().default(300_000),
    accounts: z.partialRecord(
      z.enum(platforms),
      z
        .object({
          id: z.string().min(1),
          platformAccountId: z.string().min(1),
          username: z.string().min(1),
          apiUsername: z.string().nullable().optional(),
          localPlatformAccountId: z.string().optional(),
          cliAlias: z.string().optional(),
          resources: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
          capabilities: z.array(z.string()).default([]),
          observer,
        })
        .strict(),
    ),
  })
  .strict();
export type LiveConfig = z.infer<typeof configSchema>;
export type Account = NonNullable<LiveConfig["accounts"][(typeof platforms)[number]]>;
export type Observer = Account["observer"];
export function loadConfig(file = process.env.E2E_CONFIG ?? "config.local.json"): LiveConfig {
  if (!existsSync(file))
    throw new Error(
      `Missing ${file}. Run yarn e2e:setup to sign in and discover your test accounts. No posts were submitted.`,
    );
  const config = configSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const root = path.dirname(path.resolve(file));
  for (const key of [
    "mcpTokenFile",
    "mediaManifestFile",
    "cliEntry",
    "cliCommand",
    "appRoot",
    "fixtureDir",
    "runDir",
    "cliConfigDir",
    "schedulerStorageState",
  ] as const) {
    if (config[key]) config[key] = path.resolve(root, config[key]!);
  }
  for (const [platform, account] of Object.entries(config.accounts)) {
    const savedState = path.join(root, `.local/auth/${platform}.json`);
    if (account && !account.observer.storageState && existsSync(savedState)) account.observer.storageState = savedState;
    if (account?.observer.storageState)
      account.observer.storageState = path.resolve(root, account.observer.storageState);
  }
  const savedMcpToken = path.join(root, ".local/auth/mcp-token.json");
  if (!config.mcpTokenFile && existsSync(savedMcpToken)) config.mcpTokenFile = savedMcpToken;
  const url = new URL(config.baseUrl);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("baseUrl must be an origin without credentials, path, or query.");
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Remote deployments must use HTTPS.");
  config.baseUrl = url.origin;
  if (config.mediaManifestFile && existsSync(config.mediaManifestFile)) {
    const manifest = JSON.parse(readFileSync(config.mediaManifestFile, "utf8"));
    if (manifest.baseUrl !== config.baseUrl || manifest.userId !== config.userId)
      throw new Error("Fixture manifest belongs to a different deployment or user");
    config.fixtureUrls = { ...z.record(z.string(), z.url()).parse(manifest.urls), ...config.fixtureUrls };
  }
  return config;
}
export function secret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing secret environment variable ${name}`);
  return value;
}
export function selection(config?: LiveConfig, env: NodeJS.ProcessEnv = process.env) {
  const parse = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: readonly T[]): T[] => {
    const list = value ? value.split(",").map((x) => x.trim()) : [...fallback];
    if (!list.length || list.some((x) => !allowed.includes(x as T)))
      throw new Error(`Expected one or more of ${allowed.join(", ")}, got ${value}`);
    return [...new Set(list)] as T[];
  };
  const profile = env.E2E_PROFILE ?? "smoke";
  const file = env.E2E_CONFIG ?? "config.local.json";
  config ??= existsSync(file) ? loadConfig(file) : undefined;
  if (!["smoke", "full", "regression", "lifecycle", "negative"].includes(profile))
    throw new Error(`Unknown E2E_PROFILE: ${profile}`);
  return {
    platforms: parse(
      env.E2E_PLATFORMS,
      platforms,
      config ? (Object.keys(config.accounts) as (typeof platforms)[number][]) : platforms,
    ),
    interfaces: parse(env.E2E_INTERFACES, interfaces, config?.defaultInterfaces ?? ["mcp", "cli-app", "ui"]),
    profile,
    filter: env.E2E_SCENARIO,
  };
}
export function runId(): string {
  const id = process.env.E2E_RUN_ID;
  if (!id || !/^[a-zA-Z0-9_-]{1,70}$/.test(id))
    throw new Error("Set E2E_RUN_ID to a unique alphanumeric run name (reuse it only to resume).");
  return id;
}

export function mcpToken(config: LiveConfig): string {
  if (process.env[config.mcpTokenEnv]) return secret(config.mcpTokenEnv);
  if (config.mcpTokenFile) {
    const value = JSON.parse(readFileSync(config.mcpTokenFile, "utf8"));
    if (typeof value.access_token === "string" && value.access_token) return value.access_token;
  }
  throw new Error("Configure an MCP OAuth token with E2E_MCP_TOKEN or mcpTokenFile; use the mcp-auth setup command.");
}
