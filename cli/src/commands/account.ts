import { Args, Command } from "@oclif/core";

import { getCliPaths, loadCliConfig } from "../lib/config.js";
import { getAccountPlatformValues } from "../lib/account/platforms.js";
import {
  parseAccountPlatform,
  getStoredAccounts,
  renderUnifiedAccounts,
  remoteAccountsToAppRecords,
  type UnifiedAccountRecord,
} from "../lib/account/store.js";
import { getAccountPlatformConfig } from "../lib/account/platforms.js";
import { getSchedulerContextFromConfig, fetchRemoteAccounts } from "../lib/scheduler/client.js";
import { PromptSession } from "../lib/ux/prompt.js";

export default class AccountCommand extends Command {
  public static override args = {
    platform: Args.string({
      description: "Optional platform filter, for example x",
      options: getAccountPlatformValues(),
      required: false,
    }),
  };

  public static override description = "List connected accounts.";

  public static override examples = [
    "<%= config.bin %> account",
    "<%= config.bin %> account x",
    "<%= config.bin %> account add x",
    "<%= config.bin %> account remove main",
  ];

  public async run(): Promise<void> {
    const { args } = await this.parse(AccountCommand);
    const platform = parseAccountPlatform(args.platform);
    const paths = getCliPaths(this.config.configDir);
    const config = await loadCliConfig(paths);

    const localAccounts = getStoredAccounts(config, platform);
    const allAccounts: UnifiedAccountRecord[] = [...localAccounts];
    let hasScheduler = false;

    // Fetch app accounts if connected to scheduler
    if (config.scheduler) {
      try {
        const prompt = new PromptSession();
        const ctx = await getSchedulerContextFromConfig(config, paths, prompt);
        const remoteAccounts = await fetchRemoteAccounts(ctx);
        let appRecords = remoteAccountsToAppRecords(remoteAccounts);

        if (platform) {
          appRecords = appRecords.filter((account) => account.platform === platform);
        }

        allAccounts.push(...appRecords);
        hasScheduler = true;
      } catch {
        // Silently skip if scheduler is unreachable
      }
    }

    if (allAccounts.length === 0) {
      if (platform) {
        this.log(`No ${getAccountPlatformConfig(platform).displayName} accounts are connected yet. Run "simple-post account add ${platform}" first.`);
      } else {
        this.log('No accounts are connected yet. Run "simple-post account add" first.');
      }

      return;
    }

    const showSource = hasScheduler && localAccounts.length > 0;
    this.log(renderUnifiedAccounts(allAccounts, { includePlatform: !platform, showSource }));
  }
}
