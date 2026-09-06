import { readFile, access, mkdir, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { loadConfig, runId, selection, secret, type LiveConfig, type Account } from "./config.js";
import { selectedCases, materialize } from "./catalog.js";
import { SchedulerApi } from "./http.js";
import { McpClient } from "./adapters/mcp.js";
import { checkCliIdentity, runCli } from "./adapters/cli.js";
import { mediaFiles, prepareMediaSources } from "./media.js";
import { allowedHost } from "./verification/browser.js";
import type { MediaKey, Materialized } from "./types.js";
import { Journal } from "./journal.js";
import { budgetPlan } from "./budget.js";
import { assertTelegramObserver } from "./verification/telegram.js";
import { openComposer } from "./adapters/ui.js";
export function assertRequirements(s: Materialized, account: Account) {
  for (const requirement of s.requirements ?? []) {
    if (requirement.startsWith("resource:")) {
      if (account.resources[requirement.slice(9)] === undefined)
        throw new Error(`BLOCKED: ${s.id} needs ${requirement}`);
    } else if (!account.capabilities.includes(requirement))
      throw new Error(`BLOCKED: ${s.id} needs account capability ${requirement}`);
  }
  if (s.expectedError || s.mode === "cancel" || s.mode === "draft") return;
  if (s.platform === "telegram") assertTelegramObserver(account);
  if (s.platform === "linkedin" && !/^\/in\/[^/]+\/?$/.test(new URL(account.observer.profileUrl).pathname))
    throw new Error("BLOCKED before posting: LinkedIn requires the exact configured /in/ author profile URL.");
  if (s.platform === "youtube" && s.expectedFields.privacyStatus === "private") {
    if (
      !(account.observer.youtubeReadback || account.observer.youtubeAccessTokenEnv) ||
      !/^UC[\w-]+$/.test(String(account.resources.channelId ?? ""))
    )
      throw new Error(
        "BLOCKED before posting: private YouTube requires owner API readback and discovered resources.channelId.",
      );
  }
  for (const key of Object.keys(s.expectedFields))
    if (!(s.platform === "telegram" && key === "replyTo" && account.resources.replyToId !== undefined))
      if (
        !account.observer.fields[key] &&
        !(s.platform === "linkedin" && key === "visibility" && s.expectedFields.visibility === "PUBLIC") &&
        !(
          s.platform === "youtube" &&
          (account.observer.youtubeAccessTokenEnv || account.observer.youtubeReadback) &&
          ["privacyStatus", "selfDeclaredMadeForKids", "tags", "categoryId", "playlistId", "thumbnailImage"].includes(
            key,
          )
        )
      )
        throw new Error(
          `BLOCKED before posting: configure ${s.platform}.observer.fields.${key} to verify the setting on the platform.`,
        );
  if (s.options.publishMode === "draft" && !account.observer.inboxUrl)
    throw new Error("BLOCKED: TikTok inbox delivery requires an owner inbox verification URL.");
  if (s.platform === "youtube" && account.observer.youtubeAccessTokenEnv) {
    secret(account.observer.youtubeAccessTokenEnv);
    if (!account.resources.channelId && !account.platformAccountId.startsWith("UC"))
      throw new Error(
        "BLOCKED: configure YouTube resources.channelId; the scheduler may store a Google user ID rather than a channel ID.",
      );
  }
  if (!allowedHost(s.platform, account.observer.profileUrl, account))
    throw new Error(`Invalid ${s.platform} profile URL`);
}
export function matchesApiUsername(account: Account, actual: unknown): boolean {
  const expected = account.apiUsername === undefined ? account.username : account.apiUsername;
  return expected === null
    ? actual === null
    : typeof actual === "string" && actual.replace(/^@/, "") === expected.replace(/^@/, "");
}
export function assertAccountIdentity(
  config: LiveConfig,
  platform: string,
  expected: Account,
  actual: Record<string, unknown> | undefined,
) {
  if (
    !actual ||
    actual.id !== expected.id ||
    actual.userId !== config.userId ||
    actual.platformAccountId !== expected.platformAccountId ||
    String(actual.platform).replace("twitter", "x") !== platform ||
    !matchesApiUsername(expected, actual.username)
  )
    throw new Error(`Account identity mismatch for ${platform}; no posts were submitted.`);
  const health = actual.credentialStatus as { action?: string } | undefined;
  if (actual.previewOnly || health?.action === "reconnect")
    throw new Error(`Account ${platform} cannot publish; reconnect it before running.`);
}
export default async function setup() {
  if (process.env.E2E_LIVE !== "1" && process.env.E2E_VERIFY_ONLY !== "1")
    throw new Error(
      "Live publishing is disabled. Run e2e:plan first, then set E2E_LIVE=1 with E2E_CONFIG and E2E_RUN_ID.",
    );
  const config = loadConfig(),
    run = runId(),
    selected = selection(),
    cases = selectedCases();
  const invocationDir = path.join(config.runDir, run);
  await mkdir(invocationDir, { recursive: true, mode: 0o700 });
  const lock = path.join(invocationDir, ".live.lock");
  try {
    const handle = await open(lock, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, run, startedAt: new Date().toISOString() }));
    await handle.close();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "Another live run holds .live.lock. If it crashed, reconcile pending posts before removing the stale lock.",
      );
    throw e;
  }
  try {
    const journal = new Journal(config, run);
    const budget = budgetPlan(cases, selected.interfaces, await journal.entries());
    const maxPosts = config.maxPosts === "auto" ? budget.total : config.maxPosts;
    console.log(
      `Run message budget: ${maxPosts} (${config.maxPosts === "auto" ? "automatic for this selection" : "explicit limit"}); ${budget.spent} already reserved, ${budget.remaining} additional messages budgeted.`,
    );
    if (process.env.E2E_VERIFY_ONLY !== "1" && budget.remaining > 0 && budget.total > maxPosts)
      throw new Error(
        `Selected suite needs a total budget of ${budget.total}, but maxPosts is ${maxPosts}. Set maxPosts to "auto" or increase the explicit limit before starting. No new posts were submitted.`,
      );
    const missing = cases.flatMap((s) =>
      selected.interfaces.flatMap((iface) => {
        if (!s.interfaces.includes(iface)) return [];
        const account = config.accounts[s.platform];
        if (!account) return [`${iface}/${s.id}: missing ${s.platform} account`];
        try {
          assertRequirements(materialize(s, account, iface, run, config.mediaBaseUrl, config.fixtureUrls), account);
          return [];
        } catch (error) {
          return [`${iface}/${s.id}: ${(error as Error).message}`];
        }
      }),
    );
    if (missing.length)
      console.log(
        `Setup requirements still missing for ${missing.length} selected cases:\n${missing.map((message) => `  ${message}`).join("\n")}`,
      );
    const api = new SchedulerApi(config);
    const { accounts } = await api.request<{ accounts: Record<string, unknown>[] }>("/api/v1/accounts");
    const targeted = [...new Set(cases.map((s) => s.platform))];
    for (const p of targeted) {
      const account = config.accounts[p];
      if (!account) throw new Error(`Run yarn e2e:setup --platform ${p} to discover the missing test account.`);
      if (
        p === "telegram" &&
        cases.some(
          (s) =>
            s.platform === p &&
            !s.expectedError &&
            s.mode !== "cancel" &&
            s.mode !== "draft" &&
            selected.interfaces.some((iface) => s.interfaces.includes(iface)),
        )
      )
        assertTelegramObserver(account);
      assertAccountIdentity(
        config,
        p,
        account,
        accounts.find((a) => a.id === account.id),
      );
      if (account.observer.storageState) await access(account.observer.storageState);
    }
    if (selected.interfaces.includes("mcp")) {
      const mcp = new McpClient(config);
      try {
        await mcp.connect();
        const found = await mcp.call<{
          accounts: { accountId: string; platform: string; username: string; credentialStatus: { action: string } }[];
        }>("list_accounts", {});
        for (const p of targeted) {
          const expected = config.accounts[p]!;
          const actual = found.accounts.find((a) => a.accountId === expected.id);
          if (
            !actual ||
            actual.platform !== p ||
            !matchesApiUsername(expected, actual.username) ||
            actual.credentialStatus.action === "reconnect"
          )
            throw new Error(`MCP token cannot access the expected ${p} account`);
        }
      } finally {
        await mcp.close();
      }
    }
    if (selected.interfaces.includes("ui")) {
      if (!config.schedulerStorageState)
        throw new Error("Run yarn e2e:setup with the app URL to save a scheduler browser login.");
      const browser = await chromium.launch();
      try {
        const context = await browser.newContext({ storageState: config.schedulerStorageState });
        const response = await context.request.get(config.baseUrl + "/api/v1/accounts");
        if (!response.ok()) throw new Error("Scheduler browser session is expired or not authenticated");
        const data = await response.json();
        for (const p of targeted)
          assertAccountIdentity(
            config,
            p,
            config.accounts[p]!,
            data.accounts?.find((a: { id: string }) => a.id === config.accounts[p]!.id),
          );
        const page = await context.newPage();
        await openComposer(page, config);
      } finally {
        await browser.close();
      }
    }
    for (const iface of selected.interfaces.filter((x) => x.startsWith("cli")))
      for (const p of targeted) await checkCliIdentity(config, iface, config.accounts[p]!, p);
    // UI/local-file CLI cases upload through their own customer paths. Only URL-consuming
    // cases need source fixtures staged in the deployment's normal media storage.
    const remoteKeys: MediaKey[] = cases.flatMap((s) => {
      const needsUrls = selected.interfaces.some(
        (iface) =>
          s.interfaces.includes(iface) &&
          (iface === "mcp" ||
            (iface.startsWith("cli") && s.input === "remote") ||
            (iface !== "ui" && Boolean(s.options.thumbnailUrl))),
      );
      return needsUrls ? [...s.media, ...(s.options.thumbnailUrl ? ["image" as const] : [])] : [];
    });
    if (process.env.E2E_VERIFY_ONLY !== "1") await prepareMediaSources(config, remoteKeys, api);
    const keys = [...new Set(cases.flatMap((c) => c.media))];
    const files = await mediaFiles(config, keys);
    const dir = path.join(config.runDir, run);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    let cliVersion: string | undefined;
    if (selected.interfaces.some((x) => x.startsWith("cli")))
      cliVersion = (await runCli(config, ["--version"])).stdout.trim();
    await writeFile(
      path.join(dir, "run.json"),
      JSON.stringify(
        {
          run,
          baseUrl: config.baseUrl,
          revision: config.deploymentRevision,
          cliVersion,
          node: process.version,
          selection: selected,
          media: files.map(({ path: _path, ...file }) => file),
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const matrix = cases.flatMap((s) =>
      selected.interfaces.map((iface) => {
        if (!s.interfaces.includes(iface)) return { id: s.id, interface: iface, status: "unsupported" };
        try {
          assertRequirements(
            materialize(s, config.accounts[s.platform]!, iface, run, config.mediaBaseUrl, config.fixtureUrls),
            config.accounts[s.platform]!,
          );
          return { id: s.id, interface: iface, status: "ready" };
        } catch (e) {
          return { id: s.id, interface: iface, status: "blocked", reason: (e as Error).message };
        }
      }),
    );
    await writeFile(path.join(dir, "coverage.json"), JSON.stringify(matrix, null, 2), { mode: 0o600 });
    return async () => {
      await unlink(lock);
    };
  } catch (error) {
    await unlink(lock);
    throw error;
  }
}
