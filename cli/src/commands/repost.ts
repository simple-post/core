import { Command, Flags } from "@oclif/core";
import {
  PostErrorType,
  isRepostCapablePlatform,
  repost as publishRepost,
  type Platform,
  type PostOptions,
  type RepostResult,
  type RepostTarget,
} from "@simple-post/sdk";

import { getCliPaths, loadCliConfig } from "../lib/config.js";
import { CredentialResolver, parseAccountSelections } from "../lib/credentials.js";
import {
  fetchSchedulerApi,
  getSchedulerContextFromConfig,
  type RemoteRepostResponse,
} from "../lib/scheduler/client.js";
import { createSecretStore } from "../lib/secrets.js";
import { stdoutColors } from "../lib/ux/colors.js";
import { PromptSession } from "../lib/ux/prompt.js";

import type { SecretStore } from "../lib/secrets.js";

interface RepostOutcome {
  accountAlias?: string;
  platform: Platform | string;
  result: RepostResult;
}

const PLATFORM_LABELS: Partial<Record<Platform, string>> = {
  x: "X",
  bluesky: "Bluesky",
  threads: "Threads",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  mastodon: "Mastodon",
};

function getPlatformLabel(platform: Platform | string): string {
  return PLATFORM_LABELS[platform as Platform] ?? platform;
}

function formatTargetLabel(target: { accountAlias?: string; platform: Platform | string }): string {
  return target.accountAlias
    ? `${getPlatformLabel(target.platform)} · ${target.accountAlias}`
    : getPlatformLabel(target.platform);
}

function formatRepostSummary(results: RepostOutcome[]): string {
  const c = stdoutColors;
  const successes = results.filter((entry) => entry.result.error === PostErrorType.NO_ERROR);
  const failures = results.filter((entry) => entry.result.error !== PostErrorType.NO_ERROR);
  const lines = [c.bold("Repost summary"), ""];

  if (successes.length > 0) {
    lines.push(c.lime(`Succeeded (${successes.length})`));
    for (const entry of successes) {
      const idPart = entry.result.id ? ` (id: ${entry.result.id})` : "";
      lines.push(`  ${c.lime("✓")} ${formatTargetLabel(entry)}: reposted successfully${idPart}`);
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
    lines.push(c.lime("All selected targets reposted successfully."));
  }

  return lines.join("\n");
}

async function persistRefreshedStoredCredentials(
  store: SecretStore,
  secretRef: string,
  result: RepostResult,
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

function buildTarget(flags: { cid?: string; "post-id"?: string; "post-url"?: string; uri?: string }): RepostTarget {
  if (!flags["post-id"]) {
    throw new Error("--post-id is required for local reposts.");
  }

  return {
    postId: flags["post-id"],
    ...(flags.uri ? { uri: flags.uri } : {}),
    ...(flags.cid ? { cid: flags.cid } : {}),
    ...(flags["post-url"] ? { postUrl: flags["post-url"] } : {}),
  };
}

async function runLocalRepost(options: {
  accountFlags: string[];
  configDir: string;
  flags: {
    cid?: string;
    "post-id"?: string;
    "post-url"?: string;
    uri?: string;
  };
  prompt: PromptSession;
}): Promise<RepostOutcome[]> {
  const selections = parseAccountSelections(options.accountFlags);
  const target = buildTarget(options.flags);
  const paths = getCliPaths(options.configDir);
  const cliConfig = await loadCliConfig(paths);

  if (!cliConfig.storage) {
    throw new Error('Stored accounts are not configured yet. Run "simplepost setup" first.');
  }

  const store = createSecretStore(paths, cliConfig.storage, options.prompt);
  const resolver = new CredentialResolver(cliConfig, store);
  const outcomes: RepostOutcome[] = [];

  for (const [platform, aliases] of Object.entries(selections) as Array<[Platform, string[]]>) {
    if (!isRepostCapablePlatform(platform)) {
      throw new Error(`${getPlatformLabel(platform)} does not support native reposting through SimplePost.`);
    }

    if (platform === "bluesky" && (!target.uri || !target.cid)) {
      throw new Error("Bluesky reposts require --uri and --cid for the original post.");
    }

    for (const alias of aliases) {
      const resolved = await resolver.resolveAccount(platform, alias);
      const postOptions: PostOptions = resolved.postOptions;
      const results = await publishRepost({
        target,
        platforms: [platform],
        options: postOptions,
      });
      const result = results.get(platform);
      if (!result) {
        throw new Error(`The SDK did not return a repost result for ${getPlatformLabel(platform)}.`);
      }

      outcomes.push({ accountAlias: alias, platform, result });
      await persistRefreshedStoredCredentials(store, resolved.secretRef, result);
    }
  }

  return outcomes;
}

async function runSchedulerRepost(options: {
  appAccountIds?: string[];
  configDir: string;
  prompt: PromptSession;
  simplePostPostId: string;
}): Promise<RepostOutcome[]> {
  const paths = getCliPaths(options.configDir);
  const cliConfig = await loadCliConfig(paths);
  const schedulerCtx = await getSchedulerContextFromConfig(cliConfig, paths, options.prompt);
  const response = await fetchSchedulerApi<RemoteRepostResponse>(
    schedulerCtx,
    `/api/v1/posts/${encodeURIComponent(options.simplePostPostId)}/repost`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.appAccountIds?.length ? { accountIds: options.appAccountIds } : {}),
    },
  );

  return response.repostingResults.map((result) => ({
    accountAlias: result.accountId,
    platform: result.platform,
    result: {
      error: result.success ? PostErrorType.NO_ERROR : PostErrorType.OTHER,
      id: result.postId,
      message: result.success ? undefined : result.message || result.error || "Unknown repost error",
      url: result.postUrl,
      details: result.details,
    },
  }));
}

export default class RepostCommand extends Command {
  public static override description = "Repost previously published content on platforms that support native reposts.";

  public static override flags = {
    account: Flags.string({
      multiple: true,
      description: "Stored local account selection in the form <platform>:<alias>.",
      helpGroup: "Targets",
    }),
    "app-account-id": Flags.string({
      multiple: true,
      description: "Scheduler app account ID to use with --simplepost-post-id. Repeat to narrow the repost.",
      helpGroup: "Targets",
    }),
    "simplepost-post-id": Flags.string({
      description: "Published scheduler post ID to repost using the connected SimplePost app.",
      helpGroup: "Targets",
    }),
    "post-id": Flags.string({
      description: "Platform content ID to repost locally, such as a Tweet ID, Threads ID, LinkedIn URN, or Pin ID.",
      helpGroup: "Content",
    }),
    uri: Flags.string({
      description: "Original Bluesky post URI. Required for local Bluesky reposts.",
      helpGroup: "Bluesky",
    }),
    cid: Flags.string({
      description: "Original Bluesky post CID. Required for local Bluesky reposts.",
      helpGroup: "Bluesky",
    }),
    "post-url": Flags.string({
      description: "Optional canonical URL for the original post.",
      helpGroup: "Content",
    }),
  } as const;

  public async run(): Promise<void> {
    const { flags } = await this.parse(RepostCommand);
    const prompt = new PromptSession();
    const localAccounts = flags.account ?? [];
    const hasLocalRepost = localAccounts.length > 0;
    const hasSchedulerRepost = Boolean(flags["simplepost-post-id"]);

    if (!hasLocalRepost && !hasSchedulerRepost) {
      throw new Error("Select local --account targets or pass --simplepost-post-id for a scheduler post.");
    }

    if (hasLocalRepost && hasSchedulerRepost) {
      throw new Error("Run local reposts and scheduler post reposts separately.");
    }

    const outcomes = hasSchedulerRepost
      ? await runSchedulerRepost({
          appAccountIds: flags["app-account-id"],
          configDir: this.config.configDir,
          prompt,
          simplePostPostId: flags["simplepost-post-id"]!,
        })
      : await runLocalRepost({
          accountFlags: localAccounts,
          configDir: this.config.configDir,
          flags,
          prompt,
        });

    if (outcomes.length === 0) {
      throw new Error("No repost targets were selected.");
    }

    this.log(formatRepostSummary(outcomes));

    if (outcomes.some((entry) => entry.result.error !== PostErrorType.NO_ERROR)) {
      const failedTargets = outcomes
        .filter((entry) => entry.result.error !== PostErrorType.NO_ERROR)
        .map(formatTargetLabel);
      throw new Error(`Reposting failed for: ${failedTargets.join(", ")}.`);
    }
  }
}
