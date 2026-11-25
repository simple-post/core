import { Args, Command, Flags } from "@oclif/core";
import { getPostAnalytics, type Platform, type PostAnalytics } from "@simple-post/sdk";

import { jsonFlag, refreshFlag } from "../../lib/analytics/flags.js";
import { persistRefreshedSecrets } from "../../lib/analytics/local.js";
import {
  renderLocalPostAnalytics,
  renderPostAnalytics,
  type PostAnalyticsResponse,
} from "../../lib/analytics/render.js";
import { getCliPaths, loadCliConfig } from "../../lib/config.js";
import { CredentialResolver, parseAccountSelections } from "../../lib/credentials.js";
import { fetchSchedulerApi, getSchedulerContextFromConfig } from "../../lib/scheduler/client.js";
import { createSecretStore } from "../../lib/secrets.js";
import { stdoutColors } from "../../lib/ux/colors.js";
import { PromptSession } from "../../lib/ux/prompt.js";

export default class AnalyticsPostCommand extends Command {
  public static override description =
    "Show analytics for one post: a SimplePost post ID, or a platform post ID read with a local account.";

  public static override examples = [
    "<%= config.bin %> analytics post clx123abc",
    "<%= config.bin %> analytics post clx123abc --refresh force --details",
    "<%= config.bin %> analytics post --account x:main --post-id 1790000000000000000",
    "<%= config.bin %> analytics post --account bluesky:me --post-id at://did:plc:abc/app.bsky.feed.post/3k",
  ];

  public static override args = {
    simplepostPostId: Args.string({
      description: "SimplePost post ID (uses your connected SimplePost account).",
      required: false,
    }),
  };

  public static override flags = {
    account: Flags.string({
      multiple: true,
      description: "Local account <platform>:<alias> that published the post.",
      helpGroup: "Local",
    }),
    "post-id": Flags.string({
      multiple: true,
      description: "Platform post ID (tweet ID, Bluesky at:// URI, Instagram media ID, …). Repeatable.",
      helpGroup: "Local",
    }),
    details: Flags.boolean({ description: "Also print every platform-native metric." }),
    refresh: refreshFlag,
    json: jsonFlag,
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(AnalyticsPostCommand);
    const local = (flags.account?.length ?? 0) > 0;
    if (local === Boolean(args.simplepostPostId)) {
      throw new Error("Pass either a SimplePost post ID, or --account with --post-id for a local account.");
    }
    const paths = getCliPaths(this.config.configDir);
    const config = await loadCliConfig(paths);
    const prompt = new PromptSession();

    if (!local) {
      const ctx = await getSchedulerContextFromConfig(config, paths, prompt);
      const response = await fetchSchedulerApi<PostAnalyticsResponse>(
        ctx,
        `/api/v1/posts/${encodeURIComponent(args.simplepostPostId!)}/analytics?refresh=${flags.refresh}`,
      );
      this.log(
        flags.json ? JSON.stringify(response, null, 2) : renderPostAnalytics(response, stdoutColors, flags.details),
      );
      return;
    }

    if (!flags["post-id"]?.length) throw new Error("--post-id is required with --account.");
    if (!config.storage) throw new Error('Stored accounts are not configured yet. Run "simplepost setup" first.');
    const store = createSecretStore(paths, config.storage, prompt);
    const resolver = new CredentialResolver(config, store);
    const results: Array<{ accountAlias: string; result: PostAnalytics }> = [];

    for (const [platform, aliases] of Object.entries(parseAccountSelections(flags.account ?? [])) as Array<
      [Platform, string[]]
    >) {
      for (const alias of aliases) {
        const resolved = await resolver.resolveAccount(platform, alias);
        const response = await getPostAnalytics({
          platform,
          targets: flags["post-id"].map((postId) => ({
            postId,
            ...(postId.startsWith("at://") ? { uri: postId } : {}),
          })),
          options: resolved.postOptions,
        });
        await persistRefreshedSecrets(store, resolved.secretRef, response.refreshedCredentials);
        for (const result of response.results) results.push({ accountAlias: alias, result });
      }
    }

    this.log(
      flags.json ? JSON.stringify(results, null, 2) : renderLocalPostAnalytics(results, stdoutColors, flags.details),
    );
    if (results.some((entry) => entry.result.status !== "ok")) process.exitCode = 1;
  }
}
