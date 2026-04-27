import { PostErrorType, post as publishPost } from "@simple-post/sdk";

import { stdoutColors } from "../ux/colors.js";
import { loadCliConfig, getCliPaths } from "../config.js";
import { CredentialResolver, hasLegacyXEnvCredentials } from "../credentials.js";
import { createSecretStore } from "../secrets.js";
import { collectPostInput } from "./input.js";
import { getAccountPlatformValues } from "../account/platforms.js";
import {
  getSchedulerContextFromConfig,
  fetchSchedulerApi,
  fetchRemoteAccounts,
  type SchedulerContext,
  type RemotePostResponse,
} from "../scheduler/client.js";
import { remoteAccountsToAppRecords } from "../account/store.js";

import type { SecretStore } from "../secrets.js";
import type { PromptSession } from "../ux/prompt.js";
import type { Config } from "@oclif/core";
import type { Platform, Post, PostResult } from "@simple-post/sdk";
import type { PostFlagValues } from "./input.js";

interface ExecutionTarget {
  accountAlias?: string;
  platform: Platform;
  post: Post;
  secretRef?: string;
}

interface ExecutionOutcome {
  accountAlias?: string;
  platform: Platform;
  result: PostResult;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  x: "X",
  youtube: "YouTube",
  telegram: "Telegram",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  bluesky: "Bluesky",
  threads: "Threads",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
};

function hasExplicitXCredentials(post: Post): boolean {
  return Boolean(post.options?.x?.credentials);
}

function getPlatformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform];
}

function getUniquePlatforms(platforms: Platform[]): Platform[] {
  const seen = new Set<Platform>();
  return platforms.filter((platform) => {
    if (seen.has(platform)) {
      return false;
    }

    seen.add(platform);
    return true;
  });
}

function clonePostForPlatform(post: Post, platform: Platform): Post {
  return {
    ...post,
    platforms: [platform],
  };
}

function formatTargetLabel(target: { accountAlias?: string; platform: Platform }): string {
  return target.accountAlias ? `${getPlatformLabel(target.platform)} · ${target.accountAlias}` : getPlatformLabel(target.platform);
}

function formatPostSummary(results: ExecutionOutcome[]): string {
  const c = stdoutColors;
  const successes = results.filter((entry) => entry.result.error === PostErrorType.NO_ERROR);
  const failures = results.filter((entry) => entry.result.error !== PostErrorType.NO_ERROR);
  const lines = [c.bold("Post summary"), ""];

  if (successes.length > 0) {
    lines.push(c.lime(`Succeeded (${successes.length})`));
    for (const entry of successes) {
      const idPart = entry.result.id ? ` (id: ${entry.result.id})` : "";
      lines.push(`  ${c.lime("✓")} ${formatTargetLabel(entry)}: posted successfully${idPart}`);
    }
  }

  if (failures.length > 0) {
    if (successes.length > 0) {
      lines.push("");
    }

    lines.push(c.red(`Failed (${failures.length})`));
    for (const entry of failures) {
      const message = entry.result.message ? ` - ${entry.result.message}` : "";
      lines.push(`  ${c.red("✗")} ${formatTargetLabel(entry)}: ${entry.result.error}${message}`);
    }
  }

  if (failures.length === 0) {
    lines.push(c.lime("All selected targets posted successfully."));
  }

  return lines.join("\n");
}

async function persistRefreshedStoredCredentials(
  store: SecretStore,
  secretRef: string,
  result: PostResult,
): Promise<void> {
  const refreshed = result.extraData?.refreshedCredentials;
  if (!refreshed) return;

  const existing = await store.read(secretRef);
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return;

  await store.write(secretRef, {
    ...existing,
    ...(refreshed.accessToken ? { accessToken: refreshed.accessToken } : {}),
    ...(refreshed.refreshToken ? { refreshToken: refreshed.refreshToken } : {}),
    ...(typeof refreshed.expiresAt === "number" ? { expiresAt: refreshed.expiresAt } : {}),
  });
}

async function buildExecutionTargets(options: {
  cliConfig: Awaited<ReturnType<typeof loadCliConfig>>;
  paths: ReturnType<typeof getCliPaths>;
  post: Post;
  prompt: PromptSession;
  selections: Awaited<ReturnType<typeof collectPostInput>>["accountSelections"];
}): Promise<{ store?: SecretStore; targets: ExecutionTarget[] }> {
  const hasStoredSelections = Object.values(options.selections).some((aliases) => (aliases?.length ?? 0) > 0);
  let store: SecretStore | undefined;
  let resolver: CredentialResolver | undefined;

  if (hasStoredSelections) {
    if (!options.cliConfig.storage) {
      throw new Error('Stored accounts are not configured yet. Run "simple-post setup" first.');
    }

    store = createSecretStore(options.paths, options.cliConfig.storage, options.prompt);
    resolver = new CredentialResolver(options.cliConfig, store);
  }

  for (const platform of Object.keys(options.selections) as Platform[]) {
    if ((options.selections[platform]?.length ?? 0) > 0 && !options.post.platforms.includes(platform)) {
      throw new Error(`Received --account for ${getPlatformLabel(platform)}, but the post does not target that platform.`);
    }
  }

  const targets: ExecutionTarget[] = [];
  for (const platform of getUniquePlatforms(options.post.platforms)) {
    const aliases = options.selections[platform] ?? [];

    if (aliases.length === 0) {
      targets.push({
        platform,
        post: clonePostForPlatform(options.post, platform),
      });
      continue;
    }

    if (!resolver) {
      throw new Error(`A stored ${getPlatformLabel(platform)} account was selected, but the credential resolver is unavailable.`);
    }

    for (const alias of aliases) {
      const resolved = await resolver.resolveAccount(platform, alias);
      targets.push({
        accountAlias: alias,
        platform,
        post: clonePostForPlatform(resolver.injectResolvedAccount(options.post, resolved), platform),
        secretRef: resolved.secretRef,
      });
    }
  }

  return { store, targets };
}

async function postViaScheduler(
  ctx: SchedulerContext,
  post: Post,
  appAccountIds: string[],
): Promise<ExecutionOutcome[]> {
  const body: Record<string, unknown> = {
    message: post.content.text ?? "",
    accountIds: appAccountIds,
    postingMode: "now",
  };

  if (post.content.media && post.content.media.length > 0) {
    body.media = post.content.media
      .filter((m) => "url" in m && m.url)
      .map((m) => ({
        url: (m as { url: string }).url,
        type: m.type,
        filename: (m as { url: string }).url.split("/").pop() || m.type,
        size: 0,
      }));
  }

  const response = await fetchSchedulerApi<RemotePostResponse>(ctx, "/api/v1/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.postingResults) {
    return [];
  }

  return response.postingResults.map((result) => ({
    accountAlias: result.accountId,
    platform: result.platform as Platform,
    result: {
      error: result.success ? PostErrorType.NO_ERROR : PostErrorType.OTHER,
      id: result.postId,
      message: result.success ? undefined : (result.message || result.error || "Unknown error"),
      url: result.postUrl,
    },
  }));
}

export async function runPostWorkflow(options: {
  config: Config;
  flags: PostFlagValues;
  prompt: PromptSession;
  writeOutput: (message: string) => void;
}): Promise<void> {
  if (options.flags.interactive) {
    options.prompt.printBanner();
  }

  const paths = getCliPaths(options.config.configDir);
  const cliConfig = await loadCliConfig(paths);

  // Build the account list: local + app accounts
  interface AccountEntry {
    alias: string;
    appAccountId?: string;
    displayName?: string;
    platform: (typeof getAccountPlatformValues extends () => (infer T)[] ? T : never);
    source: "local" | "app";
    userId?: string;
    username?: string;
  }

  const localAccounts: AccountEntry[] = getAccountPlatformValues().flatMap((platform) =>
    cliConfig[platform].accounts.map((account) => ({
      alias: account.alias,
      displayName: account.displayName,
      platform,
      source: "local" as const,
      userId: account.userId,
      username: account.username,
    })),
  );

  let schedulerCtx: SchedulerContext | undefined;
  let appAccounts: AccountEntry[] = [];

  if (cliConfig.scheduler) {
    try {
      schedulerCtx = await getSchedulerContextFromConfig(cliConfig, paths, options.prompt);
      const remoteAccounts = await fetchRemoteAccounts(schedulerCtx);
      appAccounts = remoteAccountsToAppRecords(remoteAccounts).map((record) => ({
        alias: record.displayName || record.username || record.appAccountId,
        appAccountId: record.appAccountId,
        displayName: record.displayName ?? undefined,
        platform: record.platform,
        source: "app" as const,
        username: record.username ?? undefined,
      }));
    } catch {
      // Silently continue without app accounts if scheduler is unreachable
    }
  }

  const allAccounts = [...localAccounts, ...appAccounts];

  const postInput = await collectPostInput(options.flags, options.prompt, {
    accounts: allAccounts,
  });

  const hasLocalSelections = Object.values(postInput.accountSelections).some(
    (aliases) => (aliases?.length ?? 0) > 0,
  );
  const hasAppSelections = postInput.appAccountIds.length > 0;

  if (!hasLocalSelections && !hasAppSelections) {
    throw new Error("No posting targets were selected.");
  }

  const outcomes: ExecutionOutcome[] = [];

  // Handle local account posting
  if (hasLocalSelections) {
    if (
      postInput.post.platforms.includes("x") &&
      (postInput.accountSelections.x?.length ?? 0) === 0 &&
      !hasExplicitXCredentials(postInput.post) &&
      !hasLegacyXEnvCredentials()
    ) {
      throw new Error('Posting to X requires either --account x:<alias> or legacy X_* environment credentials.');
    }

    const executionPlan = await buildExecutionTargets({
      cliConfig,
      paths,
      post: postInput.post,
      prompt: options.prompt,
      selections: postInput.accountSelections,
    });

    for (const target of executionPlan.targets) {
      const results = await publishPost(target.post);
      const result = results.get(target.platform);
      if (!result) {
        throw new Error(`The SDK did not return a result for ${getPlatformLabel(target.platform)}.`);
      }

      outcomes.push({
        accountAlias: target.accountAlias,
        platform: target.platform,
        result,
      });

      if (executionPlan.store && target.secretRef) {
        await persistRefreshedStoredCredentials(executionPlan.store, target.secretRef, result);
      }
    }
  }

  // Handle app account posting via scheduler
  if (hasAppSelections && schedulerCtx) {
    const appOutcomes = await postViaScheduler(schedulerCtx, postInput.post, postInput.appAccountIds);
    outcomes.push(...appOutcomes);
  }

  if (outcomes.length === 0) {
    throw new Error("No posting targets were selected.");
  }

  options.writeOutput(formatPostSummary(outcomes));

  if (outcomes.some((entry) => entry.result.error !== PostErrorType.NO_ERROR)) {
    const failedTargets = outcomes.filter((entry) => entry.result.error !== PostErrorType.NO_ERROR).map(formatTargetLabel);
    throw new Error(`Posting failed for: ${failedTargets.join(", ")}.`);
  }
}
